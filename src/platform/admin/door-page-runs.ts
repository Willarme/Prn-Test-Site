import { randomUUID } from "node:crypto";
import { isAbsolute, parse, resolve } from "node:path";
import { DEFAULT_TENANT_ID } from "@/domain/problem/contracts";
import { doorV44Hash } from "@/domain/search/door-v44/schema-engine";
import { DoorPageRunError, doorPageRunItems, type DoorPageRun, type DoorPageRunStore, type DoorPageFixtureId } from "@/domain/search/door-v44/page-run";
import { doorPageRunStore } from "@/platform/search/door-page-run-store";
import { getDoorFixturePackage } from "@/platform/search/door-page-run-fixtures";
import { executeDoorFixture } from "@/platform/search/door-page-run-executor";
import { doorCreatorPreviewHref } from "@/platform/admin/door-creator-preview";
import type { DoorRunCreateRequest, DoorRunFixtureCatalog, DoorRunView } from "./door-page-run-types";

const TENANT = DEFAULT_TENANT_ID;
const LEASE_MS = 120_000;
export class DoorRunServiceError extends Error {
  constructor(public readonly code: string, public readonly status: number, public readonly details?: unknown) { super(code); this.name = "DoorRunServiceError"; }
}
export type DoorRunDependencies = {
  store: () => DoorPageRunStore;
  fixturePackage: typeof getDoorFixturePackage;
  execute: typeof executeDoorFixture;
  now: () => string; attemptId: () => string;
  artifactRoot: () => string | undefined;
};
const defaults: DoorRunDependencies = { store: doorPageRunStore, fixturePackage: getDoorFixturePackage, execute: executeDoorFixture,
  now: () => new Date().toISOString(), attemptId: randomUUID, artifactRoot: () => process.env.PRN_DOOR_V44_ARTIFACT_ROOT };
