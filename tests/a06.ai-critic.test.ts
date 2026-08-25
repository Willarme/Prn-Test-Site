import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { SAMPLE_PAGE_SPEC } from "@/domain/search/fixtures/sample-page-spec";
import {
  STUB_CRITIC_PATTERN_IDS,
  stubVoiceCritic,
} from "@/domain/search/fixtures/stub-ai-critic";
import { PageSpec } from "@/domain/search/pages";
import {
  criticPassed,
  DEFAULT_PAGE_QA_POLICY,
  deterministicHeuristicScore,
  PageQaPolicy,
  runPageQa,
  runPageQaSync,
  type AICritic,
} from "@/domain/search/qa";
import {
  criticCapabilityRegistered,
  criticEnabled,
  modelPageCritic,
  PAGE_CRITIC_CAPABILITY,
} from "@/platform/search/page-qa-critic";
import { CAPABILITY_REGISTRY } from "@/platform/capabilities/registry";

/**
 * A06 STEP 4 — THE AI CRITIC, AND THE RECLASSIFICATION OF THE ONE THAT WAS
 * PRETENDING TO BE ONE (conditions C3 and C4).
 */

function variant(overrides: Record<string, unknown>): PageSpec {
  return PageSpec.parse({
    ...SAMPLE_PAGE_SPEC,
    page_spec_id: "ps_critic_variant",
    page_id: "page_critic_variant",
    canonical_path: "/problems/critic-variant",
    title: "Critic Variant Page",
    primary_query: "sump pump running constantly",
    intake_context: { ...SAMPLE_PAGE_SPEC.intake_context, page_id: "page_critic_variant" },
    ...overrides,
  });
}

function withCopy(copy: string): PageSpec {
  return variant({
    content_blocks: SAMPLE_PAGE_SPEC.content_blocks.map((b, i) =>
      i === 0 ? { ...b, body_md: `${b.body_md}\n\n${copy}` } : b
    ),
  });
}

describe("with no model configured — SKIPPED_NO_MODEL, and it is never a pass", () => {
  /**
   * WHAT THIS USED TO ASSERT: "no critic capability is registered, so nothing is
   * wired." True until 2026-08-25, when one was implemented and registered.
   *
   * The protection moves to the distinction that carries the weight now:
   * REGISTRATION IS NOT ENABLEMENT. A registered contract must never silently
   * start a stage, so the run mode asks whether the critic is ENABLED, and it
   * ships off. Everything below this line — SKIPPED_NO_MODEL on every real page,
   * never a pass, never invoked after a deterministic blocker — is unchanged and
   * still passing, which is the actual claim worth making.
   */
  it("a critic capability is registered, and it is OFF", async () => {
    expect(criticCapabilityRegistered()).toBe(true);
    expect(CAPABILITY_REGISTRY.map((c) => c.capability_key)).toContain(PAGE_CRITIC_CAPABILITY);
    expect(await criticEnabled()).toBe(false);
  });

  it("the gateway adapter reports SKIPPED_NO_MODEL and says what that does NOT mean", async () => {
    const result = await modelPageCritic.critique({
      page_spec_id: SAMPLE_PAGE_SPEC.page_spec_id,
      primary_query: SAMPLE_PAGE_SPEC.primary_query,
      title: SAMPLE_PAGE_SPEC.title,
      meta_description: SAMPLE_PAGE_SPEC.meta_description,
      h1: SAMPLE_PAGE_SPEC.h1,
      hero_headline: SAMPLE_PAGE_SPEC.hero.headline,
      hero_subheadline: SAMPLE_PAGE_SPEC.hero.subheadline,
      blocks: SAMPLE_PAGE_SPEC.content_blocks,
    });
    expect(result.status).toBe("SKIPPED_NO_MODEL");
    expect(result.reason).toMatch(/NOT a pass/);
    expect(result.cost_usd).toBeNull();
  });

  it("SKIPPED_NO_MODEL is not a pass, by the one predicate every reader shares", () => {
    expect(criticPassed("SKIPPED_NO_MODEL")).toBe(false);
    expect(criticPassed("NOT_RUN")).toBe(false);
    expect(criticPassed("FAIL")).toBe(false);
    expect(criticPassed("PASS")).toBe(true);
  });

  it("a deterministically clean page reads BLOCKED_PENDING_AI, never a bare green PASS", async () => {
    const result = await runPageQa(SAMPLE_PAGE_SPEC, { critic: modelPageCritic });
    expect(result.deterministic.state).toBe("PASS");
    expect(result.ai_critic.status).toBe("SKIPPED_NO_MODEL");
    expect(result.overall).toBe("BLOCKED_PENDING_AI");
    // Pre-answer 1: still eligible, because a HUMAN publishes every page.
    expect(result.release_eligible).toBe(true);
    expect(result.release_reasons.join(" ")).toMatch(/skipped-critic status/);
  });

  it("after this build, every real page's ai_critic status is SKIPPED_NO_MODEL", async () => {
    const { loadStaged } = await import("@/platform/admin/data");
    const all = [SAMPLE_PAGE_SPEC, ...(loadStaged().specs as PageSpec[])];
    for (const spec of all) {
      const result = await runPageQa(spec, {
        existing: all.filter((s) => s !== spec),
        critic: modelPageCritic,
      });
      expect(result.ai_critic.status, spec.page_spec_id).toBe("SKIPPED_NO_MODEL");
    }
  });
});

