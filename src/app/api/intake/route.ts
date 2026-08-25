import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { DoorAttribution } from "@/domain/intake/contracts";
import { analyzeProblemFixture } from "@/domain/problem/fixture-engine";
import { buildPacket } from "@/domain/problem/packet";
import { checkSafety } from "@/domain/problem/safety";
import { ACTIVE_DISCLOSURE, CONSENT_SCOPE_INTAKE } from "@/domain/privacy/disclosures";
import { detectFields } from "@/domain/intake/extract";
import { selectPlaybook } from "@/domain/intake/playbooks";
import { emitPlatformEvent } from "@/platform/events/emit";
import { flagEnabled } from "@/platform/flags";
import { recordAgentRun } from "@/platform/runs/ledger";
import { runtimeStore } from "@/platform/stores/runtime";
import type { EventEnvelope } from "@/platform/events/envelope";

/**
 * The ONE central intake entry (doors render the shared form; this is where
 * every submission lands). Doors own zero business logic — the SAFETY GATE
 * runs server-side BEFORE any analysis (#14A 14), consent is verified against
 * the active DisclosureVersion, and access-control ids are crypto-random.
 */
const IntakeRequest = z.object({
  description: z.string().min(8, "Tell us a little more — a sentence is plenty."),
  /** Hash of the disclosure the client actually rendered — verified below. */
  disclosure_content_hash: z.string().min(1),
  attribution: DoorAttribution,
});

