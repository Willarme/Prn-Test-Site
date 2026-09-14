import { z } from "zod";
import type { DoorRunCreateRequest, DoorRunFixtureCatalog, DoorRunView } from "@/platform/admin/door-page-run-types";
import { AdminActionError } from "./action";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const count = z.number().int().nonnegative();
const runId = z.string().regex(/^run-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
const pageToken = "[A-Za-z0-9][A-Za-z0-9._-]{0,127}";
const privateHref = z.string().refine(value => {
  // Generated owner routes contain no encoded segments or extra query fields.
  const saved = new RegExp(`^/admin/page-creator/${pageToken}(?:/versions/([1-9][0-9]{0,9})/preview|\\?version=([1-9][0-9]{0,9}))$`).exec(value);
  if (saved) return Number(saved[1] ?? saved[2]) <= 2147483646;
  const dry = /^\/admin\/page-creator\/runs\/(run-[a-f0-9-]+)\/items\/F(?:0[1-9]|1[01])\/preview$/.exec(value);
  return !!dry && runId.safeParse(dry[1]).success;
});
const runSchema = z.object({
  run_id: runId, revision: count, mode: z.literal("fixture"), dry_run: z.boolean(),
  status: z.enum(["PENDING", "RUNNING", "COMPLETE"]), created_at: z.string().datetime(), updated_at: z.string().datetime(),
  resumable: z.boolean(), retry_after: z.string().datetime().nullable(), package_sha256: hash, executor_version: z.string().min(1),
  items: z.array(z.object({
    item_id: z.string().min(1), fixture_id: z.string().regex(/^F(?:0[1-9]|1[01])$/), page_id: z.string().min(1),
    status: z.enum(["PENDING", "RUNNING", "BUILT", "BLOCKED", "FAILED"]), attempts: count,
    diagnostics: z.array(z.object({ code: z.string(), pointer: z.string() })),
    preview_href: privateHref.nullable(), version_href: privateHref.nullable(),
    input_sha256: hash.nullable(), artifact_hash: hash.nullable(), model_calls: count, cost_usd: z.number().finite().nonnegative(),
  })).min(1).max(11), terminal_count: count, model_calls: count, cost_usd: z.number().finite().nonnegative(), release_ready: z.literal(false),
}).superRefine((run, context) => {
  const terminal = run.items.filter(item => ["BUILT", "BLOCKED", "FAILED"].includes(item.status)).length;
  if (terminal !== run.terminal_count || (run.status === "COMPLETE" && terminal !== run.items.length)
    || new Set(run.items.map(item => item.item_id)).size !== run.items.length) context.addIssue({ code: "custom", message: "Inconsistent run receipt" });
});
const catalogSchema = z.object({
  fixtures: z.array(z.object({ fixture_id: z.string().regex(/^F(?:0[1-9]|1[01])$/), label: z.string().min(1) })).length(11),
  package_sha256: hash, executor_version: z.string().min(1),
}).refine(value => new Set(value.fixtures.map(item => item.fixture_id)).size === 11);

export function validDoorRunId(value: string): boolean { return runId.safeParse(value).success; }

/** One bounded request, never an automatic retry of a possibly applied write. */
async function request(url: string, status: number, body?: unknown, key?: string): Promise<unknown> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 45_000);
  try {
    const response = await fetch(url, {
      method: body === undefined ? "GET" : "POST", credentials: "same-origin", cache: "no-store", signal: abort.signal,
      ...(body === undefined ? {} : { headers: { "Content-Type": "application/json", ...(key ? { "Idempotency-Key": key } : {}) }, body: JSON.stringify(body) }),
    });
    const data: unknown = await response.json().catch(() => null);
    if (response.status !== status) {
      const message = response.status === 401 || response.status === 403 ? "Your session may have ended. Sign in before continuing."
        : response.status === 404 ? "This run was not found. No new run was created by this read."
          : "The request was refused. Read the run again before continuing.";
      const code = z.object({ error: z.string().regex(/^[A-Z][A-Z0-9_]{0,119}$/) }).safeParse(data);
      throw new AdminActionError(code.success ? `${message} (${code.data.error})` : message, response.status);
    }
    return data;
  } catch (error) {
    if (error instanceof AdminActionError) throw error;
    throw new AdminActionError(body === undefined ? "The run could not be read. Its current state is unverified."
      : "Connection lost. The action may have reached the server. Read the run before retrying; creation retries keep the same key.", null);
  } finally { clearTimeout(timer); }
}

