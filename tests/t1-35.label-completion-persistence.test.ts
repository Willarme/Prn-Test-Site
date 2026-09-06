import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACTIVE_DISCLOSURE } from "@/domain/privacy/disclosures";
import { MemoryAiPolicyStore, setAiPolicyStoreForTests } from "@/platform/ai/policy-store";
import { MemorySpendLedger, setSpendLedgerForTests } from "@/platform/ai/spend";
import { loadJourneyContext } from "@/platform/intake/complete";
import { intakeReadiness } from "@/platform/intake/readiness";
import { attachMedia, __setLabelReaderForTests, readLabelConfidence, readLabelReadings, type LabelConfidenceRecord, type LabelReadResult } from "@/platform/intake/media";
import { startIntake } from "@/platform/intake/start";
import { localMediaFile } from "@/platform/adapters/media-storage";
import { signLink } from "@/platform/links/tokens";
import { resetRuntimeStore, runtimeStore } from "@/platform/stores/runtime";
import { POST as mediaPost } from "@/app/api/intake/media/route";

let dir: string;
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const unreadable: LabelReadResult = { ok: true, readable: false, fields: {}, confidence: {}, run_id: "synthetic-unreadable", extraction_status: "unreadable" };
const network = vi.fn(() => { throw new Error("External services forbidden"); });
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "prn-label-persistence-"));
  vi.stubEnv("PRN_RUNTIME_STORE", "file"); vi.stubEnv("PRN_DEV_DB_PATH", join(dir, "db.json"));
  vi.stubEnv("PRN_AI_LIVE_TESTS", "0"); vi.stubGlobal("fetch", network);
  resetRuntimeStore(); setAiPolicyStoreForTests(new MemoryAiPolicyStore()); setSpendLedgerForTests(new MemorySpendLedger());
  __setLabelReaderForTests(async () => unreadable);
});
afterEach(() => {
  expect(network).not.toHaveBeenCalled(); __setLabelReaderForTests(undefined); resetRuntimeStore();
  setAiPolicyStoreForTests(null); setSpendLedgerForTests(null); vi.unstubAllEnvs(); vi.unstubAllGlobals();
  rmSync(dir, { recursive: true, force: true });
});
async function start() {
  const result = await startIntake({ description: "My AC is not cooling", source: "door_form", disclosure_content_hash: ACTIVE_DISCLOSURE.content_hash,
    attribution: { landing_path: "/start", problem_family_hint: "hvac-cooling", page_id: null, intent_cluster_id: null,
      search_opportunity_id: null, experiment_id: null, variant: null, referrer: null } });
  expect(result.kind).toBe("started"); if (result.kind !== "started") throw new Error("Start failed"); return result.request_id;
}
function aggregate(id: string) { return join(dir, "label-reads", `${id}.json`); }
function blockAggregate(id: string) { mkdirSync(aggregate(id), { recursive: true }); }
function file() { return new File([new Uint8Array(png)], "synthetic-label.png", { type: "image/png" }); }
async function photo(id: string) {
  return attachMedia({ request_id: id, target: "unit_model_serial", source: "walkthrough", file: file() });
}
async function state(id: string) { const ctx = await loadJourneyContext(id); expect(ctx).not.toBeNull(); return intakeReadiness(ctx!); }
function reopened(id: string) {
  return JSON.parse(execFileSync(process.execPath, ["--import", "tsx", "-e", `
    globalThis.fetch = () => { throw new Error("External services forbidden"); };
    const { loadJourneyContext } = require("./src/platform/intake/complete.ts");
    const { intakeReadiness } = require("./src/platform/intake/readiness.ts");
    (async () => {
      const ctx = await loadJourneyContext(process.argv[1]);
      const current = await intakeReadiness(ctx);
      process.stdout.write(JSON.stringify({ fact: current.facts.fields.unit_model_serial,
        roles: current.screen.questions.map(q => q.source_key), readings: ctx.labelReadings, spent: current.ledger.effort_spent }));
    })().catch(error => { process.stderr.write(error.message); process.exitCode = 1; });
  `, id], { cwd: process.cwd(), env: process.env, encoding: "utf8", windowsHide: true, timeout: 15_000 }));
}

