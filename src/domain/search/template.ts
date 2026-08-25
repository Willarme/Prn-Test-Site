import { z } from "zod";
import { Id, IsoDateTime, SchemaVersion } from "@/domain/shared/primitives";
import { ContentBlockKind } from "@/domain/search/pages";

/**
 * TemplateSpec — THE CONTAINER, NOT THE CHOICE (Loop Spec Audit pre-answers 1
 * and 2, both tagged melissa-park).
 *
 * ⚠ TODO-ASK-OWNER (Melissa). Two questions are PARKED here and are not
 * answered by this file, this build, or any default in it:
 *
 *   1. WHICH TEMPLATE SHAPE. The currently-staged door template (usually
 *      means / safe to check / what not to do / urgent / who handles) or the
 *      spec-14 problem template (direct answer / safety / what changes the
 *      answer / local context / intake / what you get / SmartQuote links)?
 *      Conflict C5. No template is owner-approved — Melissa is on record,
 *      verbatim, "I'm not approving these templates yet" (Compendium line
 *      290). Master Todo T1-27 is her lane, and T1-08's gate reads
 *      "template-shape decision must be made before pages can LEAVE NOINDEX",
 *      so the decision blocks GOING LIVE, not this build.
 *
 *   2. WHERE THE INTAKE BOX SITS. High, immediately after the H1 and a short
 *      outcome promise (per the UNAPPROVED Engine Design Notes), or after
 *      several educational sections as it sits today? That is homeowner
 *      experience and conversion psychology in one question, inside the same
 *      template approval as (1). The marketing v1 AC mockup that pulls intake
 *      into the first viewport is explicitly NOT the live door template
 *      (Compendium trap 46).
 *
 * SO THIS FILE BUILDS THE CONTAINER AND DECLINES BOTH QUESTIONS. A TemplateSpec
 * is a VERSION STRING plus an ORDERED LIST OF TYPED BLOCK SLOTS, and nothing
 * else — no PRN-specific shape is baked into the type. Either candidate shape,
 * or a white-label client's own, encodes as data later with no redesign:
 * reordering the array reorders the page, and `intake_placement` makes the
 * answer to question (2) a config edit rather than a rebuild.
 *
 * NOTHING RENDERS FROM THIS YET, DELIBERATELY. `IntentPageView` is untouched
 * and still renders `spec.content_blocks` in array order. Registering
 * tpl_intent_page below is DESCRIPTIVE: it says, in data, exactly what the
 * shipped factory already produces and the shipped renderer already draws, so
 * the seven staged pages render byte-identically. `templateMatchesBlocks()`
 * plus its test is the thing that stops the description from silently drifting
 * away from the code. Driving the renderer FROM a TemplateSpec is the change
 * that must wait for an owner-approved shape — doing it now would be choosing
 * one, in code, while claiming to have parked the choice.
 */

/**
 * One slot in a template. `kind` is the SHIPPED ContentBlockKind enum — A05
 * never forks the block vocabulary A06 reads (coherence report issue 8).
 * `custom_key` gives a `custom` slot a stable identity, which is what makes an
 * unforeseen client shape ("what you get", "SmartQuote links") expressible
 * without adding a member to a contract other agents parse.
 */
export const TemplateBlockSlot = z.object({
  slot_id: Id,
  kind: ContentBlockKind,
  /** Required only for kind "custom": the client-side name for this slot. */
  custom_key: z.string().min(1).nullable(),
  /** Owner-facing label for the admin surface. Never customer-visible copy. */
  label: z.string().min(1),
  /**
   * The heading the shipped content bank puts on this block, recorded so the
   * template DESCRIBES the page rather than merely listing kinds. null means
   * the writer supplies one.
   */
  default_heading: z.string().nullable(),
  /** A page missing a required slot is incomplete and cannot stage. */
  required: z.boolean(),
});
export type TemplateBlockSlot = z.infer<typeof TemplateBlockSlot>;

/**
 * WHERE THE SHARED INTAKE SITS — the parked question (2), given a home so the
 * answer is a data edit. `after_all_blocks` is recorded because it is what the
 * shipped renderer does today, NOT because it was chosen.
 */
export const IntakePlacement = z.object({
  mode: z.enum(["after_hero", "after_slot", "after_all_blocks"]),
  /** Required when mode is "after_slot"; the slot_id the intake follows. */
  after_slot_id: Id.nullable(),
  /**
   * ⚠ TODO-ASK-OWNER (Melissa) — see the file header. This value is a RECORD
   * OF CURRENT BEHAVIOUR, not a decision.
   */
  owner_decided: z.literal(false),
});
export type IntakePlacement = z.infer<typeof IntakePlacement>;

