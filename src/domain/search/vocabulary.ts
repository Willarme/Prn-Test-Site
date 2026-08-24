import { z } from "zod";

/**
 * MARKET VOCABULARY — the cheap white-label door-opener (C5).
 *
 * Everything in this file used to be a `const` array or a regex literal inside
 * `intent-classifier.ts` and `scoring.ts`. That meant a client in a different
 * vertical — or a different LANGUAGE — could not use A04's pipeline without
 * forking two source files. The vault's own project statement now names the
 * Auto SEO Page Engine, which IS A04's generic layer, as the white-label
 * per-client product, so "fork the classifier" is not a viable answer.
 *
 * The values below are the SHIPPED ones, moved verbatim. Nothing was added,
 * removed or reworded. They are the v1 defaults of a policy block the owner
 * can now edit; a second client swaps a policy object rather than agent code.
 * The audit is explicit about the timing: doing this during the policy-driven
 * weights work "costs almost nothing; retrofitting after A05/A06 depend on the
 * same constants costs a great deal."
 *
 * SEPARABILITY POSITION (hard canon rule 6, condition 3). This is the file
 * where PRN's coupling to the generic pipeline is CONCENTRATED rather than
 * scattered. The lists are US-English home-services vocabulary; the machinery
 * that reads them (`intent-classifier.ts`, `scoring.ts`, `recommend.ts`) is
 * generic and lifts out cleanly. See docs/A04-STEP0-AUDIT.md §4.
 */

/**
 * Home-PROBLEM detection. Vendor intent labels only cover
 * informational/commercial/navigational — problem detection is PRN's own
 * signal and must not depend on any vendor.
 */
export const DEFAULT_PROBLEM_SIGNALS = [
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
] as const;

export const DEFAULT_TOOL_HINTS = [
  "calculator",
  "converter",
  "generator",
  "counter",
  "picker",
  "checker",
  "estimator",
] as const;

/**
 * Family patterns, in order. ORDER IS LOAD-BEARING: specific trades before
 * generic water words, so "roof leak" is roofing and "dishwasher leaking" is
 * appliance rather than generic plumbing. Word-boundary matching so
 * "waterproofing" never classifies as "roof".
 */
export const DEFAULT_FAMILY_PATTERNS = [
  { family: "hvac", pattern: "\\b(hvac|ac|a\\/c|air condition\\w*|furnace|heat pump|thermostat|not cooling|not heating)\\b" },
  { family: "electrical", pattern: "\\b(electric\\w*|outlet|breaker|wiring|panel)\\b" },
  { family: "roofing", pattern: "\\b(roof|shingle|gutter)\\b" },
  { family: "appliance", pattern: "\\b(appliance|washer|washing machine|dryer|dishwasher|refrigerator|fridge|oven|stove)\\b" },
  { family: "water_damage", pattern: "\\b(flood\\w*|water damage|standing water|basement water)\\b" },
  { family: "plumbing", pattern: "\\b(plumb\\w*|pipe|drain|faucet|toilet|water heater|hot water tank|sump|shower\\w*|bathtub|tub|leak\\w*|drip\\w*)\\b" },
] as const;

/** A pattern that does not compile is a policy that silently matches nothing. */
const CompilablePattern = z.string().min(1).refine(
  (source) => {
    try {
      new RegExp(source);
      return true;
    } catch {
      return false;
    }
  },
  { message: "must be a valid regular expression" }
);

export const FamilyPattern = z.object({
  family: z.string().min(1),
  pattern: CompilablePattern,
});
export type FamilyPattern = z.infer<typeof FamilyPattern>;

/**
 * HARD EXCLUSIONS (C6). A keyword matching one of these always resolves
 * REJECT — before scoring, before the cannibalization check, before any
 * threshold — and the reasons trail says which rule fired and why. This is the
 * mechanism an owner uses to say "never build a page about this", and it is
 * the one recommendation outcome that no score can override.
 *
 * SHIPS EMPTY, DELIBERATELY. An exclusion list populated by a build session
 * would be a build session deciding what PRN is about. Every entry is the
 * owner's, added through `npm run policy`.
 */
export const HardExclusion = z.object({
  /** Stable id so a reasons trail can be traced back to the rule that fired. */
  exclusion_id: z.string().min(1),
  pattern: CompilablePattern,
  /** Shown to the owner in the reasons trail. Says WHY, not just THAT. */
  reason: z.string().min(1),
});
export type HardExclusion = z.infer<typeof HardExclusion>;

export const MarketVocabulary = z.object({
  problem_signals: z.array(z.string().min(1)),
  tool_hints: z.array(z.string().min(1)),
  family_patterns: z.array(FamilyPattern),
  /**
   * The category key that means "family not recognized". Was the literal
   * "general_home_problem" inside qualifiesForNewPage; a client in another
   * vertical needed to fork that function to change one string.
   */
  catch_all_category: z.string().min(1),
  hard_exclusions: z.array(HardExclusion),
});
export type MarketVocabulary = z.infer<typeof MarketVocabulary>;

export const PRN_TRIAL_VOCABULARY: MarketVocabulary = MarketVocabulary.parse({
  problem_signals: [...DEFAULT_PROBLEM_SIGNALS],
  tool_hints: [...DEFAULT_TOOL_HINTS],
  family_patterns: DEFAULT_FAMILY_PATTERNS.map((f) => ({ ...f })),
  catch_all_category: "general_home_problem",
  hard_exclusions: [],
});

export interface ExclusionHit {
  exclusion_id: string;
  reason: string;
}

/**
 * Which hard exclusions a keyword trips, in policy order. Returns every hit,
 * not the first: an owner reading a REJECT deserves the whole trail, and two
 * rules firing is information about the rules.
 */
export function matchHardExclusions(
  keyword: string,
  vocabulary: Pick<MarketVocabulary, "hard_exclusions">
): ExclusionHit[] {
  const haystack = keyword.toLowerCase();
  const hits: ExclusionHit[] = [];
  for (const rule of vocabulary.hard_exclusions) {
    let pattern: RegExp;
    try {
      pattern = new RegExp(rule.pattern, "i");
    } catch {
      // Unreachable through the schema, which refuses uncompilable patterns.
      // If it ever happens, an exclusion that cannot run must not be a silent
      // pass — it is reported as a hit so the owner sees the broken rule.
      hits.push({
        exclusion_id: rule.exclusion_id,
        reason: `exclusion pattern failed to compile — treated as a match so a broken rule cannot silently allow a page: ${rule.reason}`,
      });
      continue;
    }
    if (pattern.test(haystack)) {
      hits.push({ exclusion_id: rule.exclusion_id, reason: rule.reason });
    }
  }
  return hits;
}
