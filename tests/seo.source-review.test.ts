import { readFileSync } from "node:fs";
import { describe, expect, it, vi, afterEach } from "vitest";
import { evaluateSourceReview, sourceReviewHash, type SourceReviewBundle } from "@/domain/search/source-review";
import { publicSourceReview } from "@/platform/search/source-review-store";
import { GET } from "@/app/sources/pages/ac-blowing-warm-air.json/route";

const current = new Date("2026-09-07T00:00:00Z");
const fixture = (): SourceReviewBundle => JSON.parse(readFileSync("content/source-evidence/ac-blowing-warm-air.json", "utf8"));
const resign = (value: SourceReviewBundle) => {
  const { bundle_sha256: _hash, ...payload } = value;
  value.bundle_sha256 = sourceReviewHash(payload);
  return value;
};
afterEach(() => vi.useRealTimers());

describe("actual server-owned v43 source review", () => {
  it("admits the frozen inventory plus three fixed supplements, with only two supported claims", () => {
    const review = evaluateSourceReview(fixture(), current);
    expect(review.bundle.sources).toHaveLength(11);
    expect(review.bundle.supplemental_sources).toHaveLength(3);
    expect(review.sources).toHaveLength(14);
    const frozen = review.bundle.claims.find(row => row.claim_id === "stat-3")!;
    expect(review.sources.filter(row => row.supported_claim_sha256.length)).toEqual([
      expect.objectContaining({ source_id: "src-5", supported_claim_sha256: [review.bundle.claims.find(row => row.claim_id === "stat-2")!.claim_sha256] }),
      expect.objectContaining({ source_id: "src-6", supported_claim_sha256: [frozen.claim_sha256] }),
      expect.objectContaining({ source_id: "sup-trane-frozen-causes", supported_claim_sha256: [frozen.claim_sha256] }),
    ]);
    expect(review.claims.filter(row => row.status === "PARTIALLY_SUPPORTED")).toHaveLength(5);
    expect(review.claims.filter(row => row.status === "UNBOUND")).toHaveLength(3);
    expect(review.bundle.findings).toHaveLength(4);
    expect(review.bundle.findings.find(row => row.finding_id === "unknown-equipment-breaker-reset-conflict")?.severity).toBe("RELEASE_BLOCKING_SOURCE_CONFLICT");
  });
  it("invalidates old captures after expiry without erasing historical review or gaps", () => {
    const review = evaluateSourceReview(fixture(), new Date("2026-12-06T00:00:00Z"));
    expect(review.sources).toEqual([]);
    expect(review.claims.every(row => !row.current)).toBe(true);
    expect(review.bundle.findings).toHaveLength(4);
  });
  it("fails if bytes change without updating the reviewed digest", () => {
    const value = fixture(); value.claims[0].status = "SUPPORTED";
    expect(() => evaluateSourceReview(value, current)).toThrow(/digest/);
  });
  it.each(["binding", "claim_text", "source_url", "duplicate_source", "missing_claim", "capture_change", "unbound_pass", "gaps_pass", "capture_after_review", "foreign_redirect", "unknown_field"])("rejects %s even with a recomputed transport digest", mutation => {
    const value = fixture();
    if (mutation === "binding") value.binding_sha256 = "a".repeat(64);
    if (mutation === "claim_text") value.claims[0].claim_sha256 = "a".repeat(64);
    if (mutation === "source_url") value.sources[0].url += "?different=1";
    if (mutation === "duplicate_source") value.sources.push(value.sources[0]);
    if (mutation === "missing_claim") value.claims.pop();
    if (mutation === "capture_change") value.sources[0].content_sha256 = "a".repeat(64);
    if (mutation === "unbound_pass") value.claims.find(row => row.claim_id === "cause-1")!.status = "SUPPORTED";
    if (mutation === "gaps_pass") value.claims[0].status = "SUPPORTED";
    if (mutation === "capture_after_review") value.sources[0].captured_at = "2026-10-01T00:00:00Z";
    if (mutation === "foreign_redirect") value.sources[0].final_url = "https://example.com/";
    if (mutation === "unknown_field") Object.assign(value, { private_runtime_path: "not allowed" });
    expect(() => evaluateSourceReview(resign(value), current)).toThrow();
  });
  it("cannot reset stale capture age merely by issuing a new review date", () => {
    const value = fixture();
    value.reviewed_at = "2027-01-01T00:00:00Z";
    value.expires_at = "2027-02-01T00:00:00Z";
    expect(evaluateSourceReview(resign(value), new Date("2027-01-02T00:00:00Z")).sources).toEqual([]);
  });
  it("refuses a TTL beyond policy, even while recently reviewed", () => {
    const value = fixture(); value.expires_at = "2099-01-01T00:00:00Z";
    expect(evaluateSourceReview(resign(value), current).sources).toEqual([]);
  });
  it("does not issue a claim receipt with excessive claim TTL", () => {
    const value = fixture(); value.claims.find(row => row.claim_id === "stat-2")!.expires_at = "2099-01-01T00:00:00Z";
    const claim = value.claims.find(row => row.claim_id === "stat-2")!;
    expect(evaluateSourceReview(resign(value), current).sources.every(row => !row.supported_claim_sha256.includes(claim.claim_sha256))).toBe(true);
  });
  it.each(["stat-1", "cause-1", "cause-2", "cause-3", "cause-4", "cause-5", "cause-6", "cause-7"])("cannot promote %s by clearing gaps and recomputing the bundle digest", claimId => {
    const value = fixture();
    const claim = value.claims.find(row => row.claim_id === claimId)!;
    claim.status = "SUPPORTED"; claim.gaps = [];
    expect(() => evaluateSourceReview(resign(value), current)).toThrow(/support mismatch/);
  });
  it.each(["unknown_url", "changed_final_path", "unknown_source", "missing_supplement", "duplicate_supplement", "changed_capture", "changed_capture_date", "changed_bytes", "unbound_supplement", "wrong_claim_supplement", "lost_claim_supplement", "dropped_finding", "downgraded_finding", "lost_finding_capture"])("rejects supplemental mutation %s even after rehashing", mutation => {
    const value = fixture();
    const supplement = value.supplemental_sources![0];
    const stat = value.claims.find(row => row.claim_id === "stat-3")!;
    const conflict = value.findings.find(row => row.finding_id === "unknown-equipment-breaker-reset-conflict")!;
    if (mutation === "unknown_url") supplement.url = "https://www.trane.com/residential/en/unreviewed/";
    if (mutation === "changed_final_path") supplement.final_url += "?changed=1";
    if (mutation === "unknown_source") supplement.source_id = "new-unreviewed-source";
    if (mutation === "missing_supplement") delete value.supplemental_sources;
    if (mutation === "duplicate_supplement") value.supplemental_sources!.push(supplement);
    if (mutation === "changed_capture") {
      supplement.content_sha256 = "a".repeat(64);
      stat.source_captures.find(row => row.source_id === supplement.source_id)!.content_sha256 = supplement.content_sha256;
    }
    if (mutation === "changed_capture_date") supplement.captured_at = "2026-09-06T16:41:00.000Z";
    if (mutation === "changed_bytes") supplement.content_bytes++;
    if (mutation === "unbound_supplement") {
      const claim = value.claims.find(row => row.claim_id === "cause-1")!;
      claim.status = "SUPPORTED"; claim.gaps = [];
      claim.source_captures.push({ source_id: supplement.source_id, content_sha256: supplement.content_sha256 });
    }
    if (mutation === "wrong_claim_supplement") value.claims[0].source_captures.push({ source_id: supplement.source_id, content_sha256: supplement.content_sha256 });
    if (mutation === "lost_claim_supplement") stat.source_captures.pop();
    if (mutation === "dropped_finding") value.findings.pop();
    if (mutation === "downgraded_finding") conflict.severity = "NONBLOCKING";
    if (mutation === "lost_finding_capture") conflict.source_captures!.pop();
    expect(() => evaluateSourceReview(resign(value), current)).toThrow();
  });
  it("requires a new reviewed approval when a formerly supporting base capture changes coherently", () => {
    const value = fixture();
    value.sources.find(row => row.source_id === "src-6")!.content_sha256 = "a".repeat(64);
    value.claims.find(row => row.claim_id === "stat-3")!.source_captures[0].content_sha256 = "a".repeat(64);
    expect(() => evaluateSourceReview(resign(value), current)).toThrow(/support mismatch/);
  });
  it("withdraws all composite claim receipts when one required capture is too old", () => {
    const value = fixture();
    value.sources.find(row => row.source_id === "src-6")!.captured_at = "2026-01-01T00:00:00Z";
    const review = evaluateSourceReview(resign(value), current);
    const claim = review.claims.find(row => row.claim_id === "stat-3")!;
    expect(claim.current).toBe(false);
    expect(review.sources.find(row => row.source_id === "sup-trane-frozen-causes")!.supported_claim_sha256).toEqual([]);
    expect(review.sources.some(row => row.supported_claim_sha256.includes(claim.claim_sha256))).toBe(false);
  });
  it("publishes only explicit provenance fields, with no raw captures or runtime data", async () => {
    vi.useFakeTimers(); vi.setSystemTime(current);
    const result = GET();
    expect(result.status).toBe(200);
    expect(result.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(result.headers.get("cache-control")).toBe("no-store");
    const data = await result.json();
    expect(data).toEqual(publicSourceReview(current));
    expect(data.full_release_approved).toBe(false);
    expect(data.capability_claims).toHaveLength(9);
    expect(data.claims.find((row: { claim_id: string }) => row.claim_id === "stat-2").display_value).toBe("$200–$1,500");
    expect(data.claims.filter((row: { support_status: string }) => row.support_status === "SUPPORTED")).toHaveLength(2);
    expect(data.sources).toHaveLength(14);
    expect(data.sources.find((row: { source_id: string }) => row.source_id === "src-7").url).toBe("https://www.trane.com/residential/en/resources/troubleshooting/air-conditioners/evaporator-coil-is-frozen/");
    expect(data.sources.find((row: { source_id: string }) => row.source_id === "sup-trane-frozen-causes")).toMatchObject({
      binding_role: "SUPPLEMENTAL_REVIEW_SOURCE", publisher: "Trane",
      url: "https://www.trane.com/residential/en/resources/blog/frozen-evaporator-coil-causes/",
      content_sha256: "9cecca766f13e3007a8d1b82a5716d16f52b4066904efc3ed6594efec94811b9",
    });
    expect(data.claims.find((row: { claim_id: string }) => row.claim_id === "stat-3")).toMatchObject({
      frozen_source_ids: ["src-6"], supplemental_source_ids: ["sup-trane-frozen-causes"],
      source_ids: ["src-6", "sup-trane-frozen-causes"], current: true,
    });
    expect(data.findings.find((row: { finding_id: string }) => row.finding_id === "unknown-equipment-breaker-reset-conflict").source_captures).toHaveLength(2);
    expect(JSON.stringify(data)).not.toMatch(/raw_local|raw-local-only|C:\\|"(?:customer|reviewer|content_bytes|secret)":/);
  });
});
