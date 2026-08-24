import type { SearchOpportunity } from "@/domain/search/contracts";
import type { ScoredOpportunity } from "@/domain/search/scoring";

/**
 * INTENT-FAMILY MATCHING — the shared helper, extracted (coherence report
 * issue 15, C13).
 *
 * WHO MAY USE THIS, AND WHO MAY NOT. The coherence report is precise about the
 * split and the reason for it:
 *
 *   A04 and A05 MAY share this helper — they are two stages of one pipeline
 *   and disagreeing about what "the same search need" means would produce
 *   pages that contradict the queue that authorized them.
 *
 *   A06 MUST REIMPLEMENT IT INDEPENDENTLY. Its cannibalization check is an
 *   INSPECTION of A04/A05's work, and "an inspector that shares its subject's
 *   logic is not an inspector" (Master Todo T1-09). A06 importing this file
 *   would make its duplication check structurally incapable of catching the
 *   one bug class it exists for: a flaw in this matcher.
 *
 * NOT WIRED FOR A06 HERE, DELIBERATELY. src/domain/search/qa.ts (A06's) still
 * imports `sameIntentFamily` through recommend.ts today. Rewriting A06's
 * matcher is A06's build, not A04's — doing it from here would be A04 writing
 * A06's inspection logic, which is the same defect one step removed. The
 * extraction and the re-export exist so that when A06 does reimplement, this
 * file is the thing it must NOT import, and a test can say so plainly.
 *
 * The logic below is moved verbatim from recommend.ts. Nothing about matching
 * behaviour changed; every threshold, stopword and stemming rule is identical.
 */

// Negations ("not", "won't") are NOT stopwords: "won't turn on" and
// "won't turn off" are different home problems and must stay distinct.
const STOPWORDS = new Set([
  "a", "an", "the", "is", "my", "why", "how", "to", "in", "of", "for", "do", "does", "what",
]);

/** Conservative suffix stemming so "turning"/"turn", "leaks"/"leak" match. */
function stem(token: string): string {
  // All negation spellings collapse to one marker: "won't"/"wont"/"doesnt"
  // carry the same signal as "not" — but "on" vs "off" stays distinct.
  if (token === "wont" || token === "doesnt" || token === "isnt" || token === "cant") return "not";
  if (token.length > 5 && token.endsWith("ing")) return token.slice(0, -3);
  if (token.length > 4 && token.endsWith("ed")) return token.slice(0, -2);
  if (token.length > 3 && token.endsWith("s") && !token.endsWith("ss")) return token.slice(0, -1);
  return token;
}

export function keywordTokens(keyword: string): Set<string> {
  return new Set(
    keyword
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .split(/\s+/)
      .filter((t) => t.length > 1 && !STOPWORDS.has(t))
      .map(stem)
  );
}

export function sameIntentFamily(a: string, b: string): boolean {
  const ta = keywordTokens(a);
  const tb = keywordTokens(b);
  if (ta.size === 0 || tb.size === 0) return a.trim().toLowerCase() === b.trim().toLowerCase();
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  const jaccard = shared / (ta.size + tb.size - shared);
  const containment = shared / Math.min(ta.size, tb.size);
  // 0.7 bar: "ac won't turn on"/"ac not turning on" normalize to identical
  // sets (1.0), while "won't turn on"/"won't turn off" score 0.6 and stay
  // distinct — negated opposites are different home problems.
  return jaccard >= 0.7 || containment >= 0.99;
}

/**
 * A stable label for a family, used for grouping and for the owner-facing
 * report. Sorted tokens, so "ac not turning on" and "ac won't turn on" produce
 * the same key — the same normalization the matcher uses, made readable.
 */
export function intentFamilyKey(keyword: string): string {
  return [...keywordTokens(keyword)].sort().join(" ") || keyword.trim().toLowerCase();
}

export interface IntentDuplicateGroup {
  /** The family label these candidates collapse to. */
  cluster_key: string;
  /** Highest-scoring candidate in the group — the one that would claim the page. */
  primary_id: string;
  /** The rest of the group, which must never become a second door. */
  duplicate_ids: string[];
  /** An EXISTING portfolio record this whole group collides with, if any. */
  collides_with_existing_id: string | null;
}

export interface IntentDuplicateReport {
  groups: IntentDuplicateGroup[];
  /** search_opportunity_id -> the id it duplicates. Empty when nothing collides. */
  duplicate_of: Record<string, string>;
  duplicate_candidates: number;
}

/**
 * THE PRE-GATE (C13). Duplicate-intent detection that runs BEFORE
 * recommendation, over the whole incoming batch at once.
 *
 * WHY BEFORE, AND WHY AS A BATCH. `recommend()` checks overlap one candidate at
 * a time against what it has already seen, which is correct but invisible: the
 * run reports "4 MERGE" with no way to see that those four were three separate
 * families, or that a fifth candidate quietly lost to vendor list order. This
 * function makes the collision structure a first-class output, computed once,
 * over candidates already sorted by score — so the strongest keyword in each
 * family is the primary regardless of the order the vendor returned them in.
 *
 * IT DECIDES NOTHING. `recommend()` remains the only place a recommendation is
 * assigned, and its behaviour is unchanged — this is detection and disclosure,
 * not a second decision path. Two mechanisms that could disagree about which
 * candidate wins a family would be worse than one.
 */
export function detectDuplicateIntents(
  scoredCandidates: readonly ScoredOpportunity[],
  existing: readonly SearchOpportunity[],
  isEligibleTarget: (record: SearchOpportunity) => boolean
): IntentDuplicateReport {
  // Descending score, so the primary of each family is the strongest candidate
  // and not whichever one the vendor happened to list first.
  const ordered = [...scoredCandidates].sort((a, b) => b.score - a.score);
  const groups: IntentDuplicateGroup[] = [];
  const duplicateOf: Record<string, string> = {};

  for (const candidate of ordered) {
    const keyword = candidate.opportunity.keyword;
    const id = candidate.opportunity.search_opportunity_id;

    const group = groups.find(
      (g) =>
        sameIntentFamily(g.cluster_key, intentFamilyKey(keyword)) ||
        sameIntentFamily(
          ordered.find((c) => c.opportunity.search_opportunity_id === g.primary_id)!.opportunity
            .keyword,
          keyword
        )
    );

    if (group) {
      // An identical keyword is the same opportunity being re-enriched, not a
      // second door — the same carve-out recommend() makes.
      const primaryKeyword = ordered.find(
        (c) => c.opportunity.search_opportunity_id === group.primary_id
      )!.opportunity.keyword;
      if (primaryKeyword === keyword) continue;
      group.duplicate_ids.push(id);
      duplicateOf[id] = group.primary_id;
      continue;
    }

    const collision = existing.find(
      (e) =>
        e.search_opportunity_id !== id &&
        e.keyword !== keyword &&
        isEligibleTarget(e) &&
        sameIntentFamily(e.keyword, keyword)
    );
    groups.push({
      cluster_key: intentFamilyKey(keyword),
      primary_id: id,
      duplicate_ids: [],
      collides_with_existing_id: collision?.search_opportunity_id ?? null,
    });
    if (collision) duplicateOf[id] = collision.search_opportunity_id;
  }

  return {
    groups: groups.filter((g) => g.duplicate_ids.length > 0 || g.collides_with_existing_id !== null),
    duplicate_of: duplicateOf,
    duplicate_candidates: Object.keys(duplicateOf).length,
  };
}