export const TemplateSpec = z
  .object({
    template_id: Id,
    /**
     * Reserved — white-label condition C1, matching the pattern A00 shipped in
     * six platform modules and A04 shipped on SearchOpportunity. Default
     * "prn"; NO tenant logic, routing or UI exists around it. A second client's
     * template is a second row, not a fork of this file.
     */
    tenant_id: z.string().min(1).optional(),
    schema_version: SchemaVersion,
    /**
     * THE VERSION STRING. PageSpec.template_version already carries this, so a
     * page records which template shape produced it and a template change is
     * legible as a version bump rather than as pages mysteriously differing.
     */
    version: z.string().min(1),
    display_name: z.string().min(1),
    /**
     * ORDERED. Array position IS render order — that is the whole mechanism by
     * which a shape choice becomes data. An owner reordering these reorders
     * every page built from the template.
     */
    blocks: z.array(TemplateBlockSlot).min(1),
    intake_placement: IntakePlacement,
    /**
     * Owner approval of the SHAPE. False on every template that ships today —
     * see the header. A05 may build staged, noindexed pages from an unapproved
     * template (that is what the trial is); nothing may leave noindex on one.
     */
    owner_approved: z.boolean(),
    created_at: IsoDateTime,
  })
  .superRefine((tpl, ctx) => {
    if (tpl.intake_placement.mode === "after_slot" && tpl.intake_placement.after_slot_id === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'intake_placement mode "after_slot" requires after_slot_id',
        path: ["intake_placement", "after_slot_id"],
      });
    }
    if (
      tpl.intake_placement.after_slot_id !== null &&
      !tpl.blocks.some((b) => b.slot_id === tpl.intake_placement.after_slot_id)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "intake_placement.after_slot_id must name a slot this template actually has",
        path: ["intake_placement", "after_slot_id"],
      });
    }
    const ids = tpl.blocks.map((b) => b.slot_id);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "slot_id must be unique within a template",
        path: ["blocks"],
      });
    }
    for (const [i, block] of tpl.blocks.entries()) {
      if (block.kind === "custom" && block.custom_key === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'a "custom" slot must carry a custom_key so it has a stable identity',
          path: ["blocks", i, "custom_key"],
        });
      }
    }
  });
export type TemplateSpec = z.infer<typeof TemplateSpec>;

/**
 * The ONE template that ships — a faithful description of what
 * `compilePageSpec` already emits and `IntentPageView` already renders. Every
 * heading below is copied from factory.ts, not invented here.
 *
 * `owner_approved: false` is the honest value and it is load-bearing: the
 * noindex model (two independent layers, Loop Spec Audit C5) is what keeps an
 * unapproved shape off the public web, and this field is the record of WHY it
 * has to stay that way.
 */
export const TPL_INTENT_PAGE: TemplateSpec = TemplateSpec.parse({
  template_id: "tpl_intent_page",
  schema_version: "1.0.0",
  version: "1.0.0",
  display_name: "Intent door page (shipped)",
  blocks: [
    {
      slot_id: "blk_intent_answer",
      kind: "intent_answer",
      custom_key: null,
      label: "Direct answer to the search",
      default_heading: "What this usually means",
      required: true,
    },
    {
      slot_id: "blk_safe_checks",
      kind: "safe_checks",
      custom_key: null,
      label: "Safe self-checks",
      default_heading: "Safe things to check first",
      required: false,
    },
    {
      slot_id: "blk_do_not",
      kind: "do_not_do",
      custom_key: null,
      label: "What not to do",
      default_heading: "What not to do",
      required: false,
    },
    {
      slot_id: "blk_urgency",
      kind: "when_urgency_changes",
      custom_key: null,
      label: "When this becomes urgent",
      default_heading: "When this becomes urgent",
      required: false,
    },
    {
      slot_id: "blk_who",
      kind: "who_handles_it",
      custom_key: null,
      label: "Who typically handles this",
      default_heading: "Who typically handles this",
      required: false,
    },
  ],
  intake_placement: { mode: "after_all_blocks", after_slot_id: null, owner_decided: false },
  owner_approved: false,
  created_at: "2026-08-24T00:00:00Z",
});

