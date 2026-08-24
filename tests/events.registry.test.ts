import { describe, expect, it } from "vitest";
import {
  CORE_EVENT_NAMES,
  EVENT_NAMES,
  LOOP_SEAM_EVENT_NAMES,
  SLICE_EVENT_NAMES,
  STEWARD_EVENT_NAMES,
} from "@/platform/events/names";
import { EventEnvelope } from "@/platform/events/envelope";

describe("canonical event names (A08 stewardship)", () => {
  it("contains no duplicates", () => {
    expect(new Set(EVENT_NAMES).size).toBe(EVENT_NAMES.length);
  });

  it("uses the domain.action naming convention", () => {
    for (const name of EVENT_NAMES) {
      expect(name).toMatch(/^[a-z_]+\.[a-z_]+$/);
    }
  });

  it("keeps every #14A §18.2 family present", () => {
    const required = [
      "page.viewed",
      "intake.started",
      "safety.triggered",
      "packet.generated",
      "trust.request_created",
      "trust.good_neighbor_offered",
      "home_person.saved",
      "provider.recommendation_shown",
      "feature_lab.viewed",
      "consent.granted",
      "page.published",
      "capability.invoked",
      "action.requested",
      "agent.run_started",
      "data_quality.quarantined",
      "ai_readiness.regression_blocked",
      "transition_signal.recorded",
    ];
    for (const name of required) {
      expect(EVENT_NAMES).toContain(name);
    }
  });

  it("keeps slice additions separate and documented", () => {
    for (const name of SLICE_EVENT_NAMES) {
      expect(CORE_EVENT_NAMES).not.toContain(name);
      expect(EVENT_NAMES).toContain(name);
    }
  });
});

describe("A08 name additions", () => {
  it("carries A08's own six emitted names — without them A08 cannot emit at all", () => {
    expect([...STEWARD_EVENT_NAMES]).toEqual([
      "schema.proposed",
      "schema.approved",
      "event.deprecated",
      "metric.created",
      "metric.versioned",
      "compatibility.failed",
    ]);
    for (const name of STEWARD_EVENT_NAMES) expect(EVENT_NAMES).toContain(name);
  });

  it("registers the loop-seam names the coherence report found missing", () => {
    for (const name of [
      "seo.opportunity_accepted",
      "seo.opportunity_rejected",
      "seo.opportunity_deferred",
      "page.defect_found",
      "page.defect_repaired",
      "seo.page_performance_recorded",
    ]) {
      expect(LOOP_SEAM_EVENT_NAMES as readonly string[]).toContain(name);
      expect(EVENT_NAMES).toContain(name);
    }
  });

  it("registers ONE opportunity-decision family: seo.*, never a parallel search.*", () => {
    expect(EVENT_NAMES.some((n) => n.startsWith("search."))).toBe(false);
  });

  it("prefixes A06's bare defect names so they pass the shipped convention", () => {
    expect(EVENT_NAMES as readonly string[]).not.toContain("defect_found");
    expect(EVENT_NAMES as readonly string[]).not.toContain("defect_repaired");
    for (const name of ["page.defect_found", "page.defect_repaired"]) {
      expect(name).toMatch(/^[a-z_]+\.[a-z_]+$/);
    }
  });

  it("keeps every A08 addition out of the #14A §18.2 core group", () => {
    for (const name of [...STEWARD_EVENT_NAMES, ...LOOP_SEAM_EVENT_NAMES]) {
      expect(CORE_EVENT_NAMES as readonly string[]).not.toContain(name);
    }
  });
});

describe("EventEnvelope", () => {
  const valid = {
    event_id: "ev_1",
    event_name: "page.viewed",
    event_version: 1,
    occurred_at: "2026-08-14T12:00:00Z",
    actor: { actor_type: "guest", actor_id: null },
    guest_session_id: "gs_1",
    context: { page_id: "page_ac_not_turning_on" },
    source: { channel: "web", referrer: null, landing_path: "/problems/ac-not-turning-on" },
    versions: { schema: "1.0.0" },
    result: { status: "ok", duration_ms: 12, cost_usd: null },
    privacy_class: "internal",
    trace_id: null,
    agent_run_id: null,
    action_request_id: null,
  };

  it("accepts a valid envelope", () => {
    expect(EventEnvelope.safeParse(valid).success).toBe(true);
  });

  it("rejects unregistered event names — no silent name drift", () => {
    expect(EventEnvelope.safeParse({ ...valid, event_name: "page.hacked" }).success).toBe(false);
  });

  it("rejects timestamps without timezone", () => {
    expect(EventEnvelope.safeParse({ ...valid, occurred_at: "2026-08-14 12:00" }).success).toBe(
      false
    );
  });

  /**
   * A08 step 8 verification gap: every case above tested a WRONG VALUE. Nothing
   * tested a MISSING KEY, so a required field quietly becoming `.optional()`
   * would have shipped green — the envelope is the contract of record for every
   * agent in the platform, and a silently droppable key is exactly the kind of
   * drift A08 exists to prevent. The schema already rejects these; that is the
   * point, and now it is pinned.
   */
  const requiredKeys = Object.keys(valid) as (keyof typeof valid)[];

  it("pins the required-key count — a new required key must update this list deliberately", () => {
    expect(requiredKeys).toHaveLength(14);
  });

  it.each(requiredKeys)("rejects an envelope missing %s", (key) => {
    const incomplete: Record<string, unknown> = { ...valid };
    delete incomplete[key as string];
    expect(EventEnvelope.safeParse(incomplete).success).toBe(false);
  });

  it("rejects a missing trace_id — NULLABLE is not the same as OPTIONAL", () => {
    const { trace_id: _omitted, ...withoutTraceId } = valid;
    expect(EventEnvelope.safeParse({ ...withoutTraceId, trace_id: null }).success).toBe(true);
    expect(EventEnvelope.safeParse(withoutTraceId).success).toBe(false);
  });

  it("rejects a missing event_name — the name is what makes an envelope readable", () => {
    const { event_name: _omitted, ...withoutEventName } = valid;
    expect(EventEnvelope.safeParse(withoutEventName).success).toBe(false);
  });

  /**
   * The counterpart that keeps the loop above honest: tenant_id is the ONE key
   * that is genuinely optional (reserved for white-label condition (a), with no
   * tenant logic anywhere). If it ever became required, the loop would still
   * pass while every existing producer broke — so its absence is pinned too.
   */
  it("keeps tenant_id optional — the one reserved key an emitter may omit", () => {
    expect(requiredKeys).not.toContain("tenant_id");
    expect(EventEnvelope.safeParse(valid).success).toBe(true);
    expect(EventEnvelope.safeParse({ ...valid, tenant_id: "prn" }).success).toBe(true);
    expect(EventEnvelope.safeParse({ ...valid, tenant_id: "" }).success).toBe(false);
  });
});
