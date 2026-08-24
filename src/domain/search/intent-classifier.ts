import type { SearchOpportunity } from "@/domain/search/contracts";
import { PRN_TRIAL_VOCABULARY, type MarketVocabulary } from "@/domain/search/vocabulary";

/**
 * PRN-side intent classification (deterministic Tier-0). Vendor intent labels
 * only cover informational/commercial/navigational — home-PROBLEM detection is
 * PRN's own signal and must not depend on any vendor.
 *
 * THE WORD LISTS LEFT THIS FILE (C5). `PROBLEM_SIGNALS`, `TOOL_HINTS` and the
 * six trade regexes are now policy data in domain/search/vocabulary.ts, so a
 * client in another vertical or another language swaps a policy object instead
 * of forking this module. The functions keep working with no argument — the
 * default IS the shipped PRN vocabulary, byte for byte — so every existing
 * caller (importer.ts, discovery.ts, problem/fixture-engine.ts) is unchanged
 * and every existing classification is unchanged.
 *
 * Compiled patterns are memoised per vocabulary object: the family regexes are
 * rebuilt only when the policy object identity changes, not once per keyword
 * across a 96-record portfolio pass.
 */

type Vocabulary = Pick<MarketVocabulary, "problem_signals" | "tool_hints" | "family_patterns">;

const patternCache = new WeakMap<object, Array<[string, RegExp]>>();

function familyPatterns(vocabulary: Vocabulary): Array<[string, RegExp]> {
  const cached = patternCache.get(vocabulary);
  if (cached) return cached;
  const compiled = vocabulary.family_patterns.map(
    (f) => [f.family, new RegExp(f.pattern, "i")] as [string, RegExp]
  );
  patternCache.set(vocabulary, compiled);
  return compiled;
}

export function classifyIntentPrnSide(
  keyword: string,
  vendorLabel: SearchOpportunity["intent_type"] | null,
  vocabulary: Vocabulary = PRN_TRIAL_VOCABULARY
): SearchOpportunity["intent_type"] {
  const kw = keyword.toLowerCase();
  if (vocabulary.problem_signals.some((s) => kw.includes(s))) return "problem";
  if (vocabulary.tool_hints.some((h) => kw.includes(h))) return "tool";
  return vendorLabel ?? "unknown";
}

export function inferProblemFamily(
  keyword: string,
  clusterLabel: string | null,
  vocabulary: Vocabulary = PRN_TRIAL_VOCABULARY
): string | null {
  const haystack = `${keyword} ${clusterLabel ?? ""}`.toLowerCase();
  // Word-boundary matching so "waterproofing" never classifies as "roof".
  // ORDER MATTERS and is preserved from the policy array: specific trades
  // before generic water words, so "roof leak" is roofing and "dishwasher
  // leaking" is appliance — not generic plumbing.
  for (const [family, pattern] of familyPatterns(vocabulary)) {
    if (pattern.test(haystack)) return family;
  }
  return null;
}
