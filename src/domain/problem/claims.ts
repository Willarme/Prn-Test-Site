import {
  ClaimClass,
  ClaimProvenance,
  DerivationRecord,
  FactClaim,
  PrivacyClass,
  PublicEligibility,
} from "@/domain/problem/contracts";

/**
 * FACTCLAIM CONSTRUCTION — the only sanctioned way to mint one.
 *
 * ─── THE RULE THIS FILE ENFORCES ───────────────────────────────────────────
 *
 * "Never invent a fact" is the load-bearing promise of the whole product, and a
 * promise nobody can check is a slogan. Here it is three mechanical things:
 *
 *   1. `evidence_ids` is `.min(1)` in the schema. A claim with no evidence does
 *      not parse. There is no flag to relax it.
 *   2. `provenance` is derived from `claim_class` by ONE function, and a test
 *      asserts every constructed claim agrees with it. A homeowner's own words
 *      cannot be relabelled as an inference by a typo.
 *   3. Privacy starts at USER_PRIVATE and this module has no code path that
 *      raises it. `elevatePrivacy()` deliberately does not exist; the only
 *      exported privacy helper REFUSES.
 *
 * ─── WHAT A01 MAY NOT DO WITH PRIVACY, STATED AS CODE ──────────────────────
 *
 * A01 may never move a fact toward AGGREGATE_ONLY or PUBLIC. That gate belongs
 * to the publication system (canon; Loop Spec Audit A01 condition 3). The
 * temptation is real and specific: A01 is the agent that produces the homeowner
 * language the SEO engine wants, so the shortest path from "we have this" to "we
 * published this" runs through exactly this file. It is closed here rather than
 * documented here.
 */

/**
 * THE ONE PLACE THE MAPPING IS WRITTEN. Referenced by the contract's comment,
 * asserted by a test, and used by every constructor below.
 */
export function claimProvenanceFor(claimClass: ClaimClass): ClaimProvenance {
  switch (claimClass) {
    case "OBSERVED":
    case "SUPPLIED":
      return "supplied";
    case "CALCULATED":
    case "INFERRED":
      return "inferred";
  }
}

/**
 * The privacy vocabularies, as data rather than prose — the artefact
 * pre-answer 13 asks a build session to produce, because four vocabularies
 * collide here and somebody eventually has to reconcile them.
 */
export const PRIVACY_CLASS_MAPPING: readonly {
  privacy_class: PrivacyClass;
  public_eligibility: PublicEligibility;
  /** EvidenceObject.privacy — a literal "private", so only one row can carry it. */
  evidence_privacy: "private" | null;
  /** emitPlatformEvent's privacy_class. */
  event_privacy_class: "private" | "internal" | "public_safe";
}[] = [
  {
    privacy_class: "USER_PRIVATE",
    public_eligibility: "NO",
    evidence_privacy: "private",
    event_privacy_class: "private",
  },
  {
    privacy_class: "DERIVED_LOCAL",
    public_eligibility: "AGGREGATE_ONLY",
    evidence_privacy: null,
    event_privacy_class: "internal",
  },
  {
    privacy_class: "PUBLIC_SAFE",
    public_eligibility: "YES_IF_POLICY",
    evidence_privacy: null,
    event_privacy_class: "public_safe",
  },
];

export function publicEligibilityFor(privacyClass: PrivacyClass): PublicEligibility {
  const row = PRIVACY_CLASS_MAPPING.find((r) => r.privacy_class === privacyClass);
  if (!row) throw new Error(`no public_eligibility mapping for privacy class "${privacyClass}"`);
  return row.public_eligibility;
}

/**
 * THE NEVER-ELEVATE GUARD. Named for what it refuses, because that is what it
 * is for. A01 has no legitimate reason to call this with anything but
 * USER_PRIVATE; it exists so that an attempt is a thrown error at the seam
 * rather than a quiet widening three files away.
 */
export function assertA01MayWritePrivacyClass(privacyClass: PrivacyClass): void {
  if (privacyClass !== "USER_PRIVATE") {
    throw new Error(
      `A01 may not write privacy class "${privacyClass}" — every fact it establishes is USER_PRIVATE, ` +
        "and elevation toward AGGREGATE_ONLY or PUBLIC belongs to the publication system, not to this agent"
    );
  }
}

