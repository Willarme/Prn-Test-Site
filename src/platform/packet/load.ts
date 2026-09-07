import { buildDirectionsInput, type LabelReadRow } from "@/domain/packet/directions-input";
import type { DirectionsInput } from "@/domain/packet/types";
import { localMediaFile } from "@/platform/adapters/media-storage";
import { loadJourneyContext } from "@/platform/intake/complete";
import { readLabelConfidence } from "@/platform/intake/media";
import { verifyLink } from "@/platform/links/tokens";
import { issueLink } from "@/platform/links/ledger";
import { ownerAllowed } from "@/platform/links/owner";
import { runtimeStore, type JobAddress, type Journey } from "@/platform/stores/runtime";
import { journeySafetyRule } from "@/domain/problem/journey-safety";

/**
 * THE PACKET LOADER — what both packet routes share (campaign track P1,
 * 2026-09-05): resolve who may open this packet, load the journey, mint the
 * three scoped links, read the stored photos for thumbnails, and hand the
 * Directions' input to the renderer. Routes own transport only.
 *
 * ACCESS. No account, ever (checklist D4). An owner packet requires a signed
 * request cookie or matching keep capability. A provider copy opens with a
 * signed `packet`-scope share link (track P3's /p/<token>
 * redirects here with `?share=`). A share token that is malformed, forged,
 * expired, revoked, or minted for a different request is refused as
 * "not found"; the route has nothing different to say in those cases.
 *
 * LINKS. `home_memory_url` and `trust_network_url` are signed `keep`/`ask`
 * links minted for an authorized owner render only; provider copies omit
 * these capabilities — see the deviation note in directions-input.ts.
 * The provider media link (decision 7A) is a `media`-scope link. Each render
 * mints fresh link ids; revoking one revokes that one. That is the F2b design
 * and a known cost for the demo: a printed packet and a later PDF carry
 * different link ids, each independently revocable.
 *
 * THUMBNAILS. Bytes are read from the file media store and downscaled through
 * `sharp` WHEN IT IS PRESENT (it ships as Next's optional dependency; no new
 * dependency is added). If metadata-removing re-encoding fails, the renderer
 * uses a labelled placeholder. Original image bytes are never embedded.
 */

export type PacketAccess =
  | { ok: true; via: "request_id" | "share_link"; link_id: string | null; owner: boolean }
  | { ok: false; status: 404 };

export async function resolvePacketAccess(requestId: string, share: string | null, keep?: string): Promise<PacketAccess> {
  if (!share) {
    return await ownerAllowed(requestId, keep)
      ? { ok: true, via: "request_id", link_id: null, owner: true }
      : { ok: false, status: 404 };
  }
  try {
    const v = await verifyLink(share, "packet");
    if (!v.ok || v.request_id !== requestId) return { ok: false, status: 404 };
    return { ok: true, via: "share_link", link_id: v.link_id, owner: false };
  } catch {
    return { ok: false, status: 404 };
  }
}

async function thumbnail(bytes: Buffer): Promise<string | null> {
  try {
    const mod = (await import("sharp")) as unknown as { default?: (input: Buffer) => SharpLike } | ((input: Buffer) => SharpLike);
    const sharp = typeof mod === "function" ? mod : mod.default;
    if (sharp) {
      const out = await sharp(bytes).rotate().resize({ width: 480, height: 360, fit: "cover" }).jpeg({ quality: 72 }).toBuffer();
      return `data:image/jpeg;base64,${out.toString("base64")}`;
    }
  } catch {
    /* sharp absent or the image unreadable — fall through */
  }
  // A failed metadata-removing re-encode must never publish original bytes.
  // The renderer keeps the honest labelled placeholder instead.
  return null;
}

interface SharpLike {
  rotate(): SharpLike;
  resize(opts: { width: number; height: number; fit: string }): SharpLike;
  jpeg(opts: { quality: number }): SharpLike;
  toBuffer(): Promise<Buffer>;
}

export interface LoadedPacket {
  journey: Journey;
  address: JobAddress | null;
  /** Existing record became unsafe later; route to the approved safety page. */
  safety_halt?: string;
  /** Null for a safety halt. T1-35 packets carry explicit address gaps. */
  input: DirectionsInput | null;
}

export async function loadPacket(
  requestId: string,
  opts: { link_base: string; now?: string; owner?: boolean }
): Promise<LoadedPacket | null> {
  const ctx = await loadJourneyContext(requestId);
  if (!ctx) return null;
  const safety = journeySafetyRule(ctx.journey.problem);
  if (safety && !safety.intake_may_continue) {
    return { journey: ctx.journey, address: null, input: null, safety_halt: safety.safety_rule_id };
  }
  const store = runtimeStore();
  const [address, answers, diagnosis, claims] = await Promise.all([
    store.getJobAddress(requestId),
    store.listIntakeAnswers(requestId),
    store.listDiagnosisAnswers(requestId),
    store.listClaims(ctx.journey.problem.problem_id),
  ]);
  if (!address && !ctx.journey.packet.intake_snapshot) return { journey: ctx.journey, address: null, input: null };

  const thumbnails: Record<string, string> = {};
  for (const e of ctx.allEvidence) {
    if (e.kind !== "photo") continue;
    const bytes = localMediaFile(e.content);
    if (!bytes) continue;
    const uri = await thumbnail(bytes);
    if (uri) thumbnails[e.evidence_id] = uri;
  }
  const labelReads: LabelReadRow[] = ((await readLabelConfidence(requestId)) ?? []).map((r) => ({
    evidence_id: r.evidence_id,
    confidence: r.confidence,
  }));

  // Await durable issuance before any owner capability can reach HTML or PDF.
  const keep = opts.owner ? (await issueLink({ scope: "keep", request_id: requestId })).token : null;
  const ask = opts.owner ? (await issueLink({ scope: "ask", request_id: requestId })).token : null;
  const media = opts.owner ? (await issueLink({ scope: "media", request_id: requestId })).token : null;
  const input = buildDirectionsInput(
    {
      ...ctx,
      address,
      answers,
      diagnosis,
      claims,
      evidence: ctx.allEvidence,
      label_reads: labelReads,
      thumbnails,
    },
    {
      link_base: opts.link_base,
      home_memory_url: keep ? `${opts.link_base}/keep/${keep}` : "",
      trust_network_url: ask ? `${opts.link_base}/ask/${ask}` : "",
      media_link: media ? `${opts.link_base}/media/${media}` : null,
      now: opts.now ?? ctx.journey.packet.generated_at,
    }
  );
  input.config.owner_actions = opts.owner === true;
  if (ctx.journey.packet.intake_snapshot) {
    input.counts = { ...input.counts, facts_captured: ctx.journey.packet.intake_snapshot.handoff.counts.facts };
  }
  return { journey: ctx.journey, address, input };
}
