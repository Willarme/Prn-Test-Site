import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * THE LOOP SURFACES ON THE FILE STORE (track F2b) — every method, through the
 * guarded runtimeStore() (so the A09 passthroughs are exercised too), on a
 * temp dev-db. The Supabase half of each method is covered by the pglite RLS
 * tests (tests/rls-isolation.test.ts loads migration 00020).
 */
type Runtime = typeof import("@/platform/stores/runtime");

let runtime: Runtime;
let dir: string;

function db(): Record<string, unknown[]> {
  return JSON.parse(readFileSync(process.env.PRN_DEV_DB_PATH!, "utf-8"));
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "prn-f2b-store-"));
  process.env.PRN_DEV_DB_PATH = join(dir, "dev-db.json");
  process.env.PRN_RUNTIME_STORE = "file";
  runtime = await import("@/platform/stores/runtime");
  runtime.resetRuntimeStore();
  (await import("@/platform/stores/dev-db")).updateDevDb(() => {});
});

afterAll(() => {
  delete process.env.PRN_DEV_DB_PATH;
  delete process.env.PRN_RUNTIME_STORE;
  rmSync(dir, { recursive: true, force: true });
});

describe("file store: loop surfaces", () => {
  it("is the file backend, and the guarded store exposes every loop method", () => {
    const store = runtime.runtimeStore();
    expect(store.kind).toBe("file");
    for (const m of [
      "revokeLink",
      "isLinkRevoked",
      "saveKeepClaim",
      "getKeepClaim",
      "saveMagicLink",
      "consumeMagicLink",
      "saveAskAnswer",
      "listAskAnswers",
      "saveFeedback",
      "enqueueEmail",
      "getEmail",
      "markEmailSent",
      "saveJobAddress",
      "getJobAddress",
      "saveSignup",
    ] as const) {
      expect(typeof store[m], m).toBe("function");
    }
  });

  it("revokeLink / isLinkRevoked: a ledger row, nothing else", async () => {
    const store = runtime.runtimeStore();
    expect(await store.isLinkRevoked("lk_never")).toBe(false);
    await store.revokeLink("lk_dead", "rq_s1", "2026-09-05T12:00:00Z");
    expect(await store.isLinkRevoked("lk_dead")).toBe(true);
    expect(await store.isLinkRevoked("lk_never")).toBe(false);
    expect(db().link_revocations).toEqual([
      { link_id: "lk_dead", request_id: "rq_s1", revoked_at: "2026-09-05T12:00:00Z" },
    ]);
  });

  it("saveKeepClaim / getKeepClaim: null until claimed, newest claim wins", async () => {
    const store = runtime.runtimeStore();
    expect(await store.getKeepClaim("rq_s2")).toBeNull();
    await store.saveKeepClaim({
      request_id: "rq_s2",
      contact: "first@example.com",
      contact_kind: "email",
      claimed_at: "2026-09-05T12:00:00Z",
      magic_link_id: "mg_1",
    });
    await store.saveKeepClaim({
      request_id: "rq_s2",
      contact: "+1 555 0100",
      contact_kind: "phone",
      claimed_at: "2026-09-05T12:05:00Z",
      magic_link_id: "mg_2",
    });
    expect(await store.getKeepClaim("rq_s2")).toMatchObject({ contact_kind: "phone", magic_link_id: "mg_2" });
    expect(await store.getKeepClaim("rq_other")).toBeNull();
    // Append-only: both claims are still on the record.
    expect(db().keep_claims.length).toBe(2);
  });

  it("saveMagicLink / consumeMagicLink: exactly one use; unknown and used look the same", async () => {
    const store = runtime.runtimeStore();
    await store.saveMagicLink({
      magic_id: "mg_once",
      request_id: "rq_s3",
      contact: "once@example.com",
      created_at: "2026-09-05T12:00:00Z",
      consumed_at: null,
    });
    const first = await store.consumeMagicLink("mg_once", "2026-09-05T12:01:00Z");
    expect(first).toMatchObject({ magic_id: "mg_once", request_id: "rq_s3", consumed_at: "2026-09-05T12:01:00Z" });
    expect(await store.consumeMagicLink("mg_once", "2026-09-05T12:02:00Z")).toBeNull();
    expect(await store.consumeMagicLink("mg_unknown", "2026-09-05T12:02:00Z")).toBeNull();
    // The first stamp stays; the second attempt did not move it.
    const row = (db().magic_links as { magic_id: string; consumed_at: string | null }[]).find((l) => l.magic_id === "mg_once")!;
    expect(row.consumed_at).toBe("2026-09-05T12:01:00Z");
  });

  it("saveAskAnswer / listAskAnswers: scoped to the request, in order", async () => {
    const store = runtime.runtimeStore();
    expect(await store.listAskAnswers("rq_s4")).toEqual([]);
    const base = {
      request_id: "rq_s4",
      friend_contact: null,
      provider_contact: null,
      reason: null,
    };
    await store.saveAskAnswer({ ...base, ask_id: "ask_1", friend_name: "Dana", provider_name: "Northside Heating", created_at: "2026-09-05T12:00:00Z" });
    await store.saveAskAnswer({ ...base, ask_id: "ask_2", friend_name: "Lee", provider_name: "Carter HVAC", provider_contact: "555 0101", reason: "fixed ours twice", created_at: "2026-09-05T12:03:00Z" });
    await store.saveAskAnswer({ ...base, request_id: "rq_s4_other", ask_id: "ask_3", friend_name: "X", provider_name: "Y", created_at: "2026-09-05T12:04:00Z" });
    const mine = await store.listAskAnswers("rq_s4");
    expect(mine.map((a) => a.ask_id)).toEqual(["ask_1", "ask_2"]);
    expect(mine[1].reason).toBe("fixed ours twice");
  });

  it("saveFeedback: the four fields land as a ledger row", async () => {
    const store = runtime.runtimeStore();
    await store.saveFeedback({
      feedback_id: "fb_1",
      request_id: "rq_s5",
      score: "very",
      right: ["It didn't make me repeat myself", "I feel ready to talk to someone about it"],
      slow: null,
      created_at: "2026-09-05T12:00:00Z",
    });
    expect(db().feedback).toEqual([
      expect.objectContaining({ feedback_id: "fb_1", score: "very", right: expect.arrayContaining(["It didn't make me repeat myself"]) }),
    ]);
  });

  it("enqueueEmail / getEmail / markEmailSent: preview by default, sent stamp recorded once known", async () => {
    const store = runtime.runtimeStore();
    expect(await store.getEmail("em_none")).toBeNull();
    await store.enqueueEmail({
      email_id: "em_1",
      request_id: "rq_s6",
      to: "home@example.com",
      subject: "Your packet",
      text: "plain",
      html: "<p>plain</p>",
      mode: "preview",
      created_at: "2026-09-05T12:00:00Z",
      sent_at: null,
      provider_id: null,
    });
    expect(await store.getEmail("em_1")).toMatchObject({ mode: "preview", sent_at: null, request_id: "rq_s6" });
    await store.markEmailSent("em_1", "2026-09-05T12:01:00Z", "resend_abc");
    expect(await store.getEmail("em_1")).toMatchObject({ sent_at: "2026-09-05T12:01:00Z", provider_id: "resend_abc" });
    // A message with no journey stores request_id as null, not undefined.
    await store.enqueueEmail({
      email_id: "em_2",
      to: "x@example.com",
      subject: "s",
      text: "t",
      html: "h",
      mode: "live",
      created_at: "2026-09-05T12:00:00Z",
      sent_at: null,
      provider_id: null,
    });
    expect((await store.getEmail("em_2"))?.request_id).toBeNull();
  });

  it("saveJobAddress / getJobAddress: null until given, newest wins, older rows kept", async () => {
    const store = runtime.runtimeStore();
    expect(await store.getJobAddress("rq_s7")).toBeNull();
    await store.saveJobAddress("rq_s7", { street: "12 Elm St", city_state_zip: "Carmel, IN 46032", property_type: null, storeys: null });
    await store.saveJobAddress("rq_s7", { street: "12 Elm Street", city_state_zip: "Carmel, IN 46032", property_type: "Single-family", storeys: "2" });
    expect(await store.getJobAddress("rq_s7")).toEqual({
      street: "12 Elm Street",
      city_state_zip: "Carmel, IN 46032",
      property_type: "Single-family",
      storeys: "2",
    });
    expect((db().job_addresses as { request_id: string }[]).filter((a) => a.request_id === "rq_s7").length).toBe(2);
  });

  it("saveSignup: a vote_id that arrives twice corrects, one without appends", async () => {
    const store = runtime.runtimeStore();
    await store.saveSignup({ signup_id: "su_1", page: "SmartQuote v3", vote: "yes", vote_id: "browser-9", created_at: "2026-09-05T12:00:00Z" });
    await store.saveSignup({ signup_id: "su_2", page: "SmartQuote v3", vote: "yes", vote_id: "browser-9", email: "s@example.com", created_at: "2026-09-05T12:01:00Z" });
    await store.saveSignup({ signup_id: "su_3", page: "Dashboard v3", vote: "no", reasons: ["Too much to set up"], created_at: "2026-09-05T12:02:00Z" });
    const rows = db().signups as { vote_id?: string; email?: string; signup_id: string }[];
    expect(rows.filter((r) => r.vote_id === "browser-9")).toEqual([expect.objectContaining({ signup_id: "su_2", email: "s@example.com" })]);
    expect(rows.find((r) => r.signup_id === "su_3")).toBeTruthy();
  });
});
