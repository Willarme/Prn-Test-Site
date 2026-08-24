import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  listApprovals,
  resetApprovalCenterForTests,
  resolveApproval,
  type ApprovalItem,
} from "@/platform/approvals/center";
import { APPROVAL_KINDS, ApprovalKind } from "@/platform/approvals/kinds";
import { RETENTION_CLASS_PLACEHOLDER } from "@/platform/events/definitions";
import {
  currentEventDefinition,
  eventDefinitionHistory,
  resetDictionaryForTests,
} from "@/platform/events/dictionary";
import {
  applyApprovedChange,
  deprecate,
  getEventImpact,
  getMetricLineage,
  lookupEventDefinition,
  lookupMetricDefinition,
  proposeEventDefinition,
  proposeEventDefinitionChange,
  proposeMetricDefinition,
  proposeMetricDefinitionChange,
  resetStewardForTests,
  runScheduledDictionaryAudit,
  runValidationBatch,
  stewardCounters,
  validateAndEmit,
} from "@/platform/events/steward";
import {
  engageKillSwitch,
  releaseKillSwitch,
  resetKillSwitchForTests,
} from "@/platform/killswitch";
import { recentAgentRuns, resetAgentRunLedgerForTests } from "@/platform/runs/ledger";

/**
 * A08 build step 4 (spec §9) plus the Definition of Done's adversarial cases.
 * Every test runs with no database: the registry is in-process and every write
 * is fail-soft, exactly as Wave 0 ships.
 */

const noDb = () => null;
const ctx = { run_id: "ar_test_run" };

beforeEach(() => {
  resetDictionaryForTests();
  resetStewardForTests();
  resetApprovalCenterForTests();
  resetAgentRunLedgerForTests();
  resetKillSwitchForTests();
});

afterEach(() => {
  resetKillSwitchForTests();
});

function newEventInput(overrides: Record<string, unknown> = {}) {
  return {
    event_name: "warranty.claim_filed",
    description: "A warranty claim was filed.",
    owning_agent_or_domain: "warranty",
    required_envelope_fields: [],
    payload_schema_ref: null,
    privacy_class: "internal" as const,
    retention_class: RETENTION_CLASS_PLACEHOLDER,
    status: "approved" as const,
    tenant_id: "prn",
    ...overrides,
  };
}

describe("validateAndEmit", () => {
  it("emits a clean, registered event", async () => {
    const res = await validateAndEmit(
      { event_name: "packet.generated", agent_id: "A02", context: { problem_id: "pr_1" } },
      noDb
    );
    expect(res.status).toBe("emitted");
    expect(res.envelope?.event_name).toBe("packet.generated");
    expect(res.envelope?.context.problem_id).toBe("pr_1");
    expect(stewardCounters().events_emitted).toBe(1);
  });

  it("BLOCKS an unregistered name and COUNTS the attempt — the KPI numerator", async () => {
    const res = await validateAndEmit({ event_name: "page.hacked" }, noDb);
    expect(res.status).toBe("blocked");
    expect(res.envelope).toBeNull();
    expect(stewardCounters().emissions_blocked_unregistered).toBe(1);
  });

  it("REJECTS an event missing a required envelope field — never a partial row", async () => {
    const res = await validateAndEmit(
      { event_name: "seo.page_performance_recorded", context: { page_id: "pg_1" } },
      noDb
    );
    expect(res.status).toBe("blocked");
    expect(res.envelope).toBeNull();
    expect(res.reasons[0]).toMatch(/missing required envelope fields/);
    expect(res.reasons[0]).toMatch(/context.search_opportunity_id/);
    expect(stewardCounters().emissions_blocked_missing_field).toBe(1);
  });

  it("emits the return-leg carrier once every context key is supplied", async () => {
    const res = await validateAndEmit(
      {
        event_name: "seo.page_performance_recorded",
        context: {
          page_id: "pg_1",
          search_opportunity_id: "so_1",
          window: "rolling_28d",
          impressions: "1200",
          clicks: "34",
          avg_position: "8.4",
          source: "search_console",
        },
      },
      noDb
    );
    expect(res.status).toBe("emitted");
  });

  it("FAILS OPEN in the customer path when A08 is paused — marked, never blocked", async () => {
    await engageKillSwitch({ scope: "AGENT", scope_ref: "A08", by: "owner" }, noDb);
    const res = await validateAndEmit({ event_name: "intake.started" }, noDb);
    expect(res.status).toBe("emitted_unvalidated");
    expect(res.envelope?.context.a08_unvalidated).toBe("true");
    await releaseKillSwitch({ scope: "AGENT", scope_ref: "A08", by: "owner" }, noDb);
  });

  it("writes NO ledger row per event — one row per batch, never per emission", async () => {
    await validateAndEmit({ event_name: "page.viewed" }, noDb);
    await validateAndEmit({ event_name: "page.viewed" }, noDb);
    await validateAndEmit({ event_name: "page.viewed" }, noDb);
    expect(recentAgentRuns().length).toBe(0);

    const batch = await runValidationBatch(
      { trigger: "request" },
      async () => {
        await validateAndEmit({ event_name: "page.viewed" }, noDb);
        await validateAndEmit({ event_name: "page.viewed" }, noDb);
        return "done";
      },
      noDb
    );
    expect(batch.result).toBe("done");
    expect(recentAgentRuns().length).toBe(1);
    expect(recentAgentRuns()[0].agent_id).toBe("A08");
    expect(recentAgentRuns()[0].cost_usd).toBe(0);
    expect((batch.counters as { events_emitted: number }).events_emitted).toBe(2);
  });
});