describe("the critic is NEVER invoked when the deterministic stage already blocked", () => {
  it("critique() is not called at all — a failed page never pays for a critic", async () => {
    const critique = vi.fn();
    const spy: AICritic = { id: "spy", critique: critique as never };
    const broken = variant({ source_fact_bundle_ids: [] });

    const result = await runPageQa(broken, { critic: spy });

    expect(result.deterministic.state).toBe("FAIL");
    expect(critique).not.toHaveBeenCalled();
    expect(result.ai_critic.status).toBe("NOT_RUN");
    expect(result.ai_critic.reason).toMatch(/never pays for a critic/);
  });

  it("and it IS called when the deterministic stage passes", async () => {
    const critique = vi.fn().mockResolvedValue({
      status: "PASS",
      reason: "ok",
      findings: [],
      provider: "spy",
      cost_usd: 0,
      latency_ms: 1,
    });
    const spy: AICritic = { id: "spy", critique: critique as never };
    const result = await runPageQa(SAMPLE_PAGE_SPEC, { critic: spy });
    expect(critique).toHaveBeenCalledTimes(1);
    expect(result.overall).toBe("PASS");
  });

  it("NOT_RUN and SKIPPED_NO_MODEL are different facts, and both are recorded as such", async () => {
    const blocked = await runPageQa(variant({ source_fact_bundle_ids: [] }));
    const clean = await runPageQa(SAMPLE_PAGE_SPEC);
    expect(blocked.ai_critic.status).toBe("NOT_RUN");
    expect(clean.ai_critic.status).toBe("SKIPPED_NO_MODEL");
  });
});

/**
 * A POLICY THAT DEMOTES A06'S OWN REDUNDANT VOICE BLOCKERS.
 *
 * A06 checks these families deterministically too, so on the default policy the
 * deterministic stage blocks first and the critic is correctly never invoked.
 * Demoting them here is not a workaround — it is the honest way to exercise the
 * SECOND layer, and it demonstrates the redundancy argument directly: with A06's
 * own pattern check turned down, the critic still catches the same copy.
 */
const CRITIC_REACHABLE = PageQaPolicy.parse({
  blocker_checks: DEFAULT_PAGE_QA_POLICY.blocker_checks.filter(
    (c) =>
      c !== "voice.no_unsourced_price" &&
      c !== "voice.no_manufactured_urgency" &&
      c !== "voice.no_directory_framing" &&
      c !== "claims.no_unsupported_language"
  ),
});

describe("a critic that fails is not a critic that passed", () => {
  it("a throwing critic reports NOT_RUN with the error, never PASS", async () => {
    const boom: AICritic = {
      id: "boom",
      critique: async () => {
        throw new Error("model timeout");
      },
    };
    const result = await runPageQa(SAMPLE_PAGE_SPEC, { critic: boom });
    expect(result.ai_critic.status).toBe("NOT_RUN");
    expect(result.ai_critic.reason).toMatch(/model timeout/);
    expect(result.ai_critic.reason).toMatch(/NOT a pass/);
    expect(result.overall).toBe("BLOCKED_PENDING_AI");
  });

  it("a critic returning PASS alongside a blocker is DOWNGRADED to FAIL", async () => {
    const contradictory = stubVoiceCritic({ severity: "blocker", forceStatus: "PASS" });
    const result = await runPageQa(withCopy("Act now — our verified providers cost about $99."), {
      critic: contradictory,
      policy: CRITIC_REACHABLE,
    });
    expect(result.ai_critic.status).toBe("FAIL");
    expect(result.ai_critic.reason).toMatch(/downgraded to FAIL/);
  });
});

/**
 * CONDITION C4's RESTATED DEFINITION OF DONE, exactly as the audit wrote it:
 * "with a stubbed AICriticAdapter in tests, each of the four patterns produces a
 * voice_claim_policy finding".
 */
