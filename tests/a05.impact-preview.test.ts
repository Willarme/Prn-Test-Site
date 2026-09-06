import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SearchOpportunity } from "@/domain/search/contracts";
import { buildImpactPreview, diffTemplates } from "@/domain/search/impact-preview";
import { stageNewPage } from "@/domain/search/page-registry";
import { IntentPage, PageSpec } from "@/domain/search/pages";
import { TPL_INTENT_PAGE, TemplateSpec } from "@/domain/search/template";
import { listApprovals, resetApprovalCenterForTests, resolveApproval } from "@/platform/approvals/center";
import { APPROVAL_KINDS } from "@/platform/approvals/kinds";
import { resetAgentRunLedgerForTests } from "@/platform/runs/ledger";
import { resetKillSwitchForTests } from "@/platform/killswitch";
import {
  A05_PROPOSED_APPROVAL_KINDS,
  MassRegenerationBlocked,
  assertTemplateChangeApproved,
  cascadeTemplateChange,
  proposeTemplateChange,
} from "@/platform/search/template-change";

/**
 * A05 step 7 — GUARDRAILS RESTORED (C12). The Impact Preview is (a); the kill
 * switch (b) landed in step 6 and the structured-data discipline (c) in step 5.
 */

const NOW = () => "2026-08-24T00:00:00Z";
let tmp: string;

function opp(overrides: Partial<SearchOpportunity> = {}): SearchOpportunity {
  return {
    search_opportunity_id: "so_tpl_1",
    schema_version: "1.0.0",
    keyword: "ac airflow feels weak",
    intent_cluster_id: null,
    cluster_label: null,
    problem_family_hint: "hvac",
    source: "seed_import",
    geography: { mode: "national", country: "US" },
    geography_assumed: false,
    volume_monthly: 100,
    keyword_difficulty: 10,
    cpc_usd: null,
    intent_type: "problem",
    opportunity_score: 80,
    score_components: null,
    recommendation: "NEW",
    status: "approved",
    metric_snapshot_ids: [],
    serp_snapshot_ids: [],
    provenance: { source_type: "seed", source_url: null, confidence_note: null },
    vendor_cost_usd: null,
    researched_at: null,
    created_at: "2026-08-14T00:00:00Z",
    updated_at: null,
    ...overrides,
  } as unknown as SearchOpportunity;
}

const TPL_V2: TemplateSpec = TemplateSpec.parse({
  ...TPL_INTENT_PAGE,
  version: "2.0.0",
  blocks: [
    TPL_INTENT_PAGE.blocks[0],
    { ...TPL_INTENT_PAGE.blocks[3], default_heading: "When to stop and call someone" },
    TPL_INTENT_PAGE.blocks[1],
    TPL_INTENT_PAGE.blocks[2],
    { slot_id: "blk_faq", kind: "faq", custom_key: null, label: "FAQ", default_heading: "Common questions", required: false },
  ],
  intake_placement: { mode: "after_hero", after_slot_id: null, owner_decided: false },
});

function world() {
  const a = stageNewPage(opp(), { now: NOW });
  const b = stageNewPage(
    opp({ search_opportunity_id: "so_tpl_2", keyword: "furnace not working" }),
    { now: NOW }
  );
  const published = IntentPage.parse({ ...a.page, lifecycle_status: "PUBLISHED", published_at: "2026-08-24T01:00:00Z" });
  return {
    pages: [published, b.page],
    specs: [a.spec, b.spec],
    byId: new Map([
      [a.page.page_id, { page: published, spec: a.spec, opportunity: opp() }],
      [b.page.page_id, { page: b.page, spec: b.spec, opportunity: opp({ search_opportunity_id: "so_tpl_2", keyword: "furnace not working" }) }],
    ]),
  };
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "prn-a05-tpl-"));
  process.env.PRN_DEV_DB_PATH = join(tmp, "dev-db.json");
  resetApprovalCenterForTests();
  resetAgentRunLedgerForTests();
  resetKillSwitchForTests();
});