function makeEvent(
  name: EventEnvelope["event_name"],
  guestSessionId: string | null,
  context: Record<string, string>,
  landingPath: string | null,
  now: string
): EventEnvelope {
  return {
    event_id: `ev_${randomUUID()}`,
    event_name: name,
    event_version: 1,
    occurred_at: now,
    actor: { actor_type: "guest", actor_id: null },
    guest_session_id: guestSessionId,
    context,
    source: { channel: "web", referrer: null, landing_path: landingPath },
    versions: { schema: "1.0.0", engine: "fixture" },
    result: { status: "ok", duration_ms: null, cost_usd: null },
    privacy_class: "internal",
    trace_id: null,
    agent_run_id: null,
    action_request_id: null,
  };
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!flagEnabled("intake_shell_enabled")) {
    return NextResponse.json({ error: "intake is not enabled" }, { status: 404 });
  }
  const body = await request.json().catch(() => null);
  const parsed = IntakeRequest.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 }
    );
  }
  const { description, attribution, disclosure_content_hash } = parsed.data;

  // Consent integrity: the recorded DisclosureVersion must be the one the
  // client actually displayed — mismatches are a hard error, never guessed.
  if (disclosure_content_hash !== ACTIVE_DISCLOSURE.content_hash) {
    return NextResponse.json(
      { error: "Consent disclosure version mismatch — reload the page and try again." },
      { status: 409 }
    );
  }

  const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const store = runtimeStore();

  // SAFETY GATE — deterministic, BEFORE any analysis (#14A 14). A halt-class
  // hazard creates no ProblemRecord and no packet; only the safety event.
  const safety = checkSafety(description);
  if (safety && !safety.intake_may_continue) {
    await store.recordEvents([
      makeEvent(
        "safety.triggered",
        null,
        { safety_rule_id: safety.safety_rule_id, halted: "true" },
        attribution.landing_path,
        now
      ),
    ]);
    return NextResponse.json({
      request_id: null,
      safety: {
        state: "urgent",
        message: safety.approved_response,
        intake_may_continue: false,
      },
    });
  }

  const guestSessionId = `gs_${randomUUID()}`;
  const intakeSessionId = `is_${randomUUID()}`;
  const requestId = `rq_${randomUUID()}`;

  const analyzeStarted = Date.now();
  const { problem, evidence } = analyzeProblemFixture({
    description,
    intake_session_id: intakeSessionId,
    problem_family_hint: attribution.problem_family_hint,
    now,
  });
  /**
   * CALL SITE 1 OF 3 (Trial Spec Audit HO-4), routed through A02, 2026-08-25.
   *
   * `lifecycle_events: "caller"` because THIS route owns the customer-attributed
   * envelopes: the ones below carry `guest_session_id` and the door's
   * `landing_path`, which A02 cannot see, and they land inside the same atomic
   * journey write as the packet itself. A02 emits nothing for this generation —
   * one generation, one `packet.generated`.
   */
  const packetOutcome = await buildPacket({
    problem,
    textEvidence: evidence,
    now,
    request_id: requestId,
    trigger: "request",
    lifecycle_events: "caller",
  });
  if (!packetOutcome.ok || !packetOutcome.packet) {
    /**
     * A02 IS PAUSED (kill switch) OR OTHERWISE REFUSED. There is no fallback
     * here BY DESIGN — calling the builder directly would mean a kill switch on
     * A02 stops nothing, which is the exact hole this build closed. The
     * customer keeps their text and is told honestly, on the same shape the
     * storage-failure path already uses (#14A 13.4: never lose their work).
     */
    return NextResponse.json(
      {
        error:
          "We could not build your Job Packet just now. Your text is still here — please try again in a moment.",
        detail: packetOutcome.refusal,
      },
      { status: 503 }
    );
  }
  const packet = packetOutcome.packet;

  // A00 Agent Run Ledger (Wave-0 proof case): audit A01's classify_problem
  // run. IDs only — never the customer's description or evidence. Fail-soft
  // by contract: recordAgentRun never throws and never alters this flow.
  const platformRun = await recordAgentRun({
    agent_id: "A01",
    trigger: "request",
    input_ids: [requestId, intakeSessionId, problem.problem_id],
    capabilities_used: ["classify_problem"],
    tool_provider: "deterministic-stand-in",
    outputs_summary: {
      problem_id: problem.problem_id,
      job_packet_id: packet.job_packet_id,
      safety_state: problem.safety_state,
    },
    cost_usd: 0, // deterministic path — becomes a TEST-labeled real figure once a model is wired
    latency_ms: Date.now() - analyzeStarted,
  });
  // A00 Event Spine proof case: one envelope per platform run, linked by
  // agent_run_id. "agent.run_completed" is an EXISTING canonical A08-owned
  // name (#14A §18.2) — no new name invented here. Fail-soft telemetry.
  await emitPlatformEvent({
    event_name: "agent.run_completed",
    agent_id: "A01",
    agent_run_id: platformRun.run_id,
    context: { intake_session_id: intakeSessionId, problem_id: problem.problem_id },
    versions: { schema: "1.0.0", engine: "fixture", capability: "classify_problem" },
    duration_ms: platformRun.latency_ms ?? null,
    cost_usd: 0,
  });

  // Route to the generated-once playbook and award green checks for anything
  // the customer already told us (no AI call; see domain/intake/extract).
  const playbook = selectPlaybook(description, problem.service_category);
  const detected = detectFields(description, playbook.required_fields).map((d) => ({
    request_id: requestId,
    field_key: d.field_key,
    value_text: d.value_text,
    evidence_id: null,
    source: "auto_detected" as const,
    answered_at: now,
  }));

  const consent = {
    consent_event_id: `ce_${randomUUID()}`,
    person_id: null,
    guest_session_id: guestSessionId,
    problem_id: problem.problem_id,
    scope: CONSENT_SCOPE_INTAKE,
    action: "GRANT" as const,
    disclosure_version_id: ACTIVE_DISCLOSURE.disclosure_version_id,
    surface: "start_request_form",
    trace_id: null,
    occurred_at: now,
  };

  const ctx = {
    intake_session_id: intakeSessionId,
    problem_id: problem.problem_id,
    ...(attribution.page_id ? { page_id: attribution.page_id } : {}),
  };
  const events: EventEnvelope[] = [
    makeEvent("intake.started", guestSessionId, ctx, attribution.landing_path, now),
    makeEvent("consent.granted", guestSessionId, ctx, attribution.landing_path, now),
    makeEvent("problem.created", guestSessionId, ctx, attribution.landing_path, now),
    /**
     * THE COMPLETION EDGE (A02 step 2 / Trial Spec Audit §4 item 6). This is the
     * moment the homeowner finished — they stopped typing and the system had
     * enough to proceed — and until now the funnel had no instrument for it at
     * all. Events cannot be backfilled: a trial run without this name has no
     * completion baseline, permanently.
     */
    makeEvent("problem.intake_completed", guestSessionId, ctx, attribution.landing_path, now),
    makeEvent(
      "packet.generated",
      guestSessionId,
      { ...ctx, job_packet_id: packet.job_packet_id },
      attribution.landing_path,
      now
    ),
  ];
  if (problem.safety_state !== "normal") {
    events.push(makeEvent("safety.triggered", guestSessionId, ctx, attribution.landing_path, now));
  }

  try {
    // The exact wording shown must be reproducible later, independent of any
    // future revision to the text (#14A 9.3).
    await store.ensureDisclosure(ACTIVE_DISCLOSURE);
    await store.recordJourney({
      session: {
        intake_session_id: intakeSessionId,
        schema_version: "1.0.0",
        guest_session_id: guestSessionId,
        request_id: requestId,
        attribution,
        consent_event_ids: [consent.consent_event_id],
        playbook_id: playbook.playbook_id,
        entered_at: now,
        intake_started_at: now,
      },
      consent,
      problem,
      evidence,
      packet,
      events,
    });
    if (detected.length > 0) {
      try {
        await store.saveIntakeAnswers(detected);
      } catch {
        /* best effort — the customer can still add these by hand */
      }
    }
  } catch (err) {
    // Never lose the customer's work to a storage failure (#14A 13.4).
    return NextResponse.json(
      {
        error:
          "We could not save your request just now. Your text is still here — please try again in a moment.",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 503 }
    );
  }

  const res = NextResponse.json({
    request_id: requestId,
    next: `/complete/${requestId}`,
    safety:
      problem.safety_state === "normal"
        ? null
        : {
            state: problem.safety_state,
            message: safety?.approved_response ?? null,
            intake_may_continue: true,
          },
  });

  // No database configured (local dev or a preview deploy without keys):
  // carry the journey in the requester own browser so the flow still works.
  // Never set once the database is wired.
  if (store.kind === "file") {
    const payload = Buffer.from(
      JSON.stringify({ request_id: requestId, problem, packet })
    ).toString("base64url");
    if (payload.length < 3800) {
      res.cookies.set("prn_last_journey", payload, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: 60 * 60 * 24 * 7,
        path: "/results",
      });
    }
  }
  return res;
}
