import { beforeEach, describe, expect, it } from "vitest";
import {
  capReached,
  clarifierCandidates,
  selectNextClarifierDeterministic,
} from "@/domain/problem/clarifier";
import { analyzeProblemFixture, type AnalyzeInput } from "@/domain/problem/fixture-engine";
import { findPlaybook, selectPlaybook } from "@/domain/intake/playbooks";
import { MODEL_CATALOGUE, type ModelConfig } from "@/platform/ai/models";
import { AiPolicy, DEFAULT_AI_POLICY } from "@/platform/ai/policy";
import { MemoryAiPolicyStore } from "@/platform/ai/policy-store";
import type { ModelCallResult, ModelProvider } from "@/platform/ai/provider";
import { MemorySpendLedger } from "@/platform/ai/spend";
import { capability_call } from "@/platform/gateway";
import { requirePolicyNumber } from "@/platform/policy/store";
import { classifyHomeProblem } from "@/platform/problem/ai-classify";
import {
  maxClarifyingQuestions,
  selectNextClarifier,
} from "@/platform/problem/ai-clarifier";
import { resetAgentRunLedgerForTests } from "@/platform/runs/ledger";
import { resetKillSwitchForTests } from "@/platform/killswitch";

/**
 * AI STEP 3 — A01's TWO CAPABILITIES.
 *
 * The two claims worth proving here, in order of how much damage getting them
 * wrong would do:
 *
 *   1. THE SAFETY GATE IS NOT REACHABLE BY THE MODEL. It runs first, it runs
 *      always, a hard stop stops the call entirely, and the safety fields on the
 *      record come from the deterministic pass whatever the model said.
 *   2. THE QUESTION CAP IS A BRANCH THE MODEL NEVER REACHES, not a rule it is
 *      asked to respect.
 *
 * And underneath both: with the flags off, the result is byte-identical to the
 * one that shipped.
 */

function provider(replies: ModelCallResult[]): { provider: ModelProvider; calls: number } {
  let index = 0;
  const state = { calls: 0 };
  const p: ModelProvider = {
    id: "fake",
    async complete() {
      state.calls += 1;
      const reply = replies[Math.min(index, replies.length - 1)];
      index += 1;
      return reply;
    },
  };
  return {
    provider: p,
    get calls() {
      return state.calls;
    },
  } as { provider: ModelProvider; calls: number };
}

function reply(raw: string): ModelCallResult {
  return {
    ok: true,
    raw,
    usage: { prompt_tokens: 200, completion_tokens: 80, total_tokens: 280, reported_cost_usd: 0 },
    generationId: "gen_a01",
    provider: "fake",
    attempts: 1,
  };
}

/**
 * A01's capabilities ON, and a model config that claims to be cleared for
 * customer data — which no REAL model is, because clearing one is an owner
 * decision. Everything except that clearance is the shipped policy.
 */
function a01Policy(): AiPolicy {
  return AiPolicy.parse({
    ...DEFAULT_AI_POLICY,
    enabled: true,
    capabilities: {
      ...DEFAULT_AI_POLICY.capabilities,
      classify_home_problem: {
        ...DEFAULT_AI_POLICY.capabilities.classify_home_problem,
        enabled: true,
      },
      select_next_clarifier: {
        ...DEFAULT_AI_POLICY.capabilities.select_next_clarifier,
        enabled: true,
      },
    },
  });
}

/**
 * A CATALOGUE WITH THE DEFAULT MODEL CLEARED FOR CUSTOMER DATA.
 *
 * This configuration does not exist in the shipped catalogue and this build does
 * not create it: clearing a model for a homeowner's own words is a
 * data-processing decision with legal weight and it belongs to the owners. It is
 * injected here for the same reason `estimateVendorCall` takes an injectable
 * rates list — so the MODEL PATH can be exercised at all. The test immediately
 * below this block proves that with the real catalogue the same call is refused.
 * (The cleared model is the CURRENT DEFAULT, deepseek/deepseek-v4-flash-0731,
 * chosen by the owner on 2026-08-27 — the injected clearance follows whatever is
 * the shipped default, so this fixture survives future swaps.)
 */
const CLEARED_CATALOGUE = MODEL_CATALOGUE.map((m) =>
  m.id === "deepseek/deepseek-v4-flash-0731" ? { ...m, allows_customer_data: true } : m
);

