import { fork, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readDevDb, updateDevDb } from "@/platform/stores/dev-db";
import { unguardedRuntimeStore } from "@/platform/stores/runtime";
import { withFileLock } from "@/platform/stores/atomic-file";
import { readLinkLedger } from "@/platform/links/ledger";

let dir: string;
const worker = join(process.cwd(), "tests/helpers/store-race-worker.ts");
const originalPath = process.env.PRN_DEV_DB_PATH;
const originalStore = process.env.PRN_RUNTIME_STORE;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "prn-durable-"));
  process.env.PRN_DEV_DB_PATH = join(dir, "db.json"); process.env.PRN_RUNTIME_STORE = "file";
  updateDevDb(() => {});
});
afterEach(() => {
  if (originalPath === undefined) delete process.env.PRN_DEV_DB_PATH; else process.env.PRN_DEV_DB_PATH = originalPath;
  if (originalStore === undefined) delete process.env.PRN_RUNTIME_STORE; else process.env.PRN_RUNTIME_STORE = originalStore;
  rmSync(dir, { recursive: true, force: true });
});

async function children(mode: string, count: number, arg?: string): Promise<unknown[]> {
  const peers: ChildProcess[] = [];
  const ready: Promise<void>[] = [];
  const results: Promise<unknown>[] = [];
  for (let i = 0; i < count; i++) {
    // Explicit environment allowlist: child processes cannot see credentials.
    const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP,
      NODE_ENV: "test", PRN_DEV_DB_PATH: process.env.PRN_DEV_DB_PATH, PRN_RUNTIME_STORE: "file" };
    const child = fork(worker, [mode, ...(arg ? [arg] : [])], { execArgv: ["--import", "tsx"], env, silent: true });
    peers.push(child);
    ready.push(new Promise((resolve, reject) => {
      child.on("message", msg => { if ((msg as { ready?: boolean }).ready) resolve(); });
      child.once("error", reject);
    }));
    results.push(new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { child.kill(); reject(new Error("Isolated worker timed out")); }, 20_000);
      child.on("message", msg => {
        const data = msg as { error?: string; result?: unknown };
        if (data.error) { clearTimeout(timeout); reject(new Error(data.error)); }
        else if (Object.hasOwn(data, "result")) { clearTimeout(timeout); resolve(data.result); }
      });
      child.once("exit", code => { if (code === 23 && mode === "die-locked") { clearTimeout(timeout); resolve(true); } else if (code && code !== 0) { clearTimeout(timeout); reject(new Error(`Worker exit ${code}`)); } });
    }));
  }
  try { await Promise.all(ready); peers.forEach(child => child.send("go")); return await Promise.all(results); }
  finally { peers.forEach(child => child.kill()); }
}

describe("durable local store", () => {
  it("six real subprocesses consume a single magic link exactly once", async () => {
    await unguardedRuntimeStore().saveMagicLink({ magic_id: "mg_race", request_id: "rq_race", contact: "fixture@example.invalid", created_at: new Date().toISOString(), consumed_at: null });
    expect((await children("consume", 6)).filter(Boolean)).toHaveLength(1);
    expect(readDevDb().magic_links[0].consumed_at).not.toBeNull();
  }, 30_000);
  it("cross-process appends retain every acknowledged write", async () => {
    await children("append", 6);
    expect(readDevDb().signups).toHaveLength(90);
    expect(new Set(readDevDb().signups.map(row => row.signup_id)).size).toBe(90);
  }, 30_000);
  it("six first-start processes share one secret and fresh process verifies every token", async () => {
    const tokens = await children("secret", 6);
    const file = join(dir, "tokens-fixture.json"); writeFileSync(file, JSON.stringify(tokens));
    expect(await children("verify", 1, file)).toEqual([Array(6).fill(true)]);
  }, 30_000);
  it("concurrent link issuance keeps every link available for revocation", async () => {
    await children("issue", 6);
    const issued = (await readLinkLedger("rq_race")).links;
    expect(issued).toHaveLength(60);
    expect(new Set(issued.map(row => row.link_id)).size).toBe(60);
  }, 30_000);
  it("recovers a lock left by a verifiably dead process", async () => {
    await children("die-locked", 1);
    expect(withFileLock(process.env.PRN_DEV_DB_PATH!, () => 42)).toBe(42);
  }, 30_000);
  it("wrong-request consume leaves the magic link available to its own request", async () => {
    const store = unguardedRuntimeStore();
    await store.saveMagicLink({ magic_id: "mg_bound", request_id: "rq_mine", contact: "fixture@example.invalid", created_at: new Date().toISOString(), consumed_at: null });
    expect(await store.consumeMagicLink("mg_bound", new Date().toISOString(), "rq_other")).toBeNull();
    expect(await store.consumeMagicLink("mg_bound", new Date().toISOString(), "rq_mine")).not.toBeNull();
  });
  it("corruption never becomes an empty store or overwrites revoked-link evidence", async () => {
    const file = process.env.PRN_DEV_DB_PATH!; const broken = '{"link_revocations":[';
    writeFileSync(file, broken);
    expect(() => readDevDb()).toThrow(/damaged/);
    expect(() => updateDevDb(db => { db.link_revocations = []; })).toThrow(/damaged/);
    expect(readFileSync(file, "utf8")).toBe(broken);
  });
  it("a missing established database stays unavailable to readers and writers", () => {
    unlinkSync(process.env.PRN_DEV_DB_PATH!);
    expect(() => readDevDb()).toThrow(/unavailable/);
    expect(() => updateDevDb(() => {})).toThrow(/unavailable/);
  });
});
