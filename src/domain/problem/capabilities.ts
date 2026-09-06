import { randomUUID } from "node:crypto";
import {
  newDerivationRecord,
  newFactClaim,
} from "@/domain/problem/claims";
import type {
  DerivationRecord,
  EvidenceObject,
  FactClaim,
  ProblemRecord,
} from "@/domain/problem/contracts";
import type { AnalyzeInput, AnalyzeResult } from "@/domain/problem/fixture-engine";
import { SAFETY_PACKAGE_VERSION, checkSafety } from "@/domain/problem/safety";
import { ACTIVE_PROBLEM_TAXONOMY } from "@/domain/problem/taxonomy";
import { detectFields } from "@/domain/intake/extract";
import type { FieldRequirement } from "@/domain/intake/playbook";
import type { ClarifierInput, ClarifierSelection } from "@/domain/problem/clarifier";
import { capReached } from "@/domain/problem/clarifier";
import { emitPlatformEvent } from "@/platform/events/emit";
import { capability_call } from "@/platform/gateway";
import { CLASSIFY_PROMPT, classifyHomeProblem, type ClassifyOptions } from "@/platform/problem/ai-classify";
import {
  CLARIFIER_PROMPT,
  selectNextClarifier,
  type ClarifierOptions,
} from "@/platform/problem/ai-clarifier";

/**
 * A01 — THE PRODUCTION CAPABILITY SURFACE.
 *
 * ─── WHY A NEW FILE AND NOT A CHANGE TO THE FIXTURE ENGINE ─────────────────
 *
 * Loop Spec Audit pre-answer 8 and Trial Spec Audit HO-3 both rule the same way:
 * DO NOT SPLIT fixture-engine.ts — add this file alongside it. Both halves of
 * that file are bound by PATH STRING in the capability registry's
 * `implementation_ref`, and its header carries a promise to the rest of the
 * repo: the swap happens "without touching pages, intake, or results". So
 * nothing here edits it. This is the production implementation standing behind
 * the same contract, which is what HO-3 asks for.
 *
 * ─── AND IT IS THE LIVE PATH, 2026-08-25 (finding 1) ───────────────────────
 *
 * It was not. This file shipped with ZERO live callers: `api/intake/route.ts`
 * called `analyzeProblemFixture` directly, so a real customer journey produced
 * no FactClaim, no DerivationRecord (`claim_ids: []` on every stored record),
 * and neither `problem.fact_extracted` nor `intake.clarifier_asked` could fire
 * anywhere in the running app. A production surface with no callers is a
 * rehearsal, and the instruments it owns are append-only history that cannot be
 * backfilled — a trial run without them has no baseline, permanently.
 *
 * The intake route now goes through `classifyProblem` and `selectClarifier`.
 * NOTHING A HOMEOWNER SEES CHANGED: the classification underneath is the same
 * deterministic analyzer producing the same ProblemRecord, the same packet and
 * the same page. What changed is the record behind it — governed, claimed,
 * derived and instrumented. The AI flags stay off; `allow_model: false` on that
 * call site means the model-backed alternate is not even asked.
 *
 * ─── WHAT THIS ADDS THAT THE PIECES DID NOT HAVE ───────────────────────────
 *
 * The deterministic analyzer, the model-backed classifier and the clarifier all
 * already existed. What did not exist was the thing that makes A01 an agent
 * rather than three functions:
 *
 *   1. It runs through the GOVERNED DOOR. The deterministic execution goes
 *      through `capability_call`, so every classification gets the registry
 *      lookup, the kill-switch check, the allowed-capability check, a ledger row
 *      and a `capability.invoked` event — instead of a direct function call that
 *      no governance can see. A kill switch on A01 now actually stops A01.
 *   2. It produces the DURABLE FACTS. Every classification yields FactClaims
 *      traceable to evidence and one DerivationRecord naming what produced them.
 *   3. It EMITS. `problem.fact_extracted` per claim, on names A08 ratified.
 *
 * ─── THE ORDER IS NOT NEGOTIABLE ───────────────────────────────────────────
 *
 * Safety gate (deterministic, human-reviewed rules) → governed deterministic
 * classification → optional model refinement → facts → events. A hard-stop
 * safety rule returns before the second step: no classification, no facts, no
 * model, no events beyond the safety one the caller already emitted. The model
 * is never consulted about safety and never sees a hard-stopped description.
 *
 * ─── THE DETERMINISTIC PATH IS THE DEFAULT, NOT THE FALLBACK ───────────────
 *
 * `allow_model` defaults to true only in the sense that the already-wired
 * capability is consulted; that capability ships FLAG OFF and, on the model the
 * owner is starting on, is refused before any network call because it handles
 * customer data. So the shipped behaviour of this file today is: deterministic
 * classification, deterministic facts, no network, cost 0.
 *
 * ─── HOMEOWNER TEXT IS EVIDENCE, NOT INSTRUCTIONS (A01 §7) ─────────────────
 *
 * Nothing in this file branches on the CONTENT of what a homeowner wrote. The
 * description reaches exactly two places: the safety matcher (fixed patterns)
 * and the classifier (fixed taxonomy). It never reaches a control decision —
 * not the cap, not the gate, not the privacy class, not whether the model runs.
 * See tests/a01.prompt-injection.test.ts, which proves it by feeding this path
 * instructions and comparing every one of those outcomes.
 */

