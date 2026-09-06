import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SAMPLE_PAGE_SPEC } from "@/domain/search/fixtures/sample-page-spec";
import { registryRowFor, regeneratePage } from "@/domain/search/page-registry";
import { IntentPage, PageSpec } from "@/domain/search/pages";
import { importSeedRows, type SeedFile } from "@/domain/search/importer";
import { runPageQaSync } from "@/domain/search/qa";
import { loadStaged } from "@/platform/admin/data";
import { resetApprovalCenterForTests } from "@/platform/approvals/center";
import { currentEventDefinition } from "@/platform/events/dictionary";
import { EVENT_NAMES } from "@/platform/events/names";
import { resetKillSwitchForTests } from "@/platform/killswitch";
import { resetAgentRunLedgerForTests } from "@/platform/runs/ledger";
import { A06_EMITTED_EVENT_NAMES } from "@/platform/search/page-qa-events";
import { pagesAwaitingQa, runPageQaBatch } from "@/platform/search/page-qa-run";
import { readFileSync } from "node:fs";

/**
 * A06 STEP 7 — DEFECT EVENTS AND THE REGENERATION TRIGGER.
 *
 * The done-when is specific: `page.defect_found` must always carry enough
 * context "to later join against that page's publish status". That is only true
 * if the defect events and `page.published` share their keys, so that is what is
 * asserted here rather than merely that an event fires.
 *
 * The regeneration trigger is coherence issue 4: A06 §2/§3 names
 * `page.material_change`, which A05 never emits and which exists nowhere. The
 * fix is to subscribe to `page.refreshed` instead — implemented as the PROPERTY
 * that subscription is supposed to guarantee: a REFRESH -> STAGED page
 * re-enters QA.
 */

beforeAll(async () => {
  const dir = await mkdtemp(join(tmpdir(), "prn-a06-defects-"));
  process.env.PRN_DEV_DB_PATH = join(dir, "dev-db.json");
});

afterAll(() => {
  delete process.env.PRN_DEV_DB_PATH;
});

beforeEach(() => {
  resetKillSwitchForTests();
  resetAgentRunLedgerForTests();
  resetApprovalCenterForTests();
});

const COMMITTED = loadStaged().specs as PageSpec[];
const REGISTRY: IntentPage[] = [SAMPLE_PAGE_SPEC, ...COMMITTED].map((s) =>
  registryRowFor(s, s.created_at)
);
const noDb = () => null;

/** The same page, broken two different ways, so a repair is observable. */
// Exercise the generic refresh contract on an existing generic door. The AC
// warm-air intent now binds frozen v43 and correctly fails its production gate.
const HEALTHY = COMMITTED.find((spec) => spec.primary_query === "furnace blowing cold air")!;
const BROKEN_PROVENANCE = PageSpec.parse({ ...HEALTHY, source_fact_bundle_ids: [] });

describe("the defect events are registered by A08, not minted by A06", () => {
  it("every name A06 emits carries an APPROVED EventDefinition", () => {
    for (const name of A06_EMITTED_EVENT_NAMES) {
      expect(EVENT_NAMES as readonly string[], name).toContain(name);
      expect(currentEventDefinition(name)?.status, name).toBe("approved");
    }
  });

  it("the prefixed spelling is the registered one — A06 §5's bare names fail the shipped regex", () => {
    expect(EVENT_NAMES as readonly string[]).toContain("page.defect_found");
    expect(EVENT_NAMES as readonly string[]).toContain("page.defect_repaired");
    expect(EVENT_NAMES as readonly string[]).not.toContain("defect_found");
    expect(EVENT_NAMES as readonly string[]).not.toContain("defect_repaired");
  });
});

