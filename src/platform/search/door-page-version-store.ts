import { z } from "zod";
import { serviceClientProvider, type PlatformClientProvider } from "@/platform/db/client";
import { readDevDb, updateDevDbAtomic, type DevDb } from "@/platform/stores/dev-db";
import { checkDoorPageVersionInputs } from "./door-page-version-input-store";
import { verifyDoorPageVersionInputReceipt } from "@/domain/search/door-v44/page-version-input";
import { doorV44Hash } from "@/domain/search/door-v44/schema-engine";
import { DoorPageVersionError, doorPageCatalogSchema, doorPageIdentitySchema, doorPageReserveSchema, doorPageReservationSchema, doorPageRegisterSchema, doorPageVersionSchema, parseDoorVersion, type DoorPageVersionCatalog, type DoorPageVersionStore, type DoorPageVersionReservation } from "@/domain/search/door-v44/page-version";
export { DoorPageVersionError, doorPageVersionMetadata } from "@/domain/search/door-v44/page-version";
export type { DoorPageVersionStore } from "@/domain/search/door-v44/page-version";

const fail = (code: "DOOR_VERSION_CONFLICT" | "DOOR_VERSION_CORRUPT"): never => { throw new DoorPageVersionError(code); };
const same = (a: unknown, b: unknown) => doorV44Hash(a) === doorV44Hash(b);
const identity = (r: { tenant_id: string; page_id: string }) => `${r.tenant_id}/${r.page_id}`;
function expectedReservation(input: import("@/domain/search/door-v44/page-version").DoorPageReserveInput) {
  const { at, ...rest } = input;
  return { ...rest, reservation_id: doorV44Hash({ tenant_id: input.tenant_id, page_id: input.page_id, operation_id: input.operation_id }), canonical_path: new URL(input.canonical_url).pathname, page_version: input.expected_latest_version + 1, reserved_at: at };
}
function checkCatalog(db: DevDb): DoorPageVersionCatalog {
  if (db.door_page_version_catalog.length > 1 || (!db.door_page_version_catalog.length && db.admin_audit.some((a) => a.action.startsWith("door_page_version_")))) fail("DOOR_VERSION_CORRUPT");
  const c = parseDoorVersion(doorPageCatalogSchema, db.door_page_version_catalog[0] ?? { schema_version: 1, identities: [], reservations: [], versions: [] }, "DOOR_VERSION_CORRUPT");
  const keys = new Set<string>(); const paths = new Set<string>(); const intents = new Set<string>(); const operations = new Set<string>(); const reservations = new Map<string, DoorPageVersionReservation>(); const versions = new Set<string>();
  for (const i of c.identities) {
    if (keys.has(identity(i)) || paths.has(`${i.tenant_id}/${i.canonical_path}`) || intents.has(`${i.tenant_id}/${i.canonical_intent_id}`) || new URL(i.canonical_url).pathname !== i.canonical_path) fail("DOOR_VERSION_CORRUPT");
    keys.add(identity(i)); paths.add(`${i.tenant_id}/${i.canonical_path}`); intents.add(`${i.tenant_id}/${i.canonical_intent_id}`);
  }
  for (const r of c.reservations) {
    const i = c.identities.find((v) => identity(v) === identity(r)); const op = `${identity(r)}/${r.operation_id}`; const ver = `${identity(r)}/${r.page_version}`;
    if (!i || reservations.has(r.reservation_id) || operations.has(op) || versions.has(ver) || r.page_version !== r.expected_latest_version + 1 || r.page_version > i.latest_version || r.reservation_id !== doorV44Hash({ tenant_id: r.tenant_id, page_id: r.page_id, operation_id: r.operation_id }) || r.canonical_url !== i.canonical_url || r.canonical_path !== i.canonical_path || r.canonical_intent_id !== i.canonical_intent_id) fail("DOOR_VERSION_CORRUPT");
    reservations.set(r.reservation_id, r); operations.add(op); versions.add(ver);
  }
  for (const i of c.identities) if (c.reservations.filter((r) => identity(r) === identity(i)).length !== i.latest_version) fail("DOOR_VERSION_CORRUPT");
  versions.clear();
  for (const v of c.versions) {
    const r = reservations.get(v.reservation_id); const key = `${identity(v)}/${v.page_version}`; const p = v.metadata.receipt;
    if (!r || versions.has(key) || identity(v) !== identity(r) || v.page_version !== r.page_version || identity(p) !== identity(r) || p.page_version !== r.page_version || p.canonical_url !== r.canonical_url || p.canonical_intent_id !== r.canonical_intent_id) fail("DOOR_VERSION_CORRUPT");
    versions.add(key);
  }
  checkDoorPageVersionInputs(db);
  return c;
}
function fileRead() { try { return checkCatalog(readDevDb()); } catch (e) { if (e instanceof DoorPageVersionError) throw e; throw new DoorPageVersionError("DOOR_VERSION_CORRUPT"); } }
function mutate<T>(fn: (c: DoorPageVersionCatalog, db: DevDb) => T): Promise<T> {
  try { return Promise.resolve(updateDevDbAtomic((db) => { const c = checkCatalog(db); const result = fn(c, db); db.door_page_version_catalog = [c]; checkCatalog(db); return result; })); } catch (e) { return Promise.reject(e instanceof DoorPageVersionError ? e : new DoorPageVersionError("DOOR_VERSION_CORRUPT")); }
}
const scoped = (tenant_id: string, page_id: string) => parseDoorVersion(doorPageIdentitySchema.pick({ tenant_id: true, page_id: true }), { tenant_id, page_id });

