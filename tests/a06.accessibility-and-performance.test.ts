import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SAMPLE_PAGE_SPEC } from "@/domain/search/fixtures/sample-page-spec";
import { PageSpec } from "@/domain/search/pages";
import { loadStaged } from "@/platform/admin/data";
import { NOT_MEASURABLE_CHECKS } from "@/domain/search/qa-accessibility";
import { PageQaPolicy, runDeterministicStage, runPageQaSync } from "@/domain/search/qa";

/**
 * A06 STEP 3 — ACCESSIBILITY AND PERFORMANCE, SCOPED HONESTLY (condition C12).
 *
 * The condition's whole point is that "accessibility/performance" must not
 * become a silent scope commitment: this repo has vitest and no headless
 * browser, no axe, nothing that can measure contrast or load time. So the
 * decision is split down the middle and BOTH halves are asserted here —
 * everything decidable from the markup is implemented and blocks; everything
 * that needs a browser reports SKIPPED_NOT_MEASURABLE and is never counted as a
 * pass.
 */

const COMMITTED = loadStaged().specs as PageSpec[];

function variant(overrides: Record<string, unknown>): PageSpec {
  return PageSpec.parse({
    ...SAMPLE_PAGE_SPEC,
    page_spec_id: "ps_a11y_variant",
    page_id: "page_a11y_variant",
    canonical_path: "/problems/a11y-variant",
    title: "Accessibility Variant Page",
    primary_query: "dishwasher not draining properly",
    intake_context: { ...SAMPLE_PAGE_SPEC.intake_context, page_id: "page_a11y_variant" },
    ...overrides,
  });
}

function withFirstBlockBody(body: string): PageSpec {
  return variant({
    content_blocks: SAMPLE_PAGE_SPEC.content_blocks.map((b, i) =>
      i === 0 ? { ...b, body_md: `${b.body_md}\n\n${body}` } : b
    ),
  });
}

function checks(spec: PageSpec, context = {}): string[] {
  return runDeterministicStage(spec, context).findings.map((f) => f.check);
}

describe("what IS measurable from the markup — implemented, and it blocks", () => {
  it("an image with no alt text blocks", () => {
    const spec = withFirstBlockBody("![](/media/breaker-panel.png)");
    const found = runDeterministicStage(spec).findings.filter(
      (f) => f.check === "a11y.image_alt_present"
    );
    expect(found).toHaveLength(1);
    expect(found[0].severity).toBe("blocker");
    expect(found[0].repair_instructions).toMatch(/alt text/);
  });

  it("an image WITH alt text does not", () => {
    expect(checks(withFirstBlockBody("![A breaker panel](/media/panel.png)"))).not.toContain(
      "a11y.image_alt_present"
    );
  });

  it("a second H1 inside a body blocks — the page already has one", () => {
    const found = runDeterministicStage(withFirstBlockBody("# Another top-level heading")).findings.filter(
      (f) => f.check === "a11y.no_second_h1"
    );
    expect(found[0].severity).toBe("blocker");
  });

  it("a heading level that jumps is reported (major) — outline order matters, but it is not a blocker", () => {
    const found = runDeterministicStage(
      withFirstBlockBody("### Fine\n\n##### Jumped two levels")
    ).findings.filter((f) => f.check === "a11y.heading_order");
    expect(found).toHaveLength(1);
    expect(found[0].severity).toBe("major");
    expect(found[0].message).toMatch(/h3 to h5/);
  });

  it("a link with no text blocks — nothing to announce and nothing to read", () => {
    const found = runDeterministicStage(withFirstBlockBody("[](/problems/ac-freezing-up)")).findings.filter(
      (f) => f.check === "a11y.link_text_non_empty"
    );
    expect(found[0].severity).toBe("blocker");
  });

  it("page weight is a PROXY and says so in its own message", () => {
    const policy = PageQaPolicy.parse({ max_markup_chars: 200 });
    const found = runDeterministicStage(SAMPLE_PAGE_SPEC, { policy }).findings.filter(
      (f) => f.check === "perf.page_weight_proxy"
    );
    expect(found).toHaveLength(1);
    expect(found[0].severity).toBe("major");
    expect(found[0].message).toMatch(/proxy for transfer weight, not a measurement of it/);
  });

  it("the seven shipped doors raise no accessibility finding at all", () => {
    for (const spec of [SAMPLE_PAGE_SPEC, ...COMMITTED]) {
      const raised = checks(spec, { existing: [] });
      for (const check of [
        "a11y.image_alt_present",
        "a11y.no_second_h1",
        "a11y.heading_order",
        "a11y.link_text_non_empty",
        "perf.page_weight_proxy",
      ]) {
        expect(raised, `${spec.page_spec_id} / ${check}`).not.toContain(check);
      }
    }
  });
});

describe("what is NOT measurable — reported skipped, never silently passed", () => {
  it("contrast, focus/screen-reader and load time are all on the skipped list", () => {
    expect(NOT_MEASURABLE_CHECKS.map((c) => c.check).sort()).toEqual([
      "a11y.color_contrast",
      "a11y.focus_and_screen_reader",
      "perf.load_time",
    ]);
  });

  it("every skipped check says WHY and what would be needed to measure it", () => {
    for (const skipped of NOT_MEASURABLE_CHECKS) {
      expect(skipped.status).toBe("SKIPPED_NOT_MEASURABLE");
      expect(skipped.why.length).toBeGreaterThan(40);
      expect(skipped.why).toMatch(/browser|accessibility tree|network/i);
    }
  });

  /** The discipline, stated as an assertion: a skipped check is not a passing check. */
  it("a skipped check never appears in checks_run and never counts as a pass", () => {
    const stage = runDeterministicStage(SAMPLE_PAGE_SPEC);
    for (const skipped of NOT_MEASURABLE_CHECKS) {
      expect(stage.checks_run).not.toContain(skipped.check);
      expect(stage.checks_skipped.map((s) => s.check)).toContain(skipped.check);
      expect(stage.findings.some((f) => f.check === skipped.check)).toBe(false);
    }
  });

  it("the skipped list travels on every result, including a PASS", () => {
    const result = runPageQaSync(SAMPLE_PAGE_SPEC);
    expect(result.state).toBe("PASS");
    expect(result.deterministic.checks_skipped).toHaveLength(NOT_MEASURABLE_CHECKS.length);
  });

  /**
   * The scope decision is DOCUMENTED, not just implemented. Condition C12 asks
   * for the budget to be explicit; this asserts the explanation exists where the
   * next reader will find it.
   */
  it("the scope decision is written down in the module that makes it", () => {
    const source = readFileSync(
      join(process.cwd(), "src/domain/search/qa-accessibility.ts"),
      "utf-8"
    );
    expect(source).toMatch(/THE SCOPE DECISION, WRITTEN DOWN/);
    expect(source).toMatch(/IMPLEMENTED —/);
    expect(source).toMatch(/SKIPPED, AND SAID SO —/);
    expect(source).toMatch(/A SKIPPED CHECK IS NOT A PASSING CHECK/);
  });

  it("A06 fakes no browser measurement — no axe, no puppeteer, no lighthouse anywhere in it", () => {
    for (const module of [
      "src/domain/search/qa.ts",
      "src/domain/search/qa-accessibility.ts",
      "src/domain/search/qa-critic.ts",
    ]) {
      const source = readFileSync(join(process.cwd(), module), "utf-8");
      expect(source, module).not.toMatch(/\b(axe-core|puppeteer|playwright|lighthouse|jsdom)\b/i);
    }
  });
});
