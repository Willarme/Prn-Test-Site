import { inferProblemFamily } from "@/domain/search/intent-classifier";
import { checkSafety } from "@/domain/problem/safety";
import { selectPlaybook } from "@/domain/intake/playbooks";
import { buildCurrentFactState, filterFixtureQuestions, type CurrentFactState } from "@/domain/intake/readiness";
import {
  EvidenceObject,
  JobPacket,
  ProblemRecord,
} from "@/domain/problem/contracts";
import { shortHash } from "@/domain/search/importer";
import { ACTIVE_PACKET_COPY, fillCopy, type PacketCopyPackage } from "@/domain/problem/packet-copy";
import {
  ACTIVE_PROBLEM_TAXONOMY,
  familyLabel,
  questionsForFamily,
  type ProblemTaxonomy,
} from "@/domain/problem/taxonomy";

/**
 * FixtureProblemAnalyzer / FixtureJobPacketBuilder — the deterministic
 * stand-ins behind the SAME capability contract the production A01/A02 will
 * implement (SEO_DOORS spec Wave 7: swap FixtureProblemAnalyzer for
 * ProductionProblemCapability without touching pages, intake, or results).
 *
 * Honesty rules baked in: inference is always labeled, unknowns are listed,
 * no diagnosis, no savings guarantee, and the packet only restates what the
 * customer actually said.
 *
 * TAXONOMY FROM CONFIG, 2026-08-25 (Loop Spec Audit A01 condition 11). The trade
 * labels and the family question bank used to be three `const` objects right
 * here, which meant a client that does roofing only had to edit agent code. They
 * moved VERBATIM to domain/problem/taxonomy.ts and are read through it. This
 * file was NOT split and no exported signature changed (pre-answer 8 / HO-3 —
 * both halves are bound by path string in the capability registry): the taxonomy
 * arrives as an optional trailing argument that defaults to the shipped one, so
 * every existing call site produces byte-identical output.
 */
export interface AnalyzeInput {
  description: string;
  intake_session_id: string | null;
  problem_family_hint: string | null; // door attribution — prior, NOT truth
  now: string;
}

export interface AnalyzeResult {
  problem: ProblemRecord;
  evidence: EvidenceObject;
}

export function analyzeProblemFixture(input: AnalyzeInput): AnalyzeResult {
  const id = shortHash(`${input.description}|${input.now}|${input.intake_session_id ?? ""}`);
  const safety = checkSafety(input.description);
  // The door hint is a prior only: the customer's own words win (SEO_DOORS
  // Wave 5 — someone arriving from an HVAC door may describe a plumbing leak).
  const familyFromText = inferProblemFamily(input.description, null);
  const family = familyFromText ?? input.problem_family_hint;

  const evidence: EvidenceObject = {
    evidence_id: `ev_${id}`,
    kind: "customer_text",
    content: input.description, // verbatim, private
    privacy: "private",
    captured_at: input.now,
  };

  const problem: ProblemRecord = {
    problem_id: `pr_${id}`,
    schema_version: "1.0.0",
    status: "packet_ready",
    source_channel: "web",
    intake_session_id: input.intake_session_id,
    problem_summary: input.description.slice(0, 240),
    service_category: family,
    service_category_confidence: familyFromText ? "medium" : family ? "low" : "low",
    safety_state: safety ? (safety.intake_may_continue ? "review" : "urgent") : "normal",
    safety_rule_id: safety?.safety_rule_id ?? null,
    evidence_ids: [evidence.evidence_id],
    claim_ids: [],
    clarifiers_asked: [],
    created_at: input.now,
    updated_at: null,
  };

  return {
    problem: ProblemRecord.parse(problem),
    evidence: EvidenceObject.parse(evidence),
  };
}

/**
 * PACKET COPY FROM CONFIG, 2026-08-25 (Loop Spec Audit A02 condition 8).
 *
 * Every customer-facing sentence this builder used to hold as a string literal
 * moved VERBATIM to domain/problem/packet-copy.ts. Same treatment, same reason
 * and same shape as the taxonomy move above: the copy arrives as an optional
 * trailing argument defaulting to the shipped package, so every existing call
 * site produces identical words. A white-label client swaps a package.
 */
export function buildJobPacketFixture(
  problem: ProblemRecord,
  evidence: EvidenceObject,
  now: string,
  taxonomy: ProblemTaxonomy = ACTIVE_PROBLEM_TAXONOMY,
  copy: PacketCopyPackage = ACTIVE_PACKET_COPY,
  currentFacts?: CurrentFactState,
): JobPacket {
  const family = problem.service_category;
  const label = familyLabel(family, taxonomy);
  const facts = currentFacts ?? buildCurrentFactState({ request_id: problem.intake_session_id ?? problem.problem_id,
    playbook: selectPlaybook(evidence.content, family), problem, evidence: [evidence] });
  const questions = filterFixtureQuestions(family, questionsForFamily(family, taxonomy), facts);
  const c = copy.content;

  const unknowns = [
    c.unknown_exact_cause,
    ...(family ? [] : [c.unknown_which_trade]),
    c.unknown_parts,
  ];

  const packet: JobPacket = {
    job_packet_id: `jp_${problem.problem_id.replace(/^pr_/, "")}`,
    packet_version: 1,
    schema_version: "1.0.0",
    problem_id: problem.problem_id,
    summary_plain: `${c.raw_statement_prefix}${evidence.content}`,
    /**
     * HC12 / condition 9 — THE HOMEOWNER'S OWN WORDS, UNTOUCHED. This array
     * holds the raw description BYTE-IDENTICAL: no prefix, no truncation, no
     * paraphrase, and nothing from the copy package reaches it. `summary_plain`
     * above is the prefixed DISPLAY string and is a different field on purpose.
     * tests/a02.verbatim-survival.test.ts asserts the byte-identity and asserts
     * that "fixing" the prefix into this field would be caught.
     */
    observed_statements: [evidence.content],
    symptoms_and_timing: null,
    likely_service_category: {
      value: label,
      confidence: problem.service_category_confidence ?? "low",
      note: c.inference_disclaimer,
    },
    what_remains_unknown: unknowns,
    safe_prep_notes: [...c.safe_prep_notes],
    questions_for_provider: questions,
    call_script: fillCopy(c.call_script_template, {
      excerpt: `${evidence.content.slice(0, c.call_script_excerpt_max_chars)}${
        evidence.content.length > c.call_script_excerpt_max_chars ? c.call_script_ellipsis : ""
      }`,
    }),
    collected_details: [],
    media_count: 0,
    diagnosis: null,
    generated_at: now,
    engine: "fixture",
    /** Which copy package produced these words — see packet-copy.ts. */
    template_version: copy.template_version,
  };
  return JobPacket.parse(packet);
}
