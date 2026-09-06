import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST, GET } from "@/app/demo/start/route";
import { GET as packetGet } from "@/app/packet/[request_id]/route";
import { demoSamplesEnabled, DEMO_SAMPLE_DESCRIPTION } from "@/domain/demo/sample";
import { runtimeStore, resetRuntimeStore } from "@/platform/stores/runtime";
import { readDevDb } from "@/platform/stores/dev-db";
import { verifyLink } from "@/platform/links/tokens";
import { engageKillSwitch, resetKillSwitchForTests } from "@/platform/killswitch";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
const network = vi.fn(() => { throw new Error("Demo samples must not call the network"); });
let clock = Date.parse("2026-09-06T00:00:00Z");
beforeEach(async () => {
  clock += 7_200_000;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(clock);
  vi.stubEnv("PRN_CLIENT_DEMO", "1");
  vi.stubEnv("PRN_RUNTIME_STORE", "file");
  vi.stubEnv("PRN_DEV_DB_PATH", join(await mkdtemp(join(tmpdir(), "prn-client-sample-")), "dev-db.json"));
  vi.stubEnv("EMAIL_MODE", "preview");
  vi.stubGlobal("fetch", network);
  network.mockClear();
  resetRuntimeStore();
  resetKillSwitchForTests();
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); resetKillSwitchForTests(); resetRuntimeStore(); });

function request(body = "intent=results", headers: Record<string, string> = {}) {
  return new Request("http://localhost/demo/start", { method: "POST", body,
    headers: { "content-type": "application/x-www-form-urlencoded", origin: "http://localhost", ...headers } });
}
async function count() { return (await runtimeStore().totals()).journeys; }

