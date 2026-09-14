import type { PlatformClientProvider } from "@/platform/db/client";
import { serviceClientProvider } from "@/platform/db/client";
import { readDevDb, updateDevDbAtomic, type DevDb } from "@/platform/stores/dev-db";
import { doorV44Hash } from "@/domain/search/door-v44/schema-engine";
import { doorPageReservationSchema, parseDoorVersion, type DoorPageVersionReservation } from "@/domain/search/door-v44/page-version";
import { decodeDoorPageVersionInput, DoorPageVersionInputError, parseDoorPageCaptureInput, prepareDoorPageVersionInput, verifyDoorPageVersionInputReceipt, type DoorPageVersionInputRecord, type DoorPageVersionInputStore } from "@/domain/search/door-v44/page-version-input";
export { DoorPageVersionInputError } from "@/domain/search/door-v44/page-version-input";
export type { DoorPageVersionInputStore } from "@/domain/search/door-v44/page-version-input";

/** Validate all companion records under the same local transaction as catalogue mutation. */
export function checkDoorPageVersionInputs(db: DevDb): DoorPageVersionInputRecord[] {
  try {
    const rows = db.door_page_version_inputs;
    if (!Array.isArray(rows)) throw new Error();
    const audits = new Map<string, { tenant_id: string; input_sha256: string; actor: string; reason: string; at: string; page_id: string }>();
    for (const event of db.admin_audit.filter((r) => r.action === "door_page_input_captured")) {
      const detail = JSON.parse(event.detail ?? "null");
      if (!detail || typeof detail !== "object" || Array.isArray(detail) || Object.keys(detail).sort().join("|") !== "actor|input_sha256|reason|reservation_id|tenant_id"
        || Object.values(detail).some((v) => typeof v !== "string") || audits.has(detail.reservation_id)) throw new Error();
      audits.set(detail.reservation_id, { tenant_id: detail.tenant_id, input_sha256: detail.input_sha256, actor: detail.actor, reason: detail.reason, at: event.at, page_id: event.target });
    }
    if (audits.size !== rows.length) throw new Error();
    const seen = new Set<string>();
    return rows.map((wire) => {
      if (seen.has(wire.reservation_id)) throw new Error(); seen.add(wire.reservation_id);
      const r = db.door_page_version_catalog[0]?.reservations.find((r) => r.reservation_id === wire.reservation_id);
      if (!r) throw new Error();
      const record = decodeDoorPageVersionInput(wire, r);
      const audit = audits.get(wire.reservation_id);
      if (!audit || audit.tenant_id !== record.tenant_id || audit.page_id !== record.page_id || audit.input_sha256 !== record.input_sha256
        || audit.actor !== record.actor || audit.reason !== record.reason || audit.at !== record.captured_at) throw new Error();
      const version = db.door_page_version_catalog[0]?.versions.find((v) => v.reservation_id === r.reservation_id);
      if (version && !verifyDoorPageVersionInputReceipt(record, version.metadata.receipt).ok) throw new Error();
      return record;
    });
  } catch { throw new DoorPageVersionInputError("DOOR_INPUT_CORRUPT"); }
}
function safeScope(tenant_id: string, page_id: string) { try { parseDoorVersion(doorPageReservationSchema.pick({ tenant_id: true, page_id: true }), { tenant_id, page_id }); } catch { throw new DoorPageVersionInputError("DOOR_INPUT_INVALID"); } }
function wrap(error: unknown): never { if (error instanceof DoorPageVersionInputError) throw error; throw new DoorPageVersionInputError("DOOR_INPUT_UNAVAILABLE"); }

