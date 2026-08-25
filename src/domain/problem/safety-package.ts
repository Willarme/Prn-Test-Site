import { z } from "zod";

/**
 * THE SAFETY PACKAGE — versioned, human-reviewed DATA (Loop Spec Audit A01
 * conditions 9 and 10; A01 §9 step 2: the registry becomes "versioned,
 * human-reviewed data, not inline logic").
 *
 * ─── WHY THE COPY MOVED, AND WHAT DID NOT MOVE ─────────────────────────────
 *
 * The four rules already shipped in domain/problem/safety.ts with their response
 * copy compiled into a .ts file — and that copy says "call 911" and "your gas
 * utility's emergency line". Those are US emergency-services facts. A client
 * deployment in another country would be shipping a homeowner in danger a phone
 * number that does not exist, and the only way to fix it was to edit agent code.
 *
 * So this file is the DATA and safety.ts stays the MECHANISM. There is exactly
 * one safety source in this repo (condition 9: "extend, never duplicate") —
 * safety.ts still owns `checkSafety`, still runs first and still returns the same
 * rule objects. It reads them from here instead of holding them as literals.
 *
 * ─── WHAT IS DELIBERATELY NOT A KNOB ───────────────────────────────────────
 *
 * `intake_may_continue` is data, because whether a hazard is a hard stop is a
 * jurisdiction- and expert-reviewable judgement. But NOTHING here can turn the
 * safety gate off, reorder it after classification, or hand its decision to a
 * model: that is structure in safety.ts and in ai-classify.ts, not configuration.
 * A package with zero rules is a package that detects nothing — it is not a
 * package that lets intake skip the check.
 *
 * OWNER_TODO (Joshua + Melissa): this copy is still the shipped trial text and
 * has NOT been through expert/legal review. Moving it into data does not review
 * it. What moving it buys is that the review can now be done against one
 * versioned document by someone who does not read TypeScript.
 */

/**
 * A trigger pattern as DATA. Stored as a regex source plus flags rather than a
 * compiled literal — the same shape `FieldRequirement.auto_detect_patterns`
 * already uses for the playbook's own detection patterns, so a second market
 * supplies its own language without a code change.
 */
export const SafetyPattern = z.object({
  source: z.string().min(1),
  flags: z.string().regex(/^[gimsuy]*$/),
});
export type SafetyPattern = z.infer<typeof SafetyPattern>;

export const SafetyRuleData = z.object({
  safety_rule_id: z.string().min(1),
  label: z.string().min(1),
  patterns: z.array(SafetyPattern).min(1),
  /**
   * FIXED, HUMAN-REVIEWED COPY. Never model-generated, never assembled at
   * runtime, never interpolated with anything a homeowner typed.
   */
  approved_response: z.string().min(1),
  /** false = HARD STOP: no ProblemRecord, no packet, and no model call. */
  intake_may_continue: z.boolean(),
});
export type SafetyRuleData = z.infer<typeof SafetyRuleData>;

export const SafetyPackage = z.object({
  safety_package_id: z.string().min(1),
  /** Bumped in the same commit as any copy change — the audit trail is git. */
  version: z.number().int().min(1),
  /**
   * WHAT THIS COPY ASSUMES ABOUT WHERE THE READER IS. Recorded rather than
   * assumed: the trial package tells people to call 911, which is a fact about
   * the United States, not about home repair.
   */
  jurisdiction: z.string().min(1),
  locale: z.string().min(1),
  /** Whether this package's copy has been through expert/legal review. */
  reviewed: z.boolean(),
  rules: z.array(SafetyRuleData).min(1),
});
export type SafetyPackage = z.infer<typeof SafetyPackage>;

/**
 * THE SHIPPED TRIAL PACKAGE. Every string below is the text that was already
 * shipping, moved verbatim — not reworded, not shortened, not improved. A test
 * pins each one against a golden copy, because "we moved the copy and also
 * quietly edited the words a frightened person reads" is the failure this
 * migration could plausibly cause.
 */
