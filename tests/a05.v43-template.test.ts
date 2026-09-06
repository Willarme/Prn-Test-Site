import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { compilePageSpec } from "@/domain/search/factory";
import { SearchOpportunity } from "@/domain/search/contracts";
import { PageSpec } from "@/domain/search/pages";
import { DoorTemplateBinding, getV43DoorBinding, getV43TemplateBundle, isV43Opportunity, V43_TEMPLATE_BUNDLE_ID } from "@/domain/search/door-template";
import committed from "../data/factory/staged-specs.json";
import originalBinding from "../content/door-template/v43/binding.json";

const now = () => "2026-09-06T12:00:00Z";
function opportunity(overrides: Partial<SearchOpportunity> = {}): SearchOpportunity {
  return SearchOpportunity.parse({
    search_opportunity_id: "so_v43_test", schema_version: "1.0.0", keyword: "ac blowing warm air",
    intent_cluster_id: null, cluster_label: null, problem_family_hint: "hvac", source: "manual",
    geography: { mode: "national", country: "US" }, geography_assumed: false, volume_monthly: null,
    keyword_difficulty: null, cpc_usd: null, intent_type: "problem", opportunity_score: null, score_components: null,
    recommendation: "NEW", status: "approved", metric_snapshot_ids: [], serp_snapshot_ids: [],
    provenance: { source_type: "synthetic_test", source_url: null, confidence_note: null }, vendor_cost_usd: null,
    researched_at: null, created_at: now(), updated_at: null, ...overrides,
  });
}

describe("reviewed v43 factory integration", () => {
  it("leaves stored legacy drafts source-unbound and byte-equivalent as parsed payloads", () => {
    for (const stored of committed.specs) {
      expect(PageSpec.parse(stored)).toEqual(stored);
      expect(PageSpec.parse(stored).door_template).toBeUndefined();
    }
  });
  it("compiles exact national AC intent to the complete frozen staged source, without claiming production readiness", () => {
    const page = compilePageSpec(opportunity(), { now });
    const binding = getV43DoorBinding();
    expect(page.door_template).toEqual(binding);
    expect(page.canonical_path).toBe("/problems/ac-blowing-warm-air");
    expect(page.page_spec_id).toBe("ps_ac_blowing_warm_air_tpl43_v1");
    expect(committed.specs.some((stored) => stored.page_spec_id === page.page_spec_id)).toBe(false);
    expect(page.generation.model).toBe("frozen-template-v43");
    expect(page.status).toBe("STAGED");
    expect(page.indexed).toBe(false);
    expect(page.noindex_reason).toContain("checks pending");
    expect(page.content_blocks).toEqual(binding.page_fields.content_blocks);
    expect(page.content_blocks).toHaveLength(16);
    expect(binding.section_order).toHaveLength(15);
    expect(page.content_blocks.map((b) => b.body_md).join(" ")).toContain("Check the price for your filter size and type.");
    expect(binding.amendment.base_binding_sha256).toBe(originalBinding.binding_sha256);
    expect(binding.direct_answer.source_ids).toEqual([]);
    expect(binding.source_bindings.every((source) => source.evidence_status === "INHERITED_UNVERIFIED" && source.verified_at === null)).toBe(true);
    expect(binding.capability_questions.every((cap) => cap.runtime_status === "CLAIMED_ON_PAGE_PENDING_RUNTIME_VERIFICATION")).toBe(true);
    expect(page.internal_links.some((link) => link.path === "/local-records/methodology")).toBe(true);
  });

  it("keeps both exact aliases on one canonical page identity", () => {
    const base = compilePageSpec(opportunity(), { now });
    const alias = compilePageSpec(opportunity({ keyword: "AC running but blowing warm air" }), { now });
    expect(alias.canonical_path).toBe(base.canonical_path);
    expect(alias.page_id).toBe(base.page_id);
    expect(alias.page_spec_id).toBe(base.page_spec_id);
  });

  it("does not apply AC copy to other intent, scope or tenant", () => {
    for (const candidate of [
      opportunity({ keyword: "ac blowing warm air fort wayne" }),
      opportunity({ keyword: "water heater leaking", problem_family_hint: "plumbing" }),
      opportunity({ tenant_id: "acme" }), opportunity({ geography: { mode: "national", country: "CA" } }),
      opportunity({ intent_type: "tool" }),
    ]) {
      expect(isV43Opportunity(candidate)).toBe(false);
      expect(compilePageSpec(candidate, { now }).door_template).toBeUndefined();
    }
    expect(compilePageSpec(opportunity(), { now, tenant_id: "acme" }).door_template).toBeUndefined();
  });

  it("rejects edited copy, swapped claims, fabricated verification, and missing bindings", () => {
    const page = compilePageSpec(opportunity(), { now });
    const mutations: Array<(value: typeof page) => void> = [
      (value) => { value.title = "Guaranteed free repair"; },
      (value) => { value.content_blocks[0].body_md = "AI replaced the frozen words"; },
      (value) => { value.door_template!.claim_bindings[1].source_ids = ["src-1"]; },
      (value) => { value.door_template!.metric_cards[1].value = "$0"; },
      (value) => { value.door_template!.visual_assets[0].source_sha256 = "a".repeat(64); },
      (value) => { delete value.door_template; },
    ];
    for (const mutate of mutations) {
      const changed = structuredClone(page); mutate(changed);
      expect(PageSpec.safeParse(changed).success).toBe(false);
    }
    const changedBinding = { ...getV43DoorBinding(), arbitrary_owner_text: "unsafe injection" };
    expect(DoorTemplateBinding.safeParse(changedBinding).success).toBe(false);
  });

  it("returns independent clones and attributes only the actual authored source", () => {
    const first = getV43DoorBinding(); first.metric_cards[0].value = "changed";
    expect(getV43DoorBinding().metric_cards[0].value).not.toBe("changed");
    const bundle = getV43TemplateBundle();
    expect(bundle.fact_bundle_id).toBe(V43_TEMPLATE_BUNDLE_ID);
    expect(bundle.facts).toHaveLength(16);
    expect(bundle.facts.every((fact) => fact.source_type === "frozen_template_source_only" && fact.source_url.startsWith("prn://"))).toBe(true);
  });

  it("rebuilds from checked-in hashes and a reviewed commit date without clone mtime or network", () => {
    const result = JSON.parse(execFileSync(process.execPath, ["tools/sync-door-template.mjs", "--check"], { cwd: process.cwd(), encoding: "utf8" }));
    expect(result.status).toBe("PASS");
    expect(result.files).toBe(55);
    expect(result.content_date).toBe("2026-09-05");
    expect(result.rendered_sha256).toBe(originalBinding.rendered_sha256);
    expect(result.rendered_sha256).not.toBe(getV43DoorBinding().rendered_sha256);
  });
});
