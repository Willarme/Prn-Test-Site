import { fork } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FileRequestCallLedger, requestCallPolicy } from "@/platform/ai/request-calls";

const identity = { request_id: "rq_synthetic_caps", tenant_id: "tenant_test" };
let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "request-ai-budget-test-")); vi.stubEnv("PRN_RUNTIME_STORE", "file"); });
afterEach(() => { vi.unstubAllEnvs(); rmSync(root, { recursive: true, force: true }); });

async function race(workers: number): Promise<number> {
  const peers = Array.from({ length: workers }, () => fork(
    join(process.cwd(), "tests/helpers/request-call-race-worker.ts"), [root, identity.request_id, identity.tenant_id],
    { execArgv: ["--import", "tsx"], silent: true,
      env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP, NODE_ENV: "test", PRN_RUNTIME_STORE: "file" } },
  ));
  const ready = peers.map(peer => new Promise<void>((resolve, reject) => {
    peer.once("error", reject);
    peer.on("message", message => { if ((message as { ready?: boolean }).ready) resolve(); });
  }));
  const done = peers.map(peer => new Promise<number>((resolve, reject) => {
    let admitted = 0;
    const timeout = setTimeout(() => { peer.kill(); reject(new Error("request-call worker timed out")); }, 20_000);
    peer.on("message", message => {
      const result = message as { admitted?: number; error?: string };
      if (result.admitted !== undefined) admitted = result.admitted;
      if (result.error) { clearTimeout(timeout); reject(new Error(result.error)); }
    });
    peer.once("error", error => { clearTimeout(timeout); reject(error); });
    peer.once("exit", code => { clearTimeout(timeout); if (code === 0) resolve(admitted); else reject(new Error(`worker exit ${code}`)); });
  }));
  try {
    await Promise.all(ready);
    peers.forEach(peer => peer.send("go"));
    return (await Promise.all(done)).reduce((sum, count) => sum + count, 0);
  } finally { peers.forEach(peer => peer.kill()); }
}

describe("T1-14 durable request-wide model admission", () => {
  it("reads the operative two-call limit with its A00 version", () => {
    expect(requestCallPolicy()).toEqual({ key: "intake.max_ai_calls_per_request", max_calls: 2, version: 1 });
  });

  it("admits exactly the configured count from 80 simultaneous attempts in four real processes, then survives restart", async () => {
    expect(await race(4)).toBe(requestCallPolicy().max_calls);
    expect(await race(1)).toBe(0);
    const files = readdirSync(root).filter(name => name.endsWith(".json"));
    expect(files).toHaveLength(1);
    const contents = readFileSync(join(root, files[0]), "utf8");
    expect(contents).not.toContain(identity.request_id);
    expect(contents).not.toContain(identity.tenant_id);
    expect(JSON.parse(contents).reservations).toHaveLength(2);
    expect(JSON.parse(contents).reservations[1]).toMatchObject({ policy_version: 1, max_calls: 2, used: 2 });
  }, 30_000);

  it("shares one ceiling across capabilities while isolating request and tenant", async () => {
    const ledger = new FileRequestCallLedger(root);
    const policy = requestCallPolicy();
    expect(await ledger.reserve(identity, policy, "classify_home_problem")).not.toBeNull();
    expect(await ledger.reserve(identity, policy, "read_equipment_label")).not.toBeNull();
    expect(await ledger.reserve(identity, policy, "select_next_clarifier")).toBeNull();
    expect(await ledger.reserve({ ...identity, tenant_id: "tenant_other" }, policy, "classify_home_problem")).not.toBeNull();
    expect(await ledger.reserve({ ...identity, request_id: "rq_other" }, policy, "classify_home_problem")).not.toBeNull();
  });

  it.each(["missing", "corrupt", "truncated", "false-counter", "empty-history"])("fails closed for %s initialized history and preserves evidence", async fault => {
    const ledger = new FileRequestCallLedger(root);
    await ledger.reserve(identity, requestCallPolicy(), "classify_home_problem");
    if (fault === "empty-history") await ledger.reserve(identity, requestCallPolicy(), "read_equipment_label");
    const target = join(root, readdirSync(root).find(name => name.endsWith(".json"))!);
    if (fault === "missing") unlinkSync(target);
    else if (fault === "false-counter" || fault === "empty-history") {
      const state = JSON.parse(readFileSync(target, "utf8"));
      if (fault === "empty-history") state.reservations = [];
      else state.reservations[0].used = 0;
      writeFileSync(target, JSON.stringify(state));
    } else writeFileSync(target, fault === "corrupt" ? "broken" : "");
    const before = fault === "missing" ? null : readFileSync(target, "utf8");
    await expect(new FileRequestCallLedger(root).reserve(identity, requestCallPolicy(), "read_equipment_label")).rejects.toThrow();
    if (before !== null) expect(readFileSync(target, "utf8")).toBe(before);
  });

  it("does not make a lower policy version or lower limit into a reset", async () => {
    const ledger = new FileRequestCallLedger(root);
    await ledger.reserve(identity, requestCallPolicy(), "classify_home_problem");
    expect(await ledger.reserve(identity, { ...requestCallPolicy(), version: 2, max_calls: 1 }, "read_equipment_label")).toBeNull();
  });

  it("refuses serverless operation without writing an ephemeral counter", async () => {
    vi.stubEnv("VERCEL", "1");
    await expect(new FileRequestCallLedger(root).reserve(identity, requestCallPolicy(), "classify_home_problem")).rejects.toThrow(/shared/);
    expect(readdirSync(root)).toEqual([]);
  });
});
