import { z } from "zod";
import { PRN_TRIAL_VOCABULARY, type MarketVocabulary } from "@/domain/search/vocabulary";

/**
 * THE PROBLEM TAXONOMY — the trades A01 classifies into, what each is called in
 * a homeowner's register, and the questions each one implies (Loop Spec Audit
 * A01 condition 11).
 *
 * ─── WHY THIS FILE EXISTS ──────────────────────────────────────────────────
 *
 * The condition is blunt about the cost of leaving it as it was: the four trades
 * were `const` objects in fixture-engine.ts, so "this client does roofing only"
 * meant editing agent code and rewriting every eval case. The values below are
 * the SHIPPED ones, moved verbatim — nothing added, removed or reworded — and a
 * test asserts the generated questions are byte-identical to what the packet
 * carried before.
 *
 * ─── ONE TAXONOMY, TWO HALVES, DELIBERATELY NOT MERGED ─────────────────────
 *
 * The DETECTION half — which words mean "roofing" — already lives in config, as
 * `MarketVocabulary.family_patterns` in domain/search/vocabulary.ts, and A04's
 * scoring and A01's classifier both read it. Copying those patterns here would
 * fork the one list two agents agree on, so this file does not hold patterns:
 * `problemTradeKeys()` reads them from the vocabulary.
 *
 * What this file holds is the half that had no home: the customer-facing LABEL
 * for each family and the question bank the packet draws on. Those are content,
 * they are per-client, and they were literals.
 *
 * A deployment that serves different trades therefore edits two config objects
 * and no agent code — and a test proves a taxonomy with one family produces a
 * packet that only asks that family's questions.
 */
export const ProblemFamilyConfig = z.object({
  /** Must match a `MarketVocabulary.family_patterns[].family` key. */
  family: z.string().min(1),
  /** How the packet names this trade to a homeowner. */
  label: z.string().min(1),
  /** Questions to hand a provider, in the order they should be asked. */
  questions_for_provider: z.array(z.string().min(1)),
});
export type ProblemFamilyConfig = z.infer<typeof ProblemFamilyConfig>;

export const ProblemTaxonomy = z.object({
  taxonomy_id: z.string().min(1),
  version: z.number().int().min(1),
  families: z.array(ProblemFamilyConfig).min(1),
  /** Asked whatever the trade — appended after the family's own questions. */
  generic_questions: z.array(z.string().min(1)),
  /**
   * How many questions the packet carries. This is the `.slice(0, 5)` that was
   * already shipping in buildJobPacketFixture, named rather than invented — the
   * SAME observed constant as the clarifier ceiling, and equally not a decision.
   *
   * TODO-ASK-OWNER (Melissa): the real number, if it is not this one.
   */
  max_questions_for_provider: z.number().int().min(1),
});
export type ProblemTaxonomy = z.infer<typeof ProblemTaxonomy>;

/**
 * THE SHIPPED TRIAL TAXONOMY — every label and question moved verbatim from
 * fixture-engine.ts's FAMILY_LABELS / FAMILY_QUESTIONS / GENERIC_QUESTIONS.
 */
export const PRN_TRIAL_PROBLEM_TAXONOMY: ProblemTaxonomy = ProblemTaxonomy.parse({
  taxonomy_id: "prn_trial_home_services_v1",
  version: 1,
  families: [
    {
      family: "hvac",
      label: "Heating & cooling (HVAC)",
      questions_for_provider: [
        "Is the thermostat set to the mode you expect (heat/cool), and does its display respond?",
        "Roughly how old is the system, if you know?",
        "Has the air filter been changed recently?",
      ],
    },
    {
      family: "plumbing",
      label: "Plumbing",
      questions_for_provider: [
        "Does the problem happen constantly, or only when specific fixtures are used?",
        "Do you know where the main water shutoff is?",
        "Is there any visible water staining, and where exactly?",
      ],
    },
    {
      family: "electrical",
      label: "Electrical",
      questions_for_provider: [
        "Does the affected circuit trip a breaker, and did a single reset help? (Never reset repeatedly.)",
        "How many outlets/fixtures are affected — one, one room, or more?",
        "Any warmth, discoloration, or smell at outlets or switches?",
      ],
    },
    {
      family: "roofing",
      label: "Roofing",
      questions_for_provider: [
        "Does it only appear during or after rain?",
        "Do you know roughly when the roof was last replaced or repaired?",
      ],
    },
    {
      family: "appliance",
      label: "Appliance repair",
      questions_for_provider: [
        "What is the brand and approximate age of the appliance?",
        "Did anything change right before this started (move, power blink, new detergent, etc.)?",
      ],
    },
    {
      family: "water_damage",
      label: "Water damage / restoration",
      questions_for_provider: [
        "Is the water still coming in, or has it stopped?",
        "How large is the affected area, roughly?",
      ],
    },
  ],
  generic_questions: [
    "When did this start, and has it gotten better or worse?",
    "Did anything unusual happen just before (weather, work in the home, power outage)?",
    "Is anything else in the home behaving oddly since it started?",
  ],
  max_questions_for_provider: 5,
});

/** The active taxonomy — swapped by a deployment, never edited per request. */
export const ACTIVE_PROBLEM_TAXONOMY: ProblemTaxonomy = PRN_TRIAL_PROBLEM_TAXONOMY;

/** How the packet names a family. Unknown families fall back to their key. */
export function familyLabel(
  family: string | null,
  taxonomy: ProblemTaxonomy = ACTIVE_PROBLEM_TAXONOMY
): string | null {
  if (!family) return null;
  return taxonomy.families.find((f) => f.family === family)?.label ?? family;
}

/** The question list for a family, family-specific first, then generic, capped. */
export function questionsForFamily(
  family: string | null,
  taxonomy: ProblemTaxonomy = ACTIVE_PROBLEM_TAXONOMY
): string[] {
  const specific = family
    ? (taxonomy.families.find((f) => f.family === family)?.questions_for_provider ?? [])
    : [];
  return [...specific, ...taxonomy.generic_questions].slice(0, taxonomy.max_questions_for_provider);
}

/**
 * The trade keys a classifier may choose from: the vocabulary's own families
 * plus its catch-all. Read from the DETECTION config so the two halves cannot
 * drift — a family with a label here but no pattern there is unreachable, and a
 * test asserts they agree.
 */
export function problemTradeKeys(vocabulary: MarketVocabulary = PRN_TRIAL_VOCABULARY): string[] {
  return [...new Set([...vocabulary.family_patterns.map((f) => f.family), vocabulary.catch_all_category])];
}
