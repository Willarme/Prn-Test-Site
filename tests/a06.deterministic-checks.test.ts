import { describe, expect, it } from "vitest";
import { SAMPLE_PAGE_SPEC } from "@/domain/search/fixtures/sample-page-spec";
import { IntentPage, PageSpec } from "@/domain/search/pages";
import { loadStaged } from "@/platform/admin/data";
import {
  DEFAULT_PAGE_QA_POLICY,
  PageQaPolicy,
  runDeterministicStage,
  runPageQaSync,
} from "@/domain/search/qa";
import { qaIntentOverlap, qaIntentTokens, QA_INTENT_INTERNALS } from "@/domain/search/qa-intent";

/**
 * A06 STEP 2 — THE DETERMINISTIC RULE SET.
 *
 * Every check here is decidable from the PageSpec A06 was handed, with no
 * model, no network and no browser. The ones that are NOT decidable that way
 * live in a06.accessibility-and-performance.test.ts and report
 * SKIPPED_NOT_MEASURABLE rather than passing.
 */

const COMMITTED = loadStaged().specs as PageSpec[];

/** A distinct, valid page built off the sample so one field can be varied. */
function variant(overrides: Record<string, unknown>): PageSpec {
  return PageSpec.parse({
    ...SAMPLE_PAGE_SPEC,
    page_spec_id: "ps_variant",
    page_id: "page_variant",
    canonical_path: "/problems/variant-page",
    title: "Variant Page For A Deterministic Check",
    primary_query: "garage door opener remote unresponsive",
    intake_context: { ...SAMPLE_PAGE_SPEC.intake_context, page_id: "page_variant" },
    ...overrides,
  });
}

function findings(spec: PageSpec, context = {}) {
  return runDeterministicStage(spec, context).findings;
}

function checks(spec: PageSpec, context = {}): string[] {
  return findings(spec, context).map((f) => f.check);
}

describe("broken internal links — checked against the registry, fail closed", () => {
  const withLink = variant({
    internal_links: [{ label: "Related door", path: "/problems/ac-blowing-warm-air" }],
  });

  it("a link to a registry page that exists resolves clean", () => {
    const registry: IntentPage[] = [
      IntentPage.parse({
        page_id: "page_ac_blowing_warm_air",
        schema_version: "1.0.0",
        canonical_path: "/problems/ac-blowing-warm-air",
        current_page_spec_id: "ps_ac_blowing_warm_air_v1",
        lifecycle_status: "PUBLISHED",
        published_at: "2026-08-20T00:00:00Z",
        retired_at: null,
        redirect_to_path: null,
        created_at: "2026-08-14T00:00:00Z",
      }),
    ];
    expect(checks(withLink, { registry })).not.toContain("links.internal_resolvable");
  });

  it("a link to a page no registry row carries is a BLOCKER — not a silent pass", () => {
    const found = findings(withLink, { registry: [] as IntentPage[] }).filter(
      (f) => f.check === "links.internal_resolvable"
    );
    expect(found).toHaveLength(1);
    expect(found[0].severity).toBe("blocker");
    expect(found[0].message).toMatch(/broken internal link/);
    expect(found[0].repair_instructions).toBeTruthy();
  });

  it("a link to a RETIRED page is a blocker — a retired page is not a destination", () => {
    const registry: IntentPage[] = [
      IntentPage.parse({
        page_id: "page_ac_blowing_warm_air",
        schema_version: "1.0.0",
        canonical_path: "/problems/ac-blowing-warm-air",
        current_page_spec_id: "ps_ac_blowing_warm_air_v1",
        lifecycle_status: "RETIRED",
        published_at: null,
        retired_at: "2026-08-22T00:00:00Z",
        redirect_to_path: null,
        created_at: "2026-08-14T00:00:00Z",
      }),
    ];
    const found = findings(withLink, { registry }).filter(
      (f) => f.check === "links.internal_resolvable"
    );
    expect(found[0].severity).toBe("blocker");
    expect(found[0].message).toMatch(/RETIRED/);
  });

  /**
   * NOT VERIFIED IS NOT VERIFIED-GOOD. A run with no registry supplied cannot
   * resolve anything, so it says so rather than assuming the links are fine.
   */
  it("no registry supplied: reported as unverified, never assumed good", () => {
    const found = findings(withLink).filter((f) => f.check === "links.internal_resolvable");
    expect(found).toHaveLength(1);
    expect(found[0].message).toMatch(/could not be verified/);
  });

  it("a page with no links raises nothing either way", () => {
    expect(checks(variant({}))).not.toContain("links.internal_resolvable");
  });
});

