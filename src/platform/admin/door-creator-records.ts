import { z } from "zod";
import { DEFAULT_TENANT_ID } from "@/domain/problem/contracts";
import { serviceClientProvider, type PlatformClientProvider } from "@/platform/db/client";
import { DoorPageVersionError, doorPageIdentitySchema, doorPageReservationSchema, doorPageVersionSchema, parseDoorVersion, type DoorPageVersion, type DoorPageVersionReservation } from "@/domain/search/door-v44/page-version";
import { DOOR_PAGE_INPUT_MAX_BYTES, decodeDoorPageVersionInput, verifyDoorPageVersionInputReceipt, type DoorPageVersionInputRecord } from "@/domain/search/door-v44/page-version-input";
import { parseDoorEvidenceReceipt, type DoorEvidenceReceipt } from "@/domain/search/door-v44/release-evidence";
import { doorV44Hash, isPlainDoorJson } from "@/domain/search/door-v44/schema-engine";
import { doorPageVersionStore } from "@/platform/search/door-page-version-store";
import { doorPageVersionInputStore } from "@/platform/search/door-page-version-input-store";
import { doorPageEvidenceStore } from "@/platform/search/door-page-evidence-store";

export interface DoorCreatorRecords {
  versions(pageId: string): Promise<DoorPageVersion[]>;
  version(pageId: string, version: number): Promise<DoorPageVersion | null>;
  input(pageId: string, version: number): Promise<DoorPageVersionInputRecord | null>;
  evidence(pageId: string, version: number): Promise<DoorEvidenceReceipt[]>;
}
const corrupt = (): never => { throw new DoorPageVersionError("DOOR_VERSION_CORRUPT"); };
const unavailable = (): never => { throw new DoorPageVersionError("DOOR_VERSION_UNAVAILABLE"); };
const scope = (page: string, version?: number) => {
  parseDoorVersion(doorPageIdentitySchema.shape.page_id, page);
  if (version !== undefined) parseDoorVersion(doorPageVersionSchema.shape.page_version, version);
};
const columns = {
  door_page_version: "tenant_id,page_id,page_version,reservation_id,metadata,actor,reason,registered_at",
  door_page_version_reservation: "reservation_id,tenant_id,page_id,canonical_intent_id,canonical_url,canonical_path,page_version,operation_id,expected_latest_version,actor,reason,reserved_at",
  door_page_version_input: "tenant_id,page_id,page_version,reservation_id,payload_json,input_sha256,spec_sha256,context_sha256,schema_sha256,source_records_sha256,fact_records_sha256,asset_records_sha256,actor,reason,captured_at",
  door_page_evidence: "receipt",
} as const;
type Table = keyof typeof columns;
function plainRow(value: unknown, table: Table): boolean {
  if (table !== "door_page_version_input") return isPlainDoorJson(value);
  // The wire is a small strict object around a separately bounded canonical
  // payload. The general JSON gate's 1M string bound is too small for that wire.
  if (!value || typeof value !== "object" || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Object.getOwnPropertySymbols(value).length) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (!descriptors.payload_json || !("value" in descriptors.payload_json) || typeof descriptors.payload_json.value !== "string"
    || Buffer.byteLength(descriptors.payload_json.value, "utf8") > DOOR_PAGE_INPUT_MAX_BYTES) return false;
  const small: Record<string, unknown> = Object.create(null);
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!("value" in descriptor) || !descriptor.enumerable) return false;
    small[key] = key === "payload_json" ? null : descriptor.value;
  }
  return isPlainDoorJson(small);
}

/** Fixed-tenant authenticated read model. No new trust or release authority.
 * Counted lists are bounded to 10,000 records/64MiB and fail on truncation.
 * Identity/history membership is checked across reads, not claimed transactional. */
