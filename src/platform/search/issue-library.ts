import { DEFAULT_TENANT_ID } from "@/domain/problem/contracts";
import { IntentPage, PageSpec } from "@/domain/search/pages";
import { newestByVersion } from "@/domain/search/page-store";
import { allStagedSpecs, publishedPageIds } from "@/platform/admin/data";
import { DEFAULT_FLAGS } from "@/platform/flags";
import { featureIsLive, type FeatureSnapshot } from "@/platform/features/state";
import { isRetiredLegacySpec } from "@/platform/pages/route-retirement";
import type { PageCorpus } from "./page-corpus";
import { pageRegistryStore } from "./page-registry-store";
import { FIXED_DOORS, ISSUE_LIBRARY_FAMILIES, loadFixedDoors, type FixedDoorAsset } from "./fixed-door-registry";
import { loadDoorV44PublicSelection } from "@/platform/pages/door-v44-runtime-public";
import type { DoorV44PublicSelection } from "@/platform/pages/door-v44-public-response";

export interface IssueLibraryDoor { id: string; path: string; label: string; kind: "published_spec" | "fixed_asset" | "selected_artifact" }
export interface IssueLibraryFamily { id: string; label: string; path: string; doors: IssueLibraryDoor[] }
export interface IssueLibraryData { families: IssueLibraryFamily[]; registry_available: boolean }
export interface IssueLibraryInput {
  corpus: PageCorpus; published: ReadonlySet<string>; fixed: readonly FixedDoorAsset[]; snapshot: FeatureSnapshot; seo_doors_enabled: boolean;
  selection?: DoorV44PublicSelection;
}
const canonicalDoor = (path: string) => /^\/problems\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(path);
const tenant = (record: { tenant_id?: string }) => record.tenant_id ?? DEFAULT_TENANT_ID;
const sort = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
function selectedByRuntime(input: IssueLibraryInput, path: string): PageSpec | null {
  try {
    // Select before validation: discarding a newer malformed record could falsely
    // advertise an older valid version that the actual route does not select.
    return newestByVersion(input.corpus.specs.filter(row => row.canonical_path === path && !isRetiredLegacySpec(row)
      && input.published.has(row.page_id) && row.qa.state === "PASS"));
  } catch { return null; }
}

/** Navigation membership only, never publication or indexability. Generic runtime
 * selects newest PASS by published page ID; registry selects current_page_spec_id.
 * Both must agree. Their upstream reconciliation remains open. The fixed reviewed
 * asset bridge is a separate source kind, not a fabricated published registry row. */
