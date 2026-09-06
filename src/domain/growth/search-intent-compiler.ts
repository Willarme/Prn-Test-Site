import type { IntentNode, ProblemNode } from "@/domain/growth/property-problem-graph";
import { GRAPH_V1, type PropertyProblemGraph } from "@/domain/growth/graph-v1";
import type { GeographyScope } from "@/domain/shared/primitives";

/**
 * SEARCH INTENT COMPILER — T6-01. Classifies a real search query into graph
 * fields with a confidence score.
 *
 * WHAT READS THIS TODAY: nothing but tests/t6-01-growth-knowledge.test.ts. This
 * is built and UNWIRED. The live A04 classifier is
 * src/domain/search/intent-classifier.ts, which does not import this domain and
 * does not know it exists. Wiring the two together is a separate item and has
 * not happened; until it does, no statement in this file may be written as
 * though A04 already ran through here.
 *
 * DETERMINISM CONTRACT: the path below is complete. Given the same inputs and
 * the same graph it returns the same classification, byte for byte, forever.
 * There is no model call in this file.
 *
 * THE MODEL SEAM, DOCUMENTED AND UNWIRED. A future model-backed classifier
 * would implement ModelIntentClassifier (bottom of file) and would be allowed
 * to do exactly one thing this function cannot: map a query NO node matches
 * onto a NEW node PROPOSAL, for a human to review and add to the graph data.
 * It would never override a deterministic match, and — per the standing
 * model-wiring decision — it cannot be reached at all until the owner flips
 * the policy. That seam is a documented intention, not a code path: there is
 * deliberately no import of any AI adapter in this file.
 *
 * CONFIDENCE IS COMPUTED, NOT DECORATED. It is derived from the match evidence
 * with simple arithmetic a reviewer can redo by hand: the top node's score
 * (0.9 for an exact alias hit, otherwise word overlap × 0.75), plus 0.15 if any
 * intent node's signals fired, capped at 0.75 when a second node also scored
 * 0.5 or better. Urgency signals do NOT enter the number — they only pick the
 * intent_kind label. Two matches of the same evidence type produce the same
 * number.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * GEOGRAPHY IS AN INPUT, NOT SOMETHING TO RECOVER FROM THE QUERY TEXT.
 * Josh's ruling, 2026-08-28, retiring three rebuilds of the same mistake.
 *
 * The query string is not evidence of location and never was. Three mechanisms
 * were built here and all three guessed:
 *
 *  1. "The word or two after in/near/around is a place" produced "a house",
 *     "me for", "my house", "basement after" and "the attic".
 *  2. "A place is a capitalised phrase not on a denylist" turned November,
 *     March, Spring, Christmas, Hurricane Helene, Comcast, AEP and Lowes into
 *     locations, while refusing Columbia City and Michigan City — real towns in
 *     PRN's own market — because the denylist held the word "city".
 *  3. "A place is any string found in a known-places index" resolved
 *     "columbus day sale on chainsaws" to columbus, "Fort Wayne Cabinets
 *     installed my kitchen wrong" to fort wayne, "roof leak in Columbus
 *     Georgia" to the OHIO Columbus, and "I named my dog Hilliard" to hilliard.
 *
 * Every version also wrote "verified" into its own audit trail about a location
 * the query never stated. That is the exact failure this layer exists to
 * prevent, so the layer is gone rather than tuned a fourth time.
 *
 * WHERE GEOGRAPHY ACTUALLY COMES FROM. It is already a structured field on the
 * row. `SearchOpportunity`, `IntentCluster`, `SeoMetricSnapshot` and
 * `SerpSnapshot` (src/domain/search/contracts.ts) each carry a `GeographyScope`
 * — national / state / county / city — and the adapter behind `SeoDataAdapter`
 * turns that scope into the vendor's geographic target on every call. (Which
 * vendor, and what it calls that target, is the adapter's business and is
 * deliberately not named in the domain layer — see
 * tests/a04.vendor-neutrality.test.ts, which enforces exactly that.)
 *
 * Geography is therefore an INPUT to the search that produced the query, chosen
 * before the query existed. Recovering it from the resulting text would be
 * reconstructing a known fact by guesswork. Same shape OD-9 ruled 2026-08-27.
 *
 * STATED vs ASSUMED IS PRESERVED, NOT FLATTENED. The row also carries
 * `geography_assumed` — "true when the source did not state geography and
 * US-national was assumed (seed import)". That distinction is the honesty
 * already present upstream, and it survives into the compiled output so a
 * consumer can tell a scope the source actually stated from one PRN filled in.
 * The evidence line says which, in those words, and never says "verified".
 * ─────────────────────────────────────────────────────────────────────────────
 */

export type IntentKind =
  | "emergency_help"
  | "problem_understanding"
  | "cost_understanding"
  | "diy_boundary"
  | "unmatched";

/**
 * The geography of the ROW the query came from — the structured scope that was
 * an input to the search, plus whether the source stated it or PRN assumed it.
 *
 * Reuses `GeographyScope` from @/domain/shared/primitives, the same type
 * src/domain/search/contracts.ts stamps on every keyword and opportunity row.
 * There is deliberately no second geography type in this domain.
 */
