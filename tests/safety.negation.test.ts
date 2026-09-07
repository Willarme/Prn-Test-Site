import { describe, expect, it } from "vitest";
import { checkSafety, SAFETY_RULES } from "@/domain/problem/safety";
import { decideUrgency, detectHazardFlags, safetyBodyFor } from "@/domain/packet/urgency";
import { PROBLEM_CASES } from "../evals/cases/ac-not-cooling";

const negativeReports = [
  "My AC is not cooling. No smoke, burning smell, gas smell, sparks or leaking water.",
  "My AC is not cooling. No gas smell.",
  "There is no gas smell near the furnace.",
  "No smoke or gas smell.",
  "No smoke, burning smell, gas smell, or sparks.",
  "No smoke and no gas smell.",
  "No visible smoke, unusual burning smell, or gas smell.",
  "No smoke; no gas smell.",
  "No smoke.\nNo gas smell.",
  "I do not smell gas.",
  "I don't smell gas.",
  "There are no sparks.",
  "No flooding.",
  "No water near the electrical panel.",
];

const positiveRules = [
  ["gas smell", "safety_gas"],
  ["I am smelling natural gas", "safety_gas"],
  ["propane has a leak", "safety_gas"],
  ["rotten egg odor", "safety_gas"],
  ["carbon monoxide concern", "safety_gas"],
  ["the CO detector is sounding", "safety_gas"],
  ["there are flames", "safety_fire"],
  ["there is smoke", "safety_fire"],
  ["the outlet is sparking", "safety_fire"],
  ["a burnt smell from the breaker", "safety_fire"],
  ["it smells like something burning", "safety_fire"],
  ["something is burning", "safety_fire"],
  ["the basement is flooded", "safety_flood_electric"],
  ["water is near the electrical panel", "safety_flood_electric"],
  ["standing water in the basement", "safety_flood_electric"],
  ["the ceiling is sagging", "safety_structural"],
  ["the wall is bulging", "safety_structural"],
  ["structural damage", "safety_structural"],
] as const;

