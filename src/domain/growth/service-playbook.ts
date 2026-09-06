import { z } from "zod";
import { PROPERTY_SYSTEMS, type PropertySystem } from "@/domain/growth/property-problem-graph";

/**
 * SERVICE PLAYBOOK — T6-01. The per-trade CONTENT schema, and the thing canon
 * doc 08 says must be reusable data before pages multiply.
 *
 * A05 DOES NOT READ THIS YET. The header used to say "the per-trade CONTENT
 * schema A05 reads when it drafts pages"; that was false and is retracted.
 * src/domain/search/factory.ts and template.ts — the page-drafting path —
 * contain no reference to this domain, and no production file imports
 * @/domain/growth/service-playbook or @/domain/growth/playbooks. The only
 * readers are the registry, the PageEligibilityGate, and the T6-01 test file.
 * The schema is built ahead of the wiring on purpose; connecting A05 to it is a
 * separate, unstarted item.
 *
 * DATA, NOT CODE, within the trades that already exist. A playbook is an
 * authored record validated against the zod schema below, so adding a Roofing
 * playbook is a file plus a registry line. Adding a brand-new TRADE is not
 * purely data — `system` is a z.enum over PROPERTY_SYSTEMS, a hardcoded tuple
 * in property-problem-graph.ts, so a new trade is a source edit and a release.
 *
 * AUTHORITATIVE vs SHADOW. Exactly ONE playbook per trade may carry status
 * "authoritative" — it is the trade's voice of record. A "shadow" playbook is
 * fully structured, real authored content proving the schema generalizes, but
 * it is explicitly NOT the trade's voice of record and MUST NOT feed public
 * page generation until Josh rules it authoritative (T6-01 plan step S4 is
 * that ruling). The registry enforces the one-authoritative-per-trade rule
 * at parse time, so the invariant cannot rot quietly.
 *
 * WHAT THIS IS NOT: not the intake guided-diagnosis playbooks (A01's, under
 * src/domain/intake/ — the canon-08 name collision, again). Not a pricing
 * source: no dollar figure may appear in any field, ever — price DRIVERS
 * only (OD-13 keeps prices out until sourced). No dollar figures, no prices.
 *
 * NO TECHNIQUE INSTRUCTIONS (Josh's ruling R3, 2026-08-28). Safety notes, the
 * DIY boundary and section copy tell a homeowner what to STAY CLEAR OF and WHO
 * TO CALL. They never teach an operational technique for acting on the problem
 * itself. The line that forced the rule: a draft roofing playbook told a
 * homeowner to relieve a water-loaded ceiling over a bucket. A reviewer signing
 * an authoritative playbook is vouching for PRN's judgement about risk, and
 * must never be put in the position of vouching for a method. The rule is a
 * CONTENT rule and applies to every playbook, shadow ones included — copy left
 * in a shadow playbook is copy that goes live later by accident.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHO ENFORCES COPY QUALITY: THE NAMED REVIEWER, NOT THE TEST SUITE.
 * Josh's ruling, 2026-08-28.
 *
 * A regex cannot judge whether copy is good. Three rounds of prose tripwires
 * were written against the no-technique rule and each was defeated by a two-word
 * rewrite — the permission-clause ban missed the imperative, and broadening it
 * to method verbs and instrument phrases moved the line without closing it.
 * Those checks remain in tests/t6-01-growth-knowledge.test.ts, each labelled
 * "HEURISTIC:" in its own name, and they are not to be escalated with a fourth
 * round of vocabulary.
 *
 * THE CONTROL is `provenance.reviewed_by` — A01 approval condition 3 requires a
 * named human behind any authoritative playbook, and validatePlaybook below
 * refuses an authoritative playbook whose reviewed_by is null, together with any
 * half-signature. What the machine checks is STRUCTURE: ids, joins, statuses,
 * signatures, prices, and a declaration measured against itself. What a person
 * checks is whether the words are true, safe and worth publishing.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * CLAIM SAFETY — NOW ACTUALLY ENFORCED, WHICH IT WAS NOT. Every section records
 * the evidence class its factual statements rest on: "authored_copy" = PRN's own
 * words, no external facts; "sourced_reference" = needs a named source before
 * publish; "outcome_record" = needs permissioned outcome data that does not
 * exist anywhere yet.
 *
 * The header used to claim "the gate that decides whether a page gets BUILT
 * reads these". It did not — page-eligibility-gate.ts took the playbook record
 * and used only its `playbook_id`, so a section could carry
 * `evidence_kind: "sourced_reference"` with `source: null` and publish anyway.
 * The claim is now true rather than removed, because this is the mechanism the
 * Claim Ledger (T7-01's Verification & Claim Standard) needs to exist:
 * `unsourcedSections()` below names every section whose claims outrun their
 * evidence, and the gate VETOES a page whose authoritative playbook has any.
 * A veto, not a score — an unsourced factual claim is not a page that scores
 * lower, it is a page that does not ship.
 *
 * Note what this does NOT do: it cannot tell whether a body paragraph marked
 * authored_copy secretly states an external fact. That judgement is a human's,
 * and it belongs to the named reviewer in provenance.reviewed_by (A01 approval
 * condition 3). The machine checks the declaration against itself; the reviewer
 * checks the declaration against the prose.
 */

