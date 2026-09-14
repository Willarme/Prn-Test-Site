import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";
import { DEFAULT_TENANT_ID } from "@/domain/problem/contracts";
import { doorPageCatalogSchema, doorPageVersionSchema, parseDoorVersion, type DoorPageVersion, type DoorPageVersionCatalog } from "@/domain/search/door-v44/page-version";
import { verifyDoorPageVersionInputReceipt, type DoorPageVersionInputRecord } from "@/domain/search/door-v44/page-version-input";
import { parseDoorEvidenceReceipt, type DoorEvidenceReceipt } from "@/domain/search/door-v44/release-evidence";
import { listDoorPageIdentities } from "@/platform/search/door-page-version-store";
import { doorCreatorRecords } from "./door-creator-records";
import { loadDoorV44PublicSelection } from "@/platform/pages/door-v44-runtime-public";
import type { DoorV44PublicSelection } from "@/platform/pages/door-v44-public-response";
import compatibility from "../../../content/door-template/v44/contracts/compatibility.json";
import constants from "../../../content/door-template/v44/contracts/template-constants.json";
import mutability from "../../../content/door-template/v44/contracts/mutability.json";
import manifest from "../../../content/door-template/v44/inputs/manifest.json";
import type { DoorCreatorDetail, DoorCreatorIdentity, DoorCreatorOverview, DoorCreatorVersionSummary, DoorTemplateKitView } from "./door-creator-types";

/** Internal read dependencies, called only after the route/page authenticates.
 * The read model issues no approval, executes no model and changes no records. */
export interface DoorCreatorReadDependencies {
  identities: () => Promise<DoorPageVersionCatalog["identities"]>;
  versions: (pageId: string) => Promise<DoorPageVersion[]>;
  input: (pageId: string, version: number) => Promise<DoorPageVersionInputRecord | null>;
  evidence: (pageId: string, version: number) => Promise<DoorEvidenceReceipt[]>;
  serving: () => Promise<DoorV44PublicSelection>;
  artifactRoot: () => string | undefined;
  now: () => number;
}
const defaults: DoorCreatorReadDependencies = {
  identities: () => listDoorPageIdentities(DEFAULT_TENANT_ID),
  versions: page => doorCreatorRecords().versions(page),
  input: (page, version) => doorCreatorRecords().input(page, version),
  evidence: (page, version) => doorCreatorRecords().evidence(page, version),
  serving: () => loadDoorV44PublicSelection(),
  artifactRoot: () => process.env.PRN_DOOR_V44_ARTIFACT_ROOT,
  now: Date.now,
};
const identitySchema = doorPageCatalogSchema.shape.identities.element;
function safeIdentities(rows: DoorPageVersionCatalog["identities"]): DoorPageVersionCatalog["identities"] {
  const parsed = rows.map(row => parseDoorVersion(identitySchema, row));
  if (parsed.some(row => row.tenant_id !== DEFAULT_TENANT_ID || new URL(row.canonical_url).pathname !== row.canonical_path)
    || ["page_id", "canonical_path", "canonical_intent_id"].some(key => new Set(parsed.map(row => row[key as keyof typeof row])).size !== parsed.length)) throw new Error("Invalid catalogue");
  return parsed;
}
const pageSummary = (row: DoorPageVersionCatalog["identities"][number]): DoorCreatorIdentity => ({ page_id: row.page_id, canonical_intent_id: row.canonical_intent_id, canonical_path: row.canonical_path, latest_version: row.latest_version });
const versionSummary = (row: DoorPageVersion): DoorCreatorVersionSummary => ({ page_version: row.page_version, registered_at: row.registered_at, artifact_hash: row.metadata.receipt.artifact_hash, mode: row.metadata.receipt.mode });

export async function loadDoorCreatorOverview(deps: DoorCreatorReadDependencies = defaults): Promise<DoorCreatorOverview> {
  try { return { status: "ready", pages: safeIdentities(await deps.identities()).map(pageSummary).sort((a, b) => a.page_id.localeCompare(b.page_id, "en")) }; }
  catch { return { status: "unavailable", pages: [] }; }
}

const emptyDetail = (status: DoorCreatorDetail["status"]): DoorCreatorDetail => ({
  status, page: null, versions: [], selected: null,
  input: { status: "unavailable", input_sha256: null, assignments: [], models: [], model_status: "unavailable" },
  evidence: { status: "unavailable", rows: [] },
  serving: { status: "unavailable", guard_status: null, page_version: null, as_of: null },
});

