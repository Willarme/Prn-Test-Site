import { saveQuestionPlan, type QuestionPlan } from "@/platform/intake/question-plan";
import { randomUUID } from "node:crypto";
import type { DoorAttribution } from "@/domain/intake/contracts";
import { classifyProblem } from "@/domain/problem/capabilities";
import { clarifierCandidates } from "@/domain/problem/clarifier";
import { appendIntakeEffort } from "@/platform/intake/effort";
import { initialPacketSnapshot } from "@/platform/intake/handoff";
import { DEFAULT_TENANT_ID } from "@/domain/problem/contracts";
import { createOwnerCookie } from "@/platform/links/owner";
import { buildPacket } from "@/domain/problem/packet";
import { checkSafety } from "@/domain/problem/safety";
import { ACTIVE_DISCLOSURE, CONSENT_SCOPE_INTAKE } from "@/domain/privacy/disclosures";
import { detectFields, detectDiagnosis } from "@/domain/intake/extract";
import { PLAYBOOKS, selectPlaybook } from "@/domain/intake/playbooks";
import { HVAC_COOLING_PLAYBOOK } from "@/domain/intake/playbooks/hvac-cooling";
import { PRN_TRIAL_VOCABULARY } from "@/domain/search/vocabulary";
import { emitPlatformEvent } from "@/platform/events/emit";
import { flagEnabled } from "@/platform/flags";
import { requirePolicyNumber } from "@/platform/policy/store";
import { runtimeStore, type RecordJourneyInput } from "@/platform/stores/runtime";
import type { EventEnvelope } from "@/platform/events/envelope";

/**
 * THE ONE INTAKE ENTRY, AS A FUNCTION.
 *
 * This is the exact body that used to live inside `POST /api/intake`. It moved
 * here unchanged so there can be TWO doors onto one path and still only one
 * path: the JSON route the React `StartRequestForm` posts to, and the multipart
 * adapter `POST /api/intake/start` that Melissa's static door page posts to
 * (CONNECTION MAP - door to packet §3: "one adapter route ... calls the same
 * intake capability the JSON route calls"). A second copy of this logic would
 * mean a second safety gate, and a safety gate that exists twice is a safety
 * gate that can differ.
 *
 * The caller owns the transport and NOTHING else: it turns this result into
 * JSON with a `Set-Cookie`, or into a 303. The safety gate, the consent check,
 * the classification, the packet, the events and the journey write all happen
 * here, identically, for both.
 */
export interface StartIntakeInput {
  description: string;
  attribution: DoorAttribution;
  disclosure_content_hash: string;
  /** Which door this arrived through. Recorded on the consent event's surface. */
  source: "door_form" | "json";
}

export type StartIntakeResult =
  | {
      kind: "started";
      request_id: string;
      next: string;
      /** Set by the caller on its own response object, or ignored. */
      cookie: { name: string; value: string; options: Record<string, unknown> } | null;
      /** A non-halting hazard: intake continued, but the homeowner is told. */
      safety: { state: "review" | "urgent"; message: string | null; intake_may_continue: true } | null;
    }
  | { kind: "safety_halt"; rule_id: string; message: string }
  | { kind: "error"; status: number; error: string; detail?: string };

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

/** A deliberately small language for complete, direct current complaints.
 * Broad playbook regexes are retrieval hints, not proof that a complaint is
 * current or that two words refer to the same appliance. Match the WHOLE text:
 * additional clauses, questions, history, quotations and unfamiliar wording
 * retain the governed alternate. Door attribution never grants eligibility.
 * This only saves a model admission; classification/provenance stay governed. */
