import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const reads = vi.hoisted(() => ({ gate: vi.fn(), specs: vi.fn(), policy: vi.fn(), release: vi.fn(), preview: vi.fn() }));
vi.mock("@/components/admin/AdminGate", () => ({ adminGate: reads.gate }));
vi.mock("@/platform/admin/data", () => ({ allStagedSpecs: reads.specs, policyStore: () => ({ getActive: reads.policy }) }));
vi.mock("@/platform/search/page-qa-gate", () => ({ publishGate: reads.release }));
vi.mock("@/domain/search/page-lint", () => ({ lintPageBeforeQa: () => ({ findings: [] }) }));
vi.mock("@/components/admin/EditorPreviewPane", () => ({ EditorPreviewPane: reads.preview }));

import AdminEditPage from "../src/app/admin/pages/[page_spec_id]/page";
import { SAMPLE_PAGE_SPEC } from "../src/domain/search/fixtures/sample-page-spec";
import { compilePageSpec } from "../src/domain/search/factory";
import { SearchOpportunity } from "../src/domain/search/contracts";
import { PageSpec } from "../src/domain/search/pages";
import workbook from "../data/factory/opportunities.json";

const frozen = compilePageSpec(SearchOpportunity.parse({ ...workbook.opportunities[0],
  keyword: "ac blowing warm air", intent_type: "problem", status: "approved",
  geography: { mode: "national", country: "US" },
}), { now: () => "2026-09-06T12:00:00Z" });

async function render(spec: PageSpec) {
  return renderToStaticMarkup(await AdminEditPage({ params: Promise.resolve({ page_spec_id: spec.page_spec_id }), searchParams: Promise.resolve({}) }));
}

beforeEach(() => {
  vi.resetAllMocks();
  reads.gate.mockResolvedValue(null);
  reads.policy.mockResolvedValue({ page_factory: {} });
  reads.release.mockResolvedValue(null);
  reads.preview.mockImplementation(() => createElement("div", null, "Live editable preview"));
});

describe("the editor respects the reviewed frozen source", () => {
  it("keeps authentication before any source or policy read", async () => {
    reads.gate.mockResolvedValue(createElement("p", null, "Sign in"));
    expect(await render(frozen)).toContain("Sign in");
    expect(reads.specs).not.toHaveBeenCalled();
    expect(reads.policy).not.toHaveBeenCalled();
    expect(reads.release).not.toHaveBeenCalled();
  });

  it("shows read-only fields and source preview when the real parser forbids an edit", async () => {
    expect(frozen.door_template).toBeDefined();
    expect(PageSpec.safeParse({ ...frozen, title: "Changed owner title" }).success).toBe(false);
    reads.specs.mockResolvedValue([frozen, { ...frozen, page_spec_id: "older_frozen", version: 0 }]);
    const html = await render(frozen);
    expect(html).toContain("frozen v43 source");
    expect(html).toContain("fresh QA before release");
    for (const field of ["title", "meta_description", "h1", "hero_headline", "hero_subheadline"]) {
      const input = html.match(new RegExp(`<(?:input|textarea)[^>]*name="${field}"[^>]*>`))?.[0];
      expect(input).toContain('disabled=""');
    }
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Frozen source/);
    expect(html).toContain('title="Reviewed frozen v43 source preview"');
    expect(html).not.toContain('id="page-edit-form"');
    expect(html).not.toContain('action="/api/admin/pages/rollback"');
    expect(html).not.toContain("Edit your page with the live preview");
    expect(reads.preview).not.toHaveBeenCalled();
  });

  it("preserves the ordinary editable page form, preview and version rollback", async () => {
    reads.specs.mockResolvedValue([SAMPLE_PAGE_SPEC, { ...SAMPLE_PAGE_SPEC, page_spec_id: "older_ordinary", version: 0 }]);
    const html = await render(SAMPLE_PAGE_SPEC);
    expect(html).toContain('id="page-edit-form"');
    expect(html).toContain("Save as a new version");
    expect(html).toContain('action="/api/admin/pages/rollback"');
    expect(html).not.toContain('disabled=""');
    expect(reads.preview).toHaveBeenCalledOnce();
  });
});
