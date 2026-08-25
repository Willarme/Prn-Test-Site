import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SearchOpportunity } from "@/domain/search/contracts";
import { pageEligibleIntent } from "@/domain/search/factory";
import { DEFAULT_PAGE_ELIGIBLE_INTENT_TYPES, TRIAL_DEFAULT_SEO_FACTORY_POLICY } from "@/domain/search/policy";
import { resetApprovalCenterForTests } from "@/platform/approvals/center";
import { loadOpportunities } from "@/platform/admin/data";
import { resetAgentRunLedgerForTests } from "@/platform/runs/ledger";
import { resetKillSwitchForTests } from "@/platform/killswitch";
import { decideOpportunity } from "@/platform/search/opportunity-decisions";
import { runPageFactory } from "@/platform/search/page-factory-run";
import { pageRegistryStore } from "@/platform/search/page-registry-store";

/**
 * INSPECTION F3 — `page_eligible_intent_types` was enforced in ONE place that
 * neither shipped run mode calls.
 *
 * THE DEFECT, EXACTLY. The rule "doors are PROBLEM-intent pages" was moved out
 * of a CLI comment and into owner-editable policy — and then read only by
 * `tools/run-factory.ts`. A grep for the field name found it in the schema, in
 * that script, and nowhere else. Both shipped run modes (the admin route
 * /api/admin/pages/generate, and A04's approval hook in decideOpportunity) call
 * `runPageFactory` directly, which had never heard of the field. Proven live:
 * owner-accepting the seeded tool-intent opportunity "uuid generator" built a
 * door page titled "Uuid Generator" carrying breaker-panel and burning-smell
 * safety guidance from the GENERIC content-bank family.
 *
 * WHY THE OLD TESTS MISSED IT. TRIGGER 1's suite reads the route's SOURCE TEXT
 * with regexes; TRIGGER 2's suite only ever passed problem-intent fixtures. A
 * rule can be absent from every code path and still satisfy both. These tests
 * run the real opportunity through both real run modes instead.
 */

const NOW = () => "2026-08-24T00:00:00Z";

/** The seeded tool-intent opportunity the live proof used. */
const UUID_GENERATOR_ID = "so_seed_uuid_generator_27ba84ae";

/**
 * The CONTROL: a seeded PROBLEM-intent opportunity that no shipped door already
 * occupies, so "zero pages" can only mean the intent gate and never the
 * cannibalization pre-gate. Most seeded problem keywords are already doors.
 */
const WATER_HEATER_ID = "so_seed_water_heater_leaking_from_bottom_cbcffd06";

let tmp: string;
let unlocked = true;
vi.mock("@/platform/admin/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/platform/admin/auth")>();
  return { ...actual, isAdminUnlocked: async () => unlocked };
});

let generatePOST: (request: Request) => Promise<Response>;

function committed(id: string): SearchOpportunity {
  const found = loadOpportunities().opportunities.find((o) => o.search_opportunity_id === id);
  if (!found) throw new Error(`no committed opportunity ${id}`);
  return found;
}

function generateRequest(body: unknown): Request {
  return new Request("http://localhost/api/admin/pages/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  ({ POST: generatePOST } = await import("@/app/api/admin/pages/generate/route"));
});

beforeEach(() => {
  unlocked = true;
  tmp = mkdtempSync(join(tmpdir(), "prn-a05-intent-"));
  process.env.PRN_DEV_DB_PATH = join(tmp, "dev-db.json");
  resetApprovalCenterForTests();
  resetAgentRunLedgerForTests();
  resetKillSwitchForTests();
});

afterEach(() => {
  delete process.env.PRN_DEV_DB_PATH;
  rmSync(tmp, { recursive: true, force: true });
});

afterAll(() => {
  delete process.env.PRN_DEV_DB_PATH;
});

describe("the committed portfolio is what makes this real, not a fixture", () => {
  it("the seeded queue really does carry tool-intent opportunities", () => {
    const byIntent = loadOpportunities().opportunities.reduce<Record<string, number>>((acc, o) => {
      acc[o.intent_type] = (acc[o.intent_type] ?? 0) + 1;
      return acc;
    }, {});
    expect(byIntent.tool).toBeGreaterThan(0);
    expect(byIntent.problem).toBeGreaterThan(0);
  });

  it("'uuid generator' is a tool-intent opportunity A04 recommends as NEW", () => {
    const uuid = committed(UUID_GENERATOR_ID);
    expect(uuid.intent_type).toBe("tool");
    expect(uuid.recommendation).toBe("NEW");
    expect(uuid.problem_family_hint).toBeNull();
  });
});

describe("the policy value itself is untouched — the steering ruling stays parked", () => {
  it("still defaults to problem-only", () => {
    expect(TRIAL_DEFAULT_SEO_FACTORY_POLICY.page_eligible_intent_types).toEqual(["problem"]);
    expect([...DEFAULT_PAGE_ELIGIBLE_INTENT_TYPES]).toEqual(["problem"]);
  });

  it("the schema default and the enforcement fallback are ONE constant", () => {
    // Two hand-written ["problem"] literals is how a policy and its
    // enforcement drift apart. This asserts they cannot.
    expect(TRIAL_DEFAULT_SEO_FACTORY_POLICY.page_eligible_intent_types).toEqual([
      ...DEFAULT_PAGE_ELIGIBLE_INTENT_TYPES,
    ]);
  });

  it("policy.ts still carries the parked TODO-ASK-OWNER ruling", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(join(process.cwd(), "src/domain/search/policy.ts"), "utf-8");
    expect(source).toMatch(/TODO-ASK-OWNER \(Melissa\)/);
    expect(source).toMatch(/THE RULING IS PARKED AND IS NOT MADE HERE/);
  });
});

