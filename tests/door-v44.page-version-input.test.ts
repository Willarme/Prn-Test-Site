import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { compilerFixture } from "./fixtures/door-v44/compiler-fixture";
import { compileDoorV44Page } from "@/domain/search/door-v44/compiler";
import { doorV44Hash } from "@/domain/search/door-v44/schema-engine";
import { doorPageMetadataSchema } from "@/domain/search/door-v44/page-version";
import { doorPageVersionStore } from "@/platform/search/door-page-version-store";
import { doorPageVersionInputStore } from "@/platform/search/door-page-version-input-store";
import { decodeDoorPageVersionInput, doorPageCompilerContextSchema, prepareDoorPageVersionInput, verifyDoorPageVersionInputReceipt, type DoorPageCaptureInput, type DoorPageVersionInputWire } from "@/domain/search/door-v44/page-version-input";
import { readDevDb, updateDevDb } from "@/platform/stores/dev-db";
import type { DoorV44CompileReceipt } from "@/domain/search/door-v44/compiler-types";

let f: Awaited<ReturnType<typeof compilerFixture>>; let receipt: DoorV44CompileReceipt;
let directory: string; let file: string;
const at = "2026-09-13T20:00:00Z";
const versions = () => doorPageVersionStore(() => null);
const inputs = () => doorPageVersionInputStore(() => null);
beforeAll(async () => {
  f = await compilerFixture(); const parsed = doorPageCompilerContextSchema.safeParse(f.context); if (!parsed.success) throw new Error(JSON.stringify(parsed.error.issues));
  const c = await compileDoorV44Page(f.spec, f.context); expect(c.ok).toBe(true); if (!c.ok) throw new Error("fixture compile failed"); receipt = c.receipt;
}, 20000);
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), "door-input-test-")); file = join(directory, "db.json"); vi.stubEnv("PRN_DEV_DB_PATH", file); });
afterEach(() => { vi.unstubAllEnvs(); rmSync(directory, { recursive: true, force: true }); });
async function command(): Promise<DoorPageCaptureInput> {
  const r = await versions().reserveVersion({ tenant_id: f.spec.identity.tenant_id, page_id: f.spec.identity.page_id, canonical_intent_id: f.spec.identity.canonical_intent_id,
    canonical_url: new URL(f.spec.identity.canonical_path, f.context.validation.origin).href, operation_id: "input_fixture", expected_latest_version: 0, actor: "fixture", reason: "Capture original fixture inputs", at });
  return { tenant_id: r.tenant_id, page_id: r.page_id, reservation_id: r.reservation_id, spec: structuredClone(f.spec), context: structuredClone(f.context), model_provenance: { status: "fixture_no_model_calls", fixture_id: "f04" }, actor: "fixture", reason: "Capture original fixture inputs", at };
}
function registerInput(input: DoorPageCaptureInput, r = receipt) { return { tenant_id: input.tenant_id, page_id: input.page_id, reservation_id: input.reservation_id,
  metadata: doorPageMetadataSchema.parse({ receipt: r, receipt_sha256: doorV44Hash(r), provenance_status: "unattested", build_provenance_sha256: null }), actor: "fixture", reason: "Register exact inputs", at }; }

