import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FactBundle, type SearchOpportunity } from "@/domain/search/contracts";
import {
  CONTENT_BANK_SOURCE_TYPE,
  HANDCRAFTED_DOOR_SOURCE_TYPE,
  contentBankBundleId,
  provenanceProblems,
} from "@/domain/search/content-bank-provenance";
import { compilePageSpec, listContentBankBundles } from "@/domain/search/factory";
import { SAMPLE_PAGE_BUNDLE, SAMPLE_PAGE_SPEC } from "@/domain/search/fixtures/sample-page-spec";
import { lintPageBeforeQa } from "@/domain/search/page-lint";
import { registryRowFor } from "@/domain/search/page-registry";
import type { PageSpec } from "@/domain/search/pages";
import { qaCandidatePages } from "@/domain/search/qa";
import { resolveTemplate, templateMatchesBlocks } from "@/domain/search/template";
import { loadStaged } from "@/platform/admin/data";
import { resetApprovalCenterForTests } from "@/platform/approvals/center";
import { resetAgentRunLedgerForTests } from "@/platform/runs/ledger";
import { resetKillSwitchForTests } from "@/platform/killswitch";
import { editStagedPage } from "@/platform/search/page-factory-run";

/**
 * THE COMMITTED ARTIFACTS — the seven doors PRN actually serves.
 *
 * THIS FILE EXISTS BECAUSE OF WHAT ITS ABSENCE COST. Every A05 test built its
 * fixtures from `compilePageSpec` / `stageNewPage` — that is, from the CURRENT
 * generator. Not one of them ever loaded `data/factory/staged-specs.json` or the
 * handcrafted sample and asserted a property of it. So every check was run
 * against pages that could not fail it, and four defects lived behind 906 green
 * tests:
 *
 *   F1  the new urgency lint requires a sourced urgency block; all seven
 *       committed pages predate provenance, so lintPageBeforeQa blocked all
 *       seven — and the OWNER'S EDIT path runs that same lint. Every shipped
 *       page was uneditable.
 *   F2  zero of the seven cited any FactBundle, while six carried a qa:PASS
 *       minted before provenance existed — publish-eligible pages with no
 *       provenance at all, which A06's `provenance.present` check would fail
 *       100% of.
 *   F4  the handcrafted sample claimed a template declaring five slots while
 *       carrying six blocks.
 *
 * The rule this file encodes: a property asserted only about generated fixtures
 * is not asserted about the product. What ships is what gets checked.
 */

const NOW = () => "2026-08-24T00:00:00Z";

/** The six generated doors plus the handcrafted one: the whole shipped portfolio. */
const COMMITTED: PageSpec[] = loadStaged().specs;
const SHIPPED: PageSpec[] = [SAMPLE_PAGE_SPEC, ...COMMITTED];

/** Every bundle a shipped page is allowed to cite, from both first-party sources. */
const REGISTERED_BUNDLES: FactBundle[] = [...listContentBankBundles(), SAMPLE_PAGE_BUNDLE];

let tmp: string;
let unlocked = true;
vi.mock("@/platform/admin/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/platform/admin/auth")>();
  return { ...actual, isAdminUnlocked: async () => unlocked };
});

let editPOST: (request: Request) => Promise<Response>;

beforeAll(async () => {
  ({ POST: editPOST } = await import("@/app/api/admin/pages/edit/route"));
});

beforeEach(() => {
  unlocked = true;
  tmp = mkdtempSync(join(tmpdir(), "prn-a05-committed-"));
  process.env.PRN_DEV_DB_PATH = join(tmp, "dev-db.json");
  resetApprovalCenterForTests();
  resetAgentRunLedgerForTests();
  resetKillSwitchForTests();
});

afterEach(() => {
  delete process.env.PRN_DEV_DB_PATH;
  rmSync(tmp, { recursive: true, force: true });
});