/**
 * A08 step 8 verification defect. The docblock above validateAndEmit stamps
 * "NEVER throws", but the shared emit path it delegates to built its envelope
 * with EventEnvelope.parse() outside any try/catch. Each value below is
 * TYPE-LEGAL against ValidateAndEmitInput and so compiles, yet fails the
 * envelope schema — which meant the ZodError travelled straight through
 * validateAndEmit into whatever business path called it. "agent.run_completed"
 * seeds approved with no required_envelope_fields, so every case here reaches
 * the emit path rather than being turned away earlier by the validator.
 */
describe("validateAndEmit never throws — the stamped contract, actually enforced", () => {
  const badFields: [string, Partial<Record<string, unknown>>][] = [
    ["duration_ms NaN", { duration_ms: Number.NaN }],
    ["duration_ms negative", { duration_ms: -1 }],
    ["cost_usd Infinity", { cost_usd: Number.POSITIVE_INFINITY }],
    ["cost_usd negative", { cost_usd: -0.01 }],
    ["agent_id empty", { agent_id: "" }],
    ["tenant_id empty", { tenant_id: "" }],
  ];

  it.each(badFields)("survives %s and reports it without raising", async (_label, extra) => {
    const res = await validateAndEmit(
      { event_name: "agent.run_completed", ...extra },
      noDb
    );
    // Reached emit (not turned away by the validator) and failed soft there.
    expect(res.status).toBe("emitted");
    expect(res.envelope).toBeNull();
  });

  it("keeps a valid emission unchanged — the fix costs the happy path nothing", async () => {
    const res = await validateAndEmit(
      { event_name: "agent.run_completed", agent_id: "A01", duration_ms: 12, cost_usd: 0 },
      noDb
    );
    expect(res.status).toBe("emitted");
    expect(res.envelope).not.toBeNull();
    expect(res.envelope!.result.duration_ms).toBe(12);
  });
});

