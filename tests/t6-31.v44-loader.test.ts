import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { loadDoorV44Spec } from "@/domain/search/door-v44/loader";
import type { DoorV44Spec, DoorV44ValidationContext, DoorV44RichNode } from "@/domain/search/door-v44/types";

// Guide §15.1–15.4 input boundaries. These synthetic contracts prove neither
// production evidence nor compiler, rendering, publication or human approval.
const directory = join(process.cwd(), "tests/fixtures/door-v44/contracts");
function json(path: string): unknown { return JSON.parse(readFileSync(path, "utf8")); }
function schemas(directory: string): unknown[] {
  return readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? schemas(path) : entry.name.endsWith(".json") ? [json(path)] : [];
  });
}
const schemaBundle = schemas(join(process.cwd(), "content/door-template/v44/schemas"));
function fixture(name = "f04"): { spec: DoorV44Spec; context: DoorV44ValidationContext } {
  return { spec: json(join(directory, `${name}.json`)) as DoorV44Spec,
    context: { ...json(join(directory, "context.json")) as DoorV44ValidationContext, schema_bundle: structuredClone(schemaBundle) } };
}
function freeze(value: unknown): void {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
}
function reverseKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reverseKeys(item)]));
  return value;
}
function rejected(raw: unknown, context: DoorV44ValidationContext, pointer?: string) {
  const result = loadDoorV44Spec(raw, context);
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Invalid fixture was accepted");
  expect(result.errors.length).toBeGreaterThan(0);
  for (const error of result.errors) {
    expect(Object.keys(error).sort()).toEqual(["code", "pointer"]);
    expect(error.code).toMatch(/^[A-Z][A-Z0-9_]+$/);
    expect(error.pointer).toMatch(/^(?:\/|$)/);
  }
  expect(result).toEqual(loadDoorV44Spec(raw, context));
  if (pointer) expect(result.errors.some(error => error.pointer.startsWith(pointer)), JSON.stringify(result.errors)).toBe(true);
  return result;
}

describe("synthetic v44 loader contracts", () => {
  it.each(["f04", "f08"])("accepts %s without altering its inputs or claiming release", name => {
    const { spec, context } = fixture(name);
    const before = JSON.stringify({ spec, context });
    freeze(spec); freeze(context);
    const result = loadDoorV44Spec(spec, context);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) throw new Error("Valid contract refused");
    expect(result.spec).toEqual(spec);
    expect(Object.keys(result).sort()).toEqual(["input_hashes", "ok", "spec"]);
    expect(Object.values(result.input_hashes).length).toBeGreaterThan(0);
    expect(Object.values(result.input_hashes).every(hash => /^[a-f0-9]{64}$/i.test(hash))).toBe(true);
    expect(JSON.stringify({ spec, context })).toBe(before);
  });
  it("keeps nameplate-free F08 distinct from the appliance fixture", () => {
    const { spec } = fixture("f08");
    expect(spec.subject.subject_kind).toBe("current_problem");
    expect(spec.intake.prompts[1].evidence_type).toBe("location_material");
    expect(spec.sections.job_packet.example_rows.some(row => row.key === "location_material" && row.value.trim())).toBe(true);
    expect(spec.layout.conditional_sections.nameplate_help).toBe(false);
  });
  it("uses semantic object order and preserves visible array order", () => {
    const { spec, context } = fixture();
    const initial = loadDoorV44Spec(spec, context);
    expect(initial.ok).toBe(true);
    expect(loadDoorV44Spec(reverseKeys(spec), reverseKeys(context) as DoorV44ValidationContext)).toEqual(initial);
    const reordered = structuredClone(spec);
    reordered.sections.hero.value_rows.reverse();
    const result = loadDoorV44Spec(reordered, context);
    expect(result.ok).toBe(true);
    if (initial.ok && result.ok) expect(result.input_hashes).not.toEqual(initial.input_hashes);
  });
  it("does not read the wall clock or global network during validation", () => {
    const { spec, context } = fixture();
    const date = vi.spyOn(Date, "now").mockImplementation(() => { throw new Error("Clock not injected"); });
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(() => { throw new Error("Network forbidden"); });
    try { expect(loadDoorV44Spec(spec, context).ok).toBe(true); expect(fetch).not.toHaveBeenCalled(); }
    finally { date.mockRestore(); fetch.mockRestore(); }
  });
});

