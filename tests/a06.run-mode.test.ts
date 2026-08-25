import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SAMPLE_PAGE_SPEC } from "@/domain/search/fixtures/sample-page-spec";
import { IntentPage, PageSpec } from "@/domain/search/pages";
import { SeoFactoryPolicy, TRIAL_DEFAULT_SEO_FACTORY_POLICY } from "@/domain/search/policy";
import { registryRowFor } from "@/domain/search/page-registry";
import { loadStaged } from "@/platform/admin/data";
import { listApprovals, resetApprovalCenterForTests } from "@/platform/approvals/center";
import { resolveCapability } from "@/platform/capabilities/registry";
import { TRIAL_AGENT_REGISTRY } from "@/platform/agents/registry";
import {
  engageKillSwitch,
  releaseKillSwitch,
  resetKillSwitchForTests,
} from "@/platform/killswitch";
import { recentAgentRuns, resetAgentRunLedgerForTests } from "@/platform/runs/ledger";
import { runPageQaBatch } from "@/platform/search/page-qa-run";

/**
 * A06 STEP 6 — QA RUN MODE (pre-answer 4, conditions C6 and C8).
 *
 * Synchronous, behind the durable-workflow interface SEAM (not its import),
 * through the AI/Tool Gateway, with one ledger row per batch, tenant-aware
 * config, a kill-switch check and an injectable client provider.
 */

beforeAll(async () => {
  const dir = await mkdtemp(join(tmpdir(), "prn-a06-run-"));
  process.env.PRN_DEV_DB_PATH = join(dir, "dev-db.json");
});

afterAll(() => {
  delete process.env.PRN_DEV_DB_PATH;
});

beforeEach(() => {
  resetKillSwitchForTests();
  resetAgentRunLedgerForTests();
  resetApprovalCenterForTests();
});

const COMMITTED = loadStaged().specs as PageSpec[];
const PORTFOLIO = [SAMPLE_PAGE_SPEC, ...COMMITTED];
const REGISTRY: IntentPage[] = PORTFOLIO.map((s) => registryRowFor(s, s.created_at));

/** No database in tests: the injectable provider is the seam, and it returns null. */
const noDb = () => null;

function pendingCopy(spec: PageSpec): PageSpec {
  return PageSpec.parse({ ...spec, qa: { state: "PENDING", reasons: [] } });
}

describe("the run is routed through the AI/Tool Gateway (condition C6)", () => {
  it("A06's capability is registered to A06 and its contract names the grown type", () => {
    const capability = resolveCapability("seo.qa_candidate_pages")!;
    expect(capability.owning_agent_ids).toEqual(["A06"]);
    expect(capability.output_schema_ref).toBe("contracts://search/PageQAResult[]");
    expect(capability.current_implementation).toBe("deterministic");
    expect(capability.implementation_ref).toMatch(/qa\.ts/);
    // Still TEST — no wave gate was moved by this build.
    expect(capability.status).toBe("TEST");
  });

  it("the Agent Registry lists it back — one governed system, not two lists", () => {
    const a06 = TRIAL_AGENT_REGISTRY.find((a) => a.agent_id === "A06")!;
    expect(a06.allowed_capabilities).toEqual(["seo.qa_candidate_pages", "seo.critique_page"]);
    // A06 cannot publish, and write_access says so structurally.
    expect(a06.write_access).not.toContain("published_page");
    expect(a06.write_access).toContain("staged_page_spec");
  });

  it("a run produces verdicts for every page it was handed", async () => {
    const run = await runPageQaBatch(
      { specs: COMMITTED, existing: [], registry: REGISTRY, trigger: "admin_action", persist: false },
      noDb
    );
    expect(run.halted).toBeNull();
    expect(run.results).toHaveLength(COMMITTED.length);
    expect(run.results.every((r) => r.state === "PASS")).toBe(true);
  });
});

describe("the kill switch is a hard stop, before any work", () => {
  it("a paused A06 returns a typed halted result and checks nothing", async () => {
    await engageKillSwitch(
      { scope: "AGENT", scope_ref: "A06", by: "test", reason: "paused for the test" },
      noDb
    );
    const run = await runPageQaBatch(
      { specs: COMMITTED, registry: REGISTRY, trigger: "admin_action", persist: false },
      noDb
    );
    expect(run.halted).toEqual({ scope: "AGENT", reason: "paused for the test" });
    expect(run.results).toEqual([]);
    expect(run.events).toEqual([]);
  });

  it("release resumes normal operation", async () => {
    await engageKillSwitch({ scope: "AGENT", scope_ref: "A06", by: "test" }, noDb);
    await releaseKillSwitch({ scope: "AGENT", scope_ref: "A06", by: "test" }, noDb);
    const run = await runPageQaBatch(
      { specs: COMMITTED, registry: REGISTRY, trigger: "admin_action", persist: false },
      noDb
    );
    expect(run.halted).toBeNull();
    expect(run.results).toHaveLength(COMMITTED.length);
  });

  it("a GLOBAL pause stops A06 too", async () => {
    await engageKillSwitch({ scope: "GLOBAL", by: "test", reason: "everything off" }, noDb);
    const run = await runPageQaBatch(
      { specs: COMMITTED, registry: REGISTRY, trigger: "admin_action", persist: false },
      noDb
    );
    expect(run.halted?.scope).toBe("GLOBAL");
  });
});

