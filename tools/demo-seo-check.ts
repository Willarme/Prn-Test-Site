/** Explicit synthetic A05 -> A06 check. Existing local policy and spend limits apply.
 * Does not publish, invent search metrics, or alter the approved AC template. */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SearchOpportunity } from "@/domain/search/contracts";
import { runPageFactory } from "@/platform/search/page-factory-run";
import { runPageQaBatch } from "@/platform/search/page-qa-run";
import { pageRegistryStore } from "@/platform/search/page-registry-store";
import { recentAgentRuns } from "@/platform/runs/ledger";

interface SeoDemoEvidence {
  factory: { staged: number; copy_runs?: readonly { engine: string }[] };
  qa: { results: readonly { state: string; overall: string; release_eligible: boolean; ai_critic: { status: string } }[] } | null;
  repeat: { staged: number; copy_runs?: readonly unknown[] };
}

/** A critic's PASS alone is not evidence that the complete release gate passed. */
export function seoDemoPassed(report: SeoDemoEvidence): boolean {
  const qa = report.qa?.results;
  return report.factory.staged === 1 && report.factory.copy_runs?.length === 1 &&
    report.factory.copy_runs[0].engine === "model" && qa?.length === 1 &&
    qa[0].ai_critic.status === "PASS" && qa[0].state === "PASS" &&
    qa[0].overall === "PASS" && qa[0].release_eligible === true &&
    report.repeat.staged === 0 && (report.repeat.copy_runs?.length ?? 0) === 0;
}

async function main() {
  if (process.argv[2] !== "--live") throw new Error("Pass --live for the two governed model calls.");
  try { process.loadEnvFile(path.join(process.cwd(), ".env.local")); } catch { /* Shell environment may supply the key. */ }
  if (!process.env.OPENROUTER_API_KEY) throw new Error("Local OpenRouter credential is unavailable.");
  const started = new Date().toISOString();
  const root = path.join(process.cwd(), "data/runtime", `seo-demo-${started.replace(/[:.]/g, "-")}`);
  mkdirSync(root, { recursive: true });
  process.env.PRN_RUNTIME_STORE = "file";
  process.env.PRN_DEV_DB_PATH = path.join(root, "dev-db.json");
  process.env.PRN_EMAIL_MODE = "preview";
  const opportunity = SearchOpportunity.parse({
    search_opportunity_id: "so_synthetic_demo_a05", schema_version: "1.0.0",
    keyword: "ac blowing warm air", intent_cluster_id: null, cluster_label: null,
    problem_family_hint: "hvac", source: "seed_import", geography: { mode: "national", country: "US" },
    geography_assumed: false, volume_monthly: null, keyword_difficulty: null, cpc_usd: null,
    intent_type: "problem", opportunity_score: null, score_components: null,
    recommendation: "NEW", status: "approved", approved_by: "synthetic-fixture-not-human-ruling",
    metric_snapshot_ids: [], serp_snapshot_ids: [],
    provenance: { source_type: "synthetic_demo", source_url: null, confidence_note: "Isolated fixture exercising an already-authorized local demo; no measured search demand or publication approval." },
    vendor_cost_usd: null, researched_at: null, created_at: started, updated_at: null,
  });
  const input = { opportunities: [opportunity], existingPages: [], existingSpecs: [], maxPages: 1, trigger: "admin_action" as const };
  const built = await runPageFactory(input, () => null);
  const specs = await pageRegistryStore(() => null).listSpecs();
  const pages = await pageRegistryStore(() => null).listPages();
  const qa = specs.length ? await runPageQaBatch({ specs, existing: specs, registry: pages, trigger: "admin_action", persist: true }, () => null) : null;
  const repeated = await runPageFactory({ ...input, existingPages: pages, existingSpecs: specs }, () => null);
  const report = {
    started_at: started, completed_at: new Date().toISOString(), synthetic: true,
    source: "Existing approved content bank; search metrics remain unknown. This checks the current typed PageSpec pipeline, not completion of the v43 SEO-template migration.",
    published: false, database: "isolated local file store", existing_budget_unchanged: true,
    factory: { run_id: built.run_id, staged: built.staged.length, skipped: built.skipped, copy_runs: built.copy_runs },
    qa: qa && { run_id: qa.run_id, results: qa.results, transitions: qa.transitions },
    repeat: { staged: repeated.staged.length, skipped: repeated.skipped.map(s => s.reason), copy_runs: repeated.copy_runs },
    model_runs: recentAgentRuns().filter(r => (r.capabilities_used.includes("generate_page_copy") || r.capabilities_used.includes("seo.critique_page")) && !r.capabilities_used.includes("seo.build_candidate_pages")).map(r => ({
      run_id: r.run_id, agent_id: r.agent_id, model: r.tool_model_version, provider: r.tool_provider, cost_usd: r.cost_usd ?? null,
      latency_ms: r.latency_ms ?? null, errors: r.errors ?? [],
    })),
  };
  const destination = path.join(root, "receipt.json");
  writeFileSync(destination, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ receipt: destination, ...report }, null, 2));
  if (!seoDemoPassed(report)) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { console.error("Synthetic SEO verification did not complete; no publication was attempted."); process.exitCode = 1; });
}
