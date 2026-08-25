import { describe, expect, it } from "vitest";
import type { SearchOpportunity } from "@/domain/search/contracts";
import { compilePageSpec } from "@/domain/search/factory";
import { PAGE_LIFECYCLE_STATUSES } from "@/domain/search/lifecycle";
import {
  allLinksResolved,
  canRestage,
  regeneratePage,
  resolveInternalLinks,
  restagePath,
  stageNewPage,
} from "@/domain/search/page-registry";
import { IntentPage } from "@/domain/search/pages";

/**
 * A05 step 4 — the Page Registry row, the lifecycle edges A05 owns (C17 /
 * coherence issue 13), and the fail-closed internal-link resolver.
 */

const NOW = () => "2026-08-24T00:00:00Z";

const OPP = {
  search_opportunity_id: "so_reg",
  schema_version: "1.0.0",
  keyword: "ac blowing warm air",
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
} as unknown as SearchOpportunity;

function page(overrides: Partial<IntentPage> = {}): IntentPage {
  return IntentPage.parse({
    page_id: "page_other",
    schema_version: "1.0.0",
    canonical_path: "/problems/furnace-not-working",
    current_page_spec_id: "ps_other_v1",
    lifecycle_status: "STAGED",
    published_at: null,
    retired_at: null,
    redirect_to_path: null,
    created_at: "2026-08-24T00:00:00Z",
    ...overrides,
  });
}

describe("generation writes a registry row at STAGED, through the shipped state machine", () => {
  it("a new page enters at APPROVED and A05 moves it to STAGED", () => {
    const { page: row, spec, transitions } = stageNewPage(OPP, { now: NOW });
    expect(row.lifecycle_status).toBe("STAGED");
    expect(spec.status).toBe("STAGED");
    expect(transitions).toEqual([{ from: "APPROVED", to: "STAGED" }]);
  });

  it("the row points at the spec, and the spec's path is the row's path", () => {
    const { page: row, spec } = stageNewPage(OPP, { now: NOW });
    expect(row.current_page_spec_id).toBe(spec.page_spec_id);
    expect(row.canonical_path).toBe(spec.canonical_path);
    expect(row.page_id).toBe(spec.page_id);
  });

  it("A05 writes qa.state PENDING and never PASS", () => {
    const { spec } = stageNewPage(OPP, { now: NOW });
    expect(spec.qa).toEqual({ state: "PENDING", reasons: [] });
  });

  it("a brand-new row is never published and carries no publish stamp", () => {
    const { page: row } = stageNewPage(OPP, { now: NOW });
    expect(row.published_at).toBeNull();
    expect(row.retired_at).toBeNull();
  });

  it("carries tenant_id when a caller supplies one (C1)", () => {
    expect(stageNewPage(OPP, { now: NOW }).page.tenant_id).toBeUndefined();
    expect(stageNewPage(OPP, { now: NOW }, { tenant_id: "acme" }).page.tenant_id).toBe("acme");
  });
});

describe("regeneration maps REFRESH -> STAGED, and every hop is asserted", () => {
  it("a PUBLISHED page goes PUBLISHED -> REFRESH -> STAGED", () => {
    expect(restagePath("PUBLISHED")).toEqual(["REFRESH", "STAGED"]);
    const published = page({ lifecycle_status: "PUBLISHED", published_at: "2026-08-20T00:00:00Z" });
    const previous = compilePageSpec(OPP, { now: NOW });
    const result = regeneratePage(published, previous, OPP, { now: NOW }, "template change");
    expect(result.transitions).toEqual([
      { from: "PUBLISHED", to: "REFRESH" },
      { from: "REFRESH", to: "STAGED" },
    ]);
    expect(result.page.lifecycle_status).toBe("STAGED");
  });

  it("a STAGED page rebuilds through APPROVED — the path lifecycle.ts documents", () => {
    expect(restagePath("STAGED")).toEqual(["APPROVED", "STAGED"]);
  });

  it("a RETIRED page is never regenerated", () => {
    expect(() => restagePath("RETIRED")).toThrow(/RETIRED/);
    expect(canRestage("RETIRED")).toBe(false);
  });

  it("every non-retired lifecycle state has a legal path back to STAGED", () => {
    for (const status of PAGE_LIFECYCLE_STATUSES) {
      if (status === "RETIRED") continue;
      expect(canRestage(status), status).toBe(true);
    }
  });

  it("increments the version and never silently overwrites the spec", () => {
    const previous = compilePageSpec(OPP, { now: NOW });
    expect(previous.version).toBe(1);
    const result = regeneratePage(page(), previous, OPP, { now: NOW }, "source facts changed");
    expect(result.spec.version).toBe(2);
    expect(result.spec.page_spec_id).not.toBe(previous.page_spec_id);
    expect(result.spec.page_spec_id).toMatch(/_v2$/);
    expect(result.page.current_page_spec_id).toBe(result.spec.page_spec_id);
  });

  it("keeps the public URL and the page id stable — content changed, not the address", () => {
    const previous = compilePageSpec(OPP, { now: NOW });
    const result = regeneratePage(page(), previous, OPP, { now: NOW }, "refresh");
    expect(result.spec.canonical_path).toBe(previous.canonical_path);
    expect(result.spec.page_id).toBe(previous.page_id);
    expect(result.spec.intake_context.page_id).toBe(previous.page_id);
  });

  it("resets QA — a stale PASS must never outlive the content it was about", () => {
    const previous = { ...compilePageSpec(OPP, { now: NOW }), qa: { state: "PASS" as const, reasons: [] }, user_value_score: 88 };
    const result = regeneratePage(page(), previous, OPP, { now: NOW }, "refresh");
    expect(result.spec.qa.state).toBe("PENDING");
    expect(result.spec.user_value_score).toBeNull();
  });

  it("carries the original created_at and stamps updated_at", () => {
    const previous = compilePageSpec(OPP, { now: () => "2026-08-01T00:00:00Z" });
    const result = regeneratePage(page(), previous, OPP, { now: NOW }, "refresh");
    expect(result.spec.created_at).toBe("2026-08-01T00:00:00Z");
    expect(result.spec.updated_at).toBe("2026-08-24T00:00:00Z");
  });

  it("records the reason for the regeneration", () => {
    const previous = compilePageSpec(OPP, { now: NOW });
    expect(regeneratePage(page(), previous, OPP, { now: NOW }, "owner edited the template").reason).toBe(
      "owner edited the template"
    );
  });
});

