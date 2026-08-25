import { z } from "zod";
import {
  GeographyScope,
  Id,
  IsoDateTime,
  SchemaVersion,
} from "@/domain/shared/primitives";
import { PageLifecycleStatus } from "@/domain/search/lifecycle";

export const ContentBlockKind = z.enum([
  "intent_answer",
  "safe_checks",
  "do_not_do",
  "when_urgency_changes",
  "who_handles_it",
  "faq",
  "local_context",
  "custom",
]);

export const ContentBlock = z.object({
  block_id: Id,
  kind: ContentBlockKind,
  heading: z.string().nullable(),
  body_md: z.string().min(1),
  source_fact_bundle_ids: z.array(Id),
});

/**
 * Context a door page passes into the shared intake. This is PRIOR, not truth:
 * A01 is free to classify the problem differently (SEO_DOORS spec, Wave 5).
 */
export const IntakeContext = z.object({
  page_id: Id,
  intent_cluster_id: Id.nullable(),
  search_opportunity_id: Id.nullable(),
  problem_family_hint: z.string().nullable(),
});
export type IntakeContext = z.infer<typeof IntakeContext>;

export const QaState = z.enum(["PENDING", "PASS", "FAIL"]);

/**
 * PageSpec — the structured object A05 produces and the shared template
 * renders (#14A §15.2, patched by #23 §8.1: monetization_eligible,
 * monetization_policy_id, user_value_score, indexed state).
 *
 * DOORS, NOT BRAINS: a PageSpec never contains A01/A02 logic, consent language,
 * diagnostic claims, or private customer data. The intake_context is the ONLY
 * bridge to the engine.
 */
export const PageSpec = z
  .object({
    page_spec_id: Id,
    schema_version: SchemaVersion,
    /**
     * Reserved — white-label condition C1 (A00 approval condition 1 names page
     * templates explicitly), matching the pattern A00 shipped in six platform
     * modules and A04 shipped on SearchOpportunity. Default "prn"; NO tenant
     * logic, routing or UI exists around it.
     *
     * OPTIONAL so the six committed staged specs and the handcrafted sample
     * keep parsing unchanged — adding an optional field is additive, never
     * breaking, and the seven staged doors must render byte-identically.
     */
    tenant_id: z.string().min(1).optional(),
    page_id: Id,
    version: z.number().int().positive(),
    status: PageLifecycleStatus,
    /** Specific search intent this page serves (#14A §10.1/§15.2); the cluster groups related intents. */
    intent_id: Id.nullable(),
    intent_cluster_id: Id,
    search_opportunity_id: Id.nullable(),
    primary_query: z.string().min(1),
    supporting_queries: z.array(z.string()),
    problem_family: z.string().nullable(),
    geography: GeographyScope,
    canonical_path: z.string().regex(/^\/[a-z0-9\-/]*$/, "lowercase kebab path"),
    title: z.string().min(1).max(70),
    meta_description: z.string().min(1).max(170),
    h1: z.string().min(1),
    hero: z.object({
      headline: z.string().min(1),
      subheadline: z.string().nullable(),
    }),
    content_blocks: z.array(ContentBlock).min(1),
    safety_note_required: z.boolean(),
    structured_data_plan: z.string().nullable(),
    internal_links: z.array(
      z.object({
        label: z.string().min(1),
        // Root-relative only, at the schema — the invariant never depends on
        // a downstream QA check (no javascript:/external hrefs possible).
        path: z.string().regex(/^\/[^\s]*$/, "internal links must be root-relative paths"),
      })
    ),
    intake_context: IntakeContext,
    monetization_eligible: z.boolean().default(false),
    monetization_policy_id: Id.nullable(),
    user_value_score: z.number().min(0).max(100).nullable(),
    indexed: z.boolean(),
    noindex_reason: z.string().nullable(),
    template_id: Id,
    template_version: z.string().min(1),
    /** Which experiment/variant this page version belongs to (#14A §15.2). */
    experiment: z.object({
      experiment_id: Id.nullable(),
      variant: z.string().nullable(),
    }),
    generation: z.object({
      model: z.string().nullable(),
      prompt_id: Id.nullable(),
      prompt_version: z.string().nullable(),
    }),
    qa: z.object({ state: QaState, reasons: z.array(z.string()) }),
    source_fact_bundle_ids: z.array(Id),
    created_at: IsoDateTime,
    updated_at: IsoDateTime.nullable(),
  })
  .superRefine((spec, ctx) => {
    if (spec.monetization_eligible && spec.monetization_policy_id === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "monetization_eligible pages must reference a monetization policy (#23 §5.1)",
        path: ["monetization_policy_id"],
      });
    }
    if (spec.monetization_eligible && !spec.indexed) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "ads are only allowed on substantive public (indexed) content pages (#23 §5.1)",
        path: ["monetization_eligible"],
      });
    }
    if (!spec.indexed && spec.noindex_reason === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "non-indexed pages must record a noindex_reason",
        path: ["noindex_reason"],
      });
    }
  });
export type PageSpec = z.infer<typeof PageSpec>;

/** The published-page registry entry; PageSpecs version it. */
export const IntentPage = z.object({
  page_id: Id,
  schema_version: SchemaVersion,
  /** Reserved — white-label condition C1. Default "prn"; NO tenant logic. */
  tenant_id: z.string().min(1).optional(),
  canonical_path: z.string().min(1),
  current_page_spec_id: Id.nullable(),
  lifecycle_status: PageLifecycleStatus,
  published_at: IsoDateTime.nullable(),
  retired_at: IsoDateTime.nullable(),
  redirect_to_path: z.string().nullable(),
  created_at: IsoDateTime,
});
export type IntentPage = z.infer<typeof IntentPage>;