afterEach(() => {
  delete process.env.PRN_DEV_DB_PATH;
  rmSync(tmp, { recursive: true, force: true });
});

describe("the diff describes what the owner is actually agreeing to", () => {
  it("names added, removed, reordered, retitled and a moved intake box", () => {
    const diff = diffTemplates(TPL_INTENT_PAGE, TPL_V2);
    expect(diff.added_slots).toEqual(["blk_faq"]);
    expect(diff.removed_slots).toEqual(["blk_who"]);
    expect(diff.reordered).toBe(true);
    expect(diff.heading_changes).toEqual([
      { slot_id: "blk_urgency", from: "When this becomes urgent", to: "When to stop and call someone" },
    ]);
    expect(diff.intake_moved).toBe(true);
  });

  it("a version-only bump is still a change, and still says so", () => {
    const bumped = TemplateSpec.parse({ ...TPL_INTENT_PAGE, version: "1.0.1" });
    const preview = buildImpactPreview(TPL_INTENT_PAGE, bumped, [], []);
    expect(preview.summary).toMatch(/changes the version only/);
    expect(preview.requires_owner_approval).toBe(true);
  });
});

describe("the preview counts the blast radius, published pages first", () => {
  it("counts every page whose CURRENT spec came from the template being changed", () => {
    const w = world();
    const preview = buildImpactPreview(TPL_INTENT_PAGE, TPL_V2, w.pages, w.specs);
    expect(preview.counts.total).toBe(2);
    expect(preview.counts.published).toBe(1);
    expect(preview.counts.staged).toBe(1);
    expect(preview.summary).toMatch(/1 of these are live to the public/);
  });

  it("ignores pages built from a different template or a different version", () => {
    const w = world();
    const otherSpecs = w.specs.map((s) => PageSpec.parse({ ...s, template_version: "0.9.0" }));
    expect(buildImpactPreview(TPL_INTENT_PAGE, TPL_V2, w.pages, otherSpecs).counts.total).toBe(0);
  });

  it("says plainly that every regenerated page must pass QA and publish again", () => {
    const w = world();
    const preview = buildImpactPreview(TPL_INTENT_PAGE, TPL_V2, w.pages, w.specs);
    expect(preview.summary).toMatch(/returns to STAGED with qa\.state PENDING/);
  });

  it("carries IDs and counts only — no page copy reaches the owner's queue", async () => {
    const w = world();
    const pending = await proposeTemplateChange(
      { from: TPL_INTENT_PAGE, to: TPL_V2, pages: w.pages, specs: w.specs, requested_by: "owner" },
      () => null
    );
    const evidence = JSON.stringify(pending.approval.evidence);
    expect(evidence).not.toMatch(/heating-and-cooling complaint pattern/);
    expect(evidence).toMatch(/affected_page_ids/);
  });
});

