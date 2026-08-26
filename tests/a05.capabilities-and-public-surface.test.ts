import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CAPABILITY_REGISTRY, resolveCapability } from "@/platform/capabilities/registry";
import { DEFAULT_FLAGS, flagEnabled } from "@/platform/flags";

/**
 * A05 steps 11 and 12 — capability aliases (C8 / pre-answer 8) and the public
 * staged listing (coherence report issue 16).
 */

describe("C8 — aliases on the shipped keys, not three new capabilities", () => {
  it("create_page_spec and update_page_spec resolve to seo.build_candidate_pages", () => {
    expect(resolveCapability("create_page_spec")?.capability_key).toBe("seo.build_candidate_pages");
    expect(resolveCapability("update_page_spec")?.capability_key).toBe("seo.build_candidate_pages");
  });

  it("NO new capability key was added", () => {
    const keys = CAPABILITY_REGISTRY.map((c) => c.capability_key);
    expect(keys).not.toContain("create_page_spec");
    expect(keys).not.toContain("update_page_spec");
    expect(keys).not.toContain("search_page_spec");
  });

  /**
   * The prior decision, recorded in the registry itself, rejects a separate
   * search capability ("Admin PageSpec search is an admin-UI query over the
   * registry, not a separate capability"). Aliasing it here would resurrect the
   * key that decision refused.
   */
  it("search_page_spec is deliberately NOT aliased", () => {
    expect(resolveCapability("search_page_spec")).toBeNull();
  });

  it("the entry now names its implementation and its owning agent", () => {
    const cap = resolveCapability("seo.build_candidate_pages")!;
    expect(cap.owning_agent_ids).toEqual(["A05"]);
    expect(cap.current_implementation).toBe("deterministic");
    expect(cap.implementation_ref).toMatch(/runPageFactory/);
  });

  it("A05's capability is still TEST, not LIVE — no wave gate was moved", () => {
    expect(resolveCapability("seo.build_candidate_pages")!.status).toBe("TEST");
  });

  it("the three A05-relevant seo keys are unchanged in risk class", () => {
    expect(resolveCapability("seo.build_candidate_pages")!.risk_class).toBe("R2");
    expect(resolveCapability("seo.qa_candidate_pages")!.risk_class).toBe("R0");
    expect(resolveCapability("seo.publish_page")!.risk_class).toBe("R4");
  });
});