export interface ClassifyProblemOptions extends ClassifyOptions {
  /**
   * Consult the model-backed alternate at all. Default true — which today means
   * "ask a capability that is flag-off and privacy-refused", i.e. deterministic.
   * Set false for a caller that wants the deterministic answer and no refusal
   * row in the ledger.
   */
  allow_model?: boolean;
  /**
   * Playbook fields whose auto-detect patterns turn the homeowner's own words
   * into SUPPLIED claims. Omitted means no supplied claims are established —
   * never that they are guessed.
   */
  fields?: readonly FieldRequirement[];
  /**
   * THE SAME THING, RESOLVED FROM THE CLASSIFICATION INSTEAD OF BEFORE IT.
   *
   * Which fields matter depends on which trade this is, and the trade is not
   * known until the classification returns — A01's own §3 flowchart puts the
   * Playbook Resolver AFTER Classify for exactly this reason. A caller that
   * already knows its field list passes `fields`; a caller whose playbook is
   * chosen by `service_category` (the live intake route) passes this instead,
   * and the resolution happens at the one moment both facts exist.
   *
   * It runs at step 4, after the classification and before any claim is minted.
   * `fields` wins when both are given.
   */
  resolve_fields?: (problem: ProblemRecord) => readonly FieldRequirement[];
  /** Deterministic id source, so a test can pin claim ids. */
  new_id?: () => string;
  tenant_id?: string;
  /**
   * Canonical IDS the governed call should record as its inputs — never raw
   * text. Defaults to the intake session alone; the live route adds its
   * request_id so a ledger row can be joined back to the journey it served.
   */
  input_ids?: readonly string[];
}

export interface ClassifyProblemOutcome {
  ok: boolean;
  /** Null only when governance refused the run (kill switch, permission). */
  result: AnalyzeResult | null;
  claims: FactClaim[];
  derivation: DerivationRecord | null;
  engine: "deterministic" | "model";
  /** Null on the model path; the recorded reason on every other path. */
  fallback_reason: string | null;
  /** Set when a hard-stop safety rule ended the run before classification. */
  safety_rule_id: string | null;
  intent_cluster: string | null;
  run_id: string | null;
  /** TEST. Null when no model ran. */
  cost_usd: number | null;
  /** Why a refusal happened, when ok is false. */
  refusal: string | null;
}

function idFactory(supplied?: () => string): () => string {
  return supplied ?? (() => randomUUID());
}

/**
 * SUPPLIED CLAIMS — the homeowner's own words, matched by the playbook's own
 * patterns. No confidence: they did not tell us a probability, they told us a
 * thing, and attaching a number to it would be inventing a doubt they did not
 * express.
 */