describe("original governed PageVersion inputs", () => {
  it("captures complete pristine inputs before compilation, derives names and records no invented model", async () => {
    const input = await command(); input.model_provenance = { status: "not_recorded" }; const stored = await inputs().captureInput(input);
    expect(stored.spec).toEqual(f.spec); expect(stored.context).toEqual(f.context); expect(stored.model_provenance).toEqual({ status: "not_recorded" });
    expect(stored.assignments.template_version).toBe(f.spec.versions.template); expect(stored.assignments.prompt_identities).toEqual(f.spec.versions.prompt_identities);
    expect(stored.input_sha256).toMatch(/^[a-f0-9]{64}$/); expect(stored.context.validation.input_hashes.build_provenance_sha256).toBeUndefined();
    expect(verifyDoorPageVersionInputReceipt(stored, receipt).ok).toBe(true);
    expect(await inputs().getVersionInput(input.tenant_id, input.page_id, 1)).toEqual(stored);
  });
  it("captures and audits exactly once; retries remain exact after registration", async () => {
    const input = await command(); const saved = await inputs().captureInput(input); await versions().registerVersion(registerInput(input));
    expect(await inputs().captureInput(input)).toEqual(saved); expect(readDevDb().admin_audit.map((a) => a.action)).toEqual(["door_page_version_reserved", "door_page_input_captured", "door_page_version_registered"]);
    expect(JSON.parse(readDevDb().admin_audit[1].detail!)).toMatchObject({ actor: input.actor, reason: input.reason, input_sha256: saved.input_sha256 });
  });
  it("rejects first capture after a legacy registration while retaining its readable metadata", async () => {
    const input = await command(); const old = await versions().registerVersion(registerInput(input)); const before = readFileSync(file, "utf8");
    await expect(inputs().captureInput(input)).rejects.toMatchObject({ code: "DOOR_INPUT_CONFLICT" }); expect(readFileSync(file, "utf8")).toBe(before);
    expect(await versions().getVersion(input.tenant_id, input.page_id, 1)).toEqual(old); expect(await inputs().getInput(input.tenant_id, input.page_id, input.reservation_id)).toBeNull();
  });
  it("retains unrelated collections and leaves publication untouched", async () => {
    const input = await command(); updateDevDb((db) => { db.published_page_ids.push("unrelated"); db.signups.push({ fixture: "preserve" } as never); });
    await inputs().captureInput(input); expect(readDevDb().published_page_ids).toEqual(["unrelated"]); expect(readDevDb().signups).toEqual([{ fixture: "preserve" }]); expect(readDevDb().door_page_version_catalog[0].versions).toEqual([]);
  });
  it.each(["spec", "context", "model"])("a different %s invalidates an immutable capture", async (field) => {
    const input = await command(); await inputs().captureInput(input); const changed = structuredClone(input);
    if (field === "spec") (changed.spec as typeof f.spec).head.page.meta_description = "An alternate governed fixture description whose evidence and request remain synthetic and scoped to the property issue shown on this page.";
    if (field === "context") changed.context.site.current_year++;
    if (field === "model") changed.model_provenance = { status: "not_recorded" };
    await expect(inputs().captureInput(changed)).rejects.toMatchObject({ code: "DOOR_INPUT_CONFLICT" });
  });
  it.each(["outer", "validation", "source", "asset"])("rejects extra %s fields instead of retaining a private blob", async (location) => {
    const input = await command(); const extra = { api_key: "SYNTHETIC_FORBIDDEN_FIELD" };
    if (location === "outer") Object.assign(input.context, extra); if (location === "validation") Object.assign(input.context.validation, extra); if (location === "source") Object.assign(input.context.source_records[0], extra); if (location === "asset") Object.assign(input.context.asset_records[0], extra);
    await expect(inputs().captureInput(input)).rejects.toMatchObject({ code: "DOOR_INPUT_INVALID" });
  });
  it("rejects derived hash injection and inherited/accessor input before executing it", async () => {
    const input = await command(); input.context.validation.input_hashes.build_provenance_sha256 = "0".repeat(64);
    await expect(inputs().captureInput(input)).rejects.toMatchObject({ code: "DOOR_INPUT_INVALID" });
    const getter = vi.fn(() => f.context); const dangerous = await command(); Object.defineProperty(dangerous, "context", { get: getter, enumerable: true });
    await expect(inputs().captureInput(dangerous)).rejects.toMatchObject({ code: "DOOR_INPUT_INVALID" }); expect(getter).not.toHaveBeenCalled();
  });
  it("refuses over-budget snapshots without writing or truncating them", async () => {
    const input = await command(); input.context.asset_records = Array.from({ length: 10 }, (_, i) => ({ ...input.context.asset_records[0], asset_id: `fixture_${i}`, inline_source: "x".repeat(900000) }));
    const before = readFileSync(file, "utf8"); await expect(inputs().captureInput(input)).rejects.toMatchObject({ code: "DOOR_INPUT_INVALID" }); expect(readFileSync(file, "utf8")).toBe(before);
  });
  it("keeps callers detached from saved data and scopes reads to tenant/page/version", async () => {
    const input = await command(); const saved = await inputs().captureInput(input); input.context.site.name = "Changed input"; saved.context.site.name = "Changed result";
    expect((await inputs().getInput(input.tenant_id, input.page_id, input.reservation_id))?.context.site.name).toBe(f.context.site.name);
    expect(await inputs().getInput("foreign", input.page_id, input.reservation_id)).toBeNull(); expect(await inputs().getVersionInput(input.tenant_id, "foreign", 1)).toBeNull();
  });
  it("rejects a receipt built from another context even after its hashes are self-consistent", async () => {
    const input = await command(); await inputs().captureInput(input); const changed = structuredClone(f.context); changed.site.current_year++;
    const compiled = await compileDoorV44Page(f.spec, changed); expect(compiled.ok).toBe(true); if (!compiled.ok) throw new Error();
    await expect(versions().registerVersion(registerInput(input, compiled.receipt))).rejects.toMatchObject({ code: "DOOR_VERSION_CONFLICT" }); expect(readDevDb().door_page_version_catalog[0].versions).toEqual([]);
  });
  it("binds both pristine and proof-injected actual compiler contexts without changing saved originals", async () => {
    const input = await command(); const stored = await inputs().captureInput(input);
    const context = structuredClone(f.context); context.validation.input_hashes.build_provenance_sha256 = "a".repeat(64);
    const compiled = await compileDoorV44Page(f.spec, context); expect(compiled.ok).toBe(true); if (!compiled.ok) throw new Error();
    // Synthetic proof hash tests the context equation only, not observed artifact attestation.
    expect(verifyDoorPageVersionInputReceipt(stored, compiled.receipt).ok).toBe(true);
    for (const field of ["context_before_provenance_sha256", "compiler_context_sha256", "source_records_sha256", "fact_records_sha256", "asset_records_sha256", "schema_sha256", "spec_sha256"]) {
      const changed = structuredClone(compiled.receipt); changed.input_hashes[field] = "0".repeat(64); expect(verifyDoorPageVersionInputReceipt(stored, changed).ok, field).toBe(false);
    }
    expect((await inputs().getInput(input.tenant_id, input.page_id, input.reservation_id))?.context).toEqual(f.context);
  });
  it.each(["missing", "hash", "duplicate"])("refuses %s snapshot corruption without overwriting evidence", async (kind) => {
    const input = await command(); await inputs().captureInput(input); const db = JSON.parse(readFileSync(file, "utf8"));
    if (kind === "missing") delete db.door_page_version_inputs; if (kind === "hash") db.door_page_version_inputs[0].input_sha256 = "0".repeat(64); if (kind === "duplicate") db.door_page_version_inputs.push(db.door_page_version_inputs[0]);
    writeFileSync(file, JSON.stringify(db)); const bytes = readFileSync(file, "utf8");
    await expect(inputs().getInput(input.tenant_id, input.page_id, input.reservation_id)).rejects.toMatchObject({ code: "DOOR_INPUT_CORRUPT" }); expect(readFileSync(file, "utf8")).toBe(bytes);
  });
  it("rejects prototype/getter wire payloads without executing inherited getters", async () => {
    const input = await command(); const r = (await versions().getReservation(input.tenant_id, input.page_id, "input_fixture"))!; const wire = prepareDoorPageVersionInput(input, r).wire;
    const getter = vi.fn(() => wire.payload_json); const bad = { ...wire } as Partial<DoorPageVersionInputWire>; delete bad.payload_json;
    Object.setPrototypeOf(bad, Object.defineProperty({}, "payload_json", { get: getter }));
    expect(() => decodeDoorPageVersionInput(bad, r)).toThrow("DOOR_INPUT_CORRUPT"); expect(getter).not.toHaveBeenCalled();
  });
  it("detects deletion of one captured version while another remains and prevents recapture", async () => {
    const input = await command(); await inputs().captureInput(input);
    const second = await versions().reserveVersion({ tenant_id: input.tenant_id, page_id: input.page_id, canonical_intent_id: f.spec.identity.canonical_intent_id, canonical_url: receipt.canonical_url, operation_id: "second", expected_latest_version: 1, actor: input.actor, reason: input.reason, at });
    const secondInput = structuredClone(input); (secondInput.spec as typeof f.spec).identity.page_version = 2; secondInput.reservation_id = second.reservation_id; await inputs().captureInput(secondInput);
    const db = JSON.parse(readFileSync(file, "utf8")); db.door_page_version_inputs.shift(); writeFileSync(file, JSON.stringify(db)); const bytes = readFileSync(file, "utf8");
    await expect(inputs().getVersionInput(input.tenant_id, input.page_id, 2)).rejects.toMatchObject({ code: "DOOR_INPUT_CORRUPT" });
    await expect(inputs().captureInput(input)).rejects.toMatchObject({ code: "DOOR_INPUT_CORRUPT" }); expect(readFileSync(file, "utf8")).toBe(bytes);
  });
  it.each(["actor", "reason", "captured_at", "missing_audit", "duplicate_audit", "foreign_audit"])("rejects %s audit substitution", async (field) => {
    const input = await command(); await inputs().captureInput(input); const db = JSON.parse(readFileSync(file, "utf8"));
    if (["actor", "reason", "captured_at"].includes(field)) db.door_page_version_inputs[0][field] = field === "captured_at" ? "2026-09-14T20:00:00Z" : "forged";
    if (field === "missing_audit") db.admin_audit.pop(); if (field === "duplicate_audit") db.admin_audit.push(db.admin_audit[1]);
    if (field === "foreign_audit") { const detail = JSON.parse(db.admin_audit[1].detail); detail.tenant_id = "foreign"; db.admin_audit[1].detail = JSON.stringify(detail); }
    writeFileSync(file, JSON.stringify(db)); await expect(inputs().getInput(input.tenant_id, input.page_id, input.reservation_id)).rejects.toMatchObject({ code: "DOOR_INPUT_CORRUPT" });
  });
});

