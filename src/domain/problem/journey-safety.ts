import type { EvidenceObject, JobPacket, ProblemRecord } from "@/domain/problem/contracts";
import { checkSafety, SAFETY_RULES, type SafetyRule } from "@/domain/problem/safety";

/** Safety remains the existing jurisdiction package's decision. Later text is
 * appended as private evidence, so a reload cannot erase a newly reported hazard.
 * An unavailable evidence read must throw at the store boundary, never look safe. */
export function journeySafetyRule(problem: Pick<ProblemRecord, "safety_rule_id">): SafetyRule | null {
  if (!problem.safety_rule_id) return null;
  const rule = SAFETY_RULES.find(rule => rule.safety_rule_id === problem.safety_rule_id);
  if (!rule) throw new Error("Recorded safety rule is unavailable; safety cannot be established.");
  return rule;
}

export function projectJourneySafety<T extends { problem: ProblemRecord; packet: JobPacket }>(
  journey: T,
  evidence: readonly EvidenceObject[]
): T {
  if (journey.problem.evidence_ids.some(id => !evidence.some(e => e.evidence_id === id))) {
    throw new Error("Journey evidence is unavailable; safety cannot be established.");
  }
  const observed = evidence.filter(e => e.kind === "customer_text").map(e => checkSafety(e.content)).filter((r): r is SafetyRule => r !== null);
  const recorded = journeySafetyRule(journey.problem);
  if (recorded) observed.unshift(recorded);
  const rule = observed.find(r => !r.intake_may_continue) ?? observed[0];
  if (!rule) return journey;
  const halted = !rule.intake_may_continue;
  return {
    ...journey,
    problem: { ...journey.problem, safety_state: halted ? "urgent" : "review", safety_rule_id: rule.safety_rule_id },
    // A previously saved normal packet may predate the hazard. Keep its history
    // on disk, but never expose its stale DIY steps or diagnosis to a reader.
    packet: halted ? {
      ...journey.packet,
      summary_plain: rule.approved_response,
      safe_prep_notes: [rule.approved_response],
      questions_for_provider: [],
      call_script: rule.approved_response,
      diagnosis: null,
      safety_notes: [rule.approved_response],
    } : { ...journey.packet, safety_notes: [rule.approved_response] },
  };
}
