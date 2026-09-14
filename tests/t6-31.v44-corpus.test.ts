import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { compileDoorV44Page } from "@/domain/search/door-v44/compiler";
import type { DoorV44CompileResult } from "@/domain/search/door-v44/compiler-types";
import type { DoorV44Element } from "@/domain/search/door-v44/render-types";
import manifest from "./fixtures/door-v44/corpus/manifest.json";
import { compileCorpusFixture, corpusDefinitions, corpusFixture, preflightCorpusFixture, type CorpusFixture, type CorpusId } from "./fixtures/door-v44/corpus/corpus-fixture";

const fixtures = new Map<CorpusId, CorpusFixture>();
const compiled = new Map<CorpusId, Extract<DoorV44CompileResult, { ok: true }>>();
const digest = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const frozenManifestPath = "content/door-template/v44/inputs/manifest.json";
const frozenManifest = JSON.parse(readFileSync(frozenManifestPath, "utf8")) as { files: Array<{ path: string }> };
const protectedPaths = [frozenManifestPath, ...frozenManifest.files.map(row => row.path), "tests/fixtures/door-v44/compiler-fixture.ts",
  "tests/fixtures/door-v44/contracts/f04.json", "tests/fixtures/door-v44/contracts/f08.json", "tests/fixtures/door-v44/contracts/context.json"];
let before: string[];
function elements(node: DoorV44Element): DoorV44Element[] {
  return [node, ...(node.children ?? []).flatMap(child => typeof child === "string" ? [] : elements(child))];
}
function vector(result: Extract<DoorV44CompileResult, { ok: true }>) {
  const counts = result.receipt.derived_counts;
  const sections = result.document.body.flatMap(node => typeof node === "string" ? [] : elements(node)).filter(node => node.attrs?.["data-section"]);
  return { counts: [counts.observations, counts.causes, counts.safe_checks, counts.faq, counts.visuals],
    section_tint_profile: sections.map(section => ({ section: section.attrs?.["data-section"], classes: elements(section).flatMap(node => node.attrs?.class ? [node.attrs.class] : []) })) };
}
beforeAll(async () => {
  before = protectedPaths.map(digest);
  const network = vi.spyOn(globalThis, "fetch").mockImplementation(() => { throw new Error("Network is forbidden in synthetic corpus compilation"); });
  try {
    for (const definition of corpusDefinitions) {
      const input = await corpusFixture(definition.id);
      expect(preflightCorpusFixture(input).ok, definition.id).toBe(true);
      const result = await compileCorpusFixture(input);
      expect(result.ok, JSON.stringify({ id: definition.id, result })).toBe(true);
      if (!result.ok) throw new Error("Synthetic baseline failed");
      fixtures.set(definition.id, input); compiled.set(definition.id, result);
    }
    expect(network).not.toHaveBeenCalled();
  } finally { network.mockRestore(); }
}, 20000);
afterAll(() => { expect(protectedPaths.map(digest)).toEqual(before); });

