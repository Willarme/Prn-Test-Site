import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SearchOpportunity } from "@/domain/search/contracts";
import { compilePageSpec } from "@/domain/search/factory";
import {
  OWNER_EDITABLE_FIELDS,
  applyOwnerEdit,
  registryRowFor,
  stageNewPage,
} from "@/domain/search/page-registry";
import { PageSpec } from "@/domain/search/pages";
import { resetApprovalCenterForTests } from "@/platform/approvals/center";
import { resetAgentRunLedgerForTests } from "@/platform/runs/ledger";
import { resetKillSwitchForTests } from "@/platform/killswitch";
import { editStagedPage } from "@/platform/search/page-factory-run";
import { pageRegistryStore } from "@/platform/search/page-registry-store";
import { decideOpportunity } from "@/platform/search/opportunity-decisions";
import { SAMPLE_PAGE_SPEC } from "@/domain/search/fixtures/sample-page-spec";

/**
 * A05 steps 6 and 9 — the two RUN-MODE TRIGGERS (C9 / pre-answer 6) and the
 * owner's view/edit of a staged page's unique fields (done-when).
 */

const NOW = () => "2026-08-24T00:00:00Z";
let tmp: string;

function opp(overrides: Partial<SearchOpportunity> = {}): SearchOpportunity {
  return {
    search_opportunity_id: "so_trigger",
    schema_version: "1.0.0",
    keyword: "washing machine wont drain",
    intent_cluster_id: null,
    cluster_label: null,
    problem_family_hint: "plumbing",
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
    status: "candidate",
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

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "prn-a05-run-"));
  process.env.PRN_DEV_DB_PATH = join(tmp, "dev-db.json");
  resetApprovalCenterForTests();
  resetAgentRunLedgerForTests();
  resetKillSwitchForTests();
});

afterEach(() => {
  delete process.env.PRN_DEV_DB_PATH;
  rmSync(tmp, { recursive: true, force: true });
});

describe("TRIGGER 2 — a direct call from A04's approval flow", () => {
  it("accepting an opportunity builds its page, staged and QA-pending", async () => {
    const result = await decideOpportunity(
      { opportunity: opp(), kind: "accept", decided_by: "owner" },
      () => null
    );
    expect(result.opportunity.status).toBe("approved");
    expect(result.page_build).not.toBeNull();
    expect(result.page_build!.staged).toHaveLength(1);

    const pages = await pageRegistryStore(() => null).listPages();
    expect(pages).toHaveLength(1);
    expect(pages[0].lifecycle_status).toBe("STAGED");
    expect(pages[0].published_at).toBeNull();
  });

  it("is IDEMPOTENT on opportunity_id — accepting twice makes one page", async () => {
    await decideOpportunity({ opportunity: opp(), kind: "accept", decided_by: "owner" }, () => null);
    const second = await decideOpportunity(
      { opportunity: opp(), kind: "accept", decided_by: "owner" },
      () => null
    );
    expect(second.page_build!.staged).toHaveLength(0);
    expect(second.page_build!.skipped).toBe(1);
    expect(await pageRegistryStore(() => null).listPages()).toHaveLength(1);
  });

  it("reject and defer build NOTHING", async () => {
    for (const kind of ["reject", "defer"] as const) {
      const result = await decideOpportunity(
        { opportunity: opp(), kind, decided_by: "owner" },
        () => null
      );
      expect(result.page_build, kind).toBeNull();
    }
    expect(await pageRegistryStore(() => null).listPages()).toHaveLength(0);
  });

  it("the decision survives a factory failure — fail-soft downstream of a fail-loud write", async () => {
    // A keyword that cannot compile a valid spec still leaves the decision.
    const result = await decideOpportunity(
      { opportunity: opp({ keyword: " " as unknown as string }), kind: "accept", decided_by: "owner" },
      () => null
    );
    expect(result.opportunity.status).toBe("approved");
  });

  it("build_page: false records the decision without building", async () => {
    const result = await decideOpportunity(
      { opportunity: opp(), kind: "accept", decided_by: "owner", build_page: false },
      () => null
    );
    expect(result.page_build).toBeNull();
    expect(await pageRegistryStore(() => null).listPages()).toHaveLength(0);
  });
});

describe("TRIGGER 1 — the admin route is owner-gated and cannot publish", () => {
  const route = readFileSync(
    join(process.cwd(), "src/app/api/admin/pages/generate/route.ts"),
    "utf-8"
  );

  it("checks the owner session before anything else", () => {
    expect(route).toMatch(/isAdminUnlocked\(\)/);
    expect(route).toMatch(/Owner sign-in required/);
  });

  it("only ever hands the run owner-approved opportunities", () => {
    expect(route).toMatch(/effectiveStatus\(o, decisions\) === "approved"/);
  });

  it("contains no publish call of any kind", () => {
    expect(route).not.toMatch(/setPublished|published_page|qa\.state\s*=/);
  });

  it("returns reasons and counts, never page copy or scoring internals", () => {
    expect(route).toMatch(/skipped_detail/);
    expect(route).not.toMatch(/opportunity_score|score_components/);
  });

  it("surfaces the kill switch as a refusal, not a silent no-op", () => {
    expect(route).toMatch(/kill switch/);
    expect(route).toMatch(/status: 409/);
  });
});