function suppliedClaims(
  problem: ProblemRecord,
  evidence: EvidenceObject,
  fields: readonly FieldRequirement[],
  newId: () => string,
  now: string,
  tenantId?: string
): FactClaim[] {
  if (fields.length === 0) return [];
  return detectFields(evidence.content, [...fields]).map((d) =>
    newFactClaim({
      claim_id: `fc_${newId()}`,
      problem_id: problem.problem_id,
      subject: problem.problem_id,
      predicate: d.field_key,
      object: d.value_text,
      claim_class: "SUPPLIED",
      evidence_ids: [evidence.evidence_id],
      created_at: now,
      tenant_id: tenantId,
    })
  );
}

export async function classifyProblem(
  input: AnalyzeInput,
  options: ClassifyProblemOptions = {}
): Promise<ClassifyProblemOutcome> {
  const newId = idFactory(options.new_id);
  const tenantId = options.tenant_id;
  const base: ClassifyProblemOutcome = {
    ok: true,
    result: null,
    claims: [],
    derivation: null,
    engine: "deterministic",
    fallback_reason: null,
    safety_rule_id: null,
    intent_cluster: null,
    run_id: null,
    cost_usd: null,
    refusal: null,
  };

  /**
   * 1. SAFETY, FIRST AND DETERMINISTICALLY. Not "before the model" — before
   *    everything, including the governed classification call. When a rule says
   *    intake may not continue, the honest output is the approved copy and
   *    nothing else: no record to classify, no facts to extract from someone who
   *    should be outside the building.
   */
  const safety = checkSafety(input.description);
  if (safety && !safety.intake_may_continue) {
    return {
      ...base,
      safety_rule_id: safety.safety_rule_id,
      fallback_reason: `safety rule ${safety.safety_rule_id} is a hard stop — intake does not continue, and nothing was classified`,
    };
  }

  /**
   * 2. THE GOVERNED DOOR. The deterministic classification runs through the
   *    gateway rather than as a direct call, so it is subject to the kill
   *    switch and leaves an audit row. `classify_problem` is the alias A01 holds
   *    in its allowed list.
   */
  const gated = await capability_call<AnalyzeResult>({
    agent_id: "A01",
    capability: "classify_problem",
    args: input,
    input_ids: options.input_ids
      ? [...options.input_ids]
      : input.intake_session_id
        ? [input.intake_session_id]
        : [],
    trigger: "request",
  });
  if (!gated.ok) {
    return {
      ...base,
      ok: false,
      refusal: `${gated.kind}: ${gated.reason}`,
      fallback_reason: `the governed capability call was refused (${gated.reason}) — A01 produced nothing`,
      run_id: gated.run_id ?? null,
    };
  }

  let result: AnalyzeResult = gated.output;
  let engine: "deterministic" | "model" = "deterministic";
  let fallbackReason: string | null = "the model-backed alternate was not consulted";
  let intentCluster: string | null = null;
  let runId: string | null = gated.run_id ?? null;
  let costUsd: number | null = null;
  let modelFacts: { key: string; value: string; confidence: "high" | "medium" | "low" }[] = [];

  /**
   * 3. THE MODEL-BACKED ALTERNATE — already wired, flag off, and refused before
   *    any network call on a model not cleared for customer data. It may set the
   *    trade and its confidence and offer inferred facts; it cannot touch safety,
   *    which is written over from the deterministic pass inside that module.
   */
  if (options.allow_model !== false) {
    const refined = await classifyHomeProblem(input, {
      vocabulary: options.vocabulary,
      deps: options.deps,
    });
    result = refined.result;
    engine = refined.engine;
    fallbackReason = refined.fallback_reason;
    intentCluster = refined.intent_cluster;
    runId = refined.run_id ?? runId;
    costUsd = refined.cost_usd;
    modelFacts = refined.facts.map((f) => ({
      key: f.key,
      value: f.value,
      confidence: f.confidence,
    }));
  }

  /**
   * 4. THE FACTS. Supplied first — what the homeowner actually said — then the
   *    inferences, each labelled as one. The classification itself is an
   *    inference and is recorded as a claim like any other: it is the single
   *    most consequential guess A01 makes, and leaving it off the claim ledger
   *    while recording smaller ones would be exactly backwards.
   */
  const fields = options.fields ?? options.resolve_fields?.(result.problem) ?? [];
  const claims: FactClaim[] = [
    ...suppliedClaims(result.problem, result.evidence, fields, newId, input.now, tenantId),
  ];
  if (result.problem.service_category) {
    claims.push(
      newFactClaim({
        claim_id: `fc_${newId()}`,
        problem_id: result.problem.problem_id,
        subject: result.problem.problem_id,
        predicate: "likely_service_category",
        object: result.problem.service_category,
        claim_class: "INFERRED",
        evidence_ids: [result.evidence.evidence_id],
        confidence: result.problem.service_category_confidence ?? "low",
        created_at: input.now,
        tenant_id: tenantId,
      })
    );
  }
  for (const fact of modelFacts) {
    claims.push(
      newFactClaim({
        claim_id: `fc_${newId()}`,
        problem_id: result.problem.problem_id,
        subject: result.problem.problem_id,
        predicate: fact.key,
        object: fact.value,
        claim_class: "INFERRED",
        evidence_ids: [result.evidence.evidence_id],
        confidence: fact.confidence,
        created_at: input.now,
        tenant_id: tenantId,
      })
    );
  }

  /**
   * 5. THE DERIVATION. One per classification run, naming every version that
   *    could later be blamed — including the safety package and the taxonomy,
   *    because "which trade list was in force" is exactly the question a wrong
   *    classification raises.
   */
  const derivation = newDerivationRecord({
    derivation_id: `dr_${newId()}`,
    problem_id: result.problem.problem_id,
    claim_ids: claims.map((c) => c.claim_id),
    method: engine,
    capability_key: "classify_home_problem",
    model_id: null,
    prompt_id: engine === "model" ? CLASSIFY_PROMPT.prompt_id : null,
    prompt_version: engine === "model" ? CLASSIFY_PROMPT.prompt_version : null,
    schema_contract_version: result.problem.schema_version,
    policy_version: `${ACTIVE_PROBLEM_TAXONOMY.taxonomy_id}@${ACTIVE_PROBLEM_TAXONOMY.version}+${SAFETY_PACKAGE_VERSION}`,
    input_evidence_ids: [result.evidence.evidence_id],
    agent_run_id: runId,
    created_at: input.now,
    tenant_id: tenantId,
  });

  /**
   * THE RECORD A01 HANDS BACK carries the claim ids it just established and,
   * when the caller named a tenant, that tenant — on BOTH halves. The
   * deterministic analyzer cannot stamp them: it is bound by path string in the
   * capability registry and promises the rest of the repo it will not change
   * (HO-3), so the tenant is applied here, to A01's own output, and again as a
   * default at the store boundary so no writer can omit it.
   */
  const withClaims: AnalyzeResult = {
    evidence: { ...result.evidence, ...(tenantId ? { tenant_id: tenantId } : {}) },
    problem: {
      ...result.problem,
      ...(tenantId ? { tenant_id: tenantId } : {}),
      claim_ids: claims.map((c) => c.claim_id),
    },
  };

  // 6. EMIT. Ids and classifications only — never the claim's value.
  for (const c of claims) {
    await emitPlatformEvent({
      event_name: "problem.fact_extracted",
      agent_id: "A01",
      agent_run_id: runId,
      context: {
        problem_id: c.problem_id,
        claim_id: c.claim_id,
        claim_class: c.claim_class,
        provenance: c.provenance,
      },
      versions: { schema: c.schema_version, engine },
      privacy_class: "internal",
      cost_usd: 0,
      ...(tenantId ? { tenant_id: tenantId } : {}),
    });
  }

  return {
    ok: true,
    result: withClaims,
    claims,
    derivation,
    engine,
    fallback_reason: fallbackReason,
    safety_rule_id: safety?.safety_rule_id ?? null,
    intent_cluster: intentCluster,
    run_id: runId,
    cost_usd: costUsd,
    refusal: null,
  };
}