describe("proposeEventDefinition", () => {
  it("auto-validates a clean, non-colliding definition and says so out loud", async () => {
    const res = await proposeEventDefinition(newEventInput(), ctx, noDb);
    expect(res.outcome).toBe("registered");
    expect(currentEventDefinition("warranty.claim_filed")?.status).toBe("approved");
    // The registry is the authority, but names.ts is the compile-time union:
    // the new name cannot be EMITTED until the seed artifact is regenerated.
    expect(res.requires_names_regeneration).toBe(true);
    expect(stewardCounters().definitions_auto_registered).toBe(1);
  });

  it("REJECTS an exact name collision — the hard block canon requires", async () => {
    const res = await proposeEventDefinition(
      newEventInput({ event_name: "packet.generated", description: "Something else entirely." }),
      ctx,
      noDb
    );
    expect(res.outcome).toBe("rejected");
    expect(res.reasons[0]).toMatch(/exact name collision/);
    // And it did not quietly overwrite the shipped definition.
    expect(currentEventDefinition("packet.generated")!.description).toMatch(/job packet/i);
    expect(eventDefinitionHistory("packet.generated").length).toBe(1);
  });

  it("FLAGS a near-duplicate to a human instead of registering it", async () => {
    const res = await proposeEventDefinition(
      newEventInput({ event_name: "packet.generate", description: "Nearly the same name." }),
      ctx,
      noDb
    );
    expect(res.outcome).toBe("queued_for_approval");
    expect(res.flags?.[0].existing).toBe("packet.generated");
    expect(currentEventDefinition("packet.generate")).toBeNull();
    const queue = await listApprovals(noDb);
    expect(queue[0].approval_kind).toBe("dictionary.definition_change");
  });

  it("rejects a definition that breaks the naming convention", async () => {
    const res = await proposeEventDefinition(newEventInput({ event_name: "warrantyclaim" }), ctx, noDb);
    expect(res.outcome).toBe("rejected");
  });

  it("FAILS CLOSED on registry writes while A08 is paused", async () => {
    await engageKillSwitch({ scope: "AGENT", scope_ref: "A08", by: "owner" }, noDb);
    const res = await proposeEventDefinition(newEventInput(), ctx, noDb);
    expect(res.outcome).toBe("refused_paused");
    expect(currentEventDefinition("warranty.claim_filed")).toBeNull();
    await releaseKillSwitch({ scope: "AGENT", scope_ref: "A08", by: "owner" }, noDb);
  });
});

describe("proposeMetricDefinition", () => {
  const metric = {
    metric_key: "packets_generated",
    display_name: "Packets generated",
    formula_description: "Count of packet.generated events in the window.",
    metric_type: "count" as const,
    source_events: ["packet.generated"],
    metric_window: "rolling_7d",
    status: "approved" as const,
  };

  it("registers a clean metric", async () => {
    const res = await proposeMetricDefinition(metric, ctx, noDb);
    expect(res.outcome).toBe("registered");
  });

  it("REJECTS a rate metric with no denominator_event — silent denominator drift", async () => {
    const res = await proposeMetricDefinition(
      { ...metric, metric_key: "packet_use_rate", metric_type: "rate" },
      ctx,
      noDb
    );
    expect(res.outcome).toBe("rejected");
    expect(res.reasons.join(" ")).toMatch(/denominator_event/);
  });

  it("accepts the same rate metric once its denominator is named", async () => {
    const res = await proposeMetricDefinition(
      {
        ...metric,
        metric_key: "packet_use_rate",
        metric_type: "rate",
        denominator_event: "intake.started",
      },
      ctx,
      noDb
    );
    expect(res.outcome).toBe("registered");
  });

  it("REJECTS a metric built on an unregistered event — no untraceable numbers", async () => {
    const res = await proposeMetricDefinition(
      { ...metric, metric_key: "ghost_metric", source_events: ["nothing.happened"] },
      ctx,
      noDb
    );
    expect(res.outcome).toBe("rejected");
    expect(res.reasons[0]).toMatch(/source events not registered/);
  });

  it("REJECTS an exact key collision with a seeded owner gauge", async () => {
    const res = await proposeMetricDefinition(
      { ...metric, metric_key: "useful_outcome_rate" },
      ctx,
      noDb
    );
    expect(res.outcome).toBe("rejected");
    expect(res.reasons[0]).toMatch(/exact key collision/);
  });
});

