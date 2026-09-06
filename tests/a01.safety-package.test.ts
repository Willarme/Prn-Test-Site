import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SAFETY_PACKAGE_VERSION, SAFETY_RULES, checkSafety, compileSafetyPackage } from "@/domain/problem/safety";
import {
  ACTIVE_SAFETY_PACKAGE,
  PRN_TRIAL_SAFETY_PACKAGE,
  SafetyPackage,
} from "@/domain/problem/safety-package";

/**
 * A01 STEP 3 — SAFETY COPY IN THE DATA LAYER, BEHAVIOUR UNCHANGED.
 *
 * The dangerous version of this change is the one where the copy gets "tidied"
 * on the way out of TypeScript. So every approved response is pinned here
 * against a golden copy taken from the shipped file, character for character.
 * If a future edit improves the wording, this test fails and a human decides —
 * which is what "human-reviewed fixed copy" has to mean to be worth anything.
 */
const GOLDEN_COPY: Record<string, string> = {
  safety_gas:
    "If you smell gas or a carbon monoxide alarm is sounding: leave the building now, don't switch anything on or off, and call your gas utility's emergency line or 911 from outside. Come back to this when everyone is safe.",
  safety_fire:
    "If anything is actively smoking, sparking or burning: switch off power at the breaker only if it is safe to reach, get everyone out, and call 911. If it's a faint burning smell with no visible smoke, stop using the fixture and keep this area supervised.",
  safety_flood_electric:
    "If water is spreading fast or is anywhere near outlets, cords, or your electrical panel: don't step in it, shut off the water main if you can reach it safely, and call a professional or your utility. If the panel itself is wet, stay clear and call 911 or your utility.",
  safety_structural:
    "If part of the structure looks like it may fall — sagging ceiling, bulging wall — keep people and pets out of that room and don't store anything heavy above or below it. A qualified professional should look before anyone works there.",
};

/** The regex sources that were compiled into safety.ts before the move. */
const GOLDEN_PATTERNS: Record<string, string[]> = {
  safety_gas: [
    "\\bgas (smell|leak|odor)\\b",
    "smell(s|ed|ing)?\\s+(like\\s+|of\\s+)?(natural\\s+)?gas\\b",
    "\\bpropane\\b.*\\b(smell|leak)",
    "rotten egg",
    "carbon monoxide",
    "\\bco (alarm|detector)\\b",
  ],
  safety_fire: [
    "\\b(fire|flames?)\\b",
    "\\bsmoke\\b",
    "spark(s|ing)?\\b(?!\\s*plug)",
    "burn(ing|t)? (smell|odor)",
    "smell(s|ed|ing)?\\s+(like\\s+)?(it'?s\\s+|it\\s+is\\s+|something\\s+)?burn",
    "something (is\\s+)?burning",
  ],
  safety_flood_electric: ["flood(ing|ed)?\\b", "water .*(outlet|panel|electric)", "standing water"],
  safety_structural: [
    "ceiling (is )?(sagging|collapsing|caving)",
    "wall .*(bulging|collapsing)",
    "structural",
  ],
};

describe("A01 — the safety package", () => {
  it("still ships four rules, in the same order, with the same ids", () => {
    expect(SAFETY_RULES.map((r) => r.safety_rule_id)).toEqual([
      "safety_gas",
      "safety_fire",
      "safety_flood_electric",
      "safety_structural",
    ]);
  });

  it("the approved copy is byte-identical to what shipped", () => {
    for (const rule of SAFETY_RULES) {
      expect(rule.approved_response, rule.safety_rule_id).toBe(GOLDEN_COPY[rule.safety_rule_id]);
    }
  });

  it("the trigger patterns compile to exactly the shipped regexes", () => {
    for (const rule of SAFETY_RULES) {
      expect(rule.patterns.map((p) => p.source), rule.safety_rule_id).toEqual(
        GOLDEN_PATTERNS[rule.safety_rule_id]
      );
      expect(rule.patterns.every((p) => p.flags === "i"), rule.safety_rule_id).toBe(true);
    }
  });

  it("detection behaviour is unchanged on the cases that matter", () => {
    expect(checkSafety("I smell gas in the kitchen")?.safety_rule_id).toBe("safety_gas");
    expect(checkSafety("there is a rotten egg smell")?.safety_rule_id).toBe("safety_gas");
    expect(checkSafety("the outlet is sparking")?.safety_rule_id).toBe("safety_fire");
    // The spark-plug exclusion is a real carve-out and survived the move.
    expect(checkSafety("I need a new spark plug for the mower")).toBeNull();
    expect(checkSafety("standing water in the basement")?.safety_rule_id).toBe(
      "safety_flood_electric"
    );
    expect(checkSafety("the ceiling is sagging")?.safety_rule_id).toBe("safety_structural");
    expect(checkSafety("my kitchen tap drips")).toBeNull();
  });

  it("gas, burning and water at electricity halt normal intake (Melissa checklist F1)", () => {
    const halting = SAFETY_RULES.filter((r) => !r.intake_may_continue).map((r) => r.safety_rule_id);
    expect(halting).toEqual(["safety_gas", "safety_fire", "safety_flood_electric"]);
  });

  it("is versioned, and records the jurisdiction its copy assumes", () => {
    expect(SAFETY_PACKAGE_VERSION).toBe("prn_trial_us_v1@2");
    expect(ACTIVE_SAFETY_PACKAGE.jurisdiction).toBe("US");
    expect(ACTIVE_SAFETY_PACKAGE.locale).toBe("en-US");
    // Honest about review status rather than aspirational.
    expect(ACTIVE_SAFETY_PACKAGE.reviewed).toBe(false);
  });

  it("a second client supplies its own copy without touching agent code", () => {
    const other = SafetyPackage.parse({
      ...PRN_TRIAL_SAFETY_PACKAGE,
      safety_package_id: "client_b_v1",
      jurisdiction: "GB",
      locale: "en-GB",
      rules: [
        {
          safety_rule_id: "safety_gas",
          label: "Gas",
          patterns: [{ source: "gas", flags: "i" }],
          approved_response: "Leave the building and call the National Gas Emergency Service.",
          intake_may_continue: false,
        },
      ],
    });
    const rules = compileSafetyPackage(other);
    const hit = checkSafety("I can smell gas", rules);
    expect(hit?.approved_response).toContain("National Gas Emergency Service");
    expect(hit?.intake_may_continue).toBe(false);
    // …and swapping a package changed nothing about the shipped one.
    expect(checkSafety("I can smell gas")?.approved_response).toBe(GOLDEN_COPY.safety_gas);
  });

  it("there is still exactly ONE safety source — no second registry appeared", () => {
    const safety = readFileSync(join(process.cwd(), "src/domain/problem/safety.ts"), "utf-8");
    // The decision lives here; the data lives in the package it imports.
    expect(safety).toMatch(/export function checkSafety/);
    expect(safety).toMatch(/from "@\/domain\/problem\/safety-package"/);
    // And the US emergency-services copy is no longer a literal in agent code.
    expect(safety).not.toMatch(/911/);
    const pkg = readFileSync(join(process.cwd(), "src/domain/problem/safety-package.ts"), "utf-8");
    expect(pkg).not.toMatch(/export function checkSafety/);
  });
});