describe("configured input adapter", () => {
  it("snapshots spec and schema references before awaiting a configured provider", async () => {
    const input = await command(); const r = (await versions().getReservation(input.tenant_id, input.page_id, "input_fixture"))!;
    const expected = prepareDoorPageVersionInput(input, r); let release!: (v: unknown) => void;
    const deferred = new Promise((resolve) => { release = resolve; });
    const client = { from: () => ({ select: () => ({ eq: () => ({ eq: () => deferred }) }) }), rpc: async (_name: string, args: {p_input: DoorPageVersionInputWire}) => ({ data: args.p_input, error: null }) } as unknown as SupabaseClient;
    const pending = doorPageVersionInputStore(() => client).captureInput(input);
    (input.spec as typeof f.spec).head.page.title = "Changed after await"; (input.context.validation.schema_bundle[0] as Record<string, unknown>).additionalProperties = true;
    release({ data: [r], error: null }); const actual = await pending; expect(actual).toEqual(expected.record);
  });
  it("never falls back after client construction or RPC failure", async () => {
    expect(() => doorPageVersionInputStore(() => { throw new Error("down"); })).toThrow("DOOR_INPUT_UNAVAILABLE");
    const input = await command(); const r = (await versions().getReservation(input.tenant_id, input.page_id, "input_fixture"))!;
    const client = { from: () => ({ select: () => ({ eq: () => ({ eq: async () => ({ data: [r], error: null }) }) }) }), rpc: async () => ({ data: null, error: { message: "unavailable" } }) } as unknown as SupabaseClient;
    const bytes = readFileSync(file, "utf8"); await expect(doorPageVersionInputStore(() => client).captureInput(input)).rejects.toMatchObject({ code: "DOOR_INPUT_UNAVAILABLE" }); expect(readFileSync(file, "utf8")).toBe(bytes);
  });
  it("rejects changed self-consistent RPC results", async () => {
    const input = await command(); const r = (await versions().getReservation(input.tenant_id, input.page_id, "input_fixture"))!;
    const wire = prepareDoorPageVersionInput({ ...input, actor: "different" }, r).wire;
    const client = { from: () => ({ select: () => ({ eq: () => ({ eq: async () => ({ data: [r], error: null }) }) }) }), rpc: async () => ({ data: wire, error: null }) } as unknown as SupabaseClient;
    await expect(doorPageVersionInputStore(() => client).captureInput(input)).rejects.toMatchObject({ code: "DOOR_INPUT_CORRUPT" });
  });
});