describe("structured data — the allow list ships EMPTY, so any plan blocks", () => {
  it("no plan, no finding — which is every page PRN ships today", () => {
    expect(SAMPLE_PAGE_SPEC.structured_data_plan).toBeNull();
    expect(checks(SAMPLE_PAGE_SPEC)).not.toContain("structured_data.allow_list");
  });

  it("A05's parked decision is A06's blocker: an unratified plan cannot ship", () => {
    expect(DEFAULT_PAGE_QA_POLICY.structured_data_allowed_types).toEqual([]);
    const withPlan = variant({ structured_data_plan: "FAQPage + BreadcrumbList" });
    const found = findings(withPlan).filter((f) => f.check === "structured_data.allow_list");
    expect(found[0].severity).toBe("blocker");
    expect(found[0].message).toMatch(/allow list is EMPTY/);
  });

  it("a plan naming a denied type blocks on the type as well", () => {
    const withPlan = variant({ structured_data_plan: "LocalBusiness markup for the door" });
    expect(checks(withPlan)).toContain("structured_data.denied_type");
  });

  it("once an owner ratifies an allow list, a permitted plan stops blocking", () => {
    const policy = PageQaPolicy.parse({ structured_data_allowed_types: ["FAQPage"] });
    const withPlan = variant({ structured_data_plan: "FAQPage" });
    const raised = checks(withPlan, { policy });
    expect(raised).not.toContain("structured_data.allow_list");
    expect(raised).not.toContain("structured_data.denied_type");
  });
});

describe("star-rating markup is rejected wherever it appears", () => {
  it("in the structured-data plan", () => {
    const withPlan = variant({ structured_data_plan: 'AggregateRating with ratingValue 4.8' });
    const found = findings(withPlan).filter((f) => f.check === "structured_data.no_rating_markup");
    expect(found.length).toBeGreaterThan(0);
    expect(found[0].severity).toBe("blocker");
  });

  it("and in body copy, where a hand-written JSON-LD block would actually land", () => {
    const withMarkup = variant({
      content_blocks: SAMPLE_PAGE_SPEC.content_blocks.map((b, i) =>
        i === 0
          ? { ...b, body_md: `${b.body_md}\n\n<script>{"@type": "AggregateRating"}</script>` }
          : b
      ),
    });
    expect(checks(withMarkup)).toContain("structured_data.no_rating_markup");
  });
});

describe("intake embed and attribution", () => {
  it("the shipped pages carry both", () => {
    for (const spec of [SAMPLE_PAGE_SPEC, ...COMMITTED]) {
      const raised = checks(spec, { existing: [] });
      expect(raised, spec.page_spec_id).not.toContain("component.intake_embed");
      expect(raised, spec.page_spec_id).not.toContain("intake.attribution_matches");
    }
  });

  it("a page attributing intake to a DIFFERENT page blocks — events would misattribute", () => {
    const misattributed = variant({
      intake_context: { ...SAMPLE_PAGE_SPEC.intake_context, page_id: "page_someone_else" },
    });
    expect(checks(misattributed)).toContain("intake.attribution_matches");
  });

  it("a page whose template is not in the registry blocks on template.registered", () => {
    const unknownTemplate = variant({ template_id: "tpl_invented_by_nobody" });
    const found = findings(unknownTemplate).filter((f) => f.check === "template.registered");
    expect(found[0].severity).toBe("blocker");
  });
});

describe("duplicate canonical URL and duplicate title", () => {
  it("two specs on one path collide even when their ids differ", () => {
    const twin = PageSpec.parse({ ...SAMPLE_PAGE_SPEC, page_spec_id: "ps_twin" });
    expect(checks(twin, { existing: [SAMPLE_PAGE_SPEC] })).toContain("duplicate.canonical_path");
  });

  it("self-identity is by object reference, so a page never collides with itself", () => {
    expect(checks(SAMPLE_PAGE_SPEC, { existing: [SAMPLE_PAGE_SPEC] })).not.toContain(
      "duplicate.canonical_path"
    );
  });
});

