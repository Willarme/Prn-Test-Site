import { describe, expect, it } from "vitest";
import { TRIAL_AGENT_REGISTRY } from "@/platform/agents/registry";
import { getPolicySetting } from "@/platform/policy/store";

/**
 * A08's own registry entry and its run discipline (Loop Spec Audit conditions
 * 6, 7 and 12). The behaviours themselves are proved in
 * tests/events.steward.test.ts; this pins the declarations that describe them.
 */
const a08 = TRIAL_AGENT_REGISTRY.find((a) => a.agent_id === "A08")!;

describe("A08 registry entry", () => {
  it("keeps autonomy_level TBD — the two-scale canon conflict is the owners' call", () => {
    expect(a08.autonomy_level).toBe("TBD");
  });

  it("uses the shipped kill-switch ref convention, not a new one", () => {
    expect(a08.kill_switch_ref).toBe("agent:A08");
  });

  it("declares NO capabilities — A08 never calls the AI/Tool Gateway", () => {
    expect(a08.allowed_capabilities).toEqual([]);
  });

  it("enumerates exactly what the built modules read and write", () => {
    expect(a08.write_access).toEqual(["event_definition", "metric_definition", "approval_item"]);
    expect(a08.data_access).toContain("event_envelope");
    // The audit reads the live stream; it must never claim access to a
    // customer-evidence table (condition 14).
    for (const table of ["intake_answer", "evidence", "consent_event", "problem_record"]) {
      expect(a08.data_access).not.toContain(table);
    }
  });

  it("names its audit cadence as configuration, not a hard-coded constant", () => {
    expect(a08.schedule).toMatch(/events\.dictionary_audit_cadence_hours/);
    expect(getPolicySetting<number>("events.dictionary_audit_cadence_hours")).not.toBeNull();
  });

  it("sets no budget dollar figure", () => {
    expect(a08.budgets.ai_api_dollars_per_day).toBeUndefined();
  });
});
