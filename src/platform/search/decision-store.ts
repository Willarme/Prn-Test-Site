import type { SupabaseClient } from "@supabase/supabase-js";
import { OpportunityDecision } from "@/domain/search/decision";
import {
  serviceClientProvider,
  type PlatformClientProvider,
} from "@/platform/db/client";
import { readDevDb, updateDevDb } from "@/platform/stores/dev-db";

/**
 * A04's owner-decision store — the same two-backend pattern A09 uses
 * (platform/quality/store.ts), for the same reason and with the same honesty
 * about which half of the fail-soft/fail-loud line each write sits on.
 *
 * WHY NOT THE A00 IN-PROCESS-BUFFER PATTERN. approvals/center.ts and
 * runs/ledger.ts keep an in-process buffer and log a miss when no database is
 * configured. Correct for telemetry; wrong here. An owner clicks "accept",
 * A05's gate reads `status === "approved"` on the next request, and an
 * in-process-only decision would be gone — the owner would see their decision
 * evaporate, or worse, see it hold in dev and vanish in deployment. So this
 * store persists in BOTH configurations and a write that does not land THROWS,
 * so the route can tell the owner their click did not take.
 *
 * WHY NOT EXTEND OpportunityStore. `OpportunityStore` (stores/interfaces.ts) is
 * upsert/getByKeyword/list over the whole record and its only implementation is
 * in-memory. Bolting decisions onto it would mean either making the committed
 * artifact writable (it is regenerated wholesale by `npm run factory`) or
 * shipping a second full opportunity table. Decisions are their own append-only
 * records referencing search_opportunity_id — an overlay, not a parallel
 * opportunities table (Loop Spec Audit condition C9/C14).
 *
 * APPEND-ONLY. There is no update and no delete. Changing your mind writes a
 * NEW decision; the effective status is the fold (domain/search/decision.ts).
 *
 * CLIENT INJECTABLE. The factory ACCEPTS a PlatformClientProvider rather than
 * importing the service client (RLS seam, C7).
 */

export interface OpportunityDecisionStore {
  readonly kind: "supabase" | "file";
  append(decision: OpportunityDecision): Promise<void>;
  list(): Promise<OpportunityDecision[]>;
}

/**
 * A write that does not land must say what to DO about it, not just what
 * PostgREST said. Found by running the real app: with Supabase configured from
 * .env.local and migration 00011 written-but-not-applied, an owner clicking
 * "Accept" got a raw `Could not find the table 'public.opportunity_decision' in
 * the schema cache` and a 500. The discipline was right — the decision must
 * never be silently lost — but the message told the owner nothing actionable.
 * Every other platform module names its migration in its miss log; this one
 * now does too.
 *
 * The unit tests could not have caught this: they inject `() => null` as the
 * client provider, which selects the FILE backend, so the Supabase path was
 * never exercised until the app actually ran.
 */
const MIGRATION = "supabase/migrations/00011_opportunity_decision.sql";

/**
 * `kind` added by the A05 build, found by running the real app. Both paths
 * shared one message, so a failed LIST — a pure read — reported "Your decision
 * was NOT recorded." A05's generate route quotes this cause verbatim to the
 * owner, and a read failure claiming a lost write is a message that
 * contradicts itself at exactly the moment someone is trying to understand
 * what went wrong.
 */
function fail(what: string, message: string, kind: "read" | "write"): never {
  const missingTable = /opportunity_decision/.test(message) && /schema cache|does not exist/i.test(message);
  const consequence =
    kind === "write"
      ? "Your decision was NOT recorded."
      : "No decision could be read, so nothing that depends on your approvals can run.";
  throw new Error(
    missingTable
      ? `${what}: the opportunity_decision table does not exist yet. Apply ${MIGRATION} (written, NOT applied) to enable owner decisions. ${consequence}`
      : `${what}: ${message}`
  );
}

/** Supabase backend — table `opportunity_decision`, migration 00011 (written, NOT applied). */
class SupabaseOpportunityDecisionStore implements OpportunityDecisionStore {
  readonly kind = "supabase" as const;
  constructor(private readonly db: SupabaseClient) {}

  async append(decision: OpportunityDecision): Promise<void> {
    const { error } = await this.db.from("opportunity_decision").insert({
      decision_id: decision.decision_id,
      tenant_id: decision.tenant_id,
      search_opportunity_id: decision.search_opportunity_id,
      decision: decision.decision,
      status_after: decision.status_after,
      decided_by: decision.decided_by,
      decided_at: decision.decided_at,
      note: decision.note,
      recommendation_at_decision: decision.recommendation_at_decision,
      score_at_decision: decision.score_at_decision,
      score_version_at_decision: decision.score_version_at_decision,
      approval_id: decision.approval_id,
      run_id: decision.run_id,
    });
    if (error) fail("record opportunity decision", error.message, "write");
  }

  async list(): Promise<OpportunityDecision[]> {
    const { data, error } = await this.db
      .from("opportunity_decision")
      .select("*")
      .order("decided_at", { ascending: true })
      .limit(2000);
    if (error) fail("list opportunity decisions", error.message, "read");
    return (data ?? []).map((row) => OpportunityDecision.parse(row));
  }
}

/** File backend — the durable store whenever no database is configured. */
class FileOpportunityDecisionStore implements OpportunityDecisionStore {
  readonly kind = "file" as const;

  async append(decision: OpportunityDecision): Promise<void> {
    updateDevDb((db) => {
      db.opportunity_decisions.push(decision);
    });
  }

  async list(): Promise<OpportunityDecision[]> {
    return readDevDb().opportunity_decisions.map((row) => OpportunityDecision.parse(row));
  }
}

export function opportunityDecisionStore(
  clientProvider: PlatformClientProvider = serviceClientProvider
): OpportunityDecisionStore {
  let client: SupabaseClient | null = null;
  try {
    client = clientProvider();
  } catch {
    client = null;
  }
  return client
    ? new SupabaseOpportunityDecisionStore(client)
    : new FileOpportunityDecisionStore();
}
