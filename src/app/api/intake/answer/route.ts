import { NextResponse } from "next/server";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { CANNOT_REACH_FIELD_VALUE, CANNOT_REACH_STEP_ANSWER, detectDiagnosis, detectFields, literalFieldText } from "@/domain/intake/extract";
import { checkSafety, type SafetyRule } from "@/domain/problem/safety";
import { journeySafetyRule } from "@/domain/problem/journey-safety";
import { recordCustomerEvent } from "@/platform/events/customer";
import {
  projectWalkthroughView,
  nextFor,
  resolveWalkthroughPosition,
  type WalkthroughView,
} from "@/domain/intake/playbook";
import { changedLineFor } from "@/domain/intake/playbooks/hvac-cooling";
import { emitClarifierAnswered } from "@/domain/problem/capabilities";
import { flagEnabled } from "@/platform/flags";
import { loadJourneyContext, regeneratePacket } from "@/platform/intake/complete";
import { runtimeStore } from "@/platform/stores/runtime";
import { ownerAllowed } from "@/platform/links/owner";

/**
 * Typed answers to required fields, guided-diagnosis steps, and (campaign
 * track P4, 2026-09-05) the job address.
 *
 * Three markers this route accepts on purpose, all read back by the packet:
 *   - a field value of "__cannot_reach__" and a step answer of "cannot_reach":
 *     the escape hatch (merged spec §8.3 — no question is ever blocking). The
 *     packet lists the field or step under "Still unknown" with the reason
 *     "homeowner could not reach it".
 *   - `confirmed: true` on a field: the homeowner confirmed a photo reading or
 *     chose a value after a conflict. Stored with source "confirmed" — the strongest rail in
 *     the packet's legend (Coverage Standard §4.3).
 */
const Body = z.object({
  request_id: z.string().min(1),
  k: z.string().max(4096).optional(),
  fields: z
    .array(
      z.object({
        field_key: z.string().min(1),
        value: z.string().trim().min(1).max(500),
        confirmed: z.boolean().optional(),
      })
    )
    .optional(),
  step: z.object({ step_id: z.string().min(1), answer: z.string().min(1).max(200) }).optional(),
  /** Directions §3.3: the packet requires a job address (routine decision 10). */
  address: z
    .object({
      street: z.string().min(1).max(200),
      city_state_zip: z.string().min(1).max(120),
      property_type: z.string().max(60).nullable().optional(),
      storeys: z.string().max(20).nullable().optional(),
    })
    .optional(),
});

