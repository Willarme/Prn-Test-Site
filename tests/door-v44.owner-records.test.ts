import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_TENANT_ID } from "@/domain/problem/contracts";
import { doorCreatorRecords } from "@/platform/admin/door-creator-records";
import { doorPageVersionStore } from "@/platform/search/door-page-version-store";
import { doorPageVersionInputStore } from "@/platform/search/door-page-version-input-store";
import { doorPageEvidenceStore } from "@/platform/search/door-page-evidence-store";
import { doorPageMetadataSchema, doorPageVersionSchema, type DoorPageVersion, type DoorPageVersionReservation } from "@/domain/search/door-v44/page-version";
import { prepareDoorPageVersionInput } from "@/domain/search/door-v44/page-version-input";
import { issueDoorEvidenceReceipt, type DoorEvidenceReceipt } from "@/domain/search/door-v44/release-evidence";
import { compileDoorV44Page } from "@/domain/search/door-v44/compiler";
import { doorV44Hash } from "@/domain/search/door-v44/schema-engine";
import { compilerFixture } from "./fixtures/door-v44/compiler-fixture";

// Synthetic compiler input and receipts exercise read integrity, never production
// approval. The 1001-row catalog is structurally valid history, not 1001 builds.
const at = "2026-09-13T20:00:00Z", H = "a".repeat(64);
const audit = { actor: "synthetic-test", reason: "Offline owner read fixture", at };
let f: Awaited<ReturnType<typeof compilerFixture>>, first: Bundle, high: Bundle;
type Bundle = { reservation: DoorPageVersionReservation; prepared: ReturnType<typeof prepareDoorPageVersionInput>; version: DoorPageVersion };
const temps: string[] = [];
async function bundle(number: number): Promise<Bundle> {
  const spec = structuredClone(f.spec); spec.identity.page_version = number;
  const identity = spec.identity, operation_id = `owner_fixture_${number}`;
  const reservation: DoorPageVersionReservation = { tenant_id: DEFAULT_TENANT_ID, page_id: identity.page_id, canonical_intent_id: identity.canonical_intent_id,
    canonical_url: new URL(identity.canonical_path, f.context.validation.origin).href, canonical_path: identity.canonical_path,
    page_version: number, expected_latest_version: number - 1, operation_id, reservation_id: doorV44Hash({ tenant_id: DEFAULT_TENANT_ID, page_id: identity.page_id, operation_id }),
    actor: audit.actor, reason: audit.reason, reserved_at: at };
  const prepared = prepareDoorPageVersionInput({ tenant_id: DEFAULT_TENANT_ID, page_id: identity.page_id, reservation_id: reservation.reservation_id,
    spec, context: f.context, model_provenance: { status: "fixture_no_model_calls", fixture_id: "owner_reader" }, ...audit }, reservation);
  const c = await compileDoorV44Page(spec, f.context); if (!c.ok) throw new Error(JSON.stringify(c.errors));
  const metadata = doorPageMetadataSchema.parse({ receipt: c.receipt, receipt_sha256: doorV44Hash(c.receipt), provenance_status: "unattested", build_provenance_sha256: null });
  return { reservation, prepared, version: { tenant_id: DEFAULT_TENANT_ID, page_id: identity.page_id, page_version: number, reservation_id: reservation.reservation_id, metadata,
    actor: audit.actor, reason: audit.reason, registered_at: at } };
}
function receipt(b: Bundle, index = 0): DoorEvidenceReceipt {
  return issueDoorEvidenceReceipt({ format: "door-v44-evidence/1.0.0", kind: "artifact_integrity",
    subject: { tenant_id: DEFAULT_TENANT_ID, page_id: b.version.page_id, page_version: b.version.page_version, reservation_id: b.version.reservation_id,
      input_sha256: b.prepared.record.input_sha256, artifact_hash: b.version.metadata.receipt.artifact_hash, compile_receipt_sha256: b.version.metadata.receipt_sha256 },
    producer: { id: "synthetic-owner-reader", version: "1", implementation_sha256: H, run_id: `fixture_${index}`, actor_id: "synthetic-test", actor_kind: "system", trust_scope: "synthetic_test" },
    environment: { id: "synthetic-test", manifest_sha256: H, commit: "a".repeat(40), origin: "https://fixture.example" }, dependencies: [],
    started_at: at, finished_at: "2026-09-13T20:01:00Z", expires_at: "2026-09-14T20:00:00Z", verdict: "PASS", findings: [], attachments: [],
    output: { artifact_read_verified: true, semantic_verified: true, input_verified: true } });
}
type Query = { table: string; columns: string; filters: Record<string, unknown>; head: boolean; range: [number, number] | null; order: string };
type Reply = { data: unknown[] | null; count: number | null; error: unknown };
type Tables = Record<string, unknown[]>;
function tables(b = high): Tables { return { door_page_version: [b.version], door_page_version_reservation: [b.reservation], door_page_version_input: [b.prepared.wire], door_page_evidence: [] }; }
function db(data: Tables, alter?: (reply: Reply, query: Query, call: number) => Reply) {
  const calls: Query[] = [];
  const client = { from(table: string) {
    const query: Query = { table, columns: "", filters: {}, head: false, range: null, order: "" };
    const chain = {
      select(columns: string, options?: { count?: string; head?: boolean }) { expect(options?.count).toBe("exact"); query.columns = columns; query.head = options?.head === true; return chain; },
      eq(key: string, value: unknown) { query.filters[key] = value; return chain; },
      order(key: string) { query.order = key; return chain; },
      range(from: number, to: number) { query.range = [from, to]; return chain; },
      then(fulfilled: (r: Reply) => unknown, rejected?: (e: unknown) => unknown) {
        const run = async () => {
          calls.push(structuredClone(query));
          const selected = (data[table] ?? []).filter(raw => { const row = raw as Record<string, unknown>; const keys = table === "door_page_evidence" ? (row.receipt as DoorEvidenceReceipt).subject : row;
            return Object.entries(query.filters).every(([key, value]) => (keys as Record<string, unknown>)[key] === value); });
          let rows = selected.slice();
          if (query.range) rows = rows.slice(query.range[0], query.range[1] + 1);
          // A missing bounded range simulates the real API's 1000-row default.
          else if (!query.head) rows = rows.slice(0, 1000);
          const reply: Reply = { data: query.head ? null : rows, count: selected.length, error: null };
          return alter ? alter(reply, query, calls.length) : reply;
        };
        return run().then(fulfilled, rejected);
      },
    }; return chain;
  } } as unknown as SupabaseClient;
  return { reader: doorCreatorRecords(() => client), calls };
}
beforeAll(async () => {
  f = await compilerFixture(); f.spec.identity.tenant_id = DEFAULT_TENANT_ID; f.context.validation.tenant_id = DEFAULT_TENANT_ID;
  for (const group of [f.context.validation.pages, f.context.validation.eligibilities, f.context.validation.visual_assets]) for (const row of group) row.tenant_id = DEFAULT_TENANT_ID;
  first = await bundle(1); high = await bundle(1001);
}, 20000);
afterEach(() => { vi.unstubAllEnvs(); for (const path of temps.splice(0)) { const checked = resolve(path); if (!checked.startsWith(resolve(tmpdir()) + sep) || !checked.includes("owner-records-")) throw new Error("Unsafe cleanup"); rmSync(checked, { recursive: true, force: true }); } });

