import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { compilerFixture } from "./fixtures/door-v44/compiler-fixture";

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "door-saved-cli-")); });
afterEach(() => {
  const checked = resolve(root);
  if (!checked.startsWith(resolve(tmpdir()) + sep) || !checked.includes("door-saved-cli-")) throw new Error("unsafe fixture cleanup");
  rmSync(checked, { recursive: true, force: true });
});
function invoke(action: string, input: unknown, withRoot = false) {
  const inputPath = join(root, "command.json"); writeFileSync(inputPath, JSON.stringify(input));
  const args = [join(process.cwd(), "node_modules/tsx/dist/cli.mjs"), "tools/door-v44/catalog.ts", action,
    "--db", join(root, "records.json"), "--input", inputPath, ...(withRoot ? ["--root", join(root, "artifacts")] : [])];
  try { return { status: 0, body: JSON.parse(execFileSync(process.execPath, args, { cwd: process.cwd(), encoding: "utf8", timeout: 30000 })) }; }
  catch (error) {
    const failure = error as { stdout?: string; status?: number };
    if (typeof failure.stdout !== "string" || typeof failure.status !== "number") throw error;
    return { status: failure.status, body: JSON.parse(failure.stdout) };
  }
}
async function prepare() {
  const { spec, context } = await compilerFixture();
  const audit = { actor: "system:synthetic-test", reason: "CLI saved input verification", at: "2026-09-13T21:00:00.000Z" };
  const identity = { tenant_id: spec.identity.tenant_id, page_id: spec.identity.page_id };
  const operation_id = "saved-input-cli";
  const reservation = invoke("reserve", { ...identity, canonical_intent_id: spec.identity.canonical_intent_id,
    canonical_url: new URL(spec.identity.canonical_path, context.validation.origin).href, expected_latest_version: 0, operation_id, ...audit });
  expect(reservation.status).toBe(0);
  const capture = { ...identity, reservation_id: reservation.body.result.reservation_id, spec, context,
    model_provenance: { status: "fixture_no_model_calls", fixture_id: "F04" }, ...audit };
  const saved = invoke("capture-input", capture); expect(saved.status).toBe(0);
  return { capture, saved, command: { ...identity, operation_id, expected_input_sha256: saved.body.result.input_sha256, ...audit } };
}

it("executes reserve/capture/build/retry/verify in distinct processes using saved inputs only", async () => {
  const f = await prepare();
  expect(f.saved.body.result).toMatchObject({ page_version: 1, model_provenance_status: "fixture_no_model_calls" });
  expect(f.saved.body.result).not.toHaveProperty("context"); expect(f.saved.body.result).not.toHaveProperty("spec");
  const first = invoke("build-saved", f.command, true);
  expect(first).toMatchObject({ status: 0, body: { ok: true, publication: "NOT_ATTEMPTED", release_ready: false,
    result: { artifact_read_verified: true, replayed: false, recovered: false, version: { metadata: { provenance_status: "unattested" } } } } });
  const retry = invoke("build-saved", f.command, true);
  expect(retry).toMatchObject({ status: 0, body: { result: { replayed: true, version: first.body.result.version } } });
  expect(invoke("verify", { tenant_id: f.command.tenant_id, page_id: f.command.page_id, page_version: 1 }, true)).toMatchObject({ status: 0, body: { result: { artifact_read_verified: true } } });
  const db = JSON.parse(readFileSync(join(root, "records.json"), "utf8"));
  expect(db.published_page_ids).toEqual([]); expect(db.intent_pages).toEqual([]);
}, 90000);

it("rejects changed snapshot and build-time input substitution without altering stored state", async () => {
  const f = await prepare();
  const before = readFileSync(join(root, "records.json"), "utf8");
  f.capture.model_provenance.fixture_id = "different-fixture";
  expect(invoke("capture-input", f.capture)).toMatchObject({ status: 1, body: { errors: [{ code: "DOOR_INPUT_CONFLICT" }] } });
  expect(invoke("build-saved", { ...f.command, context: f.capture.context }, true)).toMatchObject({ status: 1, body: { ok: false } });
  expect(invoke("build-saved", { ...f.command, expected_input_sha256: "0".repeat(64) }, true)).toMatchObject({ status: 1,
    body: { errors: [{ code: "SAVED_BUILD_INPUT_MISMATCH" }] } });
  expect(readFileSync(join(root, "records.json"), "utf8")).toBe(before);
}, 90000);
