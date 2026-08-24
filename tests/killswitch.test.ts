import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
import { capability_call } from "@/platform/gateway";
import {
  KillSwitchState,
  checkKillSwitch,
  engageKillSwitch,
  releaseKillSwitch,
  resetKillSwitchForTests,
} from "@/platform/killswitch";
import { recentAgentRuns, resetAgentRunLedgerForTests } from "@/platform/runs/ledger";
import { readDevDb } from "@/platform/stores/dev-db";

/**
 * A00 §9 step 8 — Kill Switch: engage → next call for that scope is blocked
 * AND logged; release → normal operation resumes. GLOBAL blocks regardless
 * of agent-level state. The check is synchronous, before any capability
 * work.
 */
beforeAll(async () => {
  const dir = await mkdtemp(join(tmpdir(), "prn-killswitch-"));
  process.env.PRN_DEV_DB_PATH = join(dir, "dev-db.json");
});

afterAll(() => {
  delete process.env.PRN_DEV_DB_PATH;
});

beforeEach(() => {
  resetKillSwitchForTests();
  resetAgentRunLedgerForTests();
});

const ANALYZE_ARGS = {
  description: "Bathroom outlet sparks when anything is plugged in",
  intake_session_id: "is_killswitch_test",
  problem_family_hint: null,
  now: "2026-08-24T12:00:00Z",
};

async function callA01() {
  return capability_call({ agent_id: "A01", capability: "classify_problem", args: ANALYZE_ARGS });
}

describe("A00 kill switch", () => {
  it("AGENT scope: engage blocks + logs the next call for that agent; release resumes", async () => {
    // Normal operation first.
    expect((await callA01()).ok).toBe(true);

    await engageKillSwitch({ scope: "AGENT", scope_ref: "A01", by: "owner:test", reason: "test pause" });
    const blocked = await callA01();
    expect(blocked.ok).toBe(false);
    if (blocked.ok) return;
    expect(blocked.kind).toBe("blocked");
    expect(blocked.reason).toMatch(/kill switch engaged \(AGENT\)/);
    // The block itself is a ledger row — halted, logged, caller told why.
    const blockedRun = recentAgentRuns()[recentAgentRuns().length - 1];
    expect(blockedRun.errors?.[0]).toMatch(/kill switch/);

    await releaseKillSwitch({ scope: "AGENT", scope_ref: "A01", by: "owner:test" });
    const resumed = await callA01();
    expect(resumed.ok).toBe(true);
  });

  it("GLOBAL scope blocks every agent regardless of agent-level state", async () => {
    // A01's own switch is clear — engage GLOBAL only.
    await engageKillSwitch({ scope: "GLOBAL", by: "owner:test", reason: "full stop" });
    expect(checkKillSwitch("A01").scope).toBe("GLOBAL");
    expect(checkKillSwitch("A02").scope).toBe("GLOBAL");

    const blocked = await callA01();
    expect(blocked.ok).toBe(false);
    if (blocked.ok) return;
    expect(blocked.reason).toMatch(/GLOBAL/);

    await releaseKillSwitch({ scope: "GLOBAL", by: "owner:test" });
    expect((await callA01()).ok).toBe(true);
  });

  it("GLOBAL wins even while an agent switch is also engaged", async () => {
    await engageKillSwitch({ scope: "AGENT", scope_ref: "A01", by: "owner:test" });
    await engageKillSwitch({ scope: "GLOBAL", by: "owner:test" });
    expect(checkKillSwitch("A01").scope).toBe("GLOBAL");
    await releaseKillSwitch({ scope: "GLOBAL", by: "owner:test" });
    // Agent switch still engaged after the global release.
    expect(checkKillSwitch("A01").scope).toBe("AGENT");
  });

  it("every toggle emits an audit envelope (history append-only, names provisional pending A08)", async () => {
    await engageKillSwitch({ scope: "AGENT", scope_ref: "A01", by: "owner:test" });
    await releaseKillSwitch({ scope: "AGENT", scope_ref: "A01", by: "owner:test" });
    const events = readDevDb().events;
    const engagedEvents = events.filter((e) => e.event_name === "platform.kill_switch_engaged");
    const releasedEvents = events.filter((e) => e.event_name === "platform.kill_switch_released");
    expect(engagedEvents.length).toBeGreaterThanOrEqual(1);
    expect(releasedEvents.length).toBeGreaterThanOrEqual(1);
    expect(engagedEvents[0].context.scope).toBe("AGENT");
    expect(engagedEvents[0].context.scope_ref).toBe("A01");
  });

  it("state parses against the contract and carries the reserved tenant_id default", async () => {
    const state = await engageKillSwitch({ scope: "GLOBAL", by: "owner:test", reason: "r" });
    expect(KillSwitchState.safeParse(state).success).toBe(true);
    expect(state.tenant_id).toBe("prn");
    expect(state.engaged).toBe(true);
  });

  it("the check is synchronous — no awaited work before the verdict", () => {
    // checkKillSwitch returns a plain object, not a promise.
    const verdict = checkKillSwitch("A01");
    expect(typeof (verdict as unknown as { then?: unknown }).then).toBe("undefined");
    expect(verdict.engaged).toBe(false);
  });
});
