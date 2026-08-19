import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { findConcept } from "@/domain/feature-lab/concepts";
import { flagEnabled } from "@/platform/flags";
import { runtimeStore } from "@/platform/stores/runtime";
import type { EventEnvelope } from "@/platform/events/envelope";

// Email capture (the fourth #14A 16 funnel step) arrives with the Feature
// Lab wave proper — the contract surfaces only what is actually persisted.
const InterestRequest = z.object({
  concept: z.string().min(1),
  kind: z.enum(["viewed", "cta", "thumb"]),
  thumb: z.enum(["up", "down"]).nullable().optional(),
  landing_path: z.string().min(1),
});

export async function POST(request: Request): Promise<NextResponse> {
  if (!flagEnabled("feature_lab_enabled")) {
    return NextResponse.json({ error: "not enabled" }, { status: 404 });
  }
  const body = await request.json().catch(() => null);
  const parsed = InterestRequest.safeParse(body);
  if (!parsed.success || !findConcept(parsed.data.concept)) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
  const { concept, kind, thumb, landing_path } = parsed.data;
  const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const event: EventEnvelope = {
    event_id: `ev_${randomUUID()}`,
    event_name: `feature_lab.${kind}` as EventEnvelope["event_name"],
    event_version: 1,
    occurred_at: now,
    actor: { actor_type: "guest", actor_id: null },
    guest_session_id: null,
    context: { feature_concept: concept, ...(thumb ? { thumb } : {}) },
    source: { channel: "web", referrer: null, landing_path },
    versions: { schema: "1.0.0" },
    result: { status: "ok", duration_ms: null, cost_usd: null },
    privacy_class: "internal",
    trace_id: null,
    agent_run_id: null,
    action_request_id: null,
  };
  try {
    await runtimeStore().recordEvents([event]);
  } catch {
    // Interest signals are best-effort telemetry; never surface a failure to
    // the visitor over a thumbs-up.
    return NextResponse.json({ ok: true, recorded: false });
  }
  return NextResponse.json({ ok: true, recorded: true });
}
