import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AgentDefinition } from "@/platform/agents/contracts";
import { TRIAL_AGENT_REGISTRY } from "@/platform/agents/registry";

/**
 * A05 step 13 — the registry entry and migration 00012.
 *
 * The migration is also parser-verified against the REAL PostgreSQL grammar
 * (libpg_query via pg-query-emscripten, installed --ignore-scripts outside this
 * repo) with a reserved-word check over the identifiers it declares. That tool
 * is not a dependency here, so the structural assertions below are what the
 * suite can hold; the parser run is recorded in the build report. All twelve
 * migrations parse, 00012 at 9 statements and 16 declared identifiers with no
 * reserved-word clash.
 */

const a05 = TRIAL_AGENT_REGISTRY.find((a) => a.agent_id === "A05")!;

describe("A05's registry entry", () => {
  it("still parses as an AgentDefinition", () => {
    expect(() => AgentDefinition.parse(a05)).not.toThrow();
  });

  it("autonomy stays TBD — canon carries two non-identical scales (C12 / OD-10)", () => {
    expect(a05.autonomy_level).toBe("TBD");
  });

  /**
   * WHAT THIS TEST USED TO ASSERT: "claims exactly one capability and no model
   * access ... generate_page_copy is a future contract in the spec, deliberately
   * NOT registered: registering a model capability nothing implements would be
   * describing unbuilt behaviour as built."
   *
   * That reason expired on 2026-08-25 when one was implemented, and only that
   * reason. What replaces it is the guarantee that actually matters: the model
   * copy writer is registered, allowed, and DISABLED — and a06/a05 tests prove
   * every published page is byte-identical while it is.
   */
  it("claims its page builder and its copy writer, and the copy writer ships OFF", async () => {
    expect(a05.allowed_capabilities).toEqual([
      "seo.build_candidate_pages",
      "generate_page_copy",
    ]);
    const { DEFAULT_AI_POLICY } = await import("@/platform/ai/policy");
    expect(DEFAULT_AI_POLICY.enabled).toBe(false);
    expect(DEFAULT_AI_POLICY.capabilities.generate_page_copy.enabled).toBe(false);
  });

  it("data and write access are enumerated, not left as backfill gaps", () => {
    expect(a05.data_access.length).toBeGreaterThan(0);
    expect(a05.write_access.length).toBeGreaterThan(0);
    expect(a05.write_access).toContain("intent_page");
    expect(a05.write_access).toContain("staged_page_spec");
  });

  it("A05 writes NOTHING customer-owned", () => {
    for (const table of [
      "problem_record",
      "evidence_object",
      "intake_answer",
      "intake_session",
      "consent_event",
      "job_packet",
    ]) {
      expect(a05.write_access, table).not.toContain(table);
    }
  });

  it("A05 CANNOT change publish state — structurally, not by promise", () => {
    expect(a05.data_access).toContain("published_page");
    expect(a05.write_access).not.toContain("published_page");
  });

  it("search_opportunity is READ-only — A05 consumes the owner's decision, never writes one", () => {
    expect(a05.data_access).toContain("search_opportunity");
    expect(a05.data_access).toContain("opportunity_decision");
    expect(a05.write_access).not.toContain("search_opportunity");
    expect(a05.write_access).not.toContain("opportunity_decision");
  });

  it("declares no schedule and names the orchestrator deferral (C9)", () => {
    expect(a05.schedule).toMatch(/on-demand only/i);
    expect(a05.schedule).toMatch(/idempotent on opportunity_id/i);
    expect(a05.schedule).toMatch(/No cron route/i);
    expect(a05.schedule).toMatch(/deferred and interface-only/i);
  });

  it("uses the platform kill-switch ref convention", () => {
    expect(a05.kill_switch_ref).toBe("agent:A05");
  });
});

describe("migration 00012 — written, NOT applied, and structurally sound", () => {
  const sql = readFileSync(
    join(process.cwd(), "supabase/migrations/00012_page_registry.sql"),
    "utf-8"
  );

  it("is the next free number and the sequence has no gaps", () => {
    const migrations = readdirSync(join(process.cwd(), "supabase/migrations")).sort();
    expect(migrations).toContain("00012_page_registry.sql");
    const numbers = migrations.map((m) => Number(m.slice(0, 5)));
    expect(numbers).toEqual(numbers.map((_, i) => i + 1));
    // Nothing renumbered or rewrote an already-committed migration.
    expect(migrations[10]).toBe("00011_opportunity_decision.sql");
  });

  it("creates the ONE table that genuinely had none, and duplicates nothing", () => {
    expect(sql).toMatch(/create table if not exists intent_page/);
    // staged_page_spec has existed since 00002 and is EXTENDED, never recreated.
    expect(sql).not.toMatch(/create table if not exists staged_page_spec/);
    expect(sql).toMatch(/alter table staged_page_spec add column if not exists tenant_id/);
    // There is no PageVersion object in this repo (C17) and none is invented.
    expect(sql).not.toMatch(/page_version/);
  });

  it("carries tenant_id with the same default as every A00 table (C1)", () => {
    expect(sql).toMatch(/tenant_id text not null default 'prn'/);
    expect(sql.match(/tenant_id text not null default 'prn'/g)?.length).toBe(2);
  });

  it("constrains lifecycle_status to the frozen 7-state machine (C17)", () => {
    for (const state of ["IDEA", "APPROVED", "STAGED", "QA_PASS", "PUBLISHED", "REFRESH", "RETIRED"]) {
      expect(sql, state).toMatch(new RegExp(`'${state}'`));
    }
  });

  it("makes two doors on one live URL unrepresentable — the doorway rule as a constraint", () => {
    expect(sql).toMatch(/create unique index if not exists idx_intent_page_live_path/);
    expect(sql).toMatch(/where lifecycle_status <> 'RETIRED'/);
  });

  it("makes 'published with no publish date' unrepresentable", () => {
    expect(sql).toMatch(/intent_page_published_has_date/);
    expect(sql).toMatch(/intent_page_retired_has_date/);
  });

  it("is RLS-guarded, updatable (current state) but never deletable", () => {
    expect(sql).toMatch(/alter table intent_page enable row level security/);
    expect(sql).toMatch(/revoke delete on intent_page/);
    expect(sql).toMatch(/grant select, insert, update on intent_page/);
  });

  it("has NO free-text column a homeowner's words could occupy", () => {
    // Every column is an identifier, a path, an enum value or a timestamp.
    const textColumns = [...sql.matchAll(/^\s{2}(\w+) text/gm)].map((m) => m[1]);
    expect(textColumns.sort()).toEqual(
      ["canonical_path", "current_page_spec_id", "lifecycle_status", "page_id", "redirect_to_path", "tenant_id"].sort()
    );
    expect(sql).not.toMatch(/\bnote text\b/);
  });

  it("SQL structure is balanced — statements terminate and parens match", () => {
    const stripped = sql.replace(/--[^\n]*/g, "");
    expect(stripped.split("(").length).toBe(stripped.split(")").length);
    const statements = stripped.split(";").map((s) => s.trim()).filter(Boolean);
    expect(statements.length).toBeGreaterThan(5);
    for (const statement of statements) {
      expect(statement, statement.slice(0, 60)).toMatch(/^(create|alter|revoke|grant|comment)\b/i);
    }
  });
});
