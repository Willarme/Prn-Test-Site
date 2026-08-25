import { z } from "zod";

/**
 * THE PACKET COPY PACKAGE — every customer-facing word of a Job Packet, as
 * versioned DATA (Loop Spec Audit A02 condition 8 and pre-answer 12).
 *
 * ─── WHY THIS FILE EXISTS ──────────────────────────────────────────────────
 *
 * Until this commit, the sentence a homeowner reads under their service
 * category was pinned as a `z.literal` IN THE FROZEN CONTRACT
 * (contracts.ts: `note: z.literal("This is an inference from the description,
 * not a diagnosis.")`), the prefix on their own words was a string literal in
 * the fixture engine, and every section heading was typed into the results
 * page. A white-label client could not change one word of any of it without a
 * schema change and three code edits — and PRN's own project statement names
 * the per-client deployment as the product.
 *
 * So the copy is the DATA and the engine is the MECHANISM, exactly as A01 did
 * with safety-package.ts. Same words, sourced from config.
 *
 * ─── NOT ONE WORD WAS REWRITTEN ────────────────────────────────────────────
 *
 * Every string below was moved VERBATIM from fixture-engine.ts,
 * packet-assembly.ts, app/results/[request_id]/page.tsx and
 * components/results/PacketActions.tsx. Nothing was added, removed, reordered
 * or reworded. Pre-answer 12 splits the question exactly this way: the DECISION
 * to move it is a technical default and was taken; the ACTUAL WORDS are
 * Melissa's and a build session must move them without rewriting a single one.
 *
 * ⚠ TODO-ASK-OWNER (Melissa): the words themselves, the final section LIST, and
 * whether a confidence level is shown to a homeowner at all (Loop Spec Audit
 * pre-answers 2 and 11, Compendium 17.13/17.14, Master Todo T0-01). This file
 * moving them into config does NOT approve them — it is what makes her review
 * an edit to one document instead of a code change.
 *
 * ─── WHAT MOVING THE z.literal COST, AND WHAT REPLACED IT ──────────────────
 *
 * The literal was a real guarantee: it made "the packet says this is an
 * inference, not a diagnosis" true by type. Loosening it to `z.string().min(1)`
 * keeps the schema enforcing that a disclaimer is PRESENT — condition 8's own
 * wording — and moves the enforcement of WHAT IT MAY SAY to this file's
 * validation, which is where a white-label client's words actually enter.
 * `PacketCopyPackage` refuses, at parse time, any package whose copy carries a
 * savings promise, a guarantee, a raw dollar figure, or the word "lead".
 *
 * The schema is NOT made to validate against the active package instead. That
 * would look stricter and be worse: a packet generated under copy v1 would stop
 * parsing the day a deployment moved to v2, silently breaking every stored row
 * — the same class of failure as a required schema addition. `template_version`
 * on the packet is what answers "which words did this homeowner actually see".
 */

/**
 * NO SECTION LIST IS DECIDED HERE. The headings below are a RECORD of the
 * sections the shipped packet already renders, in the order it already renders
 * them — the same stance domain/search/template.ts takes for door pages. A
 * client reorders or omits by editing data; PRN's own final list is parked.
 */
export const PacketSectionCopy = z.object({
  /** The pill above the packet card. */
  packet_label: z.string().min(1),
  problem_in_your_words: z.string().min(1),
  details_supplied: z.string().min(1),
  media_attached_label: z.string().min(1),
  media_attached_note: z.string().min(1),
  guided_walkthrough_findings: z.string().min(1),
  provider_note_prefix: z.string().min(1),
  likely_service_category: z.string().min(1),
  service_category_unknown: z.string().min(1),
  /** `{confidence}` is substituted with high | medium | low. */
  inference_badge_template: z.string().min(1),
  what_remains_unknown: z.string().min(1),
  useful_preparation: z.string().min(1),
  questions_for_provider: z.string().min(1),
  call_script: z.string().min(1),
});
export type PacketSectionCopy = z.infer<typeof PacketSectionCopy>;