function safetyResponse(safety: SafetyRule, saved = true): NextResponse {
  return NextResponse.json({
    ok: saved,
    next: `/safety/${encodeURIComponent(safety.safety_rule_id)}`,
    safety: { rule_id: safety.safety_rule_id, message: safety.approved_response, intake_may_continue: false },
  }, { status: saved ? 200 : 503 });
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!flagEnabled("intake_shell_enabled")) return NextResponse.json({ error: "not enabled" }, { status: 404 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const { request_id, fields, step, address } = parsed.data;
  if (!(await ownerAllowed(request_id, parsed.data.k))) return NextResponse.json({ error: "Unknown request" }, { status: 404 });
  const ctx = await loadJourneyContext(request_id);
  if (!ctx) return NextResponse.json({ error: "Unknown request" }, { status: 404 });
  const existingSafety = journeySafetyRule(ctx.journey.problem);
  if (existingSafety && !existingSafety.intake_may_continue) return safetyResponse(existingSafety);

  // Preserve milliseconds so a later explicit choice can resolve an earlier
  // report without relying on the database's order for second-precision ties.
  const now = new Date().toISOString();
  const store = runtimeStore();
  let view: WalkthroughView | undefined;
  let changed: string | null = null;
  let newSafety: SafetyRule | null = null;
  try {
    const valid = new Set(ctx.playbook.required_fields.map((f) => f.field_key));
    const accepted = (fields ?? []).filter((f) => valid.has(f.field_key));
    for (const field of accepted) {
      const choices = ctx.playbook.required_fields.find(f => f.field_key === field.field_key)?.choices;
      if (choices && field.value !== CANNOT_REACH_FIELD_VALUE && !choices.some(c => c.value === field.value)) {
        return NextResponse.json({ error: "Choose one of the offered answers." }, { status: 400 });
      }
    }
    const priorAnswers = await store.listDiagnosisAnswers(request_id);
    const known = step ? ctx.playbook.diagnostic_steps.find((s) => s.step_id === step.step_id) : undefined;
    // Validate the whole request before saving any fields or address. A valid
    // field in a forged future-step request cannot create a partial mutation.
    if (step) {
      if (!known) return NextResponse.json({ error: "unknown step" }, { status: 400 });
      const position = resolveWalkthroughPosition(ctx.playbook, priorAnswers);
      if (position.outcomeId !== null || position.currentStepId !== step.step_id) {
        return NextResponse.json({ error: "That step is not currently active for this request." }, { status: 409 });
      }
    }
    const reports = accepted.filter(f => f.value !== CANNOT_REACH_FIELD_VALUE).map(f => f.value);
    if (step && step.answer !== CANNOT_REACH_STEP_ANSWER) reports.push(step.answer);
    const reportText = reports.join(".\n");
    // The same deterministic registry used at entry runs on new free text,
    // before extraction, branch advancement or packet generation.
    const rules = reports.map(text => checkSafety(text)).filter((r): r is SafetyRule => r !== null);
    newSafety = rules.find(r => !r.intake_may_continue) ?? rules[0] ?? null;
    const evidenceId = reportText ? `ev_${randomUUID()}` : null;
    if (evidenceId) {
      await store.attachEvidence(ctx.journey.problem.problem_id, request_id, {
        evidence_id: evidenceId, kind: "customer_text", content: reportText,
        privacy: "private", captured_at: now, field_key: "intake_answer_text",
      });
    }
    if (newSafety && !newSafety.intake_may_continue) {
      await recordCustomerEvent({
        event_name: "safety.triggered", guest_session_id: ctx.journey.session.guest_session_id,
        context: { request_id, problem_id: ctx.journey.problem.problem_id, safety_rule_id: newSafety.safety_rule_id, halted: "true", source: "intake_answer" },
        landing_path: `/complete/${request_id}`,
      });
      return safetyResponse(newSafety);
    }
    if (accepted.length > 0) {
      await store.saveIntakeAnswers(
        accepted.map((f) => ({
          request_id,
          field_key: f.field_key,
          value_text: f.value.trim(),
          evidence_id: evidenceId,
          source: f.confirmed ? ("confirmed" as const) : ("typed" as const),
          answered_at: now,
        }))
      );
      /**
       * A01 INSTRUMENT — `intake.clarifier_answered`, one per field actually
       * accepted. These are the playbook's own required fields, which is exactly
       * the candidate set the clarifier selects from, so an answer here is an
       * answer to a question A01 asked. Fires AFTER the save, so the event
       * records something that happened rather than something attempted, and
       * only for fields that passed the allow-list. The field key travels; the
       * homeowner's answer stays in the IntakeAnswer row.
       *
       * A confirmation is not a new answer (the photo already counted) and
       * "I can't get to this" is not an answer at all, so neither is counted.
       *
       * Fail-soft by emitPlatformEvent's contract — telemetry never costs a
       * homeowner their work.
       */
      try {
        for (const f of accepted) {
          if (f.confirmed || f.value.trim() === CANNOT_REACH_FIELD_VALUE) continue;
          // Voluntary details are not automatic clarifying questions asked.
          if (ctx.playbook.required_fields.find(field => field.field_key === f.field_key)?.optional_group) continue;
          await emitClarifierAnswered({
            problem_id: ctx.journey.problem.problem_id,
            request_id,
            playbook_id: ctx.playbook.playbook_id,
            field_key: f.field_key,
            source: "typed",
          });
        }
      } catch {
        /* the answers are already saved; telemetry never takes them back */
      }
    }
    if (reportText) {
      const existing = await store.listIntakeAnswers(request_id);
      const held = new Map(existing.map(a => [a.field_key, a.value_text]));
      const supplied = new Set(accepted.map(f => f.field_key));
      // Additional statements can fill another missing field, never replace
      // one already held (especially a photo value the owner confirmed).
      const declarative = literalFieldText(reportText);
      const additional = detectFields(declarative, ctx.playbook.required_fields).filter(f => !supplied.has(f.field_key) &&
        (!held.get(f.field_key) || held.get(f.field_key) === CANNOT_REACH_FIELD_VALUE));
      if (additional.length) await store.saveIntakeAnswers(additional.map(f => ({
        request_id, ...f, evidence_id: evidenceId, source: "auto_detected" as const, answered_at: now,
      })));
      const heldSteps = new Set(priorAnswers.filter(a => a.answer && a.answer !== CANNOT_REACH_STEP_ANSWER).map(a => a.step_id));
      for (const observed of detectDiagnosis(reportText, ctx.playbook)) {
        if (heldSteps.has(observed.step_id) || observed.step_id === step?.step_id) continue;
        await store.saveDiagnosisAnswer({ request_id, ...observed, evidence_id: evidenceId, answered_at: now });
      }
    }
    if (address) {
      await store.saveJobAddress(request_id, {
        street: address.street.trim(),
        city_state_zip: address.city_state_zip.trim(),
        property_type: address.property_type?.trim() || null,
        storeys: address.storeys?.trim() || null,
      });
    }
    if (step) {
      // AUTHORIZATION, not just validation: `step.step_id` naming a real
      // step in this playbook is not enough — it must be THIS customer's
      // actual current step, replayed server-side from their saved answers
      // (the same authority the page render uses). Without this, any step
      // id (or an outcome id reachable from one) is pullable one POST at a
      // time regardless of how far the customer has actually gotten — an
      // active version of the exact leak T1-15 closes passively.
      const answer = step.answer.trim();
      await store.saveDiagnosisAnswer({
        request_id,
        step_id: step.step_id,
        answer,
        evidence_id: null,
        answered_at: now,
      });
      // Resolve the branch SERVER-SIDE (the one resolver, playbook.ts) and
      // hand back only the resulting step or outcome — never the graph
      // (T1-15). The browser never learns another step exists. The "changed"
      // line is looked up by the branch actually taken, so the words match the
      // path (checklist C6).
      const branch = nextFor(known!, answer);
      const freshPosition = resolveWalkthroughPosition(ctx.playbook, await store.listDiagnosisAnswers(request_id));
      changed = branch ? changedLineFor(ctx.playbook.playbook_id, step.step_id, branch.when, freshPosition.currentStepId) : null;
      if (!branch && answer === CANNOT_REACH_STEP_ANSWER) {
        changed = "That one goes in the packet as not checked.";
      }
      view = projectWalkthroughView(ctx.playbook, freshPosition.currentStepId, freshPosition.outcomeId);
    }
    await regeneratePacket(request_id);
  } catch (err) {
    if (newSafety && !newSafety.intake_may_continue) return safetyResponse(newSafety, false);
    return NextResponse.json(
      { error: "Could not save — please try again.", detail: err instanceof Error ? err.message : String(err) },
      { status: 503 }
    );
  }
  return NextResponse.json({ ok: true, ...(view ? { view } : {}), ...(changed ? { changed } : {}) });
}
