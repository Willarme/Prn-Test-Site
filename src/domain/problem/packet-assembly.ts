import type { EvidenceObject, JobPacket, ProblemRecord } from "@/domain/problem/contracts";
import { JobPacket as JobPacketSchema } from "@/domain/problem/contracts";
import { buildJobPacketFixture } from "@/domain/problem/fixture-engine";
import {
  ACTIVE_PACKET_COPY,
  fillCopy,
  type PacketCopyPackage,
} from "@/domain/problem/packet-copy";
import type { DiagnosisAnswer, IntakeAnswer, IntakePlaybook } from "@/domain/intake/playbook";
import { nextFor } from "@/domain/intake/playbook";
import { fieldConflictText, heldFieldConflicts } from "@/domain/intake/field-conflicts";

/**
 * Assemble a packet VERSION from everything the customer has supplied so far:
 * the base narrative (fixture/production engine), the required-field answers,
 * attached media, and the guided-diagnosis trail. Deterministic; no AI.
 */
export interface AssembleInput {
  problem: ProblemRecord;
  textEvidence: EvidenceObject;
  allEvidence: EvidenceObject[];
  playbook: IntakePlaybook | null;
  answers: IntakeAnswer[];
  diagnosis: DiagnosisAnswer[];
  version: number;
  now: string;
  /**
   * PACKET COPY FROM CONFIG (condition 8). Optional and defaulted, so every
   * existing call site produces identical words; a white-label deployment
   * passes its own package.
   */
  copy?: PacketCopyPackage;
}

export function resolveDiagnosis(
  playbook: IntakePlaybook,
  diagnosis: DiagnosisAnswer[],
  copy: PacketCopyPackage = ACTIVE_PACKET_COPY
): JobPacket["diagnosis"] {
  if (!playbook.first_step_id || diagnosis.length === 0) return null;
  const byStep = new Map(diagnosis.map((d) => [d.step_id, d]));
  const stepsAnswered: Array<{ step: string; answer: string }> = [];
  let current = playbook.first_step_id;
  let outcomeId: string | null = null;
  const visited = new Set<string>();
  while (current && !visited.has(current)) {
    visited.add(current);
    const step = playbook.diagnostic_steps.find((s) => s.step_id === current);
    const ans = byStep.get(current);
    if (!step || !ans) break;
    stepsAnswered.push({
      step: step.title,
      answer:
        ans.answer ??
        (ans.evidence_id ? copy.content.answer_photo_attached : copy.content.answer_none),
    });
    const branch = nextFor(step, ans.answer ?? "any");
    if (!branch) break;
    if (branch.outcome_id) {
      outcomeId = branch.outcome_id;
      break;
    }
    current = branch.next_step_id ?? "";
  }
  if (!outcomeId) {
    return stepsAnswered.length > 0
      ? {
          outcome_title: copy.content.diagnosis_in_progress_title,
          likely_cause: copy.content.diagnosis_in_progress_cause,
          steps_answered: stepsAnswered,
          provider_note: copy.content.diagnosis_in_progress_provider_note,
        }
      : null;
  }
  const outcome = playbook.outcomes.find((o) => o.outcome_id === outcomeId);
  if (!outcome) return null;
  return {
    outcome_title: outcome.title,
    likely_cause: outcome.likely_cause,
    steps_answered: stepsAnswered,
    provider_note: outcome.provider_note,
  };
}

/**
 * THE ONE ARGUMENT SHAPE THE GOVERNED `generate_job_packet` CAPABILITY TAKES.
 *
 * Trial Spec Audit HO-4 names three live call sites and the A02 spec names
 * none of them. Two of the three want different amounts of input: the intake
 * route has a description and nothing else yet, while the "complete your
 * packet" path has answers, attached media and a diagnosis trail. Registering
 * two capabilities for that would put half of A02's work outside the governed
 * door; making the richer one the only shape would force the intake route to
 * fabricate empty answer arrays.
 *
 * So it is ONE capability with a discriminated argument. `assemble: true`
 * selects the full path through assemblePacket; anything else is the base
 * narrative, byte-identical to what buildJobPacketFixture always produced.
 */
