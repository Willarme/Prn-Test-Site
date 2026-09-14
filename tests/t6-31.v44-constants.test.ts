import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkDoorV44ConstantCoverage, DOOR_V44_CONSTANTS, DOOR_V44_CONSTANTS_SHA256,
  doorV44Constant, type DoorV44ConstantKey,
} from "@/domain/search/door-v44/template-constants";
import inputs from "../content/door-template/v44/inputs/manifest.json";

const sha = (text: string) => createHash("sha256").update(text).digest("hex");
function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, child]) => `${JSON.stringify(key)}:${stable(child)}`).join(",")}}`;
}
const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8").replace(/\r\n/g, "\n");
const entities: Record<string, string> = { amp: "&", nbsp: " ", middot: "·", rarr: "→", copy: "©", ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’", quot: '"', apos: "'" };
function normalize(text: string): string {
  return text.replace(/\{%[\s\S]*?%\}/g, "").replace(/<[^>]*>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (_match, name: string) => name[0] === "#"
      ? String.fromCodePoint(parseInt(name.slice(name[1].toLowerCase() === "x" ? 2 : 1), name[1].toLowerCase() === "x" ? 16 : 10))
      : entities[name] ?? `&${name};`)
    .replace(/\s+/g, " ").trim().replace(/^·\s*/, "").replace(/\s*→$/, "");
}

describe("v44 source-layer constant authority", () => {
  it("preserves every original string key and value without silently rewording them", () => {
    const original = Object.fromEntries(DOOR_V44_CONSTANTS.original_string_keys.map(key => [key, doorV44Constant(key as DoorV44ConstantKey)]));
    expect(sha(stable(original))).toBe("33b204fb09c730ba1982625c83973524f90b8f8fe9f93409bed50019b9f73b76");
  });

  it("has exact source locations or honest system authorship for every string", () => {
    expect(Object.keys(DOOR_V44_CONSTANTS.metadata).sort()).toEqual(Object.keys(DOOR_V44_CONSTANTS.strings).sort());
    for (const key of Object.keys(DOOR_V44_CONSTANTS.strings) as DoorV44ConstantKey[]) {
      const entry = DOOR_V44_CONSTANTS.metadata[key];
      const provenance = entry.provenance;
      expect(entry.classification).toBe("TEMPLATE_CONSTANT");
      if ("path" in provenance) {
        const source = read(provenance.path);
        const offset = source.indexOf(provenance.excerpt);
        expect(offset, key).toBeGreaterThanOrEqual(0);
        expect(source.slice(0, offset).split("\n").length, key).toBe(provenance.line);
        expect(normalize(provenance.excerpt), key).toBe(doorV44Constant(key));
      } else {
        expect(provenance.kind, key).toBe("system_authored");
        expect(provenance.decision_ref, key).toBe("c6ff9a");
        expect(entry.reason, key).toContain("not a frozen-source quote or human design approval");
      }
    }
  });

  it("accounts for every lexical fixed text unit across chrome, legal footer and all section partials", () => {
    let count = 0;
    for (const path of DOOR_V44_CONSTANTS.source_census_scope.files) {
      const html = read(path).replace(/<!--[\s\S]*?-->/g, "").replace(/<(script|style|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, "");
      const units = [...html.matchAll(/>([^<]+)</g)].map(match => normalize(match[1])).filter(text => /[A-Za-z]/.test(text));
      const classified = DOOR_V44_CONSTANTS.source_census.filter(row => row.source.path === path);
      expect(classified.map(row => normalize(row.source.excerpt)), path).toEqual(units);
      for (const row of classified) {
        if (row.key) expect(doorV44Constant(row.key as DoorV44ConstantKey)).toBe(normalize(row.source.excerpt));
        else expect(DOOR_V44_CONSTANTS.exclusions.some(excluded => excluded.id === row.exclusion_id && excluded.value === normalize(row.source.excerpt))).toBe(true);
      }
      count += units.length;
    }
    expect(count).toBe(70);
  });

  it("pins its source provenance and all protected v43 content", () => {
    for (const [path, source] of Object.entries(DOOR_V44_CONSTANTS.source_files)) expect(sha(read(path)), path).toBe(source.lf_sha256);
    const protectedFiles = inputs.files.filter(file => file.path.startsWith("content/door-template/v43/"));
    expect(protectedFiles.length).toBeGreaterThan(50);
    for (const file of protectedFiles) expect(sha(read(file.path)), file.path).toBe(file.lf_sha256);
    expect(sha(read("content/door-template/v43/reference/approved-v43.html"))).toBe("756fb95907fd3fb21f7bc9a86e854d0e90f8ef35455776b83a17b4935f8d8843");
  });

  it("keeps equipment-specific, held-feature and environment text out of unconditional furniture", () => {
    for (const id of ["equipment_brandbar", "equipment_capability_eyebrow", "equipment_upload", "provider_van", "eyebrows_safety", "literal_year", "equipment_media_jsonld", "equipment_packet_rows"]) {
      expect(DOOR_V44_CONSTANTS.exclusions.some(row => row.id === id)).toBe(true);
    }
    for (const key of ["safe_eyebrow", "record_eyebrow", "intake_free", "closer_free", "flip_record_body", "upload_audio"] as const) {
      expect(DOOR_V44_CONSTANTS.metadata[key].emission).toBe("conditional");
      expect(DOOR_V44_CONSTANTS.metadata[key].condition).toBeTruthy();
    }
    expect(DOOR_V44_CONSTANTS.environment_owned).toContain("active_disclosure");
    expect(DOOR_V44_CONSTANTS.legal.active_disclosure).toContain("not a substitute for intake consent");
    expect(DOOR_V44_CONSTANTS.navigation.footer_keys.at(-1)).toBe("nav_owner");
    expect(DOOR_V44_CONSTANTS.navigation.dynamic_slots).toContain("family_directory");
  });

  it("exports immutable data with a reproducible semantic manifest hash", () => {
    expect(DOOR_V44_CONSTANTS_SHA256).toBe(sha(stable(DOOR_V44_CONSTANTS)));
    expect(Object.isFrozen(DOOR_V44_CONSTANTS)).toBe(true);
    expect(Object.isFrozen(DOOR_V44_CONSTANTS.strings)).toBe(true);
    expect(Object.isFrozen(DOOR_V44_CONSTANTS.metadata.notice_heading.provenance)).toBe(true);
    expect(() => doorV44Constant("unknown" as DoorV44ConstantKey)).toThrow("Unknown door template constant");
  });
});

describe("constants-only renderer occurrence checks", () => {
  const expected = ["hero_home", "notice_heading"] as const;
  const observations = () => expected.map(key => ({ key, value: doorV44Constant(key) }));
  it("accepts exact constants and repeated labels within the selected conditions", () => {
    const rows = observations();
    rows.push({ key: "hero_home", value: "Home" });
    expect(checkDoorV44ConstantCoverage(rows, expected)).toEqual({ ok: true, errors: [] });
  });
  it("rejects changed copy, missing required occurrences and unauthorized conditional occurrences", () => {
    const result = checkDoorV44ConstantCoverage([
      { key: "hero_home", value: "Welcome home" },
      { key: "intake_free", value: doorV44Constant("intake_free") },
    ], expected);
    expect(result).toEqual({ ok: false, errors: [
      { code: "CONSTANT_CHANGED", key: "hero_home" },
      { code: "CONSTANT_UNEXPECTED", key: "intake_free" },
      { code: "CONSTANT_MISSING", key: "notice_heading" },
    ] });
  });
  it("does not echo arbitrary unknown keys or replacement text in diagnostics", () => {
    const secret = "PRIVATE_PAYLOAD_https://private.example";
    const result = checkDoorV44ConstantCoverage([{ key: secret, value: secret }], []);
    expect(result).toEqual({ ok: false, errors: [{ code: "CONSTANT_UNKNOWN", key: "$unknown" }] });
    expect(JSON.stringify(result)).not.toContain(secret);
  });
});
