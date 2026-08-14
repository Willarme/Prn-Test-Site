import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { DoorAttribution } from "@/domain/intake/contracts";
import { analyzeProblemFixture, buildJobPacketFixture } from "@/domain/problem/fixture-engine";
import { checkSafety } from "@/domain/problem/safety";
import { ACTIVE_DISCLOSURE, CONSENT_SCOPE_INTAKE } from "@/domain/privacy/disclosures";
import { flagEnabled } from "@/platform/flags";
import { updateDevDb } from "@/platform/stores/dev-db";
import type { EventEnvelope } from "@/platform/events/envelope";

/**
 * The ONE central intake entry (doors render the shared form; this is where
 * every submission lands). Doors own zero business logic — the SAFETY GATE
 * runs server-side BEFORE any analysis (#14A §14), consent is verified
 * against the active DisclosureVersion, and access-control ids are
 * crypto-random (never derived from content).
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

  // SAFETY GATE — deterministic, BEFORE any analysis (#14A §14). A halt-class
  // hazard creates no ProblemRecord and no packet; only the safety event.
  const safety = checkSafety(description);
  if (safety && !safety.intake_may_continue) {
    updateDevDb((db) => {
      db.events.push(
        makeEvent(
          "safety.triggered",
          null,
          { safety_rule_id: safety.safety_rule_id, halted: "true" },
          attribution.landing_path,
          now
        )
      );
    });
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

  const consent = {
    consent_event_id: `ce_${randomUUID()}`,
    person_id: null,
    guest_session_id: guestSessionId,
    problem_id: null as string | null,
    scope: CONSENT_SCOPE_INTAKE,
    action: "GRANT" as const,
    disclosure_version_id: ACTIVE_DISCLOSURE.disclosure_version_id,
    surface: "start_request_form",
    trace_id: null,
    occurred_at: now,
  };

  const { problem, evidence } = analyzeProblemFixture({
    description,
    intake_session_id: intakeSessionId,
    problem_family_hint: attribution.problem_family_hint,
    now,
  });
  consent.problem_id = problem.problem_id;
  const packet = buildJobPacketFixture(problem, evidence, now);

  updateDevDb((db) => {
    db.intake_sessions.push({
      intake_session_id: intakeSessionId,
      schema_version: "1.0.0",
      guest_session_id: guestSessionId,
      request_id: requestId,
      attribution,
      consent_event_ids: [consent.consent_event_id],
      entered_at: now,
      intake_started_at: now,
    });
    db.consent_events.push(consent);
    db.problems.push(problem);
    db.evidence.push(evidence);
    db.packets.push(packet);
    const ctx = {
      intake_session_id: intakeSessionId,
      problem_id: problem.problem_id,
      ...(attribution.page_id ? { page_id: attribution.page_id } : {}),
    };
    db.events.push(
      makeEvent("intake.started", guestSessionId, ctx, attribution.landing_path, now),
      makeEvent("consent.granted", guestSessionId, ctx, attribution.landing_path, now),
      makeEvent("problem.created", guestSessionId, ctx, attribution.landing_path, now),
      makeEvent(
        "packet.generated",
        guestSessionId,
        { ...ctx, job_packet_id: packet.job_packet_id },
        attribution.landing_path,
        now
      )
    );
    if (problem.safety_state !== "normal") {
      db.events.push(makeEvent("safety.triggered", guestSessionId, ctx, attribution.landing_path, now));
    }
  });

  return NextResponse.json({
    request_id: requestId,
    safety:
      problem.safety_state === "normal"
        ? null
        : {
            state: problem.safety_state,
            message: safety?.approved_response ?? null,
            intake_may_continue: true,
          },
  });
}
