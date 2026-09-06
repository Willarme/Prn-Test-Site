import { analyzeProblemFixture } from "@/domain/problem/fixture-engine";
import { assemblePacket } from "@/domain/problem/packet-assembly";
import { buildDirectionsInput } from "@/domain/packet/directions-input";
import { renderPacketHtml } from "@/domain/packet/render";
import { detectFields, detectDiagnosis } from "@/domain/intake/extract";
import { HVAC_COOLING_PLAYBOOK } from "@/domain/intake/playbooks/hvac-cooling";
import { nextFor, projectWalkthroughView, type DiagnosisAnswer } from "@/domain/intake/playbook";
import type { Journey } from "@/platform/stores/runtime";

/** Public synthetic demonstration. This module performs no I/O and grants no
 * authority over normal requests. Reconstructing it needs no server memory. */
export const HOSTED_SAMPLE_NOW = "2026-09-06T12:00:00Z";
export const HOSTED_SAMPLE_ID = "rq_de000000_0000_4000_8000_000000000001";
export const HOSTED_SAMPLE_DESCRIPTION = "My AC is running but blowing warm air. The Carrier system is 8 years old. This started on Tuesday. The thermostat is set to 72 and the room is 84. The filter is clean. The outdoor fan is running. There is no visible ice on the accessible line.";
export const HOSTED_SAMPLE_COOKIE = "prn_sample_choices";
export interface HostedSampleState { v: 1; trail: string[]; kept: boolean }
export const emptyHostedSampleState = (): HostedSampleState => ({ v: 1, trail: [], kept: false });

function allowedAnswers(stepId: string): string[] {
  const step = HVAC_COOLING_PLAYBOOK.diagnostic_steps.find(item => item.step_id === stepId);
  if (!step) return [];
  if (step.input.kind === "yes_no") return ["yes", "no"];
  if (step.input.kind === "choice") return step.input.options;
  if (step.input.kind === "rating") return Array.from({ length: 11 }, (_, i) => String(i));
  return ["cannot_reach"];
}

export function hostedWalkthrough(trail: readonly string[] = []) {
  let stepId = HVAC_COOLING_PLAYBOOK.first_step_id;
  let outcomeId: string | null = null;
  const diagnosis: DiagnosisAnswer[] = [];
  for (const answer of trail) {
    if (!stepId || !allowedAnswers(stepId).includes(answer)) return null;
    const step = HVAC_COOLING_PLAYBOOK.diagnostic_steps.find(item => item.step_id === stepId)!;
    diagnosis.push({ request_id: HOSTED_SAMPLE_ID, step_id: stepId, answer, evidence_id: null, answered_at: HOSTED_SAMPLE_NOW });
    const branch = nextFor(step, answer === "cannot_reach" ? "any" : answer);
    if (!branch) return null;
    stepId = branch.next_step_id;
    outcomeId = branch.outcome_id;
  }
  return { ...projectWalkthroughView(HVAC_COOLING_PLAYBOOK, stepId, outcomeId), choices: stepId ? allowedAnswers(stepId) : [], diagnosis };
}

export function parseHostedSampleState(raw: string | undefined): HostedSampleState {
  if (!raw || raw.length > 2800) return emptyHostedSampleState();
  try {
    const value = JSON.parse(raw) as HostedSampleState;
    if (!value || value.v !== 1 || typeof value.kept !== "boolean" || !Array.isArray(value.trail) || value.trail.length > 20 ||
        Object.keys(value).some(key => !["v", "trail", "kept"].includes(key)) ||
        value.trail.some(answer => typeof answer !== "string" || answer.length > 120) || !hostedWalkthrough(value.trail)) return emptyHostedSampleState();
    return { v: 1, trail: [...value.trail], kept: value.kept };
  } catch { return emptyHostedSampleState(); }
}

export function buildHostedSample(origin = "https://prn-test-site.vercel.app", state?: HostedSampleState) {
  const base = new URL(origin);
  if (!["http:", "https:"].includes(base.protocol) || base.username || base.password || base.pathname !== "/" || base.search || base.hash) throw new Error("Sample requires one public origin");
  const now = HOSTED_SAMPLE_NOW;
  const requestId = HOSTED_SAMPLE_ID;
  const description = state?.trail.length ? HOSTED_SAMPLE_DESCRIPTION.split(" The filter")[0] : HOSTED_SAMPLE_DESCRIPTION;
  const { problem, evidence } = analyzeProblemFixture({ description, intake_session_id: "is_hosted_sample", problem_family_hint: "hvac", now });
  const playbook = HVAC_COOLING_PLAYBOOK;
  const answers = detectFields(description, playbook.required_fields).map(field => ({ request_id: requestId, ...field, evidence_id: evidence.evidence_id, source: "auto_detected" as const, answered_at: now }));
  const diagnosis = state?.trail.length ? hostedWalkthrough(state.trail)?.diagnosis ?? [] : detectDiagnosis(HOSTED_SAMPLE_DESCRIPTION, playbook).map(item => ({ request_id: requestId, ...item, evidence_id: evidence.evidence_id, answered_at: now }));
  const packet = assemblePacket({ problem, textEvidence: evidence, allEvidence: [evidence], playbook, answers, diagnosis, version: 1, now });
  const journey: Journey = { problem, packet, session: {
    intake_session_id: "is_hosted_sample", schema_version: "1.0.0", guest_session_id: "gs_hosted_sample", request_id: requestId,
    attribution: { page_id: null, intent_cluster_id: null, search_opportunity_id: null, problem_family_hint: "hvac", experiment_id: null, variant: "public_synthetic_demo", referrer: null, landing_path: "/demo/sample" },
    consent_event_ids: [], playbook_id: playbook.playbook_id, entered_at: now, intake_started_at: now,
  } };
  const input = buildDirectionsInput({ journey, playbook, textEvidence: evidence, allEvidence: [evidence], address: { street: "123 Demo Lane (synthetic)", city_state_zip: "Fort Wayne, IN 46802", property_type: "single-family", storeys: "1 storey" }, answers, diagnosis, claims: [], evidence: [evidence], label_reads: [] }, {
    now, link_base: base.origin, home_memory_url: `${base.origin}/demo/sample/keep`, trust_network_url: `${base.origin}/demo/sample/ask`, media_link: null,
  });
  return { requestId, journey, input, answers, diagnosis };
}

export function renderHostedSamplePacket(origin = "https://prn-test-site.vercel.app", state?: HostedSampleState) {
  const sample = buildHostedSample(origin, state);
  const result = renderPacketHtml(sample.input);
  if (!result.self_check.ok || result.halted) throw new Error("Prepared sample packet failed its content checks");
  return { ...result, html: result.html.replace(/(<div class="pglabel[^"]*">)([^<]*)(<\/div>)/g, "$1$2 · Prepared sample$3") };
}
