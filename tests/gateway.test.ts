import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
import { analyzeProblemFixture } from "@/domain/problem/fixture-engine";
import { capability_call } from "@/platform/gateway";
import { recentAgentRuns, resetAgentRunLedgerForTests } from "@/platform/runs/ledger";

/**
 * A00 §9 step 5 — AI/Tool Gateway stub. Today's REAL state (verified: no AI
 * SDK installed, no model key consulted anywhere in this module) is the
 * expected path: every call resolves to the deterministic stand-in, logs
 * provider "deterministic-stand-in", and never throws.
 */
beforeAll(async () => {
  const dir = await mkdtemp(join(tmpdir(), "prn-gateway-"));
  process.env.PRN_DEV_DB_PATH = join(dir, "dev-db.json");
});

afterAll(() => {
  delete process.env.PRN_DEV_DB_PATH;
});

beforeEach(() => {
  resetAgentRunLedgerForTests();
});

const ANALYZE_ARGS = {
  description: "Kitchen sink drain is clogged and backing up into the basin",
  intake_session_id: "is_gateway_test",
  problem_family_hint: null,
  now: "2026-08-24T12:00:00Z",
};

describe("A00 AI/Tool gateway", () => {
  it("routes classify_problem to the fixture engine and returns its answer UNCHANGED", async () => {
    const direct = analyzeProblemFixture(ANALYZE_ARGS);
    const viaGateway = await capability_call({
      agent_id: "A01",
      capability: "classify_problem",
      args: ANALYZE_ARGS,
      input_ids: ["is_gateway_test"],
    });
    expect(viaGateway.ok).toBe(true);
    if (!viaGateway.ok) return;
    // Byte-for-byte identical to calling the stand-in directly (do-not-touch
    // guarantee: wrapping never changes fixture-engine output).
    expect(viaGateway.output).toEqual(direct);
    expect(viaGateway.provider).toBe("deterministic-stand-in");

    const runs = recentAgentRuns();
    expect(runs.length).toBe(1);
    expect(runs[0].agent_id).toBe("A01");
    expect(runs[0].tool_provider).toBe("deterministic-stand-in");
    expect(runs[0].capabilities_used).toEqual(["classify_home_problem"]);
    expect(runs[0].cost_usd).toBe(0);
  });

  it("does not throw with no model/vendor key of any kind set (today's real state)", async () => {
    // The gateway consults no vendor env var at all — assert the call
    // completes cleanly rather than depending on which keys exist locally.
    await expect(
      capability_call({ agent_id: "A01", capability: "classify_problem", args: ANALYZE_ARGS })
    ).resolves.toMatchObject({ ok: true, provider: "deterministic-stand-in" });
  });

  it("an unknown capability is a clean error result + audit row, never a throw", async () => {
    const res = await capability_call({
      agent_id: "A01",
      capability: "no_such_capability",
      args: {},
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.kind).toBe("error");
    expect(recentAgentRuns().length).toBe(1);
    expect(recentAgentRuns()[0].errors?.[0]).toMatch(/unknown capability/);
  });

  it("an agent that does not own a capability is blocked and the block is audited", async () => {
    const res = await capability_call({
      agent_id: "A02",
      capability: "classify_problem", // owned by A01
      args: ANALYZE_ARGS,
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.kind).toBe("blocked");
    expect(recentAgentRuns()[0].errors?.[0]).toMatch(/blocked/);
  });

  it("unknown agents never execute", async () => {
    const res = await capability_call({
      agent_id: "A99",
      capability: "classify_problem",
      args: ANALYZE_ARGS,
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.kind).toBe("blocked");
    expect(res.reason).toMatch(/unknown agent/);
  });

  it("FUTURE_DISABLED capabilities can never execute through the gateway", async () => {
    const res = await capability_call({ agent_id: "A01", capability: "payments", args: {} });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.kind).toBe("blocked");
    expect(res.reason).toMatch(/FUTURE_DISABLED|does not own/);
  });
});
