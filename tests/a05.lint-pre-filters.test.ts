import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { SearchOpportunity } from "@/domain/search/contracts";
import { compilePageSpec } from "@/domain/search/factory";
import { SAMPLE_PAGE_SPEC } from "@/domain/search/fixtures/sample-page-spec";
import { PageFactoryPolicy } from "@/domain/search/page-factory-policy";
import {
  lintDirectoryFraming,
  lintInventedEvidence,
  lintPageBeforeQa,
  lintStructuredData,
  lintUrgencySlot,
} from "@/domain/search/page-lint";
import { PageSpec } from "@/domain/search/pages";
import { loadStaged } from "@/platform/admin/data";

/**
 * A05 step 5 — the two guardrails the audit calls "two real new guardrails",
 * written against the SHIPPED block shape (coherence issue 8, condition C14).
 */

const NOW = () => "2026-08-14T12:00:00Z";

const OPP = {
  search_opportunity_id: "so_lint",
  schema_version: "1.0.0",
  keyword: "ac blowing warm air",
  intent_cluster_id: null,
  cluster_label: null,
  problem_family_hint: "hvac",
  source: "seed_import",
  geography: { mode: "national", country: "US" },
  geography_assumed: false,
  volume_monthly: 100,
  keyword_difficulty: 10,
  cpc_usd: null,
  intent_type: "problem",
  opportunity_score: 80,
  score_components: null,
  recommendation: "NEW",
  status: "approved",
  metric_snapshot_ids: [],
  serp_snapshot_ids: [],
  provenance: { source_type: "seed", source_url: null, confidence_note: null },
  vendor_cost_usd: null,
  researched_at: null,
  created_at: "2026-08-14T00:00:00Z",
  updated_at: null,
} as unknown as SearchOpportunity;

/** Same shape as withUrgency, on the block a fabricated claim would land in. */
function withIntentAnswer(body: string): PageSpec {
  const base = compilePageSpec(OPP, { now: NOW });
  return PageSpec.parse({
    ...base,
    content_blocks: base.content_blocks.map((b) =>
      b.kind === "intent_answer" ? { ...b, body_md: body } : b
    ),
  });
}

function withUrgency(body: string): PageSpec {
  const base = compilePageSpec(OPP, { now: NOW });
  return PageSpec.parse({
    ...base,
    content_blocks: base.content_blocks.map((b) =>
      b.kind === "when_urgency_changes" ? { ...b, body_md: body } : b
    ),
  });
}

describe("the urgency slot: sourced, and never pressure", () => {
  it("a freshly generated page passes both halves", () => {
    const spec = compilePageSpec(OPP, { now: NOW });
    expect(lintUrgencySlot(spec)).toEqual([]);
    expect(lintPageBeforeQa(spec).passed).toBe(true);
  });

  /** Issue 8's rule, exactly: the shipped kind + the shipped provenance field. */
  it("BLOCKS an urgency block that cites no fact bundle", () => {
    const base = compilePageSpec(OPP, { now: NOW });
    const unsourced = PageSpec.parse({
      ...base,
      content_blocks: base.content_blocks.map((b) =>
        b.kind === "when_urgency_changes" ? { ...b, source_fact_bundle_ids: [] } : b
      ),
    });
    const findings = lintUrgencySlot(unsourced);
    expect(findings).toHaveLength(1);
    expect(findings[0].check).toBe("urgency.sourced");
    expect(findings[0].severity).toBe("blocker");
    expect(lintPageBeforeQa(unsourced).passed).toBe(false);
  });

  it("BLOCKS fake scarcity", () => {
    const findings = lintUrgencySlot(withUrgency("Act now — limited-time emergency slots."));
    expect(findings.map((f) => f.check)).toContain("urgency.no_scarcity");
  });

  it("BLOCKS a countdown", () => {
    const findings = lintUrgencySlot(withUrgency("Book within 2 hours; this expires in 3 hours."));
    expect(findings.map((f) => f.check)).toContain("urgency.no_countdown");
  });

  it("BLOCKS unevidenced damage escalation", () => {
    const findings = lintUrgencySlot(
      withUrgency("This will only get worse and could cost you thousands.")
    );
    expect(findings.map((f) => f.check)).toContain("urgency.no_unevidenced_damage");
  });

  /**
   * THE LINE THE CANON RULE ACTUALLY DRAWS. Describing a hazard is not
   * manufacturing pressure — if the lint could not tell those apart it would
   * delete the safety guidance it exists to protect.
   */
  it("PASSES real safety guidance — every shipped family's urgency text", () => {
    for (const family of ["hvac", "plumbing", "electrical", null]) {
      const spec = compilePageSpec(
        { ...OPP, problem_family_hint: family, keyword: `test ${family ?? "generic"} problem` },
        { now: NOW }
      );
      expect(lintUrgencySlot(spec), family ?? "generic").toEqual([]);
    }
  });

  it("PASSES 'shut off the main', 'call 911', 'get people out'", () => {
    expect(
      lintUrgencySlot(
        withUrgency(
          "Urgent if water is actively spreading or near anything electrical. Shut off the main if you can reach it safely. If something is smoking, get people out and call 911."
        )
      )
    ).toEqual([]);
  });
});

