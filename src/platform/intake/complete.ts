import { randomUUID } from "node:crypto";
import type { EvidenceObject } from "@/domain/problem/contracts";
import { buildPacket } from "@/domain/problem/packet";
import { findPlaybook, selectPlaybook } from "@/domain/intake/playbooks";
import type { IntakePlaybook } from "@/domain/intake/playbook";
import { journeySafetyRule } from "@/domain/problem/journey-safety";
import { runtimeStore, type JobAddress, type Journey } from "@/platform/stores/runtime";
import { intakeReadiness } from "@/platform/intake/readiness";
import { buildIntakeHandoff } from "@/platform/intake/handoff";
import type { LabelConfidenceRecord } from "@/platform/intake/media";

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
  /** The job address, when the homeowner has given it (Directions §3.3). */
  address: JobAddress | null;
  /**
   * Latest label-read confidence word per field key ("high" | "medium" |
   * "low"), from the file store's sidecar (platform/intake/media.ts). Empty
   * when nothing was read or the environment records none.
   */
  labelConfidence: Record<string, "high" | "medium" | "low">;
  labelReadings: LabelConfidenceRecord[];
} | null> {
  const store = runtimeStore();
  const journey = await store.getJourney(requestId);
  if (!journey) return null;
  const allEvidence = await store.listEvidence(journey.problem.problem_id, requestId);
  // Campaign track P4: the address and the label-read confidences ride along
  // so the walkthrough page can confirm-not-assert (Coverage Standard §4.3)
  // and ask for the address once. Both are best-effort reads: a store that
  // cannot answer leaves them empty rather than failing the journey.
  let address: JobAddress | null = null;
  try {
    address = await store.getJobAddress(requestId);
  } catch {
    address = null;
  }
  const labelConfidence: Record<string, "high" | "medium" | "low"> = {};
  const labelReadings: LabelConfidenceRecord[] = [];
  try {
    // Dynamic: media.ts imports this module, and the sidecar reader is the
    // only thing needed from it here.
    const { readLabelReadings } = await import("@/platform/intake/media");
    for (const record of readLabelReadings(requestId) ?? []) {
      if (!allEvidence.some(evidence => evidence.kind === "photo" && evidence.evidence_id === record.evidence_id)) continue;
      labelReadings.push(record);
      for (const [key, word] of Object.entries(record.confidence)) labelConfidence[key] = word;
    }
  } catch {
    /* no sidecar, no confidence words — the page confirms anyway */
  }
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
  return { journey, playbook, textEvidence, allEvidence, address, labelConfidence, labelReadings };
}

/**
 * Rebuild the packet from everything known and store it as the next version.
 *
 * CALL SITE 2 OF 3 (Trial Spec Audit HO-4), routed through A02, 2026-08-25.
 *
 * This is the site the A02 spec never mentions and the one that mattered most:
 * it called `assemblePacket` directly, which meant the RICHEST packet path in
 * the product — the one that folds in the customer's answers, their photos and
 * the guided-diagnosis trail — ran with no registry lookup, no kill-switch
 * check, no ledger row and no event. Regeneration was invisible. It is now
 * `buildPacket`, so it is governed like every other capability call and emits
 * `packet.regenerated`.
 *
 * Governance refusals leave the previous version standing. Persistence or
 * handoff validation failures propagate to the caller for an honest retry;
 * they never replace the previous saved packet with an invalid generation.
 */
export async function regeneratePacket(requestId: string): Promise<void> {
  const ctx = await loadJourneyContext(requestId);
  if (!ctx) return;
  const safety = journeySafetyRule(ctx.journey.problem);
  if (safety && !safety.intake_may_continue) return;
  const store = runtimeStore();
  const [answers, diagnosis, claims] = await Promise.all([
    store.listIntakeAnswers(requestId),
    store.listDiagnosisAnswers(requestId),
    /**
     * A01's claims travel into every version, not just the first (finding 1).
     * Without this, version 1 carried a `claim_basis` and every regeneration
     * dropped it — so the CURRENT packet, which is the one every reader gets,
     * was the one that could not say what it rested on.
     *
     * Nothing recomputes them: they are the claims A01 established for this
     * problem, read back as they were written.
     */
    store.listClaims(ctx.journey.problem.problem_id),
  ]);
  const outcome = await buildPacket({
    problem: ctx.journey.problem,
    textEvidence: ctx.textEvidence,
    allEvidence: ctx.allEvidence,
    playbook: ctx.playbook,
    answers,
    diagnosis,
    // Absent still means "not recorded" — an empty array would claim the packet
    // rests on no facts, which is a different statement.
    ...(claims.length > 0 ? { claims } : {}),
    version: ctx.journey.packet.packet_version + 1,
    previous: ctx.journey.packet,
    now: nowIso(),
    request_id: requestId,
    trigger: "request",
    // New version, new id: the ledger keeps every packet the customer ever saw.
    new_id: () => `jp_${randomUUID()}`,
  });
  if (!outcome.ok || !outcome.packet) return;
  const snapshot = await intakeReadiness(ctx);
  const packet = { ...outcome.packet, intake_snapshot: {
    packet_id: outcome.packet.job_packet_id, packet_version: outcome.packet.packet_version,
    policy_version: snapshot.registry.version, effort_spent: snapshot.ledger.effort_spent,
    handoff: buildIntakeHandoff(ctx, snapshot, outcome.packet), readiness: snapshot.readiness,
  } };
  await store.savePacket(packet, requestId);
  /**
   * THE CHAIN IS MAINTAINED (finding 3, 2026-08-25).
   *
   * Regeneration used to leave every version at `status: "current"` with
   * `superseded_by: null` — six versions of one packet all claiming to be the
   * current one, with only `packet_version` distinguishing them. The fields
   * existed and nothing maintained them, which is worse than not having them:
   * a reader that trusts `status` gets six answers to a single-answer question.
   *
   * NEW FIRST, THEN THE POINTER. The successor is written before the
   * predecessor is told about it, so there is no instant where a stored packet
   * points at one that does not exist. If this second call fails, the previous
   * version stays `current` — a duplicate-current, which the next regeneration
   * corrects — rather than a dangling pointer, which nothing corrects.
   *
   * The read path is untouched: newest-version-wins still decides what a
   * homeowner sees, exactly as before.
   */
  await store.supersedePacket(ctx.journey.packet.job_packet_id, outcome.packet.job_packet_id);
}