describe("page.defect_found carries enough context to JOIN AGAINST PUBLISH STATUS", () => {
  const EVENTS_SOURCE = readFileSync(
    join(process.cwd(), "src/platform/search/page-qa-events.ts"),
    "utf-8"
  );
  const ROUTE_SOURCE = readFileSync(
    join(process.cwd(), "src/app/api/admin/pages/publish/route.ts"),
    "utf-8"
  );
  const RUN_SOURCE = readFileSync(
    join(process.cwd(), "src/platform/search/page-qa-run.ts"),
    "utf-8"
  );

  /**
   * THE JOIN, stated as a property: the keys a defect carries must be the keys
   * the publish event carries, or defect-escape rate is a guess. Both sides are
   * built from the same `joinContext` / literal set.
   */
  it("defect events and page.published share page_id, page_spec_id and canonical_path", () => {
    for (const key of ["page_id", "page_spec_id", "canonical_path", "search_opportunity_id"]) {
      expect(RUN_SOURCE, `run emits ${key}`).toMatch(new RegExp(`${key}:`));
      expect(ROUTE_SOURCE, `publish emits ${key}`).toMatch(new RegExp(`${key}:`));
    }
  });

  it("a defect also names the check, the severity, where, and which rule set said so", async () => {
    const run = await runPageQaBatch(
      { specs: [BROKEN_PROVENANCE], registry: REGISTRY, trigger: "admin_action", persist: false },
      noDb
    );
    expect(run.results[0].state).toBe("FAIL");
    expect(run.defects_found).toBe(run.results[0].blockers.length);
    expect(run.defects_found).toBeGreaterThan(0);
    // The emitting surface is one file and the context keys are literals in it.
    for (const key of ["check:", "severity:", "where:", "rule_set_version:"]) {
      expect(RUN_SOURCE, key).toContain(key);
    }
    expect(EVENTS_SOURCE).toMatch(/never the copy that failed/);
  });

  it("a passing page raises no defect at all", async () => {
    const run = await runPageQaBatch(
      { specs: [HEALTHY], registry: REGISTRY, trigger: "admin_action", persist: false },
      noDb
    );
    expect(run.results[0].state).toBe("PASS");
    expect(run.defects_found).toBe(0);
    expect(run.defects_repaired).toBe(0);
  });
});

describe("page.defect_repaired — a defect that WAS raised and is not any more", () => {
  it("fires once per blocker that disappeared between two runs", async () => {
    const first = await runPageQaBatch(
      { specs: [BROKEN_PROVENANCE], registry: REGISTRY, trigger: "admin_action", persist: false },
      noDb
    );
    expect(first.defects_found).toBeGreaterThan(0);
    expect(first.defects_repaired).toBe(0);

    const second = await runPageQaBatch(
      {
        specs: [HEALTHY],
        registry: REGISTRY,
        previous: first.results,
        trigger: "admin_action",
        persist: false,
      },
      noDb
    );
    expect(second.results[0].state).toBe("PASS");
    expect(second.defects_found).toBe(0);
    expect(second.defects_repaired).toBe(first.defects_found);
  });

  it("a defect that PERSISTS is found again, and never counted as repaired", async () => {
    const first = await runPageQaBatch(
      { specs: [BROKEN_PROVENANCE], registry: REGISTRY, trigger: "admin_action", persist: false },
      noDb
    );
    const second = await runPageQaBatch(
      {
        specs: [BROKEN_PROVENANCE],
        registry: REGISTRY,
        previous: first.results,
        trigger: "admin_action",
        persist: false,
      },
      noDb
    );
    expect(second.defects_repaired).toBe(0);
    expect(second.defects_found).toBe(first.defects_found);
  });

  it("with no previous run supplied, nothing is claimed repaired — absence is not a repair", async () => {
    const run = await runPageQaBatch(
      { specs: [HEALTHY], registry: REGISTRY, trigger: "admin_action", persist: false },
      noDb
    );
    expect(run.defects_repaired).toBe(0);
  });
});

