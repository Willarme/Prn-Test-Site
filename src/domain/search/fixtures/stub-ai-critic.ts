import type { AICritic, AiCriticInput, AiCriticOutput } from "@/domain/search/qa-critic";
import type { QaFinding } from "@/domain/search/qa-types";

/**
 * THE STUBBED AI CRITIC — A TEST DOUBLE, AND NOTHING ELSE (condition C4).
 *
 * WHAT IT EXISTS FOR. A06 §11's Definition of Done demanded the critic
 * "demonstrably produce a voice_claim_policy finding for each of [four
 * patterns]" while the same prompt bans installing a model. Condition C4 calls
 * that unsatisfiable-as-written and restates it: "with a stubbed AICriticAdapter
 * in tests, each of the four patterns produces a voice_claim_policy finding;
 * with no model configured, the stage reports SKIPPED_NO_MODEL and a test
 * asserts that is never treated as PASS." This file is the first half. The
 * second half is what actually ships.
 *
 * IT IS NEVER WIRED INTO A PRODUCTION PATH, and a test asserts that. The run
 * mode's critic is `gatewayAiCritic`, which reports SKIPPED_NO_MODEL because no
 * critic capability is registered. A stub that could reach a real QA run would
 * be the fake critic this whole build exists to prevent — the same trap
 * `fixtureCritic` fell into by shipping inside the rule set.
 *
 * IT LIVES IN fixtures/ FOR THAT REASON, beside SAMPLE_PAGE_SPEC: fixtures are
 * the directory whose contents are understood to be inputs to tests, not
 * behaviour of the product.
 *
 * WHAT IT PRETENDS TO BE. A model that reads a page and reports voice/claim
 * violations. Its patterns are deliberately CRUDE and deliberately DIFFERENT
 * from A06's deterministic ones: the stub demonstrates the INTERFACE and the
 * finding shape, and pretending its regexes are a model's judgment would be the
 * same category error twice.
 */

const PATTERNS: Array<{ id: string; pattern: RegExp; message: string }> = [
  {
    id: "unsourced_price",
    pattern: /(\$\s?\d|\bcosts? (about|around|roughly)\b|\baverage (cost|price)\b)/i,
    message: "states a price or cost with no source behind it",
  },
  {
    id: "manufactured_urgency",
    pattern: /\b(act now|hurry|don'?t wait|before it'?s too late|only \d+ left|today only)\b/i,
    message: "manufactures urgency instead of describing an evidenced hazard",
  },
  {
    id: "directory_framing",
    pattern: /\b(compare (providers|contractors|quotes)|browse (all|our)|choose from (our|hundreds)|provider directory)\b/i,
    message: "frames PRN as a browsable directory rather than one trusted next step",
  },
  {
    id: "unqualified_verification_claim",
    pattern: /\b(verified|vetted|insured|certified|top[- ]rated|premium)\b/i,
    message:
      "makes a verification claim whose standard is undecided (Master Todo T2-07 / T7-01) — a human decides, this is not auto-failed",
  },
];

/** The four surfaces a stub critic reads. Same copy the real one would. */
function surfaces(input: AiCriticInput): Array<{ where: string; text: string }> {
  return [
    { where: "title", text: input.title },
    { where: "meta_description", text: input.meta_description },
    { where: "h1", text: input.h1 },
    { where: "hero.headline", text: input.hero_headline },
    ...(input.hero_subheadline
      ? [{ where: "hero.subheadline", text: input.hero_subheadline }]
      : []),
    ...input.blocks.map((b) => ({ where: b.block_id, text: b.body_md })),
  ];
}

/**
 * Build the stub. `severity` is a constructor argument rather than a constant so
 * a test can exercise both the "critic raises a blocker" and "critic raises a
 * major" paths — including the contradiction path, where a critic returns PASS
 * alongside a blocker and A06 downgrades it to FAIL.
 */
export function stubVoiceCritic(
  options: { severity?: QaFinding["severity"]; forceStatus?: AiCriticOutput["status"] } = {}
): AICritic {
  const severity = options.severity ?? "major";
  return {
    id: "stub-voice-critic",
    async critique(input: AiCriticInput): Promise<AiCriticOutput> {
      const findings: QaFinding[] = [];
      for (const surface of surfaces(input)) {
        for (const rule of PATTERNS) {
          const hit = surface.text.match(rule.pattern);
          if (!hit) continue;
          findings.push({
            // The check id A06 §5 names for this class of critic finding.
            check: "voice_claim_policy",
            severity,
            where: surface.where,
            message: `${rule.id}: ${rule.message} ("${hit[0].trim()}")`,
            repair_instructions:
              rule.id === "unqualified_verification_claim"
                ? "Route to human review. The verification standard is not decided and must not be invented here."
                : "Rewrite the copy to canon voice: evidence, not pressure; one next step, not a directory.",
          });
        }
      }
      return {
        status: options.forceStatus ?? (findings.length > 0 ? "FAIL" : "PASS"),
        reason:
          findings.length > 0
            ? `stub critic raised ${findings.length} voice_claim_policy finding(s)`
            : "stub critic found no voice or claim violation",
        findings,
        provider: "stub",
        // A stub spends nothing. Zero here is a measurement, not a placeholder.
        cost_usd: 0,
        latency_ms: 0,
      };
    },
  };
}

/** The four pattern ids, exported so the Definition-of-Done test can enumerate them. */
export const STUB_CRITIC_PATTERN_IDS = PATTERNS.map((p) => p.id);