describe("ANY change to a registered definition goes to a human", () => {
  it("routes a TRIVIAL, clean description edit to the Approval Center — not applied", async () => {
    const res = await proposeEventDefinitionChange(
      "packet.viewed",
      { description: "A job packet was opened." },
      ctx,
      noDb
    );
    expect(res.outcome).toBe("queued_for_approval");
    expect(res.analysis?.change_class).toBe("additive");
    // Nothing was applied.
    expect(currentEventDefinition("packet.viewed")!.definition_version).toBe(1);
    expect(currentEventDefinition("packet.viewed")!.description).not.toBe(
      "A job packet was opened."
    );
    const queue = await listApprovals(noDb);
    expect(queue.length).toBe(1);
    expect(queue[0].agent_id).toBe("A08");
    expect(queue[0].approval_kind).toBe("dictionary.definition_change");
  });

  it("A08 does not exempt its own proposals — the proposer IS A08", async () => {
    const res = await proposeEventDefinitionChange(
      "schema.approved",
      { description: "A08 edits its own event." },
      ctx,
      noDb
    );
    expect(res.outcome).toBe("queued_for_approval");
    expect(currentEventDefinition("schema.approved")!.definition_version).toBe(1);
  });

  it("attaches a backward-compatibility analysis and counts a breaking change", async () => {
    const res = await proposeEventDefinitionChange(
      "packet.generated",
      { required_envelope_fields: ["trace_id"] },
      ctx,
      noDb
    );
    expect(res.analysis?.change_class).toBe("breaking");
    expect(stewardCounters().compatibility_failures).toBe(1);
    const queue = await listApprovals(noDb);
    expect(queue[0].risk).toBe("high");
    expect((queue[0].evidence as { change_class: string }).change_class).toBe("breaking");
  });

  it("refuses to apply a change the owner has not approved", async () => {
    const res = await proposeEventDefinitionChange(
      "packet.viewed",
      { description: "edited" },
      ctx,
      noDb
    );
    const queue = await listApprovals(noDb);
    const applied = await applyApprovedChange(res.approval_id!, queue[0], noDb);
    expect(applied.outcome).toBe("rejected");
    expect(applied.reasons[0]).toMatch(/PENDING/);
    expect(currentEventDefinition("packet.viewed")!.definition_version).toBe(1);
  });

  it("applies it once the owner approves, as a NEW version", async () => {
    const res = await proposeEventDefinitionChange(
      "packet.viewed",
      { description: "A job packet was opened." },
      ctx,
      noDb
    );
    const resolved = await resolveApproval(
      res.approval_id!,
      { status: "APPROVED", resolved_by: "owner" },
      noDb
    );
    const applied = await applyApprovedChange(res.approval_id!, resolved as ApprovalItem, noDb);
    expect(applied.outcome).toBe("registered");
    expect(currentEventDefinition("packet.viewed")!.definition_version).toBe(2);
    expect(eventDefinitionHistory("packet.viewed").length).toBe(2);
    expect(eventDefinitionHistory("packet.viewed")[0].description).not.toBe(
      "A job packet was opened."
    );
  });

  it("a metric change is versioned, never overwritten", async () => {
    await proposeMetricDefinition(
      {
        metric_key: "packets_generated",
        display_name: "Packets generated",
        formula_description: "Count of packet.generated events in the window.",
        metric_type: "count",
        source_events: ["packet.generated"],
        metric_window: "rolling_7d",
        status: "approved",
      },
      ctx,
      noDb
    );
    const res = await proposeMetricDefinitionChange(
      "packets_generated",
      { metric_window: "rolling_28d" },
      ctx,
      noDb
    );
    expect(res.outcome).toBe("queued_for_approval");
    expect(res.analysis?.change_class).toBe("breaking");
    const resolved = await resolveApproval(
      res.approval_id!,
      { status: "APPROVED", resolved_by: "owner" },
      noDb
    );
    await applyApprovedChange(res.approval_id!, resolved as ApprovalItem, noDb);
    expect(lookupMetricDefinition("packets_generated").definition!.metric_window).toBe("rolling_28d");
    expect(lookupMetricDefinition("packets_generated", 1).definition!.metric_window).toBe(
      "rolling_7d"
    );
  });
});

