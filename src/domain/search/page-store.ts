import type { PageSpec } from "@/domain/search/pages";
import { SAMPLE_PAGE_SPEC } from "@/domain/search/fixtures/sample-page-spec";
import { readDevDb } from "@/platform/stores/dev-db";

/**
 * Staged/published PageSpec lookup for rendering. Fixtures + dev runtime now;
 * Supabase-backed at the same interface once the project exists (OWNER_TODO).
 * PUBLISHED lookups return nothing until the owner publishes — there is no
 * code path that publishes without the explicit owner action (canon).
 */
export function listStagedSpecs(): PageSpec[] {
  return [SAMPLE_PAGE_SPEC, ...readDevDb().staged_specs];
}

export function findStagedByPath(canonicalPath: string): PageSpec | null {
  return listStagedSpecs().find((s) => s.canonical_path === canonicalPath) ?? null;
}

export function findPublishedByPath(_canonicalPath: string): PageSpec | null {
  // Nothing is published in the trial yet; PUBLISHED status requires the
  // owner publish action which does not exist as a runtime yet.
  return null;
}
