import type { JobPacket, ProblemRecord } from "@/domain/problem/contracts";
import type { ConsentEvent } from "@/domain/privacy/contracts";
import type { SearchOpportunity } from "@/domain/search/contracts";
import type { EventEnvelope } from "@/platform/events/envelope";

/**
 * A09 rule fixtures — the CLEAN baselines every invariant test starts from.
 *
 * §9 step 1 requires each rule to prove two things: that a deliberately-broken
 * record is caught, and that a clean one is not falsely flagged. A shared clean
 * baseline is what makes the second half honest — each broken fixture is this
 * exact record with ONE field damaged, so a rule that fires can only be firing
 * on the damage.
 *
 * Every value here is synthetic. No customer text, no real ids, no evidence.
 */

const AT = "2026-08-24T12:00:00Z";

export function cleanProblemRecord(overrides: Partial<ProblemRecord> = {}): ProblemRecord {
  return {
    problem_id: "pr_clean_0001",
    schema_version: "1.0.0",
    status: "packet_ready",
    source_channel: "web",
    intake_session_id: "is_clean_0001",
    problem_summary: "fixture summary",
    service_category: "hvac",
    service_category_confidence: "medium",
    safety_state: "normal",
    safety_rule_id: null,
    evidence_ids: ["ev_clean_0001"],
    claim_ids: [],
    clarifiers_asked: [],
    created_at: AT,
    updated_at: AT,
    ...overrides,
  };
}

export function cleanJobPacket(overrides: Partial<JobPacket> = {}): JobPacket {
  return {
    job_packet_id: "jp_clean_0001",
    packet_version: 1,
    schema_version: "1.0.0",
    problem_id: "pr_clean_0001",
    summary_plain: "fixture packet",
    observed_statements: [],
    symptoms_and_timing: null,
    likely_service_category: {
      value: "hvac",
      confidence: "medium",
      note: "This is an inference from the description, not a diagnosis.",
    },
    what_remains_unknown: [],
    safe_prep_notes: [],
    questions_for_provider: [],
    call_script: "fixture script",
    collected_details: [],
    media_count: 0,
    diagnosis: null,
    generated_at: AT,
    engine: "fixture",
    ...overrides,
  };
}

export function cleanSearchOpportunity(
  overrides: Partial<SearchOpportunity> = {}
): SearchOpportunity {
  return {
    search_opportunity_id: "so_clean_0001",
    schema_version: "1.0.0",
    keyword: "fixture keyword",
    intent_cluster_id: null,
    cluster_label: null,
    problem_family_hint: null,
    source: "seed_import",
    geography: { mode: "national", country: "US" },
    geography_assumed: true,
    volume_monthly: null,
    keyword_difficulty: null,
    cpc_usd: null,
    intent_type: "problem",
    opportunity_score: null,
    score_components: null,
    recommendation: null,
    status: "candidate",
    metric_snapshot_ids: [],
    serp_snapshot_ids: [],
    provenance: { source_type: "fixture", source_url: null, confidence_note: null },
    vendor_cost_usd: null,
    researched_at: null,
    created_at: AT,
    updated_at: null,
    ...overrides,
  };
}

export function cleanConsentEvent(overrides: Partial<ConsentEvent> = {}): ConsentEvent {
  return {
    consent_event_id: "ce_clean_0001",
    person_id: null,
    guest_session_id: "gs_clean_0001",
    problem_id: "pr_clean_0001",
    scope: "intake",
    action: "GRANT",
    disclosure_version_id: "dv_clean_0001",
    surface: "/start",
    trace_id: null,
    occurred_at: AT,
    ...overrides,
  };
}

export function cleanEventEnvelope(overrides: Partial<EventEnvelope> = {}): EventEnvelope {
  return {
    event_id: "ev_clean_0001",
    tenant_id: "prn",
    event_name: "problem.created",
    event_version: 1,
    occurred_at: AT,
    actor: { actor_type: "agent", actor_id: "A01" },
    guest_session_id: null,
    context: { problem_id: "pr_clean_0001" },
    source: { channel: "agent", referrer: null, landing_path: null },
    versions: { schema: "1.0.0" },
    result: { status: "ok", duration_ms: null, cost_usd: null },
    privacy_class: "internal",
    trace_id: null,
    agent_run_id: null,
    action_request_id: null,
    ...overrides,
  };
}
