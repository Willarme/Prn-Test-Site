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
   * ⚠ GATE-READY, DEFAULT UNCHANGED — coherence report issue 16, flagged for
   * Josh and Melissa by the A05 build.
   *
   * THE FINDING: `src/app/page.tsx` is public and unauthenticated, and it
   * enumerates EVERY staged door page with its QA-state pill and a link to
   * each. Indexing is safely blocked three ways (site-wide robots disallow,
   * per-route noindex, the seo_doors_enabled master switch), so this is not an
   * SEO leak — but A05 §7's promise that it "must never make a page publicly
   * reachable" is untrue as written, and A06's QA verdicts are sitting on an
   * unauthenticated surface. The audit puts it in the same exposure class as
   * the known playbook View-Source leak (Trial Build State lines 104-125,
   * Master Todo T0-02).
   *
   * WHY IT SHIPS ON. Nothing customer-visible changes without an owner. The
   * listing is the trial navigator Joshua and the testers actually use, and
   * turning it off is a product decision, not a build decision. So the flag
   * exists, defaults to TODAY'S BEHAVIOUR, and flipping it to false is a
   * one-line owner decision that needs no code change.
   *
   * TODO-ASK-OWNER (Joshua + Melissa): should the public homepage keep listing
   * staged pages and their QA state, or move behind isAdminUnlocked()?
   *
   * WHAT IS ALREADY ENFORCED, flag or no flag: nothing NEW from A05 or A06 may
   * render here. No qa.reasons, no lint findings, no provenance, no scoring —
   * a test asserts it. The pill was already public before this build; the
   * detail behind it never becomes public because of it.
   */
  { flag_key: "staged_listing_public", enabled: true, description: "List staged door pages + QA pill on the public homepage (trial navigator)", decision_ref: "D-20" },
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
