import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

it("serializes real worker processes, persists across restart, and deduplicates votes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "feature-workers-test-"));
  const file = join(dir, "store.json");
  const run = (action: string, input: unknown = {}) => new Promise<{ ok: boolean; code?: string; result?: unknown }>((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", "tests/fixtures/feature-store-worker.ts", action, JSON.stringify(input)], {
      cwd: process.cwd(), windowsHide: true,
      // Child-only local fixture isolation; no global runtime override or env-file loading.
      env: { ...process.env, NODE_ENV: "test", VERCEL: "", PRN_RUNTIME_STORE: "file", PRN_DEV_DB_PATH: file },
      stdio: ["ignore", "pipe", "pipe"], timeout: 10_000,
    });
    let stdout = ""; let stderr = "";
    child.stdout.on("data", data => { stdout += data.toString(); });
    child.stderr.on("data", data => { stderr += data.toString(); });
    child.once("error", reject);
    child.once("close", code => {
      if (code !== 0) { reject(new Error(`Fixture worker failed: ${stderr}`)); return; }
      try { resolve(JSON.parse(stdout)); } catch { reject(new Error(`Invalid fixture result: ${stdout} ${stderr}`)); }
    });
  });
  try {
    const input = { tenant_id: "trial", changes: [{ feature_id: "marketing", state: "PREVIEW", expected_version: 0 }],
      actor: "system", reason: "fixture", decision_ref: "test-only", at: "2026-09-13T12:00:00.000Z" };
    const writers = await Promise.all([run("set", input), run("set", input), run("set", input)]);
    expect(writers.filter(r => r.ok)).toHaveLength(1);
    expect(writers.filter(r => !r.ok).map(r => r.code)).toEqual(["FEATURE_STATE_CONFLICT", "FEATURE_STATE_CONFLICT"]);
    const restart = await run("read");
    expect(restart.result).toEqual([expect.objectContaining({ feature_id: "marketing", version: 1 })]);
    const vote = { tenant_id: "trial", feature_id: "marketing", feature_version: 1, page: "/pages/marketing",
      answer: "yes", visitor_hash: "a".repeat(64), dedupe_key: "b".repeat(64), created_at: input.at };
    const responses = await Promise.all([run("interest", vote), run("interest", vote), run("interest", vote)]);
    expect(responses.every(r => r.ok)).toBe(true);
    expect(responses.filter(r => (r.result as { created: boolean }).created)).toHaveLength(1);
    const persisted = JSON.parse(readFileSync(file, "utf8"));
    expect(persisted.feature_states).toHaveLength(1); expect(persisted.feature_interest).toHaveLength(1);
    expect(persisted.admin_audit).toHaveLength(2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}, 20_000);
