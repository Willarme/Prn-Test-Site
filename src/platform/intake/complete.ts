import { randomUUID } from "node:crypto";
import type { EvidenceObject } from "@/domain/problem/contracts";
import { buildPacket } from "@/domain/problem/packet";
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
 * STILL RETURNS void, AND STILL NEVER THROWS. Its three callers (the answer
 * route, the media route, and the page) treat regeneration as a
 * best-effort refresh after the customer's own write has already succeeded — a
 * governance refusal must not turn a saved photo into an error, so a refusal
 * leaves the previous packet version standing, exactly as a missing journey
 * always has.
 */
export async function regeneratePacket(requestId: string): Promise<void> {
  const ctx = await loadJourneyContext(requestId);
  if (!ctx) return;
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
  await store.savePacket(outcome.packet);
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
