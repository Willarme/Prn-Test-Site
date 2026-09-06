import { fork, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileSpendLedger, MemorySpendLedger, type SpendAdmission } from "@/platform/ai/spend";

const day = "2026-09-05";
const admission: SpendAdmission = { day, capability: "fixture", usd: 0.01, global_cap_usd: 0.05, capability_cap_usd: 0.03 };
let dir: string;
let file: string;
const originalVercel = process.env.VERCEL;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "prn-reservation-fixture-"));
  file = join(dir, "spend.json");
  delete process.env.VERCEL;
});
afterEach(() => {
  if (originalVercel === undefined) delete process.env.VERCEL; else process.env.VERCEL = originalVercel;
  rmSync(dir, { recursive: true, force: true });
});

async function reservationRace(): Promise<number> {
  const peers: ChildProcess[] = [];
  const ready: Promise<void>[] = [];
  const done: Promise<number>[] = [];
  for (let i = 0; i < 6; i++) {
    const child = fork(join(process.cwd(), "tests/helpers/spend-race-worker.ts"), [file, "reserve", `fixture.${i % 2}`], {
      execArgv: ["--import", "tsx"], silent: true,
      env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP, NODE_ENV: "test" },
    });
    peers.push(child);
    ready.push(new Promise((resolve, reject) => {
      child.on("message", message => { if ((message as { ready?: boolean }).ready) resolve(); });
      child.once("error", reject);
      child.once("exit", code => { if (code) reject(new Error(`Reservation worker exited ${code} before ready`)); });
    }));
    done.push(new Promise((resolve, reject) => {
      let admitted = 0;
      const timeout = setTimeout(() => { child.kill(); reject(new Error("Reservation worker timeout")); }, 20_000);
      child.on("message", message => {
        const data = message as { admitted?: number; error?: string };
        if (data.admitted !== undefined) admitted = data.admitted;
        if (data.error) { clearTimeout(timeout); reject(new Error(data.error)); }
      });
      child.once("error", error => { clearTimeout(timeout); reject(error); });
      child.once("exit", code => { clearTimeout(timeout); if (code === 0) resolve(admitted); else reject(new Error(`Reservation worker exited ${code}`)); });
    }));
  }
  try {
    await Promise.all(ready);
    peers.forEach(child => child.send("go"));
    return (await Promise.all(done)).reduce((sum, n) => sum + n, 0);
  } finally { peers.forEach(child => child.kill()); }
}

describe("atomic spend admission", () => {
  it("admits only five allowances from 120 attempts in six real processes, respecting both capability caps", async () => {
    expect(await reservationRace()).toBe(5);
    const raw = JSON.parse(readFileSync(file, "utf8"));
    const rows = Object.values(raw[day].reservations) as Array<{ capability: string; held_usd: number }>;
    expect(rows).toHaveLength(5);
    expect(rows.reduce((sum, row) => sum + row.held_usd, 0)).toBeCloseTo(0.05);
    for (const capability of ["fixture.0", "fixture.1"]) expect(rows.filter(row => row.capability === capability).length).toBeLessThanOrEqual(3);
    // The subprocesses exited without settling. A new instance cannot treat
    // their allowances as expired, even on the next UTC day.
    expect(await new FileSpendLedger(file).reserve({ ...admission, day: "2026-09-06" })).toBeNull();
  }, 30_000);

  it.each(["file", "memory"])("%s ledger settles actual cost once and keeps uncertain charges unavailable", async kind => {
    const ledger = kind === "file" ? new FileSpendLedger(file) : new MemorySpendLedger();
    const reserved = await ledger.reserve(admission);
    expect(reserved).not.toBeNull();
    expect(await ledger.settle(reserved!, 0.004, 0.006)).toMatchObject({ calls: 1, total_usd: 0.004 });
    expect(await ledger.settle(reserved!, 0.004, 0.006)).toMatchObject({ calls: 1, total_usd: 0.004 });
    await expect(ledger.settle(reserved!, 0.004, 0)).rejects.toThrow(/already settled differently/);
    expect(await ledger.reserve({ ...admission, usd: 0.021 })).toBeNull();
    expect(await ledger.reserve({ ...admission, usd: 0.02 })).not.toBeNull();
  });

  it("a partial daily allowance is explicit and never rounded above the remaining cap", async () => {
    const ledger = new FileSpendLedger(file);
    await ledger.record(day, "fixture", 0.025);
    const reserved = await ledger.reserve({ ...admission, allow_partial: true });
    expect(reserved?.usd).toBe(0.005);
    expect(await ledger.reserve({ ...admission, allow_partial: true })).toBeNull();
    const tiny = await new FileSpendLedger(join(dir, "tiny.json")).reserve({ ...admission, usd: 0.000001, global_cap_usd: 0.0000009 });
    expect(tiny).toBeNull();
  });

  it("releases known zero-attempt work without counting a billed call", async () => {
    const ledger = new FileSpendLedger(file);
    const reserved = await ledger.reserve(admission);
    await ledger.settle(reserved!, 0, 0, false);
    expect(await ledger.read(day)).toMatchObject({ calls: 0, total_usd: 0 });
    expect(await ledger.reserve({ ...admission, usd: 0.03 })).not.toBeNull();
  });

  it("a missing, corrupted or truncated initialized reservation never becomes a fresh allowance", async () => {
    const ledger = new FileSpendLedger(file);
    await ledger.reserve(admission);
    const raw = readFileSync(file, "utf8");
    expect(existsSync(`${file}.initialized`)).toBe(true);
    unlinkSync(file);
    await expect(new FileSpendLedger(file).reserve(admission)).rejects.toThrow();
    writeFileSync(file, raw.slice(0, -8));
    await expect(new FileSpendLedger(file).reserve(admission)).rejects.toThrow();
    expect(readFileSync(file, "utf8")).toBe(raw.slice(0, -8));
  });

  it("retention never drops pending amounts after 45 days of later accounting", async () => {
    const ledger = new FileSpendLedger(file);
    await ledger.reserve({ ...admission, usd: 0.03 });
    for (let i = 1; i <= 50; i++) {
      const date = new Date("2026-09-05T12:00:00Z"); date.setUTCDate(date.getUTCDate() + i);
      await ledger.record(date.toISOString().slice(0, 10), "other", 0.001);
    }
    expect(JSON.parse(readFileSync(file, "utf8"))[day]).toBeDefined();
    expect(await new FileSpendLedger(file).reserve({ ...admission, day: "2026-11-01" })).toBeNull();
  });

  it("a failed settlement preserves the reservation bytes instead of releasing it", async () => {
    const ledger = new FileSpendLedger(file);
    const reserved = await ledger.reserve(admission);
    const before = readFileSync(file, "utf8");
    await expect(ledger.settle({ ...reserved!, id: "not-the-issued-reservation" }, 0, 0)).rejects.toThrow();
    expect(readFileSync(file, "utf8")).toBe(before);
  });
});
