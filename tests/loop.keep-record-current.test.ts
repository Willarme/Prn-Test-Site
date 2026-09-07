import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ACTIVE_DISCLOSURE } from "@/domain/privacy/disclosures";
import { normalizePrintedEvidence, PRINTED_READER_VERSION } from "@/domain/problem/printed-evidence";
import { MemoryAiPolicyStore, setAiPolicyStoreForTests } from "@/platform/ai/policy-store";
import { MemorySpendLedger, setSpendLedgerForTests } from "@/platform/ai/spend";
import { loadJourneyContext } from "@/platform/intake/complete";
import { intakeReadiness } from "@/platform/intake/readiness";
import { signLink } from "@/platform/links/tokens";
import { loadRecordView } from "@/platform/links/views";
import { resetRuntimeStore, runtimeStore } from "@/platform/stores/runtime";
import { POST as startPost } from "@/app/api/intake/route";
import { POST as answerPost } from "@/app/api/intake/answer/route";
import { POST as mediaPost } from "@/app/api/intake/media/route";
import KeepPage from "@/app/keep/[token]/page";

// Only OCR process output is substituted. Upload identity, normalization,
// persistence, actual confirmation/correction routes and Keep rendering are real.
vi.mock("@/platform/problem/printed-evidence", () => ({
  readPrintedEvidence: async (input: { evidence_id: string; image: Uint8Array }) => normalizePrintedEvidence({
    reader_version: PRINTED_READER_VERSION, width: 800, height: 500,
    lines: ["SYSTEM: COOL", "FAN: AUTO", "SETPOINT: 72 F", "ROOM: 81 F"].map((text, i) => ({
      text, confidence: 99, bbox: { x0: 10, y0: i * 100 + 10, x1: 600, y1: i * 100 + 80 },
    })),
  }, input.evidence_id, createHash("sha256").update(input.image).digest("hex")),
}));

