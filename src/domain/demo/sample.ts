import { randomUUID } from "node:crypto";
import { classifyProblem } from "@/domain/problem/capabilities";
import { buildPacket } from "@/domain/problem/packet";
import { detectDiagnosis, detectFields } from "@/domain/intake/extract";
import { HVAC_COOLING_PLAYBOOK } from "@/domain/intake/playbooks/hvac-cooling";
import { ACTIVE_DISCLOSURE } from "@/domain/privacy/disclosures";
import { createOwnerCookie } from "@/platform/links/owner";
import { runtimeStore } from "@/platform/stores/runtime";

export const DEMO_SAMPLE_DESCRIPTION =
  "Synthetic demonstration — this is an invented home and request. " +
  "My Carrier AC is 8 years old and blowing warm air since Tuesday. " +
  "The thermostat is set to 72 and the room is 84. The filter is clean. " +
  "The outdoor fan is turning. There is no visible ice on the accessible line.";

/** The demo is an explicit deployment mode, never an alternate production entry. */
export function demoSamplesEnabled(): boolean {
  return process.env.PRN_RUNTIME_STORE === "file" && Boolean(process.env.PRN_DEV_DB_PATH) &&
    (process.env.PRN_CLIENT_DEMO === "1" ||
      (process.env.NODE_ENV !== "production" && process.env.NEXT_DIST_DIR === ".next-codex-demo"));
}

/** A fixed synthetic scenario still uses the normal governed capabilities and
 * persistence boundary. It cannot accept homeowner text or select a model. */
export async function createDemoSample() {
  if (!demoSamplesEnabled()) throw new Error("Synthetic demo is not enabled.");
  const store = runtimeStore();
  if (store.kind !== "file") throw new Error("Synthetic demo requires its isolated file runtime.");
  const now = new Date().toISOString();
  const requestId = `rq_${randomUUID()}`;
  const sessionId = `is_${randomUUID()}`;
  const guestId = `gs_${randomUUID()}`;
  const playbook = HVAC_COOLING_PLAYBOOK;
  const classified = await classifyProblem({
    description: DEMO_SAMPLE_DESCRIPTION, intake_session_id: sessionId,
    problem_family_hint: "hvac-cooling", now,
  }, { allow_model: false, input_ids: [requestId, sessionId], fields: playbook.required_fields });
  if (!classified.ok || !classified.result) throw new Error("The sample classifier is paused.");
  const { problem, evidence } = classified.result;
  const answers = detectFields(DEMO_SAMPLE_DESCRIPTION, playbook.required_fields).map(field => ({
    request_id: requestId, ...field, evidence_id: evidence.evidence_id,
    source: "auto_detected" as const, answered_at: now,
  }));
  const diagnosis = detectDiagnosis(DEMO_SAMPLE_DESCRIPTION, playbook).map(observation => ({
    request_id: requestId, ...observation, evidence_id: evidence.evidence_id, answered_at: now,
  }));
  const built = await buildPacket({
    problem, textEvidence: evidence, allEvidence: [evidence], playbook,
    answers, diagnosis, claims: classified.claims, now, request_id: requestId,
    trigger: "request",
  });
  if (!built.ok || !built.packet) throw new Error("The sample packet builder is paused.");
  // The store requires a consent row to connect the session and record. This
  // explicitly synthetic scope must never be counted as homeowner consent.
  const consent = {
    consent_event_id: `ce_${randomUUID()}`, person_id: null, guest_session_id: guestId,
    problem_id: problem.problem_id, scope: "demo.synthetic_sample", action: "GRANT" as const,
    disclosure_version_id: ACTIVE_DISCLOSURE.disclosure_version_id,
    surface: "synthetic_demo_fixture_not_homeowner_consent", trace_id: null, occurred_at: now,
  };
  await store.ensureDisclosure(ACTIVE_DISCLOSURE);
  await store.recordJourney({
    session: {
      intake_session_id: sessionId, schema_version: "1.0.0", guest_session_id: guestId,
      request_id: requestId, attribution: {
        page_id: null, intent_cluster_id: null, search_opportunity_id: null,
        problem_family_hint: "hvac-cooling", experiment_id: null, variant: "synthetic_demo",
        referrer: null, landing_path: "/demo",
      },
      consent_event_ids: [consent.consent_event_id], playbook_id: playbook.playbook_id,
      entered_at: now, intake_started_at: now,
    }, consent, problem, evidence, packet: built.packet, events: [],
    claims: classified.claims, derivation: classified.derivation,
  });
  await store.saveIntakeAnswers(answers);
  for (const row of diagnosis) await store.saveDiagnosisAnswer(row);
  await store.saveJobAddress(requestId, {
    street: "123 Demo Lane (synthetic)", city_state_zip: "Fort Wayne, IN 46802",
    property_type: "single-family", storeys: "1 storey",
  });
  // Issue authority only after every prerequisite needed by the tour is saved.
  return { requestId, cookie: createOwnerCookie(requestId) };
}