describe("one ledger row per QA BATCH, carrying the census", () => {
  it("writes exactly one A06 batch row, whatever the batch size", async () => {
    await runPageQaBatch(
      { specs: COMMITTED, registry: REGISTRY, trigger: "admin_action", persist: false },
      noDb
    );
    const a06Rows = recentAgentRuns().filter(
      (r) => r.agent_id === "A06" && (r.outputs_summary as { checked?: number })?.checked !== undefined
    );
    expect(a06Rows).toHaveLength(1);
    const summary = a06Rows[0].outputs_summary as Record<string, unknown>;
    expect(summary.checked).toBe(COMMITTED.length);
    expect(summary.passed).toBe(COMMITTED.length);
    expect(summary.failed).toBe(0);
    expect(summary.release_eligible).toBe(COMMITTED.length);
    expect(summary.blocked_pending_ai).toBe(COMMITTED.length);
    expect(summary.ai_critic_status).toBe("SKIPPED_NO_MODEL");
  });

  it("cost_usd is 0 and that is MEASURED — A06 makes no model call", async () => {
    await runPageQaBatch(
      { specs: [COMMITTED[0]], registry: REGISTRY, trigger: "job", persist: false },
      noDb
    );
    for (const row of recentAgentRuns().filter((r) => r.agent_id === "A06")) {
      expect(row.cost_usd).toBe(0);
      expect(row.tool_model_version).toBeUndefined();
    }
  });

  it("the gateway's own capability row is separate from A06's batch row", async () => {
    await runPageQaBatch(
      { specs: [COMMITTED[0]], registry: REGISTRY, trigger: "job", persist: false },
      noDb
    );
    const rows = recentAgentRuns().filter((r) => r.agent_id === "A06");
    // One records that the governed door was used; one records what came out.
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.some((r) => r.capabilities_used.includes("seo.qa_candidate_pages"))).toBe(true);
  });
});

describe("tenant-aware config resolves from the runtime policy document (C8)", () => {
  it("A06's sub-block is namespaced on SeoFactoryPolicy and defaults to its own values", () => {
    expect(TRIAL_DEFAULT_SEO_FACTORY_POLICY.page_qa.min_heuristic_score).toBe(60);
    expect(TRIAL_DEFAULT_SEO_FACTORY_POLICY.page_qa.thin_content_min_chars).toBe(600);
    expect(TRIAL_DEFAULT_SEO_FACTORY_POLICY.page_qa.structured_data_allowed_types).toEqual([]);
  });

  it("the COMMITTED policy file still parses with the new sub-block — nothing shipped stops loading", () => {
    const file = JSON.parse(
      readFileSync(join(process.cwd(), "data", "seo-factory-policy.json"), "utf-8")
    );
    const parsed = SeoFactoryPolicy.parse(file);
    expect(parsed.page_qa.blocker_checks.length).toBeGreaterThan(10);
  });

  it("a tenant raising the value bar changes the run's verdicts with no code deploy", async () => {
    const strict = SeoFactoryPolicy.parse({
      ...TRIAL_DEFAULT_SEO_FACTORY_POLICY,
      page_qa: { ...TRIAL_DEFAULT_SEO_FACTORY_POLICY.page_qa, min_heuristic_score: 99 },
    });
    const run = await runPageQaBatch(
      {
        specs: COMMITTED,
        registry: REGISTRY,
        policy: strict,
        trigger: "admin_action",
        persist: false,
      },
      noDb
    );
    expect(run.results.every((r) => r.state === "FAIL")).toBe(true);
    expect(run.results[0].reasons.join(" ")).toMatch(/heuristic user_value_score/);
  });

  it("the human gate is read from the policy, and eligibility fails closed when it opens", async () => {
    const graduated = SeoFactoryPolicy.parse({
      ...TRIAL_DEFAULT_SEO_FACTORY_POLICY,
      autonomy_stage: "T2",
      publish_mode: "LOW_RISK_AUTO",
    });
    const run = await runPageQaBatch(
      {
        specs: [COMMITTED[0]],
        registry: REGISTRY,
        policy: graduated,
        trigger: "admin_action",
        persist: false,
      },
      noDb
    );
    expect(run.results[0].state).toBe("PASS");
    expect(run.results[0].release_eligible).toBe(false);
    expect(run.results[0].release_reasons.join(" ")).toMatch(/human publish gate is not intact/);
    // Nothing was filed for the owner's queue either — there is no queue to file into.
    expect(run.approvals_filed).toEqual([]);
  });

  it("tenant_id travels onto every result (C7)", async () => {
    const run = await runPageQaBatch(
      {
        specs: [COMMITTED[0]],
        registry: REGISTRY,
        tenant_id: "acme",
        trigger: "admin_action",
        persist: false,
      },
      noDb
    );
    expect(run.results[0].tenant_id).toBe("acme");
  });
});