export interface RowGeography {
  /** The scope the search was run against. */
  scope: GeographyScope;
  /** true when the source did not state geography and US-national was assumed (seed import). */
  assumed: boolean;
}

export interface CompiledIntent {
  query: string;
  /** What the searcher appears to want, classified coarsely. */
  intent_kind: IntentKind;
  /** The problem node(s) the query maps onto, best first. Empty when no node matched. */
  matched_node_ids: string[];
  /**
   * The intent node(s) whose signals fired.
   *
   * Intent matching is INDEPENDENT of node matching: an intent node fires on its
   * own query signals, so a query that anchors to no problem node can still
   * carry intent ids ("how much does it cost" fires the tree-cost intent while
   * matching no node). Empty means no intent signal fired, nothing more.
   */
  matched_intent_ids: string[];
  /** Computed match confidence in [0,1]. 0 when no node matched. */
  confidence: number;
  /** The graph fields the classification fills, ready for A04's records. */
  fields: {
    system: PropertyNodeSystem | null;
    possible_service_types: string[];
    urgency: ProblemNode["urgency"] | null;
    /**
     * The ROW'S geography scope, passed through unchanged — never parsed out of
     * `query`. Null when the row carried none.
     */
    geography: GeographyScope | null;
    /**
     * true when that scope was ASSUMED by the source rather than stated; false
     * when stated. Null exactly when `geography` is null. Carried from the
     * row's `geography_assumed` so the distinction is not lost downstream.
     */
    geography_assumed: boolean | null;
  };
  /** Human-readable match evidence, so a reviewer can audit the number. */
  evidence: string[];
}

type PropertyNodeSystem = ProblemNode["system"];

const EMERGENCY_SIGNALS = ["emergency", "right now", "just fell", "fell on", "flooding", "sewage", "sparking", "help"];
const COST_SIGNALS = ["cost", "price", "how much", "expensive", "quote", "estimate"];
const DIY_SIGNALS = ["diy", "myself", "can i fix", "how to fix", "homemade", "without a"];
const UNDERSTANDING_SIGNALS = ["why", "what causes", "is it", "should i", "how do i know", "what does it mean"];

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s'-]/g, " ").replace(/\s+/g, " ").trim();
}

function containsPhrase(haystack: string, phrase: string): boolean {
  return haystack.includes(normalize(phrase));
}

/** Alias-coverage score: how much of the ALIAS the query's words cover, in [0,1], on significant words only. */
function wordOverlap(query: string, alias: string): number {
  const stop = new Set(["a", "an", "the", "is", "are", "my", "to", "in", "on", "of", "it", "and", "or", "at"]);
  const wq = new Set(normalize(query).split(" ").filter((w) => w.length > 1 && !stop.has(w)));
  const wa = normalize(alias).split(" ").filter((w) => w.length > 1 && !stop.has(w));
  if (wq.size === 0 || wa.length === 0) return 0;
  let hits = 0;
  for (const w of wa) if (wq.has(w)) hits += 1;
  // Coverage of the alias, not of the query: a long query mentioning every
  // word of a short alias IS a strong match; the reverse is weak.
  return hits / wa.length;
}

/**
 * The coarse label. "unmatched" is a REAL outcome, not a decorative union
 * member: a query that anchors to no problem node AND fires no intent signal is
 * labelled unmatched rather than being filed as a problem-understanding query,
 * which is what the fall-through used to do to every query it could not read.
 */
function classifyKind(query: string, hasNode: boolean, hasIntent: boolean): IntentKind {
  if (EMERGENCY_SIGNALS.some((s) => containsPhrase(query, s))) return "emergency_help";
  if (COST_SIGNALS.some((s) => containsPhrase(query, s))) return "cost_understanding";
  if (DIY_SIGNALS.some((s) => containsPhrase(query, s))) return "diy_boundary";
  if (UNDERSTANDING_SIGNALS.some((s) => containsPhrase(query, s))) return "problem_understanding";
  if (!hasNode && !hasIntent) return "unmatched";
  return "problem_understanding"; // a bare problem statement that DID anchor is an understanding query
}

/** A scope in one readable clause, for the audit trail. Reads the discriminant; invents nothing. */
export function describeScope(scope: GeographyScope): string {
  switch (scope.mode) {
    case "national":
      return `national/${scope.country}`;
    case "state":
      return `state ${scope.states.join(", ")} (${scope.country})`;
    case "county":
      return `county ${scope.counties.map((c) => `${c.county} ${c.state}`).join(", ")} (${scope.country})`;
    case "city":
      return `city ${scope.city}, ${scope.county} ${scope.state} (${scope.country})`;
  }
}