describe("untrusted object and diagnostic boundary", () => {
  it.each([undefined, null, true, 1, "{}", [], NaN, Infinity, new Date(0)])("refuses non-document input %s", raw => {
    rejected(raw, fixture().context);
  });
  it.each(["__proto__", "constructor", "prototype"])("refuses the poisoned key %s without pollution", key => {
    const { spec, context } = fixture();
    Object.defineProperty(spec.sections.hero, key, { enumerable: true, value: { polluted: true } });
    rejected(spec, context);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
  it("refuses accessors without evaluating them", () => {
    const { spec, context } = fixture();
    const get = vi.fn(() => { throw new Error("PRIVATE_GETTER_CONTENT"); });
    Object.defineProperty(spec.sections.hero, "private", { enumerable: true, get });
    const result = rejected(spec, context);
    expect(get).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("PRIVATE_GETTER_CONTENT");
  });
  it("refuses cycles, inherited behavior, sparse arrays and symbol properties", () => {
    for (const poison of [
      (spec: DoorV44Spec) => { (spec as unknown as Record<string, unknown>).cycle = spec; },
      (spec: DoorV44Spec) => { Object.setPrototypeOf(spec.subject, { untrusted: true }); },
      (spec: DoorV44Spec) => { delete spec.sections.hero.value_rows[0]; },
      (spec: DoorV44Spec) => { Object.defineProperty(spec.subject, Symbol("hidden"), { value: true }); },
    ]) { const { spec, context } = fixture(); poison(spec); rejected(spec, context); }
  });
  it("returns only safe diagnostics for private keys and executable content", () => {
    const { spec, context } = fixture();
    const privateText = "PRIVATE_CUSTOMER_https://private.example/customer-email";
    Object.defineProperty(spec.sections.hero, privateText, { enumerable: true, value: privateText });
    const result = rejected(spec, context, "/sections/hero");
    expect(JSON.stringify(result)).not.toContain(privateText);
  });
});

type Mutation = (spec: DoorV44Spec, context: DoorV44ValidationContext) => void;
const cases: Array<[string, Mutation, { code: string; pointer: string }?]> = [
  ["tenant mismatch", spec => { spec.identity.tenant_id = "other_tenant"; }, { code: "IDENTITY_MISMATCH", pointer: "/identity/tenant_id" }],
  ["canonical path disagrees with slug", spec => { spec.identity.canonical_path = "/problems/different-intent"; }],
  ["intake attributes another page", spec => { spec.intake.attribution.page_id = "pg_other"; }],
  ["intake attributes another opportunity", spec => { spec.intake.attribution.search_opportunity_id = "opp_other"; }],
  ["intake attributes another landing path", spec => { spec.intake.attribution.landing_path = "/problems/different-intent"; }],
  ["template version mismatch", spec => { spec.versions.template = "door-v44.0.1"; }],
  ["theme version mismatch", spec => { spec.versions.theme = "door-v44-t02@1.0.0"; }],
  ["taxonomy version mismatch", spec => { spec.versions.taxonomy = "subject-taxonomy/99.0.0"; }],
  ["source bundle mismatch", spec => { spec.versions.source_bundle = "srcbundle_other"; }],
  ["unknown prompt identity", spec => { spec.versions.prompt_identities.push({ capability: "fixture.unknown", name: "unreviewed", version: "1.0.0", hash: "a".repeat(64) }); }],
  ["prompt hash mismatch", spec => { spec.versions.prompt_identities[0].hash = "f".repeat(64); }],
  ["model-authored origin", spec => { spec.head.site.origin = "https://unreviewed.example"; }],
  ["model-authored indexing policy", spec => { spec.release.index_policy = "public_indexable"; }],
  ["unapproved visible date", spec => { spec.release.approved_content_at = "2026-09-13T00:00:00Z"; }],
  ["disclosure id mismatch", spec => { spec.intake.disclosure.id = "disclosure_other"; }, { code: "DISCLOSURE_MISMATCH", pointer: "/intake/disclosure" }],
  ["disclosure hash mismatch", spec => { spec.intake.disclosure.content_hash = "f".repeat(64); }],
  ["subject grammar was rewritten", spec => { spec.subject.cta_label = "MY UNREVIEWED SUBJECT"; }],
  ["unknown action pattern", spec => { spec.actions.hero_start.pattern_id = "pattern_unreviewed"; }],
  ["unreviewed family", (spec, context) => { context.families.find(row => row.family_id === spec.identity.family_id)!.reviewed = false; }],
  ["missing protocol evidence", (spec, context) => { context.families.find(row => row.family_id === spec.identity.family_id)!.protocol_ids = []; }],
  ["missing hazard evidence", (spec, context) => { context.families.find(row => row.family_id === spec.identity.family_id)!.hazard_ids = []; }],
  ["missing eval evidence", (spec, context) => { context.families.find(row => row.family_id === spec.identity.family_id)!.eval_receipt_ids = []; }],
  ["unknown protocol check", spec => { spec.sections.safe_observations.checks[0].protocol_check_id = "fixture.check.missing"; }],
  ["unknown observation protocol check", spec => { spec.sections.observations.rows[0].protocol_check_id = "fixture.check.missing"; }],
  ["unreviewed eligibility receipt", spec => { spec.intent.page_eligibility_receipt = "fixture.eligibility.missing"; }],
  ["unknown source", spec => { spec.sources[0].source_id = "source_unreviewed"; }],
  ["unreviewed source", (spec, context) => { context.sources.find(row => row.source_id === spec.sources[0].source_id)!.reviewed = false; }],
  ["expired source", (spec, context) => { context.sources.find(row => row.source_id === spec.sources[0].source_id)!.expires_at = "2000-01-01T00:00:00Z"; }, { code: "SOURCE_EXPIRED", pointer: "/sources/0/source_id" }],
  ["claim hash mismatch", spec => { spec.claims[0].content_hash = "f".repeat(64); }],
  ["missing visible source ledger", spec => { spec.sources = []; }],
  ["missing claim registry", (_spec, context) => { context.claims = []; }],
  ["rich source reference outside visible ledger", spec => { spec.sections.hero.answer = [{ type: "source_ref", source_id: "fixture.source.missing", label: "Source" }]; }],
  ["rich fact reference outside claim bundle", spec => { spec.sections.hero.answer = [{ type: "fact_ref", claim_id: "fixture.claim.missing", label: "Observation" }]; }],
  ["duplicate stable FAQ id", spec => { spec.sections.faq.questions[1].id = spec.sections.faq.questions[0].id; }],
  ["missing capability registry", (_spec, context) => { context.capabilities = []; }],
  ["unverified capability advertised live", spec => { spec.capabilities[0].live_status = "VERIFIED_LIVE"; spec.capabilities[0].production_receipt = null; }],
  ["expired capability evidence", (spec, context) => { const id = spec.capabilities.find(row => row.live_status === "VERIFIED_LIVE")!.capability_id; context.capabilities.find(row => row.capability_id === id)!.expires_at = "2000-01-01T00:00:00Z"; }],
  ["future capability evidence", (spec, context) => { const id = spec.capabilities.find(row => row.live_status === "VERIFIED_LIVE")!.capability_id; context.capabilities.find(row => row.capability_id === id)!.verified_at = "2099-01-01T00:00:00Z"; }],
  ["unsupported media control", spec => { spec.intake.media_controls = [{ kind: "audio", capability_id: "capability_unknown" }]; spec.layout.conditional_sections.media_controls = true; }],
  ["audio borrowing an unrelated live capability", spec => { spec.intake.media_controls = [{ kind: "audio", capability_id: spec.capabilities.find(row => row.live_status === "VERIFIED_LIVE")!.capability_id }]; spec.layout.conditional_sections.media_controls = true; }],
  ["unknown visual asset", spec => { spec.visuals[0].asset_id = "fixture.asset.not_registered"; }],
  ["changed visual inline hash", spec => { spec.visuals[0].inline_hash = "f".repeat(64); }],
  ["changed visual raster hash", spec => { spec.visuals[0].raster_hash = "f".repeat(64); }],
  ["changed visual caption", spec => { spec.visuals[0].caption = [{ type: "text", value: "A different unreviewed caption." }]; }],
  ["changed visual dimensions", spec => { spec.visuals[0].width += 1; }],
  ["changed title and alt together", spec => { spec.visuals[0].title = "A different asset"; spec.visuals[0].alt = spec.visuals[0].title; }],
  ["unknown statistics icon", spec => { spec.sections.stats.cards[0].icon_id = "fixture.icon.not_registered"; }],
  ["unknown repair record icon", spec => { spec.sections.repair_record.cards[0].icon_id = "fixture.icon.not_registered"; }],
  ["empty mandatory stop sheet", spec => { spec.sections.safe_observations.stop_items = []; }],
  ["empty mandatory never sheet", spec => { spec.sections.safe_observations.never_items = []; }],
  ["fabricated local statistics", spec => { spec.layout.conditional_sections.local_stats = true; }],
  ["empty RELATED forced on", spec => { spec.layout.conditional_sections.related = true; spec.related_page_ids = []; delete spec.sections.related; }],
  ["raw executable markup in rich text", spec => { spec.sections.hero.h1 = [{ type: "text", value: "<script>alert(1)</script>" }]; }],
  ["consecutive rich-text whitespace", spec => { spec.sections.hero.h1 = [{ type: "text", value: "A  changed question?" }]; }],
  ["required heading containing only a line break", spec => { spec.sections.stats.heading = [{ type: "line_break" }]; }],
  ["consecutive explicit line breaks", spec => { spec.sections.stats.heading = [{ type: "text", value: "Visible heading" }, { type: "line_break" }, { type: "line_break" }, { type: "text", value: "Continued heading" }]; }],
  ["AST nesting above four", spec => { let node: DoorV44RichNode = { type: "text", value: "A question?" }; for (let n = 0; n < 5; n++) node = { type: "emphasis", children: [node] }; spec.sections.hero.h1 = [node]; }],
];
describe("cross-field and evidence preflight", () => {
  it.each(cases)("rejects %s", (_name, mutate, expected) => {
    const { spec, context } = fixture();
    expect(loadDoorV44Spec(spec, context).ok).toBe(true);
    mutate(spec, context);
    const result = rejected(spec, context);
    if (expected) expect(result.errors).toContainEqual(expected);
  });
  it("does not treat synthetic visual fixtures as live review evidence", () => {
    const { spec, context } = fixture();
    expect(spec.visuals.some(visual => visual.authored_status === "fixture")).toBe(true);
    context.mode = "live";
    rejected(spec, context);
  });
  it("refuses nameplate help when the reviewed subject is nameplate-free", () => {
    const { spec, context } = fixture("f08");
    expect(loadDoorV44Spec(spec, context).ok).toBe(true);
    spec.layout.conditional_sections.nameplate_help = true;
    rejected(spec, context);
  });
  it("permits a media kind only after matching synthetic capability evidence is explicitly supplied", () => {
    const { spec, context } = fixture();
    const id = spec.capabilities.find(row => row.live_status === "VERIFIED_LIVE")!.capability_id;
    const capability = context.capabilities.find(row => row.capability_id === id)!;
    expect(capability.media_kinds).not.toContain("audio");
    spec.intake.media_controls = [{ kind: "audio", capability_id: id }];
    spec.layout.conditional_sections.media_controls = true;
    rejected(spec, context);
    // This fixture-only injection is not evidence of a production audio feature.
    capability.media_kinds = ["audio"];
    expect(loadDoorV44Spec(spec, context).ok).toBe(true);
  });
  it("refuses a visual asset from another tenant", () => {
    const { spec, context } = fixture();
    expect(loadDoorV44Spec(spec, context).ok).toBe(true);
    context.visual_assets.find(asset => asset.asset_id === spec.visuals[0].asset_id)!.tenant_id = "other_tenant";
    rejected(spec, context);
  });
  it("preserves an intentional single break between meaningful heading text", () => {
    const { spec, context } = fixture();
    expect(loadDoorV44Spec(spec, context).ok).toBe(true);
    spec.sections.stats.heading = [{ type: "text", value: "Visible heading" }, { type: "line_break" }, { type: "text", value: "Continued heading" }];
    expect(loadDoorV44Spec(spec, context).ok).toBe(true);
  });
});

describe("RELATED registry closure", () => {
  function withRelated() {
    const { spec, context } = fixture();
    const page = { page_id: "fixture.related", tenant_id: spec.identity.tenant_id,
      canonical_path: "/problems/synthetic-related", family_id: spec.identity.family_id,
      live: true, redirect_to: null as string | null };
    context.pages.push(page);
    spec.related_page_ids = [page.page_id];
    spec.sections.related = { links: [{ page_id: page.page_id, label: "Synthetic related observation" }] };
    spec.layout.conditional_sections.related = true;
    return { spec, context, page };
  }
  it("accepts an explicitly supplied fixture sibling without fetching its URL", () => {
    const { spec, context } = withRelated();
    expect(loadDoorV44Spec(spec, context).ok).toBe(true);
  });
  it.each(["unpublished", "redirect", "other tenant", "other family", "self", "missing", "hidden module"])("rejects a %s related target", problem => {
    const { spec, context, page } = withRelated();
    expect(loadDoorV44Spec(spec, context).ok).toBe(true);
    if (problem === "unpublished") page.live = false;
    if (problem === "redirect") page.redirect_to = "/problems/elsewhere";
    if (problem === "other tenant") page.tenant_id = "other_tenant";
    if (problem === "other family") page.family_id = "other_family";
    if (problem === "self") { spec.related_page_ids = [spec.identity.page_id]; spec.sections.related!.links[0].page_id = spec.identity.page_id; }
    if (problem === "missing") context.pages = context.pages.filter(row => row !== page);
    if (problem === "hidden module") spec.layout.conditional_sections.related = false;
    rejected(spec, context);
  });
});
