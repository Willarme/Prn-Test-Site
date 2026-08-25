import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ACTIVE_DISCLOSURE } from "@/domain/privacy/disclosures";
import { readDevDb } from "@/platform/stores/dev-db";
import { runtimeStore } from "@/platform/stores/runtime";

/**
 * EXACTLY ONE PACKET VERSION IS CURRENT.
 *
 * `status` and `superseded_by` shipped on JobPacket as canon fields and NOTHING
 * MAINTAINED THEM: driving a real journey through two answers produced three
 * versions, all `status: "current"`, all `superseded_by: null`, distinguished
 * only by `packet_version`. Unmaintained fields are worse than absent ones — a
 * reader that trusts `status` gets three answers to a single-answer question.
 *
 * Every version below is produced by driving the REAL routes: the intake route
 * for version 1, then the answer route (which is what a homeowner's typed
 * detail actually posts to) for each regeneration.
 */
let intakePost: (req: Request) => Promise<Response>;
let answerPost: (req: Request) => Promise<Response>;

beforeAll(async () => {
  const dir = await mkdtemp(join(tmpdir(), "prn-chain-"));
  process.env.PRN_DEV_DB_PATH = join(dir, "dev-db.json");
  ({ POST: intakePost } = await import("@/app/api/intake/route"));
  ({ POST: answerPost } = await import("@/app/api/intake/answer/route"));
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

function answerRequest(requestId: string, fieldKey: string, value: string) {
  return new Request("http://localhost/api/intake/answer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ request_id: requestId, fields: [{ field_key: fieldKey, value }] }),
  });
}

async function versionsFor(requestId: string) {
  const db = readDevDb();
  const session = db.intake_sessions.find((s) => s.request_id === requestId)!;
  const problem = db.problems.find((p) => p.intake_session_id === session.intake_session_id)!;
  return db.packets
    .filter((k) => k.problem_id === problem.problem_id)
    .sort((a, b) => a.packet_version - b.packet_version);
}

describe("the packet version chain is maintained", () => {
  it("after two regenerations there are three versions, exactly one current, chained end to end", async () => {
    const res = await intakePost(intakeRequest("The AC won't turn on since yesterday evening"));
    const { request_id } = await res.json();

    expect((await versionsFor(request_id)).length).toBe(1);

    expect((await answerPost(answerRequest(request_id, "brand", "Carrier"))).status).toBe(200);
    expect(
      (await answerPost(answerRequest(request_id, "unit_model_serial", "24ABC6 / 1234E56789")))
        .status
    ).toBe(200);

    const versions = await versionsFor(request_id);
    expect(versions.map((v) => v.packet_version)).toEqual([1, 2, 3]);

    // THE ASSERTION THE FINDING IS ABOUT.
    const current = versions.filter((v) => v.status === "current");
    expect(current.length).toBe(1);
    expect(current[0].packet_version).toBe(3);
    expect(current[0].superseded_by ?? null).toBeNull();

    // And the chain is intact: each older version points at its immediate
    // successor, not at the newest, so the history is walkable in order.
    for (let i = 0; i < versions.length - 1; i += 1) {
      expect(versions[i].status).toBe("superseded");
      expect(versions[i].superseded_by).toBe(versions[i + 1].job_packet_id);
    }
  });

  it("the homeowner still sees the newest version — the read path did not change", async () => {
    const res = await intakePost(intakeRequest("The furnace is blowing cold air"));
    const { request_id } = await res.json();
    await answerPost(answerRequest(request_id, "symptom_timing", "started last night"));

    const journey = await runtimeStore().getJourney(request_id);
    expect(journey).not.toBeNull();
    expect(journey!.packet.packet_version).toBe(2);
    expect(journey!.packet.status).toBe("current");
  });

  it("supersession is idempotent — the FIRST successor stays the true one", async () => {
    const res = await intakePost(intakeRequest("AC is blowing warm air"));
    const { request_id } = await res.json();
    await answerPost(answerRequest(request_id, "symptom_timing", "since this morning"));

    const versions = await versionsFor(request_id);
    const first = versions[0];
    const store = runtimeStore();
    // A re-run (a retry, a replayed job) must not rewrite history.
    await store.supersedePacket(first.job_packet_id, "jp_some_later_thing");
    const after = (await versionsFor(request_id))[0];
    expect(after.superseded_by).toBe(versions[1].job_packet_id);
  });

  it("a version nobody stored is a no-op, not a throw", async () => {
    await expect(
      runtimeStore().supersedePacket("jp_does_not_exist", "jp_also_not")
    ).resolves.toBeUndefined();
  });
});
