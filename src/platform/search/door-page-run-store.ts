import { z } from "zod";
import { serviceClientProvider, type PlatformClientProvider } from "@/platform/db/client";
import { readDevDb, updateDevDbAtomic, type DevDb } from "@/platform/stores/dev-db";
import { doorV44Hash } from "@/domain/search/door-v44/schema-engine";
import { DoorPageRunError, doorPageRunCreateSchema, doorPageRunClaimSchema, doorPageRunCompleteSchema, doorPageRunCreationHash, doorPageRunItems, parseDoorPageRun, sealDoorPageRun, verifyDoorPageRun, verifyDoorPageRunOutcome,
  type DoorPageRun, type DoorPageRunCreate, type DoorPageRunClaim, type DoorPageRunComplete, type DoorPageRunStore } from "@/domain/search/door-v44/page-run";
export type { DoorPageRunStore } from "@/domain/search/door-v44/page-run";
export { DoorPageRunError } from "@/domain/search/door-v44/page-run";
const fail = (code: ConstructorParameters<typeof DoorPageRunError>[0]): never => { throw new DoorPageRunError(code); };
const same = (a: unknown, b: unknown) => doorV44Hash(a) === doorV44Hash(b);
function createRun(input: DoorPageRunCreate): DoorPageRun {
  if (!same(input.items, doorPageRunItems(input.tenant_id, input.run_id, input.items.map(i => i.fixture_id)))) return fail("DOOR_RUN_INVALID");
  return sealDoorPageRun({ ...input, format: "door-page-run/1.0.0", revision: 1, updated_at: input.created_at, status: "PENDING", creation_sha256: doorPageRunCreationHash(input),
    items: input.items.map((i, n) => ({ ...i, ordinal: n + 1, status: "PENDING", execution_at: null, attempts: [], completed_at: null, outcome: null })) });
}
function changed(run: DoorPageRun, at: string): DoorPageRun {
  const { state_sha256: _h, ...body } = run; void _h;
  return sealDoorPageRun({ ...body, revision: body.revision + 1, updated_at: at, status: body.items.every(i => !["PENDING", "RUNNING"].includes(i.status)) ? "COMPLETED" : "RUNNING" });
}
function claim(run: DoorPageRun, c: DoorPageRunClaim): DoorPageRun {
  const repeated = run.items.find(i => i.attempts.some(a => a.attempt_id === c.attempt_id));
  if (repeated) {
    const a = repeated.attempts.at(-1)!;
    if (a.attempt_id === c.attempt_id && a.claimed_at === c.at && a.lease_expires_at === c.lease_expires_at) return run;
    return fail("DOOR_RUN_CONFLICT");
  }
  if (run.revision !== c.expected_revision || Date.parse(c.at) < Date.parse(run.updated_at)) return fail("DOOR_RUN_CONFLICT");
  const item = run.items.find(i => ["PENDING", "RUNNING"].includes(i.status));
  if (!item) return run;
  if (item.attempts.length >= 20 || (item.status === "RUNNING" && Date.parse(c.at) < Date.parse(item.attempts.at(-1)!.lease_expires_at))) return fail("DOOR_RUN_CONFLICT");
  item.status = "RUNNING"; item.execution_at ??= c.at; item.attempts.push({ attempt_id: c.attempt_id, claimed_at: c.at, lease_expires_at: c.lease_expires_at });
  return changed(run, c.at);
}
function complete(run: DoorPageRun, c: DoorPageRunComplete): DoorPageRun {
  const item = run.items.find(i => i.item_id === c.item_id); if (!item) return fail("DOOR_RUN_CONFLICT");
  if (item.outcome) { if (item.attempts.at(-1)?.attempt_id === c.attempt_id && same(item.outcome, c.outcome)) return run; return fail("DOOR_RUN_CONFLICT"); }
  const a = item.attempts.at(-1);
  if (run.revision !== c.expected_revision || item.status !== "RUNNING" || !a || a.attempt_id !== c.attempt_id || Date.parse(c.at) < Date.parse(run.updated_at)
    || Date.parse(c.at) >= Date.parse(a.lease_expires_at)) return fail("DOOR_RUN_CONFLICT");
  verifyDoorPageRunOutcome(run, item, c.outcome);
  item.outcome = c.outcome; item.status = c.outcome.status; item.completed_at = c.at; return changed(run, c.at);
}
function checked(db: DevDb): DoorPageRun[] {
  try {
    const rows = db.door_page_runs.map(verifyDoorPageRun), ids = new Set<string>(), keys = new Set<string>();
    const audits = db.admin_audit.filter(a => a.action === "door_page_run_transition");
    if (audits.length !== rows.reduce((n, r) => n + r.revision, 0)) return fail("DOOR_RUN_CORRUPT");
    for (const run of rows) {
      if (ids.has(run.run_id) || keys.has(run.idempotency_key)) return fail("DOOR_RUN_CORRUPT"); ids.add(run.run_id); keys.add(run.idempotency_key);
      const history = audits.filter(a => a.target === run.run_id).map(a => ({ ...a, detail: JSON.parse(a.detail ?? "null") }));
      if (history.length !== run.revision) return fail("DOOR_RUN_CORRUPT");
      let previousHash: string | null = null, previousStatus: DoorPageRun["status"] | null = null;
      for (let rev = 1; rev <= run.revision; rev++) {
        const found = history.filter(a => a.detail?.revision === rev); if (found.length !== 1) return fail("DOOR_RUN_CORRUPT");
        const d = found[0].detail;
        if (d.tenant_id !== run.tenant_id || d.creation_sha256 !== run.creation_sha256 || d.actor !== run.actor || d.reason !== run.reason || !same(d.environment, run.environment)
          || d.role !== "owner-session" || d.request_id !== run.idempotency_key || d.request_sha256 !== run.request_sha256 || d.previous_revision !== rev - 1
          || d.previous_state_sha256 !== previousHash || d.previous_status !== previousStatus || !/^[a-f0-9]{64}$/.test(d.state_sha256)
          || !["PENDING", "RUNNING", "COMPLETED"].includes(d.status) || (rev === 1 && (d.status !== "PENDING" || found[0].at !== run.created_at))
          || (rev === run.revision && (d.state_sha256 !== run.state_sha256 || d.status !== run.status || found[0].at !== run.updated_at))) return fail("DOOR_RUN_CORRUPT");
        previousHash = d.state_sha256; previousStatus = d.status;
      }
    }
    return rows;
  } catch (e) { if (e instanceof DoorPageRunError) throw e; return fail("DOOR_RUN_CORRUPT"); }
}
function audit(db: DevDb, run: DoorPageRun, previous: Pick<DoorPageRun, "revision" | "state_sha256" | "status"> | null) { db.admin_audit.push({ action: "door_page_run_transition", target: run.run_id, at: run.updated_at,
  detail: JSON.stringify({ tenant_id: run.tenant_id, revision: run.revision, creation_sha256: run.creation_sha256, state_sha256: run.state_sha256, actor: run.actor, reason: run.reason, environment: run.environment,
    role: "owner-session", request_id: run.idempotency_key, request_sha256: run.request_sha256, previous_revision: previous?.revision ?? 0, previous_state_sha256: previous?.state_sha256 ?? null, previous_status: previous?.status ?? null, status: run.status }) }); }
