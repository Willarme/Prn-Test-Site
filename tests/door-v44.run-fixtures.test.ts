import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DOOR_FIXTURE_IDS, getDoorFixturePackage, loadDoorFixturePackage, assembleDoorFixture, doorFixtureIdentity } from "@/platform/search/door-page-run-fixtures";
import { executeDoorFixture, readDoorFixtureRunArtifact, type DoorFixtureExecutionCommand, type DoorFixtureOutcome } from "@/platform/search/door-page-run-executor";
import { doorPageVersionStore } from "@/platform/search/door-page-version-store";
import { doorPageVersionInputStore } from "@/platform/search/door-page-version-input-store";
import { readDevDb } from "@/platform/stores/dev-db";
import { doorV44Hash } from "@/domain/search/door-v44/schema-engine";
import { doorPageRunItems, doorPageRunOutcomeSchema, verifyDoorPageRunOutcome } from "@/domain/search/door-v44/page-run";
import * as compiler from "@/domain/search/door-v44/compiler";

let root: string, repositoryRoot: string, artifactRoot: string, packageInfo: Awaited<ReturnType<typeof getDoorFixturePackage>>;
let versions: ReturnType<typeof doorPageVersionStore>, inputs: ReturnType<typeof doorPageVersionInputStore>;
let testNumber = 0;
const packagePath = "content/door-v44-fixtures/v1";
beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "door-fixture-execution-")); repositoryRoot = join(root, "repository"); artifactRoot = join(root, "artifacts");
  const original = await loadDoorFixturePackage(); packageInfo = await getDoorFixturePackage();
  const paths = [...original.manifest.sources.map(row => row.path), packagePath + "/manifest.json", ...original.manifest.fixtures.map(row => packagePath + "/" + row.path)];
  for (const path of paths) { const target = join(repositoryRoot, path); mkdirSync(dirname(target), { recursive: true }); copyFileSync(join(process.cwd(), path), target); }
});
beforeEach(() => {
  vi.stubEnv("PRN_DEV_DB_PATH", join(root, `records-${++testNumber}.json`)); versions = doorPageVersionStore(() => null); inputs = doorPageVersionInputStore(() => null);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
afterAll(() => { const checked = resolve(root); if (!checked.startsWith(resolve(tmpdir()) + sep) || !checked.includes("door-fixture-execution-")) throw new Error("unsafe fixture cleanup"); rmSync(checked, { recursive: true, force: true }); });
function command(fixture_id: typeof DOOR_FIXTURE_IDS[number], dry_run = true, run_id = "fixture-run"): DoorFixtureExecutionCommand {
  const identity = doorFixtureIdentity(run_id, fixture_id);
  return { run_id, fixture_id, page_id: identity.page_id, operation_id: identity.operation_id, dry_run, actor: "system:fixture-execution-test", reason: "Offline synthetic execution only",
    execution_at: "2026-09-13T20:00:00.000Z", package_sha256: packageInfo.sha256, executor_sha256: packageInfo.executor_sha256 };
}
function deps() { return { repositoryRoot, artifactRoot, versions, inputs }; }
function preview(command: DoorFixtureExecutionCommand, outcome: DoorFixtureOutcome) {
  if (!outcome.artifact || !outcome.input_sha256 || !outcome.spec_sha256 || !outcome.compile_receipt_sha256 || !outcome.html_hash || !outcome.semantic_hash) throw new Error("Expected built fixture");
  return { run_id: command.run_id, fixture_id: command.fixture_id, page_id: command.page_id, artifact_hash: outcome.artifact.artifact_hash, input_sha256: outcome.input_sha256,
    spec_sha256: outcome.spec_sha256, compile_receipt_sha256: outcome.compile_receipt_sha256, html_hash: outcome.html_hash, semantic_hash: outcome.semantic_hash,
    package_sha256: command.package_sha256, executor_sha256: command.executor_sha256 };
}

describe("pinned server fixture package", () => {
  it("contains all eleven fixtures and full self-contained synthetic inputs", async () => {
    const loaded = await loadDoorFixturePackage(repositoryRoot);
    expect(loaded.manifest.fixtures.map(f => f.fixture_id)).toEqual(DOR_IDS()); expect(loaded.inputs.size).toBe(10);
    expect(loaded.manifest.sources.some(row => row.path.includes("tests/"))).toBe(false);
    for (const { spec, context } of loaded.inputs.values()) {
      expect(context.validation.mode).toBe("fixture"); expect(context.validation.schema_bundle.length).toBeGreaterThan(5);
      expect(context.asset_records.length).toBeGreaterThan(0); expect(context.asset_records[0].raster_base64.length).toBeGreaterThan(20);
      expect(spec.release.approved_content_at).toBeNull(); expect(context.visible_approvals).toEqual([]);
    }
    expect(JSON.stringify(await getDoorFixturePackage(repositoryRoot))).not.toContain("raster_base64");
  });
  it("pins the actual existing F01 blocked report rather than inventing a successful replacement", async () => {
    const report = JSON.parse(readFileSync(join(process.cwd(), "tests/fixtures/door-v44/corpus/f01/report.json"), "utf8")) as {
      status: string; candidate_hash: string; source_pin_hash: string; blockers: Array<{ code: string; pointers: string[] }>;
    };
    const loaded = await loadDoorFixturePackage(repositoryRoot);
    expect(loaded.blocked).toMatchObject({ status: report.status, candidate_hash: report.candidate_hash, source_pin_hash: report.source_pin_hash,
      report_sha256: doorV44Hash(report), compiler_pass: false, release_ready: false });
    expect(loaded.blocked.diagnostics).toEqual(report.blockers.flatMap(row => row.pointers.map(pointer => ({ code: row.code, pointer }))));
  });
  it("agrees with the run-domain identity formula and remaps every associated identity", async () => {
    const loaded = await loadDoorFixturePackage(repositoryRoot);
    for (const row of doorPageRunItems("prn", "deterministic-run")) {
      const identity = doorFixtureIdentity("deterministic-run", row.fixture_id); expect(identity.page_id).toBe(row.page_id); expect(identity.operation_id).toBe(row.operation_id);
      if (row.fixture_id === "F01") continue;
      const assembled = assembleDoorFixture(loaded.inputs.get(row.fixture_id)!, "deterministic-run", row.fixture_id, loaded.sha256, loaded.manifest.executor_sha256);
      expect(assembled.spec.identity).toMatchObject({ tenant_id: "prn", page_id: row.page_id, opportunity_id: identity.opportunity_id, page_version: 1 });
      expect(assembled.spec.intake.attribution).toMatchObject({ page_id: row.page_id, search_opportunity_id: identity.opportunity_id, landing_path: identity.canonical_path });
      expect(assembled.context.validation.eligibilities[0]).toMatchObject({ page_id: row.page_id, opportunity_id: identity.opportunity_id });
      expect(doorV44Hash(assembled.context.validation.schema_bundle)).toBe(doorV44Hash(loaded.inputs.get(row.fixture_id)!.context.validation.schema_bundle));
      expect(JSON.stringify(assembled)).not.toContain('"fixture.tenant"');
      expect(doorFixtureIdentity("another-run", row.fixture_id).page_id).not.toBe(row.page_id);
    }
  });
  it("rejects one unrequested case mutation before any storage mutation", async () => {
    const path = join(repositoryRoot, packagePath, "f11.json"), original = readFileSync(path);
    const reserve = vi.spyOn(versions, "reserveVersion");
    try { writeFileSync(path, Buffer.concat([original, Buffer.from(" ")]));
      await expect(executeDoorFixture(command("F02", false), deps())).rejects.toMatchObject({ code: "FIXTURE_PACKAGE_DRIFT" }); expect(reserve).not.toHaveBeenCalled();
    } finally { writeFileSync(path, original); }
  });
  it("rejects repinned manifest bytes, absent source and actual source drift", async () => {
    const manifestPath = join(repositoryRoot, packagePath, "manifest.json"), manifest = readFileSync(manifestPath);
    try { writeFileSync(manifestPath, "{}"); await expect(getDoorFixturePackage(repositoryRoot)).rejects.toMatchObject({ code: "FIXTURE_PACKAGE_DRIFT" }); }
    finally { writeFileSync(manifestPath, manifest); }
    const sourcePath = join(repositoryRoot, "src/platform/search/door-page-run-executor.ts"), source = readFileSync(sourcePath);
    try {
      writeFileSync(sourcePath, Buffer.concat([source, Buffer.from("// changed\n")])); await expect(getDoorFixturePackage(repositoryRoot)).rejects.toMatchObject({ code: "FIXTURE_PACKAGE_DRIFT" });
      unlinkSync(sourcePath); await expect(getDoorFixturePackage(repositoryRoot)).rejects.toMatchObject({ code: "FIXTURE_PACKAGE_UNAVAILABLE" });
    } finally { writeFileSync(sourcePath, source); }
  });
  it("accepts only pinned source LF/CRLF representations while keeping package bytes exact", async () => {
    const path = join(repositoryRoot, "src/platform/search/door-page-run-executor.ts"), original = readFileSync(path), lf = original.toString("utf8").replaceAll("\r\n", "\n");
    try {
      writeFileSync(path, lf.replaceAll("\n", "\r\n")); expect((await getDoorFixturePackage(repositoryRoot)).sha256).toBe(packageInfo.sha256);
      writeFileSync(path, lf); expect((await getDoorFixturePackage(repositoryRoot)).sha256).toBe(packageInfo.sha256);
      writeFileSync(path, lf.replace("\n", "\r\n")); await expect(getDoorFixturePackage(repositoryRoot)).rejects.toMatchObject({ code: "FIXTURE_PACKAGE_DRIFT" });
    } finally { writeFileSync(path, original); }
  });
});
function DOR_IDS() { return [...DOOR_FIXTURE_IDS]; }

describe("actual server fixture execution without paid calls or release authority", () => {
  const outcomes: DoorFixtureOutcome[] = [];
  it.each(DOOR_FIXTURE_IDS)("executes saved %s against real immutable stores with a bounded per-item test", async fixture_id => {
      const c = command(fixture_id, false, "saved-eleven"); const result = await executeDoorFixture(c, deps()); outcomes.push(result);
      expect(doorPageRunOutcomeSchema.safeParse(result).success).toBe(true);
      verifyDoorPageRunOutcome({ tenant_id: "prn", run_id: c.run_id, dry_run: false }, { item_id: fixture_id, fixture_id, page_id: c.page_id, operation_id: c.operation_id }, result);
      if (fixture_id !== "F01") {
        expect(result.status).toBe("BUILT"); const row = await versions.getVersion("prn", c.page_id, 1); expect(row?.metadata.receipt.artifact_hash).toBe(result.artifact?.artifact_hash);
        expect(row?.metadata.provenance_status).toBe("unattested");
        const saved = await inputs.getVersionInput("prn", c.page_id, 1); expect(saved?.model_provenance).toEqual({ status: "fixture_no_model_calls", fixture_id });
      }
    expect(readDevDb().door_page_version_inputs).toHaveLength(fixture_id === "F01" ? 0 : 1); expect(readDevDb().door_page_selection_sets).toEqual([]); expect(readDevDb().published_page_ids).toEqual([]);
  });
  it("accounts for all eleven actual outcomes without a full corpus acceptance claim", () => {
    expect(outcomes.filter(o => o.status === "BUILT")).toHaveLength(10); expect(outcomes[0]).toMatchObject({ status: "BLOCKED", fixture_id: "F01", artifact: null, reservation_id: null, control_report: { status: "BLOCKED_CONTROL_DERIVATIVE" } });
    expect(outcomes[0].diagnostics).toContainEqual({ code: "CAPABILITIES_UNVERIFIED", pointer: "/capabilities" });
    expect(outcomes.every(o => o.model_calls === 0 && o.cost_usd === "0" && o.release_ready === false)).toBe(true);
  });
  it("dry-runs a real artifact and complete input with no store construction, writes or catalogue mutation", async () => {
    const before = doorV44Hash(readDevDb()), c = command("F04", true, "dry-preview");
    const result = await executeDoorFixture(c, { repositoryRoot, artifactRoot, get versions(): never { throw new Error("Dry run touched versions"); }, get inputs(): never { throw new Error("Dry run touched inputs"); } });
    expect(result).toMatchObject({ status: "BUILT", reservation_id: null, artifact: { namespace: "dry-run" } }); expect(doorV44Hash(readDevDb())).toBe(before);
    const read = await readDoorFixtureRunArtifact(preview(c, result), artifactRoot); expect(read.compiled.receipt.artifact_hash).toBe(result.artifact?.artifact_hash);
    expect(await executeDoorFixture(c, deps())).toEqual(result); expect(doorV44Hash(readDevDb())).toBe(before);
    const path = join(repositoryRoot, packagePath, "manifest.json"), original = readFileSync(path);
    try { writeFileSync(path, "{}"); expect((await readDoorFixtureRunArtifact(preview(c, result), artifactRoot)).artifact_hash).toBe(result.artifact?.artifact_hash); }
    finally { writeFileSync(path, original); }
  });
  it("rejects swapped dry run/hash/input subjects rather than falling back", async () => {
    const c = command("F08", true, "dry-binding"), result = await executeDoorFixture(c, deps()), p = preview(c, result);
    for (const patch of [{ run_id: "another-run" }, { fixture_id: "F04" as const }, { page_id: "foreign-page" }, { input_sha256: "0".repeat(64) }, { spec_sha256: "0".repeat(64) }, { compile_receipt_sha256: "0".repeat(64) }, { package_sha256: "0".repeat(64) }, { executor_sha256: "0".repeat(64) }]) {
      await expect(readDoorFixtureRunArtifact({ ...p, ...patch }, artifactRoot)).rejects.toThrow();
    }
  });
  it("recovers a reservation committed before a transport failure, retaining original fields", async () => {
    const c = command("F05", false, "reservation-interrupted"), reserve = versions.reserveVersion;
    const interrupted = { ...versions, reserveVersion: vi.fn(async (input: Parameters<typeof reserve>[0]) => { await reserve(input); throw new Error("Transport reply lost"); }) };
    await expect(executeDoorFixture(c, { ...deps(), versions: interrupted })).rejects.toMatchObject({ code: "FIXTURE_STORAGE_UNAVAILABLE", recoverable: true });
    const result = await executeDoorFixture(c, deps()); expect(result.status).toBe("BUILT"); expect(await executeDoorFixture(c, deps())).toEqual(result);
    expect(await versions.listVersions("prn", c.page_id)).toHaveLength(1);
  });
  it("recovers immutable artifact/catalogue writes when registration response is lost", async () => {
    const c = command("F06", false, "registration-interrupted"), register = versions.registerVersion;
    const interrupted = { ...versions, registerVersion: vi.fn(async (input: Parameters<typeof register>[0]) => { await register(input); throw new Error("Lost success reply"); }) };
    await expect(executeDoorFixture(c, { ...deps(), versions: interrupted })).rejects.toMatchObject({ recoverable: true });
    expect((await executeDoorFixture(c, deps())).status).toBe("BUILT"); expect(await versions.listVersions("prn", c.page_id)).toHaveLength(1);
  });
  it("returns FAILED only for known compiler diagnostics, not uncertain storage", async () => {
    vi.spyOn(compiler, "compileDoorV44Page").mockResolvedValueOnce({ ok: false, errors: [{ code: "SOURCE_RECORD_INVALID", pointer: "/source_records/0" }] });
    const result = await executeDoorFixture(command("F07", true, "controlled-failure"), deps());
    expect(result).toMatchObject({ status: "FAILED", artifact: null, diagnostics: [{ code: "SOURCE_RECORD_INVALID", pointer: "/source_records/0" }] });
  });
  it("refuses wrong durable pins and non-deterministic command identities before reserving", async () => {
    const reserve = vi.spyOn(versions, "reserveVersion");
    await expect(executeDoorFixture({ ...command("F02", false), package_sha256: "0".repeat(64) }, deps())).rejects.toMatchObject({ code: "FIXTURE_PACKAGE_CHANGED" });
    await expect(executeDoorFixture({ ...command("F02", false), executor_sha256: "0".repeat(64) }, deps())).rejects.toMatchObject({ code: "FIXTURE_PACKAGE_CHANGED" });
    await expect(executeDoorFixture({ ...command("F02", false), page_id: "unrelated" }, deps())).rejects.toMatchObject({ code: "FIXTURE_COMMAND_INVALID" });
    expect(reserve).not.toHaveBeenCalled();
  });
});