describe("MASS REGENERATION FAILS CLOSED", () => {
  async function pending() {
    const w = world();
    return {
      w,
      pending: await proposeTemplateChange(
        { from: TPL_INTENT_PAGE, to: TPL_V2, pages: w.pages, specs: w.specs, requested_by: "owner" },
        () => null
      ),
    };
  }

  it("proposing files a PENDING item and executes NOTHING", async () => {
    const { pending: p } = await pending();
    expect(p.approval.status).toBe("PENDING");
    const queued = await listApprovals(() => null);
    expect(queued).toHaveLength(1);
    expect(queued[0].agent_id).toBe("A05");
  });

  it("no approval at all: blocked", async () => {
    const { pending: p } = await pending();
    expect(() => assertTemplateChangeApproved(p, null)).toThrow(MassRegenerationBlocked);
    expect(() => assertTemplateChangeApproved(p, null)).toThrow(/Impact Preview must reach the owner/);
  });

  it("still PENDING: blocked", async () => {
    const { pending: p } = await pending();
    expect(() => assertTemplateChangeApproved(p, p.approval)).toThrow(/is PENDING, not APPROVED/);
  });

  it("REJECTED: blocked", async () => {
    const { pending: p } = await pending();
    const rejected = { ...p.approval, status: "REJECTED" as const, resolved_by: "owner" };
    expect(() => assertTemplateChangeApproved(p, rejected)).toThrow(/is REJECTED/);
  });

  it("an APPROVED item for a DIFFERENT preview: blocked", async () => {
    const { pending: p } = await pending();
    const other = { ...p.approval, approval_id: "ap_someone_else", status: "APPROVED" as const, resolved_by: "owner" };
    expect(() => assertTemplateChangeApproved(p, other)).toThrow(/is not the item filed for this preview/);
  });

  it("APPROVED with no resolver: blocked — a decision with no human is not a decision", async () => {
    const { pending: p } = await pending();
    const ghost = { ...p.approval, status: "APPROVED" as const };
    expect(() => assertTemplateChangeApproved(p, ghost)).toThrow(/records no resolver/);
  });

  it("the cascade itself refuses before touching a single page", async () => {
    const { w, pending: p } = await pending();
    await expect(
      cascadeTemplateChange(
        { pending: p, approval: null, resolve: (id) => w.byId.get(id) ?? null, now: NOW },
        () => null
      )
    ).rejects.toThrow(MassRegenerationBlocked);
  });

  it("there is no force flag and no size threshold that skips the owner", async () => {
    const { readFileSync } = await import("node:fs");
    // Comments stripped: the module's header says in words that there is
    // deliberately no "force" parameter, and promising not to build an escape
    // hatch is the opposite of building one.
    const code = readFileSync(join(process.cwd(), "src/platform/search/template-change.ts"), "utf-8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/\bforce\b/i);
    expect(code).not.toMatch(/skip_approval|bypass/i);
  });
});

describe("once the owner says yes, the cascade runs through the ordinary path", () => {
  it("regenerates every affected page, each with its own guards", async () => {
    const w = world();
    const p = await proposeTemplateChange(
      { from: TPL_INTENT_PAGE, to: TPL_V2, pages: w.pages, specs: w.specs, requested_by: "owner" },
      () => null
    );
    const approved = await resolveApproval(
      p.approval.approval_id,
      { status: "APPROVED", resolved_by: "owner" },
      () => null
    );
    const result = await cascadeTemplateChange(
      { pending: p, approval: approved, resolve: (id) => w.byId.get(id) ?? null, now: NOW },
      () => null
    );
    expect(result.regenerated).toHaveLength(2);
    expect(result.failed).toEqual([]);
  });

  it("reports a page it could not resolve rather than skipping it silently", async () => {
    const w = world();
    const p = await proposeTemplateChange(
      { from: TPL_INTENT_PAGE, to: TPL_V2, pages: w.pages, specs: w.specs, requested_by: "owner" },
      () => null
    );
    const approved = await resolveApproval(
      p.approval.approval_id,
      { status: "APPROVED", resolved_by: "owner" },
      () => null
    );
    const result = await cascadeTemplateChange(
      { pending: p, approval: approved, resolve: () => null, now: NOW },
      () => null
    );
    expect(result.regenerated).toEqual([]);
    expect(result.failed).toHaveLength(2);
    expect(result.failed[0].reason).toMatch(/could not resolve/);
  });
});

describe("A05 mints no approval kind either (issue 14 discipline)", () => {
  it("the taxonomy carries no template-change member, so the item is filed without one", async () => {
    expect(APPROVAL_KINDS).not.toContain("seo.page_template_change");
    const w = world();
    const p = await proposeTemplateChange(
      { from: TPL_INTENT_PAGE, to: TPL_V2, pages: w.pages, specs: w.specs, requested_by: "owner" },
      () => null
    );
    expect(p.approval.approval_kind).toBeUndefined();
    // ...and the class is still legible to the owner.
    expect(p.approval.what_happened).toMatch(/^TEMPLATE CHANGE/);
  });

  it("the proposal to A08 is in the codebase, not only in a build report", () => {
    expect(A05_PROPOSED_APPROVAL_KINDS[0].proposed_kind).toBe("seo.page_template_change");
    expect(A05_PROPOSED_APPROVAL_KINDS[0].why.length).toBeGreaterThan(40);
  });
});
