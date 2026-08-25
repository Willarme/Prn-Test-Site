import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { DoorAttribution } from "@/domain/intake/contracts";
import { classifyProblem, selectClarifier } from "@/domain/problem/capabilities";
import { DEFAULT_TENANT_ID } from "@/domain/problem/contracts";
import {
  JOURNEY_COOKIE_NAME,
  encodeJourneyCookie,
  projectPacketForCookie,
} from "@/domain/problem/journey-cookie";
import { buildPacket } from "@/domain/problem/packet";
import { checkSafety } from "@/domain/problem/safety";
import { ACTIVE_DISCLOSURE, CONSENT_SCOPE_INTAKE } from "@/domain/privacy/disclosures";
import { detectFields } from "@/domain/intake/extract";
import { selectPlaybook } from "@/domain/intake/playbooks";
import { emitPlatformEvent } from "@/platform/events/emit";
import { flagEnabled } from "@/platform/flags";
import { requirePolicyNumber } from "@/platform/policy/store";
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
  /**
   * A01'S PRODUCTION SURFACE IS THE LIVE PATH (finding 1, 2026-08-25).
   *
   * This called `analyzeProblemFixture` directly. The deterministic analyzer is
   * STILL the implementation — it is what the gateway's executor runs — but the
   * call now goes through A01's capability surface, which means the journey
   * below gets four things it never had: the governed door (registry lookup,
   * kill switch, ledger row, `capability.invoked`), the FactClaims this
   * homeowner's own words support, the DerivationRecord naming what produced
   * them, and `problem.fact_extracted` per claim.
   *
   * NOTHING THE HOMEOWNER SEES CHANGES. Same classification, same
   * ProblemRecord, same packet, same page — `claim_ids` is populated where it
   * used to be `[]`, and that field reaches no customer surface.
   *
   * `allow_model: false` — DELIBERATE AND NOT A DEFAULT. A01's model-backed
   * alternate ships flag-off and is refused before any network call because it
   * handles customer data, so consulting it here would buy one refusal row per
   * intake and nothing else. The live path asks for the deterministic answer
   * and says so.
   *
   * `resolve_fields` — the playbook is chosen by service_category, which does
   * not exist until the classification returns. A01's own flowchart puts the
   * Playbook Resolver after Classify for that reason. `selectPlaybook` is pure
   * and deterministic over (description, category), so the second call below
   * returns the identical playbook.
   */
  const classified = await classifyProblem(
    {
      description,
      intake_session_id: intakeSessionId,
      problem_family_hint: attribution.problem_family_hint,
      now,
    },
    {
      allow_model: false,
      tenant_id: DEFAULT_TENANT_ID,
      input_ids: [requestId, intakeSessionId],
      resolve_fields: (p) => selectPlaybook(description, p.service_category).required_fields,
    }
  );
  if (!classified.ok || !classified.result) {
    /**
     * A01 IS PAUSED (kill switch) OR OTHERWISE REFUSED — and there is no
     * fallback to the analyzer here, for the same reason the packet path has
     * none below: calling the implementation directly would mean a kill switch
     * on A01 stops nothing, which is the hole this wiring closes. The customer
     * keeps their text and is told honestly.
     */
    return NextResponse.json(
      {
        error:
          "We could not read your request just now. Your text is still here — please try again in a moment.",
        detail: classified.refusal,
      },
      { status: 503 }
    );
  }
  const { problem, evidence } = classified.result;
  const claims = classified.claims;
  const derivation = classified.derivation;
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
    /**
     * A01's claims reach A02's `claim_basis` for the first time. Absent used to
     * mean "A01's surface is not wired in"; it now means "this build
     * established none", which is the honest distinction that field was written
     * to carry.
     */
    claims,
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

  /**
   * A00 Agent Run Ledger (Wave-0 proof case): A01's classification run.
   *
   * THE ROW IS THE GATEWAY'S NOW, NOT A SECOND ONE WRITTEN HERE. This block
   * used to call `recordAgentRun` by hand with `capabilities_used:
   * ["classify_problem"]` and a provider it asserted rather than observed —
   * which was the only ledger evidence A01 ran, because A01 ran as a plain
   * function call. Now that the call goes through `capability_call`, the
   * gateway writes that row from what actually happened (the resolved canonical
   * key, the real provider, the measured latency). Writing a second row here
   * would double-count A01's runs and break the one-row-per-agent-run property
   * the ledger exists to provide.
   *
   * A00 Event Spine proof case: one envelope per platform run, linked by
   * agent_run_id. "agent.run_completed" is an EXISTING canonical A08-owned name
   * (#14A §18.2) — no new name invented here. Fail-soft telemetry.
   */
  await emitPlatformEvent({
    event_name: "agent.run_completed",
    agent_id: "A01",
    agent_run_id: classified.run_id,
    context: { intake_session_id: intakeSessionId, problem_id: problem.problem_id },
    versions: { schema: "1.0.0", engine: classified.engine, capability: "classify_home_problem" },
    duration_ms: Date.now() - analyzeStarted,
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

  /**
   * THE CLARIFYING QUESTIONS — selected by A01, under A01's ceiling, and
   * recorded (finding 1).
   *
   * WHAT IS BEING COUNTED. The next screen (`/complete/[request_id]`) presents
   * exactly the playbook's required fields, green-checked for the ones the
   * homeowner's own words already answered. So the questions actually asked of
   * this person are the OPEN ones — and that is the set this loop walks, in
   * A01's own priority order (CORE before HELPFUL, then the playbook's
   * editorial order), stopping at `intake.max_clarifying_questions`.
   *
   * WHY A LOOP AND NOT ONE CALL. A01's KPI is median questions per completed
   * request, and its whole mandate is that every question is unpaid work asked
   * of an anxious person. An instrument that emitted once per intake would
   * report the same number no matter how much was asked, which is the metric
   * saying nothing while looking like it says something.
   *
   * A field already ASKED joins the "no longer a candidate" set — that is what
   * `answered_field_keys` selects against — so no question is selected twice.
   *
   * FAIL-SOFT. This is instrumentation of questions the page will present
   * regardless: if selection or emission fails, the homeowner's journey is
   * untouched. Nothing here changes what they are shown.
   */
  try {
    const maxQuestions = requirePolicyNumber("intake.max_clarifying_questions");
    const settled = new Set(detected.map((d) => d.field_key));
    /**
     * The loop stops at the smaller of the ceiling and the number of open
     * fields — so it makes one governed call PER QUESTION and never a final
     * call that exists only to be told there is nothing left. An audit row for
     * "asked nothing" is noise in the one ledger an owner reads to see what the
     * agents actually did. The ceiling is still enforced by `selectClarifier`
     * itself, which checks it before the gateway; this bound only avoids a
     * wasted call.
     */
    const open = playbook.required_fields.filter((f) => !settled.has(f.field_key)).length;
    const limit = Math.min(open, maxQuestions);
    let askedCount = 0;
    while (askedCount < limit) {
      const selection = await selectClarifier(
        {
          playbook,
          answered_field_keys: [...settled],
          asked_count: askedCount,
          max_questions: maxQuestions,
        },
        {
          allow_model: false,
          request_id: requestId,
          tenant_id: DEFAULT_TENANT_ID,
        }
      );
      if (!selection.ok || !selection.ask) break;
      settled.add(selection.ask.field_key);
      askedCount += 1;
    }
  } catch {
    /* telemetry never costs a homeowner their intake */
  }

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
      /**
       * A01's durable facts land in the SAME write as the record they are
       * about. A claim whose ProblemRecord was never stored, or a record whose
       * `claim_ids` point at rows that do not exist, is a broken provenance
       * chain — and the chain is the whole reason these objects exist.
       */
      claims,
      derivation,
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

  /**
   * No database configured (local dev or a preview deploy without keys): carry
   * the journey in the requester's own browser so the flow still works. Never
   * set once the database is wired.
   *
   * NARROWED, 2026-08-25 (Loop Spec Audit A02 condition 6). This used to encode
   * `{request_id, problem, packet}` WHOLESALE — the entire ProblemRecord
   * (problem_summary, service_category, evidence_ids, claim_ids) and the entire
   * packet, meaning every field any later agent added arrived in a browser
   * cookie by default. It now carries an ALLOW-LIST: the one problem field the
   * results page reads, and only the packet fields it renders. See
   * domain/problem/journey-cookie.ts for the full reasoning, including why
   * "narrow it to ids and rehydrate" is not available here.
   */
  if (store.kind === "file") {
    const payload = encodeJourneyCookie({
      request_id: requestId,
      safety_rule_id: problem.safety_rule_id,
      packet: projectPacketForCookie(packet),
    });
    if (payload) {
      res.cookies.set(JOURNEY_COOKIE_NAME, payload, {
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
