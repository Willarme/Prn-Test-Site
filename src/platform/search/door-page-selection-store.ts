import { z } from "zod";
import { serviceClientProvider, type PlatformClientProvider } from "@/platform/db/client";
import { readDevDb, updateDevDbAtomic, type DevDb } from "@/platform/stores/dev-db";
import { checkDoorPageVersionInputs } from "./door-page-version-input-store";
import { verifyDoorPageVersionInputReceipt, type DoorPageVersionInputRecord } from "@/domain/search/door-v44/page-version-input";
import { doorPageCatalogSchema, doorPageReservationSchema, parseDoorVersion, type DoorPageVersion } from "@/domain/search/door-v44/page-version";
import { deriveDoorWriterIdentity } from "@/domain/search/door-v44/writer-identity";
import { parseDoorEvidenceReceipt, evaluateDoorRelease, type DoorEvidenceReceipt } from "@/domain/search/door-v44/release-evidence";
import { doorV44Hash, stableDoorJson } from "@/domain/search/door-v44/schema-engine";
import { DoorPageSelectionError, doorServingSnapshotSchema, doorSelectionCommitSchema, doorSelectionFenceSchema, doorSelectionGuardCommandSchema, doorSelectionGuardHash, doorSelectionGuardSchema, doorSelectionSetHash, doorSelectionSetSchema, doorSelectionWithdrawSchema, parseDoorSelection, withdrawDoorSelectionClosure,
  type DoorPageSelectedEntry, type DoorPageSelectionCommit, type DoorPageSelectionGuard, type DoorPageSelectionSet, type DoorPageSelectionStore, type DoorPageSelectionTarget, type DoorPageServingSnapshot, type DoorSelectionFence } from "@/domain/search/door-v44/page-selection";
import type { DoorV44RichNode } from "@/domain/search/door-v44/types";
export { DoorPageSelectionError } from "@/domain/search/door-v44/page-selection";
export type { DoorPageSelectionStore } from "@/domain/search/door-v44/page-selection";