describe("the regeneration trigger (coherence issue 4) — a REFRESH page re-enters QA", () => {
  const seedFile = JSON.parse(
    readFileSync(join(process.cwd(), "tests", "fixtures", "seed-research", "seed-rows.json"), "utf-8")
  ) as SeedFile;
  const opportunity = {
    ...importSeedRows(seedFile, "2026-08-14T00:00:00Z").find(
      (o) => o.keyword === "furnace blowing cold air"
    )!,
    recommendation: "NEW" as const,
    status: "approved" as const,
  };

  it("A06 subscribes to no page.material_change — it has no producer anywhere", () => {
    for (const module of [
      "src/platform/search/page-qa-run.ts",
      "src/platform/search/page-qa-events.ts",
      "src/domain/search/qa.ts",
    ]) {
      // Comments stripped: the run module's header RECORDS that the name was
      // struck and why, which is the opposite of relying on it.
      const code = readFileSync(join(process.cwd(), module), "utf-8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      expect(code, module).not.toMatch(/page\.material_change/);
    }
    expect(EVENT_NAMES as readonly string[]).not.toContain("page.material_change");
  });

  /**
   * A05's regeneration takes a PUBLISHED page through REFRESH -> STAGED and
   * resets qa.state to PENDING. That reset is the handoff; this is A06 picking
   * it up. Implemented as a QUERY over state rather than a message on a bus that
   * does not exist — a refresh whose event was lost is still picked up next run,
   * which is strictly more reliable than a subscription with no durable delivery.
   */
  it("A05's regeneration produces exactly the state A06's trigger looks for", () => {
    const published = IntentPage.parse({
      ...REGISTRY.find((p) => p.page_id === HEALTHY.page_id)!,
      lifecycle_status: "PUBLISHED",
      published_at: "2026-08-24T00:00:00Z",
    });
    const regenerated = regeneratePage(published, HEALTHY, opportunity, {
      now: () => "2026-08-25T00:00:00Z",
    }, "content refresh");

    expect(regenerated.transitions.map((t) => `${t.from}->${t.to}`)).toEqual([
      "PUBLISHED->REFRESH",
      "REFRESH->STAGED",
    ]);
    expect(regenerated.spec.qa.state).toBe("PENDING");
    expect(regenerated.page.lifecycle_status).toBe("STAGED");

    // ...and A06 sees it as owed a run.
    expect(pagesAwaitingQa([regenerated.spec], [regenerated.page]).map((s) => s.page_spec_id)).toEqual([
      regenerated.spec.page_spec_id,
    ]);
  });

  it("a regenerated page actually gets re-checked, and carries a fresh verdict", async () => {
    const published = IntentPage.parse({
      ...REGISTRY.find((p) => p.page_id === HEALTHY.page_id)!,
      lifecycle_status: "PUBLISHED",
      published_at: "2026-08-24T00:00:00Z",
    });
    const regenerated = regeneratePage(published, HEALTHY, opportunity, {
      now: () => "2026-08-25T00:00:00Z",
    }, "content refresh");

    const awaiting = pagesAwaitingQa([regenerated.spec], [regenerated.page]);
    const run = await runPageQaBatch(
      {
        specs: awaiting,
        existing: [],
        registry: [regenerated.page],
        trigger: "job",
        persist: false,
      },
      noDb
    );
    expect(run.results).toHaveLength(1);
    expect(run.results[0].page_spec_id).toBe(regenerated.spec.page_spec_id);
    expect(run.transitions).toEqual([
      { page_id: regenerated.page.page_id, from: "STAGED", to: "QA_PASS" },
    ]);
  });

  it("a page already carrying a verdict is NOT re-queued — the trigger is refresh, not a loop", () => {
    expect(pagesAwaitingQa(COMMITTED, REGISTRY)).toEqual([]);
  });

  it("a stale PASS never rides through a refresh — the regenerated spec starts PENDING", () => {
    const published = IntentPage.parse({
      ...REGISTRY.find((p) => p.page_id === HEALTHY.page_id)!,
      lifecycle_status: "PUBLISHED",
      published_at: "2026-08-24T00:00:00Z",
    });
    const regenerated = regeneratePage(published, HEALTHY, opportunity, {
      now: () => "2026-08-25T00:00:00Z",
    }, "content refresh");
    expect(HEALTHY.qa.state).toBe("PASS");
    expect(regenerated.spec.qa.state).toBe("PENDING");
    expect(regenerated.spec.user_value_score).toBeNull();
    // Which means it is NOT publishable until A06 runs again — the publish
    // gate's recorded-verdict conjunct refuses it.
    expect(runPageQaSync(regenerated.spec).state).toBe("PASS");
  });
});
