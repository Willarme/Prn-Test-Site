import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EventDefinition, MetricDefinition } from "@/platform/events/definitions";
import {
  OWNER_GAUGE_FORMULA,
  OWNER_GAUGE_SEEDS,
  RESERVED_DESCRIPTION,
  appendEventDefinitionVersion,
  currentEventDefinition,
  currentMetricDefinition,
  dictionaryCensus,
  eventDefinitionHistory,
  isReserved,
  listEventDefinitions,
  listMetricDefinitions,
  persistSeededDictionary,
  resetDictionaryForTests,
  seedDictionary,
  seedGroupOf,
  SEED_CENSUS,
} from "@/platform/events/dictionary";
import { EVENT_NAMES } from "@/platform/events/names";

/**
 * A08 build step 3 (spec §9): the initial trial dictionary, seeded before
 * traffic and reconciled against everything already emitting in src/.
 */

afterEach(() => {
  resetDictionaryForTests();
});

describe("seeded event dictionary", () => {
  it("registers an EventDefinition for every canonical name — no name without a row", () => {
    seedDictionary();
    expect(listEventDefinitions().length).toBe(EVENT_NAMES.length);
    for (const name of EVENT_NAMES) {
      const def = currentEventDefinition(name);
      expect(def, name).not.toBeNull();
      expect(EventDefinition.safeParse(def).success, name).toBe(true);
    }
  });

  it("seeds every name as approved — the whole dictionary is live, not proposed", () => {
    const census = dictionaryCensus();
    expect(census.events.approved).toBe(EVENT_NAMES.length);
    expect(census.events.proposed).toBe(0);
    expect(census.events.deprecated).toBe(0);
  });

  it("seeds the 11 live SLICE names and the 2 ratified platform names as approved", () => {
    for (const name of [
      "seo.opportunity_created",
      "seo.opportunity_scored",
      "seo.metrics_refreshed",
      "seo.search_console_ingested",
      "seo.budget_exhausted",
      "page.staged",
      "page.qa_failed",
      "page.refreshed",
      "page.retired",
      "economics.cost_recorded",
      "economics.revenue_recorded",
      "platform.kill_switch_engaged",
      "platform.kill_switch_released",
    ]) {
      expect(currentEventDefinition(name)?.status, name).toBe("approved");
    }
  });

  it("NEVER invents semantics for the undecided product areas", () => {
    const reserved = listEventDefinitions().filter((d) => isReserved(d.event_name));
    expect(reserved.length).toBeGreaterThan(0);
    for (const def of reserved) {
      expect(def.description, def.event_name).toBe(RESERVED_DESCRIPTION);
      expect(def.status, def.event_name).toBe("approved");
    }
    // Exactly the three families the audit names — nothing else got a
    // placeholder description as a way of dodging a real one.
    for (const def of listEventDefinitions()) {
      if (def.description === RESERVED_DESCRIPTION) expect(isReserved(def.event_name)).toBe(true);
    }
  });

  it("ships no payload_schema_ref and only the placeholder retention class", () => {
    for (const def of listEventDefinitions()) {
      expect(def.payload_schema_ref, def.event_name).toBeNull();
      expect(def.retention_class, def.event_name).toBe("TBD");
      expect(["private", "internal", "public_safe"]).toContain(def.privacy_class);
    }
  });

  it("documents the return-leg carrier's full context contract", () => {
    const def = currentEventDefinition("seo.page_performance_recorded");
    expect(def?.required_envelope_fields.sort()).toEqual(
      [
        "context.avg_position",
        "context.clicks",
        "context.impressions",
        "context.page_id",
        "context.search_opportunity_id",
        "context.source",
        "context.window",
      ].sort()
    );
  });

  it("carries the reserved tenant_id on every row and no tenant logic anywhere", () => {
    for (const def of listEventDefinitions()) expect(def.tenant_id).toBe("prn");
    for (const def of listMetricDefinitions()) expect(def.tenant_id).toBe("prn");
  });
});

describe("dictionary census (counted from the file, not from a document)", () => {
  it("pins each seed group's size so a name cannot be added unnoticed", () => {
    const counts: Record<string, number> = {
      core_14a: 0,
      door_slice: 0,
      platform: 0,
      steward: 0,
      loop_seam: 0,
      // A09 build, 2026-08-24 — DELIBERATE census change. Four names were added
      // on purpose (names.ts A09_EVENT_NAMES); this group and the total moving
      // from 81 to 85 is the record of that decision, not a leak past the pin.
      a09: 0,
    };
    for (const name of EVENT_NAMES) counts[seedGroupOf(name)] += 1;
    expect(counts.core_14a).toBe(SEED_CENSUS.core_14a);
    expect(counts.door_slice).toBe(SEED_CENSUS.door_slice);
    expect(counts.platform).toBe(SEED_CENSUS.platform);
    expect(counts.steward).toBe(SEED_CENSUS.steward);
    expect(counts.loop_seam).toBe(SEED_CENSUS.loop_seam);
    expect(counts.a09).toBe(SEED_CENSUS.a09);
    expect(EVENT_NAMES.length).toBe(
      SEED_CENSUS.core_14a +
        SEED_CENSUS.door_slice +
        SEED_CENSUS.platform +
        SEED_CENSUS.steward +
        SEED_CENSUS.loop_seam +
        SEED_CENSUS.a09
    );
    expect(EVENT_NAMES.length).toBe(85);
    expect(listMetricDefinitions().length).toBe(SEED_CENSUS.owner_gauges);
  });

  it("counts eleven reserved-semantics names across the three parked families", () => {
    expect(listEventDefinitions().filter((d) => isReserved(d.event_name)).length).toBe(11);
  });
});