const FROZEN_PATH = "/problems/ac-blowing-warm-air";
const same = (a: unknown, b: unknown) => stableDoorJson(a) === stableDoorJson(b);
const fail = (code: ConstructorParameters<typeof DoorPageSelectionError>[0]): never => { throw new DoorPageSelectionError(code); };
const sort = <T extends {page_id: string}>(items: T[]) => items.sort((a, b) => a.page_id < b.page_id ? -1 : a.page_id > b.page_id ? 1 : 0);
const scope = (tenant: string) => parseDoorVersion(doorPageReservationSchema.shape.tenant_id, tenant);
const immutableTarget = (t:DoorPageSelectionTarget) => ({page_id:t.page_id,page_version:t.page_version,reservation_id:t.reservation_id,input_sha256:t.input_sha256,artifact_hash:t.artifact_hash,compile_receipt_sha256:t.compile_receipt_sha256});
const last = <T extends {tenant_id: string; revision: number}>(rows: T[], tenant: string) => rows.filter((r) => r.tenant_id === tenant).sort((a, b) => b.revision - a.revision)[0] ?? null;
function target(row: DoorPageSelectedEntry): DoorPageSelectionTarget { const { page_id, page_version, reservation_id, input_sha256, artifact_hash, compile_receipt_sha256, release_evaluation_sha256, content_approval_sha256, publish_action_sha256 } = row; return { page_id, page_version, reservation_id, input_sha256, artifact_hash, compile_receipt_sha256, release_evaluation_sha256, content_approval_sha256, publish_action_sha256 }; }
const plainText = (nodes: DoorV44RichNode[]): string => nodes.map((n) => "children" in n ? plainText(n.children) : n.type === "text" ? n.value : "label" in n ? n.label : " ").join("").replace(/\s+/g, " ").trim();
interface Sources { versions: DoorPageVersion[]; inputs: DoorPageVersionInputRecord[]; receipts: DoorEvidenceReceipt[]; managed: DoorPageServingSnapshot["managed"] }
function validateGuard(guard: DoorPageSelectionGuard): void {
  const { guard_sha256, ...body } = guard; const s = guard.state; const p = s.release_policy;
  if (guard_sha256 !== doorSelectionGuardHash(body) || s.fence.revision !== guard.revision || s.policy_sha256 !== doorV44Hash(p)
    || s.fence.dependencies_sha256 !== doorV44Hash(p.dependencies) || s.fence.environment_sha256 !== doorV44Hash(p.environment) || s.fence.holds_sha256 !== doorV44Hash(p.holds)
    || s.origin !== p.environment.origin || new Set(s.blocked_page_ids).size !== s.blocked_page_ids.length || new Set(s.family_routes.map((r) => r.family_id)).size !== s.family_routes.length
    || new Set(s.family_routes.map((r) => r.path)).size !== s.family_routes.length) fail("SELECTION_CORRUPT");
}
function validateHistory(sets: DoorPageSelectionSet[], guards: DoorPageSelectionGuard[]): void {
  for (const collection of [sets, guards]) {
    const seen = new Set<string>(); const operations = new Set<string>();
    for (const row of collection) { const key = `${row.tenant_id}/${row.revision}`; const op = `${row.tenant_id}/${row.operation_id}`;
      if (seen.has(key) || operations.has(op) || row.previous_revision !== row.revision - 1) fail("SELECTION_CORRUPT"); seen.add(key); operations.add(op);
      if (row.previous_revision > 0 && !collection.some((r) => r.tenant_id === row.tenant_id && r.revision === row.previous_revision)) fail("SELECTION_CORRUPT");
    }
  }
  for (const row of guards) validateGuard(row);
  for (const row of sets) { const { selection_sha256, ...body } = row;
    if (selection_sha256 !== doorSelectionSetHash(body) || !guards.some((g) => g.tenant_id === row.tenant_id && g.revision === row.guard_revision)
      || new Set(row.entries.map((r) => r.page_id)).size !== row.entries.length || new Set(row.entries.map((r) => r.canonical_path)).size !== row.entries.length
      || row.entries.some((r) => r.canonical_path === FROZEN_PATH || r.related_page_ids.some((id) => !row.entries.some((e) => e.page_id === id)))) fail("SELECTION_CORRUPT");
    validateEntries(row.entries);
  }
}
function validateEntries(entries: DoorPageSelectedEntry[]) {
  for (const e of entries) {
    const bindings=e.related_page_ids.map(id=>{const t=entries.find(r=>r.page_id===id);if(!t||t.page_id===e.page_id||t.family_id!==e.family_id)return fail("SELECTION_CORRUPT");return {page_id:id,page_version:t.page_version,input_sha256:t.input_sha256,artifact_hash:t.artifact_hash,canonical_path:t.canonical_path};});
    if(!same(bindings,e.related_bindings)||new Set(e.related_page_ids).size!==e.related_page_ids.length||new URL(e.canonical_url).pathname!==e.canonical_path)fail("SELECTION_CORRUPT");
  }
}
function validateSnapshot(s:DoorPageServingSnapshot,tenant:string,observed:DoorSelectionFence|null) {
  if(s.tenant_id!==tenant||s.fence?.revision!== (s.guard_revision||undefined) || (s.revision===0)!==(s.selection_sha256===null)
    ||(s.guard_status==="unconfigured")!==(s.guard_revision===0)|| (s.guard_revision===0&&(s.origin!==null||s.index_policy!==null))
    ||(s.guard_status==="current"&&(!observed||!same(s.fence,observed))) ||(s.guard_status!=="current"&&s.entries.length)
    ||new Set(s.managed.map(r=>r.canonical_path)).size!==s.managed.length||new Set(s.entries.map(r=>r.page_id)).size!==s.entries.length
    || !s.managed.some(r=>r.kind==="frozen_control"&&r.page_id===null&&r.canonical_path===FROZEN_PATH)
    ||s.managed.some(r=>r.kind==="catalog"?r.page_id===null:r.page_id!==null||r.canonical_path!==FROZEN_PATH)
    ||s.entries.some(r=>r.canonical_path===FROZEN_PATH||!s.managed.some(m=>m.page_id===r.page_id&&m.canonical_path===r.canonical_path)||new URL(r.canonical_url).origin!==s.origin||Date.parse(r.valid_until)<=Date.parse(s.as_of)))fail("SELECTION_CORRUPT");
  validateEntries(s.entries);
}
function validateSetResponse(row:DoorPageSelectionSet,c:{tenant_id:string;operation_id:string;actor:string;reason:string;at:string;expected_revision:number},request:string,action:DoorPageSelectionSet["action"]){
  const {selection_sha256,...body}=row;
  if(selection_sha256!==doorSelectionSetHash(body)||row.tenant_id!==c.tenant_id||row.operation_id!==c.operation_id||row.actor!==c.actor||row.reason!==c.reason||row.at!==c.at||row.previous_revision!==c.expected_revision||row.revision!==c.expected_revision+1||row.action!==action||row.request_sha256!==request)fail("SELECTION_CORRUPT");
  validateEntries(row.entries);
}
function fileState(db: DevDb) {
  const sets = parseDoorSelection(z.array(doorSelectionSetSchema), db.door_page_selection_sets, "SELECTION_CORRUPT");
  const guards = parseDoorSelection(z.array(doorSelectionGuardSchema), db.door_page_selection_guards, "SELECTION_CORRUPT"); validateHistory(sets, guards);
  const receipts = db.door_page_evidence.map(parseDoorEvidenceReceipt);
  const audit = db.admin_audit.filter((a) => ["door_selection_committed", "door_selection_guard"].includes(a.action));
  if (audit.length !== sets.length + guards.length) fail("SELECTION_CORRUPT");
  const keys = new Set<string>();
  for (const e of audit) { const d = JSON.parse(e.detail ?? "null"); const row = (e.action === "door_selection_guard" ? guards : sets).find((r) => r.tenant_id === d?.tenant_id && r.revision === d?.revision);
    const key = `${e.action}/${d?.tenant_id}/${d?.revision}`; if (!row || keys.has(key) || e.at !== row.at || e.target !== row.tenant_id || d.actor !== row.actor || d.reason !== row.reason || d.operation_id !== row.operation_id || d.hash !== ("guard_sha256" in row ? row.guard_sha256 : row.selection_sha256)) fail("SELECTION_CORRUPT"); keys.add(key);
  }
  return { sets, guards, receipts };
}
function fileSources(db: DevDb, tenant: string, receipts: DoorEvidenceReceipt[]): Sources {
  const c = db.door_page_version_catalog.length ? parseDoorVersion(doorPageCatalogSchema, db.door_page_version_catalog[0]) : null;
  return { versions: c?.versions.filter((r) => r.tenant_id === tenant) ?? [], inputs: checkDoorPageVersionInputs(db).filter((r) => r.tenant_id === tenant), receipts: receipts.filter((r) => r.subject.tenant_id === tenant),
    managed: [...(c?.identities.filter((r) => r.tenant_id === tenant).map((r) => ({ page_id: r.page_id, canonical_path: r.canonical_path, kind: "catalog" as const })) ?? []).filter((r) => r.canonical_path !== FROZEN_PATH), { page_id: null, canonical_path: FROZEN_PATH, kind: "frozen_control" }] };
}
function deriveEntry(t: DoorPageSelectionTarget, tenant: string, guard: DoorPageSelectionGuard, sources: Sources, now: string, command?: DoorPageSelectionCommit): DoorPageSelectedEntry {
  const s = guard.state; const v = sources.versions.find((r) => r.page_id === t.page_id && r.page_version === t.page_version); const input = sources.inputs.find((r) => r.reservation_id === t.reservation_id);
  if (!v || !input || input.context.validation.mode !== "live" || input.model_provenance.status !== "recorded" || v.reservation_id !== t.reservation_id || input.page_id !== t.page_id || input.page_version !== t.page_version
    || input.tenant_id !== tenant || v.tenant_id !== tenant || input.input_sha256 !== t.input_sha256 || v.metadata.receipt_sha256 !== t.compile_receipt_sha256 || v.metadata.receipt.artifact_hash !== t.artifact_hash
    || !verifyDoorPageVersionInputReceipt(input, v.metadata.receipt).ok || input.spec.identity.canonical_path === FROZEN_PATH || input.context.validation.origin !== s.origin) return fail("SELECTION_INELIGIBLE");
  const family = s.family_routes.find((r) => r.family_id === input.spec.identity.family_id);
  if (!family || input.spec.release.index_policy !== s.index_policy || v.metadata.receipt.robots !== (s.index_policy === "trial_noindex" ? "noindex,follow" : "index,follow") || (s.index_policy === "public_indexable" && s.release_policy.holds.trial_noindex)) return fail("SELECTION_INELIGIBLE");
  const subject = { tenant_id: tenant, page_id: t.page_id, page_version: t.page_version, reservation_id: t.reservation_id, input_sha256: t.input_sha256, artifact_hash: t.artifact_hash, compile_receipt_sha256: t.compile_receipt_sha256 };
  const records = sources.receipts.filter((r) => same(r.subject, subject));
  const evaluation = records.find((r) => r.receipt_sha256 === t.release_evaluation_sha256); const approval = records.find((r) => r.receipt_sha256 === t.content_approval_sha256); const action = records.find((r) => r.receipt_sha256 === t.publish_action_sha256);
  if (!evaluation || evaluation.kind !== "release_evaluation" || !approval || approval.kind !== "content_approval" || !action || action.kind !== "publish_action") return fail("SELECTION_INELIGIBLE");
  const authority = (r: DoorEvidenceReceipt) => s.release_policy.producers.some((p) => p.id === r.producer.id && p.version === r.producer.version && p.implementation_sha256 === r.producer.implementation_sha256 && p.actor_kind === r.producer.actor_kind && p.trust_scope === r.producer.trust_scope && p.kinds.includes(r.kind));
  const revoked = new Set(records.filter((r) => r.kind === "revocation" && authority(r) && Date.parse(r.finished_at) <= Date.parse(now)).map((r) => r.kind === "revocation" ? r.output.target_receipt_sha256 : ""));
  for (const r of [evaluation, approval, action]) if (!authority(r) || r.verdict !== "PASS" || r.findings.length || revoked.has(r.receipt_sha256) || Date.parse(r.finished_at) > Date.parse(now) || Date.parse(r.expires_at) <= Date.parse(now)
    || Date.parse(now)-Date.parse(r.finished_at)>s.release_policy.max_evidence_age_seconds*1000 || !same(r.dependencies,s.release_policy.dependencies)||!same(r.environment,s.release_policy.environment)) fail("SELECTION_INELIGIBLE");
  if (!evaluation.output.eligible || evaluation.output.content_approval_sha256 !== approval.receipt_sha256 || approval.output.assessment_sha256 !== evaluation.output.assessment_sha256 || approval.output.decision !== "APPROVE"
    || !same(evaluation.output.fence, s.fence) || evaluation.output.policy_sha256 !== s.policy_sha256 || action.output.release_evaluation_sha256 !== evaluation.receipt_sha256 || action.output.content_approval_sha256 !== approval.receipt_sha256
    || Date.parse(action.started_at) < Date.parse(evaluation.finished_at) || action.producer.actor_kind !== "human"
    || (command && (action.output.expected_selection_revision !== command.expected_revision || action.output.operation_id !== command.operation_id || action.output.action !== command.action || action.output.reason !== command.reason || action.producer.actor_id !== command.actor))) fail("SELECTION_INELIGIBLE");
  const evidence = sources.receipts.filter((r) => r.subject.tenant_id === tenant && r.subject.page_id === t.page_id);
  const assessed = evaluateDoorRelease({ phase: "publish", subject, receipts: evidence, active_receipt_hashes:evaluation.output.evidence_hashes, writer:deriveDoorWriterIdentity(input.model_provenance), policy: s.release_policy, fence: s.fence, now });
  if (!assessed.eligible || !same(assessed.evidence_hashes, evaluation.output.evidence_hashes)) fail("SELECTION_INELIGIBLE");
  const validUntil = new Date(Math.min(Date.parse(assessed.valid_until), ...[evaluation, approval, action].flatMap((r) => [Date.parse(r.expires_at),Date.parse(r.finished_at)+s.release_policy.max_evidence_age_seconds*1000]))).toISOString();
  return { ...t, canonical_path: input.spec.identity.canonical_path, canonical_url: v.metadata.receipt.canonical_url, family_id: family.family_id, family_path: family.path, label: plainText(input.spec.sections.hero.h1),
    related_page_ids: input.spec.related_page_ids, related_bindings: [], robots: v.metadata.receipt.robots as "noindex,follow" | "index,follow", valid_until: validUntil, sitemap_eligible: s.index_policy === "public_indexable" };
}
function related(entries: DoorPageSelectedEntry[], old: DoorPageSelectionSet | null, action: "publish" | "rollback", sources:Sources): DoorPageSelectedEntry[] {
  for (const row of entries) {
    const captured=sources.inputs.find(r=>r.reservation_id===row.reservation_id);
    row.related_bindings = row.related_page_ids.map((id) => { const target = entries.find((r) => r.page_id === id); const baked=captured?.context.validation.pages.find(r=>r.page_id===id);if (!target || target.page_id === row.page_id || target.family_id !== row.family_id||!baked||baked.canonical_path!==target.canonical_path||baked.tenant_id!==captured!.tenant_id||!baked.live||baked.redirect_to!==null) return fail("SELECTION_RELATED_REBUILD_REQUIRED"); return { page_id: id, page_version: target.page_version, input_sha256: target.input_sha256, artifact_hash: target.artifact_hash, canonical_path: target.canonical_path }; });
    const prior = old?.entries.find((r) => r.page_id === row.page_id);
    if (prior && prior.artifact_hash === row.artifact_hash && !same(prior.related_bindings, row.related_bindings)) fail("SELECTION_RELATED_REBUILD_REQUIRED");
    // Changed family membership requires affected existing neighbors to have an
    // independently approved rebuilt artifact, even if an old RELATED list was empty.
    if (action === "publish" && prior && prior.artifact_hash === row.artifact_hash && !same(old!.entries.filter((e) => e.family_id === row.family_id).map((e) => e.page_id).sort(), entries.filter((e) => e.family_id === row.family_id).map((e) => e.page_id).sort())) fail("SELECTION_RELATED_REBUILD_REQUIRED");
  }
  return sort(entries);
}
function audit(db: DevDb, row: DoorPageSelectionSet | DoorPageSelectionGuard) { db.admin_audit.push({ at: row.at, action: "guard_sha256" in row ? "door_selection_guard" : "door_selection_committed", target: row.tenant_id,
  detail: JSON.stringify({ tenant_id: row.tenant_id, revision: row.revision, operation_id: row.operation_id, actor: row.actor, reason: row.reason, hash: "guard_sha256" in row ? row.guard_sha256 : row.selection_sha256 }) }); }
