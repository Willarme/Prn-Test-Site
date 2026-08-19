import type { PageSpec } from "@/domain/search/pages";
import { allStagedSpecs, publishedPageIds } from "@/platform/admin/data";

/**
 * Staged/published PageSpec lookup for rendering.
 * PUBLISHED = the owner pressed Publish in Admin on a QA-PASS page (recorded
 * in the runtime store). There is no other path to PUBLISHED (canon).
 */
export function listStagedSpecs(): PageSpec[] {
  return allStagedSpecs();
}

export function findStagedByPath(canonicalPath: string): PageSpec | null {
  return listStagedSpecs().find((s) => s.canonical_path === canonicalPath) ?? null;
}

export function findPublishedByPath(canonicalPath: string): PageSpec | null {
  const published = publishedPageIds();
  return (
    listStagedSpecs().find(
      (s) => s.canonical_path === canonicalPath && published.has(s.page_id) && s.qa.state === "PASS"
    ) ?? null
  );
}
