import { fork, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileSpendLedger } from "@/platform/ai/spend";

const day = "2026-09-05";
let dir: string;
let file: string;
const originalVercel = process.env.VERCEL;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "prn-spend-fixture-"));
  file = join(dir, "spend.json");
  delete process.env.VERCEL;
});
afterEach(() => {
  if (originalVercel === undefined) delete process.env.VERCEL; else process.env.VERCEL = originalVercel;
  rmSync(dir, { recursive: true, force: true });
});

async function concurrentWriters(): Promise<void> {
  const peers: ChildProcess[] = [];
  const ready: Promise<void>[] = [];
  const done: Promise<void>[] = [];
  for (let i = 0; i < 6; i++) {
    const child = fork(join(process.cwd(), "tests/helpers/spend-race-worker.ts"), [file], {
      execArgv: ["--import", "tsx"], silent: true,
      env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP, NODE_ENV: "test" },
    });
    peers.push(child);
    ready.push(new Promise((resolve, reject) => {
      child.on("message", message => { if ((message as { ready?: boolean }).ready) resolve(); });
      child.once("error", reject);
      child.once("exit", code => { if (code) reject(new Error(`Spend worker exited ${code} before ready`)); });
    }));
    done.push(new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { child.kill(); reject(new Error("Spend worker timeout")); }, 20_000);
      child.on("message", message => {
        const data = message as { done?: boolean; error?: string };
        if (data.error) { clearTimeout(timeout); reject(new Error(data.error)); }
      });
      child.once("error", error => { clearTimeout(timeout); reject(error); });
      child.once("exit", code => { clearTimeout(timeout); if (code === 0) resolve(); else reject(new Error(`Spend worker exited ${code}`)); });
    }));
  }
  try { await Promise.all(ready); peers.forEach(child => child.send("go")); await Promise.all(done); }
  finally { peers.forEach(child => child.kill()); }
}

describe("file spend durability", () => {
  it("a genuinely new ledger starts empty and preserves the first charge", async () => {
    const ledger = new FileSpendLedger(file);
    expect(await ledger.read(day)).toMatchObject({ calls: 0, total_usd: 0 });
    expect(existsSync(`${file}.initialized`)).toBe(false);
    await ledger.record(day, "fixture", 0.25);
    expect(existsSync(`${file}.initialized`)).toBe(true);
    expect(await new FileSpendLedger(file).read(day)).toMatchObject({ calls: 1, total_usd: 0.25 });
  });

  it("a fresh process refuses a missing established ledger instead of resetting the budget", async () => {
    await new FileSpendLedger(file).record(day, "fixture", 0.25);
    unlinkSync(file);
    const script = `const {FileSpendLedger}=require('./src/platform/ai/spend.ts'); new FileSpendLedger(process.argv[1]).read('${day}').then(value=>{process.stdout.write(JSON.stringify({allowed:true,value}));process.exitCode=2;},()=>{process.stdout.write(JSON.stringify({allowed:false}));});`;
    const child = spawnSync(process.execPath, ["--import", "tsx", "-e", script, file], {
      cwd: process.cwd(), encoding: "utf8", timeout: 10_000,
      env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP, NODE_ENV: "test" },
    });
    expect(child.error).toBeUndefined();
    expect(child.status).toBe(0);
    expect(JSON.parse(child.stdout)).toEqual({ allowed: false });
    await expect(new FileSpendLedger(file).record(day, "fixture", 0.001)).rejects.toThrow();
    expect(existsSync(file)).toBe(false);
  });

  it("adopts pre-marker history on its first read without changing the ledger bytes", async () => {
    const prior = JSON.stringify({ [day]: { calls: 4, total_usd: 0.04, by_capability: { fixture: 0.04 } } });
    writeFileSync(file, prior);
    expect(await new FileSpendLedger(file).read(day)).toMatchObject({ calls: 4, total_usd: 0.04 });
    expect(readFileSync(file, "utf8")).toBe(prior);
    expect(existsSync(`${file}.initialized`)).toBe(true);
    unlinkSync(file);
    await expect(new FileSpendLedger(file).read(day)).rejects.toThrow();
  });

  it("retains all 120 acknowledged charges from six simultaneous real processes", async () => {
    await concurrentWriters();
    const recorded = await new FileSpendLedger(file).read(day);
    expect(recorded.calls).toBe(120);
    expect(recorded.total_usd).toBe(0.12);
    expect(recorded.by_capability).toEqual({ "fixture.capability": 0.12 });
  }, 30_000);

  it("corrupt spend refuses both reads and writes and preserves the original bytes", async () => {
    const broken = '{"2026-09-05":';
    writeFileSync(file, broken);
    const ledger = new FileSpendLedger(file);
    await expect(ledger.read(day)).rejects.toThrow();
    await expect(ledger.record(day, "fixture", 0.001)).rejects.toThrow();
    expect(readFileSync(file, "utf8")).toBe(broken);
  });

  it.each([
    { total_usd: -1, calls: 1, by_capability: { fixture: 1 } },
    { total_usd: 1, calls: 0.5, by_capability: { fixture: 1 } },
    { total_usd: 1, calls: 1, by_capability: { fixture: "unknown" } },
  ])("refuses damaged row %# instead of treating it as free spend", async row => {
    const broken = JSON.stringify({ [day]: row });
    writeFileSync(file, broken);
    const ledger = new FileSpendLedger(file);
    await expect(ledger.read(day)).rejects.toThrow(/invalid spend/);
    await expect(ledger.record(day, "fixture", 0.001)).rejects.toThrow(/invalid spend/);
    expect(readFileSync(file, "utf8")).toBe(broken);
  });

  it("a non-file ledger path does not become an empty authorized balance", async () => {
    mkdirSync(file);
    await expect(new FileSpendLedger(file).read(day)).rejects.toThrow();
    await expect(new FileSpendLedger(file).record(day, "fixture", 0.001)).rejects.toThrow();
  });

  it("a rejected queued write does not discard the next write after explicit repair", async () => {
    writeFileSync(file, "broken");
    const ledger = new FileSpendLedger(file);
    await expect(ledger.record(day, "fixture", 0.001)).rejects.toThrow();
    writeFileSync(file, JSON.stringify({ [day]: { total_usd: 0.02, calls: 2, by_capability: { fixture: 0.02 } } }));
    expect(await ledger.record(day, "fixture", 0.001)).toMatchObject({ calls: 3, total_usd: 0.021, by_capability: { fixture: 0.021 } });
  });
});