/** Rebuild a committed door from its own recorded inputs, as the factory would. */
function regenerate(spec: PageSpec): PageSpec {
  const opportunity = {
    search_opportunity_id: spec.search_opportunity_id,
    keyword: spec.primary_query,
    problem_family_hint: spec.problem_family,
    intent_cluster_id: spec.intent_cluster_id,
    geography: spec.geography,
  } as unknown as SearchOpportunity;
  return compilePageSpec(opportunity, { now: () => spec.created_at });
}

describe("this suite reads the SHIPPED artifacts, not a fixture", () => {
  it("loads the committed portfolio file from disk", () => {
    const onDisk = JSON.parse(
      readFileSync(join(process.cwd(), "data/factory/staged-specs.json"), "utf-8")
    ) as { specs: PageSpec[] };
    expect(onDisk.specs.map((s) => s.page_spec_id)).toEqual(COMMITTED.map((s) => s.page_spec_id));
  });

  it("is the seven doors the trial actually serves", () => {
    expect(SHIPPED).toHaveLength(7);
    expect(new Set(SHIPPED.map((s) => s.canonical_path)).size).toBe(7);
    for (const spec of SHIPPED) {
      expect(spec.canonical_path, spec.page_spec_id).toMatch(/^\/problems\/[a-z0-9-]+$/);
    }
  });
});

/* ── F1 ─────────────────────────────────────────────────────────────────── */

describe("F1 — the owner can edit every shipped page", () => {
  it("all seven pass the pre-QA lint", () => {
    const blocked = SHIPPED.filter((s) => !lintPageBeforeQa(s).passed).map((s) => ({
      page: s.page_spec_id,
      findings: lintPageBeforeQa(s).findings.map((f) => `${f.check}@${f.where}`),
    }));
    expect(blocked).toEqual([]);
  });

  it("the urgency block of every shipped page satisfies urgency.sourced specifically", () => {
    for (const spec of SHIPPED) {
      const urgency = spec.content_blocks.find((b) => b.kind === "when_urgency_changes");
      expect(urgency, spec.page_spec_id).toBeDefined();
      expect(urgency!.source_fact_bundle_ids.length, spec.page_spec_id).toBeGreaterThan(0);
    }
  });

  it("an owner edit to EVERY shipped page saves rather than being blocked", async () => {
    for (const spec of SHIPPED) {
      const result = await editStagedPage(
        {
          page: registryRowFor(spec, spec.created_at),
          previousSpec: spec,
          edit: { h1: `${spec.h1} ` },
          edited_by: "owner",
          now: NOW,
        },
        () => null
      );
      expect(result.blocked, spec.page_spec_id).toEqual([]);
      expect(result.spec, spec.page_spec_id).not.toBeNull();
      expect(result.spec!.version).toBe(spec.version + 1);
      // The edit is a NEW version at PENDING — never a rewrite carrying a
      // stale verdict forward.
      expect(result.spec!.qa.state).toBe("PENDING");
    }
  });

  it("THE LIVE PROOF: POST /api/admin/pages/edit on the door the inspector used", async () => {
    const target = COMMITTED.find((s) => s.page_spec_id === "ps_ac_blowing_warm_air_v1")!;
    const form = new FormData();
    form.set("page_spec_id", target.page_spec_id);
    form.set("title", target.title);
    form.set("meta_description", target.meta_description);
    form.set("h1", "AC blowing warm air — what it can mean");
    form.set("hero_headline", target.hero.headline);
    form.set("hero_subheadline", target.hero.subheadline ?? "");

    const response = await editPOST(
      new Request("http://localhost/api/admin/pages/edit", { method: "POST", body: form })
    );

    expect(response.status).toBe(303);
    const location = new URL(response.headers.get("location")!);
    // Before the backfill this came back `?blocked=urgency.sourced @ blk_urgency…`.
    expect(location.searchParams.get("blocked")).toBeNull();
    expect(location.searchParams.get("saved")).toBe("h1");
  });

  it("the guardrail is NOT weakened — a directory-framing edit is still blocked", async () => {
    const target = COMMITTED[0];
    const result = await editStagedPage(
      {
        page: registryRowFor(target, target.created_at),
        previousSpec: target,
        edit: { meta_description: "Compare providers and choose from hundreds of contractors." },
        edited_by: "owner",
        now: NOW,
      },
      () => null
    );
    expect(result.spec).toBeNull();
    expect(result.blocked.map((f) => f.check)).toContain("no_directory_framing");
  });

  it("and an unsourced urgency block is still blocked — the F1 rule stands", () => {
    const stripped: PageSpec = {
      ...COMMITTED[0],
      content_blocks: COMMITTED[0].content_blocks.map((b) =>
        b.kind === "when_urgency_changes" ? { ...b, source_fact_bundle_ids: [] } : b
      ),
    };
    const lint = lintPageBeforeQa(stripped);
    expect(lint.passed).toBe(false);
    expect(lint.findings.map((f) => f.check)).toContain("urgency.sourced");
  });
});

