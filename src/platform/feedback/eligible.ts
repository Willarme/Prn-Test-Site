import { resolveWalkthroughPosition, type DiagnosisAnswer, type IntakePlaybook } from "@/domain/intake/playbook";
import { CANNOT_REACH_STEP_ANSWER } from "@/domain/intake/extract";
import { journeySafetyRule } from "@/domain/problem/journey-safety";
import { loadJourneyContext } from "@/platform/intake/complete";
import { runtimeStore } from "@/platform/stores/runtime";

/** Conservative interim feedback sampling rule, NOT merged packet readiness.
 * Require a reached diagnostic outcome and a substantive saved observation.
 * Merely having generated copy, collected_details, or skipped answers is thin.
 */
export function completedFeedbackWalkthrough(playbook: IntakePlaybook, answers: readonly DiagnosisAnswer[]): boolean {
  const outcome = resolveWalkthroughPosition(playbook, answers).outcomeId;
  if (!outcome || !playbook.outcomes.some((item) => item.outcome_id === outcome)) return false;
  return answers.some((item) => playbook.diagnostic_steps.some((step) => step.step_id === item.step_id)
    && !!item.answer?.trim()
    && item.answer.trim() !== CANNOT_REACH_STEP_ANSWER
    && !/^(skip(?:ped)?|cannot[- ]reach|can'?t[- ]reach|not sure|unknown|i don'?t know)$/i.test(item.answer.trim()));
}

export async function feedbackEligible(requestId: string): Promise<boolean> {
  try {
    const ctx = await loadJourneyContext(requestId);
    if (!ctx || journeySafetyRule(ctx.journey.problem)) return false;
    return completedFeedbackWalkthrough(ctx.playbook, await runtimeStore().listDiagnosisAnswers(requestId));
  } catch { return false; }
}
