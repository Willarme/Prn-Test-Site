import { z } from "zod";
import { Id, IsoDateTime, SchemaVersion } from "@/domain/shared/primitives";

/**
 * ProblemRecord — canonical structured state of one home problem (#14A §10.2).
 * Field names align with the Build Kit's problem_record.schema.json (parity
 * tested). Raw customer evidence lives in EvidenceObject, SEPARATE from
 * structured facts and inference — never merged (#14A §1.2).
 */
export const ProblemStatus = z.enum(["draft", "clarifying", "packet_ready", "closed"]);
export const SourceChannel = z.enum(["web", "api", "mcp", "admin", "import"]);
export const SafetyState = z.enum(["normal", "review", "urgent"]);

export const ProblemRecord = z.object({
  problem_id: Id,
  schema_version: SchemaVersion,
  /**
   * RECONCILED, NOT REDEFINED — A01 build, 2026-08-25 (Loop Spec Audit A01
   * conditions 5 and 7, pre-answer 7).
   *
   * The A01 spec's §4 proposes a DIFFERENT field set for this object
   * (`user_language`, `normalized_class`, `clarifier_answers`, `safety_flags`,
   * and a 0-1 `confidence` number). This record ships with field-name parity
   * against the Build Kit's problem_record.schema.json and is imported by
   * eleven files including the intake route, the results page and A02's
   * packet-assembly. So the delta is REPORTED, not resolved, and the shipped
   * names stay:
   *
   *   spec §4                shipped here           why the shipped name wins
   *   user_language      ->  problem_summary        Build Kit parity, 11 importers
   *   normalized_class   ->  service_category       same
   *   clarifier_answers  ->  clarifiers_asked       same
   *   safety_flags       ->  safety_state +         the flag AND the rule that
   *                          safety_rule_id         raised it, not one blended field
   *   confidence: number ->  high|medium|low        a three-value enum the packet
   *                                                 already renders as words
   *
   * TODO-ASK-OWNER (Joshua): which vocabulary is canon long-term. That is a
   * canon-precedence ruling, not a coding decision, and nothing is blocked by
   * leaving it open — this record and the spec's describe the same object.
   *
   * `tenant_id` is the one ADDITION, per A00 approval condition 1 as carried
   * into A01 condition 7: every core record carries an optional tenant, default
   * "prn", with NO tenant logic anywhere. This is the first table that will hold
   * real homeowner rows, and adding a NOT NULL tenant column to populated
   * homeowner data later is the expensive version of this fix.
   */
  tenant_id: z.string().min(1).optional(),
  status: ProblemStatus,
  source_channel: SourceChannel,
  intake_session_id: Id.nullable(),
  problem_summary: z.string().nullable(),
  /** Inference, labeled as such — never presented as customer-stated fact. */
  service_category: z.string().nullable(),
  service_category_confidence: z.enum(["high", "medium", "low"]).nullable(),
  safety_state: SafetyState,
  safety_rule_id: Id.nullable(),
  evidence_ids: z.array(Id),
  claim_ids: z.array(Id),
  clarifiers_asked: z.array(z.object({ question: z.string(), answer: z.string().nullable() })),
  created_at: IsoDateTime,
  updated_at: IsoDateTime.nullable(),
});
export type ProblemRecord = z.infer<typeof ProblemRecord>;

/** The default tenant every record carries until a second client exists. */
export const DEFAULT_TENANT_ID = "prn";

/** Raw supplied evidence — private by default, preserved verbatim. */
export const EvidenceObject = z.object({
  evidence_id: Id,
  /** Reserved — white-label condition C7. Default "prn"; NO tenant logic exists. */
  tenant_id: z.string().min(1).optional(),
  kind: z.enum(["customer_text", "photo", "video", "voice_transcript"]),
  /** Text content, or the PRIVATE storage reference for media. Never a public URL. */
  content: z.string(),
  privacy: z.literal("private"),
  captured_at: IsoDateTime,
  mime: z.string().nullable().optional(),
  bytes: z.number().int().min(0).nullable().optional(),
  /** Which required field this media satisfies, when applicable. */
  field_key: z.string().nullable().optional(),
});
export type EvidenceObject = z.infer<typeof EvidenceObject>;

// ---------------------------------------------------------------------------
// FactClaim + DerivationRecord — A01's durable moat objects (canon 04_DATA_MODEL)
// ---------------------------------------------------------------------------

/**
 * WHY THESE EXIST AT ALL, AND WHY HERE.
 *
 * `FactClaim` and `DerivationRecord` are named by canon as required durable
 * objects and returned ZERO hits in src/ until this commit. A01 owns them
 * because A01 is the agent that first turns a homeowner's sentence into a
 * structured assertion — and the whole product rests on the claim that PRN
 * never invents a fact. That claim is only checkable if every fact carries,
 * structurally, where it came from.
 *
 * TWO CONSUMERS ARE ALREADY WAITING (Trial Spec Audit hand-offs HO-1 and HO-5):
 * A02's `claim_basis`/`evidence_basis` fields reference FactClaim, and the
 * registered-but-ownerless capability `derive_public_safe_fact_bundle` is the
 * FactClaim → FactBundle conversion. Neither is wired this wave — see the
 * public-eligibility note below for the one rule that keeps that safe.
 */

