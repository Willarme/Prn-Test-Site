import path from "node:path";
import type { SearchOpportunity } from "@/domain/search/contracts";
import type { PageSpec } from "@/domain/search/pages";
import { SAMPLE_PAGE_SPEC } from "@/domain/search/fixtures/sample-page-spec";
import type { PolicyStore } from "@/platform/stores/interfaces";
import { FilePolicyStore } from "@/platform/stores/policy-file";
import { SupabasePolicyStore } from "@/platform/stores/policy-supabase";
import { runtimeStore, supabaseConfigured } from "@/platform/stores/runtime";
import opportunitiesJson from "../../../data/factory/opportunities.json";
import stagedJson from "../../../data/factory/staged-specs.json";

/**
 * Read models for the admin dashboard and door rendering: committed factory
 * output (works with or without a database) plus live runtime state.
 */
export interface FactoryOpportunities {
  generated_at: string;
  summary: {
    total: number;
    by_recommendation: Record<string, number>;
    by_intent: Record<string, number>;
    needs_enrichment: number;
  };
  opportunities: SearchOpportunity[];
}

export interface FactoryStaged {
  generated_at: string;
  specs: PageSpec[];
  skipped: Array<{ keyword: string; reason: string }>;
}

export function loadOpportunities(): FactoryOpportunities {
  return opportunitiesJson as unknown as FactoryOpportunities;
}

export function loadStaged(): FactoryStaged {
  return stagedJson as unknown as FactoryStaged;
}

/** All staged specs: handcrafted sample + committed factory output + runtime. */
export async function allStagedSpecs(): Promise<PageSpec[]> {
  const runtime = await runtimeStore().listStagedSpecs();
  return [SAMPLE_PAGE_SPEC, ...loadStaged().specs, ...runtime];
}

export async function publishedPageIds(): Promise<Set<string>> {
  return runtimeStore().getPublishedPageIds();
}

export function policyStore(): PolicyStore {
  if (supabaseConfigured()) return new SupabasePolicyStore();
  return new FilePolicyStore(path.join(process.cwd(), "data", "seo-factory-policy.json"));
}
