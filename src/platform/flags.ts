import { z } from "zod";

export const FeatureFlag = z.object({
  flag_key: z.string().regex(/^[a-z_]+$/),
  enabled: z.boolean(),
  description: z.string().min(1),
  decision_ref: z.string().nullable(),
});
export type FeatureFlag = z.infer<typeof FeatureFlag>;

/**
 * Every surface ships behind a flag, and every route CONSULTS its flag
 * (verified by tests). A flag flips only at its wave gate: the three shell
 * flags flipped ON when Waves 5-7 shipped fixture-backed (D-20, under the
 * owner's standing approval); the risky flags stay OFF until their gates.
 */
export const DEFAULT_FLAGS: readonly FeatureFlag[] = [
  { flag_key: "seo_doors_enabled", enabled: false, description: "Serve published IntentPages publicly", decision_ref: null },
  /**
   * ✔ DECIDED — OWNER RULING, Josh, 2026-08-25. Coherence report issue 16 is
   * closed. This is no longer a question; it is the record of the answer.
   *
   * THE RULING: HIDE IT. `enabled: false`. His reasoning, in his terms: those
   * pages are not for the public yet, and A06's QA verdicts are internal
   * business — especially with a live demo coming. A visitor who lands on the
   * homepage during a demo should see the product, not a work-in-progress
   * inventory with PASS/FAIL pills on it.
   *
   * ── HISTORY, kept because it explains the shape of the code ──────────────
   *
   * THE FINDING (A05 build, flagged for Josh and Melissa): `src/app/page.tsx`
   * is public and unauthenticated, and it enumerated EVERY staged door page
   * with its QA-state pill and a link to each. Indexing was safely blocked
   * three ways (site-wide robots disallow, per-route noindex, the
   * seo_doors_enabled master switch), so it was never an SEO leak — but A05
   * §7's promise that it "must never make a page publicly reachable" was
   * untrue as written, and A06's QA verdicts were sitting on an
   * unauthenticated surface. The audit put it in the same exposure class as
   * the known playbook View-Source leak (Trial Build State lines 104-125,
   * Master Todo T0-02).
   *
   * WHY IT SHIPPED ON, and why that was right at the time: nothing
   * customer-visible changes without an owner. The listing was the trial
   * navigator Joshua and the testers actually used, and turning it off was a
   * product decision, not a build decision. So the flag was built to default
   * to THEN-CURRENT BEHAVIOUR, precisely so that flipping it would need an
   * owner and not a code change. That is what just happened — the flip below
   * is the whole change, exactly as designed. This paragraph is history now,
   * superseded by the ruling above; it is preserved rather than deleted
   * because it is the reason the switch existed to be thrown.
   *
   * ── WHAT THE RULING DOES AND DOES NOT DO ────────────────────────────────
   *
   * DOES: the public homepage renders no staged listing at all — no slug, no
   * link, no QA pill, and `allStagedSpecs()` is not even queried
   * (src/app/page.tsx line 21 short-circuits).
   *
   * DOES NOT: gate `/staged/[slug]` itself. The audit's Fix line offered two
   * branches — "move the staged listing behind isAdminUnlocked(), OR gate
   * /staged/[slug] itself" — and this ruling takes the first. A direct
   * /staged/<slug> URL still renders for anyone who has it; it stays noindex
   * and is now unlisted, so it is no longer discoverable from the public site.
   * Gating the route as well is a SEPARATE owner call, deliberately not taken
   * here.
   *
   * JOSH KEEPS HIS NAVIGATOR. The staged pages he actually reviews are listed
   * on /admin/pages (admin-gated), which links each one to /staged/<slug> and
   * to its editor. Hiding the public copy costs him nothing.
   *
   * WHAT IS ALREADY ENFORCED, flag or no flag: nothing NEW from A05 or A06 may
   * render here. No qa.reasons, no lint findings, no provenance, no scoring —
   * a test asserts it. The pill was public before this build; the detail
   * behind it never became public because of it.
   */
  { flag_key: "staged_listing_public", enabled: false, description: "List staged door pages + QA pill on the public homepage (trial navigator) — OFF by owner ruling, Josh 2026-08-25", decision_ref: "D-20" },
  { flag_key: "intake_shell_enabled", enabled: true, description: "Shared StartRequestForm + /start + intake API (fixture engine)", decision_ref: "D-20" },
  { flag_key: "results_shell_enabled", enabled: true, description: "Results page shell (fixture JobPacket)", decision_ref: "D-20" },
  { flag_key: "feature_lab_enabled", enabled: true, description: "Future Feature Lab concept pages + interest capture", decision_ref: "D-20" },
  { flag_key: "trust_enabled", enabled: false, description: "Trust Network V1 flows", decision_ref: null },
  { flag_key: "monetization_enabled", enabled: false, description: "Public-page ad/sponsor slots (#23 §5); never on private routes", decision_ref: null },
  { flag_key: "mcp_enabled", enabled: false, description: "Safe/internal MCP V1 (allowlisted test clients only)", decision_ref: null },
  { flag_key: "sms_enabled", enabled: false, description: "Telnyx SMS — stays OFF until 10DLC complete", decision_ref: null },
] as const;

export function flagEnabled(key: string): boolean {
  return DEFAULT_FLAGS.find((f) => f.flag_key === key)?.enabled ?? false;
}
