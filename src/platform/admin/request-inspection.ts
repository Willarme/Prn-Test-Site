import type { AdminRequestRow } from "@/domain/admin/request-view";
import { CANNOT_REACH_FIELD_VALUE, CANNOT_REACH_STEP_ANSWER } from "@/domain/intake/extract";
import { fieldConflictText, heldFieldConflicts } from "@/domain/intake/field-conflicts";
import { findPlaybook, selectPlaybook } from "@/domain/intake/playbooks";
import { projectJourneySafety } from "@/domain/problem/journey-safety";
import type { RuntimeStore } from "@/platform/stores/runtime";

/** Caller must pass adminGate before invoking this private read model. */
export async function readAdminRequestRows(store: RuntimeStore): Promise<AdminRequestRow[]> {
  const journeys = (await store.listJourneys(100)).slice(0, 100);
  const rows: AdminRequestRow[] = new Array(journeys.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, journeys.length) }, async () => {
    while (next < journeys.length) {
      const index = next++;
      const journey = journeys[index];
      let safety: AdminRequestRow["safety"] = "unverified";
      try {
        const evidence = await store.listEvidence(journey.problem.problem_id, journey.session.request_id);
        safety = projectJourneySafety(journey, evidence).problem.safety_state;
      } catch { /* A missing safety read cannot become a reassuring normal badge. */ }
      rows[index] = {
        requestId: journey.session.request_id, enteredAt: journey.session.entered_at,
        source: journey.session.attribution.landing_path,
        category: journey.problem.service_category ?? "Unclassified",
        confidence: journey.problem.service_category_confidence, status: journey.problem.status, safety,
        packetVersion: journey.packet.packet_version,
        consentReferences: journey.session.consent_event_ids.length,
        synthetic: journey.session.attribution.variant === "synthetic_demo",
      };
    }
  }));
  return rows;
}

export function inspectedAnswer(value: string | null): string {
  if (value === CANNOT_REACH_FIELD_VALUE || value === CANNOT_REACH_STEP_ANSWER) return "Not checked — could not reach";
  if (value === "skip" || value === "skipped") return "Not checked — skipped";
  if (value === null || value.trim() === "") return "No answer recorded";
  return value;
}

/** Reads only; never builds a new packet, mints a link or alters owner access. */
export async function readAdminRequestDetail(store: RuntimeStore, requestId: string) {
  const stored = await store.getJourney(requestId);
  if (!stored) return null;
  const evidence = await store.listEvidence(stored.problem.problem_id, requestId);
  const journey = projectJourneySafety(stored, evidence);
  const playbook = (journey.session.playbook_id ? findPlaybook(journey.session.playbook_id) : null) ??
    selectPlaybook(journey.problem.problem_summary ?? "", journey.problem.service_category);
  const [answers, diagnosis, claims, derivations] = await Promise.allSettled([
    store.listIntakeAnswers(requestId), store.listDiagnosisAnswers(requestId),
    store.listClaims(journey.problem.problem_id), store.listDerivations(journey.problem.problem_id),
  ]);
  const unavailable = [
    answers.status === "rejected" ? "Intake answers" : null,
    diagnosis.status === "rejected" ? "Walkthrough answers" : null,
    claims.status === "rejected" ? "Fact claims" : null,
    derivations.status === "rejected" ? "Derivations" : null,
  ].filter((value): value is string => value !== null);
  return {
    journey, playbookLabel: playbook.cluster_label,
    conflicts: answers.status === "fulfilled"
      ? heldFieldConflicts(answers.value, evidence, playbook.required_fields).map(fieldConflictText) : [],
    answers: answers.status === "fulfilled" ? answers.value.map(answer => ({
      ...answer, value_text: inspectedAnswer(answer.value_text),
      label: playbook.required_fields.find(field => field.field_key === answer.field_key)?.label ?? answer.field_key,
    })) : [],
    diagnosis: diagnosis.status === "fulfilled" ? diagnosis.value.map(answer => ({
      ...answer, answer: inspectedAnswer(answer.answer),
      label: playbook.diagnostic_steps.find(step => step.step_id === answer.step_id)?.title ?? answer.step_id,
    })) : [],
    claims: claims.status === "fulfilled" ? claims.value : [],
    derivations: derivations.status === "fulfilled" ? derivations.value : [],
    // A storage reference is neither a display URL nor a grant to view media.
    evidence: evidence.map(item => ({
      evidence_id: item.evidence_id, kind: item.kind, captured_at: item.captured_at,
      field_key: item.field_key ?? null, mime: item.mime ?? null, bytes: item.bytes ?? null,
      text: item.kind === "customer_text" || item.kind === "voice_transcript" ? item.content : null,
    })),
    unavailable,
  };
}