/**
 * THE HANDCRAFTED WAVE-2 DOOR'S OWN SHAPE (inspection F4).
 *
 * WHAT WAS WRONG. `SAMPLE_PAGE_SPEC` claimed `template_id: "tpl_intent_page"`
 * and carried SIX blocks against that template's five declared slots — it ends
 * with a `blk_faq` the factory has never emitted. So the registry's one claim,
 * "it says in data exactly what the shipped factory produces and the shipped
 * renderer draws", was false for the very first page PRN ever built. The
 * template test never caught it because it checked `missingRequiredSlots`
 * (which an EXTRA block satisfies trivially) on the sample, and
 * `templateMatchesBlocks` only on the six generated doors.
 *
 * WHY A SECOND TEMPLATE RATHER THAN AN OPTIONAL SLOT ON THE FIRST. The other
 * available fix was to declare `blk_faq` as an optional slot on
 * tpl_intent_page. That would make the registry describe output the factory
 * never produces, and it would force `templateMatchesBlocks` to tolerate absent
 * slots — and since four of tpl_intent_page's five slots are already
 * `required: false`, a page carrying ONE block would then pass the anti-drift
 * check. Loosening the drift detector to accommodate a mislabelled page is the
 * opposite of what the check is for.
 *
 * The honest description is simply that the handcrafted door is a DIFFERENT
 * SHAPE: the shipped intent-door sequence plus a closing FAQ. It is one page,
 * built by hand before the factory existed, and it now says so. Nothing about
 * it renders differently — `IntentPageView` draws `spec.content_blocks` in
 * array order and has never read a template.
 *
 * `owner_approved: false` for the same reason as above: no template shape is
 * approved (Melissa, verbatim: "I'm not approving these templates yet").
 */
export const TPL_INTENT_PAGE_FAQ: TemplateSpec = TemplateSpec.parse({
  ...TPL_INTENT_PAGE,
  template_id: "tpl_intent_page_faq",
  display_name: "Intent door page + closing FAQ (handcrafted, Door Wave 2)",
  blocks: [
    ...TPL_INTENT_PAGE.blocks,
    {
      slot_id: "blk_faq",
      kind: "faq",
      custom_key: null,
      label: "Closing FAQ",
      default_heading: "Quick answers",
      required: false,
    },
  ],
});

export const TEMPLATE_REGISTRY: readonly TemplateSpec[] = [
  TPL_INTENT_PAGE,
  TPL_INTENT_PAGE_FAQ,
] as const;

export function resolveTemplate(templateId: string, version?: string): TemplateSpec | null {
  return (
    TEMPLATE_REGISTRY.find(
      (t) => t.template_id === templateId && (version === undefined || t.version === version)
    ) ?? null
  );
}

/**
 * THE ANTI-DRIFT CHECK. A registered template that stops describing what the
 * factory emits is worse than no template at all: it is a lie the owner would
 * read as a plan. This compares a template's ordered slots against a page's
 * ordered blocks and reports the mismatch in words rather than a boolean.
 */
export function templateMatchesBlocks(
  template: TemplateSpec,
  blocks: ReadonlyArray<{ block_id: string; kind: string; heading: string | null }>
): string[] {
  const problems: string[] = [];
  if (blocks.length !== template.blocks.length) {
    problems.push(
      `template ${template.template_id}@${template.version} declares ${template.blocks.length} slots but the page carries ${blocks.length} blocks`
    );
  }
  const n = Math.min(blocks.length, template.blocks.length);
  for (let i = 0; i < n; i += 1) {
    const slot = template.blocks[i];
    const block = blocks[i];
    if (slot.slot_id !== block.block_id) {
      problems.push(`slot ${i}: template declares "${slot.slot_id}", page carries "${block.block_id}"`);
    }
    if (slot.kind !== block.kind) {
      problems.push(`slot ${slot.slot_id}: template declares kind "${slot.kind}", page carries "${block.kind}"`);
    }
    if (slot.default_heading !== null && slot.default_heading !== block.heading) {
      problems.push(
        `slot ${slot.slot_id}: template declares heading "${slot.default_heading}", page carries "${block.heading ?? "null"}"`
      );
    }
  }
  return problems;
}

/** Every required slot a page is missing. Empty means the page is complete. */
export function missingRequiredSlots(
  template: TemplateSpec,
  blocks: ReadonlyArray<{ kind: string }>
): string[] {
  const present = new Set(blocks.map((b) => b.kind));
  return template.blocks.filter((s) => s.required && !present.has(s.kind)).map((s) => s.slot_id);
}