export interface SelectClarifierOptions extends ClarifierOptions {
  allow_model?: boolean;
  /** Correlation id for the emitted event. */
  request_id?: string | null;
  tenant_id?: string;
}

export interface SelectClarifierOutcome extends ClarifierSelection {
  ok: boolean;
  engine: "deterministic" | "model";
  fallback_reason: string | null;
  run_id: string | null;
  cost_usd: number | null;
  refusal: string | null;
}

/**
 * WHICH QUESTION TO ASK NEXT — the production path, and the one that emits.
 *
 * THE CAP IS CHECKED BEFORE THE GATEWAY, not just before the model. At the
 * ceiling there is nothing to select, so nothing runs: no capability call, no
 * ledger row, no event. "No question was asked" and "a question was asked and
 * then suppressed" are different facts and the instruments should say which.
 */
export async function selectClarifier(
  input: ClarifierInput,
  options: SelectClarifierOptions = {}
): Promise<SelectClarifierOutcome> {
  const shell = {
    asked_count: input.asked_count,
    max_questions: input.max_questions,
    run_id: null,
    cost_usd: null,
  };

  if (capReached(input.asked_count, input.max_questions)) {
    return {
      ...shell,
      ok: true,
      ask: null,
      reason: `the clarifying-question ceiling is reached (${input.asked_count}/${input.max_questions}) — every further question is unpaid work asked of someone who has already answered enough`,
      engine: "deterministic",
      fallback_reason: "the ceiling is reached — nothing was consulted about asking anyway",
      refusal: null,
    };
  }

  const gated = await capability_call<ClarifierSelection>({
    agent_id: "A01",
    capability: "select_clarifying_questions",
    args: input,
    input_ids: [input.playbook.playbook_id],
    trigger: "request",
  });
  if (!gated.ok) {
    return {
      ...shell,
      ok: false,
      ask: null,
      reason: `the governed capability call was refused (${gated.reason}) — no question was selected`,
      engine: "deterministic",
      fallback_reason: gated.reason,
      run_id: gated.run_id ?? null,
      refusal: `${gated.kind}: ${gated.reason}`,
    };
  }

  let selection: ClarifierSelection = gated.output;
  let engine: "deterministic" | "model" = "deterministic";
  let fallbackReason: string | null = "the model-backed alternate was not consulted";
  let runId: string | null = gated.run_id ?? null;
  let costUsd: number | null = null;

  if (options.allow_model !== false) {
    const refined = await selectNextClarifier(input, { deps: options.deps });
    selection = {
      ask: refined.ask,
      reason: refined.reason,
      asked_count: refined.asked_count,
      max_questions: refined.max_questions,
    };
    engine = refined.engine;
    fallbackReason = refined.fallback_reason;
    runId = refined.run_id ?? runId;
    costUsd = refined.cost_usd;
  }

  /**
   * THE INSTRUMENT. `intake.clarifier_asked` fires when a question is actually
   * selected to be asked — never on a refusal, never at the cap. The field key
   * travels; the question text does not need to, because the playbook is the
   * record of what that key's words are. The `value_reason` tag travels too —
   * the canon licence under which this question was asked (one of the six, A01
   * spec §4), so the event stream can answer "why was this asked" without
   * reopening the playbook.
   */
  if (selection.ask) {
    await emitPlatformEvent({
      event_name: "intake.clarifier_asked",
      agent_id: "A01",
      agent_run_id: runId,
      context: {
        playbook_id: input.playbook.playbook_id,
        field_key: selection.ask.field_key,
        value_reason: selection.ask.value_reason,
        priority: selection.ask.priority,
        asked_count: String(selection.asked_count),
        max_questions: String(selection.max_questions),
        ...(options.request_id ? { request_id: options.request_id } : {}),
      },
      versions: { engine, prompt: engine === "model" ? CLARIFIER_PROMPT.prompt_version : "n/a" },
      privacy_class: "internal",
      cost_usd: 0,
      ...(options.tenant_id ? { tenant_id: options.tenant_id } : {}),
    });
  }

  return {
    ...selection,
    ok: true,
    engine,
    fallback_reason: fallbackReason,
    run_id: runId,
    cost_usd: costUsd,
    refusal: null,
  };
}

