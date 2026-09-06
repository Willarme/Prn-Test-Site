import { z } from "zod";

/**
 * PROPERTY PROBLEM GRAPH — T6-01, the shared taxonomy canon doc 08 says must
 * exist BEFORE service pages multiply.
 *
 * WHAT THIS IS. One typed graph of home-property problems: what system it
 * lives in, what the homeowner observes, what they search for, how urgent it
 * can get, what evidence would prove what, what actually drives price, and
 * what capability a provider needs to handle it.
 *
 * WHAT READS IT TODAY: NOTHING OUTSIDE THIS FOLDER. This is stated plainly
 * because the header used to claim the opposite. Earlier wording said "A04
 * classifies discovered queries AGAINST this graph" and "A05 reads a playbook
 * built ON these nodes when it drafts pages". Both were false and are retracted:
 * A04's live classifier is src/domain/search/intent-classifier.ts, which imports
 * only the search domain's own contracts and vocabulary; A05's page factory and
 * template (src/domain/search/factory.ts, template.ts) contain no reference to
 * this domain. The growth domain's only consumer is its own test file.
 *
 * That is not a defect — the taxonomy is deliberately built BEFORE the wiring,
 * which is what canon doc 08 asks for. It is only a defect when the prose
 * pretends the wiring already happened. Connecting A04 and A05 to this graph is
 * a separate, unstarted item.
 *
 * THE DOC-08 SCALING RULE, STATED HONESTLY. Growing from ten pages to a
 * thousand is a data change for NODES and PLAYBOOKS: adding a problem node is
 * an entry in graph-v1.ts, and adding a playbook is a file plus a registry line.
 * Adding a brand-new TRADE is NOT purely data — `PROPERTY_SYSTEMS` below is a
 * hardcoded tuple feeding a z.enum, so "landscaping" is a source edit and a
 * release. Two of the three axes are data; the trade axis is code, and saying
 * otherwise would set up whoever tries it next to be surprised.
 *
 * WHAT THIS IS NOT (the name collision, flagged by canon 08 AND the
 * Compendium): this is NOT the trial's guided-diagnosis intake playbooks.
 * Those live in their own domain under src/domain/intake/ and are A01's
 * territory (T1-21). Different object, different lifecycle, different owner.
 * Nothing in this folder imports from there, and a committed test asserts
 * that stays true.
 *
 * DETERMINISM. This file is data + types only. There is no model call, no
 * network call and no I/O here. The compiler that reads it
 * (search-intent-compiler.ts) has a deterministic path that is complete, and
 * a model-backed classifier exists only as a documented, UNWIRED seam.
 *
 * GEOGRAPHY IS DATA, NOT ASSUMPTION — with the honest caveat. Every node
 * stamps its `geography.scope` explicitly, and the field is REQUIRED with no
 * zod default: "national/US by default" was wrong and is retracted, because
 * there is no default, only an obligation to state one. Every node in
 * graph-v1.ts states "national/US".
 *
 * NOTHING READS `node.geography` YET. It is a declaration of the scope a
 * node's content is valid for, and no code consults it. What would enforce it
 * is a check in the PageEligibilityGate comparing the ROW's GeographyScope
 * (see search-intent-compiler.ts) against the node's declared validity before
 * a page may be built. That check is not written, and it would be vacuous
 * today anyway: every node declares "national/US", which is valid for every US
 * sub-scope. It becomes real the first time a node is authored county-scoped.
 *
 * EVIDENCE AND CLAIMS. `price_drivers` records FACTORS that move price, never
 * dollar figures — canon 14A §8.1 and OD-13 keep all prices out until they are
 * sourced, and a test greps every field for a dollar figure.
 *
 * `evidence_needed` IS A CLAIM REGISTER, NOT A PAGE PRECONDITION. The header
 * used to say that until a node's evidence exists "the PageEligibilityGate
 * keeps the page UNBUILT". That was false — the gate never dereferenced a node
 * — and it is retracted, because it also misread the field. Read the entries:
 * "permit requirements for a specific municipality", "insurance-claim
 * interaction specifics". These are claims a page MAY NOT MAKE until sourced,
 * not conditions a page must satisfy to exist. Every node carries at least one
 * unmet `sourced_reference` requirement, so gating on them would refuse every
 * page PRN could ever build.
 *
 * What the field now does, instead of nothing: `unmetEvidenceRequirements()`
 * below turns it into the list of claims still off-limits for a node, and the
 * PageEligibilityGate reports that list on every verdict as
 * `withheld_claims` — so the human who makes the build decision (the
 * threshold is null; a person decides) sees exactly what the page may not say.
 * The register is read, and its authority is a reviewer's, which is where
 * claim authority belongs.
 *
 * The half that IS enforced in code lives on the playbook, not here: a
 * published section whose `evidence_kind` outruns its `source` vetoes the page
 * outright. See service-playbook.ts and page-eligibility-gate.ts.
 *
 * The Claim Ledger (vault, Project/03 Build/Governance/, T7-01's Verification &
 * Claim Standard) is the register this feeds into.
 */

