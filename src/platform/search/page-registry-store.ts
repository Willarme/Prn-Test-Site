import type { SupabaseClient } from "@supabase/supabase-js";
import { IntentPage, PageSpec } from "@/domain/search/pages";
import {
  serviceClientProvider,
  type PlatformClientProvider,
} from "@/platform/db/client";
import { readDevDb, updateDevDb } from "@/platform/stores/dev-db";

/**
 * A05's durable output store — the staged PageSpec and the Page Registry row.
 *
 * TWO BACKENDS, THE SHIPPED PATTERN. Same two-backend shape A04's
 * decision-store and A09's quality store use, and a CLIENT PROVIDER rather than
 * an imported service client (A00 approval condition d / Loop Spec Audit C10).
 * A05's tables hold public page content, not homeowner data, so no
 * request-scoped client is needed today — the seam is the requirement, not the
 * feature.
 *
 * FAIL-LOUD ON THE PAGE ITSELF, fail-soft on everything about it. C11 is
 * precise that A05's AGENT RUN LEDGER writes may silently no-op because
 * migrations 00006+ are written but not applied. The page is different: an
 * admin who triggers a generation run and is told it succeeded, while the page
 * did not persist, has been lied to — the same failure A04 hit by running the
 * real app and fixed by naming the unapplied migration in the error. This store
 * does the same.
 *
 * WHY `staged_page_spec` IS REUSED AND `intent_page` IS NEW. The spec table has
 * existed since migration 00002. The REGISTRY row has no table anywhere in the
 * repo — that is the one genuinely new table A05 needs, and it is why migration
 * 00012 exists rather than being invented for its own sake.
 */

const MIGRATION = "supabase/migrations/00012_page_registry.sql";

function fail(what: string, message: string): never {
  const missingTable = /intent_page/.test(message) && /schema cache|does not exist/i.test(message);
  throw new Error(
    missingTable
      ? `${what}: the intent_page table does not exist yet. Apply ${MIGRATION} (written, NOT applied) to enable the page registry. The page was NOT saved.`
      : `${what}: ${message}`
  );
}

export interface PageRegistryStore {
  readonly kind: "supabase" | "file";
  /** Upsert one staged spec + its registry row together. */
  saveStagedPage(spec: PageSpec, page: IntentPage): Promise<void>;
  listPages(): Promise<IntentPage[]>;
  listSpecs(): Promise<PageSpec[]>;
}

class SupabasePageRegistryStore implements PageRegistryStore {
  readonly kind = "supabase" as const;
  constructor(private readonly db: SupabaseClient) {}

  async saveStagedPage(spec: PageSpec, page: IntentPage): Promise<void> {
    const specResult = await this.db.from("staged_page_spec").upsert({
      page_spec_id: spec.page_spec_id,
      page_id: spec.page_id,
      canonical_path: spec.canonical_path,
      spec,
      created_at: spec.created_at,
    });
    if (specResult.error) fail("save staged page spec", specResult.error.message);

    const pageResult = await this.db.from("intent_page").upsert({
      page_id: page.page_id,
      tenant_id: page.tenant_id ?? "prn",
      canonical_path: page.canonical_path,
      current_page_spec_id: page.current_page_spec_id,
      lifecycle_status: page.lifecycle_status,
      published_at: page.published_at,
      retired_at: page.retired_at,
      redirect_to_path: page.redirect_to_path,
      created_at: page.created_at,
    });
    if (pageResult.error) fail("save page registry row", pageResult.error.message);
  }

  async listPages(): Promise<IntentPage[]> {
    const { data, error } = await this.db.from("intent_page").select("*").limit(2000);
    if (error) fail("list page registry", error.message);
    return (data ?? []).map((row) => IntentPage.parse(row));
  }

  async listSpecs(): Promise<PageSpec[]> {
    const { data, error } = await this.db.from("staged_page_spec").select("spec").limit(2000);
    if (error) fail("list staged specs", error.message);
    return (data ?? []).map((row) => (row as { spec: PageSpec }).spec);
  }
}

/** File backend — durable whenever no database is configured. */
class FilePageRegistryStore implements PageRegistryStore {
  readonly kind = "file" as const;

  async saveStagedPage(spec: PageSpec, page: IntentPage): Promise<void> {
    updateDevDb((db) => {
      const specIndex = db.staged_specs.findIndex((s) => s.page_spec_id === spec.page_spec_id);
      if (specIndex >= 0) db.staged_specs[specIndex] = spec;
      else db.staged_specs.push(spec);

      const pageIndex = db.intent_pages.findIndex((p) => p.page_id === page.page_id);
      if (pageIndex >= 0) db.intent_pages[pageIndex] = page;
      else db.intent_pages.push(page);
    });
  }

  async listPages(): Promise<IntentPage[]> {
    return readDevDb().intent_pages.map((row) => IntentPage.parse(row));
  }

  async listSpecs(): Promise<PageSpec[]> {
    return readDevDb().staged_specs;
  }
}

export function pageRegistryStore(
  clientProvider: PlatformClientProvider = serviceClientProvider
): PageRegistryStore {
  let client: SupabaseClient | null = null;
  try {
    client = clientProvider();
  } catch {
    client = null;
  }
  return client ? new SupabasePageRegistryStore(client) : new FilePageRegistryStore();
}