export interface ReclassifyOutcome {
  changed: boolean;
  /** What actually differs, for the event's context and for a human reading it. */
  changed_fields: string[];
  before: Pick<ProblemRecord, "service_category" | "service_category_confidence">;
  after: Pick<ProblemRecord, "service_category" | "service_category_confidence">;
}

/**
 * RE-CLASSIFICATION — comparison only, and deliberately so.
 *
 * It reports what a fresh classification WOULD say against what the record
 * currently says. It does not write, because overwriting a stored classification
 * mid-journey changes what a homeowner already saw on their results page, and
 * that is a product decision rather than an engineering one.
 *
 * TODO-ASK-OWNER (Melissa): when new evidence contradicts the stored
 * classification, does the homeowner's packet silently change under them, change
 * with a note, or stay put until someone looks? Until that is answered this
 * function informs and emits; it does not overwrite.
 */
export function compareClassification(
  existing: ProblemRecord,
  fresh: ProblemRecord
): ReclassifyOutcome {
  const changed_fields: string[] = [];
  if (existing.service_category !== fresh.service_category) changed_fields.push("service_category");
  if (existing.service_category_confidence !== fresh.service_category_confidence) {
    changed_fields.push("service_category_confidence");
  }
  return {
    changed: changed_fields.length > 0,
    changed_fields,
    before: {
      service_category: existing.service_category,
      service_category_confidence: existing.service_category_confidence,
    },
    after: {
      service_category: fresh.service_category,
      service_category_confidence: fresh.service_category_confidence,
    },
  };
}

