import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import originalBinding from "../content/door-template/v43/binding.json";
import { amendV43Html, amendV43SourceAsset, getAmendedV43Binding, reviewV43CopyAmendment } from "@/domain/search/door-template-amendment";

const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const read = (path: string) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");
const originalHtml = () => read("content/door-template/v43/rendered.html");
const resign = (value: ReturnType<typeof reviewV43CopyAmendment>) => {
  const { amendment_sha256: _old, ...payload } = value;
  value.amendment_sha256 = sha(JSON.stringify(payload));
  return value;
};

describe("explicit approved v43 wording amendment", () => {
  it("preserves the base and every section while deriving the exact new binding, claims and HTML", () => {
    const review = reviewV43CopyAmendment();
    const original = JSON.stringify(originalBinding);
    const binding = getAmendedV43Binding();
    const html = amendV43Html(originalHtml());
    expect(JSON.stringify(originalBinding)).toBe(original);
    expect(binding.reference_sha256).toBe(originalBinding.reference_sha256);
    expect(binding.source_tree_sha256).toBe(originalBinding.source_tree_sha256);
    expect(binding.section_order).toEqual(originalBinding.section_order);
    expect(binding.sections).toHaveLength(15);
    expect(binding.capability_questions).toEqual(originalBinding.capability_questions);
    expect(binding.binding_sha256).toBe(review.result.binding_sha256);
    expect(sha(html)).toBe(review.result.rendered_sha256);
    for (const row of review.claims) expect(sha(binding.claim_bindings.find(claim => claim.claim_id === row.claim_id)!.text)).toBe(row.after_sha256);
    expect(originalHtml()).toContain("$15 to $40");
    expect(html).not.toContain("$15 to $40");
    expect(html).toContain("Leave a tripped breaker off; call for service.");
    expect(html).toContain("Company website assertions &middot; 4 U.S. markets");
    expect(html).toContain("$700–$2,500+");
    expect(html).not.toContain("we publish the narrower");
  });
  it("changes no styles, script behavior, forms or section structure", () => {
    const before = originalHtml();
    const after = amendV43Html(before);
    const styles = (html: string) => [...html.matchAll(/<style\b[^>]*>[\s\S]*?<\/style>/g)].map(row => row[0]);
    const scripts = (html: string) => [...html.matchAll(/<script(?![^>]*application\/ld\+json)\b[^>]*>[\s\S]*?<\/script>/g)].map(row => row[0]);
    const forms = (html: string) => html.match(/<form\b[\s\S]*?<\/form>/)?.[0];
    expect(styles(after)).toEqual(styles(before));
    expect(scripts(after)).toEqual(scripts(before));
    expect(forms(after)).toEqual(forms(before));
    expect([...after.matchAll(/<section\b[^>]*>/g)].map(row => row[0])).toEqual([...before.matchAll(/<section\b[^>]*>/g)].map(row => row[0]));
  });
  it("amends diagram label, accessible description and JSON-LD consistently without touching the source drawing", () => {
    const original = read("content/door-template/v43/spec/ac-blowing-warm-air/plates/ice-or-clear.svg");
    const amended = amendV43SourceAsset("plate-1", original);
    const html = amendV43Html(originalHtml());
    expect(amended).toContain("No visible ice; keep checking the cause.");
    expect(amended).not.toContain("cooling may keep running");
    expect(html).toContain(amended.trim());
    expect(html.match(/and the label says there is no visible ice and to keep checking the cause\./g)).toHaveLength(2);
    expect(original).toContain("Safe to keep running for now");
    expect(sha(amended)).toBe(reviewV43CopyAmendment().assets[0].amended_sha256);
    expect(() => amendV43SourceAsset("plate-1", original + " ")).toThrow(/exact original/);
  });
  it.each(["wording", "count", "date", "approval", "base", "result", "claims", "extra"])("rejects an unreviewed %s change even with a newly computed amendment digest", mutation => {
    const value = reviewV43CopyAmendment();
    if (mutation === "wording") value.replacements[0].rendered.to = "Guaranteed free repair";
    if (mutation === "count") value.replacements[0].rendered.count++;
    if (mutation === "date") value.source_modified_at = "2099-01-01T00:00:00Z";
    if (mutation === "approval") value.authorization.scope = "All claims approved";
    if (mutation === "base") value.base.binding_sha256 = "a".repeat(64);
    if (mutation === "result") value.result.rendered_sha256 = "a".repeat(64);
    if (mutation === "claims") value.claims[0].after_sha256 = "a".repeat(64);
    if (mutation === "extra") Object.assign(value, { arbitrary_model_override: true });
    expect(() => reviewV43CopyAmendment(resign(value))).toThrow(/Unreviewed/);
  });
  it("rejects altered base words and dates rather than silently rebaselining", () => {
    expect(() => amendV43Html(originalHtml().replace("$15 to $40", "$1 to $2"))).toThrow(/exact original/);
    const binding = structuredClone(originalBinding);
    binding.claim_bindings[0].text += " Guaranteed.";
    expect(() => getAmendedV43Binding(binding)).toThrow(/exact original/);
  });
});
