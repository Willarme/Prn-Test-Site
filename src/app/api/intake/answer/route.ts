import { NextResponse } from "next/server";
import { z } from "zod";
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
      await store.saveIntakeAnswers(
        fields
          .filter((f) => valid.has(f.field_key))
          .map((f) => ({
            request_id,
            field_key: f.field_key,
            value_text: f.value.trim(),
            evidence_id: null,
            source: "typed" as const,
            answered_at: now,
          }))
      );
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