// ---------------------------------------------------------------------------
// THE INSTRUMENTS A01 OWNS
// ---------------------------------------------------------------------------

/**
 * WHY THESE GO IN NOW, BEFORE ANYTHING READS THEM.
 *
 * Events are append-only history and CANNOT BE BACKFILLED (Trial Spec Audit §4).
 * A01's clarifier and re-classification instruments had zero producers in the
 * whole repo: grepping outside the dictionary files, `intake.clarifier_asked`
 * returned 0 and `problem.updated` returned 0. A question answered during the
 * proving run that nothing recorded is gone, and A07's first KpiSnapshot would
 * then have no baseline to compare against — it would correctly report
 * `material_change: unknown` and teach its owner nothing.
 *
 * Every name below is already registered and seeded. Nothing here mints one.
 * All emission is fail-soft by `emitPlatformEvent`'s own contract: telemetry
 * never breaks a homeowner's journey.
 */

export interface ClarifierAnsweredInput {
  problem_id: string;
  request_id: string;
  playbook_id: string;
  /** The playbook field the answer satisfies — the question's identity. */
  field_key: string;
  /** How it was answered. A photo of a rating plate IS an answer. */
  source: "typed" | "photo" | "auto_detected";
  guest_session_id?: string | null;
  tenant_id?: string;
}

/**
 * `intake.clarifier_answered` — one per field the homeowner actually answered.
 *
 * THE FIELD KEY TRAVELS; THE ANSWER DOES NOT. The value is the homeowner's own
 * words about their own home, and it lives in the IntakeAnswer row where it
 * belongs. What an instrument needs is which question got answered and how,
 * because the measure this feeds is intake friction — how much unpaid work the
 * product asked for, and how much of it people did.
 */
