import { describe, expect, it } from "vitest";
import { CORE_EVENT_NAMES, EVENT_NAMES, SLICE_EVENT_NAMES } from "@/platform/events/names";
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
});