function hasUnambiguousAuthoredTextRoute(description: string): boolean {
  const text = description.trim().replace(/[’]/g, "'");
  const families = new Set(PRN_TRIAL_VOCABULARY.family_patterns
    .filter(({ pattern }) => new RegExp(pattern, "i").test(text)).map(({ family }) => family));
  if (families.size !== 1) return false;
  const [family] = families;
  const brand = detectFields(text, HVAC_COOLING_PLAYBOOK.required_fields)
    .find(field => field.field_key === "brand")?.value_text;
  const brandPrefix = brand ? `(?:${brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+)?` : "";
  const subjectPrefix = String.raw`(?:(?:my|our|the|this)\s+)?`;
  const ac = String.raw`(?:ac|a/c|air\s*conditioner|air\s*conditioning(?:\s+(?:unit|system))?)`;
  const timing = String.raw`(?:\s+(?:at all|properly|anymore))?(?:\s+(?:(?:since|starting)\s+(?:yesterday|today|last night|this morning|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|this morning|today|now|for\s+(?:\d{1,3}|one|two|three|four|five|six|seven)\s+(?:hours?|days?)))?[.!]?`;
  const routes = [
    {
      id: HVAC_COOLING_PLAYBOOK.playbook_id,
      assertion: `${brandPrefix}${ac}` + String.raw`\s+(?:(?:is not|isn't)\s+cooling|(?:has\s+)?stopped\s+cooling|(?:won't|will not)\s+cool|(?:is\s+)?blowing\s+(?:warm|hot)(?:\s+air)?)`,
    },
    {
      id: "pb_hvac_no_power_v1",
      assertion: `${brandPrefix}(?:${ac}|furnace|heat pump|hvac)` + String.raw`\s+(?:(?:won't|will not)\s+(?:turn on|come on|start)|(?:is not|isn't)\s+(?:turning on|working))`,
    },
    {
      id: "pb_plumbing_leak_v1",
      assertion: String.raw`(?:(?:kitchen|bathroom|laundry|basement|upstairs|downstairs)\s+)?(?:faucet|pipe|drain|toilet|shower)\s+(?:(?:is\s+)?(?:leaking|dripping)|leaks|drips)`,
    },
  ];
  return routes.some(route => new RegExp(`^${subjectPrefix}${route.assertion}${timing}$`, "i").test(text)
    && selectPlaybook(description, family).playbook_id === route.id
    && PLAYBOOKS.some(playbook => playbook.playbook_id === route.id && playbook.problem_family === family
      && playbook.match_patterns.some(pattern => new RegExp(pattern, "i").test(text))));
}

type StartPhase = "validation" | "runtime" | "safety" | "safety_event" | "owner_signing" | "classification"
  | "packet" | "telemetry" | "question_plan" | "disclosure" | "packet_snapshot"
  | "journey_persist" | "opening_effort" | "diagnosis";

const START_ERROR_CODES = new Set([
  "LINK_SIGNING_NOT_CONFIGURED", "EROFS", "EACCES", "EPERM", "ENOENT", "ENOTDIR",
  "EISDIR", "EEXIST", "EBUSY", "ETIMEDOUT", "ECONNREFUSED", "ECONNRESET",
  "EHOSTUNREACH", "ENETUNREACH",
]);

function recordStartFailure(phase: StartPhase, error: unknown): string {
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  const diagnosticId = `isd_${randomUUID()}`;
  // Fixed labels and an unrelated random ID only: never log the request,
  // exception message/stack, arbitrary error codes, or signed authority.
  console.error("intake.start_failed", {
    diagnostic_id: diagnosticId,
    phase,
    error_code: typeof code === "string" && START_ERROR_CODES.has(code) ? code : "UNEXPECTED",
  });
  return diagnosticId;
}

function startFailure(phase: StartPhase, error: unknown, saving = false): StartIntakeResult {
  const diagnosticId = recordStartFailure(phase, error);
  return {
    kind: "error",
    status: 503,
    error: `We could not ${saving ? "save" : "start"} your request just now. Your text is still here — please try again in a moment.`,
    detail: diagnosticId,
  };
}

export async function startIntake(input: StartIntakeInput): Promise<StartIntakeResult> {
  const attempt: { phase: StartPhase } = { phase: "validation" };
  try {
    return await startIntakeAttempt(input, attempt);
  } catch (error) {
    return startFailure(attempt.phase, error);
  }
}

