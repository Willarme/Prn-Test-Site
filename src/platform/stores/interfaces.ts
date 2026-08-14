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
