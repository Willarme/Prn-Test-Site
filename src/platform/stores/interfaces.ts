import type {
  SearchOpportunity,
  SeoMetricSnapshot,
  SerpSnapshot,
} from "@/domain/search/contracts";
import type { SeoFactoryPolicy } from "@/domain/search/policy";
import type { AgentRun } from "@/platform/agents/contracts";
import type { UsageCostEvent } from "@/platform/economics/contracts";

/**
 * Storage interfaces for the door slice. Wave 1 ships in-memory (tests) and
 * JSON-file (local operation) implementations; the Supabase implementation
 * lands when the owner selects the project and migrations are applied. Domain
 * code depends only on these interfaces.
 */
export interface OpportunityStore {
  upsert(opportunity: SearchOpportunity): Promise<void>;
  getByKeyword(keyword: string): Promise<SearchOpportunity | null>;
  list(): Promise<SearchOpportunity[]>;
}

export interface PolicyStore {
  getActive(): Promise<SeoFactoryPolicy>;
  save(policy: SeoFactoryPolicy): Promise<void>;
}

export interface AgentRunStore {
  save(run: AgentRun): Promise<void>;
  findByIdempotencyKey(key: string): Promise<AgentRun | null>;
  list(): Promise<AgentRun[]>;
}

/**
 * Vendor snapshots are evidence: every vendor response persists so the
 * provenance chain opportunity -> snapshot -> vendor call never dangles
 * (#23 §1.2; Wave 1 verification finding).
 */
export interface SnapshotStore {
  saveMetric(snapshot: SeoMetricSnapshot): Promise<void>;
  saveSerp(snapshot: SerpSnapshot): Promise<void>;
  listMetrics(): Promise<SeoMetricSnapshot[]>;
  listSerps(): Promise<SerpSnapshot[]>;
}

export interface CostStore {
  record(event: UsageCostEvent): Promise<void>;
  /** Total estimated spend for a vendor in a calendar month ("YYYY-MM"). */
  monthlySpend(vendor: string, month: string): Promise<number>;
  list(): Promise<UsageCostEvent[]>;
}

// ---------------------------------------------------------------------------
// Loop surfaces (campaign track F2b, 2026-09-05) — the rows behind the scoped
// links, the Home Memory claim, the Trust Network ask, the feedback popup, the
// mail outbox, the job address and the product-page vote. Types only: this
// module has no runtime imports, so both dev-db.ts (the file container) and
// runtime.ts (the store) can name these shapes without a cycle. Every one is
// an append-only ledger row except magic_links (consumed once, in place) —
// nothing here is ever deleted (spec §11.4: revocation kills the link, the
// record is unchanged).
// ---------------------------------------------------------------------------

/** A link the homeowner killed. The link stops resolving; nothing else changes. */
export interface LinkRevocation {
  link_id: string;
  request_id: string;
  revoked_at: string;
}

/** "Keep this" — an identity attached to a record that already exists (§16.1). */
export interface KeepClaim {
  request_id: string;
  contact: string;
  contact_kind: "email" | "phone";
  claimed_at: string;
  magic_link_id: string;
}

/** One-field, no-password sign-in. Consumed exactly once. */
export interface MagicLink {
  magic_id: string;
  request_id: string;
  contact: string;
  created_at: string;
  consumed_at: string | null;
}

/** A friend's answer to the Trust Network ask, given without an account. */
export interface AskAnswer {
  ask_id: string;
  request_id: string;
  friend_name: string;
  friend_contact: string | null;
  provider_name: string;
  provider_contact: string | null;
  reason: string | null;
  created_at: string;
}

/** The feedback popup's four fields (Unique Links and Feedback Popup decisions §2). */
export interface Feedback {
  feedback_id: string;
  request_id: string;
  score: "not_really" | "somewhat" | "very";
  right: string[];
  slow: string | null;
  created_at: string;
}

/**
 * A message in the outbox. `mode: "preview"` is stored and shown at /mail/<id>;
 * `mode: "live"` goes through the provider and records `sent_at` +
 * `provider_id` when it has. Routine decision 8: preview by default.
 */
export interface Email {
  email_id: string;
  /** The journey it belongs to, when it belongs to one. */
  request_id?: string | null;
  to: string;
  subject: string;
  text: string;
  html: string;
  mode: "preview" | "live";
  created_at: string;
  sent_at: string | null;
  provider_id: string | null;
}

/** The job address the packet requires (Directions §3.3; routine decision 10). */
export interface JobAddress {
  street: string;
  city_state_zip: string;
  property_type: string | null;
  storeys: string | null;
}

/** A stored address row: the address plus what it belongs to and when. */
export interface JobAddressRow extends JobAddress {
  request_id: string;
  saved_at: string;
}

/** A vote from one of Melissa's product preview pages (POST /api/signup). */
export interface Signup {
  signup_id: string;
  page: string;
  vote: "yes" | "no";
  name?: string;
  email?: string;
  phone?: string;
  zip?: string;
  reasons?: string[];
  /**
   * The browser's own idempotency key for this vote: a person who fills the
   * form after clicking yes posts twice by design, and the second post
   * CORRECTS the first rather than duplicating it.
   */
  vote_id?: string;
  /** That browser's clock, kept as the page's own claim; created_at is the server's. */
  browser_at?: string | null;
  created_at: string;
}
