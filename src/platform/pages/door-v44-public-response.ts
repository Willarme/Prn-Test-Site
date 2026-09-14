import { createHash } from "node:crypto";
import type { DoorV44ArtifactResult } from "@/domain/search/door-v44/artifact-store";
import type { DoorV44Element } from "@/domain/search/door-v44/render-types";
import type { DoorPageSelectedEntry, DoorPageServingSnapshot } from "@/domain/search/door-v44/page-selection";
import { doorV44Hash } from "@/domain/search/door-v44/schema-engine";
import { featureDefinition, requiredFeaturesForPath } from "@/platform/features/registry";
import { featureIsLive, stateIn, type FeatureSnapshot } from "@/platform/features/state";

export type DoorV44PublicArtifact = Extract<DoorV44ArtifactResult, { ok: true }>;
export interface DoorV44PublicContext { origin: string; features: FeatureSnapshot }
export interface DoorV44PublicSelection {
  snapshot: DoorPageServingSnapshot;
  context: DoorV44PublicContext;
  entries: Array<{ entry: DoorPageSelectedEntry; artifact: DoorV44PublicArtifact }>;
}
const MEDIA_PATH = /^\/media\/door-v44\/[a-f0-9]{64}\.(?:png|webp)$/;
const digest = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** One verified membership set for page responses, directory links and assets.
 * Failed artifacts remove incoming RELATED edges transitively, never expose an
 * older version, and never erase the snapshot's managed-path tombstones. */
export async function verifyDoorV44ServingSnapshot(snapshot: DoorPageServingSnapshot, context: DoorV44PublicContext,
  readArtifact: (hash: string) => Promise<DoorV44ArtifactResult>, now = Date.now()): Promise<DoorV44PublicSelection> {
  if (snapshot.tenant_id !== context.features.tenant_id) throw new Error("Selection tenant mismatch");
  const result: DoorV44PublicSelection = { snapshot, context, entries: [] };
  if (snapshot.guard_status !== "current" || !snapshot.fence || snapshot.origin !== context.origin || !context.origin
    || !featureIsLive(context.features, "door_pages")) return result;
  trustedOrigin(context.origin);
  const candidates = new Map<string, { entry: DoorPageSelectedEntry; artifact: DoorV44PublicArtifact }>();
  const paths = new Set<string>(), ids = new Set<string>();
  for (const entry of snapshot.entries) {
    if (ids.has(entry.page_id) || paths.has(entry.canonical_path)) throw new Error("Conflicting selection");
    ids.add(entry.page_id); paths.add(entry.canonical_path);
    if (!snapshot.managed.some(row => row.kind === "catalog" && row.page_id === entry.page_id && row.canonical_path === entry.canonical_path)
      || entry.canonical_path === "/problems/ac-blowing-warm-air" || !(Date.parse(entry.valid_until) > now)) continue;
    let artifact: DoorV44ArtifactResult;
    try { artifact = await readArtifact(entry.artifact_hash); } catch { continue; }
    if (!artifact.ok) continue;
    const receipt = artifact.compiled.receipt;
    if (artifact.artifact_hash !== entry.artifact_hash || receipt.artifact_hash !== entry.artifact_hash
      || receipt.tenant_id !== snapshot.tenant_id || receipt.page_id !== entry.page_id || receipt.page_version !== entry.page_version
      || receipt.canonical_url !== entry.canonical_url || new URL(entry.canonical_url).pathname !== entry.canonical_path
      || new URL(entry.canonical_url).origin !== context.origin || doorV44Hash(receipt) !== entry.compile_receipt_sha256
      || receipt.robots !== entry.robots || !doorV44ArtifactFeaturesAllow(artifact, context)) continue;
    candidates.set(entry.page_id, { entry, artifact });
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const [id, candidate] of candidates) if (candidate.entry.related_page_ids.some(related => !candidates.has(related))) {
      candidates.delete(id); changed = true;
    }
  }
  result.entries = [...candidates.values()];
  return result;
}

/** Null means a definitively unmanaged legacy path, never a failed managed read. */
export function doorV44SelectionResponse(request: Request, selection: DoorV44PublicSelection): Response | null {
  const url = new URL(request.url);
  let path: string;
  try { path = decodeURIComponent(url.pathname).replace(/\/$/, ""); } catch { return doorV44PublicRefusal(404, request.method === "HEAD"); }
  if (path === "/problems/ac-blowing-warm-air") return null;
  const media = path.startsWith("/media/door-v44/");
  if (!media && !selection.snapshot.managed.some(row => row.canonical_path === path)) return null;
  if (!["GET", "HEAD"].includes(request.method)) return doorV44PublicRefusal(405);
  const candidate = selection.entries.find(row => media ? row.artifact.compiled.assets.some(asset => asset.path === path) : row.entry.canonical_path === path);
  return candidate ? doorV44ArtifactResponse(request, candidate.artifact, selection.context) : doorV44PublicRefusal(404, request.method === "HEAD");
}

