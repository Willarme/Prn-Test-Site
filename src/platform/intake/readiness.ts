import { createHash } from "node:crypto";
import { buildCurrentFactState, buildIntakeRegistry, computeProviderReadiness, finalizeFactState,
  isFactPopulated, selectQuestionScreen, type CurrentFact, type QuestionDefinition } from "@/domain/intake/readiness";
import { resolveWalkthroughPosition } from "@/domain/intake/playbook";
import type { loadJourneyContext } from "@/platform/intake/complete";
import { runtimeStore } from "@/platform/stores/runtime";
import { readIntakeEffort, recordIntakeSelection } from "@/platform/intake/effort";

type Context = NonNullable<Awaited<ReturnType<typeof loadJourneyContext>>>;

/** One read model for both authored question sources. No model is consulted. */
export async function intakeReadiness(ctx: Context, recordSelection = false) {
  const store = runtimeStore();
  const request_id = ctx.journey.session.request_id;
  const tenant_id = ctx.journey.problem.tenant_id ?? "prn";
  const [answers, diagnosis, claims, ledger] = await Promise.all([
    store.listIntakeAnswers(request_id), store.listDiagnosisAnswers(request_id),
    store.listClaims(ctx.journey.problem.problem_id), readIntakeEffort({ request_id, tenant_id }),
  ]);
  const registry = buildIntakeRegistry(ctx.playbook);
  const additionalFacts: CurrentFact[] = [];
  const addressSkip = answers.findLast(a => a.field_key === "property.address" && a.value_text === "__skipped__");
  if (!ctx.address && addressSkip) for (const key of ["street", "city_state_zip", "type", "storeys"]) {
    additionalFacts.push({ field_key: `property.${key}`, value: null, status: "UNKNOWN_AFTER_REASONABLE_ATTEMPT",
      reason: "Homeowner skipped the address request", source: "answer", claim_class: "SUPPLIED", evidence_ids: [],
      captured_at: addressSkip.answered_at, confidence: null, confirmed: false });
  }
  for (const [field, value] of Object.entries(ctx.address ?? {})) {
    const key = field === "property_type" ? "type" : field;
    if (typeof value !== "string" || !value.trim()) continue;
    additionalFacts.push({ field_key: `property.${key}`, value, status: "PROVIDED_UNVERIFIED", reason: null,
      source: "answer", claim_class: "SUPPLIED", evidence_ids: [], captured_at: ctx.journey.problem.updated_at ?? ctx.journey.problem.created_at,
      confidence: null, confirmed: false });
  }
  const facts = buildCurrentFactState({ request_id, playbook: ctx.playbook, problem: ctx.journey.problem,
    evidence: ctx.allEvidence, claims, answers, diagnosisAnswers: diagnosis, additionalFacts, labelReadings: ctx.labelReadings, safetyGateRan: true,
    // A normal gate result does not establish every unknown hazard class.
    safetyCoverageComplete: false, safetyFlags: ctx.journey.problem.safety_rule_id ? [ctx.journey.problem.safety_rule_id] : [] });
  const factAnswers = Object.values(facts.fields).filter(f => f.field_key.startsWith("check:") && f.value !== null && f.claim_class !== "INFERRED")
    .map(f => ({ request_id, step_id: f.field_key.slice(6), answer: f.value, evidence_id: f.evidence_ids[0] ?? null, answered_at: f.captured_at }));
  const position = resolveWalkthroughPosition(ctx.playbook, [...factAnswers, ...diagnosis]);
  // A real check action starts the approved walkthrough module. Opening-text
  // observations may advance its graph, but do not themselves opt into it.
  // The durable charge survives reloads and never authorizes a future step.
  const activeWalkthrough = position.currentStepId !== null && position.outcomeId === null && ledger.attempts.some(attempt => {
    if (!attempt.accepted || attempt.charged_units === 0) return false;
    const { kind, question_id } = attempt.operation;
    const stepId = kind === "answer" && question_id?.startsWith("check:") ? question_id.slice(6)
      : kind === "media" && question_id?.startsWith("step:") ? question_id.slice(5) : null;
    return stepId !== null && ctx.playbook.diagnostic_steps.some(step => step.step_id === stepId);
  });
  // Replan at a screen boundary, not after each answer on that screen. The
  // durable zero-cost selection records describe what was actually emitted;
  // rebuilding this set on every read also preserves it across process restarts.
  const lastSelection = ledger.attempts.findLast(attempt => attempt.accepted && attempt.operation.kind === "selection");
  const previousQuestions = lastSelection?.operation.selection_decisions.every(decision => decision.policy_version === registry.version)
    ? lastSelection.operation.selection_decisions.flatMap(decision => {
      const question = registry.questions.find(candidate => candidate.question_id === decision.question_id && candidate.active);
      return question ? [question] : [];
    }) : [];
  const role = (question: QuestionDefinition) => `${question.source_kind}:${question.source_key}`;
  const unfinished = (key: string) => {
    const held = facts.fields[key];
    return !isFactPopulated(held) && (!held || held.value !== null || held.status === "PHOTO_PENDING_EXTRACTION");
  };
  const remainingRoles = new Set(previousQuestions.filter(question => {
    // A label photo can yield brand and age, but those are not independently
    // emitted controls on that action. A typed gap finishes its primary role.
    if (question.source_kind === "field") return unfinished(question.source_key);
    if (question.source_kind === "check") return unfinished(`check:${question.source_key}`);
    return ["property.street", "property.city_state_zip"].some(unfinished);
  }).map(role));
  const eligible = registry.questions.filter(question =>
    (question.source_kind !== "check" || question.source_key === position.currentStepId) &&
    (activeWalkthrough ? question.source_kind === "check"
      : !remainingRoles.size || remainingRoles.has(role(question)))).map(question => question.question_id);
  const screen = selectQuestionScreen(registry, facts, {
    effort_used: ledger.effort_spent, eligible_question_ids: eligible,
    stop_reason: ledger.finished_at ? "homeowner_finish" : null,
  });
  if (!activeWalkthrough && remainingRoles.size) {
    // A weaker read may switch a media control to its authored confirmation
    // variant. Keep that role in its original place while the group shrinks.
    const order = new Map(previousQuestions.map((question, index) => [role(question), index]));
    screen.questions.sort((a, b) => order.get(role(a))! - order.get(role(b))!);
    const questionOrder = new Map(screen.questions.map((question, index) => [question.question_id, index]));
    screen.decisions.sort((a, b) => questionOrder.get(a.question_id)! - questionOrder.get(b.question_id)!);
  }
  if (recordSelection && screen.questions.length) {
    const hash = createHash("sha256").update(JSON.stringify([screen.decisions, ledger.effort_spent])).digest("hex");
    await recordIntakeSelection({ request_id, tenant_id, operation_id: `selection:${hash}`,
      question_id: `screen:${screen.screen_id}`, selection_decisions: screen.decisions });
  }
  const finalFacts = finalizeFactState(registry, facts, screen.stop_reason ?? "packet_requested");
  const readiness = computeProviderReadiness(registry, finalFacts, { stop_reason: screen.stop_reason });
  return { registry, facts, finalFacts, readiness, screen, ledger, position, answers, diagnosis, claims };
}
