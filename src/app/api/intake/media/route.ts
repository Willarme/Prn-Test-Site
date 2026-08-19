import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { flagEnabled } from "@/platform/flags";
import {
  MEDIA_ALLOWLIST,
  MEDIA_MAX_BYTES,
  localMediaFile,
  mediaStore,
} from "@/platform/adapters/media-storage";
import { loadJourneyContext, nowIso, regeneratePacket } from "@/platform/intake/complete";
import { runtimeStore } from "@/platform/stores/runtime";

/**
 * Photo/video upload for a journey. Private storage only; the response never
 * contains a public URL. Validates type + size, records EvidenceObject, links
 * it to the ProblemRecord, marks the field answered, regenerates the packet.
 */
const Meta = z.object({
  request_id: z.string().min(1),
  /** Required field this satisfies, or a diagnostic step id prefixed "step:". */
  target: z.string().min(1),
});

export async function POST(request: Request): Promise<NextResponse> {
  if (!flagEnabled("intake_shell_enabled")) return NextResponse.json({ error: "not enabled" }, { status: 404 });
  const form = await request.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Expected a file upload" }, { status: 400 });
  const meta = Meta.safeParse({ request_id: form.get("request_id"), target: form.get("target") });
  const file = form.get("file");
  if (!meta.success || !(file instanceof File)) {
    return NextResponse.json({ error: "Missing request, target or file" }, { status: 400 });
  }
  const ext = MEDIA_ALLOWLIST[file.type];
  if (!ext) {
    return NextResponse.json(
      { error: "Please upload a photo (JPG, PNG, HEIC, WebP) or a short video (MP4, MOV)." },
      { status: 415 }
    );
  }
  if (file.size > MEDIA_MAX_BYTES) {
    return NextResponse.json({ error: "That file is over 25 MB — try a shorter clip or a smaller photo." }, { status: 413 });
  }
  const ctx = await loadJourneyContext(meta.data.request_id);
  if (!ctx) return NextResponse.json({ error: "Unknown request" }, { status: 404 });

  const now = nowIso();
  const evidenceId = `ev_${randomUUID()}`;
  const key = `${meta.data.request_id}/${meta.data.target.replace(/[^a-z0-9_:-]/gi, "_")}/${evidenceId}.${ext}`;
  const data = Buffer.from(await file.arrayBuffer());
  const store = runtimeStore();
  try {
    const stored = await mediaStore().put(key, data, file.type);
    const isStep = meta.data.target.startsWith("step:");
    await store.attachEvidence(ctx.journey.problem.problem_id, {
      evidence_id: evidenceId,
      kind: file.type.startsWith("video/") ? "video" : "photo",
      content: stored.storage_ref,
      privacy: "private",
      captured_at: now,
      mime: stored.mime,
      bytes: stored.bytes,
      field_key: isStep ? null : meta.data.target,
    });
    if (isStep) {
      const stepId = meta.data.target.slice(5);
      await store.saveDiagnosisAnswer({
        request_id: meta.data.request_id,
        step_id: stepId,
        answer: null,
        evidence_id: evidenceId,
        answered_at: now,
      });
      // A step photo can also satisfy required fields (e.g. unit label).
      const step = ctx.playbook.diagnostic_steps.find((s) => s.step_id === stepId);
      if (step && step.satisfies_fields.length > 0) {
        await store.saveIntakeAnswers(
          step.satisfies_fields.map((field_key) => ({
            request_id: meta.data.request_id,
            field_key,
            value_text: null,
            evidence_id: evidenceId,
            source: "photo" as const,
            answered_at: now,
          }))
        );
      }
    } else {
      await store.saveIntakeAnswers([
        {
          request_id: meta.data.request_id,
          field_key: meta.data.target,
          value_text: null,
          evidence_id: evidenceId,
          source: "photo",
          answered_at: now,
        },
      ]);
    }
    await store.recordEvents([
      {
        event_id: `ev_${randomUUID()}`,
        event_name: "intake.evidence_added",
        event_version: 1,
        occurred_at: now,
        actor: { actor_type: "guest", actor_id: null },
        guest_session_id: ctx.journey.session.guest_session_id,
        context: { problem_id: ctx.journey.problem.problem_id, kind: file.type.startsWith("video/") ? "video" : "photo" },
        source: { channel: "web", referrer: null, landing_path: null },
        versions: { schema: "1.0.0" },
        result: { status: "ok", duration_ms: null, cost_usd: null },
        privacy_class: "private",
        trace_id: null,
        agent_run_id: null,
        action_request_id: null,
      },
    ]).catch(() => {});
    await regeneratePacket(meta.data.request_id);
  } catch (err) {
    return NextResponse.json(
      { error: "We could not save that file right now — please try again.", detail: err instanceof Error ? err.message : String(err) },
      { status: 503 }
    );
  }
  return NextResponse.json({ ok: true, evidence_id: evidenceId });
}

/** Local-dev only: serve a privately stored file back to the same app. */
export async function GET(request: Request): Promise<Response> {
  const ref = new URL(request.url).searchParams.get("ref");
  if (!ref || !ref.startsWith("local/")) return new Response("not found", { status: 404 });
  const data = localMediaFile(ref);
  if (!data) return new Response("not found", { status: 404 });
  const ext = ref.split(".").pop() ?? "";
  const mime = Object.entries(MEDIA_ALLOWLIST).find(([, e]) => e === ext)?.[0] ?? "application/octet-stream";
  return new Response(new Uint8Array(data), { headers: { "Content-Type": mime, "Cache-Control": "private, no-store" } });
}
