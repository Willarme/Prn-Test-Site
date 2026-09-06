import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ACTIVE_DISCLOSURE } from "@/domain/privacy/disclosures";
import { signLink } from "@/platform/links/tokens";
import { readDevDb } from "@/platform/stores/dev-db";

/**
 * POST /api/feedback — the popup's collector stores the three-chip score
 * (campaign track P2). On a temp dev-db, against a request the JSON intake
 * route really created.
 */
let feedbackPost: (req: Request) => Promise<Response>;
let requestId: string;

beforeAll(async () => {
  const dir = await mkdtemp(join(tmpdir(), "prn-devdb-p2-fb-"));
  process.env.PRN_DEV_DB_PATH = join(dir, "dev-db.json");
  process.env.PRN_RUNTIME_STORE = "file";
  const { POST: intakePost } = await import("@/app/api/intake/route");
  ({ POST: feedbackPost } = await import("@/app/api/feedback/route"));
  const res = await intakePost(
    new Request("http://localhost/api/intake", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        description: "The air is coming out but it isn't cold. Started yesterday afternoon.",
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
    })
  );
  requestId = ((await res.json()) as { request_id: string }).request_id;
  expect(requestId).toMatch(/^rq_/);
});

afterAll(() => {
  delete process.env.PRN_DEV_DB_PATH;
  delete process.env.PRN_RUNTIME_STORE;
});

function post(body: unknown): Request {
  return new Request("http://localhost/api/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body && typeof body === "object" && "request_id" in body ? { ...body, k: signLink({scope:"keep", request_id:String(body.request_id)}) } : body),
  });
}

describe("POST /api/feedback", () => {
  it("refuses a response without owner authority", async () => {
    const res = await feedbackPost(new Request("http://localhost/api/feedback", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ request_id: requestId, score: "very" }),
    }));
    expect(res.status).toBe(404);
  });
  it("stores a score, the right-keys and the near-miss line against a real request", async () => {
    const res = await feedbackPost(
      post({
        request_id: requestId,
        score: "very",
        right: ["remembered", "ready_to_talk", "remembered"],
        slow: "  The photo step took a while.  ",
      })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, recorded: "file" });
    const rows = readDevDb().feedback.filter((f) => f.request_id === requestId);
    expect(rows).toHaveLength(1);
    expect(rows[0].feedback_id).toMatch(/^fb_/);
    expect(rows[0].score).toBe("very");
    expect(rows[0].right).toEqual(["remembered", "ready_to_talk"]);
    expect(rows[0].slow).toBe("The photo step took a while.");
    expect(rows[0].created_at).toMatch(/Z$/);
  });

  it("a chip alone is enough: right and slow default to empty", async () => {
    const res = await feedbackPost(post({ request_id: requestId, score: "not_really" }));
    expect(res.status).toBe(200);
    const rows = readDevDb().feedback.filter((f) => f.request_id === requestId);
    expect(rows).toHaveLength(2);
    expect(rows[1].score).toBe("not_really");
    expect(rows[1].right).toEqual([]);
    expect(rows[1].slow).toBeNull();
  });

  it("refuses a score outside the three chips, and an unknown right-key", async () => {
    expect((await feedbackPost(post({ request_id: requestId, score: "10/10" }))).status).toBe(400);
    expect(
      (await feedbackPost(post({ request_id: requestId, score: "very", right: ["price_was_fair"] })))
        .status
    ).toBe(400);
    expect((await feedbackPost(post({ score: "very" }))).status).toBe(400);
    expect(readDevDb().feedback.filter((f) => f.request_id === requestId)).toHaveLength(2);
  });

  it("an unknown request is refused and recorded nowhere", async () => {
    const res = await feedbackPost(post({ request_id: "rq_nobody_made_this", score: "somewhat" }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ ok: false, error: "unavailable" });
    expect(readDevDb().feedback.some((f) => f.request_id === "rq_nobody_made_this")).toBe(false);
  });
});