describe("the owner's edit of a staged page's unique fields", () => {
  it("edits exactly the five per-page unique fields", () => {
    expect([...OWNER_EDITABLE_FIELDS]).toEqual([
      "title",
      "meta_description",
      "h1",
      "hero_headline",
      "hero_subheadline",
    ]);
  });

  it("produces a NEW VERSION at QA PENDING rather than mutating the old one", async () => {
    const { page, spec } = stageNewPage(opp({ status: "approved" }), { now: NOW });
    const result = await editStagedPage(
      {
        page,
        previousSpec: spec,
        edit: { title: "Washing Machine Won't Drain: What to Check" },
        edited_by: "owner",
        now: NOW,
      },
      () => null
    );
    expect(result.blocked).toEqual([]);
    expect(result.edited_fields).toEqual(["title"]);
    expect(result.spec!.version).toBe(spec.version + 1);
    expect(result.spec!.page_spec_id).not.toBe(spec.page_spec_id);
    expect(result.spec!.qa.state).toBe("PENDING");
    // The previous version object is untouched.
    expect(spec.title).not.toBe(result.spec!.title);
    expect(spec.version).toBe(1);
  });

  /**
   * The reason versioning is the right shape rather than tidiness: editing a
   * PASSED page in place would leave A06's verdict attached to text it was
   * never about, and the publish route gates on exactly that field.
   */
  it("a PASSED page cannot carry its verdict forward through an edit", () => {
    const { page, spec } = stageNewPage(opp({ status: "approved" }), { now: NOW });
    const passed = { ...spec, qa: { state: "PASS" as const, reasons: [] }, user_value_score: 91 };
    const result = applyOwnerEdit(page, passed, { h1: "New heading" }, { now: NOW }, "owner");
    expect(result.spec.qa.state).toBe("PENDING");
    expect(result.spec.user_value_score).toBeNull();
  });

  it("records that the OWNER wrote the text, not the content bank", () => {
    const { page, spec } = stageNewPage(opp({ status: "approved" }), { now: NOW });
    const result = applyOwnerEdit(page, spec, { h1: "New heading" }, { now: NOW }, "owner");
    expect(result.spec.generation.model).toBeNull();
    expect(result.spec.generation.prompt_id).toBe("owner_edit:owner");
  });

  it("THE LINT RUNS ON THE OWNER'S TEXT TOO — a blocked edit changes nothing", async () => {
    const { page, spec } = stageNewPage(opp({ status: "approved" }), { now: NOW });
    const before = await pageRegistryStore(() => null).listSpecs();
    const result = await editStagedPage(
      {
        page,
        previousSpec: spec,
        edit: { meta_description: "Compare providers and choose from hundreds of contractors." },
        edited_by: "owner",
        now: NOW,
      },
      () => null
    );
    expect(result.spec).toBeNull();
    expect(result.blocked[0].check).toBe("no_directory_framing");
    expect(await pageRegistryStore(() => null).listSpecs()).toEqual(before);
  });

  it("a spec that predates the registry table gets a row rather than failing", () => {
    const row = registryRowFor(SAMPLE_PAGE_SPEC, "2026-08-24T00:00:00Z");
    expect(row.page_id).toBe(SAMPLE_PAGE_SPEC.page_id);
    expect(row.current_page_spec_id).toBe(SAMPLE_PAGE_SPEC.page_spec_id);
    expect(row.canonical_path).toBe(SAMPLE_PAGE_SPEC.canonical_path);
  });

  it("an unchanged field is not reported as edited", () => {
    const { page, spec } = stageNewPage(opp({ status: "approved" }), { now: NOW });
    const result = applyOwnerEdit(page, spec, { title: spec.title }, { now: NOW }, "owner");
    expect(result.edited_fields).toEqual([]);
  });
});

/**
 * C16 — no PageSpec internal reaches a "use client" component. The edit surface
 * is the first thing in this codebase that renders per-page fields into a form,
 * so it is the first real chance to break that rule.
 */
