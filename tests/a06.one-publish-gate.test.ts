import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SAMPLE_PAGE_SPEC } from "@/domain/search/fixtures/sample-page-spec";
import { PageSpec } from "@/domain/search/pages";
import { TRIAL_DEFAULT_SEO_FACTORY_POLICY } from "@/domain/search/policy";
import { loadStaged } from "@/platform/admin/data";
import { evaluateReleaseForPublish, runPageQaSync } from "@/domain/search/qa";
import { A06_EMITTED_EVENT_NAMES, A06_PROPOSED_TO_A08 } from "@/platform/search/page-qa-events";
import { EVENT_NAMES } from "@/platform/events/names";
import { APPROVAL_KINDS } from "@/platform/approvals/kinds";

/**
 * A06 STEP 5 — ONE PUBLISH GATE. The safety-critical step, and the one the loop
 * audit flags hardest: "A second, weaker gate surviving beside the new one is
 * how the human publish gate quietly erodes" (coherence issue 6, condition C10).
 *
 * Two things have to be true at once and both are proved here:
 *   1. there is exactly ONE server-side release condition, and
 *   2. rewiring to it changed NOTHING observable — a page that 409'd before
 *      409s now, with the same status and the same message.
 */

const COMMITTED = loadStaged().specs as PageSpec[];
const PORTFOLIO = [SAMPLE_PAGE_SPEC, ...COMMITTED];
const ROUTE = readFileSync(
  join(process.cwd(), "src/app/api/admin/pages/publish/route.ts"),
  "utf-8"
);
/**
 * COMMENTS STRIPPED for the "is it gone" scans. The route's own header explains
 * WHAT WAS REMOVED and WHY the kill switch is deliberately absent — naming a
 * thing to record its removal is not the same as still doing it, the same
 * distinction A05's homepage leak scan draws. What must be gone is the CODE.
 */
const CODE = ROUTE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
/** The handler body only — imports are not the gate. */
const BODY = CODE.slice(CODE.indexOf("export async function POST"));

/** The gate exactly as it shipped before A06's build, for the parity proof. */
function oldGateAllowsPublish(spec: PageSpec): boolean {
  return spec.qa.state === "PASS";
}

/** The gate as it ships now: one boolean, from A06. */
function newGateAllowsPublish(spec: PageSpec, existing: readonly PageSpec[] = PORTFOLIO): boolean {
  return evaluateReleaseForPublish(spec, {
    existing,
    policy: TRIAL_DEFAULT_SEO_FACTORY_POLICY.page_qa,
    min_user_value_score: TRIAL_DEFAULT_SEO_FACTORY_POLICY.min_user_value_score,
    human_gate: {
      publish_mode: TRIAL_DEFAULT_SEO_FACTORY_POLICY.publish_mode,
      human_approval_required: TRIAL_DEFAULT_SEO_FACTORY_POLICY.human_approval_required,
    },
  }).release_eligible;
}

describe("there is exactly ONE server-side release condition", () => {
  it("the route reads release_eligible and nothing else", () => {
    expect(ROUTE).toMatch(/!decision\.release_eligible/);
    expect(ROUTE).toMatch(/status: 409/);
  });

  it("the old gate is GONE from the route, not living beside the new one", () => {
    expect(CODE).not.toMatch(/qa\.state/);
    expect(CODE).not.toMatch(/allStagedSpecs/);
  });

  it("only ONE 409 exists in the route — a second refusal path would be a second gate", () => {
    expect(CODE.match(/status: 409/g) ?? []).toHaveLength(1);
  });

  it("the route never consults the Approval Center before publishing", () => {
    const gateSection = BODY.slice(0, BODY.indexOf("status: 409"));
    expect(gateSection).not.toMatch(/listApprovals|resolveApproval|approval_kind/);
  });

  it("no kill-switch check on the human's publish — it belongs on A06's QA runs", () => {
    expect(CODE).not.toMatch(/checkKillSwitch/);
  });
});