describe("provenance.present is a REAL blocker now (coherence issue 7)", () => {
  it("every shipped page satisfies it — A05's backfill is what made it satisfiable", () => {
    for (const spec of [SAMPLE_PAGE_SPEC, ...COMMITTED]) {
      expect(checks(spec, { existing: [] }), spec.page_spec_id).not.toContain("provenance.present");
    }
  });

  it("a block citing no bundle FAILS", () => {
    const unsourced = variant({
      content_blocks: SAMPLE_PAGE_SPEC.content_blocks.map((b, i) =>
        i === 0 ? { ...b, source_fact_bundle_ids: [] } : b
      ),
    });
    const found = findings(unsourced).filter((f) => f.check === "provenance.present");
    expect(found[0].severity).toBe("blocker");
    expect(found[0].message).toMatch(/cites no fact bundle/);
  });

  it("an empty page-level source list FAILS", () => {
    const unsourced = variant({ source_fact_bundle_ids: [] });
    expect(checks(unsourced)).toContain("provenance.present");
  });

  it("a block citing a bundle the page does not list FAILS — page-level provenance must be complete", () => {
    const drifted = variant({
      content_blocks: SAMPLE_PAGE_SPEC.content_blocks.map((b, i) =>
        i === 0 ? { ...b, source_fact_bundle_ids: ["fb_not_on_the_page"] } : b
      ),
    });
    const found = findings(drifted).filter((f) => f.check === "provenance.present");
    expect(found.some((f) => /missing from the page/.test(f.message))).toBe(true);
  });
});

describe("template conformance via the shipped templateMatchesBlocks", () => {
  it("no shipped page drifts from the template it claims", () => {
    for (const spec of [SAMPLE_PAGE_SPEC, ...COMMITTED]) {
      expect(checks(spec, { existing: [] }), spec.page_spec_id).not.toContain("template.conformance");
    }
  });

  it("a page carrying an extra block drifts — and drift is MAJOR, not a blocker", () => {
    const drifted = variant({
      content_blocks: [
        ...SAMPLE_PAGE_SPEC.content_blocks,
        {
          block_id: "blk_extra",
          kind: "local_context",
          heading: "Extra",
          body_md: "An extra section the template never declared.",
          source_fact_bundle_ids: SAMPLE_PAGE_SPEC.source_fact_bundle_ids,
        },
      ],
    });
    const found = findings(drifted).filter((f) => f.check === "template.conformance");
    expect(found.length).toBeGreaterThan(0);
    /**
     * NO TEMPLATE IS OWNER-APPROVED. Melissa, verbatim: "I'm not approving these
     * templates yet." Blocking a page on drift from an UNAPPROVED shape would be
     * treating that shape as approved (pre-answer 2). A06 promotes this to a
     * blocker automatically once a TemplateSpec carries owner_approved: true.
     */
    expect(found.every((f) => f.severity === "major")).toBe(true);
    expect(runDeterministicStage(drifted).state).toBe("PASS");
  });
});

describe("cannibalization — A06's independent check (coherence issue 15)", () => {
  it("catches the same-need duplicate the shared pre-gate catches", () => {
    const rephrased = variant({
      canonical_path: "/problems/why-is-my-ac-not-turning-on",
      page_id: "page_rephrased",
      title: "Why Is My AC Not Turning On",
      primary_query: "why is my ac not turning on",
      intake_context: { ...SAMPLE_PAGE_SPEC.intake_context, page_id: "page_rephrased" },
    });
    const found = findings(rephrased, { existing: [SAMPLE_PAGE_SPEC] }).filter(
      (f) => f.check === "duplication.cannibalization"
    );
    expect(found[0].severity).toBe("blocker");
    // The verdict reports the MEASUREMENT and the threshold, so it is arguable.
    expect(found[0].message).toMatch(/similarity \d\.\d\d >= 0\.85/);
  });

  it("the seven shipped doors are all distinct intents under A06's own matcher", () => {
    const all = [SAMPLE_PAGE_SPEC, ...COMMITTED];
    for (const spec of all) {
      const raised = checks(spec, { existing: all.filter((s) => s !== spec) });
      expect(raised, spec.page_spec_id).not.toContain("duplication.cannibalization");
    }
  });

  it("polarity words are never dropped and never fuzzy-matched", () => {
    expect(qaIntentTokens("ac won't turn on")).toEqual(["ac", "~neg", "turn", "on"]);
    expect(qaIntentTokens("ac won't turn off")).toEqual(["ac", "~neg", "turn", "off"]);
    expect(qaIntentOverlap("ac won't turn on", "ac won't turn off", 0.85).overlaps).toBe(false);
    // The two word classes must stay disjoint or a polarity word could be eaten.
    for (const word of QA_INTENT_INTERNALS.POLARITY) {
      expect(QA_INTENT_INTERNALS.FUNCTION_WORDS.has(word), word).toBe(false);
    }
  });

  it("the negation marker cannot prefix-match anything", () => {
    expect(qaIntentOverlap("not heating", "nothing heating", 0.85).similarity).toBeLessThan(1);
    expect(qaIntentTokens("furnace not working")).toContain(QA_INTENT_INTERNALS.NEGATION);
  });
});