/** Authenticated admin discovery only. Exact counts detect truncated/default-limit
 * responses and changing membership; this is not a public eligibility snapshot. */
export async function listDoorPageIdentities(tenantId: string, provider: PlatformClientProvider = serviceClientProvider): Promise<DoorPageVersionCatalog["identities"]> {
  parseDoorVersion(doorPageIdentitySchema.shape.tenant_id, tenantId);
  let client: ReturnType<PlatformClientProvider>;
  try { client = provider(); } catch { throw new DoorPageVersionError("DOOR_VERSION_UNAVAILABLE"); }
  const schema = doorPageCatalogSchema.shape.identities;
  const validate = (raw: unknown) => {
    const rows = parseDoorVersion(schema, raw, "DOOR_VERSION_CORRUPT");
    if (rows.some(r => r.tenant_id !== tenantId || new URL(r.canonical_url).pathname !== r.canonical_path)
      || new Set(rows.map(r => r.page_id)).size !== rows.length || new Set(rows.map(r => r.canonical_path)).size !== rows.length
      || new Set(rows.map(r => r.canonical_intent_id)).size !== rows.length) fail("DOOR_VERSION_CORRUPT");
    return rows;
  };
  if (!client) return validate(fileRead().identities.filter(r => r.tenant_id === tenantId)).sort((a, b) => a.page_id < b.page_id ? -1 : a.page_id > b.page_id ? 1 : 0);
  const pageSize = 250, maxRows = 10000;
  try {
    const rows: DoorPageVersionCatalog["identities"] = [];
    let total: number | null = null;
    for (let offset = 0; total === null || offset < total; offset += pageSize) {
      const { data, error, count } = await client.from("door_page_identity")
        .select("tenant_id,page_id,canonical_intent_id,canonical_url,canonical_path,latest_version", { count: "exact" })
        .eq("tenant_id", tenantId).order("page_id", { ascending: true }).range(offset, offset + pageSize - 1);
      if (error) throw new DoorPageVersionError("DOOR_VERSION_UNAVAILABLE");
      if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0 || (total !== null && count !== total)) throw new DoorPageVersionError("DOOR_VERSION_CORRUPT");
      if (count > maxRows) throw new DoorPageVersionError("DOOR_VERSION_UNAVAILABLE");
      total = count;
      const page = validate(data);
      if (page.length !== Math.min(pageSize, total - offset)) fail("DOOR_VERSION_CORRUPT");
      rows.push(...page);
    }
    const final = await client.from("door_page_identity").select("page_id", { count: "exact", head: true }).eq("tenant_id", tenantId);
    if (final.error) throw new DoorPageVersionError("DOOR_VERSION_UNAVAILABLE");
    if (final.count !== total || rows.length !== total) fail("DOOR_VERSION_CORRUPT");
    return validate(rows).sort((a, b) => a.page_id < b.page_id ? -1 : a.page_id > b.page_id ? 1 : 0);
  } catch (e) { if (e instanceof DoorPageVersionError) throw e; throw new DoorPageVersionError("DOOR_VERSION_UNAVAILABLE"); }
}

