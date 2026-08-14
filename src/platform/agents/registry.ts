import { AgentDefinition } from "@/platform/agents/contracts";

/**
 * Canonical trial agent registry — #14A §12 is the authority; #20 owns
 * canonical identity. The Build Kit's reference/agent_registry_trial.json
 * omits A12/A13 (kit defect, documented in docs/canon/DECISIONS.md); the kit
 * copy is preserved unmodified and THIS registry is canonical in code.
 * Tests assert this list is a superset of the kit JSON.
 */
export const TRIAL_AGENT_REGISTRY: readonly AgentDefinition[] = [
  {
    agent_id: "A01",
    name: "Customer Problem Intelligence",
    stage: "LIVE",
    mandate:
      "Turns text/voice/photos/page context into a versioned ProblemRecord; selects minimal clarifiers; separates supplied facts from inference; safety-gate aware.",
  },
  {
    agent_id: "A02",
    name: "Customer Value / Job Packet",
    stage: "LIVE",
    mandate:
      "Builds JobPacket JSON/HTML/PDF/private share. No overstatement; logs evidence basis and version.",
  },
  {
    agent_id: "A03",
    name: "SmartQuote Intelligence",
    stage: "TEST_ONLY",
    mandate: "Runtime disabled in trial. QuoteRecord schema/events reserved; fake-door page only.",
  },
  {
    agent_id: "A04",
    name: "Search Opportunity",
    stage: "LIVE",
    mandate:
      "Autonomous discovery via SeoDataAdapter (DataForSEO) + Search Console feedback; normalizes, clusters, scores; detects overlap/cannibalization; recommends NEW/EXPAND/MERGE/WATCH/REJECT. Cannot publish.",
  },
  {
    agent_id: "A05",
    name: "Intent-Door Page Factory",
    stage: "LIVE",
    mandate:
      "Compiles approved SearchOpportunities into typed PageSpecs rendered by the one shared template. Never one-off page codebases; never consent language; never A01/A02 logic.",
  },
  {
    agent_id: "A06",
    name: "Page Quality & Release",
    stage: "LIVE",
    mandate:
      "Independent QA: cheap deterministic checks first, AI critic second. Factual/provenance/intent/accessibility/performance/schema/privacy. Human publish gate.",
  },
  {
    agent_id: "A07",
    name: "Company Health & Bottleneck",
    stage: "LIVE",
    mandate:
      "Owner cockpit: demand, useful outcomes, trust, page/fake-door pull, data quality, cost/economics, exceptions, current bottleneck.",
  },
  {
    agent_id: "A08",
    name: "Metric & Event Steward",
    stage: "LIVE",
    mandate:
      "Owns canonical event/metric names, versions, definitions. Blocks silent denominator/name drift.",
  },
  {
    agent_id: "A09",
    name: "Data Quality & Reconciliation",
    stage: "LIVE",
    mandate:
      "Ingest/nightly invariants, missing links, duplicates/impossible states, schema drift; quarantine, never drop.",
  },
  {
    agent_id: "A10",
    name: "Lean / 80:20",
    stage: "LIVE",
    mandate:
      "Protects the Black-Car/one-person constraint; recommends CUT/COMBINE/POSTPONE/AUTOMATE while protecting the data moat.",
  },
  {
    agent_id: "A12",
    name: "Property Memory",
    stage: "INTERFACE_DATA_NOW",
    mandate:
      "Stable person/household/property IDs + Customer Lite shell now; full longitudinal memory agent later.",
  },
  {
    agent_id: "A13",
    name: "Search Portfolio/Lifecycle",
    stage: "FIELDS_NOW",
    mandate:
      "Lifecycle/status/redirect lineage fields now; autonomous refresh/retire later after performance data.",
  },
  {
    agent_id: "A14",
    name: "Trust Intake",
    stage: "LIVE",
    mandate:
      "Normalizes referral responses into TrustEdge + provider entity candidates with provenance; never invents identity.",
  },
  {
    agent_id: "A15",
    name: "Trust Integrity & Freshness",
    stage: "LITE_LIVE",
    mandate:
      "Deterministic duplicate/conflict/stale checks + reversible merge review. No elaborate graph anomaly model yet.",
  },
  {
    agent_id: "A16",
    name: "Trust Network Intelligence / Coverage",
    stage: "LATER",
    mandate:
      "Coverage intelligence once enough trust data exists. Owner Decision D-1: NOT the rejected customer outcome follow-up, which is a deferred feature, not an agent.",
  },
  {
    agent_id: "A25",
    name: "Strategic Intelligence / Post-App Horizon Watch",
    stage: "MINIMAL_LIVE",
    mandate:
      "Official-source TransitionSignal registry + small WATCH/TEST/BUILD recommendations. Cannot change production by itself.",
  },
  {
    agent_id: "A27",
    name: "Experiment & Evaluation",
    stage: "HARNESS_NOW",
    mandate:
      "Shared eval/gold/adversarial/privacy/contract harness used by every wave; full autonomous experimentation later.",
  },
  {
    agent_id: "A36",
    name: "AI-Native Readiness & Interface Steward",
    stage: "SKELETON_LIVE",
    mandate:
      "Deploy/nightly/weekly checks for UI-only logic, schema/tool/auth/provenance regressions; recommends/prepares fixes; no broad prod auto-changes.",
  },
] as const;
