import { randomUUID } from "node:crypto";
import type { EvidenceObject } from "@/domain/problem/contracts";
import { assemblePacket } from "@/domain/problem/packet-assembly";
import { findPlaybook, selectPlaybook } from "@/domain/intake/playbooks";
import type { IntakePlaybook } from "@/domain/intake/playbook";
import { runtimeStore, type Journey } from "@/platform/stores/runtime";

/**
 * Shared server helpers for the post-description intake ("complete your
 * packet"). Every API route and page goes through here, so the packet is
 * always regenerated the same way — one capability, many callers (#22A).
 */
export function nowIso(): string {
  return new Date().toISOString().replace(/\.\d+Z$/, "Z");
}

export async function loadJourneyContext(requestId: string): Promise<{
  journey: Journey;
  playbook: IntakePlaybook;
  textEvidence: EvidenceObject;
  allEvidence: EvidenceObject[];
} | null> {
  const store = runtimeStore();
  const journey = await store.getJourney(requestId);
  if (!journey) return null;
  const allEvidence = await store.listEvidence(journey.problem.problem_id);
  const textEvidence =
    allEvidence.find((e) => e.kind === "customer_text") ??
    ({
      evidence_id: "ev_missing",
      kind: "customer_text",
      content: journey.problem.problem_summary ?? "",
      privacy: "private",
      captured_at: journey.problem.created_at,
    } as EvidenceObject);
  const playbook =
    (journey.session.playbook_id ? findPlaybook(journey.session.playbook_id) : null) ??
    selectPlaybook(textEvidence.content, journey.problem.service_category);
  return { journey, playbook, textEvidence, allEvidence };
}

/** Rebuild the packet from everything known and store it as the next version. */
export async function regeneratePacket(requestId: string): Promise<void> {
  const ctx = await loadJourneyContext(requestId);
  if (!ctx) return;
  const store = runtimeStore();
  const [answers, diagnosis] = await Promise.all([
    store.listIntakeAnswers(requestId),
    store.listDiagnosisAnswers(requestId),
  ]);
  const packet = assemblePacket({
    problem: ctx.journey.problem,
    textEvidence: ctx.textEvidence,
    allEvidence: ctx.allEvidence,
    playbook: ctx.playbook,
    answers,
    diagnosis,
    version: ctx.journey.packet.packet_version + 1,
    now: nowIso(),
  });
  // New version, new id: the ledger keeps every packet the customer ever saw.
  await store.savePacket({ ...packet, job_packet_id: `jp_${randomUUID()}` });
}