export const GRAPH_SCHEMA_VERSION = "1.0.0";

/**
 * The property system a problem lives in.
 *
 * ADDING A TRADE IS A CODE EDIT. The previous comment here said "New trades
 * extend this union via the registry, not by editing history", and that is
 * retracted: no registry extends this tuple. It is `as const` with no runtime
 * extension point, and playbooks/index.ts — the only thing called a registry —
 * READS the union and never adds to it. A new trade means appending a line
 * below, which flows into the z.enum at ProblemNode.system and at
 * ServicePlaybook.system, and shipping a release.
 *
 * Appending is safe and additive; the rule that matters is the one that still
 * holds — never RENAME or REMOVE a member, because node ids and playbook ids
 * are stamped with these slugs and history would silently repoint.
 */
export const PROPERTY_SYSTEMS = [
  "tree",
  "plumbing_drain",
  "roofing",
  "hvac",
  "electrical",
  "pest",
  "foundation",
  "exterior",
] as const;
export type PropertySystem = (typeof PROPERTY_SYSTEMS)[number];

/** How fast this problem class can become dangerous or destructive. Copy may only state urgency the node actually carries. */
export const URGENCY_LEVELS = ["emergency_possible", "urgency_possible", "routine"] as const;
export type UrgencyLevel = (typeof URGENCY_LEVELS)[number];

/** Geographic scope the node's content is actually valid for. */
export const GEO_SCOPES = ["national/US", "county", "custom"] as const;
export type GeoScope = (typeof GEO_SCOPES)[number];

/** What kind of evidence would prove the claim class, if it is ever gathered. */
export const EVIDENCE_KINDS = [
  "authored_copy", // PRN wrote it; needs no external source, may not state facts about any specific provider
  "sourced_reference", // needs a named external source before it may be published
  "outcome_record", // needs captured, permissioned outcome data (does not exist yet — see S01 "Verified Outcome" row of the Claim Ledger)
] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

/**
 * ONE CLAIM PRN MAY NOT MAKE YET, AND WHAT WOULD UNLOCK IT.
 *
 * The `source` doc used to read "Named checkable source when kind is
 * sourced_reference; null otherwise. Never invented." Taken literally that made
 * every sourced_reference row in graph-v1.ts a contract violation, since all six
 * carry source: null — and the fix is NOT to invent six sources. The doc was
 * describing a satisfied evidence RECORD; this is a register of REQUIREMENTS,
 * and a requirement whose source is null is simply one nobody has met yet.
 * That is the field's real meaning, written down:
 *
 *   kind: sourced_reference, source: null    → OPEN. The claim may not ship.
 *   kind: sourced_reference, source: "…"     → MET. A named source exists.
 *   kind: authored_copy                      → PRN's own words; there is no
 *                                              external source, so source is
 *                                              null by definition.
 *   kind: outcome_record                     → needs permissioned outcome data
 *                                              that does not exist anywhere
 *                                              yet, so source is null too.
 *
 * The refine below enforces exactly that, which is what makes the register
 * checkable instead of decorative. It is deliberately the ONLY rule here that
 * could be satisfied by writing a string: a source may be named, never invented.
 */
