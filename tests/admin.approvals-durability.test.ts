import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlatformClientProvider } from "@/platform/db/client";
import {
  queueApproval, readApprovalSnapshot, resetApprovalCenterForTests, resolveApproval,
} from "@/platform/approvals/center";

const audit = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@/platform/stores/runtime", () => ({ runtimeStore: () => ({ appendAudit: audit }) }));

const input = {
  agent_id: "A09", run_id: "ar_synthetic_restart", approval_kind: "data.repair" as const,
  what_happened: "Synthetic missing reference", evidence: { issue_id: "qi_synthetic" },
  recommendation: "Review the exact reversible repair", impact: "One synthetic record",
  risk: "Bounded repair", reversibility: "reversible" as const,
  proposed_change: { before: ["ev_a", ""], after: ["ev_a"] },
};

/** In-memory stand-in for PostgREST's atomic UPDATE ... WHERE ... RETURNING.
 * The process queue is reset independently of this durable row map. */
function database() {
  const rows = new Map<string, Record<string, unknown>>();
  let failed = false;
  const client = {
    from(table: string) {
      expect(table).toBe("approval_item");
      let changes: Record<string, unknown> | null = null;
      const conditions = new Map<string, unknown>();
      const builder = {
        async insert(row: Record<string, unknown>) {
          if (failed) return { error: { message: "Synthetic unavailable database" } };
          rows.set(String(row.approval_id), structuredClone(row));
          return { error: null };
        },
        update(value: Record<string, unknown>) { changes = value; return builder; },
        eq(key: string, value: unknown) { conditions.set(key, value); return builder; },
        select() { return builder; },
        order() { return builder; },
        async limit() {
          return failed ? { data: null, error: { message: "Synthetic read failure" } }
            : { data: [...rows.values()].map(row => structuredClone(row)), error: null };
        },
        async maybeSingle() {
          await Promise.resolve(); // Let competing requests reach the same DB boundary.
          if (failed) return { data: null, error: { message: "Synthetic write failure" } };
          const row = [...rows.values()].find(value => [...conditions].every(([key, wanted]) => value[key] === wanted));
          if (!row) return { data: null, error: null };
          if (changes) Object.assign(row, changes);
          return { data: structuredClone(row), error: null };
        },
      };
      return builder;
    },
  };
  return { rows, fail: () => { failed = true; }, provider: (() => client) as unknown as PlatformClientProvider };
}

beforeEach(() => { resetApprovalCenterForTests(); audit.mockClear(); });

describe("approval resolution survives process boundaries", () => {
  it("resolves a persisted pending item after the entire process queue was lost", async () => {
    const db = database();
    const item = await queueApproval(input, db.provider);
    resetApprovalCenterForTests();
    expect((await readApprovalSnapshot(db.provider)).items[0].status).toBe("PENDING");
    const resolved = await resolveApproval(item.approval_id, { status: "APPROVED", resolved_by: "owner:synthetic" }, db.provider);
    expect(resolved).toMatchObject({ approval_id: item.approval_id, status: "APPROVED", evidence: input.evidence, proposed_change: input.proposed_change });
    expect(db.rows.get(item.approval_id)).toMatchObject({ status: "APPROVED", resolved_by: "owner:synthetic" });
    expect(audit).toHaveBeenCalledTimes(1);
    resetApprovalCenterForTests();
    expect((await readApprovalSnapshot(db.provider)).items[0].status).toBe("APPROVED");
  });

  it("allows exactly one concurrent approve/reject and audits only that committed decision", async () => {
    const db = database();
    const item = await queueApproval(input, db.provider);
    const results = await Promise.all([
      resolveApproval(item.approval_id, { status: "APPROVED", resolved_by: "owner:one" }, db.provider),
      resolveApproval(item.approval_id, { status: "REJECTED", resolved_by: "owner:two" }, db.provider),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    const winner = results.find(Boolean)!;
    expect(db.rows.get(item.approval_id)?.status).toBe(winner.status);
    expect(audit).toHaveBeenCalledTimes(1);
  });

  it("does not authorize from a stale pending cache after another instance rejected the row", async () => {
    const db = database();
    const item = await queueApproval(input, db.provider);
    Object.assign(db.rows.get(item.approval_id)!, { status: "REJECTED", resolved_by: "owner:other", resolved_at: new Date().toISOString() });
    expect(await resolveApproval(item.approval_id, { status: "APPROVED", resolved_by: "owner:stale" }, db.provider)).toBeNull();
    expect(db.rows.get(item.approval_id)?.status).toBe("REJECTED");
    expect(audit).not.toHaveBeenCalled();
  });

  it("a failed or missing durable write leaves the cached item pending and returns no approval", async () => {
    const db = database();
    const item = await queueApproval(input, db.provider);
    db.fail();
    expect(await resolveApproval(item.approval_id, { status: "APPROVED", resolved_by: "owner:test" }, db.provider)).toBeNull();
    expect((await readApprovalSnapshot(() => null)).items[0].status).toBe("PENDING");
    expect(await readApprovalSnapshot(db.provider)).toMatchObject({ source: "this process", verified: false });
    expect(audit).not.toHaveBeenCalled();
  });

  it("never falls back to authorizing a cached item when the configured client throws", async () => {
    const item = await queueApproval(input, () => null);
    expect(await resolveApproval(item.approval_id, { status: "APPROVED", resolved_by: "owner:test" }, () => { throw new Error("Synthetic config failure"); })).toBeNull();
    expect((await readApprovalSnapshot(() => null)).items[0].status).toBe("PENDING");
    expect(audit).not.toHaveBeenCalled();
  });

  it("labels local approvals as process-scoped and does not invent persistence after restart", async () => {
    await queueApproval(input, () => null);
    expect(await readApprovalSnapshot(() => null)).toMatchObject({ source: "this process", verified: true, items: [{ status: "PENDING" }] });
    resetApprovalCenterForTests();
    expect((await readApprovalSnapshot(() => null)).items).toEqual([]);
  });
});
