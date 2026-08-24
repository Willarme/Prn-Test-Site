import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { ACTIVE_DISCLOSURE } from "@/domain/privacy/disclosures";
import { EventEnvelope } from "@/platform/events/envelope";
import {
  emitPlatformEvent,
  resetPlatformEventEmitterForTests,
  type PlatformEventInput,
} from "@/platform/events/emit";
import { EVENT_NAMES, PLATFORM_EVENT_NAMES } from "@/platform/events/names";
import { readDevDb } from "@/platform/stores/dev-db";
import { resetAgentRunLedgerForTests, recentAgentRuns } from "@/platform/runs/ledger";

/**
 * A00 §9 step 4 — Event + Metric Spine mechanism: the same proof-case call
 * from step 3 also emits ONE well-formed EventEnvelope, linked to the run by
 * agent_run_id. The event name used is the EXISTING canonical A08-owned
 * "agent.run_completed" — A00 invented no new names for the proof case; the
 * two platform.kill_switch_* additions are explicitly provisional pending
 * A08 (see names.ts).
 */
let intakePost: (req: Request) => Promise<Response>;

beforeAll(async () => {
  const dir = await mkdtemp(join(tmpdir(), "prn-spine-"));
  process.env.PRN_DEV_DB_PATH = join(dir, "dev-db.json");
  ({ POST: intakePost } = await import("@/app/api/intake/route"));
  resetAgentRunLedgerForTests();
});

afterAll(() => {
  delete process.env.PRN_DEV_DB_PATH;
});

function intakeRequest(description: string) {
  return new Request("http://localhost/api/intake", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      description,
      disclosure_content_hash: ACTIVE_DISCLOSURE.content_hash,
      attribution: {
        page_id: null,
        intent_cluster_id: null,
        search_opportunity_id: null,
        problem_family_hint: null,
        experiment_id: null,
        variant: null,
        referrer: null,
        landing_path: "/start",
      },
    }),
  });
}

describe("A00 event + metric spine", () => {
  it("the intake proof-case run emits one well-formed agent.run_completed envelope", async () => {
    const res = await intakePost(intakeRequest("Water heater is leaking from the bottom seam"));
    expect(res.status).toBe(200);

    const run = recentAgentRuns()[recentAgentRuns().length - 1];
    const events = readDevDb().events.filter((e) => e.event_name === "agent.run_completed");
    expect(events.length).toBe(1);
    const envelope = events[0];
    expect(EventEnvelope.safeParse(envelope).success).toBe(true);
    expect(envelope.agent_run_id).toBe(run.run_id);
    expect(envelope.actor.actor_type).toBe("agent");
    expect(envelope.actor.actor_id).toBe("A01");
    expect(envelope.context.problem_id).toMatch(/^pr/);
    expect(envelope.result.cost_usd).toBe(0);
    expect(envelope.privacy_class).toBe("internal");
  });

  it("envelopes carry the reserved tenant_id default with no logic around it", async () => {
    const envelope = await emitPlatformEvent({
      event_name: "agent.run_started",
      agent_id: "A02",
    });
    expect(envelope).not.toBeNull();
    expect(envelope!.tenant_id).toBe("prn");
    expect(EventEnvelope.safeParse(envelope).success).toBe(true);
  });

  /**
   * A08 UPDATE 2026-08-24 (Loop Spec Audit pre-answer 14). A00 pinned this
   * test to prove it invented no name family beyond the two kill-switch
   * strings, and marked those two PROVISIONAL PENDING A08 RATIFICATION.
   * A08 has now ratified them AS-IS: the two strings are unchanged, so the
   * original assertion still holds verbatim and A00's guarantee is intact.
   * What changed is their STATUS, so the test now also pins the ratification
   * — the group is still exactly these two names, and nothing may quietly
   * grow a `platform.*` family under cover of A08 having "opened" the file.
   */
  it("platform name additions are exactly the two kill-switch names, now A08-ratified", () => {
    expect([...PLATFORM_EVENT_NAMES]).toEqual([
      "platform.kill_switch_engaged",
      "platform.kill_switch_released",
    ]);
    for (const name of PLATFORM_EVENT_NAMES) {
      expect(EVENT_NAMES).toContain(name);
    }
  });

  it("emit never leaks customer free text — context is IDs only by construction", async () => {
    const envelope = await emitPlatformEvent({
      event_name: "agent.run_completed",
      agent_id: "A01",
      context: { problem_id: "pr_x" },
    });
    expect(envelope).not.toBeNull();
    expect(Object.keys(envelope!.context)).toEqual(["problem_id"]);
  });
});

/**
 * A08 step 8 verification defect: emit.ts documented "Never throws" and
 * steward.ts stamps "NEVER throws" on validateAndEmit, but the envelope was
 * built with EventEnvelope.parse() OUTSIDE the try/catch. Every value below is
 * TYPE-LEGAL against PlatformEventInput (`number | null`, `string`) and so
 * passes the compiler, yet fails the schema — and the ZodError landed in the
 * CALLER'S business path. /api/intake, the capability gateway and the kill
 * switch all emit mid-request, so a bad duration figure could 500 a
 * homeowner's intake over telemetry. Fixed with safeParse + the existing
 * fail-soft miss-logging path.
 */
describe("emit fail-soft contract — telemetry can never throw into a caller", () => {
  beforeEach(() => {
    resetPlatformEventEmitterForTests();
  });

  const badInputs: [string, PlatformEventInput][] = [
    ["duration_ms NaN", { event_name: "agent.run_completed", duration_ms: Number.NaN }],
    ["duration_ms negative", { event_name: "agent.run_completed", duration_ms: -1 }],
    [
      "cost_usd Infinity",
      { event_name: "agent.run_completed", cost_usd: Number.POSITIVE_INFINITY },
    ],
    ["cost_usd negative", { event_name: "agent.run_completed", cost_usd: -0.01 }],
    ["agent_id empty", { event_name: "agent.run_completed", agent_id: "" }],
    ["tenant_id empty", { event_name: "agent.run_completed", tenant_id: "" }],
  ];

  it.each(badInputs)("resolves null instead of throwing on %s", async (_label, input) => {
    await expect(emitPlatformEvent(input)).resolves.toBeNull();
  });

  it("stores nothing when the envelope is malformed — no partial telemetry rows", async () => {
    const before = readDevDb().events.length;
    await emitPlatformEvent({ event_name: "agent.run_started", duration_ms: Number.NaN });
    expect(readDevDb().events.length).toBe(before);
  });

  it("a malformed telemetry figure cannot 500 a request whose work already succeeded", async () => {
    // The shape every emitting caller has: business work done, THEN emit.
    async function homeownerRequest(): Promise<Response> {
      const packet = { job_packet_id: "jp_1" };
      await emitPlatformEvent({
        event_name: "agent.run_completed",
        agent_id: "",
        duration_ms: Number.NaN,
        cost_usd: Number.POSITIVE_INFINITY,
      });
      return new Response(JSON.stringify(packet), { status: 200 });
    }
    const res = await homeownerRequest();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ job_packet_id: "jp_1" });
  });

  it("the real /api/intake path still answers 200 with the fail-soft emit in place", async () => {
    const res = await intakePost(intakeRequest("Furnace is making a loud banging noise"));
    expect(res.status).toBe(200);
  });
});
