import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PageSpec } from "@/domain/search/pages";
import { registryRowFor } from "@/domain/search/page-registry";
import { applyQaVerdict, evaluateReleaseForPublish, qaLifecycleTarget, runPageQa, runPageQaSync, withCriticStage, type AiCriticStageResult } from "@/domain/search/qa";
import { loadStaged } from "@/platform/admin/data";
import { resetApprovalCenterForTests } from "@/platform/approvals/center";
import { resetKillSwitchForTests } from "@/platform/killswitch";
import { resetAgentRunLedgerForTests } from "@/platform/runs/ledger";
import { publishGate, publishQueueSnapshot } from "@/platform/search/page-qa-gate";
import { runPageQaBatch } from "@/platform/search/page-qa-run";
import { pageRegistryStore } from "@/platform/search/page-registry-store";
import { POST as publish } from "@/app/api/admin/pages/publish/route";

const failure: AiCriticStageResult = {
  status: "FAIL", reason: "The page does not answer its specific search intent.",
  findings: [{ check: "intent_match", severity: "major", where: "hero",
    message: "The page repeats a generic process instead of addressing this symptom.",
    repair_instructions: "Add source-backed content specific to the symptom before QA runs again." }],
  provider: "fixture", cost_usd: 0, latency_ms: 1,
};
vi.mock("@/platform/search/page-qa-critic", () => ({
  criticEnabled: async () => true,
  createModelPageCritic: () => ({ id: "fixture", critique: async () => failure }),
}));
vi.mock("@/platform/admin/auth", () => ({ isAdminUnlocked: async () => true }));

const committed = loadStaged().specs[0] as PageSpec;
const originalPath = process.env.PRN_DEV_DB_PATH;
const originalBackend = process.env.PRN_RUNTIME_STORE;
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "prn-critic-release-fixture-"));
  process.env.PRN_DEV_DB_PATH = join(dir, "dev-db.json");
  process.env.PRN_RUNTIME_STORE = "file";
  resetKillSwitchForTests(); resetAgentRunLedgerForTests(); resetApprovalCenterForTests();
});
afterEach(() => {
  if (originalPath === undefined) delete process.env.PRN_DEV_DB_PATH; else process.env.PRN_DEV_DB_PATH = originalPath;
  if (originalBackend === undefined) delete process.env.PRN_RUNTIME_STORE; else process.env.PRN_RUNTIME_STORE = originalBackend;
  rmSync(dir, { recursive: true, force: true });
});

describe("explicit critic FAIL survives every release path", () => {
  it.each(["major", "minor", "none"] as const)("a FAIL with %s findings fails composition without fabricating a blocker", severity => {
    const stage = { ...failure, findings: severity === "none" ? [] : failure.findings.map(f => ({ ...f, severity })) };
    const result = withCriticStage(runPageQaSync(committed, { existing: [] }), stage);
    expect(result.deterministic.state).toBe("PASS");
    expect(result.blockers).toEqual([]);
    expect(result).toMatchObject({ state: "FAIL", overall: "FAIL", release_eligible: false, user_value_score: null });
    expect(result.release_reasons.join(" ")).toContain(failure.reason);
    expect(result.reasons.join(" ")).toContain(failure.reason);
    expect(result.ai_critic.findings).toEqual(stage.findings);
    expect(qaLifecycleTarget("STAGED", result)).toBe("APPROVED");
  });

  it("retains the verdict through the PageSpec schema and synchronous publish recheck", () => {
    const result = withCriticStage(runPageQaSync(committed, { existing: [] }), failure);
    const written = PageSpec.parse(JSON.parse(JSON.stringify(applyQaVerdict(committed, result))));
    expect(written.qa.ai_critic).toEqual(failure);
    const release = evaluateReleaseForPublish(written, { existing: [] });
    expect(release.qa.deterministic.state).toBe("PASS");
    expect(release.qa.ai_critic).toEqual(failure);
    expect(release.release_eligible).toBe(false);
    // Even an inconsistent historical PASS field cannot override preserved FAIL.
    const inconsistent = PageSpec.parse({ ...written, qa: { ...written.qa, state: "PASS" } });
    expect(evaluateReleaseForPublish(inconsistent, { existing: [] }).release_eligible).toBe(false);
  });

  it("a skipped or failed attempt cannot erase an existing failure, but a completed PASS can replace it", async () => {
    const failed = withCriticStage(runPageQaSync(committed, { existing: [] }), failure);
    const spec = applyQaVerdict(committed, failed);
    const skipped = runPageQaSync(spec, { existing: [] });
    expect(skipped.ai_critic.status).toBe("FAIL");
    for (const status of ["NOT_RUN", "SKIPPED_NO_MODEL"] as const) {
      const again = withCriticStage(skipped, { ...failure, status, findings: [], reason: "No completed review in this attempt." });
      expect(again.ai_critic).toEqual(failure);
      expect(again.release_eligible).toBe(false);
    }
    const passed = await runPageQa(spec, { existing: [], critic: { id: "fixture", critique: async () => ({ ...failure, status: "PASS", findings: [], reason: "The revised page answers its intent." }) } });
    expect(passed).toMatchObject({ state: "PASS", overall: "PASS", release_eligible: true });
  });

  it("persists batch FAIL, rebuild lifecycle and an actual HTTP409 without publishing", async () => {
    const pending = PageSpec.parse({
      ...committed,
      page_spec_id: "ps_critic_fail_fixture", page_id: "page_critic_fail_fixture",
      canonical_path: "/problems/fixture-pump-stops-unexpectedly",
      primary_query: "fixture pump stops unexpectedly", title: "Fixture Pump Stops Unexpectedly", h1: "Fixture pump stops unexpectedly",
      intake_context: { ...committed.intake_context, page_id: "page_critic_fail_fixture" },
      qa: { state: "PENDING", reasons: [] },
    });
    const registry = { ...registryRowFor(pending, pending.created_at), lifecycle_status: "STAGED" as const };
    const run = await runPageQaBatch({ specs: [pending], existing: [], registry: [registry], trigger: "admin_action", persist: true }, () => null);
    expect(run.results[0]).toMatchObject({ state: "FAIL", overall: "FAIL", release_eligible: false });
    expect(run.approvals_filed).toEqual([]);
    expect(run.transitions).toContainEqual({ page_id: pending.page_id, from: "STAGED", to: "APPROVED" });
    const store = pageRegistryStore(() => null);
    const saved = (await store.listSpecs()).find(s => s.page_spec_id === pending.page_spec_id)!;
    expect(saved.qa).toMatchObject({ state: "FAIL", ai_critic: failure });
    expect((await store.listPages()).find(p => p.page_id === pending.page_id)?.lifecycle_status).toBe("APPROVED");
    const gate = await publishGate({ page_spec_id: pending.page_spec_id, clientProvider: () => null });
    expect(gate?.decision.qa.deterministic.state, JSON.stringify(gate?.decision.qa.deterministic.findings)).toBe("PASS");
    expect(gate?.decision.release_eligible).toBe(false);
    expect(gate?.decision.qa.ai_critic).toEqual(failure);
    const queued = (await publishQueueSnapshot(() => null)).find(row => row.spec.page_spec_id === pending.page_spec_id);
    expect(queued?.decision.release_eligible).toBe(false);
    const response = await publish(new Request("http://localhost/api/admin/pages/publish", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ page_spec_id: pending.page_spec_id, action: "publish" }),
    }));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "QA must PASS before publishing" });
    expect((await store.listPages()).find(p => p.page_id === pending.page_id)?.published_at).toBeNull();
  });
});
