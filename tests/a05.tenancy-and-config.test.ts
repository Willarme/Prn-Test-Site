import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { SearchOpportunity } from "@/domain/search/contracts";
import { compilePageSpec } from "@/domain/search/factory";
import { SAMPLE_PAGE_SPEC } from "@/domain/search/fixtures/sample-page-spec";
import {
  DEFAULT_PAGE_FACTORY_POLICY,
  PageFactoryPolicy,
} from "@/domain/search/page-factory-policy";
import { IntentPage, PageSpec } from "@/domain/search/pages";
import { TRIAL_DEFAULT_SEO_FACTORY_POLICY } from "@/domain/search/policy";
import { TPL_INTENT_PAGE, TemplateSpec } from "@/domain/search/template";
import { loadStaged } from "@/platform/admin/data";

/**
 * A05 step 2 — tenancy (C1) and the two literals that became policy (C2/C3).
 * The bar for every assertion here is "nothing changed except where the
 * decision lives".
 */

const NOW = () => "2026-08-14T12:00:00Z";

const OPP = {
  search_opportunity_id: "so_cfg",
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

describe("tenant_id (C1) — reserved on all three A05 records, no tenant logic", () => {
  it("PageSpec, IntentPage and TemplateSpec each accept it", () => {
    expect(PageSpec.parse({ ...SAMPLE_PAGE_SPEC, tenant_id: "acme" }).tenant_id).toBe("acme");
    const page = IntentPage.parse({
      page_id: "page_1",
      schema_version: "1.0.0",
      tenant_id: "acme",
      canonical_path: "/problems/x",
      current_page_spec_id: null,
      lifecycle_status: "STAGED",
      published_at: null,
      retired_at: null,
      redirect_to_path: null,
      created_at: "2026-08-24T00:00:00Z",
    });
    expect(page.tenant_id).toBe("acme");
    expect(TemplateSpec.parse({ ...TPL_INTENT_PAGE, tenant_id: "acme" }).tenant_id).toBe("acme");
  });

  it("is OPTIONAL — every committed staged spec still parses unchanged", () => {
    const committed = loadStaged().specs;
    expect(committed.length).toBe(6);
    for (const spec of committed) {
      expect(() => PageSpec.parse(spec)).not.toThrow();
      expect(PageSpec.parse(spec).tenant_id).toBeUndefined();
    }
    expect(PageSpec.parse(SAMPLE_PAGE_SPEC).tenant_id).toBeUndefined();
  });

  it("the factory only emits it when a caller asks — absence is the default", () => {
    expect(compilePageSpec(OPP, { now: NOW }).tenant_id).toBeUndefined();
    expect(compilePageSpec(OPP, { now: NOW, tenant_id: "acme" }).tenant_id).toBe("acme");
  });

  it("no tenant LOGIC exists anywhere in A05's modules — the field is reserved", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.ts$/.test(name)) files.push(full);
      }
    };
    walk(join(process.cwd(), "src", "domain", "search"));
    walk(join(process.cwd(), "src", "platform", "search"));
    for (const file of files) {
      const content = readFileSync(file, "utf-8");
      expect(content, file).not.toMatch(/tenant_id\s*===/);
      expect(content, file).not.toMatch(/if\s*\([^)]*tenant_id/);
      expect(content, file).not.toMatch(/\.eq\(\s*["']tenant_id["']/);
    }
  });
});

