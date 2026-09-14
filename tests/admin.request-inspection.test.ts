import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import RequestsPage from "@/app/admin/requests/page";
import RequestInspection from "@/app/admin/requests/[request_id]/page";
import { selectRequestRows, type AdminRequestRow } from "@/domain/admin/request-view";
import { createDemoSample } from "@/domain/demo/sample";
import { resetKillSwitchForTests } from "@/platform/killswitch";
import { readAdminRequestDetail, readAdminRequestRows } from "@/platform/admin/request-inspection";
import { runtimeStore, resetRuntimeStore } from "@/platform/stores/runtime";

const state = vi.hoisted(() => ({ unlocked: true }));
vi.mock("@/components/admin/AdminGate", () => ({ adminGate: async () => state.unlocked ? null : createElement("p", null, "Locked synthetic gate") }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NEXT_NOT_FOUND"); }, useRouter: () => ({ refresh() {} }) }));

let dbPath: string;
beforeEach(async () => {
  dbPath = join(await mkdtemp(join(tmpdir(), "prn-admin-inspection-")), "dev-db.json");
  vi.stubEnv("PRN_RUNTIME_STORE", "file");
  vi.stubEnv("PRN_DEV_DB_PATH", dbPath);
  vi.stubEnv("PRN_CLIENT_DEMO", "1");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Network is forbidden in admin inspection tests"); }));
  state.unlocked = true;
  resetRuntimeStore(); resetKillSwitchForTests();
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); resetRuntimeStore(); resetKillSwitchForTests(); });

describe("private admin request inspection", () => {
  it("gates the list and the detail before any customer store read", async () => {
    const store = runtimeStore();
    const list = vi.spyOn(store, "listJourneys");
    const get = vi.spyOn(store, "getJourney");
    state.unlocked = false;
    expect(renderToStaticMarkup(await RequestsPage())).toContain("Locked synthetic gate");
    expect(renderToStaticMarkup(await RequestInspection({ params: Promise.resolve({ request_id: "rq_secret" }) }))).toContain("Locked synthetic gate");
    expect(list).not.toHaveBeenCalled(); expect(get).not.toHaveBeenCalled();
  });

  it("renders actual supplied detail and provenance without producing customer tokens, media URLs or writes", async () => {
    const { requestId } = await createDemoSample();
    const store = runtimeStore();
    const journey = (await store.getJourney(requestId))!;
    await store.attachEvidence(journey.problem.problem_id, requestId, {
      evidence_id: "ev_voice_synthetic", kind: "voice_note", content: "PRIVATE_STORAGE_SENTINEL.wav",
      privacy: "private", captured_at: "2026-09-06T01:00:00Z", mime: "audio/wav", bytes: 900,
    });
    await store.saveIntakeAnswers([{ request_id: requestId, field_key: "model_serial", value_text: "__cannot_reach__", source: "typed", evidence_id: null, answered_at: "2026-09-06T01:01:00Z" }]);
    await store.saveDiagnosisAnswer({ request_id: requestId, step_id: "outdoor_unit_photos", answer: "cannot_reach", evidence_id: null, answered_at: "2026-09-06T01:02:00Z" });
    const before = await readFile(dbPath, "utf8");
    const detail = (await readAdminRequestDetail(store, requestId))!;
    expect(JSON.stringify(detail.evidence)).not.toContain("PRIVATE_STORAGE_SENTINEL");
    expect(detail.answers.some(answer => answer.value_text === "Not checked — could not reach")).toBe(true);
    const html = renderToStaticMarkup(await RequestInspection({ params: Promise.resolve({ request_id: requestId }) }));
    expect(html).toContain("Carrier"); expect(html).toContain("Synthetic demo");
    expect(html).toContain("Not checked — could not reach");
    expect(html).toContain("Recording stored; no transcript is implied.");
    expect(html).toContain("Fact claims");
    expect(html).not.toContain("PRIVATE_STORAGE_SENTINEL");
    expect(html).not.toMatch(/href="\/(?:results|packet|keep|ask|p)\//);
    expect(html).not.toMatch(/prn_owner_|[?&]k=/);
    expect(await readFile(dbPath, "utf8")).toBe(before);
    const listHtml = renderToStaticMarkup(await RequestsPage());
    expect(listHtml).toContain(`/admin/requests/${requestId}`);
    expect(listHtml).not.toContain(`/results/${requestId}`);
    expect(listHtml).not.toContain(journey.problem.problem_summary!);
  });

  it("replays a later safety report in both list and detail and suppresses stale packet guidance", async () => {
    const { requestId } = await createDemoSample();
    const store = runtimeStore();
    const journey = (await store.getJourney(requestId))!;
    await store.savePacket({ ...journey.packet, packet_version: journey.packet.packet_version + 1,
      job_packet_id: "jp_synthetic_stale", summary_plain: "STALE_GUIDANCE_SENTINEL", safe_prep_notes: ["STALE_GUIDANCE_SENTINEL"] }, requestId);
    await store.attachEvidence(journey.problem.problem_id, requestId, { evidence_id: "ev_later_hazard", kind: "customer_text", content: "I smell gas near the unit now.", privacy: "private", captured_at: "2026-09-06T01:00:00Z" });
    expect((await store.listJourneys(100))[0].problem.safety_state).toBe("normal");
    expect((await readAdminRequestRows(store))[0].safety).toBe("urgent");
    const html = renderToStaticMarkup(await RequestInspection({ params: Promise.resolve({ request_id: requestId }) }));
    expect(html).toContain("Safety stop"); expect(html).not.toContain("STALE_GUIDANCE_SENTINEL");
  });

  it("keeps a missing evidence read unknown and withholds the detail instead of rendering stale advice", async () => {
    const { requestId } = await createDemoSample();
    const store = runtimeStore();
    vi.spyOn(store, "listEvidence").mockRejectedValue(new Error("private storage unavailable"));
    expect((await readAdminRequestRows(store))[0].safety).toBe("unverified");
    const html = renderToStaticMarkup(await RequestInspection({ params: Promise.resolve({ request_id: requestId }) }));
    expect(html).toContain("Record or safety evidence unavailable"); expect(html).not.toContain("Carrier");
    expect(html).not.toContain("private storage unavailable");
  });

  it("distinguishes failed supplementary reads from no recorded answers", async () => {
    const { requestId } = await createDemoSample();
    const store = runtimeStore();
    vi.spyOn(store, "listClaims").mockRejectedValue(new Error("Synthetic claim read failure"));
    expect((await readAdminRequestDetail(store, requestId))!.unavailable).toContain("Fact claims");
    const html = renderToStaticMarkup(await RequestInspection({ params: Promise.resolve({ request_id: requestId }) }));
    expect(html).toContain("Some readings are unavailable: Fact claims");
    expect(html).toContain("Carrier");
  });
});

describe("bounded request exploration", () => {
  const rows: AdminRequestRow[] = Array.from({ length: 45 }, (_, index) => ({
    requestId: `rq_${index}`, enteredAt: "2026-09-06T00:00:00Z", source: index % 2 ? "/start" : "/ac-door",
    category: index % 2 ? "plumbing" : "hvac", confidence: "medium", status: index % 2 ? "clarifying" : "packet_ready",
    safety: "normal", packetVersion: 1, consentReferences: 1, synthetic: true,
  }));
  it("searches only loaded rows and combines category/status filters before paging", () => {
    const filtered = selectRequestRows(rows, { query: "AC-DOOR", category: "hvac", status: "packet_ready", page: 2 });
    expect(filtered.total).toBe(23); expect(filtered.rows).toHaveLength(3);
    expect(filtered.rows.every(row => row.category === "hvac")).toBe(true);
    expect(selectRequestRows(rows, { query: "rq_44", category: "", status: "", page: 99 }).rows[0].requestId).toBe("rq_44");
  });
  it("clamps invalid and out-of-range pages without duplicate or missing rows", () => {
    const first = selectRequestRows(rows, { query: "", status: "", category: "", page: NaN });
    const last = selectRequestRows(rows, { query: "", status: "", category: "", page: 999 });
    expect(first.page).toBe(1); expect(first.rows).toHaveLength(20);
    expect(last.page).toBe(3); expect(last.rows).toHaveLength(5);
    expect(new Set([...first.rows, ...last.rows].map(row => row.requestId)).size).toBe(25);
  });
});