/**
 * CANON'S FOUR CLASSES (Information Structure §5.3 / 04_DATA_MODEL.md), kept
 * verbatim because they are established names, and because collapsing them
 * would throw away a distinction the trial does not need but the product will:
 * OBSERVED (the system saw it — a photo, a reading) is not the same as SUPPLIED
 * (the homeowner said it), and CALCULATED (arithmetic over known values) is not
 * the same as INFERRED (a judgement that could be wrong).
 */
export const ClaimClass = z.enum(["OBSERVED", "SUPPLIED", "CALCULATED", "INFERRED"]);
export type ClaimClass = z.infer<typeof ClaimClass>;

/**
 * THE TWO-VALUE PROVENANCE, AND WHY IT IS A SEPARATE FIELD RATHER THAN A LOOKUP.
 *
 * The hard rule A01 must make structurally checkable is narrower than the four
 * classes: did the homeowner tell us this, or did we work it out? Every
 * downstream surface that shows a fact to a human — the packet, the results
 * page, a provider's copy of it — needs that one bit and needs it to be
 * impossible to get wrong. A one-line mapping from claim_class would be correct
 * today and one enum value away from silently mislabelling a customer's own
 * words as an inference.
 *
 *   OBSERVED   -> supplied    the evidence itself carries it
 *   SUPPLIED   -> supplied    the homeowner said it
 *   CALCULATED -> inferred    derived, however mechanically
 *   INFERRED   -> inferred    a judgement
 *
 * `claimProvenanceFor()` in claims.ts is the one place that mapping is written,
 * and a test asserts the stored field agrees with it on every claim.
 */
export const ClaimProvenance = z.enum(["supplied", "inferred"]);
export type ClaimProvenance = z.infer<typeof ClaimProvenance>;

/**
 * PRIVACY CLASS — the default is USER_PRIVATE and A01 MAY NEVER RAISE IT.
 *
 * Four vocabularies collide at exactly this seam (Loop Spec Audit A01
 * pre-answer 13; Compendium conflict 14, "no mapping exists; neither references
 * the other"). Rather than invent a fifth, the mapping is recorded here as the
 * artefact, and the reconciliation someone must eventually do starts from it:
 *
 *   this field           §4 public_eligibility   EvidenceObject.privacy   event privacy_class
 *   USER_PRIVATE     ->  NO                   ->  "private"           ->  "private"
 *   DERIVED_LOCAL    ->  AGGREGATE_ONLY       ->  (no evidence)       ->  "internal"
 *   PUBLIC_SAFE      ->  YES_IF_POLICY        ->  (no evidence)       ->  "public_safe"
 *
 * Canon's stated default for unknown data rights is `restricted`, and
 * USER_PRIVATE is this vocabulary's spelling of restricted. Every claim A01
 * writes gets it, including claims about nothing sensitive, because "this one
 * looked harmless" is how a private corpus becomes a public one.
 */
export const PrivacyClass = z.enum(["USER_PRIVATE", "DERIVED_LOCAL", "PUBLIC_SAFE"]);
export type PrivacyClass = z.infer<typeof PrivacyClass>;

/** Canon's §4 field, kept alongside the privacy class it maps to. */
export const PublicEligibility = z.enum(["NO", "AGGREGATE_ONLY", "YES_IF_POLICY"]);
export type PublicEligibility = z.infer<typeof PublicEligibility>;