export function selectIssueLibrary(input: IssueLibraryInput): IssueLibraryFamily[] {
  if (!featureIsLive(input.snapshot, "door_pages")) return [];
  const families = ISSUE_LIBRARY_FAMILIES.map(family => ({ id: family.id, label: family.label, path: family.path, doors: [] as IssueLibraryDoor[] }));
  for (const fixed of input.fixed) {
    const registration = FIXED_DOORS.find(row => row.id === fixed.id);
    const family = families.find(row => row.id === fixed.family_id);
    if (!registration || !family || tenant(fixed) !== input.snapshot.tenant_id || fixed.canonical_path !== registration.canonical_path
      || fixed.source_sha256_lf !== registration.source_sha256_lf || !fixed.label.trim()) continue;
    family.doors.push({ id: fixed.id, path: fixed.canonical_path, label: fixed.label, kind: "fixed_asset" });
  }
  for (const { entry } of input.selection?.entries ?? []) {
    const family = families.find(row => row.path === entry.family_path);
    if (!family || FIXED_DOORS.some(row => row.canonical_path === entry.canonical_path)) continue;
    family.doors.push({ id: entry.page_id, path: entry.canonical_path, label: entry.label, kind: "selected_artifact" });
  }
  if (input.seo_doors_enabled) {
    const specs = input.corpus.specs.flatMap(spec => { const parsed = PageSpec.safeParse(spec); return parsed.success ? [parsed.data] : []; });
    const pages = input.corpus.pages.flatMap(page => { const parsed = IntentPage.safeParse(page); return parsed.success ? [parsed.data] : []; });
    for (const page of pages) {
      if (page.lifecycle_status !== "PUBLISHED" || !page.published_at || page.retired_at || page.redirect_to_path !== null
        || tenant(page) !== input.snapshot.tenant_id || !canonicalDoor(page.canonical_path)
        || FIXED_DOORS.some(fixed => fixed.canonical_path === page.canonical_path)
        || input.selection?.snapshot.managed.some(row => row.canonical_path === page.canonical_path)
        || pages.filter(other => other.page_id === page.page_id || other.canonical_path === page.canonical_path).length !== 1) continue;
      const candidates = specs.filter(spec => spec.page_spec_id === page.current_page_spec_id);
      if (candidates.length !== 1) continue;
      const spec = candidates[0];
      if (spec.page_id !== page.page_id || spec.canonical_path !== page.canonical_path || tenant(spec) !== tenant(page)
        || !["QA_PASS", "PUBLISHED"].includes(spec.status) || spec.qa.state !== "PASS" || spec.qa.ai_critic?.status === "FAIL"
        || isRetiredLegacySpec(spec) || !input.published.has(spec.page_id)) continue;
      // Match findPublishedByPath. Filtering foreign versions first would conceal
      // a mismatch because the actual public route does not filter by tenant.
      const served = selectedByRuntime(input, page.canonical_path);
      if (!served || !PageSpec.safeParse(served).success || served.page_spec_id !== spec.page_spec_id) continue;
      // hvac also includes heating: require a declared link to the real Cooling
      // index. Do not guess a narrower family from category names or nouns.
      const definition = ISSUE_LIBRARY_FAMILIES.find(family => family.source_family === spec.problem_family
        && spec.internal_links.some(link => link.path.replace(/\/$/, "") === family.path));
      const family = families.find(row => row.id === definition?.id);
      if (!family) continue;
      // IntentPageView's actual H1 is hero.headline, not the separate h1 field.
      family.doors.push({ id: page.page_id, path: page.canonical_path, label: spec.hero.headline, kind: "published_spec" });
    }
  }
  return families.filter(family => family.doors.length > 0).map(family => ({ ...family,
    doors: family.doors.sort((a, b) => sort(a.label, b.label) || sort(a.path, b.path)),
  })).sort((a, b) => b.doors.length - a.doors.length || sort(a.label, b.label));
}

/** No cached directory: each dynamic request reads current publication state. */
export async function loadIssueLibrary(snapshot: FeatureSnapshot): Promise<IssueLibraryData> {
  if (!featureIsLive(snapshot, "door_pages")) return { families: [], registry_available: false };
  // Same underlying corpus readers, with a strict registry read: loadPageCorpus
  // intentionally swallows registry failures for generation duplicate checks.
  const [pages, specs, published, fixed, selection] = await Promise.allSettled([pageRegistryStore().listPages(), allStagedSpecs(), publishedPageIds(), loadFixedDoors(), loadDoorV44PublicSelection(snapshot)]);
  const available = pages.status === "fulfilled" && specs.status === "fulfilled" && published.status === "fulfilled" && selection.status === "fulfilled";
  return { registry_available: available, families: selectIssueLibrary({ snapshot,
    corpus: { pages: pages.status === "fulfilled" ? pages.value : [], specs: specs.status === "fulfilled" ? specs.value : [] },
    published: published.status === "fulfilled" ? published.value : new Set(),
    fixed: fixed.status === "fulfilled" ? fixed.value : [],
    selection: selection.status === "fulfilled" ? selection.value : undefined,
    seo_doors_enabled: available && DEFAULT_FLAGS.some(flag => flag.flag_key === "seo_doors_enabled" && flag.enabled),
  }) };
}
