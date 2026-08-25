import { randomUUID } from "node:crypto";
import { z } from "zod";
import { IsoDateTime } from "@/domain/shared/primitives";
import { AgentId } from "@/platform/agents/contracts";
import { ApprovalKind } from "@/platform/approvals/kinds";
import {
  serviceClientProvider,
  type PlatformClientProvider,
} from "@/platform/db/client";
import { runtimeStore } from "@/platform/stores/runtime";

/**
 * A00 Approval Center (spec §4, §9 step 7) — ONE owner-facing queue for
 * anything that needs a human "yes": what happened, evidence, impact, risk,
 * reversibility, the exact proposed change.
 *
 * Wave 0 ships the schema, the queue operations, and a minimal admin list
 * view — and the queue is EXPECTED to be empty: no Wave-0/1 agent produces an
 * approval-requiring action yet. The first real consumer is A06 (Page
 * Quality & Release, Wave 2), whose publish gate should attach HERE instead
 * of building its own toggle.
 *
 * DELIBERATELY DISCONNECTED from the existing /admin Pages approve/publish
 * flow: migrating that flow onto this queue is A06's job (Wave 2), explicitly
 * out of scope for A00 — flagged as a follow-up for whoever builds A06.
 *
 * Mutation discipline (spec §5): rows mutate ONLY on status/resolved_*; a
 * resolution also appends to the owner audit trail (runtimeStore.appendAudit,
 * the existing owner-action audit mechanism) so the decision itself is
 * auditable — no new event names invented pending A08.
 *
 * Persistence: the `approval_item` table
 * (supabase/migrations/00007_approval_center.sql — applied 2026-08-25).
 * Writes stay FAIL-SOFT anyway — in-process queue + logged miss when the
 * database is unreachable or unconfigured — so the admin view works either way.
 * That path is now defence-in-depth rather than the expected state
 * (PLATFORM_MIGRATIONS_APPLIED in platform/db/client.ts).
 * Client injectable per RLS-seam condition (d).
 */
export const ApprovalStatus = z.enum([
  "PENDING",
  "APPROVED",
  "MODIFIED",
  "REJECTED",
  "DO_NOT_ASK_AGAIN_FOR_CLASS",
]);
export type ApprovalStatus = z.infer<typeof ApprovalStatus>;

export const ApprovalItem = z.object({
  approval_id: z.string().min(1),
  agent_id: AgentId,
  /** Reserved — white-label approval condition (a), 2026-08-24. Default "prn"; NO tenant logic. */
  tenant_id: z.string().min(1).optional(),
  /** Links back to the AgentRunRecord that produced this ask. */
  run_id: z.string().min(1),
  /**
   * A08 ADDITION, 2026-08-24 — the item taxonomy (coherence report issue 14).
   * OPTIONAL, therefore ADDITIVE, therefore not a break: every item written
   * before this existed still parses and every existing reader is untouched.
   * See approvals/kinds.ts for the vocabulary and the carrier rationale; the
   * column is added in migration 00009.
   */
  approval_kind: ApprovalKind.optional(),
  what_happened: z.string().min(1),
  /** IDs and summaries only — never raw customer evidence. */
  evidence: z.unknown(),
  recommendation: z.string().optional(),
  impact: z.string().min(1),
  risk: z.string().min(1),
  reversibility: z.enum(["reversible", "hard-to-reverse", "irreversible"]),
  proposed_change: z.unknown(),
  status: ApprovalStatus,
  resolved_by: z.string().optional(),
  resolved_at: IsoDateTime.optional(),
  created_at: IsoDateTime,
});
export type ApprovalItem = z.infer<typeof ApprovalItem>;

export type ApprovalInput = Omit<
  ApprovalItem,
  "approval_id" | "status" | "resolved_by" | "resolved_at" | "created_at" | "tenant_id"
> & { tenant_id?: string };

const queue: ApprovalItem[] = [];

