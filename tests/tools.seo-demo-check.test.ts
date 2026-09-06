import { describe, expect, it } from "vitest";
import { seoDemoPassed } from "../tools/demo-seo-check";

function evidence() {
  return {
    factory: { staged: 1, copy_runs: [{ engine: "model" }] },
    qa: { results: [{ state: "PASS", overall: "PASS", release_eligible: true, ai_critic: { status: "PASS" } }] },
    repeat: { staged: 0, copy_runs: [] as { engine: string }[] },
  };
}

describe("synthetic SEO smoke success requires the whole gate", () => {
  it("accepts one model-written page with a complete passing QA result and a no-work repeat", () => {
    expect(seoDemoPassed(evidence())).toBe(true);
  });

  it.each([
    { state: "FAIL" },
    { overall: "FAIL" },
    { overall: "BLOCKED_PENDING_AI" },
    { release_eligible: false },
    { ai_critic: { status: "FAIL" } },
    { ai_critic: { status: "SKIPPED_NO_MODEL" } },
  ])("refuses a partial QA success: %j", patch => {
    const report = evidence();
    Object.assign(report.qa.results[0], patch);
    expect(seoDemoPassed(report)).toBe(false);
  });

  it("refuses an absent or empty QA result", () => {
    expect(seoDemoPassed({ ...evidence(), qa: null })).toBe(false);
    expect(seoDemoPassed({ ...evidence(), qa: { results: [] } })).toBe(false);
  });

  it("refuses a repeated writer call even when no duplicate page was staged", () => {
    for (const engine of ["model", "content_bank"]) {
      const report = evidence();
      report.repeat.copy_runs.push({ engine });
      expect(seoDemoPassed(report)).toBe(false);
    }
  });

  it("refuses fallback copy or duplicate staging", () => {
    const fallback = evidence();
    fallback.factory.copy_runs[0].engine = "content_bank";
    expect(seoDemoPassed(fallback)).toBe(false);
    const duplicate = evidence();
    duplicate.repeat.staged = 1;
    expect(seoDemoPassed(duplicate)).toBe(false);
  });
});
