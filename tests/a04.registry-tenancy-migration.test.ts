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

  it("generic search keeps tenancy reserved; only reviewed v43 scope boundaries inspect it", () => {
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
      // The exact frozen PRN template must reject cross-tenant use. Limit
      // this exception to its schema/QA contract and the factory delegation;
      // behavior tests cover that rejection. Generic routing stays reserved.
      if (!/[\\/]door-template(?:-qa)?\.ts$/.test(file)) {
        const genericContent = content.replace("if (isV43Opportunity(opportunity, deps.tenant_id))", "if (reviewedScopeMatches)");
        expect(genericContent, file).not.toMatch(/tenant_id\s*===/);
        expect(genericContent, file).not.toMatch(/if\s*\([^)]*tenant_id/);
      }
      // No module gets tenant database filtering through the source exception.
      expect(content, file).not.toMatch(/\.eq\(\s*["']tenant_id["']/);
    }
  });
});

describe("migration 00011 — applied 2026-08-25, and parseable", () => {
  const sql = readFileSync(
    join(process.cwd(), "supabase/migrations/00011_opportunity_decision.sql"),
    "utf-8"
  );

  /**
   * UPDATED BY THE A05 BUILD. This asserted 00011 was the LAST migration in the
   * directory, which pinned "A04 is the newest agent forever" rather than the
   * property it was after. A05 added 00012 and it failed for no defect at all.
   * The real property is sequence integrity: 00011 is A04's, it sits where it
   * should, and no number was skipped by anyone.
   */
  it("keeps 00011 and every migration outside the documented branch reservation gap", () => {
    const migrations = readdirSync(join(process.cwd(), "supabase/migrations")).sort();
    expect(migrations).toContain("00011_opportunity_decision.sql");
    const numbers = migrations.map((m) => Number(m.slice(0, 5)));
    // 00001-00015 are gapless; 00019 is T1-33's request-scoped seam,
    // renumbered ABOVE the cross-branch high-water mark at merge time because
    // 00016-00018 are already claimed on unmerged branches (t2-08, t5-06,
    // t6-03 — Merge Train 2026-08-30). The gap closes as those branches land;
    // a strict 1..N assertion cannot survive multi-branch numbering. 00020 =
    // the loop surfaces (campaign track F2b, 2026-09-05); 00021 hardens their
    // inherited operation grants without renumbering any existing migration.
    // 00021 hardens loop grants; 00022 persists T1-35 effort. Both must exist,
    // as must 00020: only the existing 00016-00018 reservation is excepted.
    expect(numbers).toEqual([...Array.from({ length: 15 }, (_, i) => i + 1), 19, 20, 21, 22]);
    expect(migrations).toContain("00020_loop_surfaces.sql");
    expect(migrations).toContain("00021_loop_grant_hardening.sql");
    expect(migrations).toContain("00022_intake_effort.sql");
    expect(numbers).toContain(11);
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