let dir: string; let clock: number;
const network = vi.fn(() => { throw new Error("No network in Keep record tests"); });
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "keep-record-current-"));
  vi.stubEnv("PRN_DEV_DB_PATH", join(dir, "db.json")); vi.stubEnv("PRN_RUNTIME_STORE", "file");
  vi.stubEnv("LINK_SIGNING_SECRET", "synthetic-keep-record-test-key");
  vi.stubEnv("VITEST", "1"); vi.stubEnv("PRN_AI_LIVE_TESTS", "0"); vi.stubGlobal("fetch", network);
  vi.useFakeTimers({ toFake: ["Date"] }); clock = Date.parse("2026-09-07T03:00:00Z"); vi.setSystemTime(clock);
  resetRuntimeStore(); setAiPolicyStoreForTests(new MemoryAiPolicyStore()); setSpendLedgerForTests(new MemorySpendLedger());
});
afterEach(() => {
  expect(network).not.toHaveBeenCalled(); resetRuntimeStore(); setAiPolicyStoreForTests(null); setSpendLedgerForTests(null);
  vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); rmSync(dir, { recursive: true, force: true });
});
function tick() { clock += 1000; vi.setSystemTime(clock); }
async function accepted(response: Response) { const body = await response.json(); expect(response.status, JSON.stringify(body)).toBe(200); return body; }
function request(path: string, body: object) { tick(); return new Request(`http://localhost${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); }
async function start() {
  const body = await accepted(await startPost(request("/api/intake", { description: "My Carrier AC is not cooling since yesterday.", disclosure_content_hash: ACTIVE_DISCLOSURE.content_hash,
    attribution: { landing_path: "/start", problem_family_hint: "hvac-cooling", page_id: null, intent_cluster_id: null, search_opportunity_id: null, experiment_id: null, variant: null, referrer: null } })));
  return body.request_id as string;
}
async function answer(id: string, value: string, confirmed = false) {
  await accepted(await answerPost(request("/api/intake/answer", { request_id: id, k: signLink({ scope: "keep", request_id: id }), fields: [{ field_key: "thermostat_photo", value, confirmed }] })));
}
async function photo(id: string) {
  tick(); const form = new FormData(); form.set("request_id", id); form.set("k", signLink({ scope: "keep", request_id: id })); form.set("target", "thermostat_photo");
  form.set("file", new File([new Uint8Array([137,80,78,71,13,10,26,10])], "synthetic-display.png", { type: "image/png" }));
  return (await accepted(await mediaPost(new Request("http://localhost/api/intake/media", { method: "POST", body: form })))).evidence_id as string;
}
async function confirm(id: string) {
  const state = await intakeReadiness((await loadJourneyContext(id))!);
  await answer(id, state.facts.fields.thermostat_photo.value!, true);
}
const labels = ["Thermostat mode", "Fan setting", "Set temperature", "Room temperature"];
async function rendered(id: string) {
  const token = signLink({ scope: "keep", request_id: id });
  return renderToStaticMarkup(await KeepPage({ params: Promise.resolve({ token }), searchParams: Promise.resolve({}) }));
}

it("actual photo and Yes confirmation render four human topics once without changing stored evidence or answers", async () => {
  const id = await start(); const photoId = await photo(id);
  const before = (await loadRecordView(id))!.facts.filter(f => labels.includes(f.label));
  expect(before).toHaveLength(4); expect(before.every(f => f.source.includes("not confirmed"))).toBe(true);
  await confirm(id); resetRuntimeStore();
  const answers = await runtimeStore().listIntakeAnswers(id);
  const journey = (await runtimeStore().getJourney(id))!;
  const evidence = await runtimeStore().listEvidence(journey.problem.problem_id, id);
  const html = await rendered(id);
  const view = (await loadRecordView(id))!;
  expect(view.facts.filter(f => labels.includes(f.label))).toEqual([
    { label: labels[0], value: "cool", source: "you confirmed it" },
    { label: labels[1], value: "auto", source: "you confirmed it" },
    { label: labels[2], value: "72 F", source: "you confirmed it" },
    { label: labels[3], value: "81 F", source: "you confirmed it" },
  ]);
  const displayedLabels = [...html.matchAll(/<dt\b[^>]*>([^<]*)<\/dt>/g)].map(match => match[1]);
  for (const label of labels) expect(displayedLabels.filter(value => value === label)).toHaveLength(1);
  expect(displayedLabels).not.toContain("Thermostat"); expect(displayedLabels).not.toContain("Additional detail");
  expect(html).not.toMatch(/thermostat_mode|fan_mode|thermostat_setpoint|room_temp/);
  expect(html).toContain('action="/api/keep"'); expect(view.media.some(e => e.evidence_id === photoId)).toBe(true);
  expect(await runtimeStore().listIntakeAnswers(id)).toEqual(answers);
  expect(await runtimeStore().listEvidence(journey.problem.problem_id, id)).toEqual(evidence);
});

it("manual correction wins over old split readings and a later photo, and uncertainty cannot resurrect AUTO", async () => {
  const id = await start(); await photo(id); await confirm(id);
  await answer(id, "Mode COOL; fan ON");
  expect((await loadRecordView(id))!.facts.filter(f => f.label === "Fan setting")).toEqual([{ label: "Fan setting", value: "on", source: "you reported it" }]);
  await photo(id);
  expect((await loadRecordView(id))!.facts.filter(f => f.label === "Fan setting")).toEqual([{ label: "Fan setting", value: "on", source: "you reported it" }]);
  await answer(id, "Mode COOL; fan not ON");
  const uncertain = (await loadRecordView(id))!.facts;
  expect(uncertain.some(f => f.label === "Fan setting")).toBe(false);
  expect(uncertain).toContainEqual({ label: "Thermostat notes", value: "Mode COOL; fan not ON", source: "you typed it" });
});

it("typed Celsius display stays Celsius in the actual Keep view", async () => {
  const id = await start(); await answer(id, "Mode COOL; fan AUTO; setpoint 22 C; room temperature 27 C");
  const view = (await loadRecordView(id))!;
  expect(view.facts).toContainEqual({ label: "Set temperature", value: "22 C", source: "you reported it" });
  expect(view.facts).toContainEqual({ label: "Room temperature", value: "27 C", source: "you reported it" });
  expect(view.facts.some(f => f.label === "Thermostat")).toBe(false);
});

it("a stored auto-detected reading without photo provenance never claims it came from a photo", async () => {
  const id = await start(); tick();
  // Historical stored-answer fixture, not an assertion that a split field is
  // accepted by the homeowner POST allowlist. Exercise the real read consumer.
  await runtimeStore().saveIntakeAnswers([{ request_id: id, field_key: "fan_mode", value_text: "auto",
    source: "auto_detected", evidence_id: null, answered_at: new Date(clock).toISOString() }]);
  const view = (await loadRecordView(id))!;
  expect(view.media).toHaveLength(0);
  expect(view.facts.filter(f => f.label === "Fan setting")).toEqual([{ label: "Fan setting", value: "auto", source: "not confirmed" }]);
  expect(await rendered(id)).not.toContain("from your photo");
});

it("keeps literal display notes visible alongside the readings they contain", async () => {
  const id = await start();
  const note = "The screen is cracked; thermostat is set to cool at 72 F, room 81 F";
  await answer(id, note);
  const view = (await loadRecordView(id))!;
  expect(view.facts).toContainEqual({ label: "Thermostat notes", value: note, source: "you typed it" });
  expect(view.facts.some(f => f.label === "Set temperature" && f.value === "72 F")).toBe(true);
  const html = await rendered(id);
  expect(html).toContain("The screen is cracked");
  expect([...html.matchAll(/<dt\b[^>]*>Set temperature<\/dt>/g)]).toHaveLength(1);
});

it.each([
  "Mode COOL; fan AUTO; fan ON",
  "Mode COOL; setpoint 22 C; setpoint 27 C",
])("keeps conflicting literal readings visible: %s", async note => {
  const id = await start();
  await answer(id, note);
  const view = (await loadRecordView(id))!;
  expect(view.facts).toContainEqual({ label: "Thermostat notes", value: note, source: "you typed it" });
  expect(view.facts.some(f => f.label === "Thermostat mode")).toBe(true);
  expect(await rendered(id)).toContain(note);
});