describe("C4 Definition of Done — four patterns, four voice_claim_policy findings", () => {
  const cases: Array<[string, string]> = [
    ["unsourced_price", "A visit usually costs about $180 in this area."],
    ["manufactured_urgency", "Act now — don't wait, this only gets worse."],
    ["directory_framing", "Compare providers and choose from our network."],
    ["unqualified_verification_claim", "All of our providers are verified and insured."],
  ];

  it("the stub covers exactly the four patterns the DoD names", () => {
    expect(STUB_CRITIC_PATTERN_IDS.sort()).toEqual(cases.map(([id]) => id).sort());
  });

  for (const [id, copy] of cases) {
    it(`${id} produces a voice_claim_policy finding through the critic interface`, async () => {
      const result = await runPageQa(withCopy(copy), {
        critic: stubVoiceCritic(),
        policy: CRITIC_REACHABLE,
      });
      const raised = result.ai_critic.findings.filter((f) => f.check === "voice_claim_policy");
      expect(raised.length, `${id} produced no critic finding`).toBeGreaterThan(0);
      expect(raised.some((f) => f.message.startsWith(id))).toBe(true);
      expect(result.ai_critic.status).toBe("FAIL");
    });
  }

  it("critic findings at MAJOR do not block release — findings are not verdicts", async () => {
    const result = await runPageQa(withCopy("All of our providers are verified and insured."), {
      critic: stubVoiceCritic({ severity: "major" }),
    });
    expect(result.ai_critic.findings.length).toBeGreaterThan(0);
    expect(result.blockers).toEqual([]);
    expect(result.release_eligible).toBe(true);
  });

  it("critic findings at BLOCKER do block release — the one gate reads blockers, whoever raised them", async () => {
    const result = await runPageQa(withCopy("Act now — don't wait."), {
      critic: stubVoiceCritic({ severity: "blocker" }),
      policy: CRITIC_REACHABLE,
    });
    expect(result.blockers.length).toBeGreaterThan(0);
    expect(result.release_eligible).toBe(false);
    expect(result.state).toBe("FAIL");
  });
});

describe("fixtureCritic reclassified — the heuristic is honest about what it is", () => {
  /**
   * COMMENTS ARE STRIPPED FIRST. Naming the removed function in prose — to
   * record what it was and why it went — is not the same as still having it, the
   * same distinction A05's homepage leak scan draws. What must be gone is the
   * CODE: no declaration, no call, no export.
   */
  it("the old name is gone from the code", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(entry)) files.push(full);
      }
    };
    walk(join(process.cwd(), "src"));
    walk(join(process.cwd(), "tools"));
    for (const file of files) {
      const code = readFileSync(file, "utf-8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      expect(code, file).not.toMatch(/\bfixtureCritic\b/);
    }
  });

  it("the arithmetic is unchanged — no page's user_value_score moved", () => {
    // The shipped constants, recomputed by hand for the handcrafted door:
    // 40 base + min(25, 6 kinds * 5) + min(20, floor(4381/200)) + 5 family
    // + 5 urgency + 5 handcrafted, capped at 100.
    expect(deterministicHeuristicScore(SAMPLE_PAGE_SPEC)).toBe(92);
    const result = runPageQaSync(SAMPLE_PAGE_SPEC);
    expect(result.user_value_score).toBe(92);
    expect(result.heuristic_score).toBe(92);
  });

  it("the heuristic never sets a critic field", () => {
    const result = runPageQaSync(SAMPLE_PAGE_SPEC);
    expect(result.heuristic_score).toBeGreaterThan(0);
    expect(result.ai_critic.status).toBe("SKIPPED_NO_MODEL");
    expect(result.ai_critic.provider).toBeNull();
    expect(result.ai_critic.findings).toEqual([]);
  });

  it("its threshold failure is labelled a heuristic, not a critic judgment", () => {
    const thin = PageSpec.parse({
      ...SAMPLE_PAGE_SPEC,
      page_spec_id: "ps_low_score",
      page_id: "page_low_score",
      canonical_path: "/problems/low-score",
      title: "Low Score Page About A Different Thing Entirely",
      primary_query: "gutter overflowing at the corner",
      problem_family: null,
      intake_context: { ...SAMPLE_PAGE_SPEC.intake_context, page_id: "page_low_score" },
      content_blocks: [SAMPLE_PAGE_SPEC.content_blocks[0]],
    });
    const result = runPageQaSync(thin);
    const reason = result.reasons.join(" ");
    expect(reason).toMatch(/heuristic user_value_score/);
    expect(reason).not.toMatch(/critic/);
  });
});

describe("the stub is a test double and never reaches a production path", () => {
  it("nothing under src/app, src/platform or the rule set imports it", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(entry)) files.push(full);
      }
    };
    walk(join(process.cwd(), "src"));
    for (const file of files) {
      if (file.endsWith("stub-ai-critic.ts")) continue;
      expect(readFileSync(file, "utf-8"), file).not.toMatch(/stub-ai-critic|stubVoiceCritic/);
    }
  });

  it("A06's model route is the gateway and nothing else — no vendor SDK anywhere in it", () => {
    const critic = readFileSync(
      join(process.cwd(), "src/platform/search/page-qa-critic.ts"),
      "utf-8"
    );
    expect(critic).toMatch(/capability_call/);
    expect(critic).not.toMatch(/\b(openai|anthropic|@google|fetch\(|axios)\b/i);
  });
});