let missLogged = false;
function logMiss(reason: string): void {
  if (missLogged) return;
  missLogged = true;
  console.warn(
    `[a00-approvals] durable write unavailable (${reason}) — queue is in-process only. ` +
      "Apply supabase/migrations/00007_approval_center.sql to enable persistence."
  );
}

function now(): string {
  return new Date().toISOString().replace(/\.\d+Z$/, "Z");
}

/** Queue one approval ask. Never throws; fail-soft persistence. */
export async function queueApproval(
  input: ApprovalInput,
  clientProvider: PlatformClientProvider = serviceClientProvider
): Promise<ApprovalItem> {
  const item: ApprovalItem = ApprovalItem.parse({
    ...input,
    approval_id: `ap_${randomUUID()}`,
    tenant_id: input.tenant_id ?? "prn",
    status: "PENDING",
    created_at: now(),
  });
  queue.push(item);
  try {
    const client = clientProvider();
    if (!client) {
      logMiss("no database configured");
      return item;
    }
    const { error } = await client.from("approval_item").insert({
      approval_id: item.approval_id,
      agent_id: item.agent_id,
      tenant_id: item.tenant_id,
      run_id: item.run_id,
      approval_kind: item.approval_kind ?? null,
      what_happened: item.what_happened,
      evidence: item.evidence ?? null,
      recommendation: item.recommendation ?? null,
      impact: item.impact,
      risk: item.risk,
      reversibility: item.reversibility,
      proposed_change: item.proposed_change ?? null,
      status: item.status,
      created_at: item.created_at,
    });
    if (error) logMiss(error.message);
  } catch (err) {
    logMiss(err instanceof Error ? err.message : String(err));
  }
  return item;
}

/** List the queue, newest first. ADMIN-GATED readers only — never a public route. */
export async function listApprovals(
  clientProvider: PlatformClientProvider = serviceClientProvider
): Promise<ApprovalItem[]> {
  try {
    const client = clientProvider();
    if (client) {
      const { data, error } = await client
        .from("approval_item")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);
      if (!error && data) {
        // DB nulls → undefined so optional fields parse.
        return data.map((row) => {
          const clean = Object.fromEntries(
            Object.entries(row as Record<string, unknown>).filter(([, v]) => v !== null)
          );
          return ApprovalItem.parse(clean);
        });
      }
      if (error) logMiss(error.message);
    }
  } catch (err) {
    logMiss(err instanceof Error ? err.message : String(err));
  }
  return [...queue].reverse();
}

/**
 * Resolve one item — the ONLY permitted mutation, and only on
 * status/resolved_* fields. The decision is itself recorded on the owner
 * audit trail.
 */
export async function resolveApproval(
  approvalId: string,
  resolution: { status: Exclude<ApprovalStatus, "PENDING">; resolved_by: string },
  clientProvider: PlatformClientProvider = serviceClientProvider
): Promise<ApprovalItem | null> {
  const item = queue.find((i) => i.approval_id === approvalId);
  if (!item || item.status !== "PENDING") return null;
  item.status = resolution.status;
  item.resolved_by = resolution.resolved_by;
  item.resolved_at = now();

  try {
    const client = clientProvider();
    if (client) {
      const { error } = await client
        .from("approval_item")
        .update({
          status: item.status,
          resolved_by: item.resolved_by,
          resolved_at: item.resolved_at,
        })
        .eq("approval_id", approvalId);
      if (error) logMiss(error.message);
    } else {
      logMiss("no database configured");
    }
  } catch (err) {
    logMiss(err instanceof Error ? err.message : String(err));
  }

  // The decision is an audit event, not a silent overwrite (spec §5).
  try {
    await runtimeStore().appendAudit({
      at: item.resolved_at,
      action: `approval.${resolution.status.toLowerCase()}`,
      target: approvalId,
      detail: `agent ${item.agent_id}, run ${item.run_id}, by ${resolution.resolved_by}`,
    });
  } catch {
    /* telemetry never blocks the decision */
  }
  return item;
}

/** Test seam. */
export function resetApprovalCenterForTests(): void {
  queue.length = 0;
  missLogged = false;
}