function makeSet(command: {tenant_id: string; operation_id: string; actor: string; reason: string; at: string}, old: DoorPageSelectionSet | null, guard: DoorPageSelectionGuard, entries: DoorPageSelectedEntry[], action: DoorPageSelectionSet["action"], requestHash: string): DoorPageSelectionSet {
  const body = { ...command, revision: (old?.revision ?? 0) + 1, previous_revision: old?.revision ?? 0, guard_revision: guard.revision, action, request_sha256: requestHash, entries: sort(entries) };
  return { ...body, selection_sha256: doorSelectionSetHash(body) };
}

/** Elevated server-only store. Root supplies a fresh independently computed fence to every public read. */
export function doorPageSelectionStore(provider: PlatformClientProvider = serviceClientProvider, clock: () => string = () => new Date().toISOString(), freshness: (tenantId:string,guard:DoorPageSelectionGuard)=>Promise<DoorSelectionFence|null> = async()=>null): DoorPageSelectionStore {
  let client: ReturnType<PlatformClientProvider>; try { client = provider(); } catch { return fail("SELECTION_UNAVAILABLE"); }
  const now = () => parseDoorSelection(z.string().datetime(), clock());
  const wrap = (e: unknown): never => { if (e instanceof DoorPageSelectionError) throw e; return fail("SELECTION_UNAVAILABLE"); };
  async function rpc<T>(name: string, command: unknown, schema: z.ZodType<T>): Promise<T> { try { const {data,error} = await client!.rpc(name, {p_input: command}); if (error) { const code = ["SELECTION_CONFLICT","SELECTION_HOLD","SELECTION_INELIGIBLE","SELECTION_RELATED_REBUILD_REQUIRED","SELECTION_INVALID"].find((c) => error.message.includes(c)); return fail((code ?? "SELECTION_UNAVAILABLE") as ConstructorParameters<typeof DoorPageSelectionError>[0]); } return parseDoorSelection(schema, data, "SELECTION_CORRUPT"); } catch (e) { return wrap(e); } }
  async function histories(tenant: string) { scope(tenant); if (!client) { try { const s = fileState(readDevDb()); return {sets:s.sets.filter((r) => r.tenant_id === tenant), guards:s.guards.filter((r) => r.tenant_id === tenant)}; } catch { return fail("SELECTION_CORRUPT"); } }
    try { const [a,b] = await Promise.all([client.from("door_page_selection_set").select("record").eq("tenant_id",tenant),client.from("door_page_selection_guard").select("record").eq("tenant_id",tenant)]); if(a.error||b.error) throw new Error();
      const sets = parseDoorSelection(z.array(doorSelectionSetSchema),a.data?.map((r) => r.record),"SELECTION_CORRUPT"); const guards = parseDoorSelection(z.array(doorSelectionGuardSchema),b.data?.map((r) => r.record),"SELECTION_CORRUPT");
      if([...sets,...guards].some((r) => r.tenant_id!==tenant)) fail("SELECTION_CORRUPT"); validateHistory(sets,guards); return {sets,guards};
    } catch(e) {return wrap(e);} }
  return {
    async getGuard(tenant) {return last((await histories(tenant)).guards,tenant);},
    async getSelectionHead(tenant) {return last((await histories(tenant)).sets,tenant);},
    async getSelectionSet(tenant,revision) {parseDoorSelection(z.number().int().min(1),revision); return (await histories(tenant)).sets.find((r) => r.revision===revision)??null;},
    async registerGuard(raw) {
      const c=parseDoorSelection(doorSelectionGuardCommandSchema,raw); const request=doorV44Hash(c);
      if(client) {const row=await rpc("register_door_page_selection_guard",c,doorSelectionGuardSchema); if(row.request_sha256!==request||row.tenant_id!==c.tenant_id||row.operation_id!==c.operation_id||row.actor!==c.actor||row.reason!==c.reason||row.at!==c.at||row.previous_revision!==c.expected_revision||row.revision!==c.expected_revision+1||!same(row.state,c.state)) fail("SELECTION_CORRUPT"); validateGuard(row);return row;}
      try{return updateDevDbAtomic((db)=>{const state=fileState(db);const previous=last(state.guards,c.tenant_id); const prior=state.guards.find((r)=>r.tenant_id===c.tenant_id&&r.operation_id===c.operation_id);
        if(prior){if(prior.request_sha256!==request) fail("SELECTION_CONFLICT");return prior;}
        if((previous?.revision??0)!==c.expected_revision || c.state.fence.revision!==c.expected_revision+1 || (previous && (c.state.fence.dependency_revision<previous.state.fence.dependency_revision||c.state.fence.hold_revision<previous.state.fence.hold_revision))) fail("SELECTION_CONFLICT");
        const {expected_revision,...fields}=c; const body={...fields,revision:expected_revision+1,previous_revision:expected_revision,request_sha256:request};const row={...body,guard_sha256:doorSelectionGuardHash(body)};validateGuard(row);
        db.door_page_selection_guards.push(row);audit(db,row);const old=last(state.sets,c.tenant_id);
        if(old){const enabled=c.state.publish_enabled&&!c.state.release_policy.holds.public_publish&&c.state.release_policy.holds.door_pages_live;const kept=withdrawDoorSelectionClosure(old.entries,enabled?c.state.blocked_page_ids:old.entries.map((r)=>r.page_id));if(kept.length!==old.entries.length){const selected=makeSet({tenant_id:c.tenant_id,operation_id:doorV44Hash({guard_operation:c.operation_id}),actor:c.actor,reason:c.reason,at:c.at},old,row,kept,"hold_withdrawal",request);db.door_page_selection_sets.push(selected);audit(db,selected);}}
        return row;});}catch(e){return wrap(e);}
    },
    async commitSelectionSet(raw) {
      const c=parseDoorSelection(doorSelectionCommitSchema,raw);if(new Set(c.entries.map((r)=>r.page_id)).size!==c.entries.length) fail("SELECTION_INVALID");sort(c.entries); const request=doorV44Hash(c);
      const observedGuard=last((await histories(c.tenant_id)).guards,c.tenant_id);if(!observedGuard)return fail("SELECTION_HOLD");let observed:DoorSelectionFence|null;try{observed=await freshness(c.tenant_id,observedGuard);}catch{return fail("SELECTION_HOLD");}if(!observed||!same(parseDoorSelection(doorSelectionFenceSchema,observed),c.fence))return fail("SELECTION_HOLD");
      if(client){const row=await rpc("commit_door_page_selection",{...c,observed_fence:observed},doorSelectionSetSchema);validateSetResponse(row,c,request,c.action);if(!same(row.entries.map(target),c.entries))fail("SELECTION_CORRUPT");return row;}
      try{return updateDevDbAtomic((db)=>{const state=fileState(db);const old=last(state.sets,c.tenant_id);const prior=state.sets.find((r)=>r.tenant_id===c.tenant_id&&r.operation_id===c.operation_id);if(prior){if(prior.request_sha256!==request)fail("SELECTION_CONFLICT");return prior;}
        const guard=last(state.guards,c.tenant_id);if((old?.revision??0)!==c.expected_revision)fail("SELECTION_CONFLICT");if(!guard||!same(guard.state.fence,c.fence)||!guard.state.publish_enabled||guard.state.release_policy.holds.public_publish||!guard.state.release_policy.holds.door_pages_live) return fail("SELECTION_HOLD");
        const sources=fileSources(db,c.tenant_id,state.receipts);const checkedAt=now();const entries=c.entries.map((t)=>{if(guard.state.blocked_page_ids.includes(t.page_id))return fail("SELECTION_HOLD");const previous=old?.entries.find((r)=>r.page_id===t.page_id);
          if(c.action==="rollback"&&!state.sets.some(s=>s.tenant_id===c.tenant_id&&s.entries.some(e=>same(immutableTarget(e),immutableTarget(t)))))return fail("SELECTION_INELIGIBLE");
          return deriveEntry(t,c.tenant_id,guard,sources,checkedAt,previous&&same(target(previous),t)?undefined:c);});
        const row=makeSet({tenant_id:c.tenant_id,operation_id:c.operation_id,actor:c.actor,reason:c.reason,at:c.at},old,guard,related(entries,old,c.action,sources),c.action,request);db.door_page_selection_sets.push(row);audit(db,row);return row;});}catch(e){return wrap(e);}
    },
    async withdrawSelectionPages(raw) {
      const c=parseDoorSelection(doorSelectionWithdrawSchema,raw);if(new Set(c.page_ids).size!==c.page_ids.length)fail("SELECTION_INVALID");c.page_ids.sort();const request=doorV44Hash(c);
      if(client){const row=await rpc("withdraw_door_page_selection",c,doorSelectionSetSchema);validateSetResponse(row,c,request,"unpublish");if(row.entries.some(r=>c.page_ids.includes(r.page_id)))fail("SELECTION_CORRUPT");return row;}
      try{return updateDevDbAtomic((db)=>{const s=fileState(db);const old=last(s.sets,c.tenant_id);const prior=s.sets.find((r)=>r.tenant_id===c.tenant_id&&r.operation_id===c.operation_id);if(prior){if(prior.request_sha256!==request)fail("SELECTION_CONFLICT");return prior;}const guard=last(s.guards,c.tenant_id);
        if((old?.revision??0)!==c.expected_revision||!guard||guard.state.fence.hold_revision!==c.expected_hold_revision)return fail("SELECTION_CONFLICT");
        const row=makeSet({tenant_id:c.tenant_id,operation_id:c.operation_id,actor:c.actor,reason:c.reason,at:c.at},old,guard,withdrawDoorSelectionClosure(old?.entries??[],c.page_ids),"unpublish",request);db.door_page_selection_sets.push(row);audit(db,row);return row;});}catch(e){return wrap(e);}
    },
    async getServingSnapshot(tenant,observedFence) {
      scope(tenant);if(observedFence!==null)parseDoorSelection(doorSelectionFenceSchema,observedFence);
      if(client){const s=await rpc("read_door_page_serving_snapshot",{tenant_id:tenant,observed_fence:observedFence},doorServingSnapshotSchema);validateSnapshot(s,tenant,observedFence);
        try{const {data,error}=await client.from("door_page_identity").select("tenant_id,page_id,canonical_path").eq("tenant_id",tenant);if(error)fail("SELECTION_UNAVAILABLE");const identities=parseDoorSelection(z.array(doorPageReservationSchema.pick({tenant_id:true,page_id:true,canonical_path:true})),data,"SELECTION_CORRUPT");
          if(identities.some(r=>r.tenant_id!==tenant))fail("SELECTION_CORRUPT");const actual=identities.filter(r=>r.canonical_path!==FROZEN_PATH).map(r=>({page_id:r.page_id,canonical_path:r.canonical_path,kind:"catalog"})).sort((a,b)=>a.canonical_path.localeCompare(b.canonical_path));
          if(!same(actual,s.managed.filter(r=>r.kind==="catalog").sort((a,b)=>a.canonical_path.localeCompare(b.canonical_path))))fail("SELECTION_CORRUPT");return s;
        }catch(e){return wrap(e);}}
      try{const db=readDevDb();const state=fileState(db);const guard=last(state.guards,tenant);const selected=last(state.sets,tenant);const sources=fileSources(db,tenant,state.receipts);const at=now();
        const snapshot:DoorPageServingSnapshot={tenant_id:tenant,revision:selected?.revision??0,selection_sha256:selected?.selection_sha256??null,guard_revision:guard?.revision??0,fence:guard?.state.fence??null,origin:guard?.state.origin??null,index_policy:guard?.state.index_policy??null,entries:[],managed:sources.managed,as_of:at,guard_status:!guard?"unconfigured":!same(guard.state.fence,observedFence)?"stale":"current"};
        if(!guard||!selected||snapshot.guard_status!=="current"||!guard.state.publish_enabled)return snapshot;
        const invalid=new Set(guard.state.blocked_page_ids);for(const row of selected.entries){try{const current=deriveEntry(target(row),tenant,guard,sources,at);if(current.canonical_path!==row.canonical_path||current.label!==row.label||current.family_path!==row.family_path||Date.parse(row.valid_until)<=Date.parse(at))invalid.add(row.page_id);}catch{invalid.add(row.page_id);}}
        snapshot.entries=withdrawDoorSelectionClosure(selected.entries,[...invalid]);return snapshot;
      }catch(e){return wrap(e);}
    },
  };
}