describe("the edit surface is server-side only (C16)", () => {
  function walk(dir: string): string[] {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) out.push(...walk(full));
      else if (/\.(ts|tsx)$/.test(name)) out.push(full);
    }
    return out;
  }

  it("the edit page is not a client component and imports none", () => {
    const source = readFileSync(
      join(process.cwd(), "src/app/admin/pages/[page_spec_id]/page.tsx"),
      "utf-8"
    );
    expect(source.slice(0, 200)).not.toMatch(/^\s*["']use client["']/);
    // A plain HTML form posting to an API route — no client component at all.
    expect(source).toMatch(/<form method="post" action="\/api\/admin\/pages\/edit"/);
  });

  it("no client component anywhere names a PageSpec internal", () => {
    const clientFiles = walk(join(process.cwd(), "src")).filter((f) =>
      /^\s*["']use client["']/.test(readFileSync(f, "utf-8").slice(0, 200))
    );
    expect(clientFiles.length).toBeGreaterThan(0);
    for (const file of clientFiles) {
      const content = readFileSync(file, "utf-8");
      // NOT `search_opportunity_id`: A04's OpportunityDecision.tsx sends one
      // to the decide route, and A04's own boundary test states the rule it is
      // following — "a client component gets an ID and a status STRING.
      // Anything richer is a leak." An identifier is the allowed half; the leak
      // class is the rich row and the page's internals.
      for (const internal of [
        /\bPageSpec\b/,
        /\bsource_fact_bundle_ids\b/,
        /\buser_value_score\b/,
        /\bqa\.reasons\b/,
        /\bgeneration\.(model|prompt_id)\b/,
        /\btemplate_version\b/,
        /\bcontent_blocks\b/,
        /\bintake_context\b/,
        /\bmonetization_policy_id\b/,
      ]) {
        expect(content, `${file} names ${internal}`).not.toMatch(internal);
      }
    }
  });
});

describe("A05 never sets monetization_eligible true (C15)", () => {
  it("not on generation, not on regeneration, not on an owner edit", () => {
    const { page, spec } = stageNewPage(opp({ status: "approved" }), { now: NOW });
    expect(spec.monetization_eligible).toBe(false);
    expect(spec.monetization_policy_id).toBeNull();
    const edited = applyOwnerEdit(page, spec, { h1: "x" }, { now: NOW }, "owner");
    expect(edited.spec.monetization_eligible).toBe(false);
  });

  it("the shipped superRefine invariants are intact", () => {
    const base = compilePageSpec(opp({ status: "approved" }), { now: NOW });
    // Ads only with a monetization policy...
    expect(() =>
      PageSpec.parse({ ...base, monetization_eligible: true, monetization_policy_id: null })
    ).toThrow(/must reference a monetization policy/);
    // ...and only on substantive public (indexed) content pages.
    expect(() =>
      PageSpec.parse({
        ...base,
        monetization_eligible: true,
        monetization_policy_id: "mp_1",
        indexed: false,
        noindex_reason: "staged",
      })
    ).toThrow(/only allowed on substantive public/);
    // ...and a non-indexed page must record why.
    expect(() => PageSpec.parse({ ...base, indexed: false, noindex_reason: null })).toThrow(
      /must record a noindex_reason/
    );
  });

  it("no A05 module ever writes monetization_eligible true", () => {
    for (const file of [
      "src/domain/search/factory.ts",
      "src/domain/search/page-registry.ts",
      "src/platform/search/page-factory-run.ts",
    ]) {
      const content = readFileSync(join(process.cwd(), file), "utf-8");
      expect(content, file).not.toMatch(/monetization_eligible:\s*true/);
    }
  });
});

/**
 * FOUND BY EDITING A PAGE IN THE RUNNING APP, not by the tests above.
 *
 * `findStagedByPath` used `.find()` — the FIRST match. Correct while every
 * canonical path had exactly one PageSpec, and silently wrong the moment A05
 * could produce a second version: the owner edited the copy, clicked Preview,
 * and saw their OLD text, because v1 sits before v2 in the list.
 */
describe("the staged preview serves the NEWEST version of a page", () => {
  it("returns v2 after an edit, not v1 — in list order, which is v1 first", async () => {
    const { page, spec } = stageNewPage(opp({ status: "approved" }), { now: NOW });
    const edited = applyOwnerEdit(page, spec, { h1: "Edited heading" }, { now: NOW }, "owner");
    expect(edited.spec.version).toBe(2);
    expect(edited.spec.canonical_path).toBe(spec.canonical_path);

    const { newestByVersion } = await import("@/domain/search/page-store");
    // The exact shape the lookup sees: both versions, same path, v1 first.
    const served = newestByVersion([spec, edited.spec]);
    expect(served?.version).toBe(2);
    expect(served?.h1).toBe("Edited heading");
    // ...and order-independent.
    expect(newestByVersion([edited.spec, spec])?.version).toBe(2);
  });

  it("returns null for a path with nothing at it", async () => {
    const { newestByVersion } = await import("@/domain/search/page-store");
    expect(newestByVersion([])).toBeNull();
  });

  it("with one version per path it returns exactly what it always did", async () => {
    const { findStagedByPath } = await import("@/domain/search/page-store");
    const served = await findStagedByPath(SAMPLE_PAGE_SPEC.canonical_path);
    expect(served?.page_spec_id).toBe(SAMPLE_PAGE_SPEC.page_spec_id);
  });
});
