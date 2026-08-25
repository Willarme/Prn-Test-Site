import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FactBundle, type SearchOpportunity } from "@/domain/search/contracts";
import {
  CONTENT_BANK_SOURCE_ID,
  CONTENT_BANK_SOURCE_TYPE,
  contentBankBundleId,
  provenanceProblems,
} from "@/domain/search/content-bank-provenance";
import { compilePageSpec, listContentBankBundles } from "@/domain/search/factory";
import { PageFactoryPolicy } from "@/domain/search/page-factory-policy";
import { loadStaged } from "@/platform/admin/data";

/**
 * A05 step 3 — THE PROVENANCE STUB (coherence report issue 7).
 *
 * The audit's finding was blunt: `provenance.present` blocked every page A05
 * could build, because factory.ts emitted `source_fact_bundle_ids: []` on every
 * block of every page and no Wave 0/1 agent produces a FactBundle. These tests
 * assert the stub is real (a genuine FactBundle, from a genuine source, cited
 * by every block) and honest (first-party, no fabricated external citation, no
 * customer derivation).
 */

const NOW = () => "2026-08-14T12:00:00Z";

const OPP = {
  search_opportunity_id: "so_prov",
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

describe("provenance.present is now a real, passing property", () => {
  it("every block of a generated page cites a fact bundle", () => {
    const spec = compilePageSpec(OPP, { now: NOW });
    expect(provenanceProblems(spec)).toEqual([]);
    for (const block of spec.content_blocks) {
      expect(block.source_fact_bundle_ids, block.block_id).toHaveLength(1);
    }
  });

  it("the page's own source list is the union of its blocks'", () => {
    const spec = compilePageSpec(OPP, { now: NOW });
    expect(spec.source_fact_bundle_ids).toEqual([contentBankBundleId("hvac")]);
  });

  it("the urgency block specifically carries a bundle — issue 8 depends on it", () => {
    const spec = compilePageSpec(OPP, { now: NOW });
    const urgency = spec.content_blocks.find((b) => b.kind === "when_urgency_changes")!;
    expect(urgency.source_fact_bundle_ids.length).toBeGreaterThan(0);
  });

  it("reports the failure in words when a block cites nothing", () => {
    const spec = compilePageSpec(OPP, { now: NOW });
    const stripped = {
      ...spec,
      content_blocks: spec.content_blocks.map((b) => ({ ...b, source_fact_bundle_ids: [] })),
    };
    expect(provenanceProblems(stripped).join(" ")).toMatch(/blk_urgency cites no fact bundle/);
  });

  it("catches a block citing a bundle the page does not list", () => {
    const spec = compilePageSpec(OPP, { now: NOW });
    const drifted = {
      ...spec,
      content_blocks: spec.content_blocks.map((b) => ({ ...b, source_fact_bundle_ids: ["fb_orphan"] })),
    };
    expect(provenanceProblems(drifted).join(" ")).toMatch(/fb_orphan is missing from the page/);
  });
});

describe("the bundles are the SHIPPED FactBundle contract, not a parallel type", () => {
  it("every minted bundle parses as FactBundle", () => {
    for (const bundle of listContentBankBundles()) {
      expect(() => FactBundle.parse(bundle), bundle.fact_bundle_id).not.toThrow();
    }
  });

  it("one bundle per content-bank entry, generic included", () => {
    const ids = listContentBankBundles().map((b) => b.fact_bundle_id).sort();
    expect(ids).toEqual(
      ["electrical", "generic", "hvac", "plumbing"].map(contentBankBundleId).sort()
    );
  });

  it("a data-supplied family gets a bundle too, with no code change", () => {
    const policy = PageFactoryPolicy.parse({
      content_families: {
        roofing: {
          intent_answer: "About {keyword}.",
          safe_checks: "- check",
          do_not_do: "- do not",
          when_urgency_changes: "urgent when",
          who_handles_it: "a roofer",
          safety_note_required: false,
        },
      },
    });
    const ids = listContentBankBundles(policy).map((b) => b.fact_bundle_id);
    expect(ids).toContain(contentBankBundleId("roofing"));
  });

  it("carries one fact per content-bank statement, addressable by id", () => {
    const hvac = listContentBankBundles().find(
      (b) => b.fact_bundle_id === contentBankBundleId("hvac")
    )!;
    expect(hvac.facts).toHaveLength(5);
    expect(hvac.facts.map((f) => f.fact_id)).toContain(
      `fact_${CONTENT_BANK_SOURCE_ID}_hvac_when_urgency_changes`
    );
  });
});

describe("the stub is HONEST about what it is", () => {
  it("first-party rights — PRN wrote this copy, nothing is licensed or scraped", () => {
    for (const bundle of listContentBankBundles()) {
      expect(bundle.rights_class, bundle.fact_bundle_id).toBe("first_party");
    }
  });

  it("no fabricated external citation — source_url is an internal pointer", () => {
    for (const bundle of listContentBankBundles()) {
      for (const fact of bundle.facts) {
        expect(fact.source_type).toBe(CONTENT_BANK_SOURCE_TYPE);
        expect(fact.source_url).toMatch(/^prn:\/\/content-bank\//);
        expect(fact.source_url).not.toMatch(/^https?:/);
      }
    }
  });

  /**
   * The check is on IMPORTS, not prose — the module's own header says in words
   * that it reads no ProblemRecord and no EvidenceObject, and naming a thing to
   * forbid it is not the same as reaching for it (the same distinction
   * client-boundary.test.ts draws about PolicyForm naming SeoFactoryPolicy).
   */
  it("NO CUSTOMER DERIVATION — the provenance module imports no customer contract", () => {
    const source = readFileSync(
      join(process.cwd(), "src/domain/search/content-bank-provenance.ts"),
      "utf-8"
    );
    const imports = [...source.matchAll(/^import[\s\S]*?from\s+"([^"]+)";$/gm)].map((m) => m[1]);
    expect(imports).toEqual(["@/domain/search/contracts", "@/domain/shared/primitives"]);
    for (const path of imports) {
      expect(path).not.toMatch(/domain\/problem|domain\/intake|platform\/stores/);
    }
  });

  it("PRN's US-specific safety instructions are stamped national/US, not left implicit", () => {
    for (const key of ["hvac", "plumbing", "electrical", "generic"]) {
      const bundle = listContentBankBundles().find(
        (b) => b.fact_bundle_id === contentBankBundleId(key)
      )!;
      expect(bundle.geography, key).toEqual({ mode: "national", country: "US" });
    }
  });

  it("a client's data family states its own scope rather than inheriting PRN's", () => {
    const policy = PageFactoryPolicy.parse({
      content_families: {
        roofing: {
          intent_answer: "About {keyword}.",
          safe_checks: "- check",
          do_not_do: "- do not",
          when_urgency_changes: "urgent when",
          who_handles_it: "a roofer",
          safety_note_required: false,
        },
      },
    });
    const bundle = listContentBankBundles(policy).find(
      (b) => b.fact_bundle_id === contentBankBundleId("roofing")
    )!;
    expect(bundle.geography).toBeNull();
  });

  it("is deterministic — the same inputs mint the same bundle id every run", () => {
    const a = compilePageSpec(OPP, { now: NOW });
    const b = compilePageSpec(OPP, { now: NOW });
    expect(a.source_fact_bundle_ids).toEqual(b.source_fact_bundle_ids);
  });
});

/**
 * THE COMMITTED SIX PREDATE THE STUB, and that is recorded rather than papered
 * over: they are reproducible output of `npm run factory`, they will carry
 * bundles the next time the owner approves opportunities and regenerates, and
 * hand-editing a generated artifact to look compliant would be a lie in the
 * data. Their rendering is unaffected — IntentPageView never reads the field.
 */
/**
 * THE COMMITTED PORTFOLIO, BACKFILLED (inspection F1/F2).
 *
 * THIS BLOCK USED TO ASSERT THE OPPOSITE: "still carries empty provenance, and
 * nothing pretends otherwise". That was honest bookkeeping of a real gap, and
 * it named a plan — the fix is "a regeneration the owner triggers", not a
 * hand-edit. The plan could not run. Regeneration builds only from owner-
 * approved opportunities and zero of the 96 committed opportunities carries an
 * approval, so `npm run factory` deliberately REFUSES rather than wipe the
 * portfolio. Meanwhile all seven shipped pages were uneditable (the owner's
 * edit path runs this same lint) and six sat publish-eligible on a qa:PASS
 * minted before provenance existed.
 *
 * SO THE IDS WERE BACKFILLED ONCE, DETERMINISTICALLY, AND THIS IS NOT A
 * HAND-EDIT OF GENERATED OUTPUT: each id is the one `compilePageSpec` mints for
 * that page today, and every committed door still reproduces byte-for-byte from
 * the generator (asserted in a05.committed-artifacts.test.ts). Mechanically it
 * is the regeneration that was planned, minus the QA and score churn a rebuild
 * would have caused. No content string changed and the lint was not weakened.
 */
describe("the committed staged portfolio cites the bundles its copy came from", () => {
  it("every committed door carries the content-bank bundle for its family", () => {
    const committed = loadStaged().specs;
    expect(committed).toHaveLength(6);
    for (const spec of committed) {
      expect(spec.source_fact_bundle_ids, spec.page_spec_id).toEqual([contentBankBundleId("hvac")]);
      expect(provenanceProblems(spec), spec.page_spec_id).toEqual([]);
    }
  });

  it("the door renderer never reads a provenance field, so nothing renders differently", () => {
    const view = readFileSync(
      join(process.cwd(), "src/components/door/IntentPageView.tsx"),
      "utf-8"
    );
    expect(view).not.toMatch(/source_fact_bundle_ids/);
  });
});
