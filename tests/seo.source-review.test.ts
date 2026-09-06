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
  it("admits eleven dated captures but only the one fully supported exact claim", () => {
    const review = evaluateSourceReview(fixture(), current);
    expect(review.sources).toHaveLength(11);
    expect(review.sources.filter(row => row.supported_claim_sha256.length)).toEqual([
      expect.objectContaining({ source_id: "src-5", supported_claim_sha256: [review.bundle.claims.find(row => row.claim_id === "stat-2")!.claim_sha256] }),
    ]);
    expect(review.claims.filter(row => row.status === "PARTIALLY_SUPPORTED")).toHaveLength(6);
    expect(review.claims.filter(row => row.status === "UNBOUND")).toHaveLength(3);
    expect(review.bundle.findings).toHaveLength(3);
  });
  it("invalidates old captures after expiry without erasing historical review or gaps", () => {
    const review = evaluateSourceReview(fixture(), new Date("2026-12-06T00:00:00Z"));
    expect(review.sources).toEqual([]);
    expect(review.claims.every(row => !row.current)).toBe(true);
    expect(review.bundle.findings).toHaveLength(3);
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
    expect(evaluateSourceReview(resign(value), current).sources.every(row => !row.supported_claim_sha256.length)).toBe(true);
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
    expect(data.claims.filter((row: { support_status: string }) => row.support_status === "SUPPORTED")).toHaveLength(1);
    expect(JSON.stringify(data)).not.toMatch(/raw_local|raw-local-only|C:\\|"(?:customer|reviewer|content_bytes|secret)":/);
  });
});
