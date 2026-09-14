import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compileDoorV44Schemas } from "@/domain/search/door-v44/schema-engine";
import type { DoorV44Spec } from "@/domain/search/door-v44/types";

type Row = Record<string, unknown>;
const base = join(process.cwd(), "content/door-template/v44");
const fixtureBase = join(process.cwd(), "tests/fixtures/door-v44/contracts");
function json(path: string): Row { return JSON.parse(readFileSync(path, "utf8")) as Row; }
function bundleAt(path: string): Row[] {
  return readdirSync(path, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? bundleAt(join(path, entry.name)) : entry.name.endsWith(".json") ? [json(join(path, entry.name))] : []);
}
const bundle = bundleAt(join(base, "schemas"));
const compiled = compileDoorV44Schemas(bundle);
if (!compiled.ok) throw new Error(JSON.stringify(compiled));
const validate = compiled.validate;
function fixture(name = "f04"): DoorV44Spec {
  return json(join(fixtureBase, name + ".json")) as unknown as DoorV44Spec;
}
function valueAt(value: unknown, path: string[]): unknown {
  return path.reduce<unknown>((current, key) => (current as Row)[key], value);
}
function objectPaths(value: unknown, path: string[] = []): string[][] {
  if (!value || typeof value !== "object") return [];
  return [...(Array.isArray(value) ? [] : [path]),
    ...Object.entries(value).flatMap(([key, child]) => objectPaths(child, [...path, key]))];
}
const namespaces = "page site brand nav crumb hero intake stats flip job_packet general_vs_yours capability observations visuals common_causes safe_observations repair_record faq related closer sources accents".split(" ");
const bounds: Array<[string, number, number]> = [
  ["sections.hero.value_rows", 5, 5], ["intake.prompts", 3, 3], ["intake.so_far_items", 3, 3],
  ["sections.stats.cards", 3, 5], ["sections.observations.columns", 2, 2],
  ["sections.common_causes.columns", 4, 4], ["sections.flip.columns", 3, 3],
  ["sections.general_vs_yours.columns", 3, 3], ["sections.general_vs_yours.rows", 4, 6],
  ["sections.capability.columns", 3, 3], ["sections.capability.rows", 5, 10],
  ["sections.job_packet.example_rows", 5, 5], ["sections.repair_record.cards", 4, 4],
  ["sections.faq.questions", 4, 6], ["visuals", 2, 4],
  ["sections.safe_observations.checks", 1, 20], ["sections.safe_observations.never_items", 1, 20],
  ["sections.safe_observations.stop_items", 1, 20],
];
describe("v44 canonical draft07 contracts (synthetic, no release acceptance)", () => {
  it.each(["f04", "f08"])("validates %s complete envelope", name => {
    expect(validate(fixture(name))).toEqual([]);
  });
  it("covers the exact 22 legacy namespaces plus root and finite richtext schema", () => {
    expect(bundle).toHaveLength(24);
    for (const name of namespaces) expect(bundle.some(row => String(row.$id).endsWith("/namespaces/" + name + ".json"))).toBe(true);
    const compatibility = json(join(base, "contracts/compatibility.json"));
    expect(Object.keys(compatibility.namespace_paths as Row).sort()).toEqual([...namespaces].sort());
    expect(compatibility.namespace_count).toBe(22);
    expect(compiled.ok && compiled.coverage.object_count).toBeGreaterThan(90);
  });
  it("rejects an unknown key at every populated object boundary without stripping it", () => {
    const positive = fixture();
    for (const path of objectPaths(positive)) {
      const raw = structuredClone(positive);
      const row = valueAt(raw, path) as Row;
      row.unapproved_field = "rejected synthetic value";
      const before = JSON.stringify(raw);
      expect(validate(raw).some(error => error.code === "UNKNOWN_FIELD"), "/" + path.join("/")).toBe(true);
      expect(JSON.stringify(raw)).toBe(before);
    }
  });
  it("requires every field populated by the complete F04 fixture", () => {
    const positive = fixture();
    for (const path of objectPaths(positive)) {
      const row = valueAt(positive, path) as Row;
      for (const key of Object.keys(row)) {
        const raw = structuredClone(positive);
        delete (valueAt(raw, path) as Row)[key];
        expect(validate(raw).length, "/" + [...path, key].join("/")).toBeGreaterThan(0);
      }
    }
  });
  it.each(bounds)("enforces %s band %i..%i", (path, minimum, maximum) => {
    for (const count of [minimum - 1, maximum + 1]) {
      const raw = fixture();
      const keys = path.split(".");
      const parent = valueAt(raw, keys.slice(0, -1)) as Row;
      const current = parent[keys.at(-1)!] as unknown[];
      parent[keys.at(-1)!] = Array.from({ length: count }, (_, index) => structuredClone(current[index % current.length]));
      expect(validate(raw).some(error => error.code === (count < minimum ? "ARRAY_TOO_SHORT" : "ARRAY_TOO_LONG"))).toBe(true);
    }
  });
  it("requires prompt order, required FAQ kinds and a still-needs-testing boundary", () => {
    const order = fixture();
    order.intake.prompts.reverse();
    expect(validate(order).length).toBeGreaterThan(0);
    const faq = fixture();
    faq.sections.faq.questions[0].kind = "other";
    expect(validate(faq).some(error => error.code === "SCHEMA_CONTAINS")).toBe(true);
    const caps = fixture();
    caps.sections.capability.rows.forEach(row => { row.chip_label = "CAN ANSWER"; });
    expect(validate(caps).some(error => error.code === "SCHEMA_CONTAINS")).toBe(true);
  });
  it("requires a cited range or an explicit omission reason", () => {
    const raw = fixture();
    raw.sections.common_causes.rows[0].omission_reason = null;
    expect(validate(raw).length).toBeGreaterThan(0);
    raw.sections.common_causes.rows[0].range = [{ type: "text", value: "Published synthetic range" }];
    expect(validate(raw).length).toBeGreaterThan(0);
    raw.sections.common_causes.rows[0].claim_ids = [raw.claims[0].claim_id];
    expect(validate(raw)).toEqual([]);
  });
  it("accepts AST depth four and rejects depth five, emptiness and raw markup", () => {
    const raw = fixture();
    raw.sections.closer.heading = [{ type: "paragraph", children: [{ type: "sentence", children: [
      { type: "strong", children: [{ type: "text", value: "Visible words" }] },
    ] }] }];
    expect(validate(raw)).toEqual([]);
    raw.sections.closer.heading = [{ type: "paragraph", children: [{ type: "sentence", children: [
      { type: "strong", children: [{ type: "emphasis", children: [{ type: "text", value: "Too deep" }] }] },
    ] }] }];
    expect(validate(raw).length).toBeGreaterThan(0);
    for (const value of ["", "double  space", " leading", "trailing ", "<script>bad</script>", "line\nbreak"]) {
      raw.sections.closer.heading = [{ type: "text", value }];
      expect(validate(raw).length, JSON.stringify(value)).toBeGreaterThan(0);
    }
    raw.sections.closer.heading = [{ type: "strong", children: [] }];
    expect(validate(raw).length).toBeGreaterThan(0);
  });
  it("bounds title/meta, image descriptions and dimensions", () => {
    const raw = fixture();
    raw.head.page.title = "x".repeat(66);
    expect(validate(raw).some(error => error.code === "STRING_TOO_LONG")).toBe(true);
    raw.head.page.title = "A bounded title?";
    raw.head.page.meta_description = "x".repeat(161);
    expect(validate(raw).some(error => error.code === "STRING_TOO_LONG")).toBe(true);
    raw.head.page.meta_description = "A bounded description.";
    for (const count of [79, 101]) {
      raw.visuals[0].description = Array.from({ length: count }, () => "word").join(" ");
      expect(validate(raw).some(error => error.code === "INVALID_PATTERN")).toBe(true);
    }
    raw.visuals[0].description = Array.from({ length: 80 }, () => "word").join(" ");
    raw.visuals[0].width = 0;
    expect(validate(raw).some(error => error.code === "NUMBER_TOO_SMALL")).toBe(true);
  });
  it("enforces every presentation class enum and the immutable repair placeholder", () => {
    const cases: Array<[string[], unknown]> = [
      [["sections", "stats", "cards", "0", "icon_class"], "arbitrary"],
      [["sections", "capability", "rows", "0", "chip_class"], "arbitrary"],
      [["sections", "common_causes", "rows", "0", "fix_class"], "arbitrary"],
      [["sections", "repair_record", "cards", "0", "color_class"], "arbitrary"],
      [["sections", "observations", "columns", "0", "mw_class"], "arbitrary"],
      [["visuals", "0", "plate_class"], " plate-1"],
      [["sections", "repair_record", "cards", "0", "value"], "0"],
      [["sections", "repair_record", "cards", "0", "public_fact_id"], "invented"],
    ];
    for (const [keys, value] of cases) {
      const raw = fixture();
      (valueAt(raw, keys.slice(0, -1)) as Row)[keys.at(-1)!] = value;
      expect(validate(raw).length, keys.join("/")).toBeGreaterThan(0);
    }
  });
  it("rejects empty RELATED and authored CTA URLs while allowing the optional module to be absent", () => {
    const raw = fixture();
    expect("related" in raw.sections).toBe(false);
    raw.sections.related = { links: [] };
    expect(validate(raw).some(error => error.code === "ARRAY_TOO_SHORT")).toBe(true);
    delete raw.sections.related;
    (raw.actions.hero_start as unknown as Row).target = "https://unapproved.example";
    expect(validate(raw).length).toBeGreaterThan(0);
  });
  it("keeps canonical classes, frozen reference and explicit mutability manifests consistent", () => {
    const classes = json(join(base, "contracts/classes.json")).values as Record<string, string[]>;
    const enums: Record<string, string[][]> = {};
    function visit(value: unknown): void {
      if (!value || typeof value !== "object") return;
      const row = value as Row;
      if (row.properties && typeof row.properties === "object") for (const [name, field] of Object.entries(row.properties)) {
        const values = (field as Row).enum;
        if (name in classes && Array.isArray(values)) (enums[name] ??= []).push(values as string[]);
      }
      Object.values(value).forEach(visit);
    }
    bundle.forEach(visit);
    for (const [name, values] of Object.entries(classes)) {
      expect(enums[name]?.length, name).toBeGreaterThan(0);
      for (const occurrence of enums[name]) expect(occurrence).toEqual(values);
    }
    const compatibility = json(join(base, "contracts/compatibility.json"));
    const reference = compatibility.frozen_reference as Row;
    const bytes = readFileSync(join(process.cwd(), reference.path as string));
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(reference.raw_sha256);
    const mutability = json(join(base, "contracts/mutability.json"));
    const entries = mutability.fields as Array<{ pointer: string; class: string }>;
    expect(entries.length).toBeGreaterThan(250);
    expect(new Set(entries.map(row => row.pointer)).size).toBe(entries.length);
    expect(entries.every(row => (mutability.classes as string[]).includes(row.class))).toBe(true);
    for (const name of Object.keys(fixture())) expect(entries.some(row => row.pointer === "/" + name)).toBe(true);
  });
  it("records synthetic taxonomy grammar, all six governed CTA patterns and public limits", () => {
    const subjects = json(join(base, "taxonomy/subjects.json"));
    const actions = json(join(base, "taxonomy/cta-patterns.json"));
    expect(subjects.scope).toBe("synthetic_fixture_only");
    expect(subjects.rows).toEqual(json(join(fixtureBase, "context.json")).subjects);
    expect(actions.rows).toHaveLength(6);
    for (const row of actions.rows as Row[]) expect(row.target).toBe("#intake");
    const readme = readFileSync(join(fixtureBase, "README.md"), "utf8");
    expect(readme).toContain("Those receipts prove no deployed capability");
    expect(readme).toContain("not H01–H18 acceptance");
  });
  it("rejects missing/external schemas and undeclared open schema objects", () => {
    const missing = bundle.filter(row => !String(row.$id).endsWith("/hero.json"));
    expect(compileDoorV44Schemas(missing).ok).toBe(false);
    const external = structuredClone(bundle);
    (external.find(row => String(row.$id).endsWith("/nav.json"))!.properties as Row).category_page_id = { $ref: "https://outside.example/id.json" };
    expect(compileDoorV44Schemas(external).ok).toBe(false);
    const open = structuredClone(bundle);
    open.find(row => String(row.$id).endsWith("/nav.json"))!.additionalProperties = true;
    expect(compileDoorV44Schemas(open).ok).toBe(false);
  });
  it("rejects untyped schema escape hatches and dynamic private-key maps", () => {
    const untyped = structuredClone(bundle);
    (untyped.find(row => String(row.$id).endsWith("/nav.json"))!.properties as Row).category_page_id = {};
    expect(compileDoorV44Schemas(untyped).ok).toBe(false);
    const dynamic = structuredClone(bundle);
    dynamic.find(row => String(row.$id).endsWith("/nav.json"))!.patternProperties = { "^PRIVATE": { type: "string" } };
    const result = compileDoorV44Schemas(dynamic);
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain("PRIVATE");
  });
  it("registers every literal emitted loader and schema diagnostic code", () => {
    const registered = new Set(json(join(base, "contracts/errors.json")).codes as string[]);
    for (const name of ["loader.ts", "schema-engine.ts"]) {
      const source = readFileSync(join(process.cwd(), "src/domain/search/door-v44", name), "utf8");
      for (const match of source.matchAll(/(?:fail\(|code:\s*)"([A-Z][A-Z0-9_]+)"/g)) {
        expect(registered.has(match[1]), name + ": " + match[1]).toBe(true);
      }
      const map = source.match(/const keywordCodes:[\s\S]*?=\s*\{([\s\S]*?)\};/);
      for (const match of map?.[1].matchAll(/:\s*"([A-Z][A-Z0-9_]+)"/g) ?? []) {
        expect(registered.has(match[1]), name + ": " + match[1]).toBe(true);
      }
    }
  });
  it("rejects boolean-true property schemas, including a nested combinator", () => {
    expect(compileDoorV44Schemas(bundle).ok).toBe(true);
    for (const permissive of [true, { anyOf: [true] }]) {
      const changed = structuredClone(bundle);
      (changed.find(row => String(row.$id).endsWith("/nav.json"))!.properties as Row).category_page_id = permissive;
      const result = compileDoorV44Schemas(changed);
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("Boolean-true schema escaped contract verification");
      expect(result.errors.some(error => error.code === "SCHEMA_UNTYPED")).toBe(true);
    }
  });
  it("requires strict object declarations inside nullable type unions", () => {
    expect(compileDoorV44Schemas(bundle).ok).toBe(true);
    const changed = structuredClone(bundle);
    (changed.find(row => String(row.$id).endsWith("/nav.json"))!.properties as Row).category_page_id = { type: ["object", "null"] };
    const result = compileDoorV44Schemas(changed);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Nullable object escaped strict contract verification");
    expect(result.errors.some(error => error.code === "SCHEMA_OBJECT_NOT_STRICT")).toBe(true);
  });
});
