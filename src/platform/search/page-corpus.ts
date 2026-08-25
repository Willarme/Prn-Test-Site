import type { IntentPage, PageSpec } from "@/domain/search/pages";
import { allStagedSpecs } from "@/platform/admin/data";
import {
  serviceClientProvider,
  type PlatformClientProvider,
} from "@/platform/db/client";
import { pageRegistryStore } from "@/platform/search/page-registry-store";

/**
 * THE EXISTING PAGE CORPUS — what "already exists" means to a generation run.
 *
 * Both A05 triggers (the admin route and A04's approval flow) need the same
 * answer to two questions: is this opportunity already a page (idempotency),
 * and would this page cannibalize one that exists (the pre-gate). Asking it in
 * one place means the two triggers cannot disagree.
 *
 * SPECS come from `allStagedSpecs()`, which is already the union of the
 * handcrafted sample, the six committed factory doors and whatever the runtime
 * store holds — including everything A05 writes, since A05's store and the
 * runtime store share the same `staged_specs` collection. That is why a newly
 * generated page appears on /staged/{slug} and the admin Pages table with no
 * extra wiring.
 *
 * PAGES come from the registry. The committed doors predate the registry table
 * and have no rows, which is exactly why the cannibalization pre-gate checks
 * canonical paths against SPECS as well as against registry rows.
 */
export interface PageCorpus {
  pages: IntentPage[];
  specs: PageSpec[];
}

export async function loadPageCorpus(
  clientProvider: PlatformClientProvider = serviceClientProvider
): Promise<PageCorpus> {
  const specs = await allStagedSpecs();
  let pages: IntentPage[] = [];
  try {
    pages = await pageRegistryStore(clientProvider).listPages();
  } catch {
    // A missing registry table must not make the corpus look EMPTY — an empty
    // corpus is the input under which every duplicate check passes. Reading
    // zero pages while still holding every spec keeps the path and intent
    // checks working off the specs alone.
    pages = [];
  }
  return { pages, specs };
}