/** Internal elevated store. A configured client's failure is an error, never a file-store fallback. */
export function doorPageVersionStore(provider: PlatformClientProvider = serviceClientProvider): DoorPageVersionStore {
  let client: ReturnType<PlatformClientProvider>;
  try { client = provider(); } catch { throw new DoorPageVersionError("DOOR_VERSION_UNAVAILABLE"); }
  async function rpc<T>(name: string, input: unknown, schema: z.ZodType<T>): Promise<T> {
    try { const result = await client!.rpc(name, { p_input: input }); if (result.error) { const m = result.error.message; throw new DoorPageVersionError(m.includes("DOOR_VERSION_CONFLICT") ? "DOOR_VERSION_CONFLICT" : m.includes("DOOR_VERSION_INVALID") ? "DOOR_VERSION_INVALID" : "DOOR_VERSION_UNAVAILABLE"); } return parseDoorVersion(schema, result.data, "DOOR_VERSION_CORRUPT"); }
    catch (e) { if (e instanceof DoorPageVersionError) throw e; throw new DoorPageVersionError("DOOR_VERSION_UNAVAILABLE"); }
  }
  async function rows<T extends {tenant_id: string; page_id: string}>(table: string, tenantId: string, pageId: string, schema: z.ZodType<T>): Promise<T[]> {
    try { const { data, error } = await client!.from(table).select("*").eq("tenant_id", tenantId).eq("page_id", pageId); if (error) throw error; const parsed = parseDoorVersion(z.array(schema), data, "DOOR_VERSION_CORRUPT"); if (parsed.some((r) => r.tenant_id !== tenantId || r.page_id !== pageId)) fail("DOOR_VERSION_CORRUPT"); return parsed; } catch (e) { if (e instanceof DoorPageVersionError) throw e; throw new DoorPageVersionError("DOOR_VERSION_UNAVAILABLE"); }
  }
  return {
    async reserveVersion(raw) {
      const input = parseDoorVersion(doorPageReserveSchema, raw);
      if (client) { const row = await rpc("reserve_door_page_version", input, doorPageReservationSchema); if (!same(row, expectedReservation(input))) fail("DOOR_VERSION_CORRUPT"); return row; }
      return mutate((c, db) => {
        const old = c.reservations.find((r) => identity(r) === identity(input) && r.operation_id === input.operation_id);
        const row = expectedReservation(input);
        if (old) { if (!same(old, row)) fail("DOOR_VERSION_CONFLICT"); return old; }
        const prior = c.identities.find((r) => identity(r) === identity(input));
        if (prior ? prior.latest_version !== input.expected_latest_version || prior.canonical_url !== input.canonical_url || prior.canonical_intent_id !== input.canonical_intent_id : input.expected_latest_version !== 0 || c.identities.some((r) => r.tenant_id === input.tenant_id && (r.canonical_path === row.canonical_path || r.canonical_intent_id === input.canonical_intent_id))) fail("DOOR_VERSION_CONFLICT");
        if (prior) prior.latest_version = row.page_version; else c.identities.push({ tenant_id: input.tenant_id, page_id: input.page_id, canonical_intent_id: input.canonical_intent_id, canonical_url: input.canonical_url, canonical_path: row.canonical_path, latest_version: row.page_version });
        c.reservations.push(row); db.admin_audit.push({ at: input.at, action: "door_page_version_reserved", target: input.page_id, detail: JSON.stringify(row) }); return row;
      });
    },
    async getReservation(tenantId, pageId, operationId) {
      scoped(tenantId, pageId); parseDoorVersion(doorPageReserveSchema.shape.operation_id, operationId);
      const all = client ? await rows("door_page_version_reservation", tenantId, pageId, doorPageReservationSchema) : fileRead().reservations.filter((r) => r.tenant_id === tenantId && r.page_id === pageId);
      if (new Set(all.map((r) => r.operation_id)).size !== all.length || all.some((r) => { const { reserved_at, reservation_id: _id, canonical_path: _path, page_version: _version, ...rest } = r; void _id; void _path; void _version; return !same(r, expectedReservation({ ...rest, at: reserved_at })); })) fail("DOOR_VERSION_CORRUPT");
      return all.find((r) => r.operation_id === operationId) ?? null;
    },
    async registerVersion(raw) {
      const input = parseDoorVersion(doorPageRegisterSchema, raw);
      if (client) { const row = await rpc("register_door_page_version", input, doorPageVersionSchema); const { at: registered_at, ...rest } = input; if (!same(row, { ...rest, page_version: input.metadata.receipt.page_version, registered_at })) fail("DOOR_VERSION_CORRUPT"); return row; }
      return mutate((c, db) => {
        const r = c.reservations.find((v) => v.reservation_id === input.reservation_id && identity(v) === identity(input)); const p = input.metadata.receipt;
        if (!r) throw new DoorPageVersionError("DOOR_VERSION_CONFLICT");
        if (identity(p) !== identity(r) || p.page_version !== r.page_version || p.canonical_intent_id !== r.canonical_intent_id || p.canonical_url !== r.canonical_url) fail("DOOR_VERSION_CONFLICT");
        const captured = checkDoorPageVersionInputs(db).find((v) => v.reservation_id === r.reservation_id);
        if (captured && !verifyDoorPageVersionInputReceipt(captured, p).ok) fail("DOOR_VERSION_CONFLICT");
        const { at: registered_at, ...rest } = input; const row = { ...rest, page_version: r.page_version, registered_at }; const old = c.versions.find((v) => v.reservation_id === r.reservation_id);
        if (old) { if (!same(old, row)) fail("DOOR_VERSION_CONFLICT"); return old; }
        c.versions.push(row); db.admin_audit.push({ at: input.at, action: "door_page_version_registered", target: input.page_id, detail: JSON.stringify(row) }); return row;
      });
    },
    async getVersion(tenantId, pageId, version) { parseDoorVersion(doorPageVersionSchema.shape.page_version, version); return (await this.listVersions(tenantId, pageId)).find((r) => r.page_version === version) ?? null; },
    async listVersions(tenantId, pageId) { scoped(tenantId, pageId); const all = client ? await rows("door_page_version", tenantId, pageId, doorPageVersionSchema) : fileRead().versions.filter((r) => r.tenant_id === tenantId && r.page_id === pageId); if (new Set(all.map((r) => r.page_version)).size !== all.length || all.some((r) => r.metadata.receipt.tenant_id !== tenantId || r.metadata.receipt.page_id !== pageId || r.metadata.receipt.page_version !== r.page_version)) fail("DOOR_VERSION_CORRUPT"); return all.sort((a, b) => a.page_version - b.page_version); },
  };
}
