import { describe, expect, it } from "vitest";
import { SearchOpportunity, SeoDataProvider } from "@/domain/search/contracts";
import { IntakeContext, PageSpec } from "@/domain/search/pages";

const validOpportunity = {
  search_opportunity_id: "so_ac_not_turning_on",
  schema_version: "1.0.0",
  keyword: "ac not turning on",
  intent_cluster_id: null,
  cluster_label: "HVAC",
  problem_family_hint: "hvac",
  source: "seed_import",
  geography: { mode: "national", country: "US" },
  geography_assumed: true,
  volume_monthly: 3300,
  keyword_difficulty: 3,
  cpc_usd: null,
  intent_type: "problem",
  opportunity_score: 84,
  score_components: { serp_gap: 4, packet_fit: 5 },
  recommendation: "NEW",
  status: "candidate",
  metric_snapshot_ids: [],
  serp_snapshot_ids: [],
  provenance: {
    source_type: "public dataset — verify via vendor API",
    source_url: null,
    confidence_note: "seed workbook 2026-08-10",
  },
  vendor_cost_usd: null,
  researched_at: "2026-08-10T00:00:00Z",
  created_at: "2026-08-14T00:00:00Z",
  updated_at: null,
};

describe("SearchOpportunity", () => {
  it("accepts a valid seed-import opportunity", () => {
    expect(SearchOpportunity.safeParse(validOpportunity).success).toBe(true);
  });

  it("treats keyword difficulty 0 as a real value, distinct from unknown", () => {
    expect(
      SearchOpportunity.safeParse({ ...validOpportunity, keyword_difficulty: 0 }).success
    ).toBe(true);
    expect(
      SearchOpportunity.safeParse({ ...validOpportunity, keyword_difficulty: null }).success
    ).toBe(true);
  });

  it("rejects out-of-range scores and unknown recommendations", () => {
    expect(
      SearchOpportunity.safeParse({ ...validOpportunity, opportunity_score: 105 }).success
    ).toBe(false);
    expect(
      SearchOpportunity.safeParse({ ...validOpportunity, recommendation: "PUBLISH" }).success
    ).toBe(false);
  });

  it("rejects a missing keyword", () => {
    expect(SearchOpportunity.safeParse({ ...validOpportunity, keyword: "" }).success).toBe(false);
  });
});

const validPageSpec = {
  page_spec_id: "ps_ac_not_turning_on_v1",
  schema_version: "1.0.0",
  page_id: "page_ac_not_turning_on",
  version: 1,
  status: "IDEA",
  intent_id: "intent_ac_not_turning_on",
  intent_cluster_id: "ic_hvac_no_power",
  search_opportunity_id: "so_ac_not_turning_on",
  primary_query: "ac not turning on",
  supporting_queries: ["why is my ac not turning on"],
  problem_family: "hvac",
  geography: { mode: "national", country: "US" },
  canonical_path: "/problems/ac-not-turning-on",
  title: "AC Not Turning On? What It Means and What to Check",
  meta_description:
    "What it can mean when your AC will not turn on, what is safe to check yourself, and when it is time to bring in a professional.",
  h1: "Your AC won't turn on",
  hero: { headline: "AC not turning on?", subheadline: "Start with what happened." },
  content_blocks: [
    {
      block_id: "blk_intent_answer",
      kind: "intent_answer",
      heading: "What this usually means",
      body_md: "Several common causes...",
      source_fact_bundle_ids: [],
    },
  ],
  safety_note_required: false,
  structured_data_plan: null,
  internal_links: [],
  intake_context: {
    page_id: "page_ac_not_turning_on",
    intent_cluster_id: "ic_hvac_no_power",
    search_opportunity_id: "so_ac_not_turning_on",
    problem_family_hint: "hvac",
  },
  monetization_eligible: false,
  monetization_policy_id: null,
  user_value_score: null,
  indexed: true,
  noindex_reason: null,
  template_id: "tpl_intent_page",
  template_version: "1.0.0",
  experiment: { experiment_id: null, variant: null },
  generation: { model: null, prompt_id: null, prompt_version: null },
  qa: { state: "PENDING", reasons: [] },
  source_fact_bundle_ids: [],
  created_at: "2026-08-14T00:00:00Z",
  updated_at: null,
};

describe("PageSpec", () => {
  it("accepts a valid spec", () => {
    expect(PageSpec.safeParse(validPageSpec).success).toBe(true);
  });

  it("requires a monetization policy when monetization is eligible (#23 §5.1)", () => {
    const r = PageSpec.safeParse({ ...validPageSpec, monetization_eligible: true });
    expect(r.success).toBe(false);
  });

  it("forbids monetization on non-indexed pages (#23 §5.1)", () => {
    const r = PageSpec.safeParse({
      ...validPageSpec,
      monetization_eligible: true,
      monetization_policy_id: "mp_default",
      indexed: false,
      noindex_reason: "private test",
    });
    expect(r.success).toBe(false);
  });

  it("requires a reason when a page is not indexed", () => {
    const r = PageSpec.safeParse({ ...validPageSpec, indexed: false, noindex_reason: null });
    expect(r.success).toBe(false);
  });

  it("rejects non-kebab canonical paths and oversized titles", () => {
    expect(
      PageSpec.safeParse({ ...validPageSpec, canonical_path: "/Problems/AC" }).success
    ).toBe(false);
    expect(
      PageSpec.safeParse({ ...validPageSpec, title: "x".repeat(71) }).success
    ).toBe(false);
  });

  it("intake_context carries attribution only — no analyzer fields exist on the CONTRACT itself", () => {
    // Asserted against the schema shape, not a fixture: adding any analyzer
    // field to IntakeContext breaks this test (doors, not brains).
    expect(Object.keys(IntakeContext.shape).sort()).toEqual(
      ["intent_cluster_id", "page_id", "problem_family_hint", "search_opportunity_id"].sort()
    );
  });
});

describe("SeoDataProvider (#23 §8.1)", () => {
  it("registers vendors with credential env-var NAMES only", () => {
    const r = SeoDataProvider.safeParse({
      seo_data_provider_id: "sdp_dataforseo",
      provider_key: "dataforseo",
      display_name: "DataForSEO",
      status: "active",
      credential_env_keys: ["DATAFORSEO_LOGIN", "DATAFORSEO_PASSWORD"],
      cost_rate_ids: [],
      created_at: "2026-08-14T00:00:00Z",
    });
    expect(r.success).toBe(true);
  });
});