function deps(
  p: ModelProvider | null,
  policy: AiPolicy = a01Policy(),
  catalogue: readonly ModelConfig[] = CLEARED_CATALOGUE
) {
  return {
    provider: () => p,
    policyStore: new MemoryAiPolicyStore(policy),
    policy,
    catalogue,
    spend: new MemorySpendLedger(),
    now: () => new Date("2026-08-25T12:00:00Z"),
  };
}

const INPUT: AnalyzeInput = {
  description: "my ac runs but the house never gets cool, started two days ago",
  intake_session_id: "is_test",
  problem_family_hint: null,
  now: "2026-08-25T12:00:00Z",
};

beforeEach(() => {
  resetAgentRunLedgerForTests();
  resetKillSwitchForTests();
});

describe("classification: the safety gate is not something the model can reach", () => {
  it("a hard-stop safety rule means the model is NEVER CALLED", async () => {
    const p = provider([reply("{}")]);
    const outcome = await classifyHomeProblem(
      { ...INPUT, description: "I smell gas in the basement and the alarm is going off" },
      { deps: deps(p.provider) }
    );
    expect(outcome.engine).toBe("deterministic");
    expect(outcome.fallback_reason).toMatch(/hard stop/);
    expect(p.calls).toBe(0);
    expect(outcome.result.problem.safety_state).toBe("urgent");
    expect(outcome.result.problem.safety_rule_id).toBe("safety_gas");
  });

  it("the flood rule now hard-stops before a model can reclassify it (Melissa F1)", async () => {
    const p = provider([
      reply(
        JSON.stringify({
          service_category: "plumbing",
          service_category_confidence: "high",
          intent_cluster: "something entirely different",
          facts: [],
          reason: "model answer",
        })
      ),
    ]);
    const description = "there is standing water spreading across the basement floor";
    const outcome = await classifyHomeProblem(
      { ...INPUT, description },
      { deps: deps(p.provider) }
    );
    const baseline = analyzeProblemFixture({ ...INPUT, description });

    expect(outcome.engine).toBe("deterministic");
    expect(outcome.fallback_reason).toMatch(/hard stop/);
    expect(p.calls).toBe(0);
    // The model's proposed reclassification is never read on a hard stop.
    expect(outcome.result.problem.service_category).toBe(baseline.problem.service_category);
    expect(outcome.result.problem.safety_state).toBe(baseline.problem.safety_state);
    expect(outcome.result.problem.safety_rule_id).toBe(baseline.problem.safety_rule_id);
    expect(outcome.result.problem.safety_state).toBe("urgent");
    expect(outcome.result.problem.safety_rule_id).toBe("safety_flood_electric");
  });

  it("a model that tries to send safety fields has them ignored — the schema drops them", async () => {
    const p = provider([
      reply(
        JSON.stringify({
          service_category: "hvac",
          service_category_confidence: "high",
          intent_cluster: "ac not cooling",
          facts: [],
          reason: "ok",
          safety_state: "urgent",
          safety_rule_id: "safety_gas",
        })
      ),
    ]);
    const outcome = await classifyHomeProblem(
      INPUT,
      { deps: deps(p.provider) }
    );
    expect(outcome.engine).toBe("model");
    expect(p.calls).toBe(1);
    expect(outcome.result.problem.safety_state).toBe("normal");
    expect(outcome.result.problem.safety_rule_id).toBeNull();
  });
});

describe("classification: what the model may and may not assert", () => {
  it("every fact it returns is provenance `inferred` — the schema allows nothing else", async () => {
    const p = provider([
      reply(
        JSON.stringify({
          service_category: "hvac",
          service_category_confidence: "medium",
          intent_cluster: "ac runs but does not cool",
          facts: [
            { key: "system_type", value: "central air", confidence: "medium", provenance: "inferred" },
          ],
          reason: "described as running but not cooling",
        })
      ),
    ]);
    const outcome = await classifyHomeProblem(INPUT, { deps: deps(p.provider) });
    expect(outcome.engine).toBe("model");
    expect(outcome.facts).toHaveLength(1);
    expect(outcome.facts[0].provenance).toBe("inferred");
    expect(outcome.facts[0].confidence).toBe("medium");
  });

  it("a fact claiming to be OBSERVED fails the schema and the whole reply falls back", async () => {
    const p = provider([
      reply(
        JSON.stringify({
          service_category: "hvac",
          service_category_confidence: "high",
          intent_cluster: "x",
          facts: [{ key: "k", value: "v", confidence: "high", provenance: "observed" }],
          reason: "r",
        })
      ),
    ]);
    const outcome = await classifyHomeProblem(INPUT, { deps: deps(p.provider) });
    expect(outcome.engine).toBe("deterministic");
    expect(outcome.fallback_reason).toMatch(/invalid_after_repair/);
  });

  it("a trade outside the configured taxonomy fails the schema — no invented categories", async () => {
    const p = provider([
      reply(
        JSON.stringify({
          service_category: "landscaping",
          service_category_confidence: "high",
          intent_cluster: "x",
          facts: [],
          reason: "r",
        })
      ),
    ]);
    const outcome = await classifyHomeProblem(INPUT, { deps: deps(p.provider) });
    expect(outcome.engine).toBe("deterministic");
  });
});

