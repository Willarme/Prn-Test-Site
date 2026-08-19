import type { EvidenceObject, JobPacket, ProblemRecord } from "@/domain/problem/contracts";
import { JobPacket as JobPacketSchema } from "@/domain/problem/contracts";
import { buildJobPacketFixture } from "@/domain/problem/fixture-engine";
import type { DiagnosisAnswer, IntakeAnswer, IntakePlaybook } from "@/domain/intake/playbook";
import { nextFor } from "@/domain/intake/playbook";

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
}

export function resolveDiagnosis(
  playbook: IntakePlaybook,
  diagnosis: DiagnosisAnswer[]
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
    stepsAnswered.push({ step: step.title, answer: ans.answer ?? (ans.evidence_id ? "photo attached" : "—") });
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
          outcome_title: "Walkthrough in progress",
          likely_cause: "The customer started the guided walkthrough; see steps answered so far.",
          steps_answered: stepsAnswered,
          provider_note: "Guided diagnosis partially completed; findings listed.",
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

export function assemblePacket(input: AssembleInput): JobPacket {
  const base = buildJobPacketFixture(input.problem, input.textEvidence, input.now);
  const labelFor = (key: string) =>
    input.playbook?.required_fields.find((f) => f.field_key === key)?.label ?? key;

  // Latest answer per field wins; photos count as "attached".
  const latest = new Map<string, IntakeAnswer>();
  for (const a of input.answers) latest.set(a.field_key, a);
  const collected = [...latest.values()].map((a) => ({
    label: labelFor(a.field_key),
    value: a.value_text ?? (a.evidence_id ? "photo attached" : "provided"),
    source: a.source,
  }));

  const media = input.allEvidence.filter((e) => e.kind === "photo" || e.kind === "video").length;
  const diagnosis = input.playbook ? resolveDiagnosis(input.playbook, input.diagnosis) : null;

  // Things we now know stop being "unknown"; provider questions already
  // answered drop off the ask list.
  // Key on field_key (stable), not the human label.
  const knownKeys = new Set([...latest.keys()]);
  const unknowns = base.what_remains_unknown.filter(
    (u) => !(diagnosis && /exact cause/i.test(u) && diagnosis.outcome_title !== "Walkthrough in progress")
  );
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
      diagnosis && diagnosis.outcome_title !== "Walkthrough in progress"
        ? `${base.call_script} I also walked through a few checks — it looks like: ${diagnosis.likely_cause}`
        : base.call_script,
    generated_at: input.now,
  });
}
