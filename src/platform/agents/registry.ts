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
    /**
     * MODEL WIRING, 2026-08-25.
     *
     * `select_clarifying_questions` joins the list per Loop Spec Audit A01
     * condition 6, which named all three failures the missing binding caused:
     * the alias resolved to nothing, the capability was not in A01's allowed
     * list, and no executor was registered. All three are closed.
     *
     * BOTH OF A01'S CAPABILITIES HANDLE HOMEOWNER TEXT, so both are governed by
     * the privacy rule in platform/ai/callModel.ts: a model-backed run is refused
     * before any network call unless the model's config says
     * `allows_customer_data: true`, and every seeded model ships uncleared.
     *
     * CONSEQUENCE, STATED PLAINLY: on stealth/ox-alpha — the model the owner is
     * starting on, free because prompts may be retained — A01 CANNOT run on a
     * model at all. It falls back to the deterministic analyzer and says why.
     * A05's and A06's capabilities, which see page copy and never customer text,
     * can be enabled on it today. Clearing a model for customer data is an owner
     * decision (TODO-ASK-OWNER: Joshua + Melissa).
     *
     * ─── THE CANONICAL KEYS JOIN THE ALIASES, 2026-08-25 (finding 1) ────────
     *
     * This list held ONLY aliases. `classify_problem` and
     * `select_clarifying_questions` are the A00-spec spellings; the keys
     * capabilities/registry.ts actually REGISTERS are `classify_home_problem`
     * and `select_next_clarifier`. The gateway's permission check accepts the
     * name the caller passed OR the resolved canonical key, and neither of the
     * canonical keys was here — so a caller doing the correct thing, asking for
     * the registered capability_key, was BLOCKED with "not in A01's allowed
     * list" and a ledger row saying so.
     *
     * This is the SAME class of bug A02 hit and fixed on `generate_job_packet`
     * (see A02's entry below). All four names stay: the aliases are asserted by
     * tests/agents.registry.test.ts and tests/capabilities.registry.test.ts,
     * which keep these two registries one governed system rather than two.
     */
    allowed_capabilities: [
      "classify_problem",
      "classify_home_problem",
      "select_clarifying_questions",
      "select_next_clarifier",
    ],
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
    /**
     * A02 BUILD, 2026-08-25 — the canonical key joins the alias (Loop Spec Audit
     * A02 condition 4).
     *
     * The gateway's permission check accepts either the name the caller passed
     * or the resolved canonical key, and this list held ONLY the alias
     * `build_job_packet`. So a caller doing the correct thing — asking for the
     * registered capability_key `generate_job_packet`, which is what
     * capabilities/registry.ts actually registers — was BLOCKED, with a clean
     * "not in A02's allowed list" refusal and a ledger row saying so. Exactly
     * the failure A01 condition 6 found on select_next_clarifier.
     *
     * Both names stay. The alias is the A00-spec spelling and is asserted by
     * tests/agents.registry.test.ts and tests/capabilities.registry.test.ts;
     * removing it to "tidy up" would break the registry-agreement test that
     * exists to keep these two lists one governed system rather than two.
     *
     * NO MODEL. A02's packet path is 100% deterministic by ruling (pre-answer
     * 1: "do NOT wire one"), so unlike A01 there is no alternate
     * implementation, no customer-data clearance question and no cost ceiling
     * to park — the honest figure is $0 with provider "deterministic-stand-in".
     */
    allowed_capabilities: ["build_job_packet", "generate_job_packet"],
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
    /**
     * A04 BUILD, 2026-08-24.
     *
     * `autonomy_level` stays "TBD" from the TBD spread above (Loop Spec Audit
     * condition 12 and OD-10). A04's spec holds it at L2 and A04 follows that
     * BEHAVIOUR exactly — it discovers, scores and RECOMMENDS, and it cannot
     * publish and now cannot approve either: the accept/reject/defer gate
     * (platform/search/opportunity-decisions.ts) is the owner's, and A04's own
     * recommendation is explicitly not read as one. But canon carries two
     * non-identical autonomy scales and the owners have not picked one, so no
     * L-number is written here ahead of that decision.
     *
     * `allowed_capabilities` is `get_search_metrics` and stays exactly that:
     * A04 makes NO AI/model call anywhere. Its scoring is deterministic Tier-0
     * arithmetic; the one place a model could ever enter is language
     * normalization and internal-language mining, and the mining path ships OFF
     * (C11, policy language_mining.enabled = false).
     *
     * `data_access` / `write_access` are enumerated because the modules exist —
     * observed facts, not a guess.
     *
     * WHAT A04 CAN AND CANNOT WRITE. It writes its own opportunity, snapshot,
     * cost and decision records, and files Approval Center items. It writes
     * NOTHING customer-owned: no problem_record, no evidence_object, no
     * intake_answer, no consent_event, no job_packet. It writes NO page record
     * of any kind and it cannot change publish state — A04's opportunity gate
     * and A06's page publish gate are two separate gates and do not collapse.
     * `search_opportunity` appears in write_access for the pipeline's upserts;
     * `opportunity_decision` is the append-only owner-decision overlay
     * (migration 00011, applied 2026-08-25), deliberately separate so a
     * decision never rewrites the committed factory artifact.
     */
    allowed_capabilities: ["get_search_metrics"],
    data_access: [
      "search_opportunity",
      "opportunity_decision",
      "intent_cluster",
      "seo_metric_snapshot",
      "serp_snapshot",
      "seo_factory_policy",
      "vendor_cost_rate",
      "usage_cost_event",
      "agent_run",
      "agent_run_ledger",
      "approval_item",
      "event_envelope",
    ],
    write_access: [
      "search_opportunity",
      "opportunity_decision",
      "seo_metric_snapshot",
      "serp_snapshot",
      "usage_cost_event",
      "agent_run",
      "agent_run_ledger",
      "approval_item",
    ],
    schedule:
      "on-demand only — npm run factory (portfolio pass) and runDiscoveryOnPlatform (paid pass). NO cron route and no scheduler is wired, deliberately: a schedule would turn a manually-triggered pipeline capped at a vendor trial credit into an unattended spender (Loop Spec Audit pre-answer 2).",
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
    /**
     * A05 BUILD, 2026-08-24.
     *
     * `autonomy_level` stays "TBD" from the TBD spread above (Loop Spec Audit
     * condition 12 and OD-10), for the same reason A04's does: canon carries
     * two non-identical autonomy scales and the owners have not picked one. A05
     * follows the BEHAVIOUR its spec describes — it compiles, stages and
     * regenerates, and it cannot approve an opportunity, cannot pass QA and
     * cannot publish.
     *
     * `allowed_capabilities` WAS `seo.build_candidate_pages` alone, with the
     * note: "A05 makes NO AI/model call anywhere ... `generate_page_copy` exists
     * in the spec as a future capability contract and is deliberately NOT
     * registered — registering a model capability nothing implements would be
     * describing unbuilt behaviour as built."
     *
     * MODEL WIRING, 2026-08-25: that reason has expired, and only that reason.
     * `generate_page_copy` is now implemented, registered and allowed — and
     * DISABLED, like every model-backed capability in this build. While the flag
     * is off, generation is still 100% content-bank and `cost_usd: 0` on every
     * A05 ledger row is still measured rather than a placeholder, because no
     * model call happens. Model-written copy that fails A05's lint or A06's
     * deterministic checks is REJECTED and the content bank is used instead, so
     * no model text can reach the publish path by passing through.
     *
     * `handles_customer_data: false` on the capability: a PageSpec carries no
     * customer data by contract, and the brief the model sees is approved
     * FactBundles plus the page's own copy.
     *
     * WHAT A05 CAN AND CANNOT WRITE. It writes page specs, page registry rows,
     * its ledger rows and its Approval Center items (the template-change Impact
     * Preview). It writes NOTHING customer-owned: no problem_record, no
     * evidence_object, no intake_answer, no consent_event, no job_packet — the
     * intake_context on a PageSpec is attribution travelling INTO the intake,
     * never intake data coming out.
     *
     * IT CANNOT CHANGE PUBLISH STATE, and `published_page` is absent from
     * write_access to say so structurally. A05 sets `qa.state` PENDING at
     * creation and never again (coherence issue 5: A06 is the sole writer of
     * PASS/FAIL); the owner alone owns QA_PASS -> PUBLISHED (lifecycle.ts:6).
     *
     * `search_opportunity` is READ-ONLY here. A05 consumes the owner's decision
     * and never writes one — that is A04's write, and the two gates do not
     * collapse.
     */
    allowed_capabilities: ["seo.build_candidate_pages", "generate_page_copy"],
    data_access: [
      "search_opportunity",
      "opportunity_decision",
      "intent_cluster",
      "seo_factory_policy",
      "fact_bundle",
      "staged_page_spec",
      "intent_page",
      "published_page",
      "agent_run_ledger",
      "approval_item",
      "event_envelope",
    ],
    write_access: [
      "staged_page_spec",
      "intent_page",
      "agent_run_ledger",
      "approval_item",
    ],
    schedule:
      "on-demand only — the owner-gated admin route POST /api/admin/pages/generate and a direct call from A04's approval flow, both idempotent on opportunity_id (Loop Spec Audit C9 / pre-answer 6). NOT wired to the Durable Workflow Orchestrator, which A00 shipped deferred and interface-only; choosing it would make A05 the first implementer of a durable-execution engine. No cron route and no scheduler is wired.",
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
    /**
     * A06 BUILD, 2026-08-24.
     *
     * `autonomy_level` stays "TBD" from the TBD spread above (Loop Spec Audit
     * condition 12 and OD-10), for the same reason A04's and A05's do: canon
     * carries two non-identical autonomy scales and the owners have not picked
     * one. A06 follows the BEHAVIOUR its spec describes — it checks, it records a
     * verdict, and it CANNOT PUBLISH.
     *
     * `allowed_capabilities` WAS `seo.qa_candidate_pages` alone, with the note:
     * "A06 makes NO model call: `seo.critique_page` is deliberately NOT
     * registered anywhere ... registering a model capability nothing implements
     * would be describing unbuilt behaviour as built."
     *
     * MODEL WIRING, 2026-08-25: implemented, registered, allowed — and DISABLED.
     * A06's own build wrote down what turning the critic on would take (an owner
     * decision on model and cost, a capability entry, an executor); all three now
     * exist and the flag is the fourth thing, held off.
     *
     * WHILE THE FLAG IS OFF NOTHING MOVED. `criticEnabled()` now asks whether
     * the critic is ENABLED rather than merely whether a contract exists for it,
     * so `ai_critic.status` is still SKIPPED_NO_MODEL on every page and
     * `cost_usd: 0` on every A06 ledger row is still measured. Registering a
     * capability must not silently start a stage.
     *
     * WHAT THE CRITIC MAY DO WHEN IT IS ON: ADD findings. It cannot clear a
     * blocker, cannot set release_eligible and cannot publish — the fold in
     * qa.ts re-derives the verdict from BOTH stages, so a critic finding can only
     * make a page less releasable, never more.
     *
     * WHAT A06 CAN AND CANNOT WRITE. It writes `qa.state` and `qa.reasons` on a
     * PageSpec — it is the SOLE writer of those two fields (coherence issue 5) —
     * plus the STAGED->QA_PASS / STAGED->APPROVED lifecycle edges on its registry
     * row, its own ledger rows, and the Approval Center items that put a page in
     * the owner's publish queue. It writes NOTHING customer-owned.
     *
     * IT CANNOT PUBLISH, and `published_page` is absent from write_access to say
     * so structurally. A06 produces `release_eligible`; the owner-gated route
     * acts on it. The Approval Center item is the RECORD of the ask, never a
     * second actuator (coherence issue 6).
     *
     * NO WAIVER PATH EXISTS. A hard blocker A06 raises has no override anywhere
     * in this codebase, by decision (pre-answer 8) — which is also why the
     * false-block-rate KPI is uncomputable rather than zero.
     */
    allowed_capabilities: ["seo.qa_candidate_pages", "seo.critique_page"],
    data_access: [
      "staged_page_spec",
      "intent_page",
      "published_page",
      "seo_factory_policy",
      "fact_bundle",
      "search_opportunity",
      "agent_run_ledger",
      "approval_item",
      "event_envelope",
    ],
    write_access: [
      "staged_page_spec",
      "intent_page",
      "agent_run_ledger",
      "approval_item",
    ],
    schedule:
      "on-demand only — runPageQaBatch (platform/search/page-qa-run.ts) called synchronously behind the durable-workflow interface seam (Loop Spec Audit pre-answer 4: 'Run it synchronously for now, behind the durable-workflow interface ... Do not build a job runner as part of A06'). A REFRESH->STAGED page re-enters QA automatically through the same entry point. NOT wired to the Durable Workflow Orchestrator, which A00 shipped deferred and interface-only. No cron route and no scheduler is wired.",
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
    /**
     * A09 BUILD, 2026-08-24.
     *
     * `autonomy_level` stays "TBD" from the TBD spread above (Loop Spec Audit
     * condition 12 and OD-10). The spec header reads L2 detect/prepare, and A09
     * follows that BEHAVIOUR — it detects, quarantines and prepares repairs and
     * executes none without a human — but canon carries two non-identical
     * autonomy scales and the owners have not picked one. OD-10 additionally
     * records that autonomy graduation is a PROCESS gate, not a machine gate,
     * which is precisely why the auto-repair allow-list ships empty rather than
     * why an L-number gets written here.
     *
     * `allowed_capabilities` stays EMPTY and that is a real statement, not a
     * backfill gap: A09 makes no AI/model call anywhere (§3) and calls the
     * gateway for nothing in Wave 0. Cross-source reconciliation against search
     * metrics would go through the registered capability `get_search_metrics`
     * rather than the DataForSEO adapter directly (condition 5) — that sweep is
     * not built in Wave 0, so claiming the capability now would overstate scope.
     *
     * `data_access` / `write_access` are enumerated because the modules exist —
     * observed facts, not a guess.
     *
     * WRITE SCOPE CONTAINS NO CUSTOMER-EVIDENCE TABLE. A09 writes its own four
     * finding/quarantine/repair tables and files Approval Center items; it
     * writes NOTHING else. `problem_record` appears in write_access ONLY because
     * an owner-approved repair rewrites an id ARRAY on it, and only through the
     * two declared kinds — it can never write evidence_object, intake_answer,
     * consent_event, job_packet or published_page, and no repair may touch page
     * publish state (condition 8). The consent ledger is READ-ONLY here,
     * permanently, by rule and by test.
     */
    data_access: [
      "problem_record",
      "job_packet",
      "search_opportunity",
      "page_spec",
      "intake_session",
      "consent_event",
      "event_envelope",
      "agent_run_ledger",
      "approval_item",
      "data_quality_issue",
      "quarantine_marker",
      "repair_proposal",
      "repair_execution",
    ],
    write_access: [
      "data_quality_issue",
      "quarantine_marker",
      "repair_proposal",
      "repair_execution",
      "repair_reversal_snapshot",
      "approval_item",
      // Owner-approved repairs only, id arrays only — see the note above.
      "problem_record",
    ],
    schedule:
      "ingest guard in-request at the store boundary; reconciliation cadence in policy quality.reconciliation_cadence_hours (a plain callable — no cron route and no workflow orchestrator wired in Wave 0)",
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