describe("deprecation — never a delete", () => {
  it("queues the deprecation, then resolves the old name FORWARD once approved", async () => {
    const res = await deprecate("event", "page.qa_passed", "page.published", ctx, noDb);
    expect(res.outcome).toBe("queued_for_approval");
    // Not applied yet.
    expect(currentEventDefinition("page.qa_passed")!.status).toBe("approved");

    const resolved = await resolveApproval(
      res.approval_id!,
      { status: "APPROVED", resolved_by: "owner" },
      noDb
    );
    await applyApprovedChange(res.approval_id!, resolved as ApprovalItem, noDb);

    // The old name is still queryable historically...
    const history = eventDefinitionHistory("page.qa_passed");
    expect(history.length).toBe(2);
    expect(history[0].status).toBe("approved");
    expect(history[1].status).toBe("deprecated");
    expect(history[1].deprecated_by).toBe("page.published");

    // ...and a lookup of the old name resolves forward rather than vanishing.
    const lookup = lookupEventDefinition("page.qa_passed");
    expect(lookup.definition!.event_name).toBe("page.published");
    expect(lookup.resolved_from).toBe("page.qa_passed");
  });

  it("still emits a deprecated event, marked, rather than dropping it", async () => {
    const res = await deprecate("event", "page.qa_passed", "page.published", ctx, noDb);
    const resolved = await resolveApproval(
      res.approval_id!,
      { status: "APPROVED", resolved_by: "owner" },
      noDb
    );
    await applyApprovedChange(res.approval_id!, resolved as ApprovalItem, noDb);
    const emitted = await validateAndEmit({ event_name: "page.qa_passed" }, noDb);
    expect(emitted.status).toBe("emitted_undefined");
    expect(emitted.envelope?.context.deprecated_by).toBe("page.published");
  });

  it("refuses to deprecate toward an unregistered replacement", async () => {
    const res = await deprecate("event", "page.qa_passed", "page.nonexistent", ctx, noDb);
    expect(res.outcome).toBe("rejected");
  });

  it("shows the blast radius before the owner approves", async () => {
    await proposeMetricDefinition(
      {
        metric_key: "qa_passes",
        display_name: "QA passes",
        formula_description: "Count of page.qa_passed events.",
        metric_type: "count",
        source_events: ["page.qa_passed"],
        metric_window: "rolling_7d",
        status: "approved",
      },
      ctx,
      noDb
    );
    const res = await deprecate("event", "page.qa_passed", "page.published", ctx, noDb);
    expect(res.analysis?.differences[0]).toMatch(/metrics reading this event: qa_passes/);
  });
});

