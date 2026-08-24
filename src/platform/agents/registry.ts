import { AgentDefinition } from "@/platform/agents/contracts";

/**
 * Canonical trial agent registry — #14A §12 is the authority; #20 owns
 * canonical identity. The Build Kit's reference/agent_registry_trial.json
 * omits A12/A13 (kit defect, documented in docs/canon/DECISIONS.md); the kit
 * copy is preserved unmodified and THIS registry is canonical in code.
 * Tests assert this list is a superset of the kit JSON.
 *
 * A00 (Shared Agent Platform, Wave 0) extended this schema in place per the
 * approved spec (§9 step 1, approval 2026-08-24):
 *  - the old `stage` field is MIGRATED to `status` — same values, new name —
 *    so canon's phase bands could land on a new `phase_band` field without
 *    colliding (see contracts.ts for the full migration note);
 *  - `phase_band` mirrors each agent's architecture-prompt frontmatter
 *    `phase` (prn-vault/Project/03 Build/Agent Architecture Prompts). A36 has
 *    no architecture-prompt document, so its band is "TBD", not a guess;
 *  - `autonomy_level` is "TBD" on every agent: canon carries two
 *    non-identical autonomy scales (A0–A5 vs the L-ladder — see contracts.ts)
 *    and the owners have not yet picked one;
 *  - `policy_version` is "TBD" — no per-agent policy exists yet;
 *  - `purpose` mirrors `mandate` until owners author distinct one-liners;
 *    `mandate` stays for existing readers;
 *  - `owner_layer` is "TBD" — the spec's customer/acquisition/owner-ops
 *    taxonomy is proposed, not canon, so nothing is assigned yet;
 *  - `data_access` / `write_access` ship EMPTY meaning "not yet enumerated"
 *    (TBD pending owner backfill), NOT "no access";
 *  - `budgets` ship empty: no canon-approved figures exist, and any future
 *    dollar figure must be TEST-labeled (hard canon rule 4);
 *  - `allowed_capabilities` lists only spec-documented bindings (A00 §3:
 *    classify_problem→A01, build_job_packet→A02, get_search_metrics→A04);
 *  - `kill_switch_ref` follows the platform convention "agent:<agent_id>"
 *    resolved by src/platform/killswitch.
 */

/** Shared TBD backfill defaults (A00 Wave 0) — see the header note. */
const TBD = {
  owner_layer: "TBD",
  autonomy_level: "TBD",
  policy_version: "TBD",
  allowed_capabilities: [] as string[],
  data_access: [] as string[],
  write_access: [] as string[],
  budgets: {},
} as const;

function killRef(agentId: string): string {
  return `agent:${agentId}`;
}