function readResponse(value: unknown, expectedId: string): DoorRunView {
  const parsed = z.object({ run: runSchema }).safeParse(value);
  if (!parsed.success || parsed.data.run.run_id !== expectedId) throw new AdminActionError("The server returned an invalid run receipt. Read the run before continuing.", null);
  return parsed.data.run;
}

export const doorRunTransport = {
  async catalog(): Promise<DoorRunFixtureCatalog> {
    const result = catalogSchema.safeParse(await request("/api/admin/page-runs/fixtures", 200));
    if (!result.success) throw new AdminActionError("The fixture catalogue could not be verified. Creation is unavailable.", null);
    return result.data;
  },
  async create(input: DoorRunCreateRequest, key: string): Promise<DoorRunView> {
    const id = `run-${key}`;
    if (!validDoorRunId(id)) throw new AdminActionError("Invalid creation key.", null);
    const reason = z.string().trim().min(3).max(240).safeParse(input.reason);
    if (!reason.success) throw new AdminActionError("Enter a reason between 3 and 240 characters, excluding surrounding spaces.", null);
    return readResponse(await request("/api/admin/page-runs", 202, { ...input, reason: reason.data }, key), id);
  },
  async read(id: string): Promise<DoorRunView> {
    if (!validDoorRunId(id)) throw new AdminActionError("Invalid run address. No request was sent.", null);
    return readResponse(await request(`/api/admin/page-runs/${id}`, 200), id);
  },
  async advance(run: DoorRunView): Promise<DoorRunView> {
    if (!validDoorRunId(run.run_id)) throw new AdminActionError("Invalid run address. No request was sent.", null);
    const next = readResponse(await request(`/api/admin/page-runs/${run.run_id}/advance`, 200, { expected_revision: run.revision }), run.run_id);
    if (next.revision <= run.revision) throw new AdminActionError("The run did not advance. Read its current state before resuming.", null);
    return next;
  },
};

export type DoorRunTransport = typeof doorRunTransport;

/** Called only from explicit Create/Resume. Pause takes effect after a request. */
export async function advanceDoorRun(initial: DoorRunView, transport: Pick<DoorRunTransport, "advance">,
  shouldContinue: () => boolean, onReceipt: (run: DoorRunView) => void): Promise<DoorRunView> {
  let run = initial;
  while (shouldContinue() && run.status !== "COMPLETE" && run.resumable && !run.retry_after) {
    run = await transport.advance(run);
    onReceipt(run);
  }
  return run;
}

export async function resumeDoorRun(id: string, transport: Pick<DoorRunTransport, "read" | "advance">,
  shouldContinue: () => boolean, onReceipt: (run: DoorRunView) => void): Promise<DoorRunView> {
  const fresh = await transport.read(id);
  onReceipt(fresh);
  return advanceDoorRun(fresh, transport, shouldContinue, onReceipt);
}

export function doorRunCreation(input: DoorRunCreateRequest, previous: { fingerprint: string; key: string } | null,
  createKey = () => crypto.randomUUID()): { fingerprint: string; key: string } {
  const fingerprint = JSON.stringify({ ...input, opportunity_ids: [...input.opportunity_ids].sort() });
  return previous?.fingerprint === fingerprint ? previous : { fingerprint, key: createKey() };
}
