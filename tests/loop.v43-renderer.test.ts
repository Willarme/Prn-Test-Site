import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compilePageSpec } from "@/domain/search/factory";
import type { SearchOpportunity } from "@/domain/search/contracts";
import { PageSpec } from "@/domain/search/pages";
import { getV43TemplateBundle } from "@/domain/search/door-template";
import { lintPageBeforeQa } from "@/domain/search/page-lint";
import { renderV43DoorPage, renderV43Template } from "@/platform/pages/v43-door-renderer";
import { generatePageCopy } from "@/platform/search/ai-page-copy";
import { ACTIVE_DISCLOSURE } from "@/domain/privacy/disclosures";
import manifest from "../content/door-template/v43/manifest.json";
import { amendV43Html } from "@/domain/search/door-template-amendment";

function frozenSpec(): PageSpec {
  return compilePageSpec({
    search_opportunity_id: "so_frozen_renderer", keyword: "ac blowing warm air", intent_type: "problem",
    problem_family_hint: "hvac", geography: { mode: "national", country: "US" }, intent_cluster_id: null,
  } as SearchOpportunity, { now: () => "2026-09-06T00:00:00Z" });
}

describe("the factory's real v43 render path", () => {
  it("rebuilds exact reviewed HTML from the shipped kit, including all section and source content", () => {
    const spec = frozenSpec();
    const html = renderV43Template(spec);
    expect(html).toBe(amendV43Html(readFileSync(join(process.cwd(), "content/door-template/v43/rendered.html"), "utf8")));
    expect(spec.door_template?.section_order).toHaveLength(15);
    expect(html).toContain('id="common-causes"');
    expect(html).toContain('id="sources-and-review"');
    expect(html).toContain('id="src-11"');
    expect(html).not.toContain("{%");
  });

  it("serves the same approved CSS and binds real attribution, current consent and backed metadata", () => {
    const spec = frozenSpec();
    const raw = renderV43Template(spec);
    const html = renderV43DoorPage(spec, "http://127.0.0.1:3291");
    const originalStyle = raw.match(/<style\b[^>]*>([\s\S]*?)<\/style>/)?.[1];
    expect(originalStyle).toBeTruthy();
    expect(html).toContain(originalStyle);
    expect(html).toContain('name="disclosure_content_hash" value="' + ACTIVE_DISCLOSURE.content_hash + '"');
    expect(html).toContain('name="search_opportunity_id" value="so_frozen_renderer"');
    expect(html.match(/name="page_id"/g)).toHaveLength(1);
    expect(html.match(/<form\b/g)).toHaveLength(1);
    expect(html).toContain('content="noindex,nofollow"');
    expect(html).toContain('name="twitter:image" content="http://127.0.0.1:3291/images/');
    expect(html).toContain('"dateModified": "2026-09-06"');
    const canonical = "http://127.0.0.1:3291" + spec.canonical_path;
    expect(html).toContain('<link rel="canonical" href="' + canonical + '">');
    expect(html).toContain('<meta property="og:url" content="' + canonical + '">');
    expect(html).toContain('"url": "' + canonical + '"');
    expect(html).toContain('"@id": "' + canonical + '#webpage"');
    expect(html).not.toContain("https://propertyresponsenetwork.com");
    expect(html).not.toContain("{{site.name}}");
    expect(html).toContain("  },true);\n  if(location.hash.indexOf('#src-')===0) openSourceLedger();");
  });

  it("rejects a metadata date that differs from the pinned source evidence", () => {
    const original = manifest.content_date_basis.modified_at;
    try {
      manifest.content_date_basis.modified_at = "2040-01-01T00:00:00Z";
      expect(() => renderV43DoorPage(frozenSpec(), "https://preview.invalid")).toThrow(/content date/);
    } finally { manifest.content_date_basis.modified_at = original; }
  });

  it("refuses changed words, missing bindings and falsely promoted capability statuses", () => {
    const spec = frozenSpec();
    expect(() => renderV43Template({ ...spec, h1: "Changed frozen copy" })).toThrow();
    expect(lintPageBeforeQa({ ...spec, h1: "Changed frozen copy" }).passed).toBe(false);
    const missing = { ...spec, door_template: undefined };
    expect(() => renderV43Template(missing)).toThrow();
    expect(lintPageBeforeQa(missing).passed).toBe(false);
    const changed = structuredClone(spec);
    (changed.door_template!.capability_questions[0] as { runtime_status: string }).runtime_status = "LIVE";
    expect(() => renderV43Template(changed)).toThrow();
    for (const [field, value] of Object.entries({ page_id: "page_wrong", search_opportunity_id: "so_wrong",
      intent_cluster_id: "ic_wrong", problem_family_hint: "plumbing" })) {
      const wrongIntake = { ...spec, intake_context: { ...spec.intake_context, [field]: value } };
      expect(() => renderV43DoorPage(wrongIntake, "https://preview.invalid")).toThrow();
    }
  });

  it("allows the source-bound reviewed prices to reach A06 without rewriting frozen words", async () => {
    const spec = frozenSpec();
    expect(lintPageBeforeQa(spec).passed).toBe(true);
    const result = await generatePageCopy(spec, [getV43TemplateBundle()], {
      deps: { provider: () => { throw new Error("Frozen text must never initialize a model"); } },
    });
    expect(result.engine).toBe("frozen_template");
    expect(result.run_id).toBeNull();
    expect(result.spec).toEqual(spec);
    expect(result.spec.qa.state).toBe("PENDING");
    expect(result.spec.indexed).toBe(false);
  });
});
