import type { PageSpec } from "@/domain/search/pages";
import { allStagedSpecs, publishedPageIds } from "@/platform/admin/data";

/**
 * Staged/published PageSpec lookup for rendering.
 * PUBLISHED = the owner pressed Publish in Admin on a QA-PASS page. There is
 * no other path to PUBLISHED (canon, #14A 15.1 step 8).
 */
export async function listStagedSpecs(): Promise<PageSpec[]> {
  return allStagedSpecs();
}

export async function findStagedByPath(canonicalPath: string): Promise<PageSpec | null> {
  const specs = await listStagedSpecs();
  return specs.find((s) => s.canonical_path === canonicalPath) ?? null;
}

export async function findPublishedByPath(canonicalPath: string): Promise<PageSpec | null> {
  const [specs, published] = await Promise.all([listStagedSpecs(), publishedPageIds()]);
  return (
    specs.find(
      (s) => s.canonical_path === canonicalPath && published.has(s.page_id) && s.qa.state === "PASS"
    ) ?? null
  );
}
