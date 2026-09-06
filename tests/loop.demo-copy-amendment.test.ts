import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import receipt from "../config/ac-door-demo-copy-amendment.json";
import assets from "../config/ac-door-assets.json";
import { reviewV43CopyAmendment } from "@/domain/search/door-template-amendment";
import { adaptDoorMetadata } from "@/platform/pages/door-metadata";
import { GET as canonical } from "@/app/problems/ac-blowing-warm-air/route";
import { GET as alias } from "@/app/ac-blowing-warm-air/route";

const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const read = (path: string) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");
const source = () => read(receipt.result.source_path);
const original = () => read(receipt.base.reference_path);
const sections = (html: string) => [...html.matchAll(/<section\b[^>]*>/g)].map(row => row[0]);
const styles = (html: string) => [...html.matchAll(/<style\b[^>]*>[\s\S]*?<\/style>/g)].map(row => row[0]);
const scripts = (html: string) => [...html.matchAll(/<script(?![^>]*application\/ld\+json)\b[^>]*>[\s\S]*?<\/script>/g)].map(row => row[0]);

describe("served v43 demo copy derivative", () => {
  it("derives exactly from the independently retained tracked demo and approved replacement counts", () => {
    const { receipt_sha256, ...payload } = receipt;
    expect(receipt_sha256).toBe("529412062ef537bd426aa3b83766c0f30403a3702b54ac0c3fd3f0ce4dff8e00");
    expect(sha(JSON.stringify(payload))).toBe(receipt_sha256);
    let result = original();
    expect(sha(result)).toBe("f3dcd40e9bb998e273cad4f3c7e7243aa0e05098eccd81c992fff8eb72bf3784");
    expect(createHash("sha1").update("blob " + Buffer.byteLength(result) + "\0").update(result).digest("hex")).toBe(receipt.base.git_blob);
    const amendment = reviewV43CopyAmendment();
    expect(receipt.amendment_sha256).toBe(amendment.amendment_sha256);
    expect(receipt.replacements).toEqual(amendment.replacements.map(row => ({ id: row.id, ...row.rendered })));
    for (const row of [...receipt.replacements, receipt.date_replacement]) {
      expect(result.split(row.from).length - 1).toBe(row.count);
      result = result.split(row.from).join(row.to);
    }
    expect(result).toBe(source());
    expect(sha(result)).toBe("b85cd59d508181bdab4c6f0ec66778eb7cdc610e6a23a2501742624d2c1def60");
    expect(assets.source_sha256_lf).toBe(receipt.result.source_sha256_lf);
    expect(assets.source_modified_at).toBe(receipt.source_modified_at);
    expect(assets.source_amendment.receipt_sha256).toBe(receipt_sha256);
  });

  it("preserves every section, demo form attribution, styles and anchor scripts", () => {
    const before = original(), after = source();
    expect(receipt.preserved.logical_section_order).toEqual(reviewV43CopyAmendment().result.section_order);
    expect(receipt.preserved.logical_section_order).toHaveLength(15);
    expect(sections(after)).toEqual(sections(before));
    expect(sha(JSON.stringify(sections(after)))).toBe(receipt.preserved.section_tags_sha256);
    expect(styles(after)).toEqual(styles(before));
    expect(scripts(after)).toEqual(scripts(before));
    const form = after.match(/<form\b[\s\S]*?<\/form>/)![0];
    expect(form).toBe(before.match(/<form\b[\s\S]*?<\/form>/)![0]);
    expect(sha(form)).toBe(receipt.preserved.form_sha256);
    expect(form).toContain('name="search_opportunity_id" value="so_ac_blowing_warm_air"');
    expect(form).toContain('name="problem_family_hint" value="hvac-cooling"');
  });

  it.each(["canonical", "alias"])("serves the amended cross-surface copy with honest dates and noindex through %s", async route => {
    const path = route === "canonical" ? "/problems/ac-blowing-warm-air" : "/ac-blowing-warm-air";
    const response = await (route === "canonical" ? canonical : alias)(new Request("https://preview.invalid" + path));
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(html).toContain('content="noindex,nofollow"');
    expect(html).toContain('href="https://preview.invalid/problems/ac-blowing-warm-air"');
    expect(html).toContain('"dateModified": "2026-09-06"');
    expect(html).toContain("Leave a tripped breaker off; call for service.");
    expect(html).toContain("Check the price for your filter size and type.");
    expect(html).toContain("No visible ice; keep checking the cause.");
    expect(html).toContain("If warm air persists after the safe checks, switch cooling off and arrange service.");
    expect(html).not.toContain("Safe to keep running for now");
    expect(html).not.toContain("cooling may keep running while a visit is arranged");
    expect(html).not.toContain("$15 to $40");
    expect(html).not.toContain("we publish the narrower");
    const graph = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)![1]);
    const page = graph["@graph"].find((row: Record<string, unknown>) => row["@type"] === "WebPage");
    expect(page.image[0].description).toContain("there is no visible ice and to keep checking the cause");
    expect(page.image[0].contentUrl).toBe("https://preview.invalid" + assets.assets[0].png);
  });

  it("does not accept the original or a changed derivative under the new source-version receipt", () => {
    expect(() => adaptDoorMetadata(original(), "https://preview.invalid")).toThrow(/source-version receipt/);
    expect(() => adaptDoorMetadata(source().replace("Leave a tripped breaker off", "Reset the breaker"), "https://preview.invalid")).toThrow(/source-version receipt/);
  });
});
