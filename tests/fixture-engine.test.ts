import { describe, expect, it } from "vitest";
import { analyzeProblemFixture, buildJobPacketFixture } from "@/domain/problem/fixture-engine";
import { checkSafety } from "@/domain/problem/safety";

const NOW = "2026-08-14T12:00:00Z";

describe("deterministic safety gate (runs BEFORE analysis, #14A §14)", () => {
  it("gas smell halts intake with the approved response — never model-improvised", () => {
    const rule = checkSafety("I smell gas near the water heater")!;
    expect(rule.safety_rule_id).toBe("safety_gas");
    expect(rule.intake_may_continue).toBe(false);
    expect(rule.approved_response).toMatch(/leave the building/i);
  });

  it("catches the common real-world gas phrasings (slice verification blocker)", () => {
    for (const phrase of [
      "it smells like gas near the stove",
      "kitchen smells like gas",
      "I smelled gas when I came home",
      "rotten egg smell in the basement",
      "the carbon monoxide detector is going off",
    ]) {
      const rule = checkSafety(phrase);
      expect(rule?.safety_rule_id, phrase).toBe("safety_gas");
    }
  });

  it("catches burning-smell word-order variants without false-firing on spark plugs", () => {
    expect(checkSafety("the outlet smells like it is burning")?.safety_rule_id).toBe("safety_fire");
    expect(checkSafety("something is burning in the walls")?.safety_rule_id).toBe("safety_fire");
    expect(checkSafety("I need a spark plug for the mower")).toBeNull();
  });

  it("burning smell warns but may continue", () => {
    const rule = checkSafety("there is a burning smell from the outlet")!;
    expect(rule.intake_may_continue).toBe(true);
  });

  it("ordinary problems do not false-trigger", () => {
    expect(checkSafety("my faucet drips a little at night")).toBeNull();
  });
});

describe("fixture A01 (analyzeProblemFixture)", () => {
  it("the customer's own words beat the door hint (prior, not truth)", () => {
    const { problem } = analyzeProblemFixture({
      description: "water is dripping from the ceiling under the upstairs toilet",
      intake_session_id: "is_1",
      problem_family_hint: "hvac", // arrived through an HVAC door
      now: NOW,
    });
    expect(problem.service_category).toBe("plumbing");
  });

  it("falls back to the door hint only when the text says nothing classifiable", () => {
    const { problem } = analyzeProblemFixture({
      description: "something is wrong upstairs and it seems to be getting worse",
      intake_session_id: "is_1",
      problem_family_hint: "hvac",
      now: NOW,
    });
    expect(problem.service_category).toBe("hvac");
    expect(problem.service_category_confidence).toBe("low");
  });

  it("stores raw evidence verbatim, separate and private", () => {
    const text = "the AC won't turn on since yesterday";
    const { problem, evidence } = analyzeProblemFixture({
      description: text,
      intake_session_id: "is_1",
      problem_family_hint: null,
      now: NOW,
    });
    expect(evidence.content).toBe(text);
    expect(evidence.privacy).toBe("private");
    expect(problem.evidence_ids).toContain(evidence.evidence_id);
  });

  it("flags safety state and rule on hazardous descriptions", () => {
    const { problem } = analyzeProblemFixture({
      description: "I smell gas in the basement",
      intake_session_id: "is_1",
      problem_family_hint: null,
      now: NOW,
    });
    expect(problem.safety_state).toBe("urgent");
    expect(problem.safety_rule_id).toBe("safety_gas");
  });
});

describe("fixture A02 (buildJobPacketFixture) — honesty rules", () => {
  const { problem, evidence } = analyzeProblemFixture({
    description: "the AC won't turn on since yesterday evening",
    intake_session_id: "is_1",
    problem_family_hint: null,
    now: NOW,
  });
  const packet = buildJobPacketFixture(problem, evidence, NOW);

  it("only restates what the customer actually said — no invented facts", () => {
    expect(packet.observed_statements).toEqual([evidence.content]);
    expect(packet.summary_plain).toContain(evidence.content);
  });

  it("labels the category as inference with confidence, never a diagnosis", () => {
    expect(packet.likely_service_category.note).toMatch(/inference/);
    expect(["high", "medium", "low"]).toContain(packet.likely_service_category.confidence);
  });

  it("lists unknowns explicitly — uncertainty is allowed, fabricated certainty is not", () => {
    expect(packet.what_remains_unknown.length).toBeGreaterThan(0);
    expect(packet.what_remains_unknown.join(" ")).toMatch(/verify/i);
  });

  it("makes no savings guarantees anywhere in packet text", () => {
    const text = JSON.stringify(packet);
    expect(text).not.toMatch(/guarantee/i);
    expect(text).not.toMatch(/save you money/i);
  });

  it("is deterministic and marked as the fixture engine", () => {
    const again = buildJobPacketFixture(problem, evidence, NOW);
    expect(again).toEqual(packet);
    expect(packet.engine).toBe("fixture");
  });
});
