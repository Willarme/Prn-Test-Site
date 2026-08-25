import { NextResponse } from "next/server";
import { z } from "zod";
import { emitClarifierAnswered } from "@/domain/problem/capabilities";
import { flagEnabled } from "@/platform/flags";
import { loadJourneyContext, nowIso, regeneratePacket } from "@/platform/intake/complete";
import { runtimeStore } from "@/platform/stores/runtime";

/** Typed answers to required fields and guided-diagnosis steps. */
const Body = z.object({
  request_id: z.string().min(1),
  fields: z.array(z.object({ field_key: z.string().min(1), value: z.string().min(1).max(500) })).optional(),
  step: z.object({ step_id: z.string().min(1), answer: z.string().min(1).max(200) }).optional(),
});

export async function POST(request: Request): Promise<NextResponse> {
  if (!flagEnabled("intake_shell_enabled")) return NextResponse.json({ error: "not enabled" }, { status: 404 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const { request_id, fields, step } = parsed.data;
  const ctx = await loadJourneyContext(request_id);
  if (!ctx) return NextResponse.json({ error: "Unknown request" }, { status: 404 });

  const now = nowIso();
  const store = runtimeStore();
  try {
    if (fields && fields.length > 0) {
      const valid = new Set(ctx.playbook.required_fields.map((f) => f.field_key));
      const accepted = fields.filter((f) => valid.has(f.field_key));
      await store.saveIntakeAnswers(
        accepted.map((f) => ({
          request_id,
          field_key: f.field_key,
          value_text: f.value.trim(),
          evidence_id: null,
          source: "typed" as const,
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
       * Fail-soft by emitPlatformEvent's contract — telemetry never costs a
       * homeowner their work.
       */
      try {
        for (const f of accepted) {
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
    if (step) {
      const known = ctx.playbook.diagnostic_steps.some((s) => s.step_id === step.step_id);
      if (!known) return NextResponse.json({ error: "unknown step" }, { status: 400 });
      await store.saveDiagnosisAnswer({
        request_id,
        step_id: step.step_id,
        answer: step.answer.trim(),
        evidence_id: null,
        answered_at: now,
      });
    }
    await regeneratePacket(request_id);
  } catch (err) {
    return NextResponse.json(
      { error: "Could not save — please try again.", detail: err instanceof Error ? err.message : String(err) },
      { status: 503 }
    );
  }
  return NextResponse.json({ ok: true });
}
