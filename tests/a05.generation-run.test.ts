import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SearchOpportunity } from "@/domain/search/contracts";
import { compilePageSpec } from "@/domain/search/factory";
import { PageFactoryPolicy } from "@/domain/search/page-factory-policy";
import { stageNewPage } from "@/domain/search/page-registry";
import { IntentPage } from "@/domain/search/pages";
import { EVENT_NAMES } from "@/platform/events/names";
import {
  engageKillSwitch,
  releaseKillSwitch,
  resetKillSwitchForTests,
} from "@/platform/killswitch";
import { recentAgentRuns, resetAgentRunLedgerForTests } from "@/platform/runs/ledger";
import {
  A05_EMITTED_EVENT_NAMES,
  A05_PROPOSED_TO_A08,
} from "@/platform/search/page-events";
import {
  cannibalizationConflict,
  regenerateExistingPage,
  runPageFactory,
} from "@/platform/search/page-factory-run";
import { pageRegistryStore } from "@/platform/search/page-registry-store";

/**
 * A05 step 6 — THE GENERATION RUN. Admin-triggered and A04-triggered, both
 * idempotent on opportunity_id (C9 / pre-answer 6); kill switch as a hard stop
 * (C11/C12b); the cannibalization pre-gate reusing A04's extracted helper
 * (C13 / coherence issue 15); one ledger row per run; A08-registered event
 * names only (C7 / pre-answer 7).
 */

const NOW = () => "2026-08-24T00:00:00Z";
let tmp: string;

function opp(overrides: Partial<SearchOpportunity> = {}): SearchOpportunity {
  return {
    search_opportunity_id: "so_run_1",
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
    ...overrides,
  } as unknown as SearchOpportunity;
}

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    opportunities: [opp()],
    existingPages: [] as IntentPage[],
    existingSpecs: [],
    maxPages: 10,
    now: NOW,
    trigger: "admin_action" as const,
    ...overrides,
  };
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "prn-a05-"));
  process.env.PRN_DEV_DB_PATH = join(tmp, "dev-db.json");
  resetAgentRunLedgerForTests();
  resetKillSwitchForTests();
});

afterEach(() => {
  delete process.env.PRN_DEV_DB_PATH;
  rmSync(tmp, { recursive: true, force: true });
});

describe("the run stages a page and persists both writes", () => {
  it("produces a staged spec and a registry row at STAGED", async () => {
    const result = await runPageFactory(baseInput(), () => null);
    expect(result.halted).toBeNull();
    expect(result.staged).toHaveLength(1);
    expect(result.staged[0].page.lifecycle_status).toBe("STAGED");
    expect(result.staged[0].spec.qa.state).toBe("PENDING");

    const store = pageRegistryStore(() => null);
    expect(await store.listPages()).toHaveLength(1);
    expect(await store.listSpecs()).toHaveLength(1);
  });

  it("writes exactly ONE ledger row per run, with zero cost measured not guessed", async () => {
    await runPageFactory(baseInput({ opportunities: [opp(), opp({ search_opportunity_id: "so_2", keyword: "furnace not working" })] }), () => null);
    const runs = recentAgentRuns().filter((r) => r.agent_id === "A05");
    expect(runs).toHaveLength(1);
    expect(runs[0].trigger).toBe("admin_action");
    expect(runs[0].cost_usd).toBe(0);
    expect(runs[0].capabilities_used).toEqual(["seo.build_candidate_pages"]);
  });

  it("the ledger row carries IDs and counts only — never page copy", async () => {
    await runPageFactory(baseInput(), () => null);
    const [run] = recentAgentRuns().filter((r) => r.agent_id === "A05");
    const serialized = JSON.stringify(run);
    expect(serialized).not.toMatch(/heating-and-cooling complaint pattern/);
    expect(serialized).toMatch(/page_ids/);
  });
});

describe("IDEMPOTENT ON opportunity_id", () => {
  it("running twice produces one page, not two", async () => {
    const first = await runPageFactory(baseInput(), () => null);
    expect(first.staged).toHaveLength(1);

    const second = await runPageFactory(
      baseInput({ existingSpecs: [first.staged[0].spec], existingPages: [first.staged[0].page] }),
      () => null
    );
    expect(second.staged).toHaveLength(0);
    expect(second.skipped[0].reason).toBe("already_has_page");
    expect(await pageRegistryStore(() => null).listPages()).toHaveLength(1);
  });

  it("two candidates in ONE batch cannot both claim the same intent family", async () => {
    const result = await runPageFactory(
      baseInput({
        opportunities: [
          opp(),
          opp({ search_opportunity_id: "so_dup", keyword: "why is my ac blowing warm air" }),
        ],
      }),
      () => null
    );
    expect(result.staged).toHaveLength(1);
    expect(result.skipped[0].reason).toBe("cannibalizes_existing");
  });
});

