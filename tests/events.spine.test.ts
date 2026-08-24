import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { ACTIVE_DISCLOSURE } from "@/domain/privacy/disclosures";
import { EventEnvelope } from "@/platform/events/envelope";
import { emitPlatformEvent } from "@/platform/events/emit";
import { PLATFORM_EVENT_NAMES } from "@/platform/events/names";
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
    expect(envelope.tenant_id).toBe("prn");
    expect(EventEnvelope.safeParse(envelope).success).toBe(true);
  });

  it("platform name additions are exactly the two provisional kill-switch names", () => {
    expect([...PLATFORM_EVENT_NAMES]).toEqual([
      "platform.kill_switch_engaged",
      "platform.kill_switch_released",
    ]);
  });

  it("emit never leaks customer free text — context is IDs only by construction", async () => {
    const envelope = await emitPlatformEvent({
      event_name: "agent.run_completed",
      agent_id: "A01",
      context: { problem_id: "pr_x" },
    });
    expect(Object.keys(envelope.context)).toEqual(["problem_id"]);
  });
});
