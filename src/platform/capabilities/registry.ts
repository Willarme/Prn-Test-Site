import { CapabilityDefinition } from "@/platform/capabilities/contracts";

const V = "0.1.0";

/**
 * Capability registry — Wave 0 registration only. Status meanings here:
 *  TEST            = contract registered, fixture-backed or not yet wired; flips
 *                    to LIVE only at its wave gate with owner approval.
 *  FUTURE_DISABLED = registered so the contract shape is reserved (#22A), but
 *                    execution is impossible in the trial. Tests enforce that
 *                    no FUTURE_DISABLED capability is ever LIVE.
 */
export const CAPABILITY_REGISTRY: readonly CapabilityDefinition[] = [
  // --- Core customer engine (#14A §11.1) — wired in Waves 2/7 ---
  // A00 implementation binding: the deterministic stand-in behind the same
  // contract production A01 will implement. Alias "classify_problem" is the
  // A00-spec name for this same capability.
  /**
   * MODEL WIRING, 2026-08-25. `current_implementation` STAYS "deterministic" —
   * the fixture analyzer is what runs today, is what runs while the flag is off
   * (its shipped state), and is the fallback for every refusal path. The model is
   * registered as an ALTERNATE, which is what it is.
   *
   * `handles_customer_data: true` — this capability's whole input is the
   * homeowner's own words. It is therefore refused on any model whose config does
   * not say `allows_customer_data: true`, BEFORE any network call, and every
   * seeded model ships uncleared. On stealth/ox-alpha this capability cannot run
   * at all, by design.
   */
  { capability_key: "classify_home_problem", version: V, risk_class: "R1", status: "TEST", input_schema_ref: "contracts://problem/ClassifyInput", output_schema_ref: "contracts://problem/ClassifyOutput", required_scopes: ["problem.own.write"], current_implementation: "deterministic", implementation_ref: "analyzeProblemFixture (FixtureProblemAnalyzer) @ src/domain/problem/fixture-engine.ts", owning_agent_ids: ["A01"], aliases: ["classify_problem"], alternate_implementations: [{ kind: "model", ref: "classifyHomeProblemWithModel @ src/platform/problem/ai-classify.ts", enabled_policy_key: "classify_home_problem", handles_customer_data: true, falls_back_to: "analyzeProblemFixture — the deterministic classification, unchanged" }] },
  { capability_key: "create_problem_record", version: V, risk_class: "R2", status: "TEST", input_schema_ref: "contracts://problem/CreateInput", output_schema_ref: "contracts://problem/ProblemRecord", required_scopes: ["problem.own.write"] },
  { capability_key: "add_problem_evidence", version: V, risk_class: "R2", status: "TEST", input_schema_ref: "contracts://problem/EvidenceInput", output_schema_ref: "contracts://problem/EvidenceObject", required_scopes: ["problem.own.write"] },
  /**
   * BINDING FILLED IN, 2026-08-25 — Loop Spec Audit A01 condition 6, verbatim:
   * "register `select_clarifying_questions` as an alias of
   * `select_next_clarifier`, add it to A01's allowed_capabilities, and register
   * the executor." All three land here and in the agent registry and the gateway.
   * Before this, the entry had no owner, no alias and no executor, so every one
   * of the three failure modes the audit predicted was live.
   *
   * The deterministic implementation is NOT new content: it walks the shipped
   * playbook's own `required_fields`, in the order that file already declares,
   * and falls back to the shipped question bank. Nothing about which question a
   * homeowner is asked changed when this was bound.
   *
   * `handles_customer_data: true` — the model sees what the homeowner has
   * already said in order to choose what to ask next.
   */
  { capability_key: "select_next_clarifier", version: V, risk_class: "R1", status: "TEST", input_schema_ref: "contracts://problem/ClarifierInput", output_schema_ref: "contracts://problem/ClarifierOutput", required_scopes: ["problem.own.read"], current_implementation: "deterministic", implementation_ref: "selectNextClarifierDeterministic @ src/domain/problem/clarifier.ts", owning_agent_ids: ["A01"], aliases: ["select_clarifying_questions"], alternate_implementations: [{ kind: "model", ref: "selectNextClarifierWithModel @ src/platform/problem/ai-clarifier.ts", enabled_policy_key: "select_next_clarifier", handles_customer_data: true, falls_back_to: "selectNextClarifierDeterministic — the playbook's own field order, unchanged" }] },
  /**
   * THE RATING-PLATE READER, 2026-09-05 (campaign routine decision 2 —
   * DECISIONS FOR MELISSA decision 1, recommendation B: "one narrow capability
   * that reads a photograph of a metal plate").
   *
   * There is NO deterministic implementation and none is pretended: nothing in
   * this codebase can read printed text off a photo without a model, so
   * `current_implementation` is "model" and `falls_back_to` is the honest
   * answer — the homeowner is asked to type the brand, model and age in the
   * walkthrough, exactly as before this capability existed. A failed, slow,
   * refused or disabled read costs them nothing (media.ts treats the read as a
   * bonus on a photo already stored).
   *
   * `handles_customer_data: true` — the input IS homeowner material (their
   * photograph), so the privacy rule applies in full: refused before any
   * network call unless the model is cleared, and the bytes are passed through
   * platform/media/exif.ts first so location metadata never leaves.
   *
   * R1 for the same reason classify_home_problem is R1: it reads the
   * homeowner's own private data and writes nothing itself; the intake path
   * decides what to do with the answer.
   */
  { capability_key: "read_equipment_label", version: V, risk_class: "R1", status: "TEST", input_schema_ref: "contracts://problem/LabelReadInput", output_schema_ref: "contracts://problem/LabelReadOutput", required_scopes: ["problem.own.read"], current_implementation: "model", implementation_ref: "readEquipmentLabel @ src/platform/problem/ai-label.ts", owning_agent_ids: ["A01"], alternate_implementations: [{ kind: "model", ref: "readEquipmentLabel @ src/platform/problem/ai-label.ts", enabled_policy_key: "read_equipment_label", handles_customer_data: true, falls_back_to: "no read at all — the homeowner types brand, model and age in the walkthrough, exactly as before; a failed or absent read never becomes an error" }] },
  // A00 implementation binding — alias "build_job_packet" is the A00-spec name.
  /**
   * A02 BUILD, 2026-08-25. `current_implementation` STAYS "deterministic" and
   * there is NO alternate: Loop Spec Audit A02 pre-answer 1 rules "do NOT wire
   * one" for the packet path, so unlike classify_home_problem this entry has no
   * model row to carry. The honest ledger figures are cost $0, provider
   * "deterministic-stand-in", model_id null on the packet.
   *
   * The implementation_ref now names BOTH halves of the live path. It used to
   * name only the fixture builder, which is why the richer shipped
   * implementation (assemblePacket, the one the /complete flow actually uses)
   * ran outside the governed door — see the gateway executor note.
   */
  { capability_key: "generate_job_packet", version: V, risk_class: "R2", status: "TEST", input_schema_ref: "contracts://packet/GenerateInput", output_schema_ref: "contracts://packet/JobPacket", required_scopes: ["problem.own.write"], current_implementation: "deterministic", implementation_ref: "generateJobPacket @ src/domain/problem/packet-assembly.ts, dispatching buildJobPacketFixture (FixtureJobPacketBuilder) @ src/domain/problem/fixture-engine.ts and assemblePacket @ src/domain/problem/packet-assembly.ts", owning_agent_ids: ["A02"], aliases: ["build_job_packet"] },
  { capability_key: "get_job_packet", version: V, risk_class: "R1", status: "TEST", input_schema_ref: "contracts://packet/GetInput", output_schema_ref: "contracts://packet/JobPacket", required_scopes: ["problem.own.read"] },
  { capability_key: "create_trust_request", version: V, risk_class: "R3", status: "TEST", input_schema_ref: "contracts://trust/CreateRequestInput", output_schema_ref: "contracts://trust/TrustRequest", required_scopes: ["trust.request.send"] },
  { capability_key: "record_trust_response", version: V, risk_class: "R2", status: "TEST", input_schema_ref: "contracts://trust/ResponseInput", output_schema_ref: "contracts://trust/TrustResponse", required_scopes: [] },
  { capability_key: "save_home_person", version: V, risk_class: "R2", status: "TEST", input_schema_ref: "contracts://trust/HomePersonInput", output_schema_ref: "contracts://trust/HomePerson", required_scopes: ["trust.home_person.write"] },
  { capability_key: "resolve_provider_candidate", version: V, risk_class: "R1", status: "TEST", input_schema_ref: "contracts://providers/ResolveInput", output_schema_ref: "contracts://providers/ProviderEntity", required_scopes: [] },
  { capability_key: "get_provider_recommendation", version: V, risk_class: "R1", status: "TEST", input_schema_ref: "contracts://providers/RecommendInput", output_schema_ref: "contracts://providers/Recommendation", required_scopes: ["provider.recommendation.read"] },
  { capability_key: "show_another_provider", version: V, risk_class: "R1", status: "TEST", input_schema_ref: "contracts://providers/ShowAnotherInput", output_schema_ref: "contracts://providers/Recommendation", required_scopes: ["provider.recommendation.read"] },
  { capability_key: "record_feature_interest", version: V, risk_class: "R2", status: "TEST", input_schema_ref: "contracts://feature-lab/InterestInput", output_schema_ref: "contracts://feature-lab/InterestEvent", required_scopes: [] },
  { capability_key: "get_customer_lite_summary", version: V, risk_class: "R1", status: "TEST", input_schema_ref: "contracts://customer/SummaryInput", output_schema_ref: "contracts://customer/Summary", required_scopes: ["problem.own.read"] },
  { capability_key: "update_notification_preference", version: V, risk_class: "R2", status: "TEST", input_schema_ref: "contracts://customer/NotifyPrefInput", output_schema_ref: "contracts://customer/NotifyPref", required_scopes: ["property.own.write"] },
  { capability_key: "request_export_delete_correction", version: V, risk_class: "R2", status: "TEST", input_schema_ref: "contracts://privacy/DataRequestInput", output_schema_ref: "contracts://privacy/DataRequest", required_scopes: ["problem.own.read"] },
  { capability_key: "derive_public_safe_fact_bundle", version: V, risk_class: "R4", status: "TEST", input_schema_ref: "contracts://privacy/DeriveInput", output_schema_ref: "contracts://search/FactBundle", required_scopes: ["admin.full"] },

  // --- Autonomous SEO / door factory (#23 §8.2) — wired in Door Waves 1-4 ---
  // #14A §11.1's "create/search/update PageSpec workflow capabilities" maps to
  // this refined set: build_candidate_pages (create/update), qa_candidate_pages
  // (review), publish_page (release). Admin PageSpec search is an admin-UI
  // query over the registry, not a separate capability.
  { capability_key: "seo.discover_opportunities", version: V, risk_class: "R0", status: "TEST", input_schema_ref: "contracts://search/DiscoverInput", output_schema_ref: "contracts://search/SearchOpportunity[]", required_scopes: ["agent.internal"] },
  // A00 implementation binding: the real vendor adapter behind a typed seam —
  // alias "get_search_metrics" is the A00-spec name for this capability.
  { capability_key: "seo.refresh_metrics", version: V, risk_class: "R0", status: "TEST", input_schema_ref: "contracts://search/RefreshInput", output_schema_ref: "contracts://search/SeoMetricSnapshot[]", required_scopes: ["agent.internal"], current_implementation: "external_adapter", implementation_ref: "DataForSeoAdapter @ src/platform/adapters/dataforseo.ts", owning_agent_ids: ["A04"], aliases: ["get_search_metrics"] },
  { capability_key: "seo.ingest_search_console", version: V, risk_class: "R0", status: "TEST", input_schema_ref: "contracts://search/IngestInput", output_schema_ref: "contracts://search/PagePerformanceDaily[]", required_scopes: ["agent.internal"] },
  // A05 implementation binding, 2026-08-24 (Loop Spec Audit C8 / pre-answer 8).
  // §11 mandates registering create_page_spec / search_page_spec /
  // update_page_spec as "these exact capability names". The prior decision
  // recorded three lines above already maps those same #14A §11.1 words onto
  // this refined set, and rejects a separate search capability — so the two are
  // reconciled the way A00 reconciled classify_problem/classify_home_problem
  // and get_search_metrics/seo.refresh_metrics: as ALIASES on the existing
  // entry, resolved by resolveCapability(). Verbatim naming satisfied, prior
  // decision kept, zero new keys. `search_page_spec` is deliberately NOT an
  // alias: admin PageSpec search is a UI query over the registry, not a
  // capability, and aliasing it here would resurrect the key the prior decision
  // rejected.
  { capability_key: "seo.build_candidate_pages", version: V, risk_class: "R2", status: "TEST", input_schema_ref: "contracts://search/BuildInput", output_schema_ref: "contracts://search/PageSpec[]", required_scopes: ["agent.internal"], current_implementation: "deterministic", implementation_ref: "runPageFactory @ src/platform/search/page-factory-run.ts (compilePageSpec + content-bank-v1)", owning_agent_ids: ["A05"], aliases: ["create_page_spec", "update_page_spec"] },
  // A06 implementation binding, 2026-08-24 (Loop Spec Audit condition C2).
  // The output contract is updated IN THE SAME CHANGE that grew `QaResult` into
  // `PageQAResult` — the condition is explicit that A06 must "update that
  // capability contract in the same change — never create a second parallel QA
  // result type". `PageQAResult` is that same type grown in place, so this is a
  // rename of the contract ref, not a second contract.
  //
  // Risk stays R0: QA reads a page and returns a verdict. It publishes nothing,
  // and the R4 `seo.publish_page` entry below is still where release risk lives.
  { capability_key: "seo.qa_candidate_pages", version: V, risk_class: "R0", status: "TEST", input_schema_ref: "contracts://search/QaInput", output_schema_ref: "contracts://search/PageQAResult[]", required_scopes: ["agent.internal"], current_implementation: "deterministic", implementation_ref: "qaCandidatePages @ src/domain/search/qa.ts, dispatched through runPageQaBatch @ src/platform/search/page-qa-run.ts", owning_agent_ids: ["A06"] },
  /**
   * REGISTERED 2026-08-25, AND THE PRIOR REFUSAL IS WORTH RECORDING. A05's build
   * deliberately did NOT register this key, with the reason: "registering a model
   * capability nothing implements would be describing unbuilt behaviour as
   * built." That reason has expired — something implements it now — and the entry
   * is honest for the same discipline that kept it out before.
   *
   * IT DOES NOT REPLACE THE CONTENT BANK. `current_implementation: "model"` is
   * accurate for THIS key, but the key is an alternate WRITER inside page
   * building: `seo.build_candidate_pages` still compiles the spec, and its
   * content-bank family text is what ships whenever this is off, refused, or
   * fails a lint. `falls_back_to` names it.
   *
   * `handles_customer_data: false` — a PageSpec carries no customer data by
   * contract ("doors, not brains"), and the brief this capability is shown is
   * approved FactBundles plus the page's own copy.
   *
   * R2, not R4: it writes draft copy into a STAGED spec. Publishing is
   * `seo.publish_page` below and stays where release risk lives.
   */
  { capability_key: "generate_page_copy", version: V, risk_class: "R2", status: "TEST", input_schema_ref: "contracts://search/PageCopyBrief", output_schema_ref: "contracts://search/PageCopyDraft", required_scopes: ["agent.internal"], current_implementation: "model", implementation_ref: "generatePageCopyWithModel @ src/platform/search/ai-page-copy.ts", owning_agent_ids: ["A05"], alternate_implementations: [{ kind: "model", ref: "generatePageCopyWithModel @ src/platform/search/ai-page-copy.ts", enabled_policy_key: "generate_page_copy", handles_customer_data: false, falls_back_to: "the content bank inside compilePageSpec @ src/domain/search/factory.ts — byte-identical to today's pages" }] },
  /**
   * THE SLOT A06 STUBBED, FILLED — 2026-08-25.
   *
   * A06's build left `seo.critique_page` unregistered on the same reasoning A05
   * used, and wrote down exactly what turning the critic on would take: "an owner
   * decision on which model and what it may cost; a capability entry for
   * `seo.critique_page` with a risk class and required scopes; and an executor
   * behind it." The owner made the first decision; this is the second; the third
   * is platform/search/ai-page-critic.ts.
   *
   * WHAT DOES NOT CHANGE. `ai_critic.status` is still SKIPPED_NO_MODEL on every
   * page while the flag is off, because `criticEnabled()` now asks whether the
   * critic is ENABLED, not merely whether a contract exists for it. Registering a
   * capability must not silently start a stage.
   *
   * R0 — the critic reads a page and returns findings. It cannot publish, cannot
   * clear a blocker and cannot set release_eligible.
   */
  { capability_key: "seo.critique_page", version: V, risk_class: "R0", status: "TEST", input_schema_ref: "contracts://search/AiCriticInput", output_schema_ref: "contracts://search/AiCriticOutput", required_scopes: ["agent.internal"], current_implementation: "model", implementation_ref: "modelPageCritic @ src/platform/search/page-qa-critic.ts", owning_agent_ids: ["A06"], alternate_implementations: [{ kind: "model", ref: "modelPageCritic @ src/platform/search/page-qa-critic.ts", enabled_policy_key: "seo.critique_page", handles_customer_data: false, falls_back_to: "NO_MODEL_CRITIC — ai_critic.status SKIPPED_NO_MODEL, which is never treated as a pass" }] },
  { capability_key: "seo.publish_page", version: V, risk_class: "R4", status: "TEST", input_schema_ref: "contracts://search/PublishInput", output_schema_ref: "contracts://search/IntentPage", required_scopes: ["admin.full"] },

  // --- Economics (#23 §8.2) ---
  { capability_key: "economics.record_usage_cost", version: V, risk_class: "R2", status: "TEST", input_schema_ref: "contracts://economics/UsageCostEvent", output_schema_ref: "contracts://economics/UsageCostEvent", required_scopes: ["agent.internal"] },
  { capability_key: "economics.record_revenue", version: V, risk_class: "R2", status: "TEST", input_schema_ref: "contracts://economics/RevenueEvent", output_schema_ref: "contracts://economics/RevenueEvent", required_scopes: ["agent.internal"] },
  { capability_key: "economics.forecast", version: V, risk_class: "R0", status: "TEST", input_schema_ref: "contracts://economics/ForecastInput", output_schema_ref: "contracts://economics/Forecast", required_scopes: ["admin.full"] },

  // --- Monetization (#23 §5) — default OFF, never on private routes ---
  { capability_key: "monetization.render_public_ads", version: V, risk_class: "R4", status: "TEST", input_schema_ref: "contracts://monetization/RenderInput", output_schema_ref: "contracts://monetization/RenderPlan", required_scopes: ["admin.full"] },

  // --- FUTURE_DISABLED (kit scope_states.json) — reserved, never executable in trial ---
  { capability_key: "provider_dispatch", version: V, risk_class: "R5", status: "FUTURE_DISABLED", input_schema_ref: "reserved://future", output_schema_ref: "reserved://future", required_scopes: ["admin.full"] },
  { capability_key: "provider_live_status", version: V, risk_class: "R3", status: "FUTURE_DISABLED", input_schema_ref: "reserved://future", output_schema_ref: "reserved://future", required_scopes: ["admin.full"] },
  { capability_key: "scheduling", version: V, risk_class: "R5", status: "FUTURE_DISABLED", input_schema_ref: "reserved://future", output_schema_ref: "reserved://future", required_scopes: ["admin.full"] },
  { capability_key: "quote_acceptance", version: V, risk_class: "R5", status: "FUTURE_DISABLED", input_schema_ref: "reserved://future", output_schema_ref: "reserved://future", required_scopes: ["admin.full"] },
  { capability_key: "payments", version: V, risk_class: "R5", status: "FUTURE_DISABLED", input_schema_ref: "reserved://future", output_schema_ref: "reserved://future", required_scopes: ["admin.full"] },
  { capability_key: "purchasing", version: V, risk_class: "R5", status: "FUTURE_DISABLED", input_schema_ref: "reserved://future", output_schema_ref: "reserved://future", required_scopes: ["admin.full"] },
  { capability_key: "tool_rental_transaction", version: V, risk_class: "R5", status: "FUTURE_DISABLED", input_schema_ref: "reserved://future", output_schema_ref: "reserved://future", required_scopes: ["admin.full"] },
  { capability_key: "customer_outcome_followup", version: V, risk_class: "R3", status: "FUTURE_DISABLED", input_schema_ref: "reserved://future", output_schema_ref: "reserved://future", required_scopes: ["admin.full"] },
] as const;

/**
 * A00 Capability Registry resolution (spec §3): look a capability up by its
 * canonical key OR any registered A00-spec alias. This is how an agent's
 * identity survives an implementation swap — call sites name the capability,
 * this registry names the current implementation.
 *
 * Wave 0 only DESCRIBES what already exists; no existing call site is
 * rewritten to route through this yet (that is Wave 1's job for A01/A02).
 */
export function resolveCapability(name: string): CapabilityDefinition | null {
  return (
    CAPABILITY_REGISTRY.find(
      (c) => c.capability_key === name || (c.aliases ?? []).includes(name)
    ) ?? null
  );
}
