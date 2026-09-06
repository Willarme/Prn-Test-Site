/** Offline, synthetic A05 -> rendered v43 -> A06 -> live publication gate.
 * Uses a new local file store; never publishes, sends or requests a model. */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { SearchOpportunity } from "@/domain/search/contracts";
import { runPageFactory } from "@/platform/search/page-factory-run";
import { runPageQaBatch } from "@/platform/search/page-qa-run";
import { publishGate } from "@/platform/search/page-qa-gate";
import { pageRegistryStore } from "@/platform/search/page-registry-store";
import { renderV43DoorPage } from "@/platform/pages/v43-door-renderer";
import { DEFAULT_AI_POLICY } from "@/platform/ai/policy";
import { recentAgentRuns } from "@/platform/runs/ledger";

async function main() {
  const stamp = new Date().toISOString();
  const directory = path.resolve("data/runtime", "v43-integration-" + stamp.replace(/[:.]/g, "-"));
  mkdirSync(directory, { recursive: true });
  process.env.PRN_RUNTIME_STORE = "file";
  process.env.PRN_DEV_DB_PATH = path.join(directory, "dev-db.json");
  const opportunity = SearchOpportunity.parse({
    search_opportunity_id: "so_v43_integration", schema_version: "1.0.0", keyword: "ac blowing warm air",
    intent_cluster_id: null, cluster_label: null, problem_family_hint: "hvac", source: "seed_import",
    geography: { mode: "national", country: "US" }, geography_assumed: false,
    volume_monthly: null, keyword_difficulty: null, cpc_usd: null, intent_type: "problem",
    opportunity_score: null, score_components: null, recommendation: "NEW", status: "approved",
    approved_by: "synthetic-fixture-not-human-ruling", metric_snapshot_ids: [], serp_snapshot_ids: [],
    provenance: { source_type: "synthetic_integration", source_url: null, confidence_note: "Local integration fixture; no measured demand or publication authority." },
    vendor_cost_usd: null, researched_at: null, created_at: stamp, updated_at: null,
  });
  const input = { opportunities: [opportunity], existingPages: [], existingSpecs: [], maxPages: 1,
    trigger: "admin_action" as const, aiDeps: { policy: DEFAULT_AI_POLICY } };
  const factory = await runPageFactory(input, () => null);
  const created = factory.staged[0];
  if (!created?.spec.door_template || factory.staged.length !== 1 || factory.copy_runs?.length) throw new Error("Frozen v43 did not stage without a writer call.");
  writeFileSync(path.join(directory, "page-template.html"), renderV43DoorPage(created.spec, "http://127.0.0.1:3291"));
  const store = pageRegistryStore(() => null);
  const specs = await store.listSpecs();
  const pages = await store.listPages();
  // Current mandatory source/runtime/activation checks block deterministically,
  // before the critic. This tool must never fabricate missing receipts.
  const qa = await runPageQaBatch({ specs, existing: specs, registry: pages, trigger: "admin_action", persist: true }, () => null);
  const gate = await publishGate({ page_spec_id: created.spec.page_spec_id, clientProvider: () => null });
  const repeat = await runPageFactory({ ...input, existingPages: await store.listPages(), existingSpecs: await store.listSpecs() }, () => null);
  const calls = recentAgentRuns().filter(r => r.capabilities_used.includes("generate_page_copy") || r.capabilities_used.includes("seo.critique_page"));
  if (qa.results.length !== 1 || qa.results[0].state !== "FAIL" || gate?.spec.template_id !== "door-v43" ||
      gate.spec.page_spec_id !== created.spec.page_spec_id || gate.decision.release_eligible !== false || repeat.staged.length !== 0 || calls.length !== 0) {
    throw new Error("The complete frozen-template integration did not retain its required release boundary.");
  }
  const report = {
    checked_at: stamp, synthetic: true, model_calls: calls.length, published: false,
    scope: "Local v43 integration; production readiness remains blocked by the listed evidence requirements.",
    factory: { staged: factory.staged.length, template_id: created.spec.template_id, section_count: created.spec.door_template.section_order.length,
      source_count: created.spec.door_template.source_bindings.length, capability_count: created.spec.door_template.capability_questions.length,
      rendered_sha256: created.spec.door_template.rendered_sha256, copy_runs: factory.copy_runs },
    qa_result: { state: qa.results[0].state, rule_set_version: qa.results[0].rule_set_version,
      blockers: qa.results[0].blockers, reasons: gate.decision.reasons },
    release_eligible: gate.decision.release_eligible, repeated_run_staged: repeat.staged.length,
    preview_path: "/staged-template/" + created.spec.page_spec_id,
  };
  writeFileSync(path.join(directory, "receipt.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ directory, ...report }, null, 2));
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Integration check failed"); process.exitCode = 1; });
