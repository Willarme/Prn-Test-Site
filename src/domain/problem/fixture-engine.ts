import { inferProblemFamily } from "@/domain/search/intent-classifier";
import { checkSafety } from "@/domain/problem/safety";
import {
  EvidenceObject,
  JobPacket,
  ProblemRecord,
} from "@/domain/problem/contracts";
import { shortHash } from "@/domain/search/importer";
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

export function buildJobPacketFixture(
  problem: ProblemRecord,
  evidence: EvidenceObject,
  now: string,
  taxonomy: ProblemTaxonomy = ACTIVE_PROBLEM_TAXONOMY
): JobPacket {
  const family = problem.service_category;
  const label = familyLabel(family, taxonomy);
  const questions = questionsForFamily(family, taxonomy);

  const unknowns = [
    "Exact cause — a qualified provider should verify on site.",
    ...(family ? [] : ["Which trade should handle this — the description fits more than one."]),
    "Whether parts will be needed, and which.",
  ];

  const packet: JobPacket = {
    job_packet_id: `jp_${problem.problem_id.replace(/^pr_/, "")}`,
    packet_version: 1,
    schema_version: "1.0.0",
    problem_id: problem.problem_id,
    summary_plain: `Homeowner reports: ${evidence.content}`,
    observed_statements: [evidence.content],
    symptoms_and_timing: null,
    likely_service_category: {
      value: label,
      confidence: problem.service_category_confidence ?? "low",
      note: "This is an inference from the description, not a diagnosis.",
    },
    what_remains_unknown: unknowns,
    safe_prep_notes: [
      "Know where your main shutoffs are (water, breaker panel).",
      "Clear access to the affected area so a provider can reach it easily.",
    ],
    questions_for_provider: questions,
    call_script: `Hi — something happened at my home and I have an organized summary ready. In short: ${evidence.content.slice(0, 140)}${evidence.content.length > 140 ? "…" : ""}. I can send you the full Job Packet with details and photos. Are you able to take a look?`,
    collected_details: [],
    media_count: 0,
    diagnosis: null,
    generated_at: now,
    engine: "fixture",
  };
  return JobPacket.parse(packet);
}