async function startIntakeAttempt(input: StartIntakeInput, attempt: { phase: StartPhase }): Promise<StartIntakeResult> {
  if (!flagEnabled("intake_shell_enabled")) {
    return { kind: "error", status: 404, error: "intake is not enabled" };
  }
  const description = input.description ?? "";
  if (description.trim().length < 8) {
    return {
      kind: "error",
      status: 400,
      error: "Tell us a little more — a sentence is plenty.",
    };
  }

  // Consent integrity: the recorded DisclosureVersion must be the one the
  // client actually displayed — mismatches are a hard error, never guessed.
  if (input.disclosure_content_hash !== ACTIVE_DISCLOSURE.content_hash) {
    return {
      kind: "error",
      status: 409,
      error: "Consent disclosure version mismatch — reload the page and try again.",
    };
  }

  const attribution = input.attribution;
  const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  // SAFETY GATE — deterministic, BEFORE any analysis (#14A 14). A halt-class
  // hazard creates no ProblemRecord and no packet; only the safety event.
  attempt.phase = "safety";
  const safety = checkSafety(description);
  if (safety && !safety.intake_may_continue) {
    // An unavailable event store must never replace approved emergency copy
    // with a retry message. Record the halt when possible; never continue.
    try {
      attempt.phase = "runtime";
      const safetyStore = runtimeStore();
      attempt.phase = "safety_event";
      await safetyStore.recordEvents([
        makeEvent(
          "safety.triggered",
          null,
          { safety_rule_id: safety.safety_rule_id, halted: "true" },
          attribution.landing_path,
          now
        ),
      ]);
    } catch (error) {
      recordStartFailure(attempt.phase, error);
    }
    return {
      kind: "safety_halt",
      rule_id: safety.safety_rule_id,
      message: safety.approved_response,
    };
  }

  attempt.phase = "runtime";
  const store = runtimeStore();
  const guestSessionId = `gs_${randomUUID()}`;
  const intakeSessionId = `is_${randomUUID()}`;
  const requestId = `rq_${randomUUID()}`;

  // Prepare request-bound authority before any journey write or analysis.
  // A signing/configuration failure must not leave a saved but unreachable
  // request on each retry. The cookie is returned only after persistence.
  attempt.phase = "owner_signing";
  const cookie = createOwnerCookie(requestId);

  attempt.phase = "classification";
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
   * Complete direct complaints recognized by the small authored grammar use
   * the governed deterministic result without spending a model admission.
   * Other descriptions retain the alternate, subject to the same policy and
   * customer-data gates. The deterministic pass is still the FALLBACK and
   * still the whole answer
   * whenever the model is unavailable, refused, over budget or slow —
   * `callModel` fails soft by contract, `classifyHomeProblem` returns the
   * deterministic result with a `fallback_reason`, and safety is written over
   * from the deterministic pass inside that module no matter what the model
   * said. A model never decides safety.
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
      allow_model: !hasUnambiguousAuthoredTextRoute(description),
      request_id: requestId,
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
    return {
      kind: "error",
      status: 503,
      error:
        "We could not read your request just now. Your text is still here — please try again in a moment.",
      // A typed refusal can contain private executor or kill-switch context.
      detail: recordStartFailure("classification", undefined),
    };
  }
  const { problem, evidence } = classified.result;
  const claims = classified.claims;
  const derivation = classified.derivation;
  /**
   * CALL SITE 1 OF 3 (Trial Spec Audit HO-4), routed through A02, 2026-08-25.
   *
   * `lifecycle_events: "caller"` because THIS path owns the customer-attributed
   * envelopes: the ones below carry `guest_session_id` and the door's
   * `landing_path`, which A02 cannot see, and they land inside the same atomic
   * journey write as the packet itself. A02 emits nothing for this generation —
   * one generation, one `packet.generated`.
   */
  attempt.phase = "packet";
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
    return {
      kind: "error",
      status: 503,
      error:
        "We could not build your Job Packet just now. Your text is still here — please try again in a moment.",
      // Keep free-form gateway reasons out of both public detail and logs.
      detail: recordStartFailure("packet", undefined),
    };
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
  attempt.phase = "telemetry";
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
  attempt.phase = "question_plan";
  const playbook = selectPlaybook(description, problem.service_category);
  const detected = detectFields(description, playbook.required_fields).map((d) => ({
    request_id: requestId,
    field_key: d.field_key,
    value_text: d.value_text,
    evidence_id: null,
    source: "auto_detected" as const,
    answered_at: now,
  }));

  // Governed deterministic choices only. The legacy compatibility plan
  // is persisted separately from answers and actually consumed by /complete.
  const questionPlan: QuestionPlan = {
    field_keys: [], engine: "deterministic", run_id: null,
    max_questions: requirePolicyNumber("intake.max_clarifying_questions"),
  };
  try {
    const settled = new Set(detected.map(d => d.field_key));
    const limit = Math.min(playbook.required_fields.filter(f => !settled.has(f.field_key)).length, questionPlan.max_questions);
    for (let askedCount = 0; askedCount < limit; askedCount += 1) {
      // Merged §11.2: authored candidates are deterministic set arithmetic.
      // A model selection consumes an OCR slot without establishing a fact.
      const selection = clarifierCandidates(playbook, [...settled])[0];
      if (!selection || settled.has(selection.field_key)) break;
      settled.add(selection.field_key);
      questionPlan.field_keys.push(selection.field_key);
    }
  } catch { /* The saved journey remains usable with deterministic questions. */ }

  const consent = {
    consent_event_id: `ce_${randomUUID()}`,
    person_id: null,
    guest_session_id: guestSessionId,
    problem_id: problem.problem_id,
    scope: CONSENT_SCOPE_INTAKE,
    action: "GRANT" as const,
    disclosure_version_id: ACTIVE_DISCLOSURE.disclosure_version_id,
    /**
     * WHICH SURFACE THE CONSENT WAS GIVEN ON. "start_request_form" is the React
     * component; the static door page is its own surface and says so, because
     * "where did this person actually read the disclosure" is the question a
     * consent record exists to answer.
     */
    surface: input.source === "door_form" ? "door_intake_form" : "start_request_form",
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
    attempt.phase = "disclosure";
    await store.ensureDisclosure(ACTIVE_DISCLOSURE);
    const pendingJourney: RecordJourneyInput = {
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
    };
    attempt.phase = "packet_snapshot";
    const openingDiagnosis = detectDiagnosis(description, playbook).map(observed => ({
      request_id: requestId, ...observed, evidence_id: evidence.evidence_id, answered_at: now,
    }));
    pendingJourney.packet = { ...packet, intake_snapshot: initialPacketSnapshot({
      journey: pendingJourney, playbook, textEvidence: evidence, allEvidence: [evidence], address: null,
      labelConfidence: {}, labelReadings: [],
    }, detected, openingDiagnosis, claims) };
    attempt.phase = "journey_persist";
    await store.recordJourney(pendingJourney);
    attempt.phase = "opening_effort";
    await appendIntakeEffort({
      request_id: requestId, tenant_id: problem.tenant_id ?? DEFAULT_TENANT_ID,
      operation_id: `opening:${intakeSessionId}`, kind: "opening",
      question_id: "opening-description", question_type: "free_text",
      decision_reason: "The opening description is the one free-text turn (merged section 13.3).",
    });
    attempt.phase = "diagnosis";
    for (const observed of detectDiagnosis(description, playbook)) {
      await store.saveDiagnosisAnswer({ request_id: requestId, ...observed, evidence_id: evidence.evidence_id, answered_at: now });
    }
    if (store.kind === "file" && questionPlan.field_keys.length > 0) {
      try { saveQuestionPlan(requestId, playbook, questionPlan); } catch { /* deterministic UI fallback */ }
    }
    if (detected.length > 0) {
      try {
        await store.saveIntakeAnswers(detected);
      } catch {
        /* best effort — the customer can still add these by hand */
      }
    }
  } catch (err) {
    // Never lose the customer's work to a storage failure (#14A 13.4).
    return startFailure(attempt.phase, err, true);
  }

  return {
    kind: "started",
    request_id: requestId,
    next: `/complete/${requestId}`,
    cookie,
    safety:
      problem.safety_state === "normal"
        ? null
        : {
            state: problem.safety_state,
            message: safety?.approved_response ?? null,
            intake_may_continue: true,
          },
  };
}