describe("the owner's decision is still the only gate (seam 2)", () => {
  it("an un-approved candidate produces nothing", async () => {
    const result = await runPageFactory(
      baseInput({ opportunities: [opp({ status: "candidate" })] }),
      () => null
    );
    expect(result.staged).toHaveLength(0);
    expect(result.skipped[0].reason).toBe("not_owner_approved");
  });

  it("an approved EXPAND is skipped with C18's reason, not built", async () => {
    const result = await runPageFactory(
      baseInput({ opportunities: [opp({ recommendation: "EXPAND" })] }),
      () => null
    );
    expect(result.staged).toHaveLength(0);
    expect(result.skipped[0].reason).toBe("not_new_page_eligible");
    expect(result.skipped[0].detail).toMatch(/GROWS an existing page/);
  });
});

describe("the kill switch is a HARD STOP, before any work (C11/C12b)", () => {
  it("an engaged agent switch halts the run with no page and no ledger row", async () => {
    await engageKillSwitch(
      { scope: "AGENT", scope_ref: "A05", by: "owner", reason: "pausing the factory" },
      () => null
    );
    const result = await runPageFactory(baseInput(), () => null);
    expect(result.halted).not.toBeNull();
    expect(result.halted!.scope).toBe("AGENT");
    expect(result.staged).toHaveLength(0);
    expect(await pageRegistryStore(() => null).listPages()).toHaveLength(0);
    expect(recentAgentRuns().filter((r) => r.agent_id === "A05")).toHaveLength(0);
  });

  it("GLOBAL halts it too, and releasing lets it run again", async () => {
    await engageKillSwitch({ scope: "GLOBAL", by: "owner" }, () => null);
    expect((await runPageFactory(baseInput(), () => null)).halted?.scope).toBe("GLOBAL");
    await releaseKillSwitch({ scope: "GLOBAL", by: "owner" }, () => null);
    expect((await runPageFactory(baseInput(), () => null)).staged).toHaveLength(1);
  });

  it("halts regeneration as well as generation", async () => {
    await engageKillSwitch({ scope: "AGENT", scope_ref: "A05", by: "owner" }, () => null);
    const previous = compilePageSpec(opp(), { now: NOW });
    const { page } = stageNewPage(opp(), { now: NOW });
    const result = await regenerateExistingPage(
      { page, previousSpec: previous, opportunity: opp(), reason: "test", trigger: "admin_action" },
      () => null
    );
    expect(result.halted).not.toBeNull();
    expect(result.staged).toHaveLength(0);
  });
});

describe("the lint pre-filter blocks a page before it reaches A06", () => {
  it("a page with directory framing never gets staged or persisted", async () => {
    const policy = PageFactoryPolicy.parse({
      content_families: {
        hvac: {
          intent_answer: "Compare providers for {keyword} and choose from hundreds of contractors.",
          safe_checks: "- x",
          do_not_do: "- y",
          when_urgency_changes: "Urgent if there is a burning smell.",
          who_handles_it: "z",
          safety_note_required: false,
        },
      },
    });
    const result = await runPageFactory(baseInput({ policy }), () => null);
    expect(result.staged).toHaveLength(0);
    expect(result.skipped[0].reason).toBe("lint_blocked");
    expect(result.skipped[0].findings?.[0].check).toBe("no_directory_framing");
    expect(await pageRegistryStore(() => null).listPages()).toHaveLength(0);
  });

  it("manufactured urgency blocks it too", async () => {
    const policy = PageFactoryPolicy.parse({
      content_families: {
        hvac: {
          intent_answer: "About {keyword}, a long enough answer to clear the thin-content bar in QA.",
          safe_checks: "- x",
          do_not_do: "- y",
          when_urgency_changes: "Act now before it's too late — this will only get worse.",
          who_handles_it: "z",
          safety_note_required: false,
        },
      },
    });
    const result = await runPageFactory(baseInput({ policy }), () => null);
    expect(result.skipped[0].reason).toBe("lint_blocked");
    expect(result.skipped[0].detail).toMatch(/urgency\.no_scarcity/);
  });
});