export const TRIAL_AGENT_REGISTRY: readonly AgentDefinition[] = [
  {
    agent_id: "A01",
    name: "Customer Problem Intelligence",
    status: "LIVE",
    mandate:
      "Turns text/voice/photos/page context into a versioned ProblemRecord; selects minimal clarifiers; separates supplied facts from inference; safety-gate aware.",
    purpose:
      "Turns text/voice/photos/page context into a versioned ProblemRecord; selects minimal clarifiers; separates supplied facts from inference; safety-gate aware.",
    phase_band: "TRIAL",
    ...TBD,
    allowed_capabilities: ["classify_problem"],
    schedule: "in-request",
    kill_switch_ref: killRef("A01"),
  },
  {
    agent_id: "A02",
    name: "Customer Value / Job Packet",
    status: "LIVE",
    mandate:
      "Builds JobPacket JSON/HTML/PDF/private share. No overstatement; logs evidence basis and version.",
    purpose:
      "Builds JobPacket JSON/HTML/PDF/private share. No overstatement; logs evidence basis and version.",
    phase_band: "TRIAL",
    ...TBD,
    allowed_capabilities: ["build_job_packet"],
    schedule: "in-request",
    kill_switch_ref: killRef("A02"),
  },
  {
    agent_id: "A03",
    name: "SmartQuote Intelligence",
    status: "TEST_ONLY",
    mandate: "Runtime disabled in trial. QuoteRecord schema/events reserved; fake-door page only.",
    purpose: "Runtime disabled in trial. QuoteRecord schema/events reserved; fake-door page only.",
    phase_band: "TRIAL",
    ...TBD,
    kill_switch_ref: killRef("A03"),
  },
  {
    agent_id: "A04",
    name: "Search Opportunity",
    status: "LIVE",
    mandate:
      "Autonomous discovery via SeoDataAdapter (DataForSEO) + Search Console feedback; normalizes, clusters, scores; detects overlap/cannibalization; recommends NEW/EXPAND/MERGE/WATCH/REJECT. Cannot publish.",
    purpose:
      "Autonomous discovery via SeoDataAdapter (DataForSEO) + Search Console feedback; normalizes, clusters, scores; detects overlap/cannibalization; recommends NEW/EXPAND/MERGE/WATCH/REJECT. Cannot publish.",
    phase_band: "TRIAL",
    ...TBD,
    allowed_capabilities: ["get_search_metrics"],
    kill_switch_ref: killRef("A04"),
  },
  {
    agent_id: "A05",
    name: "Intent-Door Page Factory",
    status: "LIVE",
    mandate:
      "Compiles approved SearchOpportunities into typed PageSpecs rendered by the one shared template. Never one-off page codebases; never consent language; never A01/A02 logic.",
    purpose:
      "Compiles approved SearchOpportunities into typed PageSpecs rendered by the one shared template. Never one-off page codebases; never consent language; never A01/A02 logic.",
    phase_band: "TRIAL",
    ...TBD,
    kill_switch_ref: killRef("A05"),
  },
  {
    agent_id: "A06",
    name: "Page Quality & Release",
    status: "LIVE",
    mandate:
      "Independent QA: cheap deterministic checks first, AI critic second. Factual/provenance/intent/accessibility/performance/schema/privacy. Human publish gate.",
    purpose:
      "Independent QA: cheap deterministic checks first, AI critic second. Factual/provenance/intent/accessibility/performance/schema/privacy. Human publish gate.",
    phase_band: "TRIAL",
    ...TBD,
    kill_switch_ref: killRef("A06"),
  },
  {
    agent_id: "A07",
    name: "Company Health & Bottleneck",
    status: "LIVE",
    mandate:
      "Owner cockpit: demand, useful outcomes, trust, page/fake-door pull, data quality, cost/economics, exceptions, current bottleneck.",
    purpose:
      "Owner cockpit: demand, useful outcomes, trust, page/fake-door pull, data quality, cost/economics, exceptions, current bottleneck.",
    phase_band: "TRIAL",
    ...TBD,
    kill_switch_ref: killRef("A07"),
  },
  {
    agent_id: "A08",
    name: "Metric & Event Steward",
    status: "LIVE",
    mandate:
      "Owns canonical event/metric names, versions, definitions. Blocks silent denominator/name drift.",
    purpose:
      "Owns canonical event/metric names, versions, definitions. Blocks silent denominator/name drift.",
    phase_band: "TRIAL",
    ...TBD,
    /**
     * A08 BUILD, 2026-08-24. `autonomy_level` deliberately stays "TBD" from the
     * TBD spread above (Loop Spec Audit condition 12): §3/§7/§11 treat "L1-L2"
     * as settled, but canon carries two non-identical scales and the owners
     * have not picked one. A08 follows the L1-L2 BEHAVIOUR — auto-validate a
     * clean new definition, always route a change to a human — without writing
     * an L-level into this field ahead of that decision.
     *
     * `allowed_capabilities` stays EMPTY and that is a real statement here, not
     * a backfill gap: A08 must NEVER call the AI/Tool Gateway inline in the
     * emit-and-validate path (§3/§7), and no offline model-assisted capability
     * is built. Every A08 job is deterministic string/schema work.
     *
     * `data_access` / `write_access` are enumerated because A08's modules
     * exist — these are observed facts, not a guess. The event_envelope read is
     * the Stage F audit's, and it selects event_name/occurred_at/trace_id only,
     * never joining to any customer-evidence table (condition 14).
     */
    data_access: [
      "event_definition",
      "metric_definition",
      "event_envelope",
      "agent_run_ledger",
      "approval_item",
    ],
    write_access: ["event_definition", "metric_definition", "approval_item"],
    schedule: "scheduled dictionary audit — cadence in policy events.dictionary_audit_cadence_hours (no cron route wired in Wave 0)",
    kill_switch_ref: killRef("A08"),
  },
  {
    agent_id: "A09",
    name: "Data Quality & Reconciliation",
    status: "LIVE",
    mandate:
      "Ingest/nightly invariants, missing links, duplicates/impossible states, schema drift; quarantine, never drop.",
    purpose:
      "Ingest/nightly invariants, missing links, duplicates/impossible states, schema drift; quarantine, never drop.",
    phase_band: "TRIAL",
    ...TBD,
    kill_switch_ref: killRef("A09"),
  },
  {
    agent_id: "A10",
    name: "Lean / 80:20",
    status: "LIVE",
    mandate:
      "Protects the Black-Car/one-person constraint; recommends CUT/COMBINE/POSTPONE/AUTOMATE while protecting the data moat.",
    purpose:
      "Protects the Black-Car/one-person constraint; recommends CUT/COMBINE/POSTPONE/AUTOMATE while protecting the data moat.",
    phase_band: "TRIAL",
    ...TBD,
    kill_switch_ref: killRef("A10"),
  },
  {
    agent_id: "A12",
    name: "Property Memory",
    status: "INTERFACE_DATA_NOW",
    mandate:
      "Stable person/household/property IDs + Customer Lite shell now; full longitudinal memory agent later.",
    purpose:
      "Stable person/household/property IDs + Customer Lite shell now; full longitudinal memory agent later.",
    phase_band: "PHASE2",
    ...TBD,
    kill_switch_ref: killRef("A12"),
  },
  {
    agent_id: "A13",
    name: "Search Portfolio/Lifecycle",
    status: "FIELDS_NOW",
    mandate:
      "Lifecycle/status/redirect lineage fields now; autonomous refresh/retire later after performance data.",
    purpose:
      "Lifecycle/status/redirect lineage fields now; autonomous refresh/retire later after performance data.",
    phase_band: "PHASE2",
    ...TBD,
    kill_switch_ref: killRef("A13"),
  },
  {
    agent_id: "A14",
    name: "Trust Intake",
    status: "LIVE",
    mandate:
      "Normalizes referral responses into TrustEdge + provider entity candidates with provenance; never invents identity.",
    purpose:
      "Normalizes referral responses into TrustEdge + provider entity candidates with provenance; never invents identity.",
    phase_band: "PHASE2",
    ...TBD,
    kill_switch_ref: killRef("A14"),
  },
  {
    agent_id: "A15",
    name: "Trust Integrity & Freshness",
    status: "LITE_LIVE",
    mandate:
      "Deterministic duplicate/conflict/stale checks + reversible merge review. No elaborate graph anomaly model yet.",
    purpose:
      "Deterministic duplicate/conflict/stale checks + reversible merge review. No elaborate graph anomaly model yet.",
    phase_band: "PHASE2",
    ...TBD,
    kill_switch_ref: killRef("A15"),
  },
  {
    agent_id: "A16",
    name: "Trust Network Intelligence / Coverage",
    status: "LATER",
    mandate:
      "Coverage intelligence once enough trust data exists. Owner Decision D-1: NOT the rejected customer outcome follow-up, which is a deferred feature, not an agent.",
    purpose:
      "Coverage intelligence once enough trust data exists. Owner Decision D-1: NOT the rejected customer outcome follow-up, which is a deferred feature, not an agent.",
    phase_band: "PHASE2",
    ...TBD,
    kill_switch_ref: killRef("A16"),
  },
  {
    agent_id: "A25",
    name: "Strategic Intelligence / Post-App Horizon Watch",
    status: "MINIMAL_LIVE",
    mandate:
      "Official-source TransitionSignal registry + small WATCH/TEST/BUILD recommendations. Cannot change production by itself.",
    purpose:
      "Official-source TransitionSignal registry + small WATCH/TEST/BUILD recommendations. Cannot change production by itself.",
    phase_band: "PHASE2",
    ...TBD,
    kill_switch_ref: killRef("A25"),
  },
  {
    agent_id: "A27",
    name: "Experiment & Evaluation",
    status: "HARNESS_NOW",
    mandate:
      "Shared eval/gold/adversarial/privacy/contract harness used by every wave; full autonomous experimentation later.",
    purpose:
      "Shared eval/gold/adversarial/privacy/contract harness used by every wave; full autonomous experimentation later.",
    phase_band: "PHASE2",
    ...TBD,
    kill_switch_ref: killRef("A27"),
  },
  {
    agent_id: "A36",
    name: "AI-Native Readiness & Interface Steward",
    status: "SKELETON_LIVE",
    mandate:
      "Deploy/nightly/weekly checks for UI-only logic, schema/tool/auth/provenance regressions; recommends/prepares fixes; no broad prod auto-changes.",
    purpose:
      "Deploy/nightly/weekly checks for UI-only logic, schema/tool/auth/provenance regressions; recommends/prepares fixes; no broad prod auto-changes.",
    // No architecture-prompt document exists for A36, so its band has no
    // source to mirror — TBD, pending owner assignment (never a guess).
    phase_band: "TBD",
    ...TBD,
    kill_switch_ref: killRef("A36"),
  },
] as const;