const scoped = (tenant_id: string, run_id: string) => parseDoorPageRun(doorPageRunCreateSchema.pick({ tenant_id: true, run_id: true }), { tenant_id, run_id });

/** Server-only fixture execution state. A run outcome is not release evidence.
 * Twenty attempts/item bound the durable aggregate. An expired twentieth attempt
 * needs operator investigation, since a missing terminal write cannot tell us
 * whether that attempt produced an artifact. No automatic terminal inference. */
export function doorPageRunStore(provider: PlatformClientProvider = serviceClientProvider): DoorPageRunStore {
  let client: ReturnType<PlatformClientProvider>; try { client = provider(); } catch { return fail("DOOR_RUN_UNAVAILABLE"); }
  async function rpc(name: string, input: DoorPageRunCreate | DoorPageRunClaim | DoorPageRunComplete): Promise<DoorPageRun> {
    try {
      const { data, error } = await client!.rpc(name, { p_input: input });
      if (error) { const code = ["DOOR_RUN_INVALID", "DOOR_RUN_CONFLICT", "DOOR_RUN_NOT_FOUND"].find(c => error.message.includes(c)); return fail((code ?? "DOOR_RUN_UNAVAILABLE") as ConstructorParameters<typeof DoorPageRunError>[0]); }
      const run = verifyDoorPageRun(data); if (run.tenant_id !== input.tenant_id || run.run_id !== input.run_id) return fail("DOOR_RUN_CORRUPT"); return run;
    } catch (e) { if (e instanceof DoorPageRunError) throw e; return fail("DOOR_RUN_UNAVAILABLE"); }
  }
  function mutate(fn: (runs: DoorPageRun[], db: DevDb) => DoorPageRun): Promise<DoorPageRun> {
    try { return Promise.resolve(updateDevDbAtomic(db => { const runs = checked(db); const value = fn(runs, db); db.door_page_runs = runs; checked(db); return structuredClone(value); })); }
    catch (e) { return Promise.reject(e instanceof DoorPageRunError ? e : new DoorPageRunError("DOOR_RUN_UNAVAILABLE")); }
  }
  function transition(input: DoorPageRunClaim | DoorPageRunComplete, apply: (run: DoorPageRun) => DoorPageRun) {
    return mutate((runs, db) => { const n = runs.findIndex(r => r.tenant_id === input.tenant_id && r.run_id === input.run_id); if (n < 0) return fail("DOOR_RUN_NOT_FOUND");
      const previous = { revision: runs[n].revision, state_sha256: runs[n].state_sha256, status: runs[n].status }, next = apply(runs[n]); runs[n] = next; if (next.revision !== previous.revision) audit(db, next, previous); return next; });
  }
  return {
    async create(raw) {
      const input = parseDoorPageRun(doorPageRunCreateSchema, raw); const initial = createRun(input);
      if (client) { const run = await rpc("create_door_page_run", input); if (run.idempotency_key !== input.idempotency_key || run.request_sha256 !== input.request_sha256) return fail("DOOR_RUN_CORRUPT"); return run; }
      return mutate((runs, db) => {
        const prior = runs.find(r => r.run_id === input.run_id || r.idempotency_key === input.idempotency_key);
        if (prior) { if (prior.run_id !== input.run_id || prior.idempotency_key !== input.idempotency_key || prior.request_sha256 !== input.request_sha256) return fail("DOOR_RUN_CONFLICT"); return prior; }
        runs.push(initial); audit(db, initial, null); return initial;
      });
    },
    async read(tenantId, runId) {
      scoped(tenantId, runId);
      try {
        if (!client) return checked(readDevDb()).find(r => r.tenant_id === tenantId && r.run_id === runId) ?? null;
        const { data, error, count } = await client.from("door_page_run").select("record", { count: "exact" }).eq("tenant_id", tenantId).eq("run_id", runId).range(0, 1);
        if (error) return fail("DOOR_RUN_UNAVAILABLE"); if (!Array.isArray(data) || typeof count !== "number" || ![0, 1].includes(count) || data.length !== count) return fail("DOOR_RUN_CORRUPT");
        if (!count) return null;
        const wrapper = parseDoorPageRun(z.object({ record: z.unknown() }).strict(), data[0], "DOOR_RUN_CORRUPT"), run = verifyDoorPageRun(wrapper.record);
        if (run.tenant_id !== tenantId || run.run_id !== runId) return fail("DOOR_RUN_CORRUPT"); return run;
      } catch (e) { if (e instanceof DoorPageRunError) throw e; return fail("DOOR_RUN_UNAVAILABLE"); }
    },
    async claimNext(raw) {
      const input = parseDoorPageRun(doorPageRunClaimSchema, raw), span = Date.parse(input.lease_expires_at) - Date.parse(input.at);
      if (span <= 0 || span > 1800000) return fail("DOOR_RUN_INVALID");
      if (client) { const run = await rpc("claim_door_page_run", input), i = run.items.find(i => i.attempts.at(-1)?.attempt_id === input.attempt_id);
        if (run.status !== "COMPLETED" && (!i || i.attempts.at(-1)?.claimed_at !== input.at || i.attempts.at(-1)?.lease_expires_at !== input.lease_expires_at)) return fail("DOOR_RUN_CORRUPT"); return run; }
      return transition(input, run => claim(run, input));
    },
    async complete(raw) {
      const input = parseDoorPageRun(doorPageRunCompleteSchema, raw);
      if (client) { const run = await rpc("complete_door_page_run", input), i = run.items.find(i => i.item_id === input.item_id);
        if (!i || i.attempts.at(-1)?.attempt_id !== input.attempt_id || !same(i.outcome, input.outcome)) return fail("DOOR_RUN_CORRUPT"); return run; }
      return transition(input, run => complete(run, input));
    },
  };
}