/** The CTA labels on the packet itself. */
export const PacketActionCopy = z.object({
  download: z.string().min(1),
  copy_summary: z.string().min(1),
  copy_summary_done: z.string().min(1),
  reveal_call_script: z.string().min(1),
  hide_call_script: z.string().min(1),
});
export type PacketActionCopy = z.infer<typeof PacketActionCopy>;

export const PacketContentCopy = z.object({
  /**
   * THE DISCLAIMER. Required to exist; its wording is checked for honesty
   * below, not pinned to one sentence. See the header.
   */
  inference_disclaimer: z.string().min(1),
  /**
   * THE PREFIX ON THE HOMEOWNER'S OWN WORDS. Note what this is NOT: it is
   * prepended to `summary_plain` only. `observed_statements[0]` holds the raw
   * description byte-identical and NOTHING in this package touches it — see
   * the HC12 verbatim guarantee in tests/a02.verbatim-survival.test.ts.
   */
  raw_statement_prefix: z.string(),
  unknown_exact_cause: z.string().min(1),
  unknown_which_trade: z.string().min(1),
  unknown_parts: z.string().min(1),
  safe_prep_notes: z.array(z.string().min(1)),
  /** `{excerpt}` is substituted with the truncated customer description. */
  call_script_template: z.string().min(1),
  call_script_excerpt_max_chars: z.number().int().positive(),
  call_script_ellipsis: z.string(),
  /** Appended to the call script when a guided diagnosis reached an outcome. */
  call_script_diagnosis_suffix: z.string().min(1),
  diagnosis_in_progress_title: z.string().min(1),
  diagnosis_in_progress_cause: z.string().min(1),
  diagnosis_in_progress_provider_note: z.string().min(1),
  answer_photo_attached: z.string().min(1),
  answer_provided: z.string().min(1),
  answer_none: z.string().min(1),
});
export type PacketContentCopy = z.infer<typeof PacketContentCopy>;

/**
 * THE HONESTY RULES — the guarantee that replaces the z.literal.
 *
 * These are structural, not stylistic, and each maps to a hard rule the packet
 * has always been held to: never a savings guarantee, never an unlabeled dollar
 * figure, never the word "lead" on any customer surface. They apply to EVERY
 * string in the package, not just the disclaimer, because a client rewriting a
 * section heading can break the promise as easily as one rewriting the note.
 */
export const FORBIDDEN_PACKET_COPY_PATTERNS: readonly { pattern: RegExp; why: string }[] = [
  {
    pattern: /\blead(s|ed)?\b/i,
    why: 'the word "lead" appears on no PRN surface, label, column or commit (hard canon rule)',
  },
  {
    pattern: /\$\s?\d/,
    why: "a packet never carries a dollar figure; cost context is blocked on OD-13",
  },
  {
    pattern: /\bguarantee(s|d|ing)?\b/i,
    why: "the packet promises nothing — it organizes what the homeowner already said",
  },
  {
    pattern: /\bsavings?\b|\bsave (you )?(money|time)\b/i,
    why: "no savings claim, guaranteed or implied (#14A §5.1)",
  },
] as const;

function checkHonesty(strings: string[], ctx: z.RefinementCtx): void {
  for (const value of strings) {
    for (const rule of FORBIDDEN_PACKET_COPY_PATTERNS) {
      if (rule.pattern.test(value)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `packet copy "${value}" is refused: ${rule.why}`,
        });
      }
    }
  }
}