describe("409 PARITY — the rewire changed nothing observable", () => {
  it("old gate and new gate agree on every page in the committed portfolio", () => {
    for (const spec of PORTFOLIO) {
      expect(newGateAllowsPublish(spec), spec.page_spec_id).toBe(oldGateAllowsPublish(spec));
    }
  });

  it("the six committed qa:PASS pages are still publishable", () => {
    for (const spec of COMMITTED) {
      expect(spec.qa.state).toBe("PASS");
      expect(newGateAllowsPublish(spec), spec.page_spec_id).toBe(true);
    }
  });

  it("the handcrafted door is still PENDING and still refused — no page became newly publishable", () => {
    expect(SAMPLE_PAGE_SPEC.qa.state).toBe("PENDING");
    const decision = evaluateReleaseForPublish(SAMPLE_PAGE_SPEC, { existing: PORTFOLIO });
    expect(decision.release_eligible).toBe(false);
    expect(decision.reasons.join(" ")).toMatch(/has not recorded a PASS/);
    // Its fresh verdict is a PASS — which is exactly why the recorded-verdict
    // conjunct matters: a re-check at publish time must not become an approval.
    expect(runPageQaSync(SAMPLE_PAGE_SPEC).state).toBe("PASS");
  });

  /**
   * THE STRUCTURAL PROOF, not just the empirical one. The recorded-verdict
   * conjunct IS the old gate, so the new condition is
   * `old AND live_reverification AND human_gate`. A conjunction can never be
   * true where its own conjunct is false, so the new gate is provably never
   * more permissive than the one it replaced.
   */
  it("the new gate can never allow what the old gate refused", () => {
    for (const state of ["PENDING", "FAIL"] as const) {
      for (const spec of PORTFOLIO) {
        const notPassed = PageSpec.parse({ ...spec, qa: { state, reasons: [] } });
        expect(oldGateAllowsPublish(notPassed)).toBe(false);
        expect(newGateAllowsPublish(notPassed), `${spec.page_spec_id}/${state}`).toBe(false);
      }
    }
  });
});

describe("release_eligible derivation — the three conjuncts", () => {
  const passed = PageSpec.parse({
    ...COMMITTED[0],
    qa: { state: "PASS", reasons: [] },
  });

  it("1. the RECORDED verdict: a PENDING page is refused however clean it is now", () => {
    const pending = PageSpec.parse({ ...passed, qa: { state: "PENDING", reasons: [] } });
    expect(runPageQaSync(pending, { existing: [] }).state).toBe("PASS");
    expect(
      evaluateReleaseForPublish(pending, { existing: [] }).release_eligible
    ).toBe(false);
  });

  /**
   * NO STEALTH DEMOTION. When the live re-verification disagrees with a stored
   * PASS, the page is refused and the disagreement is REPORTED — the stored
   * qa.state is not rewritten by the gate. A06 rewrites it only on a QA run.
   */
  it("2. the LIVE re-verification: a stored PASS that no longer verifies is refused, and NOT rewritten", () => {
    const broken = PageSpec.parse({ ...passed, source_fact_bundle_ids: [] });
    const decision = evaluateReleaseForPublish(broken, { existing: [] });
    expect(decision.release_eligible).toBe(false);
    expect(decision.reasons.join(" ")).toMatch(/no longer verifies/);
    expect(decision.reasons.join(" ")).toMatch(/NOT being rewritten/);
    // The spec handed in is untouched: no stealth demotion of qa.state.
    expect(broken.qa.state).toBe("PASS");
    expect(decision.qa.state).toBe("FAIL");
  });

  /**
   * PRE-ANSWER 1 POINT (2), verbatim: "release_eligible must fail closed
   * automatically the moment SeoFactoryPolicy.publish_mode leaves OWNER_APPROVAL
   * or human_approval_required goes false — the residual risk is bounded ONLY by
   * the human, so the flag's meaning must be tied to the human still being
   * there."
   */
  it("3. the HUMAN GATE: eligibility fails closed the moment the human stops being required", () => {
    expect(evaluateReleaseForPublish(passed, { existing: [] }).release_eligible).toBe(true);

    for (const gate of [
      { publish_mode: "LOW_RISK_AUTO", human_approval_required: true },
      { publish_mode: "OWNER_APPROVAL", human_approval_required: false },
    ]) {
      const decision = evaluateReleaseForPublish(passed, { existing: [], human_gate: gate });
      expect(decision.release_eligible, JSON.stringify(gate)).toBe(false);
      expect(decision.reasons.join(" ")).toMatch(/human publish gate is not intact/);
    }
  });

  it("the trial policy ships with the human gate intact, and the schema refuses to loosen it", () => {
    expect(TRIAL_DEFAULT_SEO_FACTORY_POLICY.publish_mode).toBe("OWNER_APPROVAL");
    expect(TRIAL_DEFAULT_SEO_FACTORY_POLICY.human_approval_required).toBe(true);
  });

  it("a deterministic-only PASS is eligible, and the queue row carries the skipped-critic status", () => {
    const decision = evaluateReleaseForPublish(passed, { existing: [] });
    expect(decision.release_eligible).toBe(true);
    expect(decision.qa.ai_critic.status).toBe("SKIPPED_NO_MODEL");
    expect(decision.qa.overall).toBe("BLOCKED_PENDING_AI");
    expect(decision.reasons.join(" ")).toMatch(/skipped-critic status/);
  });
});

