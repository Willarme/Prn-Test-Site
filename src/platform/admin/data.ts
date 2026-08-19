import path from "node:path";
import type { SearchOpportunity } from "@/domain/search/contracts";
import type { PageSpec } from "@/domain/search/pages";
import { SAMPLE_PAGE_SPEC } from "@/domain/search/fixtures/sample-page-spec";
import { FilePolicyStore } from "@/platform/stores/policy-file";
import { readDevDb } from "@/platform/stores/dev-db";
import opportunitiesJson from "../../../data/factory/opportunities.json";
import stagedJson from "../../../data/factory/staged-specs.json";

/**
 * Read models for the admin dashboard and door rendering. Committed factory
 * output (works everywhere, incl. Vercel without a DB) + runtime dev-db
 * state (local file / ephemeral on Vercel until Supabase — OWNER_TODO).
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

/** All staged specs: the handcrafted sample + factory output + any runtime-staged. */
export function allStagedSpecs(): PageSpec[] {
  const runtime = readDevDb().staged_specs;
  return [SAMPLE_PAGE_SPEC, ...loadStaged().specs, ...runtime];
}

export function publishedPageIds(): Set<string> {
  return new Set(readDevDb().published_page_ids);
}

export function policyStore(): FilePolicyStore {
  return new FilePolicyStore(path.join(process.cwd(), "data", "seo-factory-policy.json"));
}