function mapped(error: unknown): never {
  if (error instanceof DoorRunServiceError) throw error;
  if (error instanceof DoorPageRunError) {
    const status = error.code === "DOOR_RUN_INVALID" ? 400 : error.code === "DOOR_RUN_CONFLICT" ? 409 : error.code === "DOOR_RUN_NOT_FOUND" ? 404 : 503;
    throw new DoorRunServiceError(error.code, status);
  }
  throw new DoorRunServiceError("RUN_DEPENDENCY_UNAVAILABLE", 503);
}
function requireArtifactRoot(deps: DoorRunDependencies) {
  const root = deps.artifactRoot();
  if (!root || !isAbsolute(root) || resolve(root) === parse(resolve(root)).root) throw new DoorRunServiceError("ARTIFACT_STORE_UNAVAILABLE", 503);
}
export function doorRunDryPreviewHref(runId: string, fixtureId: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(runId) || !/^F(?:0[1-9]|1[01])$/.test(fixtureId)) throw new DoorRunServiceError("RUN_NOT_FOUND", 404);
  return `/admin/page-creator/runs/${runId}/items/${fixtureId}/preview`;
}
/** A response projection, not approval or independent QA evidence. */
export function doorRunView(run: DoorPageRun, now: string): DoorRunView {
  const running = run.items.find(i => i.status === "RUNNING"), active = running?.attempts.at(-1);
  const leased = Boolean(active && Date.parse(active.lease_expires_at) > Date.parse(now));
  const complete = run.status === "COMPLETED";
  return { run_id: run.run_id, revision: run.revision, mode: run.mode, dry_run: run.dry_run,
    status: run.status === "COMPLETED" ? "COMPLETE" : run.status, created_at: run.created_at, updated_at: run.updated_at,
    resumable: !complete && !leased && (!running || running.attempts.length < 20), retry_after: leased ? active!.lease_expires_at : null,
    package_sha256: run.package_sha256, executor_version: run.executor_version,
    terminal_count: run.items.filter(i => ["BUILT", "BLOCKED", "FAILED"].includes(i.status)).length,
    model_calls: 0, cost_usd: 0, release_ready: false,
    items: run.items.map(item => ({ item_id: item.item_id, fixture_id: item.fixture_id, page_id: item.page_id, status: item.status, attempts: item.attempts.length,
      diagnostics: item.outcome?.diagnostics ?? [], input_sha256: item.outcome?.input_sha256 ?? null,
      artifact_hash: item.outcome?.artifact?.artifact_hash ?? null, model_calls: 0, cost_usd: 0,
      preview_href: item.status !== "BUILT" ? null : run.dry_run ? doorRunDryPreviewHref(run.run_id, item.fixture_id) : doorCreatorPreviewHref(item.page_id, 1),
      version_href: item.status === "BUILT" && !run.dry_run ? `/admin/page-creator/${item.page_id}?version=1` : null })),
  };
}
export async function doorRunCatalog(overrides: Partial<DoorRunDependencies> = {}): Promise<DoorRunFixtureCatalog> {
  try { const pack = await ({ ...defaults, ...overrides }).fixturePackage(); return { fixtures: pack.fixtures, package_sha256: pack.sha256, executor_version: pack.executor_version }; }
  catch (e) { return mapped(e); }
}
export async function createDoorRun(key: string, request: DoorRunCreateRequest, overrides: Partial<DoorRunDependencies> = {}): Promise<DoorRunView> {
  const deps = { ...defaults, ...overrides };
  try {
    // This slice has no live admission or paid executor. Name all known missing
    // integrations for every requested item, before stores or model adapters.
    if (request.mode === "live") throw new DoorRunServiceError("LIVE_PREFLIGHT_BLOCKED", 422, {
      prerequisites: ["LIVE_OPPORTUNITY_ADMISSION_UNAVAILABLE", "APPROVED_THEME_ROTATION_UNAVAILABLE", "SHARED_BUDGET_AUTHORITY_UNAVAILABLE", "LIVE_WRITER_NOT_CONNECTED", "LIVE_CRITIC_ORCHESTRATION_UNAVAILABLE"],
      opportunities: request.opportunity_ids.map(opportunity_id => ({ opportunity_id, code: "LIVE_OPPORTUNITY_ADMISSION_UNAVAILABLE" })), model_calls: 0, cost_usd: 0,
    });
    const normalized = { ...request, opportunity_ids: [...request.opportunity_ids].sort() }, request_sha256 = doorV44Hash(normalized), run_id = `run-${key}`;
    const store = deps.store(), prior = await store.read(TENANT, run_id);
    if (prior) {
      if (prior.request_sha256 !== request_sha256 || prior.idempotency_key !== key) throw new DoorRunServiceError("RUN_IDEMPOTENCY_CONFLICT", 409);
      return doorRunView(prior, deps.now());
    }
    requireArtifactRoot(deps);
    const pack = await deps.fixturePackage();
    const commit = process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.PRN_DOOR_V44_COMMIT;
    const run = await store.create({ tenant_id: TENANT, run_id, idempotency_key: key, request_sha256,
      actor: "owner-session", reason: request.reason, created_at: deps.now(), mode: "fixture", dry_run: request.dry_run,
      package_sha256: pack.sha256, executor_version: pack.executor_version, executor_sha256: pack.executor_sha256,
      environment: { kind: process.env.VERCEL === "1" ? "trial" : "local", commit_sha: commit && /^[a-f0-9]{40}$/.test(commit) ? commit : null },
      items: doorPageRunItems(TENANT, run_id, normalized.opportunity_ids as DoorPageFixtureId[]),
    });
    return doorRunView(run, deps.now());
  } catch (e) { return mapped(e); }
}
export async function readDoorRun(runId: string, overrides: Partial<DoorRunDependencies> = {}): Promise<DoorRunView> {
  const deps = { ...defaults, ...overrides };
  try { const run = await deps.store().read(TENANT, runId); if (!run) throw new DoorRunServiceError("RUN_NOT_FOUND", 404); return doorRunView(run, deps.now()); }
  catch (e) { return mapped(e); }
}
/** One durable, fenced item per request. No detached work or paid calls. */
export async function advanceDoorRun(runId: string, expectedRevision: number, overrides: Partial<DoorRunDependencies> = {}): Promise<DoorRunView> {
  const deps = { ...defaults, ...overrides };
  try {
    const store = deps.store(), prior = await store.read(TENANT, runId);
    if (!prior) throw new DoorRunServiceError("RUN_NOT_FOUND", 404);
    if (prior.revision !== expectedRevision) throw new DoorRunServiceError("RUN_VERSION_CONFLICT", 409);
    if (prior.status === "COMPLETED") return doorRunView(prior, deps.now());
    requireArtifactRoot(deps);
    const pack = await deps.fixturePackage();
    if (pack.sha256 !== prior.package_sha256 || pack.executor_sha256 !== prior.executor_sha256 || pack.executor_version !== prior.executor_version) throw new DoorRunServiceError("RUN_PACKAGE_CHANGED", 409);
    const at = deps.now(), attempt_id = deps.attemptId();
    const claimed = await store.claimNext({ tenant_id: TENANT, run_id: runId, expected_revision: expectedRevision, attempt_id, at, lease_expires_at: new Date(Date.parse(at) + LEASE_MS).toISOString() });
    const item = claimed.items.find(i => i.status === "RUNNING" && i.attempts.at(-1)?.attempt_id === attempt_id);
    if (!item || !item.execution_at) throw new DoorRunServiceError("RUN_LEASE_CONFLICT", 409);
    const outcome = await deps.execute({ run_id: claimed.run_id, fixture_id: item.fixture_id, page_id: item.page_id, operation_id: item.operation_id,
      dry_run: claimed.dry_run, actor: claimed.actor, reason: claimed.reason, execution_at: item.execution_at,
      package_sha256: claimed.package_sha256, executor_sha256: claimed.executor_sha256 });
    const completed = await store.complete({ tenant_id: TENANT, run_id: runId, expected_revision: claimed.revision,
      item_id: item.item_id, attempt_id, at: deps.now(), outcome });
    return doorRunView(completed, deps.now());
  } catch (e) { return mapped(e); }
}