/* ── F2 ─────────────────────────────────────────────────────────────────── */

describe("F2 — every shipped page carries real provenance", () => {
  it("provenance.present holds for all seven — A06's future check would pass", () => {
    for (const spec of SHIPPED) {
      expect(provenanceProblems(spec), spec.page_spec_id).toEqual([]);
    }
  });

  it("every block of every shipped page cites at least one bundle", () => {
    for (const spec of SHIPPED) {
      for (const block of spec.content_blocks) {
        expect(
          block.source_fact_bundle_ids.length,
          `${spec.page_spec_id}/${block.block_id}`
        ).toBeGreaterThan(0);
      }
    }
  });

  it("every cited bundle id RESOLVES to a real, registered bundle", () => {
    const known = new Set(REGISTERED_BUNDLES.map((b) => b.fact_bundle_id));
    for (const spec of SHIPPED) {
      const cited = new Set([
        ...spec.source_fact_bundle_ids,
        ...spec.content_blocks.flatMap((b) => b.source_fact_bundle_ids),
      ]);
      expect(cited.size, spec.page_spec_id).toBeGreaterThan(0);
      for (const id of cited) {
        expect(known.has(id), `${spec.page_spec_id} cites unknown bundle ${id}`).toBe(true);
      }
    }
  });

  it("every registered bundle is a real FactBundle, first-party, no external citation", () => {
    for (const bundle of REGISTERED_BUNDLES) {
      expect(() => FactBundle.parse(bundle), bundle.fact_bundle_id).not.toThrow();
      expect(bundle.rights_class, bundle.fact_bundle_id).toBe("first_party");
      for (const fact of bundle.facts) {
        expect([CONTENT_BANK_SOURCE_TYPE, HANDCRAFTED_DOOR_SOURCE_TYPE]).toContain(fact.source_type);
        expect(fact.source_url).toMatch(/^prn:\/\//);
        expect(fact.source_url).not.toMatch(/^https?:/);
      }
    }
  });

  it("the backfilled ids are EXACTLY what the generator mints today", () => {
    for (const spec of COMMITTED) {
      const minted = regenerate(spec);
      expect(spec.source_fact_bundle_ids, spec.page_spec_id).toEqual(minted.source_fact_bundle_ids);
      for (const block of spec.content_blocks) {
        const mintedBlock = minted.content_blocks.find((b) => b.block_id === block.block_id)!;
        expect(
          block.source_fact_bundle_ids,
          `${spec.page_spec_id}/${block.block_id}`
        ).toEqual(mintedBlock.source_fact_bundle_ids);
      }
    }
  });

  it("the six generated doors cite the content bank their copy came from", () => {
    for (const spec of COMMITTED) {
      expect(spec.source_fact_bundle_ids, spec.page_spec_id).toEqual([contentBankBundleId("hvac")]);
    }
  });

  it("the CITATION IS HONEST — the cited bundle really contains each block's text", () => {
    for (const spec of COMMITTED) {
      const bundle = REGISTERED_BUNDLES.find(
        (b) => b.fact_bundle_id === spec.source_fact_bundle_ids[0]
      )!;
      for (const block of spec.content_blocks) {
        const fact = bundle.facts.find((f) => f.fact_id.endsWith(`_${block.kind}`));
        expect(fact, `${spec.page_spec_id}/${block.kind}`).toBeDefined();
        // The bank's intent_answer is keyword-templated; every other statement
        // is verbatim.
        const statement = fact!.statement.split("{keyword}").join(spec.primary_query);
        expect(statement, `${spec.page_spec_id}/${block.block_id}`).toBe(block.body_md);
      }
    }
  });

  it("the handcrafted door cites its OWN copy, never the content bank's", () => {
    expect(SAMPLE_PAGE_SPEC.source_fact_bundle_ids).toEqual([SAMPLE_PAGE_BUNDLE.fact_bundle_id]);
    expect(SAMPLE_PAGE_SPEC.source_fact_bundle_ids).not.toContain(contentBankBundleId("hvac"));
    for (const block of SAMPLE_PAGE_SPEC.content_blocks) {
      const fact = SAMPLE_PAGE_BUNDLE.facts.find((f) => f.fact_id.endsWith(`_${block.block_id}`));
      expect(fact, block.block_id).toBeDefined();
      expect(fact!.statement).toBe(block.body_md);
    }
  });
});

describe("F2 — the backfill changed provenance and NOTHING else", () => {
  it("every committed door still reproduces byte-for-byte from the generator", () => {
    for (const spec of COMMITTED) {
      const minted = regenerate(spec);
      // qa/user_value_score are stamped by the runner AFTER compile, so they are
      // compared separately below; everything else must be identical.
      expect({ ...spec, qa: null, user_value_score: null }, spec.page_spec_id).toEqual({
        ...minted,
        qa: null,
        user_value_score: null,
      });
    }
  });

  it("the six qa:PASS pages still PASS the shipped deterministic QA", () => {
    const results = qaCandidatePages(COMMITTED, [SAMPLE_PAGE_SPEC]);
    expect(results).toHaveLength(6);
    for (const result of results) {
      const spec = COMMITTED.find((s) => s.page_spec_id === result.page_spec_id)!;
      expect(result.state, result.page_spec_id).toBe("PASS");
      expect(result.reasons, result.page_spec_id).toEqual([]);
      // Queue eligibility is unchanged: same verdict, same score as committed.
      expect(result.state, result.page_spec_id).toBe(spec.qa.state);
      expect(result.user_value_score, result.page_spec_id).toBe(spec.user_value_score);
    }
  });

  it("no QA state, score or lifecycle status was touched by the backfill", () => {
    for (const spec of COMMITTED) {
      expect(spec.qa.state, spec.page_spec_id).toBe("PASS");
      expect(spec.status, spec.page_spec_id).toBe("STAGED");
      expect(spec.version, spec.page_spec_id).toBe(1);
      expect(spec.user_value_score, spec.page_spec_id).not.toBeNull();
    }
    expect(SAMPLE_PAGE_SPEC.qa.state).toBe("PENDING");
    expect(SAMPLE_PAGE_SPEC.version).toBe(1);
  });
});

/* ── F4 ─────────────────────────────────────────────────────────────────── */

describe("F4 — every shipped page matches the template it claims", () => {
  it("resolves and matches, slot for slot, for all seven", () => {
    for (const spec of SHIPPED) {
      const template = resolveTemplate(spec.template_id, spec.template_version);
      expect(template, `${spec.page_spec_id} claims ${spec.template_id}@${spec.template_version}`)
        .not.toBeNull();
      expect(templateMatchesBlocks(template!, spec.content_blocks), spec.page_spec_id).toEqual([]);
    }
  });

  it("the six generated doors claim the five-slot factory template", () => {
    for (const spec of COMMITTED) {
      expect(spec.template_id, spec.page_spec_id).toBe("tpl_intent_page");
      expect(spec.content_blocks).toHaveLength(5);
    }
  });

  it("the handcrafted door claims the template that declares its FAQ block", () => {
    expect(SAMPLE_PAGE_SPEC.template_id).toBe("tpl_intent_page_faq");
    expect(SAMPLE_PAGE_SPEC.content_blocks.map((b) => b.kind)).toContain("faq");
  });
});