export function compileIntent(
  query: string,
  /**
   * The row's geography. Null means the row genuinely carried none — which is
   * a fact about the row, and is recorded as such. Nothing here inspects
   * `query` for a location.
   */
  rowGeography: RowGeography | null = null,
  graph: PropertyProblemGraph = GRAPH_V1,
): CompiledIntent {
  const q = normalize(query);
  const evidence: string[] = [];

  // 1. Node matching: alias exact containment first, then word overlap.
  interface NodeMatch { node: ProblemNode; score: number; why: string }
  const nodeMatches: NodeMatch[] = [];
  for (const node of graph.problem_nodes) {
    const candidates = [node.observed_problem, ...node.aliases];
    let best = 0;
    let why = "";
    for (const c of candidates) {
      const nc = normalize(c);
      if (nc.length >= 6 && q.includes(nc)) {
        // Exact alias containment is a strong signal.
        const s = 0.9;
        if (s > best) { best = s; why = `exact alias: "${c}"`; }
      } else {
        const s = wordOverlap(q, c) * 0.75; // overlap alone caps below exact match
        if (s > best) { best = s; why = `alias coverage of "${c}"`; }
      }
    }
    if (best >= 0.3) nodeMatches.push({ node, score: best, why });
  }
  nodeMatches.sort((a, b) => b.score - a.score);
  const top = nodeMatches.slice(0, 3);
  for (const m of top) evidence.push(`${m.node.node_id}: ${m.why} (${m.score.toFixed(2)})`);

  // 2. Intent-node signals.
  const matchedIntents: IntentNode[] = graph.intent_nodes.filter((i: IntentNode) =>
    i.query_signals.some((s) => containsPhrase(q, s)),
  );
  for (const i of matchedIntents) evidence.push(`intent signal: ${i.intent_id}`);

  // 3. Geography: COPIED from the row's scope. Not parsed, not inferred, not
  //    verified — there is nothing here to verify, because the scope was an
  //    input to the search that produced this query. The line below states
  //    only where the value came from and whether the source stated it.
  if (rowGeography === null) {
    evidence.push(
      "geography: the row carried no scope, so none is set — geography is never derived from the query text",
    );
  } else if (rowGeography.assumed) {
    evidence.push(
      `geography from the row's scope: ${describeScope(rowGeography.scope)} — ASSUMED by the source, not stated (geography_assumed = true); not derived from the query text`,
    );
  } else {
    evidence.push(
      `geography from the row's scope: ${describeScope(rowGeography.scope)} — STATED by the source (geography_assumed = false); not derived from the query text`,
    );
  }

  // 4. Confidence: node evidence is the spine; a fired intent nudges it.
  let confidence = 0;
  if (top.length > 0) {
    confidence = top[0].score;
    if (matchedIntents.length > 0) confidence = Math.min(1, confidence + 0.15);
    if (top.length > 1 && top[1].score >= 0.5) {
      // Two strong candidates = genuine ambiguity; say so in the number.
      confidence = Math.min(confidence, 0.75);
      evidence.push(`ambiguity cap applied: "${top[1].node.node_id}" also scored ${top[1].score.toFixed(2)}`);
    }
  }

  const primary = top[0]?.node ?? null;
  return {
    query,
    intent_kind: classifyKind(q, top.length > 0, matchedIntents.length > 0),
    matched_node_ids: top.map((m) => m.node.node_id),
    matched_intent_ids: matchedIntents.map((i) => i.intent_id),
    confidence: Math.round(confidence * 100) / 100,
    fields: {
      system: primary?.system ?? null,
      possible_service_types: primary?.possible_service_types ?? [],
      urgency: primary?.urgency ?? null,
      geography: rowGeography?.scope ?? null,
      geography_assumed: rowGeography === null ? null : rowGeography.assumed,
    },
    evidence,
  };
}

/**
 * A NEW node this query suggests the graph is missing. It is a PROPOSAL for a
 * human to review and add to the graph data — never a node, never applied.
 */
export interface ProposedProblemNode {
  /** The problem the query appears to be about, in the searcher's own words. */
  observed_problem: string;
  /** Which existing system the proposer thinks it belongs under, or null when unsure. */
  suggested_system: PropertyNodeSystem | null;
  /** Existing node ids the proposer considered and rejected, so a reviewer can check the reasoning. */
  considered_node_ids: string[];
  /** Why the existing graph does not already cover it. */
  rationale: string;
}

/**
 * THE MODEL SEAM'S SHAPE — documented, not wired. No file in this domain
 * imports an AI adapter, and the standing model-wiring decision means this
 * interface stays unimplemented until the owner's policy flips. It exists so
 * the day it IS implemented, its contract (propose, never override; a human
 * reviews every proposal) is already written down.
 *
 * The one capability it has that compileIntent does not is the one the header
 * names: turning a query NO node matches into a proposal for a NEW node. The
 * return type carries that proposal, so the interface and the promise match.
 */
export interface ModelIntentClassifier {
  /**
   * Propose a NEW graph node for an unmatched query, or null when the model
   * thinks the graph already covers it. Never a final answer, never applied
   * without a human.
   */
  proposeNewNode(query: string): Promise<ProposedProblemNode | null>;
}