export const FactClaim = z.object({
  claim_id: Id,
  /** Reserved — white-label condition C7. Default "prn"; NO tenant logic exists. */
  tenant_id: z.string().min(1).optional(),
  schema_version: SchemaVersion,
  /** The ProblemRecord this claim is about. */
  problem_id: Id,
  /** Subject-predicate-object, canon's shape. Subject is an id or "problem". */
  subject: z.string().min(1),
  predicate: z.string().min(1),
  object: z.string().min(1),
  claim_class: ClaimClass,
  /** The one bit every human-facing surface needs. See ClaimProvenance. */
  provenance: ClaimProvenance,
  /**
   * AT LEAST ONE, ALWAYS. A claim with no evidence is an invented fact, which
   * is the single thing this object exists to make impossible. `.min(1)` is the
   * enforcement; there is no "system default" escape hatch in the trial.
   */
  evidence_ids: z.array(Id).min(1),
  /**
   * PER-FACT CONFIDENCE, DELIBERATELY SEPARATE FROM THE CLASSIFICATION'S.
   * `ProblemRecord.service_category_confidence` says how sure we are which
   * trade this is. This says how sure we are of THIS fact. They are different
   * questions with different answers — a confident "plumbing" classification
   * can carry a low-confidence guess about when the leak started — and one
   * number standing in for both would be wrong in whichever direction it was
   * read. Null on a supplied fact: the homeowner said it, so there is nothing
   * for us to be confident about.
   */
  confidence: z.enum(["high", "medium", "low"]).nullable(),
  privacy_class: PrivacyClass,
  public_eligibility: PublicEligibility,
  /** The agent-run that produced it (Agent Run Ledger id). */
  created_by_run_id: Id.nullable(),
  /** The DerivationRecord, for inferred claims. Null when nothing was derived. */
  derivation_id: Id.nullable(),
  created_at: IsoDateTime,
  /**
   * CANON FIELDS A01 DOES NOT POPULATE IN THE TRIAL. They stay on the object so
   * nothing here reads as a complete canon record when a subset is actually in
   * use, and so the day a mechanism exists it has a column rather than a
   * migration. verification_status: no verification pathway exists.
   * valid_from/valid_to: no time-bound facts. freshness_status: ties to the
   * unresolved verified/qualified freshness tension. dispute_status: no dispute
   * pathway is documented anywhere.
   */
  verification_status: z.string().nullable().optional(),
  valid_from: IsoDateTime.nullable().optional(),
  valid_to: IsoDateTime.nullable().optional(),
  freshness_status: z.string().nullable().optional(),
  dispute_status: z.string().nullable().optional(),
});
export type FactClaim = z.infer<typeof FactClaim>;

/**
 * DerivationRecord — WHAT PRODUCED A CLAIM, in enough detail to reproduce or
 * indict it. One per inference (canon §5: "a DerivationRecord for each
 * inference it makes").
 *
 * The version fields are the point. When a claim turns out to be wrong, the
 * question is never "was this claim wrong" — it is "how many others did the
 * thing that produced it also get wrong", and that is only answerable if the
 * method, the prompt version, the schema version and the policy version that
 * produced it were written down at the time.
 */
export const DerivationRecord = z.object({
  derivation_id: Id,
  /** Reserved — white-label condition C7. Default "prn"; NO tenant logic exists. */
  tenant_id: z.string().min(1).optional(),
  schema_version: SchemaVersion,
  problem_id: Id,
  /** The claims this derivation produced. */
  claim_ids: z.array(Id),
  /**
   * HOW it was produced. "deterministic" is the shipped path — pattern matching
   * over a versioned taxonomy — and is not a lesser citizen: most of what A01
   * establishes needs no model and saying so precisely is more useful than a
   * generic "engine" label.
   */
  method: z.enum(["deterministic", "model"]),
  /** Capability key this ran under, e.g. "classify_home_problem". */
  capability_key: z.string().min(1),
  /** Null on the deterministic path — there is no model to name. */
  model_id: z.string().nullable(),
  prompt_id: z.string().nullable(),
  prompt_version: z.string().nullable(),
  /** The output-contract version the reply was validated against. */
  schema_contract_version: z.string().nullable(),
  /** Which taxonomy/policy version was in force. */
  policy_version: z.string().nullable(),
  /** The evidence the derivation read. */
  input_evidence_ids: z.array(Id),
  /** Agent Run Ledger id, so cost and latency are joinable. */
  agent_run_id: Id.nullable(),
  created_at: IsoDateTime,
});
export type DerivationRecord = z.infer<typeof DerivationRecord>;

/**
 * Job-Ready Packet (#14A §5.1). Every section that is inference carries an
 * inference label; the packet never invents facts, never guarantees savings,
 * and never claims a diagnosis.
 */
export const JobPacket = z.object({
  job_packet_id: Id,
  packet_version: z.number().int().positive(),
  schema_version: SchemaVersion,
  problem_id: Id,
  summary_plain: z.string().min(1),
  observed_statements: z.array(z.string()),
  symptoms_and_timing: z.string().nullable(),
  likely_service_category: z.object({
    value: z.string().nullable(),
    confidence: z.enum(["high", "medium", "low"]),
    note: z.literal("This is an inference from the description, not a diagnosis."),
  }),
  what_remains_unknown: z.array(z.string()),
  safe_prep_notes: z.array(z.string()),
  questions_for_provider: z.array(z.string()),
  call_script: z.string().min(1),
  /** Equipment/context details the customer supplied (label → value). */
  collected_details: z.array(z.object({ label: z.string(), value: z.string(), source: z.string() })).default([]),
  /** Number of photos/videos attached (the media itself stays private). */
  media_count: z.number().int().min(0).default(0),
  /** Guided-diagnosis findings, when the customer walked through it. */
  diagnosis: z
    .object({
      outcome_title: z.string(),
      likely_cause: z.string(),
      steps_answered: z.array(z.object({ step: z.string(), answer: z.string() })),
      provider_note: z.string(),
    })
    .nullable()
    .default(null),
  generated_at: IsoDateTime,
  engine: z.enum(["fixture", "production"]),
});
export type JobPacket = z.infer<typeof JobPacket>;