describe("classification: the fallback contract, reason by reason", () => {
  const cases: Array<[string, ModelCallResult]> = [
    ["rate_limited", { ok: false, reason: "rate_limited", detail: "429", provider: "fake", attempts: 3 }],
    ["timeout", { ok: false, reason: "timeout", detail: "slow", provider: "fake", attempts: 1 }],
    ["refused", { ok: false, reason: "refused", detail: "filtered", provider: "fake", attempts: 1 }],
    ["http_error", { ok: false, reason: "http_error", detail: "500", provider: "fake", attempts: 3 }],
  ];

  for (const [label, result] of cases) {
    it(`${label} returns today's deterministic result, unchanged, with the reason recorded`, async () => {
      const p = provider([result]);
      const outcome = await classifyHomeProblem(INPUT, { deps: deps(p.provider) });
      expect(outcome.engine).toBe("deterministic");
      expect(outcome.fallback_reason).toContain(label);
      expect(outcome.result).toEqual(analyzeProblemFixture(INPUT));
    });
  }

  it("disabled (the shipped default) returns the deterministic result and calls nothing", async () => {
    const p = provider([reply("{}")]);
    const outcome = await classifyHomeProblem(INPUT, {
      deps: deps(p.provider, DEFAULT_AI_POLICY),
    });
    expect(outcome.engine).toBe("deterministic");
    expect(outcome.fallback_reason).toMatch(/^disabled/);
    expect(p.calls).toBe(0);
    expect(outcome.result).toEqual(analyzeProblemFixture(INPUT));
  });

  it("keyless returns the deterministic result", async () => {
    const outcome = await classifyHomeProblem(INPUT, { deps: deps(null) });
    expect(outcome.engine).toBe("deterministic");
    expect(outcome.fallback_reason).toMatch(/^no_key/);
    expect(outcome.result).toEqual(analyzeProblemFixture(INPUT));
  });

  it("PRIVACY: on an uncleared model it refuses before the wire", async () => {
    const p = provider([reply("{}")]);
    /**
     * The policy is ON, the key is present, and the call is still refused
     * because the named model is not cleared for customer data. Until
     * 2026-09-05 that was every seeded model; the owner's default now carries a
     * TEST-environment clearance (models.ts), so the uncleared model is named
     * here explicitly — the free stealth model, uncleared on the evidence alone.
     * What is being pinned is that the CONFIG decides, before any network call.
     */
    const policy = AiPolicy.parse({
      ...DEFAULT_AI_POLICY,
      enabled: true,
      capabilities: {
        ...DEFAULT_AI_POLICY.capabilities,
        classify_home_problem: {
          ...DEFAULT_AI_POLICY.capabilities.classify_home_problem,
          enabled: true,
          model_id: "stealth/ox-alpha",
        },
      },
    });
    const outcome = await classifyHomeProblem(INPUT, {
      // THE REAL, SHIPPED CATALOGUE — no clearance injected.
      deps: deps(p.provider, policy, MODEL_CATALOGUE),
    });
    expect(outcome.engine).toBe("deterministic");
    expect(outcome.fallback_reason).toMatch(/^privacy_refused/);
    expect(outcome.fallback_reason).toMatch(/allows_customer_data: false/);
    expect(p.calls).toBe(0);
    expect(outcome.result).toEqual(analyzeProblemFixture(INPUT));
  });
});