/** Explicit versions never fall back. With no version query, the UI names the
 * newest registered build; a reserved version by itself is not a build. */
export async function loadDoorCreatorDetail(pageId: string, version?: string, deps: DoorCreatorReadDependencies = defaults): Promise<DoorCreatorDetail> {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(pageId)
    || (version !== undefined && (!/^[1-9][0-9]{0,9}$/.test(version) || Number(version) > 2147483646))) return emptyDetail("not_found");
  let row: DoorPageVersion | undefined;
  const result = emptyDetail("ready");
  try {
    const identity = safeIdentities(await deps.identities()).find(row => row.page_id === pageId);
    if (!identity) return emptyDetail("not_found");
    const versions = (await deps.versions(pageId)).map(raw => parseDoorVersion(doorPageVersionSchema, raw));
    if (new Set(versions.map(row => row.page_version)).size !== versions.length || versions.some(row => row.tenant_id !== DEFAULT_TENANT_ID || row.page_id !== pageId
      || row.page_version > identity.latest_version || row.metadata.receipt.tenant_id !== DEFAULT_TENANT_ID || row.metadata.receipt.page_id !== pageId
      || row.metadata.receipt.page_version !== row.page_version || row.metadata.receipt.canonical_url !== identity.canonical_url
      || row.metadata.receipt.canonical_intent_id !== identity.canonical_intent_id)) throw new Error("Invalid version history");
    versions.sort((a, b) => b.page_version - a.page_version);
    row = version === undefined ? versions[0] : versions.find(row => row.page_version === Number(version));
    if (version !== undefined && !row) return emptyDetail("not_found");
    result.page = pageSummary(identity);
    result.versions = versions.map(versionSummary);
    if (row) {
      const root = deps.artifactRoot();
      result.selected = { ...versionSummary(row), receipt_sha256: row.metadata.receipt_sha256, reservation_id: row.reservation_id,
        provenance_status: row.metadata.provenance_status,
        preview_href: root && isAbsolute(root) ? `/admin/page-creator/${encodeURIComponent(pageId)}/versions/${row.page_version}/preview` : null,
        pending_checks: [...row.metadata.receipt.pending_checks], source_ids: [...row.metadata.receipt.source_ids], claim_ids: [...row.metadata.receipt.claim_ids] };
    }
  } catch { return emptyDetail("unavailable"); }

  // Independent panels preserve the difference between a missing record and a
  // failed read. No partial panel can grant eligibility or publication authority.
  const [inputRead, evidenceRead, servingRead] = await Promise.allSettled([
    Promise.resolve().then(() => row ? deps.input(pageId, row.page_version) : null),
    Promise.resolve().then(() => row ? deps.evidence(pageId, row.page_version) : []),
    Promise.resolve().then(() => deps.serving()),
  ]);
  let captured: DoorPageVersionInputRecord | null = null;
  if (row && inputRead.status === "fulfilled") {
    try {
      captured = inputRead.value;
      if (captured && (captured.tenant_id !== DEFAULT_TENANT_ID || captured.page_id !== pageId || captured.page_version !== row.page_version
        || captured.reservation_id !== row.reservation_id || !verifyDoorPageVersionInputReceipt(captured, row.metadata.receipt).ok)) throw new Error("Input mismatch");
      result.input = captured ? {
        status: "saved", input_sha256: captured.input_sha256,
        assignments: Object.entries(captured.assignments).flatMap(([label, value]) => label === "prompt_identities" ?
          captured!.assignments.prompt_identities.map(prompt => ({ label: `Prompt · ${prompt.capability}`, value: `${prompt.name}@${prompt.version}` })) : [{ label, value: String(value) }]),
        models: captured.model_provenance.status === "recorded" ? captured.model_provenance.assignments.map(({ capability, provider, model_id, run_id }) => ({ capability, provider, model_id, run_id })) : [],
        model_status: captured.model_provenance.status,
      } : { status: "missing", input_sha256: null, assignments: [], models: [], model_status: "not_recorded" };
    } catch { captured = null; }
  }
  if (row && evidenceRead.status === "fulfilled") {
    try {
      const receipts = evidenceRead.value.map(parseDoorEvidenceReceipt);
      if (new Set(receipts.map(r => r.receipt_sha256)).size !== receipts.length || receipts.some(r => !captured || r.subject.tenant_id !== DEFAULT_TENANT_ID
        || r.subject.page_id !== pageId || r.subject.page_version !== row!.page_version || r.subject.reservation_id !== row!.reservation_id
        || r.subject.artifact_hash !== row!.metadata.receipt.artifact_hash || r.subject.compile_receipt_sha256 !== row!.metadata.receipt_sha256
        || r.subject.input_sha256 !== captured.input_sha256)) throw new Error("Evidence subject mismatch");
      const now = deps.now();
      result.evidence = { status: "ready", rows: receipts.sort((a, b) => b.finished_at.localeCompare(a.finished_at) || a.receipt_sha256.localeCompare(b.receipt_sha256)).map(r => ({
        kind: r.kind, verdict: r.verdict, receipt_sha256: r.receipt_sha256, finished_at: r.finished_at, expires_at: r.expires_at,
        time_status: Date.parse(r.finished_at) > now ? "future" : Date.parse(r.expires_at) <= now ? "expired" : "current",
        trust_scope: r.producer.trust_scope, producer_id: r.producer.id, run_id: r.producer.run_id,
        findings: r.findings.map(({ code, pointer, severity }) => ({ code, pointer, severity })),
        model_id: r.kind === "independent_critic" ? r.output.model_id : null, cost_usd: r.kind === "independent_critic" ? r.output.cost_usd : null,
      })) };
    } catch { /* Show unavailable, not an empty successful QA result. */ }
  }
  if (servingRead.status === "fulfilled") {
    try {
      const current = servingRead.value;
      if (current.snapshot.tenant_id !== DEFAULT_TENANT_ID) throw new Error("Selection mismatch");
      const serving = current.entries.filter(item => item.entry.page_id === pageId);
      if (serving.length > 1 || serving.some(item => item.artifact.compiled.receipt.tenant_id !== DEFAULT_TENANT_ID || item.entry.canonical_path !== result.page!.canonical_path)) throw new Error("Selection mismatch");
      result.serving = { status: "ready", guard_status: current.snapshot.guard_status, page_version: serving[0]?.entry.page_version ?? null, as_of: current.snapshot.as_of };
    } catch { /* Storage/authority errors never turn into a not-published assertion. */ }
  }
  return result;
}

