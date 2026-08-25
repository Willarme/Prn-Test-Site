import { mkdtemp } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ACTIVE_DISCLOSURE } from "@/domain/privacy/disclosures";
import { readDevDb } from "@/platform/stores/dev-db";
import { engageKillSwitch, resetKillSwitchForTests } from "@/platform/killswitch";

/**
 * A02 STEP 5 — THE THREE LIVE CALL SITES (Trial Spec Audit HO-4).
 *
 * The A02 spec names NONE of them, and its §11 "exact seams to build against"
 * block names only fixture-engine.ts. A build session obeying it would have
 * governed one third of the packet path and left the richest implementation —
 * the one the /complete flow actually uses — running outside the door.
 */

let intakePost: (req: Request) => Promise<Response>;
let answerPost: (req: Request) => Promise<Response>;

beforeAll(async () => {
  const dir = await mkdtemp(join(tmpdir(), "prn-a02-"));
  process.env.PRN_DEV_DB_PATH = join(dir, "dev-db.json");
  ({ POST: intakePost } = await import("@/app/api/intake/route"));
  ({ POST: answerPost } = await import("@/app/api/intake/answer/route"));
});

afterAll(() => {
  delete process.env.PRN_DEV_DB_PATH;
  resetKillSwitchForTests();
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

describe("A02 — call site 1: the intake route", () => {
  it("produces a packet through A02 and records the completion edge", async () => {
    const res = await intakePost(
      intakeRequest("The kitchen sink drain is backing up whenever the dishwasher runs")
    );
    expect(res.status).toBe(200);
    const { request_id } = await res.json();

    const db = readDevDb();
    const session = db.intake_sessions.find((s) => s.request_id === request_id)!;
    const problem = db.problems.find((p) => p.intake_session_id === session.intake_session_id)!;
    const packet = db.packets.find((k) => k.problem_id === problem.problem_id)!;

    // A02 stamped it, which is only possible if it came through buildPacket.
    expect(packet.generation_run_id).toMatch(/^ar_/);
    expect(packet.status).toBe("current");
    expect(packet.evidence_basis).toEqual(problem.evidence_ids);
    expect(packet.template_version).toBe("packet-copy@1.0.0");

    const names = db.events.map((e) => e.event_name);
    expect(names).toContain("problem.intake_completed");
    expect(names).toContain("packet.generated");
  });

  it("emits packet.generated EXACTLY ONCE per generation, not twice", async () => {
    const before = readDevDb().events.filter((e) => e.event_name === "packet.generated").length;
    await intakePost(intakeRequest("The upstairs toilet keeps running long after a flush"));
    const after = readDevDb().events.filter((e) => e.event_name === "packet.generated").length;
    expect(after - before).toBe(1);
  });

  it("keeps the completion envelope customer-attributed, with the door context", async () => {
    const db = readDevDb();
    const completed = db.events.filter((e) => e.event_name === "problem.intake_completed");
    expect(completed.length).toBeGreaterThan(0);
    for (const e of completed) {
      expect(e.guest_session_id).toMatch(/^gs_/);
      expect(e.source.landing_path).toBe("/start");
      expect(e.context.problem_id).toMatch(/^pr_/);
      // IDS ONLY. Nothing the homeowner typed rides in an envelope.
      for (const value of Object.values(e.context)) {
        expect(value.length).toBeLessThan(80);
      }
    }
  });

  it("a kill switch on A02 stops the packet — with no silent fallback", async () => {
    await engageKillSwitch({ scope: "AGENT", scope_ref: "A02", by: "test" });
    const packetsBefore = readDevDb().packets.length;
    const res = await intakePost(intakeRequest("There is a brown stain spreading on the ceiling"));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toMatch(/Your text is still here/);
    expect(body.detail).toMatch(/kill switch/i);
    // No packet was built around the gate.
    expect(readDevDb().packets.length).toBe(packetsBefore);
    resetKillSwitchForTests();
  });

  it("the route no longer calls the packet builder directly", () => {
    const src = readFileSync(join(process.cwd(), "src/app/api/intake/route.ts"), "utf-8");
    expect(src).not.toMatch(/buildJobPacketFixture/);
    expect(src).toMatch(/buildPacket\(/);
  });
});

describe("A02 — call site 2: regeneration through platform/intake/complete.ts", () => {
  it("a new version is governed, chained, and EVENTED", async () => {
    const res = await intakePost(
      intakeRequest("The air conditioner is blowing warm air since this morning")
    );
    const { request_id } = await res.json();
    const problemId = readDevDb().problems.at(-1)!.problem_id;
    const before = readDevDb().events.filter((e) => e.event_name === "packet.regenerated").length;

    const answerRes = await answerPost(
      new Request("http://localhost/api/intake/answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          request_id,
          field_key: "system_age",
          value_text: "About 9 years old",
        }),
      })
    );
    expect(answerRes.status).toBe(200);

    const db = readDevDb();
    const versions = db.packets
      .filter((k) => k.problem_id === problemId)
      .sort((a, b) => a.packet_version - b.packet_version);
    expect(versions.length).toBeGreaterThan(1);
    const latest = versions.at(-1)!;
    expect(latest.packet_version).toBe(2);
    expect(latest.generation_run_id).toMatch(/^ar_/);
    expect(latest.status).toBe("current");
    // A NEW id, so the ledger keeps every packet the customer ever saw.
    expect(latest.job_packet_id).not.toBe(versions[0].job_packet_id);

    const after = db.events.filter((e) => e.event_name === "packet.regenerated").length;
    expect(after - before).toBe(1);
    // …and regeneration is NOT counted as a fresh generation.
    const regen = db.events.filter((e) => e.event_name === "packet.regenerated").at(-1)!;
    expect(regen.context.packet_version).toBe("2");
    expect(regen.agent_run_id).toBe(latest.generation_run_id);
  });

  it("regeneration still consumes the seam the spec never mentions", async () => {
    const db = readDevDb();
    const latest = db.packets.at(-1)!;
    // collected_details exists only on the assemblePacket path.
    expect(latest.collected_details.length).toBeGreaterThan(0);
  });

  it("complete.ts no longer calls assemblePacket directly", () => {
    const src = readFileSync(join(process.cwd(), "src/platform/intake/complete.ts"), "utf-8");
    expect(src).not.toMatch(/assemblePacket\(/);
    expect(src).toMatch(/buildPacket\(/);
  });

  it("a refusal leaves the previous version standing rather than erroring a saved answer", async () => {
    const res = await intakePost(intakeRequest("Water is seeping under the washing machine"));
    const { request_id } = await res.json();
    const problemId = readDevDb().problems.at(-1)!.problem_id;
    await engageKillSwitch({ scope: "AGENT", scope_ref: "A02", by: "test" });
    const answerRes = await answerPost(
      new Request("http://localhost/api/intake/answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request_id, field_key: "brand", value_text: "Whirlpool" }),
      })
    );
    // The customer's write succeeded; only the refresh was refused.
    expect(answerRes.status).toBe(200);
    const versions = readDevDb().packets.filter((k) => k.problem_id === problemId);
    expect(versions.length).toBe(1);
    resetKillSwitchForTests();
  });
});

describe("A02 — call site 3: the gateway executor", () => {
  it("dispatches BOTH halves of the live path, not just the fixture builder", () => {
    const src = readFileSync(join(process.cwd(), "src/platform/gateway/index.ts"), "utf-8");
    expect(src).toMatch(/generate_job_packet: \(args\) => generateJobPacket/);
    expect(src).not.toMatch(/buildJobPacketFixture\(/);
  });
});