describe("no directory framing, on any surface A05 writes", () => {
  it("a freshly generated page passes", () => {
    expect(lintDirectoryFraming(compilePageSpec(OPP, { now: NOW }))).toEqual([]);
  });

  it("BLOCKS breadth marketing in the meta description", () => {
    const base = compilePageSpec(OPP, { now: NOW });
    const spec = PageSpec.parse({
      ...base,
      meta_description: "Compare providers and choose from hundreds of trusted contractors.",
    });
    const findings = lintDirectoryFraming(spec);
    expect(findings[0].check).toBe("no_directory_framing");
    expect(findings[0].where).toBe("meta_description");
  });

  it("BLOCKS it in an internal-link LABEL — groupings are part of the surface", () => {
    const base = compilePageSpec(OPP, { now: NOW });
    const spec = PageSpec.parse({
      ...base,
      internal_links: [{ label: "Browse all problems we handle", path: "/problems" }],
    });
    const findings = lintDirectoryFraming(spec);
    expect(findings).toHaveLength(1);
    expect(findings[0].where).toBe("internal_links[0].label");
  });

  it("BLOCKS it in body copy", () => {
    const base = compilePageSpec(OPP, { now: NOW });
    const spec = PageSpec.parse({
      ...base,
      content_blocks: base.content_blocks.map((b) =>
        b.kind === "who_handles_it"
          ? { ...b, body_md: "Use our provider directory to shop around for the best price." }
          : b
      ),
    });
    expect(lintDirectoryFraming(spec).length).toBeGreaterThan(0);
  });

  it("PASSES the shipped who_handles_it copy — routing is not a directory", () => {
    for (const family of ["hvac", "plumbing", "electrical", null]) {
      const spec = compilePageSpec(
        { ...OPP, problem_family_hint: family, keyword: `test ${family ?? "generic"} thing` },
        { now: NOW }
      );
      expect(lintDirectoryFraming(spec), family ?? "generic").toEqual([]);
    }
    expect(lintDirectoryFraming(SAMPLE_PAGE_SPEC)).toEqual([]);
  });
});