export interface NewFactClaimInput {
  claim_id: string;
  problem_id: string;
  subject: string;
  predicate: string;
  object: string;
  claim_class: ClaimClass;
  evidence_ids: readonly string[];
  /** Inference only. A supplied fact is not something we are "confident" about. */
  confidence?: "high" | "medium" | "low" | null;
  created_by_run_id?: string | null;
  derivation_id?: string | null;
  created_at: string;
  tenant_id?: string;
}

/**
 * Build one FactClaim. Privacy is NOT a parameter: there is exactly one value
 * A01 is permitted to write, so offering the choice would be offering the bug.
 */
export function newFactClaim(input: NewFactClaimInput): FactClaim {
  const privacy_class: PrivacyClass = "USER_PRIVATE";
  assertA01MayWritePrivacyClass(privacy_class);
  const provenance = claimProvenanceFor(input.claim_class);
  return FactClaim.parse({
    claim_id: input.claim_id,
    ...(input.tenant_id ? { tenant_id: input.tenant_id } : {}),
    schema_version: "1.0.0",
    problem_id: input.problem_id,
    subject: input.subject,
    predicate: input.predicate,
    object: input.object,
    claim_class: input.claim_class,
    provenance,
    evidence_ids: [...input.evidence_ids],
    // A supplied fact carries no confidence: the homeowner is not a hypothesis.
    confidence: provenance === "supplied" ? null : (input.confidence ?? "low"),
    privacy_class,
    public_eligibility: publicEligibilityFor(privacy_class),
    created_by_run_id: input.created_by_run_id ?? null,
    derivation_id: input.derivation_id ?? null,
    created_at: input.created_at,
    verification_status: null,
    valid_from: null,
    valid_to: null,
    freshness_status: null,
    dispute_status: null,
  });
}

export interface NewDerivationInput {
  derivation_id: string;
  problem_id: string;
  claim_ids: readonly string[];
  method: "deterministic" | "model";
  capability_key: string;
  model_id?: string | null;
  prompt_id?: string | null;
  prompt_version?: string | null;
  schema_contract_version?: string | null;
  policy_version?: string | null;
  input_evidence_ids: readonly string[];
  agent_run_id?: string | null;
  created_at: string;
  tenant_id?: string;
}

export function newDerivationRecord(input: NewDerivationInput): DerivationRecord {
  return DerivationRecord.parse({
    derivation_id: input.derivation_id,
    ...(input.tenant_id ? { tenant_id: input.tenant_id } : {}),
    schema_version: "1.0.0",
    problem_id: input.problem_id,
    claim_ids: [...input.claim_ids],
    method: input.method,
    capability_key: input.capability_key,
    model_id: input.model_id ?? null,
    prompt_id: input.prompt_id ?? null,
    prompt_version: input.prompt_version ?? null,
    schema_contract_version: input.schema_contract_version ?? null,
    policy_version: input.policy_version ?? null,
    input_evidence_ids: [...input.input_evidence_ids],
    agent_run_id: input.agent_run_id ?? null,
    created_at: input.created_at,
  });
}

/**
 * HO-1 / HO-5, ANSWERED BY NOT DOING IT — and the reason is worth keeping next
 * to the objects rather than in a report.
 *
 * The registered capability `derive_public_safe_fact_bundle` converts FactClaims
 * into the FactBundles A05's pages cite. It is R4, ownerless, and has no
 * executor. A01 could plausibly claim it — A01 makes the claims — and this wave
 * deliberately does not, for two reasons that are structural rather than
 * scheduling:
 *
 *   1. `source_fact_bundle_ids` is FULL. Every published block already cites a
 *      content-bank bundle, and those are authored first-party statements with
 *      no customer derivation in them at all. Adding A01-derived bundles is
 *      ADDITIVE later; replacing them now would swap a safe source for an
 *      unreviewed one to fill a field that is not empty.
 *   2. Every claim this module can mint is USER_PRIVATE / NO. A bundle derived
 *      from them would need an elevation this agent is forbidden to perform, and
 *      the elevation gate (consent scope, aggregation floor, owner approval) is
 *      the thing that does not exist yet. Building the converter first would put
 *      the machinery in place and leave the rule to be written afterwards —
 *      which is the exact ordering the language-mining policy was written to
 *      prevent.
 *
 * TODO-ASK-OWNER (Joshua): assign `derive_public_safe_fact_bundle` an owning
 * agent, or record the deferral. A01 declines it on the reasoning above.
 */
export const A01_DOES_NOT_WRITE_FACT_BUNDLES = true;