export const PLAYBOOK_SCHEMA_VERSION = "1.0.0";

export const PLAYBOOK_STATUSES = ["authoritative", "shadow"] as const;
export type PlaybookStatus = (typeof PLAYBOOK_STATUSES)[number];

export const SECTION_EVIDENCE_KINDS = ["authored_copy", "sourced_reference", "outcome_record"] as const;
export type SectionEvidenceKind = (typeof SECTION_EVIDENCE_KINDS)[number];

const PlaybookSection = z
  .object({
    section_id: z.string().min(3),
    /** The question this section answers for the homeowner, in their words. */
    homeowner_question: z.string().min(5),
    /** Authored answer paragraphs. Plain language; the trade label may appear but never as the primary voice. */
    body: z.array(z.string().min(20)).min(1),
    /** Evidence class every factual statement in this body rests on. */
    evidence_kind: z.enum(SECTION_EVIDENCE_KINDS),
    /** Named source when evidence_kind is sourced_reference. Never invented; null otherwise. */
    source: z.string().min(1).nullable(),
  })
  .strict()
  .refine((s) => s.evidence_kind === "sourced_reference" || s.source === null, {
    message:
      "only a sourced_reference section may name a source — authored_copy is PRN's own words, and outcome_record data does not exist yet",
    path: ["source"],
  });

/**
 * Sections whose claims outrun the evidence PRN actually holds. Empty means the
 * playbook's declarations are internally satisfied and a page may draw on it.
 *
 * Two ways a section fails, both structural:
 *  - it declares `sourced_reference` and names no source, so a fact is about to
 *    be published with nothing behind it; or
 *  - it declares `outcome_record`, which is data PRN does not have from anyone
 *    yet (the S01 "Verified Outcome" row of the Claim Ledger), so no value of
 *    `source` could make it publishable today.
 *
 * The gate reads this. See page-eligibility-gate.ts factor 7 and the veto list.
 */
export function unsourcedSections(
  playbook: ServicePlaybook,
): Array<{ section_id: string; evidence_kind: SectionEvidenceKind; why: string }> {
  const out: Array<{ section_id: string; evidence_kind: SectionEvidenceKind; why: string }> = [];
  for (const s of playbook.sections) {
    if (s.evidence_kind === "sourced_reference" && s.source === null) {
      out.push({
        section_id: s.section_id,
        evidence_kind: s.evidence_kind,
        why: "declares sourced_reference and names no source — the claim has nothing behind it",
      });
    }
    if (s.evidence_kind === "outcome_record") {
      out.push({
        section_id: s.section_id,
        evidence_kind: s.evidence_kind,
        why: "rests on outcome data PRN does not hold yet — no source can satisfy it today",
      });
    }
  }
  return out;
}

const DistinguishingQuestion = z
  .object({
    question_id: z.string().min(3),
    question: z.string().min(5),
    /** What each likely answer points toward — the branch table that makes content useful instead of generic. */
    answer_branches: z.array(
      z
        .object({
          answer_pattern: z.string().min(2),
          points_toward: z.string().min(3),
        })
        .strict(),
    ).min(2),
  })
  .strict();