describe("structured-data discipline exists BEFORE the surface does (C12c)", () => {
  it("no plan means nothing to check — A05 emits none today", () => {
    expect(compilePageSpec(OPP, { now: NOW }).structured_data_plan).toBeNull();
    expect(lintStructuredData(compilePageSpec(OPP, { now: NOW }))).toEqual([]);
  });

  it("BLOCKS LocalBusiness — PRN is not the contractor", () => {
    const spec = PageSpec.parse({
      ...compilePageSpec(OPP, { now: NOW }),
      structured_data_plan: "WebSite, BreadcrumbList, LocalBusiness",
    });
    const findings = lintStructuredData(spec);
    expect(findings.map((f) => f.message).join(" ")).toMatch(/LocalBusiness/);
  });

  it("BLOCKS unverified reviews, ratings and prices", () => {
    for (const type of ["Review", "AggregateRating", "Offer", "PriceSpecification"]) {
      const spec = PageSpec.parse({
        ...compilePageSpec(OPP, { now: NOW }),
        structured_data_plan: `WebSite, ${type}`,
      });
      expect(lintStructuredData(spec).length, type).toBeGreaterThan(0);
    }
  });

  it("BLOCKS any plan at all while the allow list is unratified", () => {
    const spec = PageSpec.parse({
      ...compilePageSpec(OPP, { now: NOW }),
      structured_data_plan: "WebSite",
    });
    const findings = lintStructuredData(spec);
    expect(findings.map((f) => f.check)).toContain("structured_data.no_allow_list");
  });

  it("an owner who ratifies an allow list can then use it", () => {
    const policy = PageFactoryPolicy.parse({
      structured_data: { allowed_types: ["WebSite", "BreadcrumbList"], denied_types: ["LocalBusiness"] },
    });
    const spec = PageSpec.parse({
      ...compilePageSpec(OPP, { now: NOW }),
      structured_data_plan: "WebSite, BreadcrumbList",
    });
    expect(lintStructuredData(spec, policy)).toEqual([]);
  });
});

/**
 * THE OTHER TWO THINGS A05 MAY NEVER INVENT.
 *
 * §7's list is four long — "prices, local statistics, testimonials or provider
 * claims" — and only prices and provider claims had a check anywhere in the
 * pipeline. The expected-outcome harness ran a fabricated local statistic and a
 * fabricated testimonial through BOTH gates and neither one blocked either
 * (NEVER-A05-1). These are the two that were missing, on A05's side.
 */
describe("invented evidence: statistics and testimonials", () => {
  it("a freshly generated page carries neither", () => {
    for (const family of ["hvac", "plumbing", "electrical", null]) {
      const spec = compilePageSpec(
        { ...OPP, problem_family_hint: family, keyword: `test ${family ?? "generic"} problem` },
        { now: NOW }
      );
      expect(lintInventedEvidence(spec), family ?? "generic").toEqual([]);
    }
  });

  const statistics = [
    "Nine out of ten homes in your area had this exact failure last winter.",
    "Roughly 40% of homes with this symptom need a full replacement.",
    "1 in 4 households on your street report the same fault.",
    "Hundreds of homeowners in your neighbourhood called about this last month.",
  ];
  for (const copy of statistics) {
    it(`BLOCKS the statistic: ${copy.slice(0, 38)}...`, () => {
      const findings = lintInventedEvidence(withIntentAnswer(copy));
      expect(findings.map((f) => f.check)).toContain("no_invented_statistic");
      expect(findings[0].severity).toBe("blocker");
      expect(lintPageBeforeQa(withIntentAnswer(copy)).passed).toBe(false);
    });
  }

  const testimonials = [
    '"They were fantastic" — a happy customer in your neighbourhood.',
    "See what our customers say about their first call.",
    "Rated 4.9 out of 5 by homeowners like you.",
    "A satisfied homeowner told us it was sorted the same afternoon.",
  ];
  for (const copy of testimonials) {
    it(`BLOCKS the testimonial: ${copy.slice(0, 38)}...`, () => {
      const findings = lintInventedEvidence(withIntentAnswer(copy));
      expect(findings.map((f) => f.check)).toContain("no_testimonial");
      expect(lintPageBeforeQa(withIntentAnswer(copy)).passed).toBe(false);
    });
  }

  /**
   * THE LINE, AGAIN. A hard blocker downstream has no waiver path, so a rule
   * that cannot tell a general fact from a claim about the reader's street does
   * not fail safe — it produces a page nobody can ship. Every line below is
   * ordinary guidance and must keep passing.
   */
  it("PASSES general guidance that is not a claim about the reader's street", () => {
    const innocent = [
      "Most homes have a main water shutoff near the meter or where the supply enters.",
      "Reset the breaker once at most; a breaker that re-trips is telling you something.",
      "If it has been soaked for more than a day, a restoration pro should look at it.",
      "Two things matter most: where the water comes from, and when.",
      "For a gas smell, leave first and call your utility or 911 from outside.",
    ];
    for (const copy of innocent) {
      expect(lintInventedEvidence(withIntentAnswer(copy)), copy).toEqual([]);
    }
  });

  it("the whole committed portfolio is clean of both", () => {
    for (const spec of loadStaged().specs) {
      expect(lintInventedEvidence(spec as PageSpec), spec.canonical_path).toEqual([]);
    }
  });
});