describe("the owner's publish queue — a record, filed under A08's kind", () => {
  it("an eligible page files one seo.page_publish item carrying IDs and counts only", async () => {
    const run = await runPageQaBatch(
      {
        specs: [COMMITTED[0]],
        registry: REGISTRY,
        trigger: "admin_action",
        persist: false,
      },
      noDb
    );
    expect(run.approvals_filed).toHaveLength(1);

    const items = await listApprovals(noDb);
    const item = items.find((i) => i.approval_id === run.approvals_filed[0])!;
    expect(item.agent_id).toBe("A06");
    expect(item.approval_kind).toBe("seo.page_publish");
    expect(item.status).toBe("PENDING");
    expect(item.reversibility).toBe("reversible");
    // The queue row visibly carries the skipped-critic status (pre-answer 1.1).
    expect((item.evidence as { ai_critic_status: string }).ai_critic_status).toBe("SKIPPED_NO_MODEL");
    expect(item.recommendation).toMatch(/nothing has read this page for meaning/);

    // NO PAGE COPY in the evidence — IDs, counts and labels only.
    const serialized = JSON.stringify(item.evidence);
    expect(serialized).not.toContain(COMMITTED[0].content_blocks[0].body_md.slice(0, 40));
    expect(serialized).not.toContain(COMMITTED[0].h1);
  });

  it("a FAILING page files nothing — the queue is for pages ready for a decision", async () => {
    const broken = PageSpec.parse({ ...COMMITTED[0], source_fact_bundle_ids: [] });
    const run = await runPageQaBatch(
      { specs: [broken], registry: REGISTRY, trigger: "admin_action", persist: false },
      noDb
    );
    expect(run.results[0].state).toBe("FAIL");
    expect(run.approvals_filed).toEqual([]);
  });
});

describe("the lifecycle edges A06 owns (coherence issue 13)", () => {
  it("a STAGED page that passes moves to QA_PASS, through the shipped guards", async () => {
    const staged = REGISTRY.filter((p) => p.page_id === COMMITTED[0].page_id);
    const run = await runPageQaBatch(
      {
        specs: [pendingCopy(COMMITTED[0])],
        registry: staged,
        trigger: "admin_action",
        persist: false,
      },
      noDb
    );
    expect(run.transitions).toEqual([
      { page_id: COMMITTED[0].page_id, from: "STAGED", to: "QA_PASS" },
    ]);
  });

  it("a STAGED page that fails goes back to APPROVED for a rebuild, never to PUBLISHED", async () => {
    const broken = PageSpec.parse({ ...COMMITTED[0], source_fact_bundle_ids: [] });
    const staged = REGISTRY.filter((p) => p.page_id === COMMITTED[0].page_id);
    const run = await runPageQaBatch(
      { specs: [broken], registry: staged, trigger: "admin_action", persist: false },
      noDb
    );
    expect(run.transitions).toEqual([
      { page_id: COMMITTED[0].page_id, from: "STAGED", to: "APPROVED" },
    ]);
    expect(run.transitions.some((t) => t.to === "PUBLISHED")).toBe(false);
  });

  it("a PUBLISHED page gets no transition — QA is a fact about a STAGED page", async () => {
    const published = [
      IntentPage.parse({
        ...REGISTRY.find((p) => p.page_id === COMMITTED[0].page_id)!,
        lifecycle_status: "PUBLISHED",
        published_at: "2026-08-24T00:00:00Z",
      }),
    ];
    const run = await runPageQaBatch(
      { specs: [COMMITTED[0]], registry: published, trigger: "admin_action", persist: false },
      noDb
    );
    expect(run.transitions).toEqual([]);
  });
});

describe("the durable-workflow seam is a SHAPE, not an import (pre-answer 4)", () => {
  it("A06 does not import the deferred orchestrator — it would become its first implementer", () => {
    for (const module of [
      "src/platform/search/page-qa-run.ts",
      "src/platform/search/page-qa-gate.ts",
      "src/domain/search/qa.ts",
    ]) {
      const source = readFileSync(join(process.cwd(), module), "utf-8");
      expect(source, module).not.toMatch(/from\s+["']@\/platform\/workflows\/orchestrator["']/);
    }
  });

  it("and it builds no job runner — no cron route, no scheduler, on-demand only", () => {
    const a06 = TRIAL_AGENT_REGISTRY.find((a) => a.agent_id === "A06")!;
    expect(a06.schedule).toMatch(/on-demand only/);
    expect(a06.schedule).toMatch(/No cron route and no scheduler is wired/);
  });

  it("every A06 data path accepts an injectable client provider (RLS seam, C6)", () => {
    for (const module of [
      "src/platform/search/page-qa-run.ts",
      "src/platform/search/page-qa-gate.ts",
      "src/platform/search/page-qa-events.ts",
    ]) {
      const source = readFileSync(join(process.cwd(), module), "utf-8");
      expect(source, module).toMatch(/PlatformClientProvider/);
      // It must not reach for the service client's internals directly.
      expect(source, module).not.toMatch(/createClient\(/);
    }
  });
});
