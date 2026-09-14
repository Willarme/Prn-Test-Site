import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const reads = vi.hoisted(() => ({ gate: vi.fn(), opportunities: vi.fn(), decisions: vi.fn(), queue: vi.fn(), published: vi.fn(), publishAction: vi.fn(), decisionAction: vi.fn(), generateAction: vi.fn() }));
vi.mock("@/components/admin/AdminGate", () => ({ adminGate: reads.gate }));
vi.mock("@/platform/admin/data", () => ({ loadOpportunities: reads.opportunities, loadStaged: () => ({ specs: [], skipped: [] }), publishedPageIds: reads.published }));
vi.mock("@/platform/search/decision-store", () => ({ opportunityDecisionStore: () => ({ kind: "file", list: reads.decisions }) }));
vi.mock("@/platform/stores/runtime", () => ({ runtimeStore: () => ({ kind: "file" }) }));
vi.mock("@/platform/search/page-qa-gate", () => ({ publishQueueSnapshot: reads.queue }));
vi.mock("@/components/admin/PublishButton", () => ({ PublishButton: reads.publishAction }));
vi.mock("@/components/admin/OpportunityDecision", () => ({ OpportunityDecision: reads.decisionAction }));
vi.mock("@/components/admin/GeneratePagesButton", () => ({ GeneratePagesButton: reads.generateAction }));

import OpportunitiesPage from "../src/app/admin/opportunities/page";
import AdminPages from "../src/app/admin/pages/page";
import { SAMPLE_PAGE_SPEC } from "../src/domain/search/fixtures/sample-page-spec";
import opportunitiesFixture from "../data/factory/opportunities.json";

function staged(index: number, eligible = false) {
  return {
    spec: { ...structuredClone(SAMPLE_PAGE_SPEC), page_spec_id: `test_spec_${index}`, page_id: `test_page_${index}`, h1: `Draft ${index}`, qa: { state: "PASS", reasons: [] } },
    decision: { release_eligible: eligible, reasons: [eligible ? "Current legacy gate passed" : "Current release gate blocked"], qa: { overall: "BLOCKED_PENDING_AI", ai_critic: { status: "SKIPPED_NO_MODEL" }, blockers: eligible ? [] : [{ code: "test" }] } },
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  reads.gate.mockResolvedValue(null);
  reads.opportunities.mockReturnValue(opportunitiesFixture);
  reads.decisions.mockResolvedValue([]);
  reads.queue.mockResolvedValue([staged(1, true), staged(2, false)]);
  reads.published.mockResolvedValue(new Set());
  reads.publishAction.mockImplementation(({ pageSpecId, canPublish }: { pageSpecId: string; canPublish: boolean }) => createElement("button", { "data-publish-spec": pageSpecId, disabled: !canPublish }, "Publish action"));
  reads.decisionAction.mockImplementation(({ opportunityId }: { opportunityId: string }) => createElement("button", { "data-opportunity": opportunityId }, "Decision action"));
  reads.generateAction.mockImplementation(() => createElement("button", null, "Generate action"));
});

describe("admin Growth list behavior", () => {
  it("keeps the gate before every private Growth read", async () => {
    reads.gate.mockResolvedValue(createElement("p", null, "Sign in"));
    expect(renderToStaticMarkup(await OpportunitiesPage({}))).toContain("Sign in");
    expect(renderToStaticMarkup(await AdminPages({}))).toContain("Sign in");
    expect(reads.opportunities).not.toHaveBeenCalled();
    expect(reads.decisions).not.toHaveBeenCalled();
    expect(reads.queue).not.toHaveBeenCalled();
    expect(reads.published).not.toHaveBeenCalled();
  });

  it("limits the research ledger to 20 rows and keeps filters in pagination links", async () => {
    const html = renderToStaticMarkup(await OpportunitiesPage({}));
    expect(reads.decisionAction).toHaveBeenCalledTimes(20);
    expect(html).toContain("96 research records");
    expect(html).toContain("Research records are not measured site traffic");
    expect(html).toContain("/admin/opportunities?page=2");
    reads.decisionAction.mockClear();
    const filtered = renderToStaticMarkup(await OpportunitiesPage({ searchParams: Promise.resolve({ q: "air", page: "2" }) }));
    expect(reads.decisionAction.mock.calls.length).toBeLessThanOrEqual(20);
    expect(filtered).toContain('name="q"');
    expect(filtered).toContain('value="air"');
    if (filtered.includes("Previous")) expect(filtered).toContain("q=air&amp;page=1");
  });

  it("does not present stale candidate/approval state or actions after a decision read failure", async () => {
    reads.decisions.mockRejectedValue(new Error("database unavailable"));
    const html = renderToStaticMarkup(await OpportunitiesPage({}));
    expect(html).toContain("Decision status could not be verified");
    expect(html.match(/>unverified<\/span>/g)).toHaveLength(20);
    expect(reads.decisionAction).not.toHaveBeenCalled();
    expect(reads.generateAction).not.toHaveBeenCalled();
    expect(html).not.toContain("migration 00011");
  });

  it("preserves the shared release gate despite a recorded deterministic PASS", async () => {
    const html = renderToStaticMarkup(await AdminPages({}));
    expect(reads.queue).toHaveBeenCalledTimes(1);
    expect(reads.publishAction).toHaveBeenCalledTimes(1);
    expect(reads.publishAction.mock.calls[0][0]).toEqual({ pageSpecId: "test_spec_1", published: false, canPublish: true, disabledReason: null });
    expect(html).toContain("no override exists");
    expect(html).toContain("BLOCKED_PENDING_AI");
    expect(html).toContain("SKIPPED_NO_MODEL");
    expect(html).toContain("Legacy · no v43 binding");
    expect(html).toContain("Queue eligibility is separate from AI review and production readiness");
  });

  it("leaves a failed publication reading unknown and disables otherwise eligible actions", async () => {
    reads.published.mockRejectedValue(new Error("unavailable"));
    const html = renderToStaticMarkup(await AdminPages({}));
    expect(html).toContain("Publication state is unverified");
    expect(reads.publishAction.mock.calls[0][0]).toMatchObject({ canPublish: false, disabledReason: expect.stringContaining("unverified") });
    expect(html).not.toMatch(/>Page ID (?:in|outside) published set<\/span>/);
  });

  it("contains page-list size and clamps malformed pagination to a usable result", async () => {
    reads.queue.mockResolvedValue(Array.from({ length: 43 }, (_, index) => staged(index, true)));
    const html = renderToStaticMarkup(await AdminPages({ searchParams: Promise.resolve({ page: "9000" }) }));
    expect(reads.publishAction).toHaveBeenCalledTimes(3);
    expect(html).toContain("Page 3 of 3");
    expect(html).toContain("Showing 41–43 of 43");
    reads.publishAction.mockClear();
    renderToStaticMarkup(await AdminPages({ searchParams: Promise.resolve({ page: "NaN", filter: "blocked" }) }));
    expect(reads.publishAction).not.toHaveBeenCalled();
  });

  it("does not turn an unavailable queue into a zero-pages claim or a build action", async () => {
    reads.queue.mockRejectedValue(new Error("unavailable"));
    const html = renderToStaticMarkup(await AdminPages({}));
    expect(html).toContain("The release queue could not be read");
    expect(html).not.toContain("0 staged specifications");
    expect(reads.publishAction).not.toHaveBeenCalled();
    expect(reads.generateAction).not.toHaveBeenCalled();
  });
});
