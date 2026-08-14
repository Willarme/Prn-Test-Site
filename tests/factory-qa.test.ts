import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildCandidatePages, compilePageSpec } from "@/domain/search/factory";
import { SAMPLE_PAGE_SPEC } from "@/domain/search/fixtures/sample-page-spec";
import { importSeedRows, type SeedFile } from "@/domain/search/importer";
import { PageSpec } from "@/domain/search/pages";
import { qaCandidatePages, runDeterministicChecks } from "@/domain/search/qa";

const NOW = () => "2026-08-14T12:00:00Z";

const seedFile = JSON.parse(
  readFileSync(join(process.cwd(), "tests", "fixtures", "seed-research", "seed-rows.json"), "utf-8")
) as SeedFile;
const seedOpps = importSeedRows(seedFile, "2026-08-14T00:00:00Z");
const acOpp = { ...seedOpps.find((o) => o.keyword === "ac blowing warm air")!, recommendation: "NEW" as const };

describe("A05 page factory", () => {
  it("compiles an approved opportunity into a valid STAGED PageSpec", () => {
    const spec = compilePageSpec(acOpp, { now: NOW });
    expect(PageSpec.safeParse(spec).success).toBe(true);
    expect(spec.status).toBe("STAGED");
    expect(spec.canonical_path).toBe("/problems/ac-blowing-warm-air");
    expect(spec.intake_context.page_id).toBe(spec.page_id);
    expect(spec.monetization_eligible).toBe(false);
  });

  it("builds only NEW-recommended candidates, up to the hard cap", () => {
    const mixed = [
      acOpp,
      { ...seedOpps.find((o) => o.keyword === "electrical burning smell")!, recommendation: "WATCH" as const },
      { ...seedOpps.find((o) => o.keyword === "water heater leaking")!, recommendation: "NEW" as const },
    ];
    expect(buildCandidatePages(mixed, 10, { now: NOW }).specs.length).toBe(2);
    expect(buildCandidatePages(mixed, 1, { now: NOW }).specs.length).toBe(1);
  });

  it("long keywords compile with a <=70-char title instead of crashing the batch", () => {
    const long = {
      ...acOpp,
      keyword: "water heater making loud banging noise when hot water turns on",
      search_opportunity_id: "so_long_kw",
    };
    const { specs, skipped } = buildCandidatePages([long], 10, { now: NOW });
    expect(skipped).toEqual([]);
    expect(specs.length).toBe(1);
    expect(specs[0].title.length).toBeLessThanOrEqual(70);
  });

  it("title-cases without mangling apostrophes", () => {
    const spec = compilePageSpec(
      { ...acOpp, keyword: "ac won't turn on", search_opportunity_id: "so_wont" },
      { now: NOW }
    );
    expect(spec.title).toMatch(/Won't/);
    expect(spec.title).not.toMatch(/Won'T/);
  });

  it("never writes consent or analyzer logic into a page (doors, not brains)", () => {
    const spec = compilePageSpec(acOpp, { now: NOW });
    const text = JSON.stringify(spec).toLowerCase();
    expect(text).not.toMatch(/by continuing, you agree/);
    expect(text).not.toMatch(/diagnos(e|is) engine/);
  });
});

describe("A06 QA gate", () => {
  it("passes the handcrafted sample page", () => {
    const [result] = qaCandidatePages([SAMPLE_PAGE_SPEC], []);
    expect(result.state).toBe("PASS");
    expect(result.critic_ran).toBe(true);
    expect(result.user_value_score).toBeGreaterThanOrEqual(60);
  });

  it("fails duplicate canonical paths", () => {
    const dupe = PageSpec.parse({ ...SAMPLE_PAGE_SPEC, page_spec_id: "ps_dupe" });
    const reasons = runDeterministicChecks(dupe, [SAMPLE_PAGE_SPEC]);
    expect(reasons.join(" ")).toMatch(/duplicate canonical/);
  });

  it("fails overlapping intent — merge instead of a second doorway page", () => {
    const overlap = compilePageSpec(
      { ...acOpp, keyword: "why is my ac blowing warm air", search_opportunity_id: "so_x" },
      { now: NOW }
    );
    const acPage = compilePageSpec(acOpp, { now: NOW });
    const reasons = runDeterministicChecks(overlap, [acPage]);
    expect(reasons.join(" ")).toMatch(/overlaps existing page/);
  });

  it("fails placeholder or thin content, and a deterministic FAIL never reaches the critic", () => {
    const thin = PageSpec.parse({
      ...SAMPLE_PAGE_SPEC,
      page_spec_id: "ps_thin",
      page_id: "page_thin",
      canonical_path: "/problems/thin-page",
      title: "Thin Page TODO",
      primary_query: "totally different query about garage doors",
      intake_context: { ...SAMPLE_PAGE_SPEC.intake_context, page_id: "page_thin" },
      content_blocks: [
        {
          block_id: "blk_1",
          kind: "intent_answer" as const,
          heading: null,
          body_md: "TODO write this later",
          source_fact_bundle_ids: [],
        },
      ],
    });
    const [result] = qaCandidatePages([thin], []);
    expect(result.state).toBe("FAIL");
    expect(result.critic_ran).toBe(false); // never pay a critic for a broken page
    expect(result.reasons.join(" ")).toMatch(/thin content/);
    expect(result.reasons.join(" ")).toMatch(/placeholder/);
  });

  it("punctuation-variant keywords with identical slugs still collide in QA (self-identity by reference)", () => {
    const s1 = compilePageSpec({ ...acOpp, keyword: "ac repair", search_opportunity_id: "so_r1" }, { now: NOW });
    const s2 = compilePageSpec({ ...acOpp, keyword: "ac repair!", search_opportunity_id: "so_r2" }, { now: NOW });
    const results = qaCandidatePages([s1, s2], []);
    expect(results[0].state).toBe("PASS");
    expect(results[1].state).toBe("FAIL");
    expect(results[1].reasons.join(" ")).toMatch(/duplicate canonical/);
  });

  it("fails unsupported claim language", () => {
    const claimy = PageSpec.parse({
      ...SAMPLE_PAGE_SPEC,
      page_spec_id: "ps_claims",
      page_id: "page_claims",
      canonical_path: "/problems/claims",
      title: "We Guarantee the Cheapest Fix",
      primary_query: "guaranteed cheapest hvac repair",
      intake_context: { ...SAMPLE_PAGE_SPEC.intake_context, page_id: "page_claims" },
    });
    const reasons = runDeterministicChecks(claimy, []);
    expect(reasons.join(" ")).toMatch(/unsupported claim/);
  });

  it("factory-generated pages pass QA when distinct", () => {
    const spec = compilePageSpec(acOpp, { now: NOW });
    const [result] = qaCandidatePages([spec], []);
    expect(result.state).toBe("PASS");
  });
});