const EvidenceRequirement = z
  .object({
    /** What the page would want to say, at claim-wording level. */
    claim: z.string().min(3),
    /** The kind of evidence required before that claim may ship. */
    kind: z.enum(EVIDENCE_KINDS),
    /**
     * The named checkable source, once one exists. Null while the requirement
     * is unmet — which is the normal state and is not a defect. Never invented.
     */
    source: z.string().min(1).nullable(),
  })
  .strict()
  .refine((r) => r.kind === "sourced_reference" || r.source === null, {
    message:
      "only a sourced_reference requirement may name a source — authored_copy has no external source, and outcome_record data does not exist yet",
    path: ["source"],
  });

/** A requirement nobody has met yet: the claim is off-limits until a source is named. */
export function isEvidenceRequirementUnmet(r: z.infer<typeof EvidenceRequirement>): boolean {
  return r.source === null;
}

/**
 * The claims a page on this node MAY NOT make yet, newest register read.
 *
 * This is what makes `evidence_needed` a field with a reader rather than a
 * comment: the PageEligibilityGate reports this list on every verdict so the
 * person making the build decision sees the boundary in front of them.
 */
export function unmetEvidenceRequirements(
  node: Pick<ProblemNode, "node_id" | "evidence_needed">,
): Array<{ node_id: string; claim: string; kind: EvidenceKind }> {
  return node.evidence_needed
    .filter(isEvidenceRequirementUnmet)
    .map((r) => ({ node_id: node.node_id, claim: r.claim, kind: r.kind }));
}

const PriceDriver = z
  .object({
    /** Factor name, e.g. "tree height class", "access constraint". */
    driver: z.string().min(2),
    /** Direction of effect, in words. Numbers are OD-13's business, not the graph's. */
    effect: z.enum(["increases_price", "decreases_price", "changes_scope"]),
    /** Why this factor moves the work, in one plain sentence. */
    why: z.string().min(10),
  })
  .strict();

const ProviderCapability = z
  .object({
    /** Capability the provider must have, stated as a checkable requirement. */
    capability: z.string().min(3),
    /** Whether absence of this capability makes the provider ineligible (hard) or only lower-value (soft). */
    hardness: z.enum(["hard", "soft"]),
  })
  .strict();

/**
 * STRICT, LIKE EVERY OTHER SCHEMA IN THIS DOMAIN. KnownPlace was strict,
 * ServicePlaybook is strict, EligibilityPolicy is strict — the graph schemas
 * were the only ones that were not, so a mistyped core field (`urgancy`,
 * `aliaes`) was silently STRIPPED at parse and the node shipped without it.
 * A typo in the taxonomy is exactly the failure that must be loud.
 */
const ProblemNode = z.object({
  /** Stable id, e.g. "ppg_tree_removal_over_structure_v1". Version-suffixed; never renamed in place. */
  node_id: z.string().regex(/^ppg_[a-z0-9_]+_v\d+$/),
  /** Which property system this node belongs to. */
  system: z.enum(PROPERTY_SYSTEMS),
  /** The observed problem, in the homeowner's words, not the trade's jargon. */
  observed_problem: z.string().min(5),
  /** What the trade would call it — recorded, but never rendered to homeowners as the primary label. */
  trade_label: z.string().min(3),
  /** Other ways homeowners say this. The compiler matches against these. */
  aliases: z.array(z.string().min(2)).min(1),
  /** Highest urgency this problem class realistically reaches. */
  urgency: z.enum(URGENCY_LEVELS),
  /** Situations that escalate this problem to urgency — the honesty boundary for any page copy. */
  escalation_conditions: z.array(z.string().min(5)).min(1),
  /** Constraints that shape the work (access, structures, permits, season). */
  constraints: z.array(z.string().min(3)),
  /**
   * Geographic scope this node's content is valid for. REQUIRED — there is no
   * zod default, so every node states its own scope explicitly. Nothing reads
   * this yet; see the header for what would.
   */
  geography: z.object({ scope: z.enum(GEO_SCOPES), note: z.string().nullable() }).strict(),
  /** Service types that can plausibly resolve it, most likely first. Labeled inference, not fact. */
  possible_service_types: z.array(z.string().min(3)).min(1),
  /** What evidence each claim class on a page for this node would need. */
  evidence_needed: z.array(EvidenceRequirement).min(1),
  /** Price FACTORS. No dollar values anywhere in this graph. */
  price_drivers: z.array(PriceDriver).min(1),
  /** What a provider must be capable of to take this work. */
  provider_capability: z.array(ProviderCapability).min(1),
}).strict();