describe("issue 16 — the public staged listing, hidden by owner ruling", () => {
  const homepage = readFileSync(join(process.cwd(), "src/app/page.tsx"), "utf-8");
  /**
   * Comments stripped for the leak scan. The homepage's own comment ENUMERATES
   * the fields that must never render there, and naming a thing to forbid it is
   * not rendering it — the same distinction A08's client-boundary test draws
   * about PolicyForm. The scan is about what the JSX emits.
   */
  const rendered = homepage.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  /**
   * WAS "DEFAULTS TO TODAY'S BEHAVIOUR" (true) — the A05 build's position that
   * a product decision is not a build decision, so the flag shipped ON and
   * waited for an owner. The owner ruled on 2026-08-25: hide it. The assertion
   * is re-pointed at the ruling, not relaxed — it is still an exact boolean on
   * the shipped default, and the surrounding guarantees (the flag exists, it
   * carries a decision ref, the homepage consults it) are unchanged.
   */
  it("the flag records the OWNER RULING — the listing is OFF", () => {
    expect(flagEnabled("staged_listing_public")).toBe(false);
    const flag = DEFAULT_FLAGS.find((f) => f.flag_key === "staged_listing_public")!;
    expect(flag.decision_ref).not.toBeNull();
  });

  it("the homepage consults it — both the query and the render", () => {
    expect(homepage).toMatch(/flagEnabled\("staged_listing_public"\)/);
    expect(homepage).toMatch(/showStagedListing \? await allStagedSpecs\(\) : \[\]/);
    expect(homepage).toMatch(/\{showStagedListing && \(/);
  });

  /**
   * THE RULE THAT HOLDS FLAG OR NO FLAG. The h1, the path and the QA STATE were
   * already public before this build. Nothing A05 or A06 added in Wave 2 may
   * join them.
   */
  it("nothing NEW from A05 or A06 can render on the public homepage", () => {
    for (const leak of [
      // NOT a bare /reasons/: the hero copy legitimately reads "suggest one
      // provider with reasons". The leak is the FIELD ACCESS, not the word.
      /qa\.reasons/,
      /\.reasons\b/,
      /source_fact_bundle_ids/,
      /user_value_score/,
      /lintPageBeforeQa|page-lint/,
      /findings/,
      /provenanceProblems|content-bank-provenance/,
      /opportunity_score|score_components/,
      /generation\./,
      /template_version/,
      /search_opportunity_id/,
      /**
       * EXTENDED BY A06's BUILD (condition C11, pre-answer 12). A06's verdicts
       * are richer than anything A05 produced — findings that quote a matched
       * fragment, repair instructions aimed at A05, a blocker list, a critic
       * status, the rule set's own version. All admin-only. The full sweep
       * across EVERY unauthenticated route is
       * tests/a06.public-exposure.test.ts; these keep the homepage pinned in the
       * same test A05 pinned it in.
       */
      /release_eligible|release_reasons/,
      /\bblockers\b/,
      /repair_instructions/,
      /ai_critic|heuristic_score/,
      /rule_set_version/,
      /checks_skipped|checks_run/,
      /page-qa-run|page-qa-gate|page-qa-critic/,
      /runPageQa|evaluateReleaseForPublish|qaCandidatePages/,
    ]) {
      expect(rendered, `homepage renders ${leak}`).not.toMatch(leak);
    }
  });

  it("the listing still shows exactly what it showed before: h1, path, QA state", () => {
    expect(homepage).toMatch(/\{s\.h1\}/);
    expect(homepage).toMatch(/s\.canonical_path\.replace/);
    expect(homepage).toMatch(/\{s\.qa\.state\}/);
  });

  it("/staged/[slug] still hardcodes robots noindex — layer one of the two-layer model", () => {
    const staged = readFileSync(join(process.cwd(), "src/app/staged/[slug]/page.tsx"), "utf-8");
    expect(staged).toMatch(/robots:\s*\{\s*index:\s*false,\s*follow:\s*false\s*\}/);
  });

  it("/problems/[slug] is still gated on seo_doors_enabled — layer two (flag ON by owner directive 2026-08-26, test environment; the gate code is the point)", () => {
    const problems = readFileSync(join(process.cwd(), "src/app/problems/[slug]/page.tsx"), "utf-8");
    expect(problems).toMatch(/seo_doors_enabled/);
    expect(flagEnabled("seo_doors_enabled")).toBe(true);
  });

  /**
   * ONE GATE, REWIRED BY A06 — coherence report issue 6, condition C10.
   *
   * A05's build asserted the shipped form: an owner session plus an inline
   * `spec.qa.state !== "PASS"` test, with "A05 added no second gate field beside
   * it". A06's build rewired that in the same commit it introduced
   * `release_eligible`, exactly as the condition requires: the route now reads
   * ONE boolean and `qa.state` is a conjunct INSIDE it. So this assertion
   * follows the gate rather than pinning its old spelling — what it must keep
   * proving is that there is exactly one condition, and that A05 still adds
   * nothing beside it.
   *
   * The 409 parity proof lives in tests/a06.one-publish-gate.test.ts.
   */
  it("the publish route gates on an owner session AND exactly one release condition", () => {
    const publish = readFileSync(
      join(process.cwd(), "src/app/api/admin/pages/publish/route.ts"),
      "utf-8"
    );
    // Comments stripped, same as the homepage scan above: the route's header
    // records what was removed, and naming it is not doing it.
    const code = publish.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).toMatch(/isAdminUnlocked\(\)/);
    expect(code).toMatch(/!decision\.release_eligible/);
    expect(code).toMatch(/status: 409/);
    // The old gate is GONE, not living beside the new one.
    expect(code).not.toMatch(/qa\.state/);
    // And A05 still adds nothing of its own here.
    expect(code).not.toMatch(/lint_passed|a05_|lintPageBeforeQa/);
  });
});
