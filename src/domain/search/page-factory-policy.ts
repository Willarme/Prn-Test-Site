import { z } from "zod";
import { Id } from "@/domain/shared/primitives";

/**
 * `policy.page_factory.*` — A05's OWN namespaced sub-block of the runtime
 * SeoFactoryPolicy document (coherence report seam 12: "declare A04 the owner
 * of the object, with A05 and A06 owning namespaced sub-blocks they alone
 * write").
 *
 * WHY THIS STORE AND NOT THE A00 PLATFORM POLICY STORE. Two stores exist with
 * different mutability contracts. `src/platform/policy/store.ts` is a versioned
 * CODE module — changing a value needs a deploy — and its own shipped test
 * asserts every value is a `number` or `boolean` (the precedent A08 hit and
 * documented in platform/events/config.ts). Every value below is a STRING or a
 * record of strings, and every one of them is a per-client decision an owner
 * should be able to change without a deploy. So they belong in the
 * runtime-editable document (`data/seo-factory-policy.json` via FilePolicyStore,
 * or SupabasePolicyStore when configured) — which is exactly what seam 12 says.
 *
 * WHAT MOVED HERE, AND WHAT CHANGED (Loop Spec Audit conditions C2 and C3):
 *
 *   template_id            was hardcoded "tpl_intent_page" at factory.ts:149
 *   canonical_path_prefix  was hardcoded `/problems/${slug}` at factory.ts:120
 *   content_families       new families arrive as DATA, never as another
 *                          hardcoded TypeScript object
 *
 * THE VALUES ARE UNCHANGED. The defaults below are byte-identical to what the
 * literals produced, and `content_families` defaults to empty — so the shipped
 * behaviour is the same behaviour. What changed is WHERE the decision lives:
 * URL taxonomy and template identity are per-client calls in Joshua's
 * per-client-deployment model, and canon's own SEO anti-pattern list bans
 * per-trade hard-coding (Compendium line 324, "no per-trade hard-coding").
 *
 * OVERLAP FLAGGED, NOT DUPLICATED: Master Todo T6-01 (Service Playbook
 * Compiler, "a new trade is data, not code") owns the full version of this
 * seam. This is the narrow A05 half — pages only — so the two do not get built
 * twice in incompatible shapes.
 */

/**
 * One problem family's content-bank entry, as data. The shape mirrors the
 * `FamilyContent` interface in factory.ts exactly, with one difference forced
 * by being data rather than code: `intent_answer` is a template string with a
 * `{keyword}` placeholder instead of a function.
 */
export const FamilyContentData = z.object({
  /** `{keyword}` is substituted with the opportunity's keyword. */
  intent_answer: z.string().min(1),
  safe_checks: z.string().min(1),
  do_not_do: z.string().min(1),
  when_urgency_changes: z.string().min(1),
  who_handles_it: z.string().min(1),
  /**
   * Whether pages in this family require the safety treatment. The shipped
   * hardcoded list is electrical/hvac/water_damage; a data family states its
   * own answer rather than inheriting a US-residential assumption.
   */
  safety_note_required: z.boolean(),
});
export type FamilyContentData = z.infer<typeof FamilyContentData>;

export const PageFactoryPolicy = z.object({
  /** Was the literal at factory.ts:149. Same value. */
  template_id: Id.default("tpl_intent_page"),
  template_version: z.string().min(1).default("1.0.0"),
  /**
   * Was the literal at factory.ts:120. Same value. This is the FINAL PUBLIC
   * path prefix — Loop Spec Audit C6: canonical_path means `/problems/{slug}`
   * and BOTH routes key off it (findStagedByPath serves the staged view from
   * it, findPublishedByPath the live one). It is NEVER a `/staged/` value.
   */
  canonical_path_prefix: z
    .string()
    .regex(/^\/[a-z0-9-]+(\/[a-z0-9-]+)*\/$/, "a lowercase kebab path prefix ending in /")
    .default("/problems/"),
  /**
   * NEW content families, as DATA (C3). Keyed by problem_family.
   *
   * PRECEDENCE: a data family WINS over a hardcoded one of the same key. That
   * is the white-label door — a second client swaps a policy document instead
   * of forking factory.ts — and it is also how the existing US-specific
   * entries ("call your utility or 911", "breaker panel") get corrected for a
   * different market without anyone editing PRN's source.
   *
   * Defaults to empty, so today nothing resolves through it and the shipped
   * hvac/plumbing/electrical entries are untouched, exactly as C3 requires.
   */
  content_families: z.record(FamilyContentData).default({}),
  /**
   * Internal-link resolution rules (A05 §3 step 6). `max_links` is a bound on
   * how many related doors a page may point at; `require_existing_target` is
   * the FAIL-CLOSED switch — an unresolvable target is dropped and reported,
   * never rendered as a link to nowhere. It ships true and there is no reason
   * it should ever be false; it is a field so the failure mode is nameable.
   */
  internal_links: z
    .object({
      max_links: z.number().int().min(0).max(20).default(5),
      require_existing_target: z.literal(true).default(true),
    })
    // Same rule as structured_data below: `{}` so the inner defaults stand.
    .default({}),
  /**
   * Structured-data allow/deny (C12c, restoring the §7 guardrail §11 dropped).
   * The ALLOW list ships EMPTY: factory.ts emits `structured_data_plan: null`
   * today and A05 must not start emitting markup as a side effect of writing
   * the rule down. The DENY list is the part that matters — it is what stops a
   * fake-ratings violation appearing on the one surface it could.
   *
   * PRN Information Structure §12.4 is a DESIGN DRAFT, not canon, so these are
   * recorded as the best current proposal pending Melissa's sign-off.
   */
  structured_data: z
    .object({
      allowed_types: z.array(z.string().min(1)).default([]),
      denied_types: z
        .array(z.string().min(1))
        .default([
          // PRN is not the contractor. Marking up LocalBusiness would claim it is.
          "LocalBusiness",
          "HomeAndConstructionBusiness",
          "Plumber",
          "HVACBusiness",
          "Electrician",
          "RoofingContractor",
          // Nothing PRN can verify today.
          "Review",
          "AggregateRating",
          "Rating",
          "Offer",
          "AggregateOffer",
          "PriceSpecification",
          "OpeningHoursSpecification",
        ]),
    })
    // `.default({})` and NOT a spelled-out object: an outer default REPLACES
    // the inner field defaults wholesale, so `.default({allowed_types: [],
    // denied_types: []})` silently shipped an EMPTY deny list and the
    // LocalBusiness guard never fired. Caught by its own test.
    .default({}),
});
export type PageFactoryPolicy = z.infer<typeof PageFactoryPolicy>;

/** The shipped defaults — byte-identical to the literals they replaced. */
export const DEFAULT_PAGE_FACTORY_POLICY: PageFactoryPolicy = PageFactoryPolicy.parse({});

/**
 * Resolve a family's content from data, or null when the policy carries none.
 * The caller falls back to the shipped hardcoded bank, then to GENERIC.
 */
export function dataFamilyContent(
  policy: PageFactoryPolicy,
  family: string | null
): FamilyContentData | null {
  if (family === null) return null;
  return policy.content_families[family] ?? null;
}
