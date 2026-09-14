import { serviceClientProvider, type PlatformClientProvider } from "@/platform/db/client";
import { readDevDb, updateDevDbAtomic, type DevDb } from "@/platform/stores/dev-db";
import { DoorEvidenceError, parseDoorEvidenceReceipt, doorEvidenceReferences, type DoorEvidenceReceipt, type DoorPageEvidenceStore } from "@/domain/search/door-v44/release-evidence";
import { stableDoorJson } from "@/domain/search/door-v44/schema-engine";
export type { DoorPageEvidenceStore } from "@/domain/search/door-v44/release-evidence";
const same = (a: unknown, b: unknown) => stableDoorJson(a) === stableDoorJson(b);
function checkLinks(r: DoorEvidenceReceipt, rows: readonly DoorEvidenceReceipt[]) {
  for (const reference of doorEvidenceReferences(r)) {
    const prior = rows.find(p => p.receipt_sha256 === reference.hash);
    if (!prior || !reference.kinds.includes(prior.kind) || Date.parse(prior.finished_at) > Date.parse(r.started_at)) throw new DoorEvidenceError("DOOR_EVIDENCE_CONFLICT");
    if (r.kind === "independent_critic") {
      if (prior.kind !== "independent_critic" || prior.subject.tenant_id !== r.subject.tenant_id || prior.subject.page_id !== r.subject.page_id || prior.subject.page_version >= r.subject.page_version || prior.output.repair_iteration + 1 !== r.output.repair_iteration) throw new DoorEvidenceError("DOOR_EVIDENCE_CONFLICT");
    } else if (!same(prior.subject, r.subject)) throw new DoorEvidenceError("DOOR_EVIDENCE_CONFLICT");
  }
}
export function checkDoorPageEvidence(db: DevDb): DoorEvidenceReceipt[] {
  try {
    if (!Array.isArray(db.door_page_evidence)) throw new Error();
    const rows = db.door_page_evidence.map(parseDoorEvidenceReceipt); const seen = new Set<string>();
    const audit = db.admin_audit.filter(a => a.action === "door_page_evidence_appended");
    if (audit.length !== rows.length) throw new Error();
    for (const r of rows) {
      if (seen.has(r.receipt_sha256)) throw new Error(); seen.add(r.receipt_sha256); checkLinks(r, rows);
      const version = db.door_page_version_catalog[0]?.versions.find(v => v.tenant_id === r.subject.tenant_id && v.page_id === r.subject.page_id && v.page_version === r.subject.page_version);
      const input = db.door_page_version_inputs.find(i => i.reservation_id === r.subject.reservation_id);
      if (!version || !input || version.reservation_id !== r.subject.reservation_id || version.metadata.receipt_sha256 !== r.subject.compile_receipt_sha256 || version.metadata.receipt.artifact_hash !== r.subject.artifact_hash || input.input_sha256 !== r.subject.input_sha256) throw new Error();
      const matches = audit.filter(a => { try { const d = JSON.parse(a.detail ?? "null"); return a.target === r.subject.page_id && a.at === r.finished_at && same(d, { tenant_id: r.subject.tenant_id, receipt_sha256: r.receipt_sha256, kind: r.kind, actor: r.producer.actor_id }); } catch { return false; } });
      if (matches.length !== 1) throw new Error();
    }
    return rows;
  } catch { throw new DoorEvidenceError("DOOR_EVIDENCE_CORRUPT"); }
}
function safeScope(tenant: string, page: string) { if (![tenant, page].every(v => /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(v))) throw new DoorEvidenceError("DOOR_EVIDENCE_INVALID"); }
function fail(error: unknown): never { if (error instanceof DoorEvidenceError) throw error; throw new DoorEvidenceError("DOOR_EVIDENCE_UNAVAILABLE"); }
/** Service-only issuance sink. Callers are registered server producers; there is
 * intentionally no raw receipt HTTP importer. SQL/hash integrity is not an
 * attestation of a vendor or executor. Release policy checks producer authority. */
export function doorPageEvidenceStore(provider: PlatformClientProvider = serviceClientProvider): DoorPageEvidenceStore {
  let client: ReturnType<PlatformClientProvider>; try { client = provider(); } catch (e) { return fail(e); }
  async function read(tenant: string, page: string) {
    safeScope(tenant, page);
    try {
      if (!client) return checkDoorPageEvidence(readDevDb()).filter(r => r.subject.tenant_id === tenant && r.subject.page_id === page);
      const { data, error } = await client.from("door_page_evidence").select("receipt").eq("tenant_id", tenant).eq("page_id", page);
      if (error) throw error; if (!Array.isArray(data)) throw new DoorEvidenceError("DOOR_EVIDENCE_CORRUPT");
      const rows = data.map(r => parseDoorEvidenceReceipt(r.receipt));
      if (new Set(rows.map(r => r.receipt_sha256)).size !== rows.length || rows.some(r => r.subject.tenant_id !== tenant || r.subject.page_id !== page)) throw new DoorEvidenceError("DOOR_EVIDENCE_CORRUPT");
      return rows;
    } catch (e) { return fail(e); }
  }
  return {
    async appendReceipt(raw) {
      const r = parseDoorEvidenceReceipt(raw);
      try {
        if (!client) return updateDevDbAtomic(db => {
          const rows = checkDoorPageEvidence(db); const old = rows.find(p => p.receipt_sha256 === r.receipt_sha256);
          if (old) { if (!same(old, r)) throw new DoorEvidenceError("DOOR_EVIDENCE_CONFLICT"); return old; }
          checkLinks(r, rows);
          db.door_page_evidence.push(r); db.admin_audit.push({ at: r.finished_at, action: "door_page_evidence_appended", target: r.subject.page_id, detail: JSON.stringify({ tenant_id: r.subject.tenant_id, receipt_sha256: r.receipt_sha256, kind: r.kind, actor: r.producer.actor_id }) });
          checkDoorPageEvidence(db); return r;
        });
        const { data, error } = await client.rpc("append_door_page_evidence", { p_input: r });
        if (error) throw new DoorEvidenceError(error.message.includes("DOOR_EVIDENCE_CONFLICT") ? "DOOR_EVIDENCE_CONFLICT" : error.message.includes("DOOR_EVIDENCE_INVALID") ? "DOOR_EVIDENCE_INVALID" : "DOOR_EVIDENCE_UNAVAILABLE");
        const saved = parseDoorEvidenceReceipt(data); if (!same(saved, r)) throw new DoorEvidenceError("DOOR_EVIDENCE_CORRUPT"); return saved;
      } catch (e) { return fail(e); }
    },
    async getReceipt(tenant, page, hash) { if (!/^[a-f0-9]{64}$/.test(hash)) throw new DoorEvidenceError("DOOR_EVIDENCE_INVALID"); return (await read(tenant, page)).find(r => r.receipt_sha256 === hash) ?? null; },
    async listReceipts(tenant, page, version) { if (!Number.isSafeInteger(version) || version < 1 || version > 2147483646) throw new DoorEvidenceError("DOOR_EVIDENCE_INVALID"); return (await read(tenant, page)).filter(r => r.subject.page_version === version); },
  };
}