describe("the predicate refuses by name and never silently", () => {
  it("an eligible intent passes with no reason", () => {
    expect(pageEligibleIntent({ intent_type: "problem" }, ["problem"])).toEqual({
      eligible: true,
      reason: null,
    });
  });

  it("an ineligible intent comes back with the policy field named in words", () => {
    const verdict = pageEligibleIntent({ intent_type: "tool" }, ["problem"]);
    expect(verdict.eligible).toBe(false);
    expect(verdict.reason).toMatch(/page_eligible_intent_types/);
    expect(verdict.reason).toMatch(/"tool"/);
  });

  it("omitting the policy is FAIL-CLOSED — the shipped ruling applies", () => {
    expect(pageEligibleIntent({ intent_type: "tool" }).eligible).toBe(false);
    expect(pageEligibleIntent({ intent_type: "problem" }).eligible).toBe(true);
  });

  it("a widened policy really does widen it — the field still works", () => {
    expect(pageEligibleIntent({ intent_type: "tool" }, ["problem", "tool"]).eligible).toBe(true);
  });
});

describe("RUN MODE 2 — A04's approval hook (decideOpportunity)", () => {
  it("an owner-accepted TOOL opportunity builds ZERO pages and says why", async () => {
    const result = await decideOpportunity(
      { opportunity: committed(UUID_GENERATOR_ID), kind: "accept", decided_by: "owner" },
      () => null
    );

    // The owner's decision still lands — policy refuses the PAGE, not the click.
    expect(result.opportunity.status).toBe("approved");
    expect(result.page_build).not.toBeNull();
    expect(result.page_build!.staged).toEqual([]);
    // ... and it is REPORTED in its own bucket, never dropped.
    expect(result.page_build!.skipped_reasons).toEqual(["ineligible_intent"]);

    const pages = await pageRegistryStore(() => null).listPages();
    expect(pages).toEqual([]);
  });

  it("an owner-accepted PROBLEM opportunity still builds its page", async () => {
    const problem = committed(WATER_HEATER_ID);
    expect(problem.intent_type).toBe("problem");
    const result = await decideOpportunity(
      { opportunity: problem, kind: "accept", decided_by: "owner" },
      () => null
    );
    expect(result.page_build!.staged).toHaveLength(1);
    expect(result.page_build!.skipped_reasons).toEqual([]);
  });
});

describe("RUN MODE 1 — the admin generate route, driven for real", () => {
  it("an owner-approved TOOL opportunity stages nothing and reports ineligible_intent", async () => {
    // Record the owner's acceptance WITHOUT the build hook, so the route is the
    // only thing that runs the factory.
    await decideOpportunity(
      {
        opportunity: committed(UUID_GENERATOR_ID),
        kind: "accept",
        decided_by: "owner",
        build_page: false,
      },
      () => null
    );

    const response = await generatePOST(
      generateRequest({ search_opportunity_id: UUID_GENERATOR_ID })
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      staged: number;
      page_ids: string[];
      skipped_detail: Array<{ reason: string }>;
    };
    expect(body.staged).toBe(0);
    expect(body.page_ids).toEqual([]);
    expect(body.skipped_detail.map((s) => s.reason)).toEqual(["ineligible_intent"]);

    const pages = await pageRegistryStore(() => null).listPages();
    expect(pages).toEqual([]);
  });

  it("an owner-approved PROBLEM opportunity still stages a door through the route", async () => {
    const problem = committed(WATER_HEATER_ID);
    await decideOpportunity(
      { opportunity: problem, kind: "accept", decided_by: "owner", build_page: false },
      () => null
    );

    const response = await generatePOST(
      generateRequest({ search_opportunity_id: problem.search_opportunity_id })
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { staged: number; page_ids: string[] };
    expect(body.staged).toBe(1);
    expect(body.page_ids).toHaveLength(1);
  });
});

describe("the shared path enforces it, so a future entry point inherits it", () => {
  it("runPageFactory refuses an ineligible intent even with no policy handed in", async () => {
    const tool = committed(UUID_GENERATOR_ID);
    const result = await runPageFactory(
      {
        opportunities: [{ ...tool, status: "approved" } as SearchOpportunity],
        existingPages: [],
        existingSpecs: [],
        maxPages: 5,
        now: NOW,
        trigger: "admin_action",
        // eligible_intent_types deliberately omitted — the fail-closed default.
      },
      () => null
    );
    expect(result.staged).toEqual([]);
    expect(result.skipped.map((s) => s.reason)).toEqual(["ineligible_intent"]);
  });

  it("a widened policy lets the same opportunity through the same path", async () => {
    const tool = committed(UUID_GENERATOR_ID);
    const result = await runPageFactory(
      {
        opportunities: [{ ...tool, status: "approved" } as SearchOpportunity],
        existingPages: [],
        existingSpecs: [],
        eligible_intent_types: ["problem", "tool"],
        maxPages: 5,
        now: NOW,
        trigger: "admin_action",
      },
      () => null
    );
    expect(result.skipped).toEqual([]);
    expect(result.staged).toHaveLength(1);
  });

  it("the ledger's skipped_by_reason census carries the new bucket", async () => {
    const tool = committed(UUID_GENERATOR_ID);
    const result = await runPageFactory(
      {
        opportunities: [{ ...tool, status: "approved" } as SearchOpportunity],
        existingPages: [],
        existingSpecs: [],
        maxPages: 5,
        now: NOW,
        trigger: "admin_action",
      },
      () => null
    );
    // The run reports it; nothing about an ineligible intent is inferred from
    // an absence.
    expect(result.skipped[0].detail).toMatch(/page_eligible_intent_types/);
  });
});