export const PRN_TRIAL_SAFETY_PACKAGE: SafetyPackage = SafetyPackage.parse({
  safety_package_id: "prn_trial_us_v1",
  version: 1,
  jurisdiction: "US",
  locale: "en-US",
  // OWNER_TODO above: not yet reviewed. Recorded honestly rather than aspirationally.
  reviewed: false,
  rules: [
    {
      safety_rule_id: "safety_gas",
      label: "Gas or carbon monoxide",
      // Deliberately broad: "smell(s/ed/ing) (like/of) gas", "gas smell/leak",
      // rotten-egg odor (the classic mercaptan indicator), propane, CO.
      patterns: [
        { source: "\\bgas (smell|leak|odor)\\b", flags: "i" },
        { source: "smell(s|ed|ing)?\\s+(like\\s+|of\\s+)?(natural\\s+)?gas\\b", flags: "i" },
        { source: "\\bpropane\\b.*\\b(smell|leak)", flags: "i" },
        { source: "rotten egg", flags: "i" },
        { source: "carbon monoxide", flags: "i" },
        { source: "\\bco (alarm|detector)\\b", flags: "i" },
      ],
      approved_response:
        "If you smell gas or a carbon monoxide alarm is sounding: leave the building now, don't switch anything on or off, and call your gas utility's emergency line or 911 from outside. Come back to this when everyone is safe.",
      intake_may_continue: false,
    },
    {
      safety_rule_id: "safety_fire",
      label: "Fire, smoke or sparking",
      patterns: [
        { source: "\\b(fire|flames?)\\b", flags: "i" },
        { source: "\\bsmoke\\b", flags: "i" },
        { source: "spark(s|ing)?\\b(?!\\s*plug)", flags: "i" },
        { source: "burn(ing|t)? (smell|odor)", flags: "i" },
        {
          source: "smell(s|ed|ing)?\\s+(like\\s+)?(it'?s\\s+|it\\s+is\\s+|something\\s+)?burn",
          flags: "i",
        },
        { source: "something (is\\s+)?burning", flags: "i" },
      ],
      approved_response:
        "If anything is actively smoking, sparking or burning: switch off power at the breaker only if it is safe to reach, get everyone out, and call 911. If it's a faint burning smell with no visible smoke, stop using the fixture and keep this area supervised.",
      intake_may_continue: true,
    },
    {
      safety_rule_id: "safety_flood_electric",
      label: "Water near electricity / major flooding",
      patterns: [
        { source: "flood(ing|ed)?\\b", flags: "i" },
        { source: "water .*(outlet|panel|electric)", flags: "i" },
        { source: "standing water", flags: "i" },
      ],
      approved_response:
        "If water is spreading fast or is anywhere near outlets, cords, or your electrical panel: don't step in it, shut off the water main if you can reach it safely, and call a professional or your utility. If the panel itself is wet, stay clear and call 911 or your utility.",
      intake_may_continue: true,
    },
    {
      safety_rule_id: "safety_structural",
      label: "Structural danger",
      patterns: [
        { source: "ceiling (is )?(sagging|collapsing|caving)", flags: "i" },
        { source: "wall .*(bulging|collapsing)", flags: "i" },
        { source: "structural", flags: "i" },
      ],
      approved_response:
        "If part of the structure looks like it may fall — sagging ceiling, bulging wall — keep people and pets out of that room and don't store anything heavy above or below it. A qualified professional should look before anyone works there.",
      intake_may_continue: true,
    },
  ],
});

/**
 * THE ACTIVE PACKAGE — A01 §7's `safety_package` knob, resolved the way A04's
 * market vocabulary is resolved: one exported default that a deployment swaps,
 * not a string key in the platform policy store (whose own test requires every
 * value be a number or boolean).
 */
export const ACTIVE_SAFETY_PACKAGE: SafetyPackage = PRN_TRIAL_SAFETY_PACKAGE;
