import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readRunHistory, projectRun } from "@/platform/admin/run-history";
import { AgentRunRecord, resetAgentRunLedgerForTests } from "@/platform/runs/ledger";

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "prn-admin-runs-")); resetAgentRunLedgerForTests(); });
afterEach(() => { vi.unstubAllEnvs(); rmSync(root, { recursive: true, force: true }); });
function record(id: string, created_at = "2026-09-06T12:00:00Z") {
  return AgentRunRecord.parse({ run_id: id, agent_id: "A01", trigger: "request", input_ids: ["private-input"], capabilities_used: ["fixture"],
    outputs_summary: { private: "must never leave projection" }, errors: ["private error"], decisions: ["private decision"], human_correction: "private correction",
    tool_provider: "fixture", tool_model_version: "fixture/model", cost_usd: 0, latency_ms: 2, created_at });
}
function put(name: string, value: unknown): void { writeFileSync(join(root, name), JSON.stringify(value)); }
function client(data: unknown, error: unknown = null) {
  const query = { select: vi.fn((_fields: string) => query), order: vi.fn(() => query), limit: vi.fn(async () => ({ data, error })) };
  return { provider: () => ({ from: () => query }) as unknown as SupabaseClient, query };
}

describe("bounded durable agent observations", () => {
  it("projects only explicit safe fields, retaining unknown and zero separately", () => {
    const source = record("ar_project");
    expect(projectRun(source)).toMatchObject({ cost_usd: 0, error_count: 1, capability_count: 1 });
    const projected = JSON.stringify(projectRun(source));
    expect(projected).not.toContain("private"); expect(projected).not.toContain("outputs_summary");
    expect(projectRun({ ...source, cost_usd: undefined, latency_ms: undefined })).toMatchObject({ cost_usd: null, latency_ms: null });
    expect(projectRun({ ...source, cost_usd: -1, latency_ms: -1 })).toMatchObject({ cost_usd: null, latency_ms: null });
    expect(projectRun({ ...source, cost_usd: Infinity, latency_ms: NaN })).toMatchObject({ cost_usd: null, latency_ms: null });
  });
  it("distinguishes verified empty, missing, unreadable and database outage", async () => {
    expect(await readRunHistory(80, () => null, root)).toMatchObject({ rows: [], state: "available", source: "local receipts" });
    expect(await readRunHistory(80, () => null, join(root, "missing"))).toMatchObject({ rows: [], state: "partial" });
    const notDirectory = join(root, "not-directory"); writeFileSync(notDirectory, "x");
    expect(await readRunHistory(80, () => null, notDirectory)).toMatchObject({ rows: [], state: "unavailable" });
    expect(await readRunHistory(80, client([], null).provider)).toMatchObject({ rows: [], state: "available", source: "database" });
    expect(await readRunHistory(80, client(null, { message: "private" }).provider)).toMatchObject({ rows: [], state: "unavailable" });
  });
  it("sorts actual instants across timezone offsets and labels truncation", async () => {
    put("ar_early.json", record("ar_early", "2026-09-06T12:00:00+05:00"));
    put("ar_latest.json", record("ar_latest", "2026-09-06T09:00:00Z"));
    put("ar_middle.json", record("ar_middle", "2026-09-06T08:00:00Z"));
    const result = await readRunHistory(2, () => null, root);
    expect(result.rows.map(row => row.run_id)).toEqual(["ar_latest", "ar_middle"]);
    expect(result).toMatchObject({ state: "partial", scanned: 3, skipped: 0, limit: 2 });
  });
  it("skips malformed, mismatched, oversized, invalid-date and invalid-UTF8 receipts", async () => {
    put("ar_valid.json", record("ar_valid"));
    writeFileSync(join(root, "ar_broken.json"), "{broken");
    put("ar_wrong.json", record("ar_different"));
    put("ar_bad_date.json", record("ar_bad_date", "2026-99-06T12:00:00Z"));
    writeFileSync(join(root, "ar_large.json"), "x".repeat(256001));
    writeFileSync(join(root, "ar_bytes.json"), Buffer.from([0xff]));
    const result = await readRunHistory(80, () => null, root);
    expect(result.rows.map(row => row.run_id)).toEqual(["ar_valid"]);
    expect(result).toMatchObject({ state: "partial", scanned: 6, skipped: 5 });
  });
  it("does not follow a receipt directory junction into another directory", async () => {
    const target = join(root, "target"); mkdirSync(target);
    writeFileSync(join(target, "ar_private.json"), JSON.stringify(record("ar_private")));
    const link = join(root, "linked"); symlinkSync(target, link, process.platform === "win32" ? "junction" : "dir");
    expect(await readRunHistory(80, () => null, link)).toMatchObject({ state: "unavailable", rows: [] });
  });
  it("stops a directory scan at 2000 entries and does not call it complete", async () => {
    for (let i = 0; i < 2001; i++) writeFileSync(join(root, `unrelated_${i}.txt`), "");
    const result = await readRunHistory(80, () => null, root);
    expect(result).toMatchObject({ state: "partial", rows: [], skipped: 2000, scanned: 0 });
  });
  it("requests one extra database row to detect a partial window, without private output columns", async () => {
    const rows = [record("ar_one"), record("ar_two")].map(({ trigger, ...row }) => ({ ...row, trigger_kind: trigger }));
    const db = client(rows);
    const result = await readRunHistory(1, db.provider);
    expect(db.query.limit).toHaveBeenCalledWith(2);
    expect(db.query.select.mock.calls[0]?.[0]).not.toContain("outputs_summary");
    expect(result).toMatchObject({ state: "partial", scanned: 2 }); expect(result.rows).toHaveLength(1);
  });
  it("skips a malformed database row without exposing its contents or losing valid rows", async () => {
    const good = { ...record("ar_good"), trigger_kind: "request" };
    const result = await readRunHistory(80, client([null, { arbitrary: "private" }, good]).provider);
    expect(result).toMatchObject({ state: "partial", scanned: 3, skipped: 2 });
    expect(result.rows.map(row => row.run_id)).toEqual(["ar_good"]); expect(JSON.stringify(result)).not.toContain("private");
  });
});
