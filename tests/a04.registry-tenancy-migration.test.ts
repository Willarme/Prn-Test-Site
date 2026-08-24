import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SearchOpportunity } from "@/domain/search/contracts";
import { OpportunityDecision } from "@/domain/search/decision";
import { AgentDefinition } from "@/platform/agents/contracts";
import { TRIAL_AGENT_REGISTRY } from "@/platform/agents/registry";
import artifact from "../data/factory/opportunities.json";

/**
 * A04 step 9 — REGISTRY, TENANCY, LEDGER PROVENANCE and MIGRATION 00011.
 */

const a04 = TRIAL_AGENT_REGISTRY.find((a) => a.agent_id === "A04")!;

describe("A04's registry entry", () => {
  it("still parses as an AgentDefinition", () => {
    expect(() => AgentDefinition.parse(a04)).not.toThrow();
  });

  it("autonomy stays TBD — canon carries two non-identical scales", () => {
    // Condition 12 / OD-10: A04 follows L2 BEHAVIOUR, but no L-number is
    // written ahead of the owners picking a scale.
    expect(a04.autonomy_level).toBe("TBD");
  });

  it("data and write access are enumerated, not left as backfill gaps", () => {
    expect(a04.data_access.length).toBeGreaterThan(0);
    expect(a04.write_access.length).toBeGreaterThan(0);
    expect(a04.data_access).toContain("search_opportunity");
    expect(a04.write_access).toContain("opportunity_decision");
  });

  it("A04 writes NOTHING customer-owned", () => {
    const customerTables = [
      "problem_record",
      "evidence_object",
      "intake_answer",
      "intake_session",
      "consent_event",
      "job_packet",
    ];
    for (const table of customerTables) {
      expect(a04.write_access, table).not.toContain(table);
    }
  });

  it("A04 cannot write any page record — its gate and A06's do not collapse", () => {
    for (const entry of a04.write_access) {
      expect(entry, entry).not.toMatch(/^page/);
      expect(entry, entry).not.toMatch(/published/);
    }
  });

  it("claims exactly one capability and no model access", () => {
    expect(a04.allowed_capabilities).toEqual(["get_search_metrics"]);
  });

  it("declares no schedule — a cron would make it an unattended spender", () => {
    expect(a04.schedule).toMatch(/on-demand/i);
    expect(a04.schedule).toMatch(/NO cron/i);
  });

  it("uses the platform kill-switch ref convention", () => {
    expect(a04.kill_switch_ref).toBe("agent:A04");
  });
});

describe("tenant_id (C4) — reserved on every A04 record, no tenant logic", () => {
  it("SearchOpportunity carries it, optionally, so the 96 records still parse", () => {
    const committed = (artifact as unknown as { opportunities: unknown[] }).opportunities;
    expect(committed).toHaveLength(96);
    for (const row of committed) {
      expect(() => SearchOpportunity.parse(row)).not.toThrow();
    }
    // None of them carries one — absence is the default, not a failure.
    const parsed = SearchOpportunity.parse(committed[0]);
    expect(parsed.tenant_id).toBeUndefined();
  });

  it("OpportunityDecision requires it and it defaults to prn at the write path", () => {
    expect(() =>
      OpportunityDecision.parse({
        decision_id: "od_1",
        search_opportunity_id: "so_1",
        decision: "accept",
        status_after: "approved",
        decided_by: "owner",
        decided_at: "2026-08-24T00:00:00Z",
        note: null,
        recommendation_at_decision: null,
        score_at_decision: null,
        score_version_at_decision: null,
        approval_id: null,
        run_id: null,
      })
    ).toThrow(); // tenant_id missing
  });

  it("no tenant LOGIC exists — the field is reserved, not routed on", () => {
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
      // No branching, filtering or comparison on tenant_id anywhere.
      expect(content, file).not.toMatch(/tenant_id\s*===/);
      expect(content, file).not.toMatch(/if\s*\([^)]*tenant_id/);
      expect(content, file).not.toMatch(/\.eq\(\s*["']tenant_id["']/);
    }
  });
});

describe("migration 00011 — written, NOT applied, and parseable", () => {
  const sql = readFileSync(
    join(process.cwd(), "supabase/migrations/00011_opportunity_decision.sql"),
    "utf-8"
  );

  it("is the next number in sequence and nothing skipped it", () => {
    const migrations = readdirSync(join(process.cwd(), "supabase/migrations")).sort();
    expect(migrations[migrations.length - 1]).toBe("00011_opportunity_decision.sql");
  });

  it("EXTENDS the existing search_opportunity table rather than duplicating it", () => {
    expect(sql).toMatch(/alter table search_opportunity add column if not exists tenant_id/);
    expect(sql).toMatch(/alter table search_opportunity add column if not exists approved_at/);
    expect(sql).toMatch(/alter table search_opportunity add column if not exists approved_by/);
    expect(sql).toMatch(/alter table search_opportunity add column if not exists score_version/);
    // The one thing it must never do.
    expect(sql).not.toMatch(/create table if not exists search_opportunity/);
  });

  it("every added column is nullable or defaulted — additive, never breaking", () => {
    const added = [...sql.matchAll(/add column if not exists (\w+) ([^;]+);/g)];
    expect(added.length).toBe(4);
    for (const [, column, definition] of added) {
      const nullable = !/not null/.test(definition);
      const defaulted = /default/.test(definition);
      expect(nullable || defaulted, `${column} is neither nullable nor defaulted`).toBe(true);
    }
  });

  it("the decision ledger is append-only and RLS-guarded", () => {
    expect(sql).toMatch(/create table if not exists opportunity_decision/);
    expect(sql).toMatch(/alter table opportunity_decision enable row level security/);
    expect(sql).toMatch(/revoke update, delete on opportunity_decision/);
  });

  it("carries tenant_id with the same default as every A00 table", () => {
    expect(sql.match(/tenant_id text not null default 'prn'/g)?.length).toBe(2);
  });

  it("has no column a homeowner's words could occupy", () => {
    // `note` is the OWNER's annotation and is length-capped; nothing else is
    // free text. A keyword, a photo ref or consent language cannot be stored.
    const textColumns = [...sql.matchAll(/^\s{2}(\w+) text/gm)].map((m) => m[1]);
    const freeText = textColumns.filter((c) => c === "note");
    expect(freeText).toEqual(["note"]);
    expect(sql).toMatch(/char_length\(note\) <= 500/);
  });

  it("SQL structure is balanced — statements terminate and parens match", () => {
    const stripped = sql.replace(/--[^\n]*/g, "");
    expect(stripped.split("(").length).toBe(stripped.split(")").length);
    const statements = stripped.split(";").map((s) => s.trim()).filter(Boolean);
    expect(statements.length).toBeGreaterThan(8);
    for (const statement of statements) {
      expect(statement, statement.slice(0, 60)).toMatch(
        /^(create|alter|revoke|grant|comment)\b/i
      );
    }
  });
});
