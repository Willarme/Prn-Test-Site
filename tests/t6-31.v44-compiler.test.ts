import { describe, expect, it, vi } from "vitest";
import { compileDoorV44Page, doorV44IntentReviewHash } from "@/domain/search/door-v44/compiler";
import type { DoorV44CompilerContext } from "@/domain/search/door-v44/compiler-types";
import type { DoorV44Spec } from "@/domain/search/door-v44/types";
import { compilerFixture } from "./fixtures/door-v44/compiler-fixture";

async function build(name = "f04") { const input = await compilerFixture(name); return { ...input, result: await compileDoorV44Page(input.spec, input.context) }; }
async function rejected(mutate: (spec: DoorV44Spec, context: DoorV44CompilerContext) => void, code: string) {
  const { spec, context } = await compilerFixture(); mutate(spec, context);
  const result = await compileDoorV44Page(spec, context);
  expect(result.ok, JSON.stringify(result)).toBe(false);
  if (result.ok) throw new Error("Expected rejection");
  expect(result.errors.some(error => error.code === code), JSON.stringify(result.errors)).toBe(true);
  expect(JSON.stringify(result)).not.toContain("PRIVATE_MARKER");
  return result;
}
describe("v44 compiler from validated specification to deterministic HTML and asset receipt", () => {
  it.each(["f04", "f08"])("compiles %s into complete semantic sections without claiming release", async name => {
    const { spec, result } = await build(name);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;
    expect(result.receipt.section_order[0]).toBe("HERO");
    expect(result.receipt.section_order.at(-1)).toBe("CLOSER");
    expect(result.receipt.section_order).not.toContain("RELATED");
    expect(result.html).not.toContain('data-section="RELATED"');
    expect(result.html).toContain('data-section="INTAKE"');
    expect(result.html).toContain('action="/api/intake/start"');
    expect(result.html).toContain('name="problem_description"');
    expect(result.html).not.toContain('type="file"');
    expect(result.html).not.toContain("fixture_intent_review");
    expect(result.receipt.derived_counts.visuals).toBe(spec.visuals.length);
    expect(result.receipt.release_ready).toBe(false);
    expect(result.receipt.date_modified).toBeNull();
    expect(result.html).not.toContain("dateModified");
    expect(result.assets).toHaveLength(spec.visuals.length);
    expect(result.assets.every(asset => result.html.includes(asset.url))).toBe(true);
    expect(result.html).toContain(name === "f04" ? "Start with MY DISHWASHER" : "Start with THIS PROBLEM");
    if (name === "f08") expect(result.html).not.toContain("MY AC");
  });
  it("does not mutate inputs or use the wall clock/network", async () => {
    const { spec, context } = await compilerFixture();
    const before = JSON.stringify({ spec, context });
    const freeze = (value: unknown) => { if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } };
    freeze(spec); freeze(context);
    const clock = vi.spyOn(Date, "now").mockImplementation(() => { throw new Error("No clock"); });
    const network = vi.spyOn(globalThis, "fetch").mockImplementation(() => { throw new Error("No network"); });
    try {
      const first = await compileDoorV44Page(spec, context); const second = await compileDoorV44Page(spec, context);
      expect(first.ok, JSON.stringify(first)).toBe(true); expect(second).toEqual(first);
      expect(JSON.stringify({ spec, context })).toBe(before); expect(network).not.toHaveBeenCalled();
    } finally { clock.mockRestore(); network.mockRestore(); }
  });
  it("ignores object insertion order while preserving visible array order", async () => {
    const { spec, context, result } = await build();
    const reverse = (value: unknown): unknown => Array.isArray(value) ? value.map(reverse) : value && typeof value === "object"
      ? Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reverse(item)])) : value;
    expect(await compileDoorV44Page(reverse(spec), reverse(context) as DoorV44CompilerContext)).toEqual(result);
    spec.sections.hero.value_rows.reverse();
    const reordered = await compileDoorV44Page(spec, context);
    expect(reordered.ok, JSON.stringify(reordered)).toBe(true);
    if (result.ok && reordered.ok) expect(reordered.receipt.semantic_hash).not.toBe(result.receipt.semantic_hash);
  });
  it("takes source URLs only from resolved reviewed records and closes JSON-LD with the visible ledger", async () => {
    const { result } = await build(); expect(result.ok).toBe(true); if (!result.ok) return;
    const graph = result.document.structured_data[0]["@graph"] as Record<string, unknown>[];
    expect(graph[0].citation).toEqual(["https://fixture.example/manual"]);
    expect(result.html).toContain('href="https://fixture.example/manual"');
    expect(result.html).toContain('id="source-fixture.source.manual"');
    expect(result.receipt.source_ids).toEqual(["fixture.source.manual"]);
  });
  it("selects the social image by role, including when that image is last", async () => {
    const { spec, context } = await compilerFixture();
    spec.visuals.reverse();
    const result = await compileDoorV44Page(spec, context);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (result.ok) expect(result.document.social_image?.alt).toBe(spec.visuals.find(row => row.role === "decision_observation")!.alt);
  });
  it("derives counts after a legitimate row-count change", async () => {
    const { spec, context } = await compilerFixture();
    spec.sections.observations.rows.push({ ...spec.sections.observations.rows[0], id: "fixture.observation.extra" });
    const result = await compileDoorV44Page(spec, context); expect(result.ok, JSON.stringify(result)).toBe(true);
    if (result.ok) expect(result.html).toContain(`data-count="${spec.sections.observations.rows.length}" data-metric-slot="observations">${spec.sections.observations.rows.length}</span>`);
  });
  it("resolves two live RELATED siblings immediately before CLOSER", async () => {
    const { spec, context } = await compilerFixture();
    spec.layout.conditional_sections.related = true;
    spec.related_page_ids = ["fixture.sibling.first", "fixture.sibling.second"];
    spec.sections.related = { links: spec.related_page_ids.map((page_id, i) => ({ page_id, label: i ? "A separate sound" : "A separate leak" })) };
    context.validation.pages.push(...spec.related_page_ids.map((page_id, i) => ({ page_id, tenant_id: spec.identity.tenant_id,
      canonical_path: i ? "/problems/dishwasher-sound" : "/problems/dishwasher-leak", family_id: spec.identity.family_id, live: true, redirect_to: null })));
    const result = await compileDoorV44Page(spec, context); expect(result.ok, JSON.stringify(result)).toBe(true);
    if (result.ok) { expect(result.receipt.section_order.slice(-2)).toEqual(["RELATED", "CLOSER"]); expect(result.html).toContain('href="/problems/dishwasher-leak"'); }
    context.validation.pages.at(-1)!.live = false;
    expect((await compileDoorV44Page(spec, context)).ok).toBe(false);
  });
  it("renders only the media control supported by its exact current capability", async () => {
    const { spec, context } = await compilerFixture();
    spec.intake.media_controls = [{ kind: "photo", capability_id: "home_problem_analyzer" }];
    spec.layout.conditional_sections.media_controls = true;
    context.validation.capabilities.find(row => row.capability_id === "home_problem_analyzer")!.media_kinds = ["photo"];
    const result = await compileDoorV44Page(spec, context); expect(result.ok, JSON.stringify(result)).toBe(true);
    if (result.ok) { expect(result.html).toContain('name="photos"'); expect(result.html).not.toContain('name="voice_note"'); expect(result.html).toContain("Choose photos"); }
    spec.intake.media_controls[0].kind = "audio";
    expect((await compileDoorV44Page(spec, context)).ok).toBe(false);
  });
  it("omits a HIDDEN capability row and its copy", async () => {
    const { spec, context } = await compilerFixture();
    spec.sections.capability.rows.unshift({ ...spec.sections.capability.rows[0], id: "fixture.capability.extra" });
    const capability = spec.capabilities.at(-1)!; capability.live_status = "HIDDEN";
    context.validation.capabilities.find(row => row.capability_id === capability.capability_id)!.live_status = "HIDDEN";
    spec.sections.capability.rows.at(-1)!.tells = "This hidden feature sentence must be absent.";
    const result = await compileDoorV44Page(spec, context); expect(result.ok, JSON.stringify(result)).toBe(true);
    if (result.ok) expect(result.html).not.toContain("This hidden feature sentence");
  });
  it("projects paragraph headings to valid inline markup", async () => {
    const { spec, context } = await compilerFixture();
    spec.sections.hero.h1 = [{ type: "paragraph", children: spec.sections.hero.h1 }];
    spec.sections.faq.heading = [{ type: "paragraph", children: spec.sections.faq.heading }];
    context.intent_review.content_hash = doorV44IntentReviewHash(spec);
    const result = await compileDoorV44Page(spec, context); expect(result.ok, JSON.stringify(result)).toBe(true);
    if (result.ok) { expect(result.html).toContain("<h1><span>"); expect(result.html).not.toContain("<h1><p>"); }
  });
});
describe("compiler rejection boundaries", () => {
  it("requires the actual intake capability", () => rejected((spec, context) => {
    spec.capabilities[0].capability_id = "fixture.capability.0"; spec.sections.capability.rows[0].capability_id = "fixture.capability.0";
    context.validation.capabilities.find(row => row.capability_id === "home_problem_analyzer")!.capability_id = "fixture.capability.0";
  }, "INTAKE_CAPABILITY_UNVERIFIED"));
  it("binds intent review to the current title and answer", () => rejected(spec => { spec.head.page.title = "A different decision for this dishwasher"; }, "INTENT_REVIEW_MISMATCH"));
  it("rejects a source redirect instead of quietly using a new URL", () => rejected((_spec, context) => { context.source_records[0].canonical_url = "https://fixture.example/new"; }, "SOURCE_RECORD_INVALID"));
  it("rejects stale URL verification", () => rejected((_spec, context) => { context.source_records[0].expires_at = "2026-09-13T12:00:00.000Z"; }, "SOURCE_RECORD_INVALID"));
  it("rejects executable source URLs", () => rejected((_spec, context) => { context.source_records[0].url = "javascript:PRIVATE_MARKER"; }, "SOURCE_RECORD_INVALID"));
  it("requires every numeric provenance field", () => rejected((_spec, context) => { context.fact_records[0].denominator = ""; }, "FACT_PROVENANCE_MISSING"));
  it("rejects a made-up number in otherwise valid prose", () => rejected(spec => { spec.sections.closer.body = "This applies to 99 percent of households."; }, "NUMERIC_PROVENANCE_MISSING"));
  it("rejects fact labels not present in the reviewed record", () => rejected(spec => { spec.sections.stats.cards[0].value = [{ type: "fact_ref", claim_id: spec.claims[0].claim_id, label: "99%" }]; }, "FACT_LABEL_MISMATCH"));
  it("rejects a manually entered heading count", () => rejected(spec => { spec.sections.observations.heading = [{ type: "text", value: "99 observations" }]; }, "NUMERIC_PROVENANCE_MISSING"));
  it("checks actual image bytes", () => rejected((_spec, context) => { context.asset_records[0].raster_base64 = Buffer.from("PRIVATE_MARKER").toString("base64"); }, "IMAGE_HASH_MISMATCH"));
  it("checks dimensions against decoded bytes", () => rejected((spec, context) => {
    spec.visuals[0].width += 1; context.validation.visual_assets.find(row => row.asset_id === spec.visuals[0].asset_id)!.width += 1;
  }, "IMAGE_METADATA_MISMATCH"));
  it("checks active disclosure bytes independently of its short identity", () => rejected((_spec, context) => { context.disclosure_text += "PRIVATE_MARKER"; }, "COMPILER_CONTEXT_INVALID"));
  it("rejects unknown top-level compiler inputs", () => rejected((_spec, context) => { Object.assign(context, { PRIVATE_MARKER: true }); }, "COMPILER_CONTEXT_INVALID"));
  it("never invokes a supplied getter", async () => {
    const { spec, context } = await compilerFixture(); const getter = vi.fn(); Object.defineProperty(context.site, "name", { enumerable: true, get: getter });
    const result = await compileDoorV44Page(spec, context); expect(result.ok).toBe(false); expect(getter).not.toHaveBeenCalled();
  });
  it("rejects malformed trusted fields without throwing private content", () => rejected((_spec, context) => {
    Object.assign(context.source_records[0], { title: { PRIVATE_MARKER: true } });
  }, "COMPILER_INPUT_INVALID"));
  it("does not let a fresh semantic receipt exempt new unsupported numeric prose", () => rejected((spec, context) => {
    spec.sections.hero.h1 = [{ type: "text", value: "99 ways to fix a dishwasher" }]; context.intent_review.content_hash = doorV44IntentReviewHash(spec);
  }, "NUMERIC_PROVENANCE_MISSING"));
  it("rejects a model ID collision with the fixed intake/hero contract", () => rejected(spec => {
    spec.sections.hero.value_rows[0].id = "hero";
  }, "RENDER_ELEMENT_INVALID"));
});
describe("approved visible date provenance", () => {
  it("requires all present visible components, then emits the exact maximum approved timestamp", async () => {
    const { spec, context, result } = await build(); expect(result.ok, JSON.stringify(result)).toBe(true); if (!result.ok) return;
    const approved = "2026-09-12T12:00:00.000Z";
    context.visible_approvals = result.receipt.visible_components.map(row => ({ ...row, approved_at: approved }));
    spec.release.approved_content_at = approved; context.validation.approved_content_at = approved;
    const next = await compileDoorV44Page(spec, context); expect(next.ok, JSON.stringify(next)).toBe(true);
    if (next.ok) { expect(next.receipt.date_modified).toBe(approved); expect(next.html).toContain('datetime="' + approved + '"'); }
    spec.identity.page_version += 1;
    const newIdentity = await compileDoorV44Page(spec, context); expect(newIdentity.ok, JSON.stringify(newIdentity)).toBe(true);
    if (newIdentity.ok) expect(newIdentity.receipt.date_modified).toBe(approved);
    spec.sections.closer.body = "A changed visible sentence requires a new review.";
    const changed = await compileDoorV44Page(spec, context); expect(changed.ok).toBe(false);
    if (!changed.ok) expect(changed.errors.some(error => error.code === "VISIBLE_APPROVAL_MISMATCH")).toBe(true);
  });
  it("does not use a build date as an approved content date", () => rejected((spec, context) => {
    spec.release.approved_content_at = "2026-09-13T12:00:00.000Z"; context.validation.approved_content_at = spec.release.approved_content_at;
  }, "VISIBLE_APPROVAL_MISSING"));
});