describe("T1-35 label completion persistence failures", () => {
  it("retains an actual unreadable completion after the aggregate write fails, including fresh-process readiness", async () => {
    const id = await start(); blockAggregate(id);
    const reader = vi.fn(async () => unreadable); __setLabelReaderForTests(reader);
    const result = await photo(id); expect(result.ok).toBe(true); if (!result.ok) throw new Error(result.error);
    expect(reader).toHaveBeenCalledTimes(1);
    expect(readLabelReadings(id)).toEqual([expect.objectContaining({ evidence_id: result.evidence_id, extraction_status: "unreadable", confidence: {} })]);
    expect(readLabelConfidence(id)).toBeNull();
    const current = await state(id);
    expect(current.facts.fields.unit_model_serial).toMatchObject({ value: null, status: "UNREADABLE", evidence_ids: [result.evidence_id], reason: expect.any(String) });
    expect(current.screen.questions.some(q => q.source_key === "unit_model_serial")).toBe(false);
    expect((await runtimeStore().listIntakeAnswers(id)).every(a => a.value_text === null)).toBe(true);
    const later = reopened(id);
    expect(later.fact).toEqual(current.facts.fields.unit_model_serial); expect(later.roles).not.toContain("unit_model_serial"); expect(later.spent).toBe(8);
    expect((await runtimeStore().getJourney(id))?.packet.intake_snapshot?.handoff.fact_state.fields.unit_model_serial.status).toBe("UNREADABLE");
  }, 20_000);

  it("retains a failed attempt as an explicit unknown, without relabeling it unreadable", async () => {
    const id = await start(); blockAggregate(id); __setLabelReaderForTests(async () => { throw new Error("synthetic reader failure"); });
    const result = await photo(id); expect(result.ok).toBe(true);
    expect(readLabelReadings(id)?.[0]).toMatchObject({ extraction_status: "failed", confidence: {}, reason: expect.any(String) });
    expect((await state(id)).facts.fields.unit_model_serial).toMatchObject({ value: null, status: "UNKNOWN_AFTER_REASONABLE_ATTEMPT" });
    expect(readLabelConfidence(id)).toBeNull();
  });

  it("retains weak readable confidence and actual completion time without promoting a guess", async () => {
    const id = await start(); blockAggregate(id); let completedAfter = 0;
    __setLabelReaderForTests(async () => {
      completedAfter = Date.now();
      return { ok: true, readable: true, fields: { model: "SYNTHETIC-MODEL" }, confidence: { model: "low" }, run_id: "synthetic-readable" };
    });
    const result = await photo(id); expect(result.ok).toBe(true); if (!result.ok) throw new Error(result.error);
    const record = readLabelConfidence(id)?.[0];
    expect(record).toMatchObject({ evidence_id: result.evidence_id, extraction_status: "readable", confidence: { model: "low" } });
    expect(Date.parse(record!.read_at)).toBeGreaterThanOrEqual(completedAfter);
    const current = await state(id);
    expect(current.facts.fields.unit_model_serial).toMatchObject({ value: "Model SYNTHETIC-MODEL", claim_class: "INFERRED", confidence: "low", confirmed: false });
    expect(reopened(id).fact).toEqual(current.facts.fields.unit_model_serial);
  }, 20_000);

  it("merges a recovered aggregate and its fallback deterministically without dropping other evidence", async () => {
    const id = await start(); blockAggregate(id);
    const first = await photo(id); expect(first.ok).toBe(true); if (!first.ok) throw new Error(first.error);
    const fallback = readLabelReadings(id); expect(fallback).toHaveLength(1);
    // Restore the aggregate location; the following accepted capture copies the recovered history into it.
    rmSync(aggregate(id), { recursive: true });
    const second = await photo(id); expect(second.ok).toBe(true); if (!second.ok) throw new Error(second.error);
    expect(JSON.parse(readFileSync(aggregate(id), "utf8"))).toHaveLength(2);
    const combined = readLabelReadings(id)!;
    expect(combined).toHaveLength(2); expect(new Set(combined.map(r => r.evidence_id))).toEqual(new Set([first.evidence_id, second.evidence_id]));
    expect(readLabelReadings(id)).toEqual(combined);
    expect(readdirSync(join(dir, "label-reads")).some(name => name.endsWith(".completion.json"))).toBe(true);
    // A stale aggregate copy cannot replace the later actual per-evidence result.
    const stale = (JSON.parse(readFileSync(aggregate(id), "utf8")) as LabelConfidenceRecord[]).map(record => record.evidence_id === first.evidence_id
      ? { ...record, read_at: new Date(Date.parse(record.read_at) - 1_000).toISOString(), reason: "stale aggregate copy" } : record);
    writeFileSync(aggregate(id), JSON.stringify(stale));
    expect(readLabelReadings(id)?.find(record => record.evidence_id === first.evidence_id)).toEqual(fallback![0]);
  });

  it("ignores reservation files and malformed or foreign completion data", async () => {
    const id = await start(); const other = await start(); blockAggregate(id);
    const result = await photo(id); expect(result.ok).toBe(true); if (!result.ok) throw new Error(result.error);
    const completionFile = `${aggregate(id)}.${result.evidence_id}.completion.json`;
    const record = JSON.parse(readFileSync(completionFile, "utf8"));
    writeFileSync(completionFile, JSON.stringify({ ...record, request_id: other }));
    expect(readLabelReadings(id)).toBeNull(); expect(readLabelReadings(other)).toBeNull();
    writeFileSync(completionFile, JSON.stringify({ ...record, evidence_id: "ev_foreign" }));
    expect(readLabelReadings(id)).toBeNull();
    writeFileSync(completionFile, JSON.stringify({ ...record, confidence: { model: "certain" } }));
    expect(readLabelReadings(id)).toBeNull();
    writeFileSync(completionFile, "{"); expect(readLabelReadings(id)).toBeNull();
    expect(readdirSync(join(dir, "label-reads")).some(name => name.endsWith(".attempt"))).toBe(true);
    expect((await state(id)).facts.fields.unit_model_serial.status).toBe("PHOTO_PENDING_EXTRACTION");
    expect(readLabelReadings("../outside")).toBeNull();
  });

  it.each([unreadable, { ok: true, readable: true, fields: { model: "SYNTHETIC-MODEL" }, confidence: { model: "low" }, run_id: "synthetic-readable" } as LabelReadResult])("both completion writes failing keeps the photo and charge without persisting orphaned label values %#", async (result) => {
    const id = await start(); blockAggregate(id); const before = (await runtimeStore().getJourney(id))!.packet;
    const reader = vi.fn(async () => {
      const ctx = (await loadJourneyContext(id))!;
      const evidence = ctx.allEvidence.findLast(e => e.kind === "photo")!;
      mkdirSync(`${aggregate(id)}.${evidence.evidence_id}.completion.json`);
      return result;
    });
    __setLabelReaderForTests(reader);
    const form = new FormData(); form.set("request_id", id); form.set("k", signLink({ scope: "keep", request_id: id }));
    form.set("target", "unit_model_serial"); form.set("file", file());
    const response = await mediaPost(new Request("http://localhost/api/intake/media", { method: "POST", body: form }));
    expect(response.status).toBe(503); expect(await response.json()).toMatchObject({ error: expect.stringMatching(/photo was saved.*label-reading result could not be saved/i) });
    expect(reader).toHaveBeenCalledTimes(1); expect(readLabelReadings(id)).toBeNull();
    const ctx = (await loadJourneyContext(id))!; const evidence = ctx.allEvidence.find(e => e.kind === "photo")!;
    expect(evidence.privacy).toBe("private"); expect(localMediaFile(evidence.content)).toEqual(png);
    expect((await state(id)).ledger.effort_spent).toBe(8);
    expect((await runtimeStore().getJourney(id))!.packet).toEqual(before);
    expect(reopened(id).readings).toEqual([]);
    expect((await runtimeStore().listIntakeAnswers(id)).some(answer => answer.source === "photo" && answer.value_text !== null)).toBe(false);
  }, 20_000);
});