export const PacketCopyPackage = z
  .object({
    packet_copy_id: z.string().min(1),
    /** Bumped in the same commit as any copy change — the audit trail is git. */
    version: z.number().int().min(1),
    /**
     * Stamped onto every packet as `template_version`, so "which words did this
     * homeowner actually see" is answerable from the stored row rather than
     * from whatever the deployment happens to say today.
     */
    template_version: z.string().min(1),
    /** Recorded rather than assumed — this copy is US English. */
    locale: z.string().min(1),
    /**
     * FALSE, and honestly so. Moving copy into data does not review it. Melissa
     * has not signed off on the packet wording (Master Todo T0-01).
     */
    owner_reviewed: z.literal(false),
    content: PacketContentCopy,
    sections: PacketSectionCopy,
    actions: PacketActionCopy,
  })
  .superRefine((pkg, ctx) => {
    checkHonesty(
      [
        ...Object.values(pkg.content).filter((v): v is string => typeof v === "string"),
        ...pkg.content.safe_prep_notes,
        ...Object.values(pkg.sections),
        ...Object.values(pkg.actions),
      ],
      ctx
    );
  });
export type PacketCopyPackage = z.infer<typeof PacketCopyPackage>;

/**
 * THE SHIPPED TRIAL PACKAGE. Every string moved verbatim; see the header.
 * A second client is a second package, not a fork of the packet engine.
 */
export const PRN_TRIAL_PACKET_COPY: PacketCopyPackage = PacketCopyPackage.parse({
  packet_copy_id: "pkt_copy_prn_trial",
  version: 1,
  template_version: "packet-copy@1.0.0",
  locale: "en-US",
  owner_reviewed: false,
  content: {
    inference_disclaimer: "This is an inference from the description, not a diagnosis.",
    raw_statement_prefix: "Homeowner reports: ",
    unknown_exact_cause: "Exact cause — a qualified provider should verify on site.",
    unknown_which_trade: "Which trade should handle this — the description fits more than one.",
    unknown_parts: "Whether parts will be needed, and which.",
    safe_prep_notes: [
      "Know where your main shutoffs are (water, breaker panel).",
      "Clear access to the affected area so a provider can reach it easily.",
    ],
    call_script_template:
      "Hi — something happened at my home and I have an organized summary ready. In short: {excerpt}. I can send you the full Job Packet with details and photos. Are you able to take a look?",
    call_script_excerpt_max_chars: 140,
    call_script_ellipsis: "…",
    call_script_diagnosis_suffix:
      " I also walked through a few checks — it looks like: {likely_cause}",
    diagnosis_in_progress_title: "Walkthrough in progress",
    diagnosis_in_progress_cause:
      "The customer started the guided walkthrough; see steps answered so far.",
    diagnosis_in_progress_provider_note:
      "Guided diagnosis partially completed; findings listed.",
    answer_photo_attached: "photo attached",
    answer_provided: "provided",
    answer_none: "—",
  },
  sections: {
    packet_label: "Job Packet",
    problem_in_your_words: "The problem, in your words",
    details_supplied: "Details supplied",
    media_attached_label: "Photos/video attached:",
    media_attached_note: "(shared privately with the provider you choose)",
    guided_walkthrough_findings: "Guided walkthrough findings",
    provider_note_prefix: "Note for the provider:",
    likely_service_category: "Likely service category",
    service_category_unknown: "Not yet clear from the description",
    inference_badge_template: "inference · {confidence} confidence",
    what_remains_unknown: "What remains unknown",
    useful_preparation: "Useful preparation",
    questions_for_provider: "What a provider will likely ask — have these ready",
    call_script: "Your 30-second call script",
  },
  actions: {
    download: "Print / Save as PDF",
    copy_summary: "Copy 30-second summary",
    copy_summary_done: "Copied ✓",
    reveal_call_script: "Get the 30-second call script",
    hide_call_script: "Hide call script",
  },
});

/**
 * THE ACTIVE PACKAGE. One indirection, so a deployment swaps a package rather
 * than editing agent code. No tenant routing exists — condition 7's tenant_id
 * is reserved and carries no logic, and inventing per-tenant copy resolution
 * here would be building the white-label feature rather than the seam.
 */
export const ACTIVE_PACKET_COPY: PacketCopyPackage = PRN_TRIAL_PACKET_COPY;

/** Substitute `{key}` placeholders. Missing keys are left alone, never blanked. */
export function fillCopy(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) =>
    key in values ? values[key] : whole
  );
}