export type ProblemNode = z.infer<typeof ProblemNode>;

/** A search intent that maps onto one or more problem nodes. */
const IntentNode = z.object({
  intent_id: z.string().regex(/^int_[a-z0-9_]+_v\d+$/),
  /** What the searcher is trying to do, in one clause. */
  searcher_goal: z.string().min(5),
  /** Query language that signals this intent. Matched case-insensitively. */
  query_signals: z.array(z.string().min(2)).min(1),
  /** Which problem nodes this intent can be about. */
  node_ids: z.array(z.string()).min(1),
  /** Can PRN genuinely answer this intent today with authored, honest content? */
  answerable_with_authored_content: z.boolean(),
}).strict();

export type IntentNode = z.infer<typeof IntentNode>;

/** The graph: problem nodes + intent nodes + edges. Everything else is derived. */
export const PropertyProblemGraph = z.object({
  graph_id: z.literal("ppg_v1"),
  schema_version: z.literal(GRAPH_SCHEMA_VERSION),
  problem_nodes: z.array(ProblemNode),
  intent_nodes: z.array(IntentNode),
  /** Explicit edges, always problem→intent direction (prerequisite→dependent), matching the vault's graph convention. */
  edges: z.array(z.object({ from_node_id: z.string(), to_intent_id: z.string() }).strict()),
}).strict();

export type PropertyProblemGraph = z.infer<typeof PropertyProblemGraph>;

/**
 * Fail loudly on duplicate ids and on any reference to a node or intent that
 * does not exist — a taxonomy with two meanings for one id, or an edge into
 * nothing, is worse than no taxonomy.
 *
 * `graph.edges` IS CHECKED NOW. It was not before: the function walked
 * problem_nodes and intent_nodes and never looked at the edge list at all, so
 * an edge pointing at a ghost node id parsed clean and validated clean. Both
 * ends of every edge are resolved below.
 */
export function validateGraphUniqueness(graph: PropertyProblemGraph): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const n of graph.problem_nodes) {
    if (seen.has(n.node_id)) errors.push(`duplicate problem node id: ${n.node_id}`);
    seen.add(n.node_id);
  }
  const seenIntents = new Set<string>();
  for (const i of graph.intent_nodes) {
    if (seenIntents.has(i.intent_id)) errors.push(`duplicate intent node id: ${i.intent_id}`);
    seenIntents.add(i.intent_id);
    for (const to of i.node_ids) {
      if (!seen.has(to)) errors.push(`intent ${i.intent_id} references unknown problem node ${to}`);
    }
  }

  // Edges: both ends must resolve, and the same edge must not be declared twice.
  const seenEdges = new Set<string>();
  for (const e of graph.edges) {
    const key = `${e.from_node_id}->${e.to_intent_id}`;
    if (seenEdges.has(key)) errors.push(`duplicate edge: ${key}`);
    seenEdges.add(key);
    if (!seen.has(e.from_node_id)) {
      errors.push(`edge ${key} starts at unknown problem node ${e.from_node_id}`);
    }
    if (!seenIntents.has(e.to_intent_id)) {
      errors.push(`edge ${key} ends at unknown intent node ${e.to_intent_id}`);
    }
  }

  return errors;
}
