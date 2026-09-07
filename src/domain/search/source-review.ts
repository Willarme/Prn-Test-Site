import { createHash } from "node:crypto";
import { z } from "zod";
import { getAmendedV43Binding, V43_COPY_AMENDMENT_SHA256 } from "./door-template-amendment";
import type { DoorSourceVerification } from "./door-template-qa";

const binding = getAmendedV43Binding();

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const date = z.string().datetime({ offset: true });
const text = z.string().trim().min(1);
const Capture = z.object({ source_id: text, content_sha256: hash }).strict();
const Source = z.object({
  source_id: text, url: z.string().url(), final_url: z.string().url(),
  http_status: z.literal(200), captured_at: date, content_sha256: hash,
  content_bytes: z.number().int().positive(), evidence_class: text,
  published_at: z.string().nullable(), modified_at: z.string().nullable(),
  date_basis: text, summary: text,
}).strict();
const Claim = z.object({
  claim_id: text, claim_sha256: hash,
  source_captures: z.array(Capture),
  reviewed_at: date, expires_at: date,
  status: z.enum(["SUPPORTED", "PARTIALLY_SUPPORTED", "UNBOUND", "NOT_SUPPORTED", "UNAVAILABLE"]),
  reason: text, gaps: z.array(text),
}).strict();
const Finding = z.object({ finding_id: text, severity: text, sections: z.array(text), reason: text,
  source_captures: z.array(Capture).optional(),
  status: z.enum(["OPEN", "RESOLVED_BY_REVIEWED_AMENDMENT"]),
  resolution: z.object({ amendment_sha256: hash, section_text_sha256: hash }).strict().optional(),
}).strict();
export const SourceReviewBundle = z.object({
  schema_version: z.literal(1), page_id: z.literal("ac-blowing-warm-air"),
  binding_sha256: hash, base_binding_sha256: hash, amendment_sha256: hash,
  reviewed_at: date, expires_at: date, reviewer: text,
  sources: z.array(Source), supplemental_sources: z.array(Source).optional(),
  claims: z.array(Claim), findings: z.array(Finding), bundle_sha256: hash,
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

// These are reviewed server policy, not bundle-authored permissions. New sources,
// claim approvals or changed captures need a code review as well as a new digest.
const REVIEWED_BINDING = "3f14222350a5ae401381ab37b31b7b66c83dd05416a4fd2631b533db417518ea";
export const REVIEWED_SUPPLEMENTAL_SOURCES = [
  { source_id: "sup-trane-frozen-causes", publisher: "Trane", title: "Frozen Evaporator Coil Causes",
    url: "https://www.trane.com/residential/en/resources/blog/frozen-evaporator-coil-causes/",
    content_sha256: "9cecca766f13e3007a8d1b82a5716d16f52b4066904efc3ed6594efec94811b9",
    captured_at: "2026-09-06T16:40:11.458Z", content_bytes: 302004 },
  { source_id: "sup-carrier-troubleshoot", publisher: "Carrier", title: "Troubleshoot an AC Not Working",
    url: "https://www.carrier.com/us/en/residential/hvac-resources/air-conditioners/troubleshoot-an-ac-not-working/",
    content_sha256: "11a879c8a114e450573c40d4cfbb36de3670df7b12b9679d42ace2428fd85ecb",
    captured_at: "2026-09-06T16:40:11.490Z", content_bytes: 149690 },
  { source_id: "sup-copeland-safety", publisher: "Copeland", title: "AE4-1434 R2: ZP*KB R410A Compressor Application Guidelines",
    url: "https://webapps.copeland.com/online-product-information/Publication/LaunchPDF?Index=AEB&PDF=1434",
    content_sha256: "09391d605138a2549b66fe89c87167f250ee4417bf5c69ec234813956c7b8a97",
    captured_at: "2026-09-06T16:40:12.240Z", content_bytes: 711421 },
  { source_id: "sup-trane-room-ducts", publisher: "Trane", title: "Why Is My Furnace Not Blowing Hot Air?",
    url: "https://www.trane.com/residential/en/resources/troubleshooting/gas-furnaces/furnace-not-blowing-not-air/",
    content_sha256: "341a1a52f8bcc1875e50407f555fb58fa8a846f4d855740b7ab23675a28440dd",
    captured_at: "2026-09-06T16:40:12.239Z", content_bytes: 313657 },
  { source_id: "sup-trane-continuous-running", publisher: "Trane", title: "AC Won't Turn Off? Find Out Why and What to Do",
    url: "https://www.trane.com/residential/en/resources/troubleshooting/air-conditioners/ac-wont-turn-off/",
    content_sha256: "ca23c7ddb9a3c1a3c3a692d2fe0efbe1623ed464ce45a64078a2b258f9f96175",
    captured_at: "2026-09-07T00:09:53.027Z", content_bytes: 264715 },
] as const;
// Exact additional evidence for an unchanged claim. Existing frozen sources
// may support another claim, but only through these explicitly reviewed edges.
const SUPPLEMENTAL_CLAIM_SOURCES: Record<string, readonly string[]> = {
  "stat-3": ["sup-trane-frozen-causes"],
  "cause-2": ["src-7", "sup-carrier-troubleshoot", "sup-trane-continuous-running"],
  "cause-4": ["src-6", "src-7"],
};
const APPROVED_CLAIMS: Record<string, { claim_sha256: string; captures: Record<string, string> }> = {
  "stat-2": { claim_sha256: "cb6f820e001f77da127e65509088f5d130b2998237cd7069f5fe272ccff5596b", captures: {
    "src-5": "08163f2b78d6fa28b74282c314876dc1309095f6552e2b30d20c8c4aeeabb1fd",
  } },
  "stat-3": { claim_sha256: "dffba4aceae9f6be5350f224389bd9c6bee0292def4554e83b027ebac7fc9d99", captures: {
    "src-6": "30fc1895f1d06d064edb39e964bf569f375850a99431f05332726ff5ea27ec9e",
    "sup-trane-frozen-causes": REVIEWED_SUPPLEMENTAL_SOURCES[0].content_sha256,
  } },
  "cause-5": { claim_sha256: "ba4a1a5538393e3147d6e53531e3abc9a1a4d1da8d4448297a5e87c54668b32e", captures: {
    "src-8": "3b1ea2cb7e08833dac2ab15d948c7e8abd75f2ab705e40f28a41dd1d014e1807",
  } },
  "cause-2": { claim_sha256: "8b6d1134e4a53a44cd928a03cc7f0eda32eb5788cc2c64273dc03f7327d177d2", captures: {
    "src-7": "9a9ff69d9f186cb9e67548199a54aa040be92d43425a81fcae6ad0db6f237b07",
    "sup-carrier-troubleshoot": REVIEWED_SUPPLEMENTAL_SOURCES[1].content_sha256,
    "sup-trane-continuous-running": REVIEWED_SUPPLEMENTAL_SOURCES[4].content_sha256,
  } },
  "cause-4": { claim_sha256: "c9a3fae1bdf4f4d62351512215a21d9484c09b92c2af59b2a74631482983c19e", captures: {
    "src-11": "f5d4ed60a5f8bff4cde21bc4738a5b65a9f64a255f526ee7e72b629b5ec9bdbd",
    "src-6": "30fc1895f1d06d064edb39e964bf569f375850a99431f05332726ff5ea27ec9e",
    "src-7": "9a9ff69d9f186cb9e67548199a54aa040be92d43425a81fcae6ad0db6f237b07",
  } },
};
const REQUIRED_FINDINGS = [
  { finding_id: "unbound-warm-system-continued-operation", severity: "RELEASE_BLOCKING_SOURCE_CONFLICT",
    sections: ["FAQ", "VISUALS"], source_ids: ["src-5", "src-6"] },
  { finding_id: "unbound-room-scope-categorical-claim", severity: "SOURCE_COVERAGE_GAP",
    sections: ["WHAT_CHANGES_THE_ANSWER"], source_ids: ["sup-trane-room-ducts"] },
  { finding_id: "unbound-frozen-compressor-flood-and-repair-cost", severity: "SOURCE_COVERAGE_GAP",
    sections: ["FAQ"], source_ids: ["src-6"] },
  { finding_id: "unknown-equipment-breaker-reset-conflict", severity: "RELEASE_BLOCKING_SOURCE_CONFLICT",
    sections: ["COMMON_POSSIBILITIES"], source_ids: ["sup-carrier-troubleshoot", "sup-copeland-safety"] },
];

/** A reviewed server-owned record, never a PageSpec, request body or model verdict.
 * The digest detects damage; provenance rests on reviewed repository changes and
 * the retained HTTP capture audit. It is not a signature or live-network check. */
export function evaluateSourceReview(input: unknown, now = new Date()) {
  const bundle = SourceReviewBundle.parse(input);
  const { bundle_sha256, ...payload } = bundle;
  const { binding_sha256, ...bindingPayload } = binding;
  if (bundle_sha256 !== sourceReviewHash(payload) || bundle.base_binding_sha256 !== REVIEWED_BINDING ||
      bundle.amendment_sha256 !== V43_COPY_AMENDMENT_SHA256 || bundle.binding_sha256 !== binding_sha256 ||
      sha256(JSON.stringify(bindingPayload)) !== binding_sha256) {
    throw new Error("Source review digest or frozen binding mismatch");
  }
  const expectedClaims = binding.claim_bindings.filter(row => row.claim_type !== "capability");
  const supplemental = bundle.supplemental_sources ?? [];
  const allSources = [...bundle.sources, ...supplemental];
  if (!sameIds(bundle.sources.map(row => row.source_id), binding.source_bindings.map(row => row.source_id)) ||
      !sameIds(supplemental.map(row => row.source_id), REVIEWED_SUPPLEMENTAL_SOURCES.map(row => row.source_id)) ||
      !sameIds(bundle.claims.map(row => row.claim_id), expectedClaims.map(row => row.claim_id)) ||
      !sameIds(bundle.findings.map(row => row.finding_id), REQUIRED_FINDINGS.map(row => row.finding_id))) {
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
  for (const source of supplemental) {
    const expected = REVIEWED_SUPPLEMENTAL_SOURCES.find(row => row.source_id === source.source_id)!;
    if (source.url !== expected.url || source.final_url !== expected.url ||
        source.content_sha256 !== expected.content_sha256 || source.captured_at !== expected.captured_at ||
        source.content_bytes !== expected.content_bytes || Date.parse(source.captured_at) > Date.parse(bundle.reviewed_at)) {
      throw new Error("Supplemental source capture identity or reviewed version mismatch");
    }
  }
  for (const claim of bundle.claims) {
    const expected = expectedClaims.find(row => row.claim_id === claim.claim_id)!;
    const approved = APPROVED_CLAIMS[claim.claim_id];
    const expectedSourceIds = [...expected.source_ids, ...(SUPPLEMENTAL_CLAIM_SOURCES[claim.claim_id] ?? [])];
    if (claim.claim_sha256 !== sha256(expected.text) ||
        !sameIds(claim.source_captures.map(row => row.source_id), expectedSourceIds) ||
        (claim.status === "SUPPORTED" && (!approved || claim.gaps.length ||
          claim.claim_sha256 !== approved.claim_sha256 ||
          !sameIds(claim.source_captures.map(row => row.source_id), Object.keys(approved.captures)) ||
          claim.source_captures.some(row => row.content_sha256 !== approved.captures[row.source_id]))) ||
        Date.parse(claim.reviewed_at) > Date.parse(bundle.reviewed_at)) {
      throw new Error("Source review exact claim identity or support mismatch");
    }
    for (const capture of claim.source_captures) {
      const source = allSources.find(row => row.source_id === capture.source_id)!;
      if (capture.content_sha256 !== source.content_sha256 || Date.parse(source.captured_at) > Date.parse(claim.reviewed_at)) {
        throw new Error("Source changed since claim review; revalidation required");
      }
    }
  }
  for (const finding of bundle.findings) {
    const expected = REQUIRED_FINDINGS.find(row => row.finding_id === finding.finding_id)!;
    const captures = finding.source_captures ?? [];
    if (finding.severity !== expected.severity || !sameIds(finding.sections, expected.sections) ||
        !sameIds(captures.map(row => row.source_id), expected.source_ids) ||
        captures.some(capture => capture.content_sha256 !== allSources.find(row => row.source_id === capture.source_id)?.content_sha256)) {
      throw new Error("Required source finding changed or lost its capture evidence");
    }
    const sectionHash = sha256(JSON.stringify(expected.sections.map(id => binding.sections.find(row => row.section_id === id)!.text)));
    if (finding.status === "RESOLVED_BY_REVIEWED_AMENDMENT" ?
        finding.resolution?.amendment_sha256 !== V43_COPY_AMENDMENT_SHA256 || finding.resolution?.section_text_sha256 !== sectionHash :
        finding.resolution !== undefined) throw new Error("Finding resolution is not bound to the reviewed amended wording");
  }
  const fresh = current(bundle.reviewed_at, bundle.expires_at, now.getTime(), 90);
  // Captures older than the evidence window cannot be made fresh by a new review date.
  const freshSource = (row: z.infer<typeof Source>) => fresh &&
    Date.parse(row.captured_at) <= now.getTime() && now.getTime() - Date.parse(row.captured_at) <= 90 * 86400000;
  const claimCurrent = (row: z.infer<typeof Claim>) => current(row.reviewed_at, row.expires_at, now.getTime(),
    /\$|\bcost|\bprice|\brange\b/i.test(expectedClaims.find(claim => claim.claim_id === row.claim_id)!.text) ? 90 : 180);
  // Composite support expires if any required capture expires. A fresh base
  // source must not keep issuing a receipt after its supplement becomes stale.
  const currentClaim = (claim: z.infer<typeof Claim>) => fresh && claimCurrent(claim) &&
    claim.source_captures.every(capture => freshSource(allSources.find(source => source.source_id === capture.source_id)!));
  const sources: DoorSourceVerification[] = allSources.filter(freshSource).map(source => ({
    source_id: source.source_id, url: source.url, content_sha256: source.content_sha256,
    verified_at: bundle.reviewed_at, expires_at: bundle.expires_at, verifier: bundle.reviewer,
    receipt_sha256: bundle.bundle_sha256,
    supported_claim_sha256: bundle.claims.filter(claim => claim.status === "SUPPORTED" && currentClaim(claim) &&
      claim.source_captures.some(capture => capture.source_id === source.source_id)).map(claim => claim.claim_sha256),
  }));
  return { bundle, sources, allSources, fresh, openFindings: bundle.findings.filter(finding => finding.status === "OPEN"), claims: bundle.claims.map(claim => ({ ...claim,
    current: currentClaim(claim),
  })) };
}
