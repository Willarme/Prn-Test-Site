import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { convertF01, f01VisibleText } from "./fixtures/door-v44/corpus/f01/convert";
import candidate from "./fixtures/door-v44/corpus/f01/candidate.json";
import report from "./fixtures/door-v44/corpus/f01/report.json";
import pins from "./fixtures/door-v44/corpus/f01/source-pins.json";
import inputPins from "../content/door-template/v44/inputs/manifest.json";
import { doorV44Hash, stableDoorJson } from "@/domain/search/door-v44/schema-engine";
import { loadDoorV44Spec } from "@/domain/search/door-v44/loader";
import { compilerFixture } from "./fixtures/door-v44/compiler-fixture";

const base = "content/door-template/v43/spec/ac-blowing-warm-air/";
const bytesHash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const source = async (name: string) => JSON.parse(await readFile(base + name + ".json", "utf8"));
const at = (value: unknown, pointer: string): unknown => pointer.split("/").slice(1).reduce<unknown>((current, key) => (current as Record<string, unknown>)[key.replace(/~1/g, "/").replace(/~0/g, "~")], value);
function leafPointers(value: unknown, pointer = ""): string[] {
  return value !== null && typeof value === "object" && Object.keys(value).length
    ? Object.entries(value).flatMap(([key, child]) => leafPointers(child, pointer + "/" + key.replace(/~/g, "~0").replace(/\//g, "~1"))) : [pointer];
}

describe("source-preserving F01 conversion, explicitly blocked from compilation", () => {
  it("reproduces the committed candidate and complete conversion report", () => {
    expect(convertF01()).toEqual({ candidate, report });
    expect(convertF01()).toEqual(convertF01());
    expect(report.candidate_hash).toBe(doorV44Hash(candidate));
    expect(report.source_pin_hash).toBe(doorV44Hash(pins));
  });

  it("accounts independently for all 23 source namespaces and all 636 source leaf values", async () => {
    const expected: string[] = [];
    for (const pin of pins.files.filter(row => row.path.startsWith(base) && row.path.endsWith(".json"))) {
      const value = JSON.parse(await readFile(pin.path, "utf8"));
      expected.push(...leafPointers(value).map(pointer => pin.path + "#" + pointer));
    }
    expect(report.source_namespace_count).toBe(23);
    expect(expected).toHaveLength(636);
    expect(report.source_map.map(row => row.source_file + "#" + row.source_pointer).sort()).toEqual(expected.sort());
    expect(report.source_map.every(row => row.disposition !== "UNACCOUNTED")).toBe(true);
  });

  it("retains exact original values and locatable pointers, including excluded material", async () => {
    const files = new Map<string, unknown>();
    for (const row of report.source_map) {
      if (!files.has(row.source_file)) files.set(row.source_file, JSON.parse(await readFile(row.source_file, "utf8")));
      expect(at(files.get(row.source_file), row.source_pointer)).toEqual(row.source_value);
      expect(row.source_value_sha256).toBe(doorV44Hash(row.source_value));
    }
  });

  it("maps every copied or projected field and records every changed representation exactly", () => {
    const changed: unknown[] = [];
    for (const row of report.source_map) row.candidate_pointers.forEach((pointer, index) => {
      const value = at(candidate, pointer);
      expect(value, pointer).not.toBeUndefined();
      const operation = row.operations[index];
      if (operation === "copy") expect(value).toEqual(row.source_value);
      if (operation === "visible_text_entities_and_markup") expect(value).toBe(f01VisibleText(row.source_value as string));
      if (operation === "visible_text_to_single_AST_node_inline_style_deferred") expect(value).toEqual([{ type: "text", value: f01VisibleText(row.source_value as string) }]);
      if (stableDoorJson(value) !== stableDoorJson(row.source_value)) changed.push({ source_file: row.source_file, source_pointer: row.source_pointer,
        candidate_pointer: pointer, operation, source_value: row.source_value, candidate_value: value });
    });
    expect(report.differences).toEqual(changed);
    expect(changed).toHaveLength(65);
    const mapped = report.source_map.flatMap(row => row.candidate_pointers);
    for (const pointer of leafPointers(candidate)) {
      expect(mapped.some(target => target === pointer || pointer.startsWith(target + "/"))
        || report.candidate_additions.some(row => row.pointer === pointer), pointer).toBe(true);
    }
    for (const row of report.candidate_additions) expect(at(candidate, row.pointer)).toEqual(row.value);
  });

  it("preserves original metadata rather than shortening it to pass the schema", async () => {
    const page = await source("page");
    expect(candidate.head.page).toEqual({ title: page.title, meta_description: page.meta_description, og_description: page.og_description });
    expect(page.title).toHaveLength(71); expect(page.meta_description).toHaveLength(174);
    expect(page.og_description).not.toBe(page.meta_description);
    expect(report.schema_errors).toContainEqual({ code: "STRING_TOO_LONG", pointer: "/head/page/title" });
    expect(report.schema_errors).toContainEqual({ code: "STRING_TOO_LONG", pointer: "/head/page/meta_description" });
  });

  it("preserves all observations, causes, safety entries, FAQ answers and capability rows", async () => {
    expect(candidate.sections.observations.rows).toHaveLength(4);
    expect(candidate.sections.common_causes.rows).toHaveLength(7);
    expect(candidate.sections.safe_observations.checks).toHaveLength(5);
    expect(candidate.sections.safe_observations.never_items).toHaveLength(4);
    expect(candidate.sections.safe_observations.stop_items).toHaveLength(4);
    expect(candidate.sections.faq.questions).toHaveLength(5);
    expect(candidate.sections.capability.rows).toHaveLength(9);
    const safety = await source("safe_observations");
    expect(candidate.sections.safe_observations.never_items.map(row => row.text)).toEqual(safety.never_items);
    expect(candidate.sections.safe_observations.stop_items.map(row => row.text)).toEqual(safety.stop_items);
    const faq = await source("faq");
    faq.questions.forEach((row: { q: string; a_html: string }, index: number) => {
      expect(candidate.sections.faq.questions[index].question).toBe(row.q);
      expect(candidate.sections.faq.questions[index].answer).toEqual([{ type: "text", value: f01VisibleText(row.a_html) }]);
    });
  });

  it("removes only the governed RELATED stub while retaining its exact source evidence", async () => {
    expect(candidate.layout.conditional_sections.related).toBe(false);
    expect(candidate.related_page_ids).toEqual([]);
    expect("related" in candidate.sections).toBe(false);
    const difference = report.governed_differences.find(row => row.id === "RELATED_OMITTED")!;
    expect(difference.source_value).toEqual((await source("related")).links);
    expect(JSON.stringify(difference)).toContain("/no-hot-water");
    expect(difference.authority).toContain("Guide §18");
    expect(report.exact_control_pass).toBe(false);
  });

  it("reuses all three pinned source SVG/PNG pairs without asserting new visual review", async () => {
    expect(candidate.visuals).toHaveLength(3);
    for (const [index, evidence] of report.visual_evidence.entries()) {
      const svg = await readFile(evidence.source_svg, "utf8"), png = await readFile(evidence.source_png);
      expect(evidence.inline_hash).toBe(bytesHash(Buffer.from(svg.replace(/\r\n/g, "\n"))));
      expect(evidence.raster_hash).toBe(bytesHash(png));
      expect(candidate.visuals[index].raster_hash).toBe(evidence.raster_hash);
      expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([candidate.visuals[index].width, candidate.visuals[index].height]);
      expect(candidate.visuals[index].title).toBe(f01VisibleText(svg.match(/<title\b[^>]*>([\s\S]*?)<\/title>/)![1]));
      expect(candidate.visuals[index].description).toBe(f01VisibleText(svg.match(/<desc\b[^>]*>([\s\S]*?)<\/desc>/)![1]));
      expect(candidate.visuals[index].review_receipt).toBeNull();
      expect(evidence.visual_review).toBe("NOT_SUPPLIED");
      expect(evidence.inline_raster_parity).toBe("NOT_VERIFIED");
    }
  });

  it("keeps historical citation defects and unverified capability/protocol status explicit", async () => {
    expect(candidate.sources).toHaveLength(11);
    expect(candidate.sources.map(row => row.cite)).toEqual([true, true, true, true, true, true, true, false, false, false, false]);
    expect(candidate.sections.common_causes.rows.slice(0, 3).every(row => row.claim_ids.length === 0 && row.range.length > 0)).toBe(true);
    expect(report.claim_candidates.every(row => row.reviewed === false)).toBe(true);
    expect(candidate.capabilities.every(row => row.live_status === "UNVERIFIED" && row.production_receipt === null)).toBe(true);
    expect(candidate.sections.safe_observations.eval_receipt_ids).toEqual([]);
    expect(candidate.sections.safe_observations.protocol_id).toMatch(/^unresolved\./);
    expect(candidate.intent.page_eligibility_receipt).toMatch(/^unresolved\./);
    expect(candidate.intake.disclosure.id).toMatch(/^unresolved\./);
    expect(candidate.release).toEqual({ index_policy: "staged_noindex", approved_content_at: null });
    const registry = await source("capability-registry");
    expect(candidate.capabilities.map(row => row.capability_id)).toEqual(registry.capabilities.map((row: { capability_id: string }) => row.capability_id));
  });

  it("fails the actual loader with precisely the recorded current-schema conflicts", async () => {
    const { context } = await compilerFixture();
    const result = loadDoorV44Spec(candidate, context.validation);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toEqual(report.schema_errors);
    expect(report.schema_errors).toHaveLength(20);
    expect(report.status).toBe("BLOCKED_CONTROL_DERIVATIVE");
    expect(report.compiler_pass).toBe(false); expect(report.release_ready).toBe(false);
  });

  it("leaves every pinned v43 file byte-for-byte unchanged while converting", async () => {
    const files = inputPins.files.filter(row => row.path.startsWith("content/door-template/v43/"));
    const before = await Promise.all(files.map(async row => bytesHash(await readFile(row.path))));
    convertF01();
    expect(await Promise.all(files.map(async row => bytesHash(await readFile(row.path))))).toEqual(before);
    expect(before).toEqual(files.map(row => row.raw_sha256));
    expect(files).toHaveLength(58);
    for (const pin of pins.files) expect(bytesHash(await readFile(pin.path)), pin.path).toBe(pin.raw_sha256);
  });

  it.each(["text", "mixed_line_endings"])("refuses a source %s edit instead of silently repinning or repairing it", async kind => {
    const root = await mkdtemp(join(tmpdir(), "door-f01-conversion-"));
    if (!root.startsWith(join(tmpdir(), "door-f01-conversion-"))) throw new Error("Unexpected cleanup path");
    try {
      for (const pin of pins.files) {
        const path = join(root, pin.path); await mkdir(dirname(path), { recursive: true }); await writeFile(path, await readFile(pin.path));
      }
      const path = join(root, base, "page.json");
      const original = await readFile(path, "utf8");
      const changed = kind === "text" ? original.replace("YOUR system", "your system")
        : original.includes("\r\n") ? original.replace("\r\n", "\n") : original.replace("\n", "\r\n");
      await writeFile(path, changed);
      expect(() => convertF01(root)).toThrow("F01_SOURCE_HASH_MISMATCH");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