describe("the clarifier ceiling is a branch the model never reaches", () => {
  const playbook = selectPlaybook("my ac runs but the house never gets cool", "hvac");
  const cap = requirePolicyNumber("intake.max_clarifying_questions");

  it("the ceiling is policy, and the module reads it from there", () => {
    expect(maxClarifyingQuestions()).toBe(cap);
    expect(typeof cap).toBe("number");
  });

  it("at the ceiling, nothing is asked and no model is consulted", async () => {
    const p = provider([reply('{"field_key":"brand","why":"x"}')]);
    const outcome = await selectNextClarifier(
      { playbook, answered_field_keys: [], asked_count: cap, max_questions: cap },
      { deps: deps(p.provider) }
    );
    expect(outcome.ask).toBeNull();
    expect(outcome.engine).toBe("deterministic");
    expect(p.calls).toBe(0);
    expect(capReached(cap, cap)).toBe(true);
  });

  it("PAST the ceiling too — the guard is >=, not ===", async () => {
    const p = provider([reply('{"field_key":"brand","why":"x"}')]);
    const outcome = await selectNextClarifier(
      { playbook, answered_field_keys: [], asked_count: cap + 3, max_questions: cap },
      { deps: deps(p.provider) }
    );
    expect(outcome.ask).toBeNull();
    expect(p.calls).toBe(0);
  });

  it("the model can only pick from the playbook's own fields, and picks one", async () => {
    const candidates = clarifierCandidates(playbook, []);
    expect(candidates.length).toBeGreaterThan(1);
    const target = candidates[candidates.length - 1];

    const p = provider([
      reply(JSON.stringify({ field_key: target.field_key, why: "most decisive here" })),
    ]);
    const outcome = await selectNextClarifier(
      { playbook, answered_field_keys: [], asked_count: 0, max_questions: cap },
      { deps: deps(p.provider) }
    );
    expect(outcome.engine).toBe("model");
    expect(outcome.ask?.field_key).toBe(target.field_key);
    // The QUESTION TEXT is the playbook's, not the model's.
    expect(outcome.ask?.question).toBe(target.question);
  });

  it("a field key that is not a candidate fails the enum and falls back to the playbook order", async () => {
    const p = provider([reply('{"field_key":"something_invented","why":"x"}')]);
    const outcome = await selectNextClarifier(
      { playbook, answered_field_keys: [], asked_count: 0, max_questions: cap },
      { deps: deps(p.provider) }
    );
    expect(outcome.engine).toBe("deterministic");
    const expected = selectNextClarifierDeterministic({
      playbook,
      answered_field_keys: [],
      asked_count: 0,
      max_questions: cap,
    });
    expect(outcome.ask).toEqual(expected.ask);
  });

  it("with the flag off, the choice is the playbook's own order — CORE before HELPFUL", async () => {
    const outcome = await selectNextClarifier(
      { playbook, answered_field_keys: [], asked_count: 0, max_questions: cap },
      { deps: deps(null, DEFAULT_AI_POLICY) }
    );
    expect(outcome.engine).toBe("deterministic");
    expect(outcome.ask?.priority).toBe("core");
    expect(outcome.ask).toEqual(
      selectNextClarifierDeterministic({
        playbook,
        answered_field_keys: [],
        asked_count: 0,
        max_questions: cap,
      }).ask
    );
  });

  it("one remaining candidate is not a choice — no model is paid to confirm it", async () => {
    const all = playbook.required_fields.map((f) => f.field_key);
    const p = provider([reply('{"field_key":"x","why":"x"}')]);
    const outcome = await selectNextClarifier(
      {
        playbook,
        answered_field_keys: all.slice(0, all.length - 1),
        asked_count: 0,
        max_questions: cap,
      },
      { deps: deps(p.provider) }
    );
    expect(outcome.engine).toBe("deterministic");
    expect(outcome.ask?.field_key).toBe(all[all.length - 1]);
    expect(p.calls).toBe(0);
  });
});

describe("the capability finally has an executor — all three audit failures closed", () => {
  it("the gateway dispatches select_next_clarifier instead of erroring", async () => {
    const playbook = findPlaybook(
      selectPlaybook("my ac runs but the house never gets cool", "hvac").playbook_id
    )!;
    const result = await capability_call({
      agent_id: "A01",
      capability: "select_clarifying_questions",
      args: {
        playbook,
        answered_field_keys: [],
        asked_count: 0,
        max_questions: requirePolicyNumber("intake.max_clarifying_questions"),
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    const output = result.output as { ask: { field_key: string } | null };
    expect(output.ask).not.toBeNull();
  });
});
