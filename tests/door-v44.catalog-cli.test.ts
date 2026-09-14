import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let root: string;
const command = { tenant_id: "synthetic", page_id: "synthetic-page", canonical_intent_id: "synthetic-intent",
  canonical_url: "https://example.test/problems/synthetic-page", operation_id: "synthetic-operation", expected_latest_version: 0,
  actor: "system:synthetic-test", reason: "Offline CLI test", at: "2026-09-13T20:00:00Z" };
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "door-catalog-cli-")); });
afterEach(() => {
  const checked = resolve(root);
  if (!checked.startsWith(resolve(tmpdir()) + sep) || !checked.includes("door-catalog-cli-")) throw new Error("unsafe fixture cleanup");
  rmSync(checked, { recursive: true, force: true });
});
function invoke(action: string, input: unknown, extra: string[] = []) {
  const inputPath = join(root, "command.json");
  writeFileSync(inputPath, typeof input === "string" ? input : JSON.stringify(input));
  const args = [join(process.cwd(), "node_modules/tsx/dist/cli.mjs"), "tools/door-v44/catalog.ts", action,
    "--db", join(root, "records.json"), "--input", inputPath, ...extra];
  let output: string, status = 0;
  try { output = execFileSync(process.execPath, args, { cwd: process.cwd(), encoding: "utf8", timeout: 20000 }); }
  catch (error) {
    const failure = error as { stdout?: string; status?: number };
    if (typeof failure.stdout !== "string" || typeof failure.status !== "number") throw error;
    output = failure.stdout; status = failure.status;
  }
  return { status, body: JSON.parse(output) };
}

describe("local candidate catalogue CLI", () => {
  it("persists one reservation across process restarts and retries without publishing", () => {
    const first = invoke("reserve", command);
    expect(first.status).toBe(0);
    expect(first.body).toMatchObject({ ok: true, backend: "file", publication: "NOT_ATTEMPTED", release_ready: false, result: { page_version: 1 } });
    expect(invoke("reserve", command)).toEqual(first);
    expect(invoke("list", { tenant_id: command.tenant_id, page_id: command.page_id }).body.result).toEqual([]);
    const saved = JSON.parse(readFileSync(join(root, "records.json"), "utf8"));
    expect(saved.admin_audit.filter((row: { action: string }) => row.action === "door_page_version_reserved")).toHaveLength(1);
    expect(saved.published_page_ids).toEqual([]);
  });

  it("refuses a changed retry and preserves the previously saved records", () => {
    expect(invoke("reserve", command).status).toBe(0);
    const before = readFileSync(join(root, "records.json"), "utf8");
    expect(invoke("reserve", { ...command, reason: "different operation" })).toMatchObject({ status: 1,
      body: { ok: false, errors: [{ code: "DOOR_VERSION_CONFLICT" }], publication: "NOT_ATTEMPTED" } });
    expect(readFileSync(join(root, "records.json"), "utf8")).toBe(before);
  });

  it.each([
    ["oversized input", JSON.stringify({ value: "private fixture marker".repeat(4000) }), []],
    ["duplicate option", command, ["--db", "relative.json"]],
    ["unexpected artifact root", command, ["--root", "unused"]],
  ])("rejects %s with a bounded error and no database creation", (_name, input, extra) => {
    const result = invoke("reserve", input, extra as string[]);
    expect(result.status).toBe(1);
    expect(result.body).toEqual({ ok: false, errors: [{ code: "CATALOG_INPUT_OR_IO_INVALID" }], publication: "NOT_ATTEMPTED" });
    expect(existsSync(join(root, "records.json"))).toBe(false);
  });

  it("has no publish command", () => {
    expect(invoke("publish", command)).toMatchObject({ status: 1, body: { ok: false, publication: "NOT_ATTEMPTED" } });
    expect(existsSync(join(root, "records.json"))).toBe(false);
  });
});