describe("bounded owner catalog record reads", () => {
  it("reads genuine file-captured inputs, registered metadata and evidence without changing publication", async () => {
    const path = mkdtempSync(join(tmpdir(), "owner-records-")); temps.push(path); vi.stubEnv("PRN_DEV_DB_PATH", join(path, "db.json"));
    const v = doorPageVersionStore(() => null), i = doorPageVersionInputStore(() => null), e = doorPageEvidenceStore(() => null);
    const r = first.reservation;
    await v.reserveVersion({ tenant_id: r.tenant_id, page_id: r.page_id, canonical_intent_id: r.canonical_intent_id, canonical_url: r.canonical_url, operation_id: r.operation_id, expected_latest_version: 0, ...audit });
    const input = await i.captureInput({ tenant_id: r.tenant_id, page_id: r.page_id, reservation_id: r.reservation_id, spec: f.spec, context: f.context, model_provenance: { status: "fixture_no_model_calls", fixture_id: "owner_reader" }, ...audit });
    await v.registerVersion({ tenant_id: r.tenant_id, page_id: r.page_id, reservation_id: r.reservation_id, metadata: first.version.metadata, ...audit });
    const evidence = receipt(first); await e.appendReceipt(evidence);
    const reader = doorCreatorRecords(() => null);
    expect(await reader.versions(r.page_id)).toEqual([first.version]); expect(await reader.version(r.page_id, 1)).toEqual(first.version);
    expect(await reader.input(r.page_id, 1)).toEqual(input); expect(await reader.evidence(r.page_id, 1)).toEqual([evidence]);
    expect(await reader.version(r.page_id, 1001)).toBeNull(); expect(await reader.input(r.page_id, 1001)).toBeNull(); expect(await reader.evidence(r.page_id, 1001)).toEqual([]);
  });
  it("counts and returns all 1001 metadata versions in numeric order", async () => {
    const data = tables(); data.door_page_version = Array.from({ length: 1001 }, (_, n) => {
      const row = structuredClone(first.version); row.page_version = n + 1; row.metadata.receipt.page_version = n + 1;
      row.reservation_id = doorV44Hash({ tenant_id: DEFAULT_TENANT_ID, page_id: row.page_id, operation_id: `owner_fixture_${n + 1}` });
      row.metadata.receipt_sha256 = doorV44Hash(row.metadata.receipt); return doorPageVersionSchema.parse(row);
    });
    const { reader, calls } = db(data), rows = await reader.versions(high.version.page_id);
    expect(rows).toHaveLength(1001); expect(rows.at(-1)?.page_version).toBe(1001);
    expect(calls.filter(c => !c.head).map(c => c.range)).toEqual([[0, 249], [250, 499], [500, 749], [750, 999], [1000, 1249]]);
    expect(calls.at(-1)?.head).toBe(true);
  }, 20000);
  it("gets version and full input 1001 using exact filters, including its reservation", async () => {
    const { reader, calls } = db(tables());
    expect(await reader.version(high.version.page_id, 1001)).toEqual(high.version);
    expect(await reader.input(high.version.page_id, 1001)).toEqual(high.prepared.record);
    expect(calls.every(c => c.filters.page_version === 1001 && c.filters.tenant_id === DEFAULT_TENANT_ID && c.range?.[1] === 1)).toBe(true);
  });
  it("counts more than 1000 exact-version receipts and verifies their actual input binding", async () => {
    const data = tables(); data.door_page_evidence = Array.from({ length: 1001 }, (_, n) => ({ receipt: receipt(high, n) }));
    const { reader, calls } = db(data); expect(await reader.evidence(high.version.page_id, 1001)).toHaveLength(1001);
    expect(calls.filter(c => c.table === "door_page_evidence").every(c => c.filters.page_version === 1001)).toBe(true);
  }, 20000);
  it("distinguishes empty tables and reserved-but-not-built input from errors", async () => {
    const { reader } = db({}); expect(await reader.versions("absent")).toEqual([]); expect(await reader.version("absent", 1001)).toBeNull();
    expect(await reader.input("absent", 1001)).toBeNull(); expect(await reader.evidence("absent", 1001)).toEqual([]);
    const data = tables(); data.door_page_version = []; const reserved = db(data).reader;
    expect(await reserved.version(high.version.page_id, 1001)).toBeNull(); expect(await reserved.input(high.version.page_id, 1001)).toEqual(high.prepared.record);
  });
  it.each(["versions", "version", "input", "evidence"] as const)("configured %s errors never become empty file fallbacks", async method => {
    const { reader } = db(tables(), r => ({ ...r, error: { code: "42P01", message: "synthetic missing schema" } }));
    await expect(reader[method](high.version.page_id, 1001)).rejects.toMatchObject({ code: "DOOR_VERSION_UNAVAILABLE" });
  });
  it("does not swallow a throwing configured provider", () => { expect(() => doorCreatorRecords(() => { throw new Error("synthetic provider failure"); })).toThrow("DOOR_VERSION_UNAVAILABLE"); });
  it.each(["missing", "fractional", "truncated", "stale-final", "over-limit"])("refuses %s list counts", async mode => {
    const { reader } = db(tables(), (r, q) => mode === "missing" ? { ...r, count: null } : mode === "fractional" ? { ...r, count: 1.5 }
      : mode === "truncated" ? { ...r, data: [] } : mode === "stale-final" && q.head ? { ...r, count: 2 } : mode === "over-limit" ? { ...r, count: 10001 } : r);
    await expect(reader.versions(high.version.page_id)).rejects.toMatchObject({ code: mode === "over-limit" ? "DOOR_VERSION_UNAVAILABLE" : "DOOR_VERSION_CORRUPT" });
  });
  it("rejects a changed count during a multipage read", async () => {
    const data = tables(); data.door_page_evidence = Array.from({ length: 251 }, (_, n) => ({ receipt: receipt(high, n) }));
    const { reader } = db(data, (r, q) => q.range?.[0] === 250 ? { ...r, count: 252 } : r);
    await expect(reader.evidence(high.version.page_id, 1001)).rejects.toMatchObject({ code: "DOOR_VERSION_CORRUPT" });
  });
  it.each(["foreign-tenant", "foreign-page", "wrong-version", "bad-hash", "duplicate", "extra"])("rejects %s version rows", async mode => {
    const row = structuredClone(high.version);
    if (mode === "foreign-tenant") row.tenant_id = "foreign"; if (mode === "foreign-page") row.page_id = "foreign";
    if (mode === "wrong-version") row.page_version = 1000; if (mode === "bad-hash") row.metadata.receipt_sha256 = H;
    if (mode === "extra") Object.assign(row, { private_field: "synthetic" });
    const { reader } = db(tables(), (r, q) => q.table === "door_page_version" ? { ...r, count: mode === "duplicate" ? 2 : 1, data: mode === "duplicate" ? [row, row] : [row] } : r);
    await expect(reader.version(high.version.page_id, 1001)).rejects.toMatchObject({ code: "DOOR_VERSION_CORRUPT" });
  });
  it.each(["missing", "foreign", "hash", "canonical", "duplicate"])("rejects %s reservation bindings", async mode => {
    const r = structuredClone(high.reservation); if (mode === "foreign") r.tenant_id = "foreign"; if (mode === "hash") r.reservation_id = H;
    if (mode === "canonical") r.canonical_url = "https://fixture.example/problems/other-page";
    const { reader } = db(tables(), (reply, q) => q.table !== "door_page_version_reservation" ? reply : { ...reply, count: mode === "missing" ? 0 : mode === "duplicate" ? 2 : 1, data: mode === "missing" ? [] : mode === "duplicate" ? [r, r] : [r] });
    await expect(reader.version(high.version.page_id, 1001)).rejects.toMatchObject({ code: "DOOR_VERSION_CORRUPT" });
  });
  it.each(["wire-hash", "foreign", "receipt-context", "missing-reservation"])("rejects input %s corruption", async mode => {
    const data = tables(); const wire = structuredClone(high.prepared.wire);
    if (mode === "wire-hash") wire.input_sha256 = H; if (mode === "foreign") wire.tenant_id = "foreign";
    if (mode === "receipt-context") { const v = structuredClone(high.version); v.metadata.receipt.input_hashes.compiler_context_sha256 = H; v.metadata.receipt_sha256 = doorV44Hash(v.metadata.receipt); data.door_page_version = [v]; }
    if (mode === "missing-reservation") data.door_page_version_reservation = [];
    const { reader } = db(data, (r, q) => q.table === "door_page_version_input" ? { ...r, data: [wire], count: 1 } : r);
    await expect(reader.input(high.version.page_id, 1001)).rejects.toMatchObject({ code: "DOOR_VERSION_CORRUPT" });
  });
  it("rejects payload accessors without executing them", async () => {
    const raw = { ...high.prepared.wire }; const getter = vi.fn(() => high.prepared.wire.payload_json); Object.defineProperty(raw, "payload_json", { enumerable: true, get: getter });
    const { reader } = db(tables(), (r, q) => q.table === "door_page_version_input" ? { ...r, data: [raw] } : r);
    await expect(reader.input(high.version.page_id, 1001)).rejects.toMatchObject({ code: "DOOR_VERSION_CORRUPT" }); expect(getter).not.toHaveBeenCalled();
  });
  it.each(["hash", "foreign", "input", "compile", "artifact", "duplicate", "missing-input"])("rejects evidence %s mismatches", async mode => {
    const data = tables(); const original = receipt(high); const { receipt_sha256: omitted, ...payload } = original; void omitted;
    if (mode === "foreign") payload.subject.tenant_id = "foreign"; if (mode === "input") payload.subject.input_sha256 = H;
    if (mode === "compile") payload.subject.compile_receipt_sha256 = H; if (mode === "artifact") payload.subject.artifact_hash = H;
    const r = issueDoorEvidenceReceipt(payload); if (mode === "hash") r.receipt_sha256 = H; if (mode === "missing-input") data.door_page_version_input = [];
    const response = mode === "duplicate" ? [{ receipt: r }, { receipt: r }] : [{ receipt: r }];
    const { reader } = db(data, (reply, q) => q.table === "door_page_evidence" ? { ...reply, count: response.length, data: q.head ? null : response } : reply);
    await expect(reader.evidence(high.version.page_id, 1001)).rejects.toMatchObject({ code: "DOOR_VERSION_CORRUPT" });
  });
  it("rejects unsafe requested scopes before querying", async () => {
    const { reader, calls } = db(tables()); await expect(reader.versions("../foreign")).rejects.toMatchObject({ code: "DOOR_VERSION_INVALID" });
    await expect(reader.input(high.version.page_id, 1.5)).rejects.toMatchObject({ code: "DOOR_VERSION_INVALID" }); expect(calls).toEqual([]);
  });
});
