import type {
  SearchOpportunity,
  SeoMetricSnapshot,
  SerpSnapshot,
} from "@/domain/search/contracts";
import { SeoFactoryPolicy, TRIAL_DEFAULT_SEO_FACTORY_POLICY } from "@/domain/search/policy";
import type { AgentRun } from "@/platform/agents/contracts";
import type { UsageCostEvent } from "@/platform/economics/contracts";
import type {
  AgentRunStore,
  CostStore,
  OpportunityStore,
  PolicyStore,
  SnapshotStore,
} from "@/platform/stores/interfaces";

export class InMemoryOpportunityStore implements OpportunityStore {
  private byKeyword = new Map<string, SearchOpportunity>();

  async upsert(opportunity: SearchOpportunity): Promise<void> {
    this.byKeyword.set(opportunity.keyword, opportunity);
  }

  async getByKeyword(keyword: string): Promise<SearchOpportunity | null> {
    return this.byKeyword.get(keyword) ?? null;
  }

  async list(): Promise<SearchOpportunity[]> {
    return [...this.byKeyword.values()];
  }
}

export class InMemoryPolicyStore implements PolicyStore {
  private active: SeoFactoryPolicy;

  constructor(initial: SeoFactoryPolicy = TRIAL_DEFAULT_SEO_FACTORY_POLICY) {
    this.active = initial;
  }

  async getActive(): Promise<SeoFactoryPolicy> {
    return this.active;
  }

  async save(policy: SeoFactoryPolicy): Promise<void> {
    // Re-validate on save so no caller can persist a policy that bypasses
    // trial invariants (owner approval, target<=max, geography rules).
    this.active = SeoFactoryPolicy.parse(policy);
  }
}

export class InMemoryAgentRunStore implements AgentRunStore {
  private runs = new Map<string, AgentRun>();

  async save(run: AgentRun): Promise<void> {
    this.runs.set(run.agent_run_id, run);
  }

  async findByIdempotencyKey(key: string): Promise<AgentRun | null> {
    for (const run of this.runs.values()) {
      if (run.idempotency_key === key && run.status === "completed") return run;
    }
    return null;
  }

  async list(): Promise<AgentRun[]> {
    return [...this.runs.values()];
  }
}

export class InMemorySnapshotStore implements SnapshotStore {
  private metrics: SeoMetricSnapshot[] = [];
  private serps: SerpSnapshot[] = [];

  async saveMetric(snapshot: SeoMetricSnapshot): Promise<void> {
    this.metrics.push(snapshot);
  }

  async saveSerp(snapshot: SerpSnapshot): Promise<void> {
    this.serps.push(snapshot);
  }

  async listMetrics(): Promise<SeoMetricSnapshot[]> {
    return [...this.metrics];
  }

  async listSerps(): Promise<SerpSnapshot[]> {
    return [...this.serps];
  }
}

export class InMemoryCostStore implements CostStore {
  private events: UsageCostEvent[] = [];

  async record(event: UsageCostEvent): Promise<void> {
    this.events.push(event);
  }

  async monthlySpend(vendor: string, month: string): Promise<number> {
    return this.events
      .filter((e) => e.vendor === vendor && e.occurred_at.startsWith(month))
      .reduce((sum, e) => sum + e.estimated_cost_usd, 0);
  }

  async list(): Promise<UsageCostEvent[]> {
    return [...this.events];
  }
}
