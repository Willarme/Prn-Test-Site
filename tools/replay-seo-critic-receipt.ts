/** Recompose an existing isolated demo using its real retained critic output.
 * No new provider request, no publication, and the original receipt is retained. */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { applyQaVerdict, runPageQaSync, withCriticStage, type AiCriticStageResult } from "@/domain/search/qa";
import { pageRegistryStore } from "@/platform/search/page-registry-store";
import { publishGate } from "@/platform/search/page-qa-gate";

async function main() {
  const argument = process.argv[2];
  if (!argument) throw new Error("Pass an isolated seo-demo receipt.json path.");
  const receiptPath = path.resolve(argument);
  const allowed = path.resolve("data/runtime") + path.sep;
  if (!receiptPath.startsWith(allowed) || !/^seo-demo-/.test(path.basename(path.dirname(receiptPath)))) {
    throw new Error("Only an isolated local seo-demo directory is accepted.");
  }
  const receipt = JSON.parse(readFileSync(receiptPath, "utf8")) as {
    synthetic: boolean; qa: { results: Array<{ page_spec_id: string; ai_critic: AiCriticStageResult }> };
  };
  if (!receipt.synthetic) throw new Error("Synthetic demo receipt required.");
  process.env.PRN_RUNTIME_STORE = "file";
  process.env.PRN_DEV_DB_PATH = path.join(path.dirname(receiptPath), "dev-db.json");
  const store = pageRegistryStore(() => null);
  const specs = await store.listSpecs();
  const pages = await store.listPages();
  const results = [];
  for (const saved of receipt.qa.results) {
    if (!["PASS", "FAIL"].includes(saved.ai_critic.status)) throw new Error("A completed real critic verdict is required.");
    const spec = specs.find(s => s.page_spec_id === saved.page_spec_id);
    const page = pages.find(p => p.page_id === spec?.page_id);
    if (!spec || !page || page.published_at) throw new Error("Unpublished isolated page required.");
    const qa = withCriticStage(runPageQaSync(spec, { existing: specs }), saved.ai_critic);
    await store.saveStagedPage(applyQaVerdict(spec, qa), { ...page, lifecycle_status: qa.state === "FAIL" ? "APPROVED" : page.lifecycle_status });
    const gate = await publishGate({ page_spec_id: spec.page_spec_id, clientProvider: () => null });
    results.push({ page_spec_id: spec.page_spec_id, original_critic: saved.ai_critic, state: qa.state, overall: qa.overall, release_eligible: gate?.decision.release_eligible, rule_set_version: qa.rule_set_version });
    if (saved.ai_critic.status === "FAIL" && gate?.decision.release_eligible !== false) throw new Error("Critic FAIL was not held.");
  }
  const result = { checked_at: new Date().toISOString(), original_receipt: path.basename(receiptPath), additional_model_calls: 0, published: false, results };
  writeFileSync(path.join(path.dirname(receiptPath), "critic-gate-replay.json"), JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result, null, 2));
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Replay failed"); process.exitCode = 1; });
