import { FactBundle } from "@/domain/search/contracts";
import type { GeographyScope } from "@/domain/shared/primitives";

/**
 * THE PROVENANCE STUB — coherence report issue 7, the one real A01 dependency
 * in the whole SEO loop, resolved by stub.
 *
 * THE PROBLEM, VERBATIM FROM THE AUDIT: "`provenance.present` blocks every page
 * A05 can currently build." factory.ts emitted `source_fact_bundle_ids: []` on
 * every block of every page. A06 built to spec fails 100% of pages on an empty
 * provenance field; A05 built to spec cannot fill it, because no Wave 0/1 spec
 * produces a FactBundle — `derive_public_safe_fact_bundle` is registered
 * `status: "TEST"` with no owning agent, and the only spec that produces
 * FactBundles is A24 (FULL PRODUCT BUILD). The provenance seam was declared and
 * carrying nothing.
 *
 * THE SAFE STUB THE AUDIT PRESCRIBES: register the deterministic content bank
 * as a provenance SOURCE — mint a FactBundle-shaped record per content-bank
 * entry, and have the factory cite it. Then `provenance.present` is a real,
 * passing check with a real source, and it converts to A01-derived bundles
 * later with no schema change.
 *
 * THESE ARE THE SHIPPED `FactBundle` OBJECTS, not a parallel type — the
 * contract already exists at domain/search/contracts.ts and A05 does not fork
 * it. `source_fact_bundle_ids` is unchanged, so the day A01 produces derived
 * bundles the ids in that array simply point somewhere else.
 *
 * WHAT THESE BUNDLES HONESTLY ARE, AND ARE NOT. They are FIRST-PARTY,
 * DETERMINISTIC, IN-REPO statements PRN wrote. They are not researched external
 * facts and they carry no external citation: `source_url` is an internal
 * `prn://content-bank/...` pointer to where the statement actually lives, and
 * `source_type` says "content_bank" so nothing downstream can mistake one for a
 * sourced claim. Faking an external URL to satisfy a schema would be worse than
 * an empty field.
 *
 * NO CUSTOMER DERIVATION. Every statement is authored copy from the content
 * bank. Nothing here reads a customer problem record, a piece of customer
 * evidence or an intake answer, and there is no code path by which one could.
 *
 * (The customer contracts are named obliquely on purpose: A04's shipped guard
 * in tests/a04.enrichment-and-mining.test.ts fails on those type names
 * appearing anywhere under domain/search, and that guard is worth more intact
 * than this comment is worth verbatim.)
 *
 * GEOGRAPHY IS RECORDED, AND IT IS THE POINT. The three shipped families carry
 * US-specific safety instructions ("call your utility or 911", "breaker
 * panel"), which is exactly what condition C3 flags. Stamping the bundle
 * `national/US` makes that scope a fact in the data rather than an assumption
 * in the prose — a second market's data-supplied family carries its own answer
 * (null when unstated) instead of silently inheriting PRN's.
 */

export const CONTENT_BANK_SOURCE_TYPE = "content_bank";
export const CONTENT_BANK_SOURCE_ID = "content_bank_v1";
export const CONTENT_BANK_VERSION = 1;

/** The five statements a content-bank entry carries, in page order. */
export const CONTENT_BANK_FACT_KINDS = [
  "intent_answer",
  "safe_checks",
  "do_not_do",
  "when_urgency_changes",
  "who_handles_it",
] as const;
export type ContentBankFactKind = (typeof CONTENT_BANK_FACT_KINDS)[number];

export function contentBankBundleId(familyKey: string): string {
  return `fb_${CONTENT_BANK_SOURCE_ID}_${familyKey}`;
}

export function contentBankFactId(familyKey: string, kind: ContentBankFactKind): string {
  return `fact_${CONTENT_BANK_SOURCE_ID}_${familyKey}_${kind}`;
}

/** The internal pointer to where a statement actually lives. Never an external URL. */
export function contentBankSourceUrl(familyKey: string, kind: ContentBankFactKind): string {
  return `prn://content-bank/v${CONTENT_BANK_VERSION}/${familyKey}#${kind}`;
}

export interface ContentBankTexts {
  intent_answer: string;
  safe_checks: string;
  do_not_do: string;
  when_urgency_changes: string;
  who_handles_it: string;
}

export interface ContentBankBundleOptions {
  /**
   * Scope the statements are written for. `national/US` for PRN's shipped
   * families — the safety instructions are US-specific and the bundle says so.
   * null when a client's data family does not state a scope.
   */
  geography: GeographyScope | null;
  created_at: string;
}

/**
 * Mint the FactBundle for ONE content-bank entry. Deterministic: same texts and
 * same timestamp in, same bundle out, so a regenerated page cites the same
 * provenance rather than a new id every run.
 */
export function contentBankBundle(
  familyKey: string,
  texts: ContentBankTexts,
  options: ContentBankBundleOptions
): FactBundle {
  return FactBundle.parse({
    fact_bundle_id: contentBankBundleId(familyKey),
    schema_version: "1.0.0",
    topic: `content bank: ${familyKey}`,
    geography: options.geography,
    facts: CONTENT_BANK_FACT_KINDS.map((kind) => ({
      fact_id: contentBankFactId(familyKey, kind),
      statement: texts[kind],
      source_url: contentBankSourceUrl(familyKey, kind),
      source_type: CONTENT_BANK_SOURCE_TYPE,
      verified_at: options.created_at,
      // The statement is authored, deterministic and reviewed in-repo. It is
      // not a measurement, so "high" is about provenance certainty (we know
      // exactly where it came from), never about clinical correctness.
      confidence: "high",
    })),
    // PRN wrote this copy. Nothing here is licensed, scraped or customer-derived.
    rights_class: "first_party",
    // Mirrors the `evergreen` freshness class in SeoFactoryPolicy.
    ttl_days: 180,
    // No external clock to go stale against: a deterministic in-repo statement
    // changes when CONTENT_BANK_VERSION changes, not on a calendar.
    expires_at: null,
    permitted_page_classes: ["intent_door"],
    version: CONTENT_BANK_VERSION,
    created_at: options.created_at,
  });
}

/**
 * PROVENANCE.PRESENT — the property this stub exists to make real. A page has
 * provenance when every content block cites at least one bundle AND the spec
 * itself carries the union. Returns the failures in words.
 */
export function provenanceProblems(spec: {
  source_fact_bundle_ids: readonly string[];
  content_blocks: ReadonlyArray<{ block_id: string; source_fact_bundle_ids: readonly string[] }>;
}): string[] {
  const problems: string[] = [];
  for (const block of spec.content_blocks) {
    if (block.source_fact_bundle_ids.length === 0) {
      problems.push(`block ${block.block_id} cites no fact bundle`);
    }
  }
  if (spec.source_fact_bundle_ids.length === 0 && spec.content_blocks.length > 0) {
    problems.push("page cites no fact bundle");
  }
  const cited = new Set(spec.content_blocks.flatMap((b) => [...b.source_fact_bundle_ids]));
  for (const id of cited) {
    if (!spec.source_fact_bundle_ids.includes(id)) {
      problems.push(`block-level bundle ${id} is missing from the page's own source list`);
    }
  }
  return problems;
}