describe("the pre-filter is not a second publish gate (coherence issue 6)", () => {
  it("A05's lint never writes qa.state and never sets PASS", () => {
    // Comments stripped first: the module's header EXPLAINS the one-gate rule
    // by naming `qa.state === "PASS"`, and describing a gate you must not touch
    // is the opposite of touching it.
    const code = readFileSync(join(process.cwd(), "src/domain/search/page-lint.ts"), "utf-8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/qa\.state\s*=[^=]/);
    expect(code).not.toMatch(/"PASS"/);
  });

  it("A05's lint imports nothing from A06's qa module — no shared keyword list", () => {
    const source = readFileSync(join(process.cwd(), "src/domain/search/page-lint.ts"), "utf-8");
    const imports = [...source.matchAll(/^import[\s\S]*?from\s+"([^"]+)";$/gm)].map((m) => m[1]);
    expect(imports).not.toContain("@/domain/search/qa");
    expect(imports.some((i) => /\/qa$/.test(i))).toBe(false);
  });

  it("A06's qa module does not import A05's lint either — the split is recorded both ways", () => {
    const qa = readFileSync(join(process.cwd(), "src/domain/search/qa.ts"), "utf-8");
    expect(qa).not.toMatch(/page-lint/);
  });
});

/**
 * THE COMMITTED SIX, AGAINST THE PRE-FILTER THAT SHIPPED WITH THEM.
 *
 * WHAT THIS BLOCK USED TO SAY: they predate the provenance stub, carry empty
 * `source_fact_bundle_ids`, and are therefore "blocked only on the provenance
 * half" — recorded openly, with the fix named as a regeneration the owner
 * triggers. Inspection F1 is what that costs in practice: the OWNER'S EDIT PATH
 * runs this same lint, correctly and by design, so a lint every shipped page
 * failed meant the owner could not edit a single one of them. A guardrail that
 * blocks the whole product is not protecting anyone.
 *
 * The provenance ids were backfilled once (see a05.provenance.test.ts for why
 * the planned regeneration could not run). THE LINT IS UNCHANGED: the rule
 * still blocks an unsourced urgency block, asserted immediately below.
 */
describe("the committed portfolio against the pre-filter", () => {
  it("passes both halves now that its provenance is real", () => {
    for (const spec of loadStaged().specs) {
      expect(lintDirectoryFraming(spec as PageSpec), spec.canonical_path).toEqual([]);
      expect(lintUrgencySlot(spec as PageSpec), spec.canonical_path).toEqual([]);
      expect(lintPageBeforeQa(spec as PageSpec).passed, spec.canonical_path).toBe(true);
    }
  });

  it("the rule itself is NOT weakened — strip the ids and it blocks again", () => {
    const spec = loadStaged().specs[0] as PageSpec;
    const stripped: PageSpec = {
      ...spec,
      content_blocks: spec.content_blocks.map((b) => ({ ...b, source_fact_bundle_ids: [] })),
    };
    expect(lintUrgencySlot(stripped).map((f) => f.check)).toEqual(["urgency.sourced"]);
    expect(lintPageBeforeQa(stripped).passed).toBe(false);
  });

  it("regenerating one clears it — the pre-filter and the stub are one fix", () => {
    const regenerated = compilePageSpec(OPP, { now: NOW });
    expect(lintPageBeforeQa(regenerated).passed).toBe(true);
  });
});