describe("synthetic client sample launcher", () => {
  it("persists an eligible synthetic packet, grants only that request's real owner capability, and never calls a model/email", async () => {
    const response = await POST(request());
    expect(response.status).toBe(303);
    const location = response.headers.get("location")!;
    expect(location).toMatch(/^\/results\/rq_/);
    const id = location.split("/").at(-1)!;
    const cookie = response.cookies.getAll()[0];
    expect(cookie.name).toMatch(/^prn_owner_/);
    expect(await verifyLink(cookie.value, "keep")).toMatchObject({ ok: true, request_id: id });
    const journey = (await runtimeStore().getJourney(id))!;
    expect(journey.session.attribution).toMatchObject({ landing_path: "/demo", variant: "synthetic_demo" });
    expect(journey.problem.safety_state).toBe("normal");
    expect(journey.packet.observed_statements).toContain(DEMO_SAMPLE_DESCRIPTION);
    expect(await runtimeStore().getJobAddress(id)).toMatchObject({ street: "123 Demo Lane (synthetic)" });
    expect(readDevDb().consent_events[0]).toMatchObject({ scope: "demo.synthetic_sample", surface: "synthetic_demo_fixture_not_homeowner_consent" });
    expect(readDevDb().email_outbox).toHaveLength(0);
    const withoutOwner = await packetGet(new Request(`http://localhost/packet/${id}`), { params: Promise.resolve({ request_id: id }) });
    expect(withoutOwner.status).toBe(404);
    const packet = await packetGet(new Request(`http://localhost/packet/${id}?k=${encodeURIComponent(cookie.value)}`), { params: Promise.resolve({ request_id: id }) });
    expect(packet.status).toBe(200);
    expect(packet.headers.get("x-packet-self-check")).not.toBe("held");
    const html = await packet.text();
    expect(html).toContain("123 Demo Lane (synthetic)");
    expect(html).toContain("Download PDF");
    expect(network).not.toHaveBeenCalled();
  });

  it("creates independent records and offers the actual guided completion route", async () => {
    const one = await POST(request("intent=guided"));
    const two = await POST(request());
    expect(one.headers.get("location")).toMatch(/^\/complete\/rq_/);
    expect(two.headers.get("location")).not.toContain(one.headers.get("location")!.split("/").at(-1)!);
    expect(await count()).toBe(2);
    const wrong = one.cookies.getAll()[0].value;
    const secondId = two.headers.get("location")!.split("/").at(-1)!;
    const denied = await packetGet(new Request(`http://localhost/packet/${secondId}?k=${wrong}`), { params: Promise.resolve({ request_id: secondId }) });
    expect(denied.status).toBe(404);
  });

  it.each(["disabled", "database", "missing_path"])("does not create a sample when configuration is %s", async mode => {
    if (mode === "disabled") { vi.stubEnv("PRN_CLIENT_DEMO", ""); vi.stubEnv("NEXT_DIST_DIR", ""); }
    if (mode === "database") vi.stubEnv("PRN_RUNTIME_STORE", "supabase");
    if (mode === "missing_path") vi.stubEnv("PRN_DEV_DB_PATH", "");
    expect(demoSamplesEnabled()).toBe(false);
    expect((await POST(request())).status).toBe(404);
    expect(network).not.toHaveBeenCalled();
  });

  it("recognizes the existing named local demo without enabling a production fallback", () => {
    vi.stubEnv("PRN_CLIENT_DEMO", ""); vi.stubEnv("NEXT_DIST_DIR", ".next-codex-demo");
    vi.stubEnv("NODE_ENV", "development"); expect(demoSamplesEnabled()).toBe(true);
    vi.stubEnv("NODE_ENV", "production"); expect(demoSamplesEnabled()).toBe(false);
  });

  it("GET, prefetch and cross-site requests never create a record", async () => {
    expect((await GET()).status).toBe(405);
    expect((await POST(request("", { purpose: "prefetch" }))).status).toBe(405);
    expect((await POST(request("", { origin: "https://elsewhere.example" }))).status).toBe(403);
    expect((await POST(request("", { "sec-fetch-site": "cross-site" }))).status).toBe(403);
    expect(await count()).toBe(0);
  });

  it.each(["description=arbitrary+customer+text", "intent=https://elsewhere.example", "intent=guided&intent=results"])("rejects unexpected input: %s", async body => {
    expect((await POST(request(body))).status).toBe(400);
    expect(await count()).toBe(0);
  });

  it("caps real streamed bytes even without a Content-Length header", async () => {
    expect((await POST(request("x".repeat(1025)))).status).toBe(413);
    expect((await POST(request("intent=results", { "content-length": "2048" }))).status).toBe(413);
    expect((await POST(request("{}", { "content-type": "application/json" }))).status).toBe(415);
    expect(await count()).toBe(0);
  });

  it("reserves a global allowance before concurrent creation and enforces its minute ceiling", async () => {
    const responses = await Promise.all(Array.from({ length: 6 }, () => POST(request())));
    expect(responses.filter(r => r.status === 303)).toHaveLength(3);
    expect(responses.filter(r => r.status === 429)).toHaveLength(3);
    expect(await count()).toBe(3);
  });

  it("retains the hourly ceiling after minute allowances reset", async () => {
    for (let minute = 0; minute < 4; minute++) {
      vi.setSystemTime(clock + minute * 60_001);
      for (let n = 0; n < 3; n++) expect((await POST(request())).status).toBe(303);
    }
    vi.setSystemTime(clock + 5 * 60_001);
    expect((await POST(request())).status).toBe(429);
    expect(await count()).toBe(12);
  });

  it("respects the normal agent kill switch and issues no owner cookie after refusal", async () => {
    await engageKillSwitch({ scope: "AGENT", scope_ref: "A02", reason: "Synthetic demo test", by: "test" });
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(await count()).toBe(0);
    expect(network).not.toHaveBeenCalled();
  });

  it("does not grant owner access or claim readiness when the final prerequisite fails to save", async () => {
    const failure = vi.spyOn(runtimeStore(), "saveJobAddress").mockRejectedValueOnce(new Error("Fixture disk failure"));
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("location")).toBeNull();
    expect(network).not.toHaveBeenCalled();
    failure.mockRestore();
  });
});