const templateDocuments = [
  { id: "compatibility", label: "Template contract and section order", value: compatibility },
  { id: "constants", label: "Fixed template wording", value: constants },
  { id: "mutability", label: "Fixed and dynamic field rules", value: mutability },
  { id: "input-manifest", label: "Pinned source inventory", value: manifest },
] as const;
/** Fixed checked-in documents only. No request-derived path or arbitrary file read. */
export function doorTemplateDocument(id: string): { body: string; sha256: string; filename: string } | null {
  const doc = templateDocuments.find(doc => doc.id === id);
  if (!doc) return null;
  const body = JSON.stringify(doc.value, null, 2) + "\n";
  return { body, sha256: createHash("sha256").update(body).digest("hex"), filename: `door-template-${doc.id}.json` };
}
const classDescriptions: Record<string, string> = {
  FROZEN_REFERENCE: "The approved AC reference stays unchanged.",
  TEMPLATE_CONSTANT: "Shared wording and structure are controlled by the template.",
  TAXONOMY_TOKEN: "Labels and identifiers come from reviewed registries.",
  INTENT_CONTENT: "Content changes for each approved problem and its evidence.",
  CONDITIONAL_MODULE: "Sections appear only when their requirements are met.",
  PRESENTATION_THEME: "Presentation can vary within the reviewed template rules.",
};
export async function loadDoorTemplateKitView(): Promise<DoorTemplateKitView> {
  return {
    baseline: compatibility.content_baseline_id, template_version: compatibility.template_version, schema_version: compatibility.schema_version,
    order_profile: compatibility.order_profile_id, order: [...compatibility.order],
    constants: Object.entries(constants.strings).map(([key, value]) => ({ key, value })),
    mutability: mutability.classes.map(name => ({ class: name, count: mutability.fields.filter(field => field.class === name).length, description: classDescriptions[name] })),
    documents: templateDocuments.map(doc => ({ id: doc.id, label: doc.label, href: `/api/admin/template-kit/${doc.id}`, sha256: doorTemplateDocument(doc.id)!.sha256 })),
    // These are requirement slots, deliberately not a fabricated theme registry.
    // No approve/retire/rotation writer is present in this source unit.
    theme_slots: Array.from({ length: 10 }, (_, i) => ({ id: `t${String(i + 1).padStart(2, "0")}`, status: "not_registered" })),
  };
}
