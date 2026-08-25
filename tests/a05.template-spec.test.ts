import { describe, expect, it } from "vitest";
import { compilePageSpec } from "@/domain/search/factory";
import { SAMPLE_PAGE_SPEC } from "@/domain/search/fixtures/sample-page-spec";
import {
  TEMPLATE_REGISTRY,
  TPL_INTENT_PAGE,
  TPL_INTENT_PAGE_FAQ,
  TemplateSpec,
  missingRequiredSlots,
  resolveTemplate,
  templateMatchesBlocks,
} from "@/domain/search/template";
import { loadStaged } from "@/platform/admin/data";
import type { SearchOpportunity } from "@/domain/search/contracts";

/**
 * A05 step 1 — TemplateSpec is the CONTAINER. The shape is parked
 * (TODO-ASK-OWNER, Melissa: pre-answers 1 and 2), so these tests check that the
 * container can hold EITHER candidate shape and that the one registered
 * template still describes what the factory actually emits.
 */

const NOW = () => "2026-08-14T12:00:00Z";

function approvedOpportunity(): SearchOpportunity {
  return {
    ...SAMPLE_OPP,
    status: "approved",
  } as SearchOpportunity;
}

const SAMPLE_OPP = {
  search_opportunity_id: "so_tpl",
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
  status: "candidate",
  metric_snapshot_ids: [],
  serp_snapshot_ids: [],
  provenance: { source_type: "seed", source_url: null, confidence_note: null },
  vendor_cost_usd: null,
  researched_at: null,
  created_at: "2026-08-14T00:00:00Z",
  updated_at: null,
} as unknown as SearchOpportunity;

describe("TemplateSpec is versioned and shape-agnostic", () => {
  it("carries a version string and an ORDERED slot list", () => {
    expect(TPL_INTENT_PAGE.version).toBe("1.0.0");
    expect(TPL_INTENT_PAGE.blocks.length).toBeGreaterThan(0);
    // Array position is render order — that is the whole mechanism.
    expect(TPL_INTENT_PAGE.blocks[0].slot_id).toBe("blk_intent_answer");
  });

  it("reserves tenant_id (C1) without any tenant logic", () => {
    expect(TPL_INTENT_PAGE.tenant_id).toBeUndefined();
    const clientTemplate = TemplateSpec.parse({ ...TPL_INTENT_PAGE, tenant_id: "acme" });
    expect(clientTemplate.tenant_id).toBe("acme");
  });

  /**
   * THE PARKED CHOICE, PROVEN PARKED. Both candidate shapes encode as data with
   * no change to this file — which is the entire justification for building the
   * container instead of picking a shape.
   */
  it("encodes the spec-14 problem template shape without a code change", () => {
    const spec14 = TemplateSpec.parse({
      template_id: "tpl_problem_page_spec14",
      schema_version: "1.0.0",
      version: "0.1.0",
      display_name: "Spec-14 problem template (CANDIDATE, unapproved)",
      blocks: [
        { slot_id: "s_answer", kind: "intent_answer", custom_key: null, label: "Direct answer", default_heading: null, required: true },
        { slot_id: "s_safety", kind: "when_urgency_changes", custom_key: null, label: "Safety", default_heading: null, required: true },
        { slot_id: "s_changes", kind: "custom", custom_key: "what_changes_the_answer", label: "What changes the answer", default_heading: null, required: false },
        { slot_id: "s_local", kind: "local_context", custom_key: null, label: "Local context", default_heading: null, required: false },
        { slot_id: "s_get", kind: "custom", custom_key: "what_you_get", label: "What you get", default_heading: null, required: false },
        { slot_id: "s_quote", kind: "custom", custom_key: "smartquote_links", label: "SmartQuote links", default_heading: null, required: false },
      ],
      intake_placement: { mode: "after_slot", after_slot_id: "s_local", owner_decided: false },
      owner_approved: false,
      created_at: "2026-08-24T00:00:00Z",
    });
    expect(spec14.blocks).toHaveLength(6);
    expect(spec14.intake_placement.mode).toBe("after_slot");
  });

  it("encodes a white-label client's own shape the same way", () => {
    const clientShape = TemplateSpec.parse({
      ...TPL_INTENT_PAGE,
      template_id: "tpl_acme_door",
      tenant_id: "acme",
      version: "1.0.0",
      blocks: [
        { slot_id: "a1", kind: "custom", custom_key: "acme_promise", label: "Promise", default_heading: null, required: true },
        { slot_id: "a2", kind: "faq", custom_key: null, label: "FAQ", default_heading: null, required: false },
      ],
      intake_placement: { mode: "after_hero", after_slot_id: null, owner_decided: false },
    });
    expect(clientShape.blocks.map((b) => b.slot_id)).toEqual(["a1", "a2"]);
  });

  it("a custom slot without a custom_key is rejected — no anonymous slots", () => {
    expect(() =>
      TemplateSpec.parse({
        ...TPL_INTENT_PAGE,
        blocks: [{ slot_id: "x", kind: "custom", custom_key: null, label: "x", default_heading: null, required: true }],
      })
    ).toThrow(/custom_key/);
  });

  it("intake_placement after_slot must name a slot the template has", () => {
    expect(() =>
      TemplateSpec.parse({
        ...TPL_INTENT_PAGE,
        intake_placement: { mode: "after_slot", after_slot_id: "no_such_slot", owner_decided: false },
      })
    ).toThrow(/slot this template actually has/);
  });

  it("duplicate slot ids are rejected", () => {
    expect(() =>
      TemplateSpec.parse({
        ...TPL_INTENT_PAGE,
        blocks: [TPL_INTENT_PAGE.blocks[0], TPL_INTENT_PAGE.blocks[0]],
      })
    ).toThrow(/unique/);
  });
});