describe("regeneration", () => {
  it("maps REFRESH -> STAGED, bumps the version and repoints the registry row", async () => {
    const first = await runPageFactory(baseInput(), () => null);
    const published = IntentPage.parse({
      ...first.staged[0].page,
      lifecycle_status: "PUBLISHED",
      published_at: "2026-08-24T01:00:00Z",
    });

    const result = await regenerateExistingPage(
      {
        page: published,
        previousSpec: first.staged[0].spec,
        opportunity: opp(),
        reason: "owner approved a template change",
        trigger: "admin_action",
        now: NOW,
      },
      () => null
    );
    expect(result.staged[0].regenerated).toBe(true);
    expect(result.staged[0].spec.version).toBe(2);
    expect(result.staged[0].page.lifecycle_status).toBe("STAGED");
    expect(result.staged[0].page.current_page_spec_id).toBe(result.staged[0].spec.page_spec_id);
  });

  it("emits page.refreshed — the shipped name for A05 §5's page.regenerated", async () => {
    const first = await runPageFactory(baseInput(), () => null);
    const result = await regenerateExistingPage(
      {
        page: first.staged[0].page,
        previousSpec: first.staged[0].spec,
        opportunity: opp(),
        reason: "refresh",
        trigger: "admin_action",
        now: NOW,
      },
      () => null
    );
    expect(result.events).toHaveLength(1);
  });
});

describe("A05 mints NO event names (C7 / pre-answer 7)", () => {
  it("every name A05 emits is already in A08's dictionary", () => {
    for (const name of A05_EMITTED_EVENT_NAMES) {
      expect(EVENT_NAMES as readonly string[], name).toContain(name);
    }
  });

  it("the three canon-named events are PROPOSED, not emitted — they would throw", () => {
    for (const proposal of A05_PROPOSED_TO_A08) {
      expect(EVENT_NAMES as readonly string[], proposal.canon_name).not.toContain(
        proposal.canon_name
      );
      expect(A05_EMITTED_EVENT_NAMES as readonly string[]).not.toContain(proposal.canon_name);
    }
  });

  it("page.published stays UNEMITTED — coherence issue 9 assigns it to A06", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(
      join(process.cwd(), "src/platform/search/page-events.ts"),
      "utf-8"
    );
    expect(source).not.toMatch(/event_name:\s*"page\.published"/);
    expect(A05_EMITTED_EVENT_NAMES as readonly string[]).not.toContain("page.published");
  });
});

describe("the cannibalization pre-gate REUSES A04's helper, and A06 does not", () => {
  it("catches a path clash and an intent-family overlap", () => {
    const page = IntentPage.parse({
      page_id: "page_x",
      schema_version: "1.0.0",
      canonical_path: "/problems/ac-blowing-warm-air",
      current_page_spec_id: "ps_x",
      lifecycle_status: "STAGED",
      published_at: null,
      retired_at: null,
      redirect_to_path: null,
      created_at: "2026-08-24T00:00:00Z",
    });
    expect(
      cannibalizationConflict("anything", "/problems/ac-blowing-warm-air", [], [page])
    ).toMatch(/already occupies/);

    const spec = compilePageSpec(opp(), { now: NOW });
    expect(cannibalizationConflict("why is my ac blowing warm air", "/problems/other", [spec], []))
      .toMatch(/intent overlaps/);
  });

  it("a RETIRED page does not block its own path being reclaimed", () => {
    const retired = IntentPage.parse({
      page_id: "page_r",
      schema_version: "1.0.0",
      canonical_path: "/problems/gone",
      current_page_spec_id: null,
      lifecycle_status: "RETIRED",
      published_at: null,
      retired_at: "2026-08-24T00:00:00Z",
      redirect_to_path: null,
      created_at: "2026-08-24T00:00:00Z",
    });
    expect(cannibalizationConflict("gone", "/problems/gone", [], [retired])).toBeNull();
  });

  it("A05 imports the extracted helper; A06's qa module must not import A05's", async () => {
    const { readFileSync } = await import("node:fs");
    const run = readFileSync(
      join(process.cwd(), "src/platform/search/page-factory-run.ts"),
      "utf-8"
    );
    expect(run).toMatch(/from "@\/domain\/search\/intent-family"/);
    const qa = readFileSync(join(process.cwd(), "src/domain/search/qa.ts"), "utf-8");
    expect(qa).not.toMatch(/page-factory-run/);
  });
});

describe("A05 never touches the publish path", () => {
  it("the run module contains no publish call and no qa.state write", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(
      join(process.cwd(), "src/platform/search/page-factory-run.ts"),
      "utf-8"
    );
    expect(source).not.toMatch(/setPublished/);
    expect(source).not.toMatch(/published_page/);
    expect(source).not.toMatch(/qa:\s*\{\s*state:\s*"PASS"/);
  });

  it("a staged page is never published and never monetization-eligible", async () => {
    const result = await runPageFactory(baseInput(), () => null);
    expect(result.staged[0].page.published_at).toBeNull();
    expect(result.staged[0].spec.monetization_eligible).toBe(false);
  });
});