export interface GenerateJobPacketBaseArgs {
  problem: ProblemRecord;
  evidence: EvidenceObject;
  now: string;
  copy?: PacketCopyPackage;
}
export type GenerateJobPacketArgs =
  | GenerateJobPacketBaseArgs
  | (AssembleInput & { assemble: true });

export function generateJobPacket(args: GenerateJobPacketArgs): JobPacket {
  if ("assemble" in args && args.assemble) return assemblePacket(args);
  const base = args as GenerateJobPacketBaseArgs;
  return buildJobPacketFixture(
    base.problem,
    base.evidence,
    base.now,
    undefined,
    base.copy ?? ACTIVE_PACKET_COPY
  );
}

export function assemblePacket(input: AssembleInput): JobPacket {
  const copy = input.copy ?? ACTIVE_PACKET_COPY;
  const base = buildJobPacketFixture(
    input.problem,
    input.textEvidence,
    input.now,
    undefined,
    copy
  );
  const labelFor = (key: string) =>
    input.playbook?.required_fields.find((f) => f.field_key === key)?.label ?? key;

  // Latest answer per field wins; photos count as "attached".
  const latest = new Map<string, IntakeAnswer>();
  for (const a of input.answers) latest.set(a.field_key, a);
  const conflicts = heldFieldConflicts(input.answers, input.allEvidence, input.playbook?.required_fields ?? []);
  const collected = [...latest.values()].map((a) => ({
    label: labelFor(a.field_key),
    value: conflicts.some(c => c.field_key === a.field_key)
      ? fieldConflictText(conflicts.find(c => c.field_key === a.field_key)!)
      : a.value_text ??
      (a.evidence_id ? copy.content.answer_photo_attached : copy.content.answer_provided),
    source: conflicts.some(c => c.field_key === a.field_key) ? "customer_text" : a.source,
  }));

  const media = input.allEvidence.filter((e) => e.kind === "photo" || e.kind === "video").length;
  const diagnosis = input.playbook
    ? resolveDiagnosis(input.playbook, input.diagnosis, copy)
    : null;

  // Things we now know stop being "unknown"; provider questions already
  // answered drop off the ask list.
  // Key on field_key (stable), not the human label.
  const knownKeys = new Set([...latest.keys()]);
  const walkthroughIncomplete =
    diagnosis?.outcome_title === copy.content.diagnosis_in_progress_title;
  const unknowns = base.what_remains_unknown.filter(
    (u) => !(diagnosis && u === copy.content.unknown_exact_cause && !walkthroughIncomplete)
  );
  unknowns.push(...conflicts.map(fieldConflictText));
  const questions = base.questions_for_provider.filter((q) => {
    const ql = q.toLowerCase();
    if ((knownKeys.has("unit_model_serial") || knownKeys.has("brand") || knownKeys.has("system_age")) && /(brand|how old|age of)/.test(ql)) return false;
    if (knownKeys.has("symptom_timing") && /when did this start/.test(ql)) return false;
    if (knownKeys.has("thermostat_photo") && /thermostat/.test(ql)) return false;
    if (knownKeys.has("affected_scope") && /how many outlets/.test(ql)) return false;
    if (knownKeys.has("shutoff_known") && /shutoff/.test(ql)) return false;
    return true;
  });

  return JobPacketSchema.parse({
    ...base,
    packet_version: input.version,
    what_remains_unknown: unknowns,
    questions_for_provider: questions,
    collected_details: collected,
    media_count: media,
    diagnosis,
    call_script:
      diagnosis && !walkthroughIncomplete
        ? `${base.call_script}${fillCopy(copy.content.call_script_diagnosis_suffix, {
            likely_cause: diagnosis.likely_cause,
          })}`
        : base.call_script,
    generated_at: input.now,
  });
}