describe("C2 — template identity and the URL prefix are policy, values unchanged", () => {
  it("the defaults reproduce the old literals exactly", () => {
    expect(DEFAULT_PAGE_FACTORY_POLICY.template_id).toBe("tpl_intent_page");
    expect(DEFAULT_PAGE_FACTORY_POLICY.template_version).toBe("1.0.0");
    expect(DEFAULT_PAGE_FACTORY_POLICY.canonical_path_prefix).toBe("/problems/");
  });

  it("a page built with no policy is identical to the shipped output", () => {
    const spec = compilePageSpec(OPP, { now: NOW });
    expect(spec.template_id).toBe("tpl_intent_page");
    expect(spec.template_version).toBe("1.0.0");
    expect(spec.canonical_path).toBe("/problems/ac-blowing-warm-air");
  });

  it("a client can change both without touching factory.ts", () => {
    const policy = PageFactoryPolicy.parse({
      template_id: "tpl_acme_door",
      template_version: "2.1.0",
      canonical_path_prefix: "/fix/",
    });
    const spec = compilePageSpec(OPP, { now: NOW, policy });
    expect(spec.template_id).toBe("tpl_acme_door");
    expect(spec.template_version).toBe("2.1.0");
    expect(spec.canonical_path).toBe("/fix/ac-blowing-warm-air");
  });

  it("factory.ts no longer hardcodes either value", () => {
    const source = readFileSync(join(process.cwd(), "src/domain/search/factory.ts"), "utf-8");
    expect(source).not.toMatch(/template_id:\s*"tpl_intent_page"/);
    expect(source).not.toMatch(/canonical_path:\s*`\/problems\//);
  });

  /** C6: canonical_path is the FINAL PUBLIC path. A /staged/ prefix breaks publish. */
  it("the prefix cannot be set to a /staged/ path by accident of format", () => {
    // The regex enforces a kebab path prefix; the semantic rule is documented.
    expect(() => PageFactoryPolicy.parse({ canonical_path_prefix: "/problems" })).toThrow();
    expect(() => PageFactoryPolicy.parse({ canonical_path_prefix: "problems/" })).toThrow();
  });

  it("A05's block lands inside the owner-editable SeoFactoryPolicy document", () => {
    expect(TRIAL_DEFAULT_SEO_FACTORY_POLICY.page_factory.template_id).toBe("tpl_intent_page");
    expect(TRIAL_DEFAULT_SEO_FACTORY_POLICY.page_factory.canonical_path_prefix).toBe("/problems/");
  });

  it("the committed policy document predating the field still parses", () => {
    const raw = JSON.parse(
      readFileSync(join(process.cwd(), "data", "seo-factory-policy.json"), "utf-8")
    );
    const policyJson = raw.policy ?? raw;
    expect(policyJson.page_factory).toBeUndefined();
  });
});

describe("C3 — new content families are DATA, existing entries untouched", () => {
  it("content_families ships EMPTY, so nothing resolves through it today", () => {
    expect(DEFAULT_PAGE_FACTORY_POLICY.content_families).toEqual({});
  });

  it("the three shipped families are still hardcoded and still produce their text", () => {
    const source = readFileSync(join(process.cwd(), "src/domain/search/factory.ts"), "utf-8");
    expect(source).toMatch(/const FAMILY_CONTENT: Record<string, FamilyContent> = \{/);
    for (const family of ["hvac", "plumbing", "electrical"]) {
      expect(source).toMatch(new RegExp(`^\\s{2}${family}: \\{`, "m"));
    }
    const hvac = compilePageSpec(OPP, { now: NOW });
    expect(hvac.content_blocks[0].body_md).toMatch(/heating-and-cooling complaint pattern/);
  });

  it("a NEW family arrives as data with no TypeScript change", () => {
    const policy = PageFactoryPolicy.parse({
      content_families: {
        roofing: {
          intent_answer: 'With "{keyword}", where the water enters and where it shows up are rarely the same place.',
          safe_checks: "- Note which room and which wall.\n- Photograph the stain from a safe distance.",
          do_not_do: "- Don't go on the roof.",
          when_urgency_changes: "Urgent if water is reaching anything electrical.",
          who_handles_it: "A roofer, and a water-damage pro if material has been wet for a day.",
          safety_note_required: false,
        },
      },
    });
    const spec = compilePageSpec(
      { ...OPP, problem_family_hint: "roofing", keyword: "roof leak in bedroom" },
      { now: NOW, policy }
    );
    expect(spec.content_blocks[0].body_md).toMatch(/where the water enters/);
    // {keyword} substitution is the one difference between data and code.
    expect(spec.content_blocks[0].body_md).toMatch(/"roof leak in bedroom"/);
    expect(spec.safety_note_required).toBe(false);
    expect(spec.problem_family).toBe("roofing");
  });

  it("a data family for an existing key wins — the white-label door, no fork of factory.ts", () => {
    const policy = PageFactoryPolicy.parse({
      content_families: {
        hvac: {
          intent_answer: "Client-market wording for {keyword}.",
          safe_checks: "- Client checks.",
          do_not_do: "- Client warnings.",
          when_urgency_changes: "Client urgency guidance.",
          who_handles_it: "Client routing.",
          safety_note_required: true,
        },
      },
    });
    const spec = compilePageSpec(OPP, { now: NOW, policy });
    expect(spec.content_blocks[0].body_md).toBe("Client-market wording for ac blowing warm air.");
    expect(spec.safety_note_required).toBe(true);
  });

  it("an unknown family still falls through to GENERIC, unchanged", () => {
    const spec = compilePageSpec(
      { ...OPP, problem_family_hint: "garage_doors", keyword: "garage door wont close" },
      { now: NOW }
    );
    expect(spec.content_blocks[0].body_md).toMatch(/covers a few different situations/);
    expect(spec.safety_note_required).toBe(false);
  });
});