describe("lineage and impact", () => {
  beforeEach(async () => {
    await proposeMetricDefinition(
      {
        metric_key: "packet_use_rate",
        display_name: "Packet use rate",
        formula_description: "packet.viewed over intake.started in the window.",
        metric_type: "rate",
        source_events: ["packet.viewed", "packet.downloaded"],
        denominator_event: "intake.started",
        metric_window: "rolling_7d",
        status: "approved",
      },
      ctx,
      noDb
    );
  });

  it("resolves a metric to its source events and each event's current version", () => {
    const lineage = getMetricLineage("packet_use_rate");
    expect(lineage.definition_versions.length).toBe(1);
    const names = lineage.source_event_chain.map((c) => c.event_name).sort();
    expect(names).toEqual(["intake.started", "packet.downloaded", "packet.viewed"]);
    for (const link of lineage.source_event_chain) {
      expect(link.definition_version).toBe(1);
      expect(link.status).toBe("approved");
    }
    expect(
      lineage.source_event_chain.find((c) => c.event_name === "intake.started")!.is_denominator
    ).toBe(true);
  });

  it("carries the FULL version history, not just the latest", async () => {
    const res = await proposeMetricDefinitionChange(
      "packet_use_rate",
      { display_name: "Packet use" },
      ctx,
      noDb
    );
    const resolved = await resolveApproval(
      res.approval_id!,
      { status: "APPROVED", resolved_by: "owner" },
      noDb
    );
    await applyApprovedChange(res.approval_id!, resolved as ApprovalItem, noDb);
    const lineage = getMetricLineage("packet_use_rate");
    expect(lineage.definition_versions.map((v) => v.definition_version)).toEqual([1, 2]);
  });

  it("reverses: every live metric that consumes an event, denominators included", () => {
    expect(getEventImpact("packet.viewed").map((m) => m.metric_key)).toEqual(["packet_use_rate"]);
    expect(getEventImpact("intake.started").map((m) => m.metric_key)).toEqual(["packet_use_rate"]);
    expect(getEventImpact("page.retired")).toEqual([]);
  });

  it("marks a source event the dictionary does not carry as unregistered", async () => {
    // Deprecating the denominator is exactly the blast radius the owner needs.
    const res = await deprecate("event", "intake.started", "problem.created", ctx, noDb);
    const resolved = await resolveApproval(
      res.approval_id!,
      { status: "APPROVED", resolved_by: "owner" },
      noDb
    );
    await applyApprovedChange(res.approval_id!, resolved as ApprovalItem, noDb);
    const lineage = getMetricLineage("packet_use_rate");
    expect(
      lineage.source_event_chain.find((c) => c.event_name === "intake.started")!.status
    ).toBe("deprecated");
  });
});

describe("scheduled dictionary audit (Stage F)", () => {
  it("writes exactly ONE ledger row and reports the census", async () => {
    await validateAndEmit({ event_name: "page.viewed" }, noDb);
    await validateAndEmit({ event_name: "not.registered_at_all" }, noDb);
    const audit = await runScheduledDictionaryAudit(noDb);
    expect(recentAgentRuns().length).toBe(1);
    expect(recentAgentRuns()[0].trigger).toBe("schedule");
    expect(audit.result.blocked_unregistered_count).toBe(1);
    expect(audit.result.undefined_event_count).toBeGreaterThan(0);
    expect(audit.result.census.events.approved).toBeGreaterThan(70);
    expect(audit.result.census.metrics.proposed).toBe(11);
  });

  it("lists every auto-registered definition in the digest — the visibility auto-validation buys", async () => {
    await proposeEventDefinition(newEventInput(), ctx, noDb);
    const audit = await runScheduledDictionaryAudit(noDb);
    expect(audit.result.auto_registered_since_last_audit).toContain("event:warranty.claim_filed");
  });

  it("reports a zero sample rather than a false 'clean' with no database", async () => {
    const audit = await runScheduledDictionaryAudit(noDb);
    expect(audit.result.data_joinability_sample).toBe(0);
    expect(audit.result.undocumented_kpi_surfaces_checked).toBe(0);
  });
});

describe("approval_kind taxonomy (coherence issue 14)", () => {
  it("registers the four cross-agent kinds plus A08's own", () => {
    expect(APPROVAL_KINDS).toEqual([
      "seo.opportunity_decision",
      "seo.page_publish",
      "data.repair",
      "data.identity_merge",
      "dictionary.definition_change",
    ]);
    expect(ApprovalKind.safeParse("seo.page_publish").success).toBe(true);
    expect(ApprovalKind.safeParse("something.else").success).toBe(false);
  });

  it("is ADDITIVE — an ApprovalItem with no kind still parses, so nothing shipped breaks", async () => {
    const { ApprovalItem: ApprovalItemSchema, queueApproval } = await import(
      "@/platform/approvals/center"
    );
    const item = await queueApproval(
      {
        agent_id: "A06",
        run_id: "ar_x",
        what_happened: "A publish is waiting.",
        evidence: { page_id: "pg_1" },
        impact: "one page",
        risk: "low",
        reversibility: "reversible",
        proposed_change: { publish: true },
      },
      noDb
    );
    expect(item.approval_kind).toBeUndefined();
    expect(ApprovalItemSchema.safeParse(item).success).toBe(true);
  });
});
