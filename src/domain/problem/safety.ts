/**
 * SafetyRule registry lite (#14A §14): a deterministic policy layer that runs
 * BEFORE any analysis. Trigger patterns are conservative; response copy is
 * fixed, human-reviewed text — never model-generated, and flagged for expert/
 * legal review before production traffic (see OWNER_TODO).
 */
export interface SafetyRule {
  safety_rule_id: string;
  label: string;
  patterns: RegExp[];
  approved_response: string;
  intake_may_continue: boolean;
}

export const SAFETY_RULES: readonly SafetyRule[] = [
  {
    safety_rule_id: "safety_gas",
    label: "Gas or carbon monoxide",
    // Deliberately broad: "smell(s/ed/ing) (like/of) gas", "gas smell/leak",
    // rotten-egg odor (the classic mercaptan indicator), propane, CO.
    patterns: [
      /\bgas (smell|leak|odor)\b/i,
      /smell(s|ed|ing)?\s+(like\s+|of\s+)?(natural\s+)?gas\b/i,
      /\bpropane\b.*\b(smell|leak)/i,
      /rotten egg/i,
      /carbon monoxide/i,
      /\bco (alarm|detector)\b/i,
    ],
    approved_response:
      "If you smell gas or a carbon monoxide alarm is sounding: leave the building now, don't switch anything on or off, and call your gas utility's emergency line or 911 from outside. Come back to this when everyone is safe.",
    intake_may_continue: false,
  },
  {
    safety_rule_id: "safety_fire",
    label: "Fire, smoke or sparking",
    patterns: [
      /\b(fire|flames?)\b/i,
      /\bsmoke\b/i,
      /spark(s|ing)?\b(?!\s*plug)/i,
      /burn(ing|t)? (smell|odor)/i,
      /smell(s|ed|ing)?\s+(like\s+)?(it'?s\s+|it\s+is\s+|something\s+)?burn/i,
      /something (is\s+)?burning/i,
    ],
    approved_response:
      "If anything is actively smoking, sparking or burning: switch off power at the breaker only if it is safe to reach, get everyone out, and call 911. If it's a faint burning smell with no visible smoke, stop using the fixture and keep this area supervised.",
    intake_may_continue: true,
  },
  {
    safety_rule_id: "safety_flood_electric",
    label: "Water near electricity / major flooding",
    patterns: [/flood(ing|ed)?\b/i, /water .*(outlet|panel|electric)/i, /standing water/i],
    approved_response:
      "If water is spreading fast or is anywhere near outlets, cords, or your electrical panel: don't step in it, shut off the water main if you can reach it safely, and call a professional or your utility. If the panel itself is wet, stay clear and call 911 or your utility.",
    intake_may_continue: true,
  },
  {
    safety_rule_id: "safety_structural",
    label: "Structural danger",
    patterns: [/ceiling (is )?(sagging|collapsing|caving)/i, /wall .*(bulging|collapsing)/i, /structural/i],
    approved_response:
      "If part of the structure looks like it may fall — sagging ceiling, bulging wall — keep people and pets out of that room and don't store anything heavy above or below it. A qualified professional should look before anyone works there.",
    intake_may_continue: true,
  },
];

export function checkSafety(text: string): SafetyRule | null {
  for (const rule of SAFETY_RULES) {
    if (rule.patterns.some((p) => p.test(text))) return rule;
  }
  return null;
}
