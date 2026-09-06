import { createHash } from "node:crypto";
import { z } from "zod";
import binding from "../../../content/door-template/v43/binding.json";
import type { DoorSourceVerification } from "./door-template-qa";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const date = z.string().datetime({ offset: true });
const text = z.string().trim().min(1);
const Source = z.object({
  source_id: text, url: z.string().url(), final_url: z.string().url(),
  http_status: z.literal(200), captured_at: date, content_sha256: hash,
  content_bytes: z.number().int().positive(), evidence_class: text,
  published_at: z.string().nullable(), modified_at: z.string().nullable(),
  date_basis: text, summary: text,
}).strict();
const Claim = z.object({
  claim_id: text, claim_sha256: hash,
  source_captures: z.array(z.object({ source_id: text, content_sha256: hash }).strict()),
  reviewed_at: date, expires_at: date,
  status: z.enum(["SUPPORTED", "PARTIALLY_SUPPORTED", "UNBOUND", "NOT_SUPPORTED", "UNAVAILABLE"]),
  reason: text, gaps: z.array(text),
}).strict();
const Finding = z.object({ finding_id: text, severity: text, sections: z.array(text), reason: text }).strict();
export const SourceReviewBundle = z.object({
  schema_version: z.literal(1), page_id: z.literal("ac-blowing-warm-air"),
  binding_sha256: hash, reviewed_at: date, expires_at: date, reviewer: text,
  sources: z.array(Source), claims: z.array(Claim), findings: z.array(Finding), bundle_sha256: hash,
}).strict();
export type SourceReviewBundle = z.infer<typeof SourceReviewBundle>;
export const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
export function sourceReviewHash(bundle: Omit<SourceReviewBundle, "bundle_sha256">): string {
  return sha256(JSON.stringify(bundle));
}
const sameIds = (a: string[], b: string[]) => a.length === b.length && new Set(a).size === a.length &&
  [...a].sort().join("\n") === [...b].sort().join("\n");
const current = (start: string, end: string, now: number, days: number) =>
  Date.parse(start) <= now && Date.parse(end) > now && Date.parse(end) > Date.parse(start) &&
  Date.parse(end) - Date.parse(start) <= days * 86400000;

/** A reviewed server-owned record, never a PageSpec, request body or model verdict.
 * The digest detects damage; provenance rests on reviewed repository changes and
 * the retained HTTP capture audit. It is not a signature or live-network check. */
export function evaluateSourceReview(input: unknown, now = new Date()) {
  const bundle = SourceReviewBundle.parse(input);
  const { bundle_sha256, ...payload } = bundle;
  if (bundle_sha256 !== sourceReviewHash(payload) || bundle.binding_sha256 !== binding.binding_sha256) {
    throw new Error("Source review digest or frozen binding mismatch");
  }
  const expectedClaims = binding.claim_bindings.filter(row => row.claim_type !== "capability");
  if (!sameIds(bundle.sources.map(row => row.source_id), binding.source_bindings.map(row => row.source_id)) ||
      !sameIds(bundle.claims.map(row => row.claim_id), expectedClaims.map(row => row.claim_id)) ||
      new Set(bundle.findings.map(row => row.finding_id)).size !== bundle.findings.length) {
    throw new Error("Source review inventory missing, duplicated or unknown");
  }
  for (const source of bundle.sources) {
    const expected = binding.source_bindings.find(row => row.source_id === source.source_id)!;
    const final = new URL(source.final_url);
    if (source.url !== expected.url || final.protocol !== "https:" || final.username || final.password ||
        final.hostname !== new URL(source.url).hostname || Date.parse(source.captured_at) > Date.parse(bundle.reviewed_at)) {
      throw new Error("Source review capture identity or chronology mismatch");
    }
  }
  for (const claim of bundle.claims) {
    const expected = expectedClaims.find(row => row.claim_id === claim.claim_id)!;
    if (claim.claim_sha256 !== sha256(expected.text) ||
        !sameIds(claim.source_captures.map(row => row.source_id), expected.source_ids) ||
        (claim.status === "SUPPORTED" && (!expected.source_ids.length || claim.gaps.length)) ||
        Date.parse(claim.reviewed_at) > Date.parse(bundle.reviewed_at)) {
      throw new Error("Source review exact claim identity or support mismatch");
    }
    for (const capture of claim.source_captures) {
      const source = bundle.sources.find(row => row.source_id === capture.source_id)!;
      if (capture.content_sha256 !== source.content_sha256 || Date.parse(source.captured_at) > Date.parse(claim.reviewed_at)) {
        throw new Error("Source changed since claim review; revalidation required");
      }
    }
  }
  const fresh = current(bundle.reviewed_at, bundle.expires_at, now.getTime(), 90);
  // Captures older than the evidence window cannot be made fresh by a new review date.
  const freshSource = (row: z.infer<typeof Source>) => fresh &&
    Date.parse(row.captured_at) <= now.getTime() && now.getTime() - Date.parse(row.captured_at) <= 90 * 86400000;
  const claimCurrent = (row: z.infer<typeof Claim>) => current(row.reviewed_at, row.expires_at, now.getTime(),
    /\$|\bcost|\bprice|\brange\b/i.test(expectedClaims.find(claim => claim.claim_id === row.claim_id)!.text) ? 90 : 180);
  const sources: DoorSourceVerification[] = bundle.sources.filter(freshSource).map(source => ({
    source_id: source.source_id, url: source.url, content_sha256: source.content_sha256,
    verified_at: bundle.reviewed_at, expires_at: bundle.expires_at, verifier: bundle.reviewer,
    receipt_sha256: bundle.bundle_sha256,
    supported_claim_sha256: bundle.claims.filter(claim => claim.status === "SUPPORTED" && claimCurrent(claim) &&
      claim.source_captures.some(capture => capture.source_id === source.source_id)).map(claim => claim.claim_sha256),
  }));
  return { bundle, sources, fresh, claims: bundle.claims.map(claim => ({ ...claim,
    current: fresh && claimCurrent(claim) && claim.source_captures.every(capture =>
      freshSource(bundle.sources.find(source => source.source_id === capture.source_id)!)),
  })) };
}