describe("the eleven owner gauges (condition 9 — parked, not invented)", () => {
  it("registers all eleven keys as proposed with no formula, denominator or target", () => {
    const metrics = listMetricDefinitions();
    expect(metrics.length).toBe(11);
    expect(OWNER_GAUGE_SEEDS.length).toBe(11);
    for (const gauge of OWNER_GAUGE_SEEDS) {
      const def = currentMetricDefinition(gauge.metric_key);
      expect(def, gauge.metric_key).not.toBeNull();
      expect(def!.status).toBe("proposed");
      expect(def!.formula_description).toBe(OWNER_GAUGE_FORMULA);
      expect(def!.metric_type).toBe("TBD");
      expect(def!.source_events).toEqual([]);
      expect(def!.denominator_event).toBeUndefined();
      expect(def!.target).toBeUndefined();
      expect(MetricDefinition.safeParse(def).success).toBe(true);
    }
  });

  it("covers each of the eleven 14A §18.3 gauges by name", () => {
    const names = OWNER_GAUGE_SEEDS.map((g) => g.display_name);
    for (const expected of [
      "Qualified Demand Health",
      "Useful Outcome Rate",
      "Intake Friction",
      "Packet Use",
      "Trust Conversion",
      "Provider Decision Relief",
      "Future Feature Pull",
      "Search Proof",
      "Data Moat Yield",
      "System / Autonomy",
      "AI-Native Readiness",
    ]) {
      expect(names).toContain(expected);
    }
  });

  it("a gauge cannot be quietly promoted to approved while its meaning is TBD", () => {
    const def = currentMetricDefinition("useful_outcome_rate")!;
    expect(MetricDefinition.safeParse({ ...def, status: "approved" }).success).toBe(false);
  });
});

describe("versioning discipline", () => {
  it("appends a new version rather than overwriting — history stays readable", async () => {
    const before = currentEventDefinition("packet.viewed")!;
    const after = await appendEventDefinitionVersion(
      { ...before, description: "A job packet was opened." },
      () => null
    );
    expect(after.definition_version).toBe(2);
    const history = eventDefinitionHistory("packet.viewed");
    expect(history.length).toBe(2);
    expect(history[0].description).toBe(before.description);
    expect(history[0].definition_version).toBe(1);
    expect(currentEventDefinition("packet.viewed")!.description).toBe("A job packet was opened.");
  });

  it("writes are fail-soft when the registry table does not exist", async () => {
    const before = currentEventDefinition("page.staged")!;
    await expect(
      appendEventDefinitionVersion({ ...before, description: "edited" }, () => {
        throw new Error("simulated connection failure");
      })
    ).resolves.toBeTruthy();
  });

  it("persistSeededDictionary is a no-op-safe backfill with no database", async () => {
    const counts = await persistSeededDictionary(() => null);
    expect(counts.events).toBe(EVENT_NAMES.length);
    expect(counts.metrics).toBe(11);
  });
});

describe("migration 00009", () => {
  const sql = readFileSync(
    join(process.cwd(), "supabase/migrations/00009_event_metric_registry.sql"),
    "utf-8"
  );

  it("creates both registry tables with a versioned primary key", () => {
    expect(sql).toMatch(/create table if not exists event_definition/);
    expect(sql).toMatch(/create table if not exists metric_definition/);
    expect(sql).toMatch(/primary key \(event_name, definition_version\)/);
    expect(sql).toMatch(/primary key \(metric_key, definition_version\)/);
  });

  it("keeps the registry append-only and RLS-guarded", () => {
    expect(sql).toMatch(/revoke update, delete on event_definition/);
    expect(sql).toMatch(/revoke update, delete on metric_definition/);
    expect(sql).toMatch(/alter table event_definition enable row level security/);
    expect(sql).toMatch(/alter table metric_definition enable row level security/);
  });

  it("carries tenant_id on both tables and adds approval_kind additively", () => {
    expect(sql.match(/tenant_id text not null default 'prn'/g)?.length).toBe(2);
    expect(sql).toMatch(/alter table approval_item add column if not exists approval_kind text/);
  });

  it("admits no fourth privacy vocabulary", () => {
    expect(sql).toMatch(/privacy_class in \('private','internal','public_safe'\)/);
  });
});