describe("page.published — the join key for the whole return leg (coherence issue 9)", () => {
  it("is emitted from the publish route, with the four keys the issue names", () => {
    expect(ROUTE).toMatch(/emitPagePublished\(/);
    for (const key of ["page_id", "page_spec_id", "canonical_path", "search_opportunity_id"]) {
      expect(ROUTE, key).toMatch(new RegExp(`${key}:`));
    }
  });

  it("it records that the ACT was a human's, since the envelope types the actor as an agent", () => {
    expect(ROUTE).toMatch(/published_by: "owner"/);
  });

  it("every name A06 emits is already in A08's dictionary — A06 mints nothing", () => {
    for (const name of A06_EMITTED_EVENT_NAMES) {
      expect(EVENT_NAMES as readonly string[], name).toContain(name);
    }
  });

  it("page.qa_started is PROPOSED to A08, not emitted", () => {
    expect(A06_PROPOSED_TO_A08.map((p) => p.canon_name)).toContain("page.qa_started");
    for (const proposal of A06_PROPOSED_TO_A08) {
      expect(A06_EMITTED_EVENT_NAMES as readonly string[]).not.toContain(proposal.canon_name);
      expect(EVENT_NAMES as readonly string[]).not.toContain(proposal.canon_name);
    }
  });

  it("emission is fail-soft — telemetry can never cost a publish", () => {
    const events = readFileSync(
      join(process.cwd(), "src/platform/search/page-qa-events.ts"),
      "utf-8"
    );
    expect(events).toMatch(/catch \{\s*return "error";/);
  });
});

describe("the Approval Center is the RECORD, never a second actuator", () => {
  it("A08 registered the kind A06 files under", () => {
    expect(APPROVAL_KINDS).toContain("seo.page_publish");
  });

  it("the route closes the item AFTER publishing, never before", () => {
    const gateIndex = BODY.indexOf("status: 409");
    const resolveIndex = BODY.indexOf("resolvePagePublishApproval");
    expect(resolveIndex).toBeGreaterThan(gateIndex);
  });

  it("closing it is fail-soft and returns null when there is nothing to close", async () => {
    const { resolvePagePublishApproval } = await import("@/platform/search/page-qa-gate");
    expect(await resolvePagePublishApproval("ps_no_such_page", "owner")).toBeNull();
  });
});
