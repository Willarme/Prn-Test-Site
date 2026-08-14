import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SearchOpportunity } from "@/domain/search/contracts";
import { importSeedRows, type SeedFile } from "@/domain/search/importer";

const seedFile = JSON.parse(
  readFileSync(join(process.cwd(), "tests", "fixtures", "seed-research", "seed-rows.json"), "utf-8")
) as SeedFile;

const IMPORTED_AT = "2026-08-14T12:00:00Z";
const imported = importSeedRows(seedFile, IMPORTED_AT);
const byKeyword = new Map(imported.map((o) => [o.keyword, o]));

describe("seed workbook importer", () => {
  it("converts all 119 workbook rows and dedupes to exactly 96 unique keywords", () => {
    expect(seedFile.rows.length).toBe(119);
    expect(imported.length).toBe(96); // 23 cross-sheet duplicate rows merged
    const ids = imported.map((o) => o.search_opportunity_id);
    expect(new Set(ids).size).toBe(ids.length); // hash suffix prevents slug collisions
  });

  it("every imported record is a valid SearchOpportunity", () => {
    for (const opp of imported) {
      expect(SearchOpportunity.safeParse(opp).success, opp.keyword).toBe(true);
    }
  });

  it("preserves KD 0 as real and blank as unknown — the workbook's trap", () => {
    expect(byKeyword.get("ac blowing warm air")!.keyword_difficulty).toBe(0);
    expect(byKeyword.get("count lines in text")!.keyword_difficulty).toBeNull();
  });

  it("never maps Google-Ads competition text into keyword difficulty", () => {
    // Trial - Calculators has no SEO KD anywhere; only the Ahrefs Queue's
    // Public SEO KD may fill it for shared keywords. concrete slab calculator
    // appears in both and has KD blank in both -> must stay null.
    expect(byKeyword.get("concrete slab calculator")!.keyword_difficulty).toBeNull();
    expect(byKeyword.get("concrete slab calculator")!.volume_monthly).toBe(49500);
  });

  it("merges duplicate rows with provenance from every sheet", () => {
    const ac = byKeyword.get("ac not turning on")!;
    expect(ac.volume_monthly).toBe(3300);
    expect(ac.keyword_difficulty).toBe(3);
    expect(ac.provenance.confidence_note).toMatch(/Trial - Problem Intent/);
    expect(ac.provenance.confidence_note).toMatch(/Trial - Ahrefs Queue/);
  });

  it("flags every record as geography-assumed US national (D-3 default)", () => {
    for (const opp of imported) {
      expect(opp.geography.mode).toBe("national");
      expect(opp.geography_assumed).toBe(true);
      expect(opp.source).toBe("seed_import");
    }
  });

  it("keeps the owner's manual rubric as provenance, never as the live score", () => {
    const ac = byKeyword.get("ac not turning on")!;
    expect(ac.opportunity_score).toBeNull();
    expect(ac.score_components?.seed_manual_score).toBe(84);
  });

  it("classifies problem vs tool intent from sheet and keyword shape", () => {
    expect(byKeyword.get("ac not turning on")!.intent_type).toBe("problem");
    expect(byKeyword.get("concrete slab calculator")!.intent_type).toBe("tool");
    expect(byKeyword.get("timestamp converter")!.intent_type).toBe("tool");
  });
});