export async function emitClarifierAnswered(input: ClarifierAnsweredInput): Promise<void> {
  await emitPlatformEvent({
    event_name: "intake.clarifier_answered",
    agent_id: "A01",
    context: {
      problem_id: input.problem_id,
      request_id: input.request_id,
      playbook_id: input.playbook_id,
      field_key: input.field_key,
      source: input.source,
    },
    privacy_class: "internal",
    cost_usd: 0,
    ...(input.tenant_id ? { tenant_id: input.tenant_id } : {}),
  });
}

export interface ReclassifyOnNewEvidenceInput {
  existing: ProblemRecord;
  /** The customer text the classification is derived from. */
  description: string;
  intake_session_id: string | null;
  problem_family_hint: string | null;
  now: string;
  /** What prompted the re-check, for the event's context. */
  trigger: string;
  tenant_id?: string;
}

/**
 * RE-CLASSIFY ON NEW EVIDENCE, and emit `problem.updated` ONLY IF IT MOVED.
 *
 * ─── WHAT THIS DOES AND DOES NOT FIRE ON ───────────────────────────────────
 *
 * It emits when a fresh deterministic classification disagrees with the stored
 * one. It does not emit when new evidence arrives and the classification stands,
 * because "a photo was attached" is already `intake.evidence_added` and an event
 * that fires on every upload would make `problem.updated` a synonym for it. Two
 * names for one fact is exactly the metric drift A08 and A09 exist to catch.
 *
 * ─── AND IT WILL BE QUIET FOR NOW. THAT IS THE HONEST STATE. ───────────────
 *
 * Today the only classification input is the customer's original text, so a
 * re-check over the same text agrees with itself and nothing is emitted. The
 * instrument is here anyway because it is the SEAM: the day A01 reads a photo,
 * or a clarifier answer becomes classification input, this fires with no wiring
 * change and A07 has history from that day rather than from whenever someone
 * remembered. A silent instrument that is correct beats a chatty one that is
 * not, and the alternative — emitting `problem.updated` on every upload to make
 * the graph look alive — would put a wrong number in front of an owner.
 */
export async function reclassifyOnNewEvidence(
  input: ReclassifyOnNewEvidenceInput
): Promise<ReclassifyOutcome> {
  /**
   * THROUGH THE GOVERNED DOOR TOO, 2026-08-25 (finding 1). This called
   * `analyzeProblemFixture` directly, which meant a re-classification — a
   * second, unlogged classification of the same homeowner's words — ran with no
   * registry lookup, no kill-switch check, no ledger row and no
   * `capability.invoked` envelope. A kill switch on A01 stopped the first
   * classification and not this one.
   *
   * A REFUSAL REPORTS NO CHANGE, and that is the only safe answer: the
   * comparison could not be made, so claiming the classification moved would
   * emit `problem.updated` on the strength of a run that never happened.
   */
  const gated = await capability_call<AnalyzeResult>({
    agent_id: "A01",
    capability: "classify_home_problem",
    args: {
      description: input.description,
      intake_session_id: input.intake_session_id,
      problem_family_hint: input.problem_family_hint,
      now: input.now,
    },
    input_ids: [input.existing.problem_id],
    trigger: "request",
  });
  if (!gated.ok) {
    return {
      changed: false,
      changed_fields: [],
      before: {
        service_category: input.existing.service_category,
        service_category_confidence: input.existing.service_category_confidence,
      },
      after: {
        service_category: input.existing.service_category,
        service_category_confidence: input.existing.service_category_confidence,
      },
    };
  }
  const fresh = gated.output.problem;
  const outcome = compareClassification(input.existing, fresh);
  if (!outcome.changed) return outcome;

  await emitPlatformEvent({
    event_name: "problem.updated",
    agent_id: "A01",
    context: {
      problem_id: input.existing.problem_id,
      change: "reclassified",
      trigger: input.trigger,
      changed_fields: outcome.changed_fields.join(","),
      // Classifications, not customer content: a trade name is our label.
      from: outcome.before.service_category ?? "none",
      to: outcome.after.service_category ?? "none",
    },
    privacy_class: "internal",
    cost_usd: 0,
    ...(input.tenant_id ? { tenant_id: input.tenant_id } : {}),
  });
  return outcome;
}