describe("T1-21 negation repair: both safety matching consumers", () => {
  it.each(negativeReports)("does not turn an explicit negative report into a hazard: %s", (words) => {
    expect(checkSafety(words)).toBeNull();
    expect(detectHazardFlags(words)).toEqual([]);
    const urgency = decideUrgency({ homeowner_words: words });
    expect(urgency.hazard_halt).toBe(false);
    // A negative narrative does not impersonate completed safety questions.
    expect(urgency.safety_state).toBe("safety_not_established");
  });

  it.each(positiveRules)("preserves the positive trigger %s", (words, id) => {
    expect(checkSafety(words)?.safety_rule_id).toBe(id);
  });

  it.each(PROBLEM_CASES.filter((item) => item.safety_rule))("preserves the existing safety corpus case $id", (item) => {
    const rule = checkSafety(item.description);
    expect(rule?.safety_rule_id).toBe(item.safety_rule);
    if (item.hard_stop) expect(rule?.intake_may_continue).toBe(false);
  });

  it.each(positiveRules)("an unrelated negative cannot suppress a later positive: %s", (words, id) => {
    expect(checkSafety(`There is no unusual noise, ${words}`)?.safety_rule_id).toBe(id);
  });

  it("the positive witnesses exercise every existing approved intake pattern", () => {
    for (const rule of SAFETY_RULES) {
      for (const pattern of rule.patterns) {
        expect(positiveRules.some(([words]) => new RegExp(pattern.source, pattern.flags).test(words)), pattern.source).toBe(true);
      }
    }
  });

  it.each([
    "I cannot rule out a gas smell.",
    "I can't rule out a gas smell.",
    "I am not sure if there is a gas smell.",
    "I don't know whether there is a gas smell.",
    "Maybe there is no gas smell.",
    "No gas smell, I think.",
    "No gas smell?",
    "It is not true that there is no gas smell.",
    "No gas smell unless the furnace runs.",
    "No gas smell if the furnace is off.",
    "No smoke, maybe a gas smell.",
    "No smoke detector, but a gas smell.",
    "No matter what I do, there is a gas smell.",
    "There is no way to rule out a gas smell.",
    "No gas smell except when the furnace runs.",
    "No gas smell until the furnace starts.",
    "I cannot confirm there is no gas smell.",
    "It is not no gas smell; I can smell it.",
    "No gas smell is not what I said.",
    "No gas smell, but I am not sure.",
    "No gas smell. Actually I am not sure.",
  ])("retains uncertain, conditional or doubly negated hazards: %s", (words) => {
    expect(checkSafety(words)?.safety_rule_id).toBe("safety_gas");
    expect(detectHazardFlags(words)).toContain("gas_smell");
  });

  it.each([
    "No smoke except near the outlet.",
    "No smoke unless the furnace runs.",
    "No smoke until the furnace starts.",
    "No smoke, but I cannot confirm that.",
  ])("retains conditional fire reports: %s", (words) => {
    expect(checkSafety(words)?.safety_rule_id).toBe("safety_fire");
    expect(detectHazardFlags(words)).toContain("burning_or_smoke");
  });

  it.each([
    "No water except when the leak reaches the electric panel.",
    "No propane except when it starts to leak.",
    "No wall except where it is bulging.",
  ])("does not mask conditional syntax swallowed by a broad existing pattern: %s", (words) => {
    expect(checkSafety(words)).not.toBeNull();
    expect(detectHazardFlags(words).length).toBeGreaterThan(0);
  });

  it.each([
    "No gas smell, but the outlet is sparking.",
    "No gas smell. The outlet is sparking.",
    "No gas smell; the outlet is sparking.",
    "No gas smell\nThe outlet is sparking.",
    "No gas smell, the outlet is sparking.",
    "No gas smell and the outlet is sparking.",
    "No gas smell — the outlet is sparking.",
    "No gas smell however the outlet is sparking.",
  ])("selects the reported fire hazard instead of negated gas: %s", (words) => {
    expect(checkSafety(words)?.safety_rule_id).toBe("safety_fire");
    expect(detectHazardFlags(words)).toEqual(["burning_or_smoke"]);
    expect(safetyBodyFor(detectHazardFlags(words))).toBe("electrical_or_smoke");
  });

  it.each([
    "No smoke, gas smell is strong.",
    "No smoke, gas smell started this morning.",
    "No smoke, gas smell coming from the furnace.",
    "No smoke, gas smell strong.",
    "No smoke, gas smell definitely present.",
    "No smoke, gas smell too.",
    "No smoke or gas smell. Later I smell gas.",
    "I smell gas, but no smoke.",
    "There is smoke. No gas smell.",
  ])("keeps positive assertions and later occurrences: %s", (words) => {
    expect(checkSafety(words)).not.toBeNull();
    expect(detectHazardFlags(words).length).toBeGreaterThan(0);
  });

  it.each([
    ["There is a gas odor", "gas_smell"],
    ["The carbon monoxide alarm is sounding", "co_alarm"],
    ["Arcing inside the panel", "burning_or_smoke"],
    ["The outlet is wet", "electrical_water"],
    ["Water is gushing", "active_flooding"],
    ["Sewage is coming inside", "sewage_indoors"],
    ["The roof is collapsing", "structural"],
  ] as const)("keeps the existing packet-only trigger %s", (words, flag) => {
    expect(detectHazardFlags(words)).toContain(flag);
    expect(decideUrgency({ homeowner_words: words }).hazard_halt).toBe(true);
  });

  it("never negates an explicit flag or the existing recorded hard-stop rule", () => {
    expect(detectHazardFlags("No gas smell.", ["gas_smell"])).toEqual(["gas_smell"]);
    expect(decideUrgency({ homeowner_words: "No gas smell.", safety_rule_id: "safety_gas", safety_rule_halts: true }).hazard_halt).toBe(true);
  });

  it("keeps the existing spark-plug exclusion", () => {
    expect(checkSafety("A new spark plug is needed.")).toBeNull();
    expect(detectHazardFlags("A new spark plug is needed.")).toEqual([]);
  });

  it("conservatively retains a denial followed by unsupported prose instead of guessing whether it qualifies the denial", () => {
    const words = "No gas smell. The AC is not cooling.";
    expect(checkSafety(words)?.safety_rule_id).toBe("safety_gas");
    expect(detectHazardFlags(words)).toContain("gas_smell");
  });
});