/** Trusted server authoring only. Never use this interface for browser-supplied compiler context. */
export function doorPageVersionInputStore(provider: PlatformClientProvider = serviceClientProvider): DoorPageVersionInputStore {
  let client: ReturnType<PlatformClientProvider>; try { client = provider(); } catch (e) { return wrap(e); }
  async function reservations(tenant: string, page: string): Promise<DoorPageVersionReservation[]> {
    const { data, error } = await client!.from("door_page_version_reservation").select("*").eq("tenant_id", tenant).eq("page_id", page);
    if (error) throw error;
    if (!Array.isArray(data)) throw new DoorPageVersionInputError("DOOR_INPUT_CORRUPT");
    return data.map((raw) => { const r = parseDoorVersion(doorPageReservationSchema, raw); if (r.tenant_id !== tenant || r.page_id !== page) throw new DoorPageVersionInputError("DOOR_INPUT_CORRUPT"); return r; });
  }
  async function read(tenant: string, page: string) {
    safeScope(tenant, page);
    if (!client) { try { return checkDoorPageVersionInputs(readDevDb()).filter((r) => r.tenant_id === tenant && r.page_id === page); } catch { throw new DoorPageVersionInputError("DOOR_INPUT_CORRUPT"); } }
    try {
      const [rs, result] = await Promise.all([reservations(tenant, page), client.from("door_page_version_input").select("*").eq("tenant_id", tenant).eq("page_id", page)]);
      if (result.error) throw result.error; if (!Array.isArray(result.data)) throw new DoorPageVersionInputError("DOOR_INPUT_CORRUPT");
      const seen = new Set<string>();
      return result.data.map((wire) => { const r = rs.find((r) => r.reservation_id === wire.reservation_id); if (!r || wire.tenant_id !== tenant || wire.page_id !== page || seen.has(wire.reservation_id)) throw new DoorPageVersionInputError("DOOR_INPUT_CORRUPT"); seen.add(wire.reservation_id); return decodeDoorPageVersionInput(wire, r); });
    } catch (e) { return wrap(e); }
  }
  return {
    async captureInput(raw) {
      const input = parseDoorPageCaptureInput(raw);
      if (!client) {
        try { return updateDevDbAtomic((db) => {
          const existing = checkDoorPageVersionInputs(db);
          const r = db.door_page_version_catalog[0]?.reservations.find((r) => r.reservation_id === input.reservation_id && r.tenant_id === input.tenant_id && r.page_id === input.page_id);
          if (!r) throw new DoorPageVersionInputError("DOOR_INPUT_CONFLICT");
          const planned = prepareDoorPageVersionInput(input, r); const prior = db.door_page_version_inputs.find((v) => v.reservation_id === r.reservation_id);
          if (prior) { if (doorV44Hash(prior) !== doorV44Hash(planned.wire)) throw new DoorPageVersionInputError("DOOR_INPUT_CONFLICT"); return existing.find((v) => v.reservation_id === r.reservation_id)!; }
          if (db.door_page_version_catalog[0]?.versions.some((v) => v.reservation_id === r.reservation_id)) throw new DoorPageVersionInputError("DOOR_INPUT_CONFLICT");
          db.door_page_version_inputs.push(planned.wire); db.admin_audit.push({ at: input.at, action: "door_page_input_captured", target: input.page_id, detail: JSON.stringify({ tenant_id: input.tenant_id, reservation_id: r.reservation_id, input_sha256: planned.wire.input_sha256, actor: input.actor, reason: input.reason }) });
          return planned.record;
        }); } catch (e) { return wrap(e); }
      }
      try {
        const r = (await reservations(input.tenant_id, input.page_id)).find((r) => r.reservation_id === input.reservation_id);
        if (!r) throw new DoorPageVersionInputError("DOOR_INPUT_CONFLICT");
        const planned = prepareDoorPageVersionInput(input, r);
        const { data, error } = await client.rpc("capture_door_page_version_input", { p_input: planned.wire });
        if (error) throw new DoorPageVersionInputError(error.message.includes("DOOR_INPUT_CONFLICT") ? "DOOR_INPUT_CONFLICT" : error.message.includes("DOOR_INPUT_INVALID") ? "DOOR_INPUT_INVALID" : "DOOR_INPUT_UNAVAILABLE");
        const record = decodeDoorPageVersionInput(data, r); if (doorV44Hash(data) !== doorV44Hash(planned.wire)) throw new DoorPageVersionInputError("DOOR_INPUT_CORRUPT"); return record;
      } catch (e) { return wrap(e); }
    },
    async getInput(tenant, page, reservation) { try { parseDoorVersion(doorPageReservationSchema.shape.reservation_id, reservation); } catch { throw new DoorPageVersionInputError("DOOR_INPUT_INVALID"); } return (await read(tenant, page)).find((r) => r.reservation_id === reservation) ?? null; },
    async getVersionInput(tenant, page, version) { try { parseDoorVersion(doorPageReservationSchema.shape.page_version, version); } catch { throw new DoorPageVersionInputError("DOOR_INPUT_INVALID"); } return (await read(tenant, page)).find((r) => r.page_version === version) ?? null; },
  };
}