export function doorV44PublicRefusal(status = 404, head = false): Response {
  return new Response(head ? null : status === 503 ? "Page unavailable" : status === 405 ? "Method not allowed" : "not found", {
    status, headers: { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow", "X-Content-Type-Options": "nosniff",
      "Content-Type": "text/plain; charset=utf-8", ...(status === 405 ? { Allow: "GET, HEAD" } : {}) },
  });
}

function trustedOrigin(origin: string): string {
  const url = new URL(origin);
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.origin !== origin) throw new Error("Invalid serving origin");
  return url.origin;
}

/** Uses the emitted document, not stale input intentions. Independent capability
 * evidence remains the release selector's job; feature IDs are a separate registry. */
export function doorV44ArtifactFeaturesAllow(artifact: DoorV44PublicArtifact, context: DoorV44PublicContext): boolean {
  try {
    const { features } = context, origin = trustedOrigin(context.origin);
    if (artifact.compiled.receipt.tenant_id !== features.tenant_id || !featureIsLive(features, "door_pages")) return false;
    const allowed = (href: string, mutation: boolean): boolean => {
      const url = new URL(href, origin);
      if (url.origin !== origin) return !mutation;
      return requiredFeaturesForPath(url.pathname).every(id => stateIn(features, id) === "LIVE"
        || (!mutation && stateIn(features, id) === "PREVIEW" && featureDefinition(id)?.marketing_path === url.pathname));
    };
    const visit = (node: DoorV44Element): boolean => {
      const attrs = node.attrs ?? {};
      if (attrs.href && !allowed(attrs.href, false)) return false;
      if (attrs.action && !allowed(attrs.action, true)) return false;
      if (attrs.formaction && !allowed(attrs.formaction, true)) return false;
      const capability = attrs["data-capability-id"];
      const feature = capability === "home_problem_analyzer" ? "intake" : capability && featureDefinition(capability) ? capability : null;
      if (feature && !featureIsLive(features, feature)) return false;
      return (node.children ?? []).every(child => typeof child === "string" || visit(child));
    };
    return artifact.compiled.document.body.every(visit);
  } catch { return false; }
}

/** A selection adapter must supply an eligible, byte-verified artifact. This
 * function never selects a version or upgrades a compiler receipt into approval. */
export function doorV44ArtifactResponse(request: Request, artifact: DoorV44PublicArtifact, context: DoorV44PublicContext): Response {
  const head = request.method === "HEAD";
  if (!["GET", "HEAD"].includes(request.method)) return doorV44PublicRefusal(405);
  try {
    const origin = trustedOrigin(context.origin), url = new URL(request.url);
    if (url.origin !== origin) return doorV44PublicRefusal(404, head);
    const canonical = new URL(artifact.compiled.receipt.canonical_url);
    if (canonical.origin !== origin) return doorV44PublicRefusal(503, head);
    if (!doorV44ArtifactFeaturesAllow(artifact, context)) return doorV44PublicRefusal(404, head);
    const path = decodeURIComponent(url.pathname);
    let bytes: Uint8Array;
    let mime: string, hash: string;
    if (path === canonical.pathname) {
      bytes = Buffer.from(artifact.compiled.html, "utf8"); mime = "text/html; charset=utf-8"; hash = artifact.compiled.receipt.html_hash;
    } else if (MEDIA_PATH.test(path)) {
      const asset = artifact.compiled.assets.find(row => row.path === path);
      if (!asset || asset.url !== new URL(path, origin).href) return doorV44PublicRefusal(404, head);
      bytes = Buffer.from(asset.base64, "base64"); mime = asset.mime; hash = asset.sha256;
    } else return doorV44PublicRefusal(404, head);
    if (digest(bytes) !== hash) return doorV44PublicRefusal(503, head);
    return new Response(head ? null : new Uint8Array(bytes), { headers: {
      "Content-Type": mime, "Content-Length": String(bytes.byteLength), ETag: `"${hash}"`,
      "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow", "X-Content-Type-Options": "nosniff",
    } });
  } catch { return doorV44PublicRefusal(503, head); }
}