describe("the voice/claim checks are A06's OWN, run redundantly beside A05's pre-filter", () => {
  const cases: Array<[string, string]> = [
    ["voice.no_unsourced_price", "Most repairs cost about $250 in this area."],
    ["voice.no_manufactured_urgency", "Act now before it gets worse — don't wait."],
    ["voice.no_directory_framing", "Compare providers and choose from hundreds of contractors."],
    ["claims.no_unsupported_language", "We guarantee the cheapest fix, licensed and insured."],
    /**
     * The two families A05 §7 names that nothing checked until the
     * expected-outcome harness walked one of each through both gates and
     * neither stopped (NEVER-A05-1). A05 may never invent prices, local
     * statistics, testimonials or provider claims — all four now have a check.
     */
    ["claims.no_fabricated_statistic", "Nine out of ten homes in your area had this exact failure last winter."],
    ["claims.no_fabricated_statistic", "Roughly 40% of the homes near you are on the original pipework."],
    ["claims.no_testimonial", "\"They were fantastic\" — a happy customer in your neighbourhood."],
    ["claims.no_testimonial", "Read our customer reviews: rated 4.9 out of 5 across 300 reviews."],
  ];

  for (const [check, copy] of cases) {
    it(`${check} blocks on: ${copy.slice(0, 40)}...`, () => {
      const bad = variant({
        content_blocks: SAMPLE_PAGE_SPEC.content_blocks.map((b, i) =>
          i === 0 ? { ...b, body_md: `${b.body_md}\n\n${copy}` } : b
        ),
      });
      const found = findings(bad).filter((f) => f.check === check);
      expect(found.length, `${check} did not fire`).toBeGreaterThan(0);
      expect(found[0].severity).toBe("blocker");
    });
  }

  /**
   * PRE-ANSWER 5 (melissa-park). The verification-vocabulary standard is
   * Master Todo T2-07 (Melissa) and T7-01. A06's default is unchanged by this
   * build: detect the claim, emit the finding, route to human review, never
   * auto-pass and never auto-fail.
   */
  it("an unqualified verification claim is reported for HUMAN REVIEW, never auto-failed", () => {
    const claimy = variant({
      content_blocks: SAMPLE_PAGE_SPEC.content_blocks.map((b, i) =>
        i === 0 ? { ...b, body_md: `${b.body_md}\n\nOur verified providers handle this.` } : b
      ),
    });
    const found = findings(claimy).filter((f) => f.check === "voice.unqualified_verification_claim");
    expect(found).toHaveLength(1);
    expect(found[0].severity).toBe("major");
    expect(found[0].message).toMatch(/ROUTED TO HUMAN REVIEW/);
    expect(found[0].message).toMatch(/T2-07/);
    // Not auto-failed: the page is still deterministically PASS.
    expect(runDeterministicStage(claimy).state).toBe("PASS");
    // And not auto-passed either: the finding is on the record.
    expect(runPageQaSync(claimy).deterministic.findings.map((f) => f.check)).toContain(
      "voice.unqualified_verification_claim"
    );
  });

  it("ordinary safety copy about a trade does NOT trip the verification check", () => {
    for (const spec of [SAMPLE_PAGE_SPEC, ...COMMITTED]) {
      expect(checks(spec, { existing: [] }), spec.page_spec_id).not.toContain(
        "voice.unqualified_verification_claim"
      );
    }
  });
});

describe("severity is POLICY, not a constant compiled into the inspector (C8)", () => {
  it("a tenant can demote a blocker class without editing A06", () => {
    const unsourced = variant({ source_fact_bundle_ids: [] });
    expect(runDeterministicStage(unsourced).state).toBe("FAIL");

    const lenient = PageQaPolicy.parse({
      blocker_checks: DEFAULT_PAGE_QA_POLICY.blocker_checks.filter((c) => c !== "provenance.present"),
    });
    const relaxed = runDeterministicStage(unsourced, { policy: lenient });
    expect(relaxed.state).toBe("PASS");
    expect(relaxed.findings.find((f) => f.check === "provenance.present")!.severity).toBe("major");
  });

  it("a required check A06 does not implement is REPORTED, never silently skipped", () => {
    const policy = PageQaPolicy.parse({
      required_checks: ["provenance.present", "a11y.contrast_ratio_wcag_aaa"],
    });
    expect(runDeterministicStage(SAMPLE_PAGE_SPEC, { policy }).unknown_required_checks).toEqual([
      "a11y.contrast_ratio_wcag_aaa",
    ]);
  });
});