export const ServicePlaybook = z
  .object({
    playbook_id: z
      .string()
      .regex(/^spb_[a-z0-9_]+_v\d+$/, "playbook ids are spb_<trade_slug>_v<N>"),
    schema_version: z.literal(PLAYBOOK_SCHEMA_VERSION),
    version: z.number().int().positive(),
    /** The property system this playbook speaks for. */
    system: z.enum(PROPERTY_SYSTEMS),
    status: z.enum(PLAYBOOK_STATUSES),
    /** Human-facing trade name, e.g. "Tree work". */
    trade_name: z.string().min(3),
    /** Problem-graph node ids this playbook covers. Every id must exist in the graph — the registry validates the join. */
    covers_node_ids: z.array(z.string()).min(1),
    /** The homeowner questions this playbook answers, with authored answers. */
    sections: z.array(PlaybookSection).min(3),
    /** The questions that tell one problem from another that looks like it. */
    distinguishing_questions: z.array(DistinguishingQuestion).min(1),
    /** Safety wording this trade may state. Honest scope: generic, national-scope safety facts only. */
    safety_notes: z.array(z.string().min(10)).min(1),
    /** The honest DIY boundary: what a homeowner can safely check or do themselves. */
    diy_boundary: z.array(z.string().min(10)).min(1),
    /** Provenance: who authored this, who reviewed it, and when. Reviewed-by stays null until a human signs. */
    provenance: z.object({
      authored_by: z.string().min(3),
      authored_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      reviewed_by: z.string().nullable(),
      /** The date the named human signed. Null exactly when reviewed_by is null — a signature without a date is not a signature. */
      reviewed_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    }),
  })
  .strict();

export type ServicePlaybook = z.infer<typeof ServicePlaybook>;

/**
 * A price stated as money, in any field of a playbook.
 *
 * OD-13 keeps prices out until they are sourced, and this file has SAID SO
 * since it was written — but nothing checked it. A verifier inserted "usually
 * runs $1,200 to $3,500" into the signed Tree copy and the whole suite stayed
 * green, because the only dollar grep in the repo ran over the GRAPH. The
 * playbooks are where the homeowner-facing copy actually lives.
 *
 * Deliberately broad: the symbol with a digit, the word "dollars", and bare
 * "USD". Price DRIVERS are words and are untouched by all three.
 */
const MONEY_PATTERNS: ReadonlyArray<{ pattern: RegExp; label: string }> = [
  { pattern: /\$\s?\d/, label: "a dollar figure" },
  { pattern: /\b\d[\d,.]*\s*(?:dollars|usd)\b/i, label: "an amount in dollars" },
  { pattern: /\bUSD\b/, label: "a USD amount" },
];

/** Structural validation beyond the schema: ids, join integrity, status rules, no prices. */
export function validatePlaybook(
  playbook: ServicePlaybook,
  validNodeIds: ReadonlySet<string>,
): string[] {
  const errors: string[] = [];
  for (const id of playbook.covers_node_ids) {
    if (!validNodeIds.has(id)) errors.push(`${playbook.playbook_id}: covers unknown node ${id}`);
  }

  // EVERY field, not just the copy fields — serialising the whole record means
  // a price cannot hide in a branch label, a safety note or an id.
  const raw = JSON.stringify(playbook);
  for (const { pattern, label } of MONEY_PATTERNS) {
    if (pattern.test(raw)) {
      errors.push(
        `${playbook.playbook_id}: contains ${label} — OD-13 keeps prices out of playbooks until they are sourced`,
      );
    }
  }

  // NOTE: unsourced sections are deliberately NOT an error here. Registry
  // errors are fatal at import, and a shadow playbook is allowed to sit
  // mid-authoring with a section waiting on its source. What must not happen is
  // PUBLISHING it — so the check lives at the gate, as a veto, which is exactly
  // what the claim-safety promise in this file's header says. See
  // unsourcedSections() above and page-eligibility-gate.ts.
  if (playbook.status === "authoritative" && playbook.provenance.reviewed_by === null) {
    // An authoritative trade voice with no named human reviewer is exactly how
    // unreviewed copy becomes "the standard" silently. Shadow playbooks may
    // wait for review; authoritative ones may not.
    errors.push(
      `${playbook.playbook_id}: authoritative status requires provenance.reviewed_by (a named human), not null`,
    );
  }
  const { reviewed_by, reviewed_at } = playbook.provenance;
  if ((reviewed_by === null) !== (reviewed_at === null)) {
    // A named reviewer with no date, or a date with no name, is a half-signature.
    errors.push(
      `${playbook.playbook_id}: provenance.reviewed_by and provenance.reviewed_at must be set together or both null`,
    );
  }
  return errors;
}

export type { PropertySystem };
