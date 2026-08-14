import type { SearchOpportunity } from "@/domain/search/contracts";

/**
 * PRN-side intent classification (deterministic Tier-0). Vendor intent labels
 * only cover informational/commercial/navigational — home-PROBLEM detection is
 * PRN's own signal and must not depend on any vendor.
 */
const PROBLEM_SIGNALS = [
  "not working",
  "not turning on",
  "won't",
  "wont",
  "broken",
  "leak",
  "leaking",
  "dripping",
  "smell",
  "smells",
  "noise",
  "making noise",
  "no power",
  "no heat",
  "no hot water",
  "clogged",
  "overflow",
  "flooding",
  "sparking",
  "tripping",
  "frozen",
  "freezing",
  "burning",
  "blowing warm",
  "blowing cold",
  "stopped",
  "keeps",
  "repair",
  "fix",
];

const TOOL_HINTS = ["calculator", "converter", "generator", "counter", "picker", "checker", "estimator"];

export function classifyIntentPrnSide(
  keyword: string,
  vendorLabel: SearchOpportunity["intent_type"] | null
): SearchOpportunity["intent_type"] {
  const kw = keyword.toLowerCase();
  if (PROBLEM_SIGNALS.some((s) => kw.includes(s))) return "problem";
  if (TOOL_HINTS.some((h) => kw.includes(h))) return "tool";
  return vendorLabel ?? "unknown";
}

export function inferProblemFamily(keyword: string, clusterLabel: string | null): string | null {
  const haystack = `${keyword} ${clusterLabel ?? ""}`.toLowerCase();
  // Word-boundary matching so "waterproofing" never classifies as "roof".
  const families: Array<[string, RegExp]> = [
    ["hvac", /\b(hvac|ac|air condition\w*|furnace|heat pump|thermostat)\b/],
    ["plumbing", /\b(plumb\w*|pipe|drain|faucet|toilet|water heater|sump)\b/],
    ["electrical", /\b(electric\w*|outlet|breaker|wiring|panel)\b/],
    ["roofing", /\b(roof|shingle|gutter)\b/],
    ["appliance", /\b(appliance|washer|dryer|dishwasher|refrigerator|fridge|oven|stove)\b/],
    ["water_damage", /\b(flood\w*|water damage|ceiling leak|basement water)\b/],
  ];
  for (const [family, pattern] of families) {
    if (pattern.test(haystack)) return family;
  }
  return null;
}