export function doorCreatorRecords(provider: PlatformClientProvider = serviceClientProvider): DoorCreatorRecords {
  let client: ReturnType<PlatformClientProvider>;
  try { client = provider(); } catch { return unavailable(); }
  const files = !client ? { versions: doorPageVersionStore(() => null), inputs: doorPageVersionInputStore(() => null), evidence: doorPageEvidenceStore(() => null) } : null;
  async function read(table: Table, page: string, order: string, version?: number, exact = false): Promise<unknown[]> {
    const pageSize = exact ? 2 : 250, maximum = exact ? 1 : 10000;
    const rows: unknown[] = []; let total: number | null = null, bytes = 0;
    try {
      for (let offset = 0; total === null || offset < total; offset += pageSize) {
        let query = client!.from(table).select(columns[table], { count: "exact" }).eq("tenant_id", DEFAULT_TENANT_ID).eq("page_id", page);
        if (version !== undefined) query = query.eq("page_version", version);
        const { data, error, count } = await query.order(order, { ascending: true }).range(offset, offset + pageSize - 1);
        if (error) return unavailable();
        if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0 || (total !== null && total !== count)) return corrupt();
        if (count > maximum) { if (exact) return corrupt(); return unavailable(); }
        if (!Array.isArray(data) || data.length !== Math.min(pageSize, count - offset)) return corrupt();
        total = count;
        for (const value of data) {
          if (!plainRow(value, table)) return corrupt();
          bytes += Buffer.byteLength(JSON.stringify(value), "utf8");
          if (bytes > 64 * 1024 * 1024) return unavailable();
          rows.push(value);
        }
      }
      if (!exact) {
        let query = client!.from(table).select(order, { count: "exact", head: true }).eq("tenant_id", DEFAULT_TENANT_ID).eq("page_id", page);
        if (version !== undefined) query = query.eq("page_version", version);
        const final = await query;
        if (final.error) return unavailable();
        if (final.count !== total || rows.length !== total) return corrupt();
      }
      return rows;
    } catch (e) { if (e instanceof DoorPageVersionError) throw e; return unavailable(); }
  }
  function parsedVersion(raw: unknown, page: string, expected?: number): DoorPageVersion {
    const row = parseDoorVersion(doorPageVersionSchema, raw, "DOOR_VERSION_CORRUPT"), receipt = row.metadata.receipt;
    if (row.tenant_id !== DEFAULT_TENANT_ID || row.page_id !== page || (expected !== undefined && row.page_version !== expected)
      || receipt.tenant_id !== DEFAULT_TENANT_ID || receipt.page_id !== page || receipt.page_version !== row.page_version) return corrupt();
    return row;
  }
  async function binding(page: string, version: number): Promise<{ version: DoorPageVersion | null; reservation: DoorPageVersionReservation | null }> {
    const [versions, reservations] = await Promise.all([read("door_page_version", page, "page_version", version, true), read("door_page_version_reservation", page, "page_version", version, true)]);
    const v = versions.length ? parsedVersion(versions[0], page, version) : null;
    const r = reservations.length ? parseDoorVersion(doorPageReservationSchema, reservations[0], "DOOR_VERSION_CORRUPT") : null;
    if (r && (r.tenant_id !== DEFAULT_TENANT_ID || r.page_id !== page || r.page_version !== version || r.page_version !== r.expected_latest_version + 1
      || r.canonical_path !== new URL(r.canonical_url).pathname || r.reservation_id !== doorV44Hash({ tenant_id: r.tenant_id, page_id: r.page_id, operation_id: r.operation_id }))) return corrupt();
    if (v && (!r || v.reservation_id !== r.reservation_id || v.metadata.receipt.canonical_intent_id !== r.canonical_intent_id || v.metadata.receipt.canonical_url !== r.canonical_url)) return corrupt();
    return { version: v, reservation: r };
  }
  async function captured(page: string, version: number, known: Awaited<ReturnType<typeof binding>>): Promise<DoorPageVersionInputRecord | null> {
    const rows = await read("door_page_version_input", page, "page_version", version, true);
    if (!rows.length) return null;
    try {
      if (!known.reservation) return corrupt();
      const value = decodeDoorPageVersionInput(rows[0], known.reservation);
      if (value.tenant_id !== DEFAULT_TENANT_ID || value.page_id !== page || value.page_version !== version || (known.version && !verifyDoorPageVersionInputReceipt(value, known.version.metadata.receipt).ok)) return corrupt();
      return value;
    } catch { return corrupt(); }
  }
  return {
    async versions(page) {
      scope(page); if (files) return files.versions.listVersions(DEFAULT_TENANT_ID, page);
      const rows = (await read("door_page_version", page, "page_version")).map(raw => parsedVersion(raw, page));
      if (new Set(rows.map(r => r.page_version)).size !== rows.length || new Set(rows.map(r => r.reservation_id)).size !== rows.length) return corrupt();
      return rows.sort((a, b) => a.page_version - b.page_version);
    },
    async version(page, version) { scope(page, version); if (files) return files.versions.getVersion(DEFAULT_TENANT_ID, page, version); return (await binding(page, version)).version; },
    async input(page, version) { scope(page, version); if (files) return files.inputs.getVersionInput(DEFAULT_TENANT_ID, page, version); return captured(page, version, await binding(page, version)); },
    async evidence(page, version) {
      scope(page, version); if (files) return files.evidence.listReceipts(DEFAULT_TENANT_ID, page, version);
      let rows: DoorEvidenceReceipt[];
      try { rows = (await read("door_page_evidence", page, "receipt_sha256", version)).map(raw => parseDoorEvidenceReceipt(parseDoorVersion(z.object({ receipt: z.unknown() }).strict(), raw, "DOOR_VERSION_CORRUPT").receipt)); }
      catch (e) { if (e instanceof DoorPageVersionError) throw e; return corrupt(); }
      if (!rows.length) return [];
      const bound = await binding(page, version), input = await captured(page, version, bound);
      if (!bound.version || !input || new Set(rows.map(r => r.receipt_sha256)).size !== rows.length || rows.some(r => r.subject.tenant_id !== DEFAULT_TENANT_ID || r.subject.page_id !== page || r.subject.page_version !== version
        || r.subject.reservation_id !== bound.version!.reservation_id || r.subject.compile_receipt_sha256 !== bound.version!.metadata.receipt_sha256 || r.subject.artifact_hash !== bound.version!.metadata.receipt.artifact_hash || r.subject.input_sha256 !== input.input_sha256)) return corrupt();
      return rows.sort((a, b) => a.receipt_sha256 < b.receipt_sha256 ? -1 : a.receipt_sha256 > b.receipt_sha256 ? 1 : 0);
    },
  };
}
