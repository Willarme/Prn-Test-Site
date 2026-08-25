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

/**
 * THE NEWEST VERSION WINS — added by the A05 build, found by editing a page in
 * the running app.
 *
 * These lookups used `.find()`, which returns the FIRST match. That was correct
 * while every canonical path had exactly one PageSpec, and it silently stopped
 * being correct the moment A05 could produce a second version of a page: an
 * owner edited a page's copy, clicked Preview, and was shown their OLD text,
 * because v1 sits before v2 in the list. The registry row already knew which
 * spec was current; this read path predates the registry and never asked.
 *
 * Highest `version` wins, last occurrence on a tie. With one version per path —
 * which is every page in the committed portfolio — this returns exactly the
 * object `.find()` returned, so nothing about the shipped seven changes.
 */
export function newestByVersion(specs: PageSpec[]): PageSpec | null {
  if (specs.length === 0) return null;
  return specs.reduce((best, s) => (s.version >= best.version ? s : best));
}

export async function findStagedByPath(canonicalPath: string): Promise<PageSpec | null> {
  const specs = await listStagedSpecs();
  return newestByVersion(specs.filter((s) => s.canonical_path === canonicalPath));
}

export async function findPublishedByPath(canonicalPath: string): Promise<PageSpec | null> {
  const [specs, published] = await Promise.all([listStagedSpecs(), publishedPageIds()]);
  return newestByVersion(
    specs.filter(
      (s) => s.canonical_path === canonicalPath && published.has(s.page_id) && s.qa.state === "PASS"
    )
  );
}