describe("the parked decisions are recorded as parked, never as answers", () => {
  it("no shipped template claims owner approval of its shape", () => {
    for (const tpl of TEMPLATE_REGISTRY) {
      expect(tpl.owner_approved, tpl.template_id).toBe(false);
    }
  });

  it("intake placement records current behaviour and states it was not decided", () => {
    expect(TPL_INTENT_PAGE.intake_placement.owner_decided).toBe(false);
    expect(TPL_INTENT_PAGE.intake_placement.mode).toBe("after_all_blocks");
  });

  it("the file says TODO-ASK-OWNER out loud", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const source = readFileSync(join(process.cwd(), "src/domain/search/template.ts"), "utf-8");
    expect(source).toMatch(/TODO-ASK-OWNER/);
    expect(source).toMatch(/I'm not approving these templates yet/);
  });
});

describe("the registered template DESCRIBES the shipped output — anti-drift", () => {
  it("matches what compilePageSpec emits, slot for slot and heading for heading", () => {
    const spec = compilePageSpec(approvedOpportunity(), { now: NOW });
    expect(templateMatchesBlocks(TPL_INTENT_PAGE, spec.content_blocks)).toEqual([]);
    expect(spec.template_id).toBe(TPL_INTENT_PAGE.template_id);
    expect(spec.template_version).toBe(TPL_INTENT_PAGE.version);
  });

  it("matches every COMMITTED staged spec — the six doors the trial serves", () => {
    const committed = loadStaged().specs;
    expect(committed.length).toBeGreaterThan(0);
    for (const spec of committed) {
      expect(templateMatchesBlocks(TPL_INTENT_PAGE, spec.content_blocks), spec.canonical_path).toEqual([]);
    }
  });

  /**
   * EVERY SHIPPED PAGE, AGAINST THE TEMPLATE IT CLAIMS (inspection F4).
   *
   * The check above only ever looked at the six GENERATED doors, and the
   * handcrafted sample was checked with `missingRequiredSlots` — which an EXTRA
   * block satisfies trivially. So the sample claimed tpl_intent_page while
   * carrying six blocks against its five slots, and the anti-drift suite passed.
   * This resolves each page's OWN claim and matches against that.
   */
  it("every shipped page resolves the template it CLAIMS, and matches it", () => {
    const shipped = [SAMPLE_PAGE_SPEC, ...loadStaged().specs];
    expect(shipped).toHaveLength(7);
    for (const spec of shipped) {
      const template = resolveTemplate(spec.template_id, spec.template_version);
      expect(template, `${spec.page_spec_id} claims ${spec.template_id}@${spec.template_version}`).not.toBeNull();
      expect(templateMatchesBlocks(template!, spec.content_blocks), spec.page_spec_id).toEqual([]);
      expect(missingRequiredSlots(template!, spec.content_blocks), spec.page_spec_id).toEqual([]);
    }
  });

  it("the handcrafted door's template is the shipped shape PLUS a closing FAQ", () => {
    expect(SAMPLE_PAGE_SPEC.template_id).toBe(TPL_INTENT_PAGE_FAQ.template_id);
    expect(TPL_INTENT_PAGE_FAQ.blocks.map((b) => b.slot_id)).toEqual([
      ...TPL_INTENT_PAGE.blocks.map((b) => b.slot_id),
      "blk_faq",
    ]);
    // The factory's own output still matches the FIVE-slot template exactly —
    // the extra slot describes the handcrafted page, never generated output.
    const generated = compilePageSpec(approvedOpportunity(), { now: NOW });
    expect(templateMatchesBlocks(TPL_INTENT_PAGE_FAQ, generated.content_blocks)).not.toEqual([]);
  });

  it("reports drift in words rather than silently passing", () => {
    const problems = templateMatchesBlocks(TPL_INTENT_PAGE, [
      { block_id: "blk_intent_answer", kind: "faq", heading: "Wrong" },
    ]);
    expect(problems.join(" ")).toMatch(/declares 5 slots but the page carries 1/);
    expect(problems.join(" ")).toMatch(/declares kind "intent_answer", page carries "faq"/);
  });

  it("required slots are checkable — the handcrafted sample satisfies them", () => {
    expect(missingRequiredSlots(TPL_INTENT_PAGE, SAMPLE_PAGE_SPEC.content_blocks)).toEqual([]);
    expect(missingRequiredSlots(TPL_INTENT_PAGE, [{ kind: "faq" }])).toEqual(["blk_intent_answer"]);
  });

  it("resolves by id and by id+version", () => {
    expect(resolveTemplate("tpl_intent_page")?.version).toBe("1.0.0");
    expect(resolveTemplate("tpl_intent_page", "9.9.9")).toBeNull();
    expect(resolveTemplate("nope")).toBeNull();
  });
});

/**
 * THE REGRESSION BAR (done-when): nothing customer-visible changes. The
 * renderer is NOT driven by TemplateSpec — registering a template must not put
 * a single new import into the door view.
 */
describe("registering a template changes no rendering", () => {
  it("IntentPageView does not import the template module", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const view = readFileSync(join(process.cwd(), "src/components/door/IntentPageView.tsx"), "utf-8");
    expect(view).not.toMatch(/search\/template/);
    expect(view).not.toMatch(/TemplateSpec/);
  });
});
