import { existsSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { selectPlaybook } from "@/domain/intake/playbooks";
import { selectNextClarifierDeterministic } from "@/domain/problem/clarifier";
import { analyzeProblemFixture, type AnalyzeInput } from "@/domain/problem/fixture-engine";
import { contentBankBundle } from "@/domain/search/content-bank-provenance";
import { SAMPLE_PAGE_SPEC } from "@/domain/search/fixtures/sample-page-spec";
import type { PageSpec } from "@/domain/search/pages";
import { runPageQa, runPageQaSync } from "@/domain/search/qa";
import { aiPolicyStore } from "@/platform/ai/policy-store";
import type { ModelProvider } from "@/platform/ai/provider";
import { MemorySpendLedger } from "@/platform/ai/spend";
import { classifyHomeProblem } from "@/platform/problem/ai-classify";
import { selectNextClarifier } from "@/platform/problem/ai-clarifier";
import { requirePolicyNumber } from "@/platform/policy/store";
import { generatePageCopy } from "@/platform/search/ai-page-copy";
import { createModelPageCritic, criticEnabled } from "@/platform/search/page-qa-critic";
import { runPageQaBatch } from "@/platform/search/page-qa-run";
import { resetKillSwitchForTests } from "@/platform/killswitch";
import { resetAgentRunLedgerForTests } from "@/platform/runs/ledger";

/**
 * NOTHING CUSTOMER-VISIBLE CHANGES WITH THE FLAGS OFF — proved by making a model
 * call impossible to miss.
 *
 * Asserting "the output looks the same" is weak: it passes for a system that
 * called a model and happened to get an answer that matched. So the provider
 * installed below THROWS. If any entry point in this build reaches a model while
 * the shipped policy is in force, the test does not compare outputs — it
 * explodes, naming the caller.
 *
 * The policy under test is the REAL one: `aiPolicyStore()` reading the committed
 * repo state. There is no data/ai-policy.json in a fresh checkout, so the
 * document is absent, so the shipped defaults apply, so everything is off.
 *
 * 2026-08-26, OWNER DIRECTIVE (Josh): the engine may be ON in a live test
 * environment via the runtime policy document (data/ai-policy.json, now
 * gitignored). When that document EXISTS, this checkout is deliberately not in
 * the shipped state, and the all-off suite below would be asserting the wrong
 * fact — so it yields, loudly saying so. A fresh checkout (no document) still
 * runs every assertion, and the guarantee for fresh deployments is untouched.
 */

const OWNER_POLICY_PRESENT = existsSync(join(process.cwd(), "data", "ai-policy.json"));

const BOOBY_TRAP: ModelProvider = {
  id: "booby-trap",
  async complete() {
    throw new Error(
      "A MODEL WAS CALLED WITH THE FLAGS OFF. Some path reached a provider without passing the enablement gate."
    );
  },
};

/** Real policy store, real (absent) document, booby-trapped provider. */
function shippedDeps() {
  return {
    provider: () => BOOBY_TRAP,
    policyStore: aiPolicyStore(),
    spend: new MemorySpendLedger(),
  };
}

const INPUT: AnalyzeInput = {
  description: "my ac runs but the house never gets cool, started two days ago",
  intake_session_id: "is_parity",
  problem_family_hint: null,
  now: "2026-08-25T12:00:00Z",
};

const BUNDLE = contentBankBundle(
  "hvac",
  {
    intent_answer: "A cooling system that runs without cooling traces to power, controls or airflow.",
    safe_checks: "Check the thermostat and the filter.",
    do_not_do: "Do not open the outdoor unit.",
    when_urgency_changes: "A burning smell means stop.",
    who_handles_it: "A heating and cooling technician.",
  },
  { geography: { mode: "national", country: "US" }, created_at: "2026-08-25T00:00:00Z" }
);

beforeEach(() => {
  resetAgentRunLedgerForTests();
  resetKillSwitchForTests();
});

describe("the shipped configuration is OFF, everywhere", () => {
  it("the active policy document is the defaults, and the defaults are off", async () => {
    if (OWNER_POLICY_PRESENT) {
      console.warn(
        "[flags-off-parity] data/ai-policy.json exists — this environment is ON by owner " +
          "directive 2026-08-26; the all-off assertions are skipped (fresh checkouts still run them)."
      );
      return;
    }
    const policy = await aiPolicyStore().getActive();
    expect(policy.enabled).toBe(false);
    for (const [key, cap] of Object.entries(policy.capabilities)) {
      expect(cap.enabled, key).toBe(false);
    }
  });

  it("the critic is registered and not enabled", async () => {
    if (OWNER_POLICY_PRESENT) return; // engine ON here by owner directive — see header note
    expect(await criticEnabled()).toBe(false);
  });
});

describe("no entry point can reach a model with the flags off", () => {
  // Every test in this block proves no path reaches a model while the SHIPPED
  // policy is in force. With an owner policy document present the engine is
  // deliberately ON, and the booby-trap premise is void — skip loudly.
  beforeEach(() => {
    if (OWNER_POLICY_PRESENT) {
      console.warn(
        "[flags-off-parity] owner policy document present — model-reach assertions skipped."
      );
    }
  });

  it("A01 classification returns the fixture engine's answer, untouched", async () => {
    if (OWNER_POLICY_PRESENT) return;
    const outcome = await classifyHomeProblem(INPUT, { deps: shippedDeps() });
    expect(outcome.engine).toBe("deterministic");
    expect(outcome.result).toEqual(analyzeProblemFixture(INPUT));
    expect(outcome.facts).toEqual([]);
  });

  it("A01 clarifier returns the playbook's own order, untouched", async () => {
    if (OWNER_POLICY_PRESENT) return;
    const playbook = selectPlaybook("my ac runs but the house never gets cool", "hvac");
    const cap = requirePolicyNumber("intake.max_clarifying_questions");
    const args = {
      playbook,
      answered_field_keys: [] as string[],
      asked_count: 0,
      max_questions: cap,
    };
    const outcome = await selectNextClarifier(args, { deps: shippedDeps() });
    expect(outcome.engine).toBe("deterministic");
    expect(outcome.ask).toEqual(selectNextClarifierDeterministic(args).ask);
  });

  it("A05 copy generation returns the content bank's page, byte for byte", async () => {
    if (OWNER_POLICY_PRESENT) return;
    const outcome = await generatePageCopy(SAMPLE_PAGE_SPEC, [BUNDLE], { deps: shippedDeps() });
    expect(outcome.engine).toBe("content_bank");
    expect(outcome.spec).toEqual(SAMPLE_PAGE_SPEC);
  });

  it("A06's critic reports SKIPPED_NO_MODEL on every committed staged page", async () => {
    if (OWNER_POLICY_PRESENT) return;
    const { loadStaged } = await import("@/platform/admin/data");
    const specs = [SAMPLE_PAGE_SPEC, ...(loadStaged().specs as PageSpec[])];
    const critic = createModelPageCritic({ deps: shippedDeps() });
    for (const spec of specs) {
      const result = await runPageQa(spec, {
        existing: specs.filter((s) => s !== spec),
        critic,
      });
      expect(result.ai_critic.status, spec.page_spec_id).toBe("SKIPPED_NO_MODEL");
      expect(result.ai_critic.cost_usd, spec.page_spec_id).toBeNull();
    }
  });

  it("the A06 run mode skips the critic stage entirely — no page pays for a refused call", async () => {
    if (OWNER_POLICY_PRESENT) return;
    const { loadStaged } = await import("@/platform/admin/data");
    const specs = (loadStaged().specs as PageSpec[]).slice(0, 3);
    const run = await runPageQaBatch({ specs, trigger: "admin_action", persist: false });
    expect(run.results.length).toBe(specs.length);
    for (const result of run.results) {
      expect(result.ai_critic.status, result.page_spec_id).toBe("SKIPPED_NO_MODEL");
    }
  });
});

describe("the verdicts themselves are unchanged", () => {
  it("every committed staged page produces the same verdict the sync path always gave", async () => {
    if (OWNER_POLICY_PRESENT) return; // critic runs for real in this environment
    const { loadStaged } = await import("@/platform/admin/data");
    const specs = (loadStaged().specs as PageSpec[]).slice(0, 5);
    for (const spec of specs) {
      const others = specs.filter((s) => s !== spec);
      const sync = runPageQaSync(spec, { existing: others });
      const withCritic = await runPageQa(spec, {
        existing: others,
        critic: createModelPageCritic({ deps: shippedDeps() }),
      });
      expect(withCritic.state, spec.page_spec_id).toBe(sync.state);
      expect(withCritic.overall, spec.page_spec_id).toBe(sync.overall);
      expect(withCritic.release_eligible, spec.page_spec_id).toBe(sync.release_eligible);
      expect(withCritic.user_value_score, spec.page_spec_id).toBe(sync.user_value_score);
      expect(withCritic.reasons, spec.page_spec_id).toEqual(sync.reasons);
    }
  });
});