describe("Guide section 18 F02-F11 synthetic compilation corpus", () => {
  it.each(corpusDefinitions)("compiles $id with its actual intent, sources, counts and action grammar", (definition) => {
    const input = fixtures.get(definition.id)!; const result = compiled.get(definition.id)!;
    expect(result.receipt).toMatchObject({ mode: "fixture", release_ready: false, date_modified: null });
    expect(result.html).toContain("noindex");
    expect(result.html).not.toContain("<style");
    expect(result.html).not.toContain("MY AC");
    expect(result.html).toContain(definition.focus);
    expect(result.html).toContain(definition.observations[0]);
    expect(result.html).toContain(definition.causes[0]);
    expect(result.html).toContain(definition.stop);
    expect(result.html).toContain(definition.kind === "current_problem" ? "Start with THIS PROBLEM" : "Start with MY " + definition.label.toUpperCase());
    expect(result.receipt.source_ids).toEqual(["fixture.source." + definition.id.toLowerCase()]);
    expect(input.context.validation.families[0].hazard_ids).toEqual(definition.hazards.map(hazard => `fixture.hazard.${definition.id.toLowerCase()}.${hazard}`));
    const countVector = vector(result).counts;
    expect(countVector).toEqual([definition.observations.length, definition.causes.length, definition.checks, definition.faq, definition.roles.length]);
    expect(manifest.fixtures.find(row => row.id === definition.id)?.count_vector).toEqual(countVector);
    for (const [key, count] of Object.entries(result.receipt.derived_counts)) {
      if (["observations", "causes", "safe_checks", "faq", "visuals"].includes(key)) expect(result.html).toContain(`data-count="${count}" data-metric-slot="${key}">${count}</span>`);
    }
    expect(result.assets).toHaveLength(definition.roles.length);
    expect(input.spec.visuals.map(row => row.role)).toEqual([...definition.roles]);
  });

  it("proves omission and presence from generated markup and typed packet fields", () => {
    let equipmentOmitted = 0, mediaOmitted = 0, relatedPresent = 0, relatedAbsent = 0;
    for (const definition of corpusDefinitions) {
      const { spec } = fixtures.get(definition.id)!; const result = compiled.get(definition.id)!;
      if (!definition.nameplate) {
        equipmentOmitted++;
        expect(spec.intake.prompts[1].evidence_type).toBe("location_material");
        expect(spec.sections.job_packet.example_rows.some(row => row.key === "equipment")).toBe(false);
        expect(spec.sections.job_packet.example_rows.find(row => row.key === "location_material")?.value.length).toBeGreaterThan(0);
        expect(result.html).not.toContain(">Equipment</dt>");
        expect(result.html).not.toContain("existing label description");
      }
      if (!definition.media) {
        mediaOmitted++; expect(result.html).not.toContain('type="file"'); expect(result.html).not.toContain("Choose photos");
      } else { expect(result.html).toContain('name="photos"'); expect(result.html).not.toContain('name="voice_note"'); }
      if (definition.related) {
        relatedPresent++; expect(result.receipt.section_order.slice(-2)).toEqual(["RELATED", "CLOSER"]);
        expect(spec.sections.related?.links).toHaveLength(2);
        for (const page of fixtures.get(definition.id)!.context.validation.pages.filter(row => spec.related_page_ids.includes(row.page_id))) expect(result.html).toContain(`href="${page.canonical_path}"`);
      } else { relatedAbsent++; expect(result.html).not.toContain('data-section="RELATED"'); }
    }
    expect(equipmentOmitted).toBeGreaterThanOrEqual(3); expect(mediaOmitted).toBeGreaterThanOrEqual(3);
    expect(relatedPresent).toBeGreaterThanOrEqual(2); expect(relatedAbsent).toBeGreaterThanOrEqual(2);
  });

  it("keeps all ten count-plus-rendered-class vectors unique without claiming theme or similarity acceptance", () => {
    const vectors = [...compiled.values()].map(vector);
    expect(new Set(vectors.map(value => JSON.stringify(value))).size).toBe(10);
    expect(new Set(vectors.map(value => value.counts.join(","))).size).toBe(10);
    for (const index of [0, 1, 2, 3, 4]) expect(new Set(vectors.map(value => value.counts[index])).size).toBeGreaterThanOrEqual(3);
    expect(manifest.release_ready).toBe(false);
    expect(manifest.h01_h18_status).toBe("NOT_EVALUATED");
  });

  it("shares the same governed constant values across every successful intent", () => {
    const constantValues = new Map<string, string>();
    for (const result of compiled.values()) for (const constant of result.receipt.constants) {
      if (constantValues.has(constant.key)) expect(constant.value).toBe(constantValues.get(constant.key));
      else constantValues.set(constant.key, constant.value);
    }
    expect(constantValues.size).toBeGreaterThan(40);
    expect(new Set([...compiled.values()].map(result => result.receipt.semantic_hash)).size).toBe(10);
    expect(new Set(corpusDefinitions.map(row => row.focus)).size).toBe(10);
  });

  it("reproduces each result after canonical JSON crosses LF/CRLF checkout encodings", async () => {
    for (const input of fixtures.values()) {
      const serialized = JSON.stringify(input, null, 2);
      for (const ending of ["\n", "\r\n"]) {
        const clone = JSON.parse(serialized.replace(/\n/g, ending)) as CorpusFixture;
        const result = await compileCorpusFixture(clone);
        expect(result).toEqual(compiled.get(input.definition.id));
      }
    }
  });

  it("records only local fixture evidence and leaves the independently owned F01 conversion pending", () => {
    expect(manifest.fixtures.map(row => row.id)).toEqual(["F01", ...corpusDefinitions.map(row => row.id)]);
    expect(manifest.fixtures[0].status).toBe("BLOCKED_CONTROL_DERIVATIVE");
    expect(manifest.fixtures.slice(1).every(row => row.status === "SYNTHETIC_COMPILE_ONLY")).toBe(true);
    expect(JSON.stringify(manifest)).not.toMatch(/[A-Z]:\\|C:\//);
  });
});

describe("missing governed synthetic modules stop before compilation or any vendor access", () => {
  it.each([
    { id: "F02", missing: "hazards", code: "HAZARD_MISSING" },
    { id: "F03", missing: "protocol", code: "PROTOCOL_MISSING" },
    { id: "F09", missing: "source", code: "REFERENCE_UNKNOWN" },
    { id: "F11", missing: "hazards", code: "HAZARD_MISSING" },
    { id: "F06", missing: "evaluation", code: "EVAL_MISSING" },
  ] as const)("blocks $id missing $missing, then compiles only after exact synthetic module restoration", async ({ id, missing, code }) => {
    const input = structuredClone(fixtures.get(id)!);
    const completeValidation = structuredClone(input.context.validation);
    const family = input.context.validation.families[0];
    if (missing === "hazards") family.hazard_ids = [];
    if (missing === "protocol") family.protocol_ids = [];
    if (missing === "source") input.context.validation.sources = [];
    if (missing === "evaluation") family.eval_receipt_ids = [];
    const compile = vi.fn(compileDoorV44Page);
    const vendor = vi.spyOn(globalThis, "fetch").mockImplementation(() => { throw new Error("No vendor access is authorized"); });
    try {
      const refused = await compileCorpusFixture(input, compile);
      expect(refused.ok).toBe(false); expect(refused.stage).toBe("preflight");
      if (!refused.ok) expect(refused.errors.map(row => row.code)).toContain(code);
      expect(compile).not.toHaveBeenCalled(); expect(vendor).not.toHaveBeenCalled();
      input.context.validation = completeValidation;
      const restored = await compileCorpusFixture(input, compile);
      expect(restored.ok, JSON.stringify(restored)).toBe(true); expect(compile).toHaveBeenCalledTimes(1);
      expect(vendor).not.toHaveBeenCalled();
    } finally { vendor.mockRestore(); }
  });

  it("keeps an unsupported stop-first order proposal outside the approved order-b contract", async () => {
    const input = structuredClone(fixtures.get("F10")!);
    Object.assign(input.spec.layout, { order_profile_id: "stop-first" });
    const compile = vi.fn(compileDoorV44Page); const result = await compileCorpusFixture(input, compile);
    expect(result.ok).toBe(false); expect(result.stage).toBe("preflight"); expect(compile).not.toHaveBeenCalled();
  });
});