describe("the internal-link resolver FAILS CLOSED", () => {
  const registry = [
    page({ page_id: "page_a", canonical_path: "/problems/a" }),
    page({ page_id: "page_b", canonical_path: "/problems/b" }),
    page({ page_id: "page_retired", canonical_path: "/problems/gone", lifecycle_status: "RETIRED" }),
  ];

  it("links only to canonical page ids that actually exist", () => {
    const result = resolveInternalLinks(
      [{ target_page_id: "page_a", label: "A" }],
      registry,
      "page_source"
    );
    expect(result.links).toEqual([{ label: "A", path: "/problems/a" }]);
    expect(allLinksResolved(result)).toBe(true);
  });

  it("DROPS a missing target and says so — never a link to nowhere", () => {
    const result = resolveInternalLinks(
      [
        { target_page_id: "page_a", label: "A" },
        { target_page_id: "page_does_not_exist", label: "Ghost" },
      ],
      registry,
      "page_source"
    );
    expect(result.links).toHaveLength(1);
    expect(result.dropped).toHaveLength(1);
    expect(result.dropped[0].reason).toMatch(/fail closed, no link emitted/);
    expect(allLinksResolved(result)).toBe(false);
  });

  it("drops a RETIRED target", () => {
    const result = resolveInternalLinks(
      [{ target_page_id: "page_retired", label: "Gone" }],
      registry,
      "page_source"
    );
    expect(result.links).toEqual([]);
    expect(result.dropped[0].reason).toMatch(/RETIRED/);
  });

  it("drops a self-link and a duplicate", () => {
    const result = resolveInternalLinks(
      [
        { target_page_id: "page_a", label: "self" },
        { target_page_id: "page_b", label: "B" },
        { target_page_id: "page_b", label: "B again" },
      ],
      registry,
      "page_a"
    );
    expect(result.links).toEqual([{ label: "B", path: "/problems/b" }]);
    expect(result.dropped.map((d) => d.reason)).toEqual([
      "a page cannot link to itself",
      "duplicate link target",
    ]);
  });

  it("enforces the policy cap and reports what it cut", () => {
    const many = Array.from({ length: 8 }, (_, i) => page({ page_id: `p${i}`, canonical_path: `/problems/p${i}` }));
    const result = resolveInternalLinks(
      many.map((p) => ({ target_page_id: p.page_id, label: p.page_id })),
      many,
      "page_source"
    );
    expect(result.links).toHaveLength(5);
    expect(result.dropped).toHaveLength(3);
    expect(result.dropped[0].reason).toMatch(/over the internal-link cap of 5/);
  });

  it("a resolved link is always root-relative — external hrefs are structurally impossible", () => {
    const bad = [page({ page_id: "page_ext", canonical_path: "https://evil.example.com" })];
    const result = resolveInternalLinks(
      [{ target_page_id: "page_ext", label: "x" }],
      bad,
      "page_source"
    );
    expect(result.links).toEqual([]);
    expect(result.dropped[0].reason).toMatch(/not root-relative/);
  });
});
