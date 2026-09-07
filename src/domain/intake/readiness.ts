import { z } from "zod";
import type { IntakePlaybook, IntakeAnswer, DiagnosisAnswer } from "./playbook";
import { CANNOT_REACH_FIELD_VALUE, detectDiagnosis, detectFields } from "./extract";
import type { ProblemRecord, EvidenceObject, FactClaim } from "@/domain/problem/contracts";
import { ACTIVE_PROBLEM_TAXONOMY, questionsForFamily, type ProblemTaxonomy } from "@/domain/problem/taxonomy";
import { printedFieldGap } from "./printed-readings";
import type { PrintedEvidenceResult } from "@/domain/problem/printed-evidence";

/** Operative merged spec §§5,8–14. Counts are actions, never server requests.
 * A label capture (3) plus its separate confirmation (1) explains the 4-unit
 * example. Coverage §4.8's historical total is arithmetically inconsistent;
 * only the actual action ledger can establish a 14-unit reference flow. */
export const READINESS_POLICY_VERSION = "merged-intake-1.0.0";
export const EFFORT_CEILING = 20;
export const EFFORT_TARGET = 14;
export const QUESTION_COSTS = { closed_choice: 1, confirm: 1, media: 3, short_text: 4, free_text: 5 } as const;
export const ReadinessDimension = z.enum(["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"]);
export type ReadinessDimension = z.infer<typeof ReadinessDimension>;
export const READINESS_DIMENSIONS: Record<ReadinessDimension, string> = {
  A: "Problem identity", B: "Symptom detail", C: "Timing", D: "Equipment",
  E: "Evidence", F: "Checks", G: "History", H: "Safety", I: "Access", J: "Unknowns",
};
export const FactStatus = z.enum(["CONFIRMED", "PROVIDED_UNVERIFIED", "PHOTO_PENDING_EXTRACTION", "UNREADABLE", "INACCESSIBLE", "UNKNOWN_AFTER_REASONABLE_ATTEMPT", "NOT_APPLICABLE", "TECHNICIAN_ONLY"]);
export type FactStatus = z.infer<typeof FactStatus>;
const InputType = z.enum(["closed_choice", "confirm", "media", "short_text", "free_text"]);
export const CurrentFact = z.object({
  field_key: z.string().min(1), value: z.string().min(1).nullable(), status: FactStatus,
  reason: z.string().min(1).nullable(), source: z.enum(["opening_text", "answer", "evidence", "claim", "prior_record", "derived", "policy"]),
  claim_class: z.enum(["SUPPLIED", "OBSERVED", "CALCULATED", "INFERRED"]),
  evidence_ids: z.array(z.string().min(1)), captured_at: z.string().min(1),
  confidence: z.enum(["high", "medium", "low"]).nullable(), confirmed: z.boolean(),
  derivation_id: z.string().nullable().optional(), corrected_by: z.string().nullable().optional(),
}).superRefine((f, ctx) => {
  if (f.value === null && !f.reason) ctx.addIssue({ code: "custom", path: ["reason"], message: "A gap requires an actual reason" });
  if (f.value === null && ["CONFIRMED", "PROVIDED_UNVERIFIED"].includes(f.status)) ctx.addIssue({ code: "custom", path: ["status"], message: "A populated status requires a value" });
  if (f.value !== null && !["CONFIRMED", "PROVIDED_UNVERIFIED"].includes(f.status)) ctx.addIssue({ code: "custom", path: ["value"], message: "A gap status cannot claim a known value" });
  if (f.claim_class !== "INFERRED" && f.confidence !== null) ctx.addIssue({ code: "custom", path: ["confidence"], message: "Confidence belongs to inference only" });
  if (f.claim_class === "INFERRED" && f.confirmed) ctx.addIssue({ code: "custom", path: ["confirmed"], message: "An inference is not a homeowner confirmation" });
});
export type CurrentFact = z.infer<typeof CurrentFact>;
export const CurrentFactState = z.object({ request_id: z.string().min(1), policy_version: z.string().min(1), fields: z.record(CurrentFact) }).superRefine((state, ctx) => {
  for (const [key, field] of Object.entries(state.fields)) if (key !== field.field_key) ctx.addIssue({ code: "custom", path: ["fields", key], message: "Field map key disagrees with fact" });
});
export type CurrentFactState = z.infer<typeof CurrentFactState>;
export const RequirementDefinition = z.object({
  requirement_id: z.string().min(1), version: z.string().min(1), fact_type: z.string().min(1), dimension: ReadinessDimension,
  packet_slots: z.array(z.string().min(1)).min(1), applies_when: z.string().min(1),
  required_level: z.enum(["HARD_REQUIRED", "CONDITIONAL", "USEFUL", "TECHNICIAN_ONLY"]),
  why_needed: z.string().min(1), value_domains: z.array(z.enum(["packet", "safety", "next_step", "provider_preparation"])).min(1),
  obtainable_by: z.array(InputType), fallback_if_unobtainable: z.string().min(1), safety_policy_id: z.string().nullable(),
  active: z.boolean(), supersedes_version: z.string().nullable(),
});
export type RequirementDefinition = z.infer<typeof RequirementDefinition>;
export const QuestionDefinition = z.object({
  question_id: z.string().min(1), version: z.string().min(1), module_id: z.string().min(1), screen_id: z.string().min(1),
  display_text: z.string().min(1), input_type: InputType, fills_fields: z.array(z.string().min(1)).min(1),
  requirement_ids: z.array(z.string().min(1)).min(1), packet_slots: z.array(z.string().min(1)).min(1),
  eligibility_rules: z.array(z.string()), exclusion_rules: z.array(z.string()), effort_units: z.number().int().min(1),
  estimated_data_yield: z.number().int().positive(), safety_class: z.enum(["information", "existing_approved_observation"]),
  requires_approved_instruction: z.boolean(), value_reason: z.array(z.enum(["safety", "packet", "diy_viability", "provider_type", "tools_parts", "next_step"])).min(1),
  cannot_answer_option: z.literal("I can't get to this."), fallback_question_id: z.string().nullable(),
  provenance: z.string().min(1), active: z.boolean(), blocking: z.boolean(), can_reclassify: z.boolean(),
  source_kind: z.enum(["field", "check", "address"]), source_key: z.string().min(1),
}).superRefine((q, ctx) => {
  if (q.effort_units !== QUESTION_COSTS[q.input_type]) ctx.addIssue({ code: "custom", path: ["effort_units"], message: "Use the operative action cost" });
  if (new Set(q.fills_fields).size !== q.fills_fields.length) ctx.addIssue({ code: "custom", path: ["fills_fields"], message: "Duplicate target fields inflate yield" });
});
export type QuestionDefinition = z.infer<typeof QuestionDefinition>;
export const ProtocolModule = z.object({ module_id: z.string().min(1), version: z.string().min(1), requirement_ids: z.array(z.string()), question_ids: z.array(z.string()) });
export type ProtocolModule = z.infer<typeof ProtocolModule>;
export interface ProviderQuestionDefinition { question_id: string; display_text: string; fills_fields: string[]; packet_slots: string[]; purpose: "provider_preparation" }
export interface IntakeRegistry { version: string; requirements: RequirementDefinition[]; questions: QuestionDefinition[]; modules: ProtocolModule[]; provider_questions: ProviderQuestionDefinition[] }

/** Every entry is an actual Directions input slot. No generic fallback fabricates
 * a slot for a new field: an unmapped field must be authored before it emits. */
const FIELD_SLOTS: Record<string, string[]> = {
  unit_model_serial: ["equipment.model", "equipment.serial"], brand: ["equipment.brand"], system_age: ["equipment.age_years"],
  symptom_timing: ["problem.onset_date", "problem.onset_character"], thermostat_photo: ["evidence.readings.thermostat", "equipment.thermostat"],
  equipment_type: ["equipment.type"], outdoor_unit_location: ["equipment.outdoor_unit_location"], air_handler_location: ["equipment.air_handler_location"],
  thermostat_model: ["equipment.thermostat"], vent_airflow: ["narrative.facts"], filter_age_weeks: ["provider.checks"],
  urgency: ["problem.urgency_level"], habitability: ["problem.habitability"], vulnerable_occupant: ["problem.vulnerable_occupant"],
  damage_accruing: ["problem.damage_accruing"], safety_signals: ["problem.hazard_flags"],
  sh_refrigerant: ["provider.service_history"], sh_recent_service: ["provider.service_history"], sh_impact: ["provider.service_history"], sh_room_variance: ["provider.service_history"],
  access_occupancy: ["access.occupancy"], access_owner_present: ["access.owner_present_needed"], access_parking: ["access.parking"],
  access_pets: ["access.pets"], access_route: ["access.equipment_route"], access_window: ["access.preferred_window"], access_contact: ["access.contact_preference"],
  fixture_or_appliance: ["equipment.type"], affected_scope: ["narrative.facts"], visible_damage: ["narrative.facts"],
  problem_photo: ["evidence.media"], panel_photo: ["evidence.media"], shutoff_known: ["provider.checks"],
};
function dimensionFor(key: string): ReadinessDimension {
  if (key.startsWith("check:")) return "F";
  if (key.startsWith("sh_")) return "G";
  if (key.startsWith("access_")) return "I";
  if (key === "symptom_timing" || key === "onset_character") return "C";
  if (["safety_signals", "safety_gate", "safety_coverage"].includes(key)) return "H";
  if (["vent_airflow", "affected_scope", "visible_damage", "symptom_detail"].includes(key)) return "B";
  if (key === "evidence_presence") return "E";
  if (["user_language", "normalized_class"].includes(key)) return "A";
  return "D";
}
function requirement(key: string, slots: string[], label: string, level: RequirementDefinition["required_level"] = "HARD_REQUIRED", dimension = dimensionFor(key)): RequirementDefinition {
  return RequirementDefinition.parse({ requirement_id: `req:${key}`, version: READINESS_POLICY_VERSION, fact_type: key, dimension, packet_slots: slots,
    applies_when: "active playbook", required_level: level, why_needed: label, value_domains: ["packet"], obtainable_by: ["closed_choice", "media", "short_text"],
    fallback_if_unobtainable: "Record the actual missing status and reason; never ask again.", safety_policy_id: null, active: true, supersedes_version: null });
}
const BANK_FIELDS: Record<string, string[]> = {
  "Is the thermostat set to the mode you expect (heat/cool), and does its display respond?": ["thermostat_photo"],
  "Roughly how old is the system, if you know?": ["system_age"],
  "Has the air filter been changed recently?": ["filter_age_weeks"],
  "When did this start, and has it gotten better or worse?": ["symptom_timing"],
  "Did anything unusual happen just before (weather, work in the home, power outage)?": ["recent_change"],
  "Is anything else in the home behaving oddly since it started?": ["related_symptoms"],
  "Does the problem happen constantly, or only when specific fixtures are used?": ["symptom_timing"],
  "Do you know where the main water shutoff is?": ["shutoff_known"],
  "Is there any visible water staining, and where exactly?": ["visible_damage"],
  "Does the affected circuit trip a breaker, and did a single reset help? (Never reset repeatedly.)": ["breaker_behavior"],
  "How many outlets/fixtures are affected — one, one room, or more?": ["affected_scope"],
  "Any warmth, discoloration, or smell at outlets or switches?": ["safety_signals"],
  "Does it only appear during or after rain?": ["rain_timing"],
  "Do you know roughly when the roof was last replaced or repaired?": ["roof_history"],
  "What is the brand and approximate age of the appliance?": ["brand", "system_age"],
  "Did anything change right before this started (move, power blink, new detergent, etc.)?": ["recent_change"],
  "Is the water still coming in, or has it stopped?": ["active_water"],
  "How large is the affected area, roughly?": ["affected_scope"],
};
const BANK_EXTRA_SLOTS: Record<string, string[]> = { recent_change: ["narrative.timeline"], related_symptoms: ["narrative.facts"], breaker_behavior: ["provider.checks"], rain_timing: ["narrative.timeline"], roof_history: ["provider.service_history"], active_water: ["narrative.facts"] };
export function buildIntakeRegistry(playbook: IntakePlaybook, taxonomy: ProblemTaxonomy = ACTIVE_PROBLEM_TAXONOMY): IntakeRegistry {
  const requirements: RequirementDefinition[] = [
    requirement("user_language", ["problem.homeowner_words"], "Preserve the original complaint"),
    requirement("normalized_class", ["problem.title"], "Identify the problem class"),
    requirement("symptom_detail", ["narrative.summary_observations"], "Preserve reported symptom detail"),
    // Merged §5.1 explicitly retains this handoff slot. The existing trial
    // question bank has no outcome control; preserve a reasoned gap instead
    // of inventing a question or silently treating null as complete data.
    requirement("outcome_wanted", ["outcome_wanted"], "Preserve the homeowner's requested outcome or its absence", "HARD_REQUIRED", "A"),
    requirement("onset_character", ["problem.onset_character"], "Distinguish onset shape"),
    requirement("evidence_presence", ["evidence.media"], "Record role-tagged evidence or its absence"),
    requirement("safety_gate", ["problem.hazard_flags"], "Record whether the existing safety gate ran"),
    requirement("safety_coverage", ["problem.safety_state"], "Record approved hazard-rule coverage"),
    requirement("access_offered", ["access.occupancy"], "Offer access details or record why the flow ended first", "HARD_REQUIRED", "I"),
    requirement("property.street", ["property.street"], "Identify the job address", "HARD_REQUIRED", "I"),
    requirement("property.city_state_zip", ["property.city_state_zip"], "Identify the job locality", "HARD_REQUIRED", "I"),
    requirement("property.type", ["property.type"], "Property context", "USEFUL", "I"),
    requirement("property.storeys", ["property.storeys"], "Property access context", "USEFUL", "I"),
  ];
  const questions: QuestionDefinition[] = [];
  function addQuestion(key: string, label: string, input: z.infer<typeof InputType>, fields: string[], source: "field" | "check" | "address", screen: string, reason: QuestionDefinition["value_reason"], yieldCount?: number) {
    const reqs = requirements.filter(r => fields.includes(r.fact_type));
    const q = QuestionDefinition.parse({ question_id: source === "check" ? key : source === "address" ? "address:short_text" : `field:${key}:${input}`, version: READINESS_POLICY_VERSION,
      module_id: source === "check" ? "approved_walkthrough" : screen, screen_id: screen, display_text: label, input_type: input,
      fills_fields: fields, requirement_ids: reqs.map(r => r.requirement_id), packet_slots: [...new Set(reqs.flatMap(r => r.packet_slots))],
      eligibility_rules: source === "check" ? ["authorized current graph step"] : ["required fact unresolved"], exclusion_rules: ["already populated", "already attempted", "effort ceiling"],
      effort_units: QUESTION_COSTS[input], estimated_data_yield: yieldCount ?? fields.length,
      safety_class: source === "check" ? "existing_approved_observation" : "information", requires_approved_instruction: source === "check",
      value_reason: reason, cannot_answer_option: "I can't get to this.", fallback_question_id: null, provenance: `${playbook.playbook_id}@${playbook.version}`,
      active: true, blocking: true, can_reclassify: false, source_kind: source, source_key: source === "check" ? key.slice(6) : key });
    questions.push(q);
  }
  for (const field of playbook.required_fields) {
    if (/gate.*code|entry.*code|lockbox|alarm_code/.test(field.field_key)) continue;
    const slots = FIELD_SLOTS[field.field_key];
    if (!slots) throw new Error(`Unmapped packet slots for field ${field.field_key}`);
    const required = field.priority === "core" || ["brand", "equipment_type"].includes(field.field_key) || field.optional_group === "history" ? "HARD_REQUIRED" : "USEFUL";
    requirements.push(requirement(field.field_key, slots, field.why_it_matters, required));
  }
  for (const step of playbook.diagnostic_steps) requirements.push(requirement(`check:${step.step_id}`, ["provider.checks"], step.title));
  for (const field of playbook.required_fields) {
    if (!requirements.some(r => r.fact_type === field.field_key)) continue;
    const screen = field.optional_group === "history" ? "history" : field.optional_group === "access" ? "access" : field.optional_group === "context" ? "detail-context" : "detail-equipment";
    addQuestion(field.field_key, field.label, field.choices ? "closed_choice" : "short_text", [field.field_key], "field", screen, [field.value_reason]);
    addQuestion(field.field_key, field.label, "confirm", [field.field_key], "field", screen, [field.value_reason]);
    if (field.accepts.includes("photo")) {
      const targets = field.field_key === "unit_model_serial" ? ["unit_model_serial", "equipment_type", "brand", "system_age"].filter(key => requirements.some(r => r.fact_type === key)) : [field.field_key];
      addQuestion(field.field_key, field.photo_prompt ?? field.label, "media", targets, "field", screen, [field.value_reason], field.field_key === "unit_model_serial" ? 14 : field.field_key === "thermostat_photo" ? 8 : 1);
    }
  }
  addQuestion("address", "Job address", "short_text", ["property.street", "property.city_state_zip", "property.type", "property.storeys"], "address", "property", ["packet"]);
  for (const step of playbook.diagnostic_steps) {
    // satisfies_fields alone is not an extraction result. The graph observation
    // writes its own check fact; related fields are filled only by real extraction.
    addQuestion(`check:${step.step_id}`, step.title, step.input.kind === "photo" ? "media" : step.input.kind === "text" ? "short_text" : "closed_choice", [`check:${step.step_id}`], "check", "walkthrough", ["packet"]);
  }
  const provider_questions = questionsForFamily(playbook.problem_family, taxonomy).flatMap((display_text, index) => {
    const fields = BANK_FIELDS[display_text];
    // A custom provider-only question remains on its legacy provider surface;
    // it acquires no homeowner emission permission from an unregistered string.
    if (!fields) return [];
    for (const key of fields) if (!requirements.some(r => r.fact_type === key)) requirements.push(requirement(key, FIELD_SLOTS[key] ?? BANK_EXTRA_SLOTS[key], display_text, "USEFUL"));
    return [{ question_id: `bank:${taxonomy.taxonomy_id}:${index}`, display_text, fills_fields: fields,
      packet_slots: [...new Set(requirements.filter(r => fields.includes(r.fact_type)).flatMap(r => r.packet_slots))], purpose: "provider_preparation" as const }];
  });
  const modules = [...new Set(questions.map(q => q.module_id))].map(module_id => ProtocolModule.parse({ module_id, version: READINESS_POLICY_VERSION,
    question_ids: questions.filter(q => q.module_id === module_id).map(q => q.question_id),
    requirement_ids: [...new Set(questions.filter(q => q.module_id === module_id).flatMap(q => q.requirement_ids))] }));
  return { version: READINESS_POLICY_VERSION, requirements, questions, modules, provider_questions };
}
/** Existing fixture provider suggestions consult the same populated fact map.
 * They are provider preparation, not emitted homeowner prompts; no intake
 * effort is charged. A partly redundant sentence is omitted whole because its
 * wording cannot truthfully be trimmed with set arithmetic. */
export function filterProviderQuestions(questions: readonly string[], registry: IntakeRegistry, state: CurrentFactState): string[] {
  return questions.filter(text => {
    const registered = registry.provider_questions.find(q => q.display_text === text);
    return !registered || registered.fills_fields.every(key => !isFactPopulated(state.fields[key]));
  });
}
export function filterFixtureQuestions(family: string | null, questions: readonly string[], state: CurrentFactState): string[] {
  void family;
  return questions.filter(text => !BANK_FIELDS[text]?.some(key => isFactPopulated(state.fields[key])));
}

export interface BuildFactStateInput {
  request_id: string; playbook: IntakePlaybook; problem: ProblemRecord;
  evidence?: readonly EvidenceObject[]; claims?: readonly FactClaim[]; answers?: readonly IntakeAnswer[]; diagnosisAnswers?: readonly DiagnosisAnswer[];
  additionalFacts?: readonly CurrentFact[]; safetyGateRan?: boolean; safetyFlags?: readonly string[]; safetyCoverageComplete?: boolean;
  /** Recorded extraction confidence, supplied by the platform sidecar reader.
   * It is confidence in interpretation of characters, not inspection quality. */
  labelConfidence?: Readonly<Record<string, "high" | "medium" | "low">>;
  labelReadings?: readonly { evidence_id: string; confidence: Readonly<Record<string, "high" | "medium" | "low">>;
    extraction_status?: "readable" | "unreadable" | "failed"; reason?: string; printed_evidence?: PrintedEvidenceResult }[];
}
function labelConfidenceFor(key: string, values: BuildFactStateInput["labelConfidence"]): "high" | "medium" | "low" | undefined {
  if (!values) return undefined;
  const aliases = key === "unit_model_serial" ? [key, "model", "serial"] : key === "equipment_type" ? [key, "type"] : key === "system_age" ? [key, "manufacture_year", "year"] : key === "printed_cooling_capacity" ? [key, "capacity"] : [key];
  const words = aliases.map(alias => values[alias]).filter((v): v is "high" | "medium" | "low" => !!v);
  const rank = { low: 1, medium: 2, high: 3 };
  return words.sort((a, b) => rank[a] - rank[b])[0];
}
function fact(key: string, value: string | null, at: string, patch: Partial<CurrentFact> = {}): CurrentFact {
  return CurrentFact.parse({ field_key: key, value, status: value === null ? "UNKNOWN_AFTER_REASONABLE_ATTEMPT" : "PROVIDED_UNVERIFIED",
    reason: value === null ? "No value was obtained" : null, source: "answer", claim_class: "SUPPLIED", evidence_ids: [], captured_at: at, confidence: null, confirmed: false, ...patch });
}
function strength(f: CurrentFact): number { return f.confirmed ? 5 : f.claim_class === "INFERRED" ? 1 : f.value === null ? 0 : 4; }
function install(state: CurrentFactState, incoming: CurrentFact, explicitCorrection = true): void {
  const previous = state.fields[incoming.field_key];
  const laterHomeownerCorrection = explicitCorrection && previous && incoming.source === "answer" && incoming.claim_class === "SUPPLIED" &&
    Date.parse(incoming.captured_at) > Date.parse(previous.captured_at);
  const photoOverManual = previous?.source === "answer" && previous.claim_class === "SUPPLIED" &&
    incoming.source === "evidence" && incoming.claim_class !== "SUPPLIED";
  if (!previous || (!photoOverManual && (laterHomeownerCorrection || (strength(incoming) >= strength(previous) && Date.parse(incoming.captured_at) >= Date.parse(previous.captured_at))))) {
    // Initial extraction is also persisted as an auto-detected answer/claim.
    // A same-value, same-time copy without an evidence link must not erase the
    // link already established from the actual opening text or photo.
    const sameObservation = previous && incoming.value !== null && incoming.value === previous.value &&
      Date.parse(incoming.captured_at) === Date.parse(previous.captured_at);
    state.fields[incoming.field_key] = sameObservation && !incoming.evidence_ids.length && previous.evidence_ids.length
      ? { ...incoming, evidence_ids: previous.evidence_ids } : incoming;
  }
}
function gapStatus(value: string | null): { status: FactStatus; reason: string } | null {
  if (value === "skipped photo") return { status: "UNKNOWN_AFTER_REASONABLE_ATTEMPT", reason: "Homeowner skipped this observation" };
  if (value === CANNOT_REACH_FIELD_VALUE || value === "cannot_reach") return { status: "INACCESSIBLE", reason: "Homeowner could not reach this" };
  if (value === null || /^(not sure|unknown|unsure|can'?t tell|cannot tell)$/i.test(value.trim())) return { status: "UNKNOWN_AFTER_REASONABLE_ATTEMPT", reason: "Homeowner could not provide this after the request" };
  if (value === "__unreadable__") return { status: "UNREADABLE", reason: "Submitted evidence was unreadable" };
  return null;
}
export function buildCurrentFactState(input: BuildFactStateInput): CurrentFactState {
  const state: CurrentFactState = { request_id: input.request_id, policy_version: READINESS_POLICY_VERSION, fields: {} };
  const { problem, playbook } = input;
  const textEvidence = (input.evidence ?? []).filter(e => e.kind === "customer_text" || e.kind === "voice_transcript");
  const openingEvidence = textEvidence.find(e => !e.field_key && (e.content === problem.problem_summary || e.content.startsWith(problem.problem_summary ?? "\u0000")));
  const initial = openingEvidence?.content ?? problem.problem_summary?.trim();
  if (initial) {
    install(state, fact("user_language", initial, problem.created_at, { source: "opening_text", evidence_ids: openingEvidence ? [openingEvidence.evidence_id] : [] }));
    install(state, fact("symptom_detail", initial, problem.created_at, { source: "opening_text", evidence_ids: openingEvidence ? [openingEvidence.evidence_id] : [] }));
  }
  if (problem.service_category) install(state, fact("normalized_class", problem.service_category, problem.updated_at ?? problem.created_at, { source: "claim", claim_class: "INFERRED", confidence: problem.service_category_confidence ?? "low" }));
  function extract(text: string, at: string, evidence_ids: string[], source: CurrentFact["source"], namedField?: string) {
    // Preserve the full answer to its named field. Cross-field extraction can
    // still collect other literal facts, but must not replace it with a token
    // or treat an incidental mention as a correction of a confirmed sibling.
    // The original answer/evidence retains that mention for later review.
    for (const f of detectFields(text, playbook.required_fields)) {
      if (f.field_key !== namedField) install(state, fact(f.field_key, f.value_text, at, { source, evidence_ids }), false);
    }
    for (const f of detectDiagnosis(text, playbook)) install(state, fact(`check:${f.step_id}`, f.answer, at, { source, evidence_ids }), false);
    const shape = /\b(gradually|gradual|suddenly|sudden|all at once|comes and goes|intermittent)\b/i.exec(text)?.[0];
    if (shape) install(state, fact("onset_character", shape, at, { source, evidence_ids }), false);
  }
  if (initial) extract(initial, problem.created_at, openingEvidence ? [openingEvidence.evidence_id] : [], "opening_text");
  for (const e of textEvidence) extract(e.content, e.captured_at, [e.evidence_id], "evidence");
  for (const claim of input.claims ?? []) {
    if (claim.problem_id !== problem.problem_id) continue;
    if (!playbook.required_fields.some(f => f.field_key === claim.predicate) && !claim.predicate.startsWith("check:")) continue;
    install(state, fact(claim.predicate, claim.object, claim.created_at, { source: "claim", claim_class: claim.claim_class,
      confidence: claim.claim_class === "INFERRED" ? claim.confidence : null, confirmed: claim.claim_class !== "INFERRED" && claim.verification_status === "confirmed",
      status: claim.claim_class !== "INFERRED" && claim.verification_status === "confirmed" ? "CONFIRMED" : "PROVIDED_UNVERIFIED", evidence_ids: claim.evidence_ids, derivation_id: claim.derivation_id }));
  }
  for (const answer of input.answers ?? []) {
    if (answer.request_id !== input.request_id) continue;
    const gap = gapStatus(answer.value_text);
    // A photo with no read value is pending, not proof of the requested field.
    const photoPending = answer.source === "photo" && answer.evidence_id && answer.value_text === null;
    const reading = input.labelReadings?.filter(r => r.evidence_id === answer.evidence_id).at(-1);
    const printedGap = photoPending && reading?.printed_evidence ? printedFieldGap(answer.field_key, reading.printed_evidence) : null;
    const completionGap = printedGap ? { status: printedGap === "reader_unavailable" ? "UNKNOWN_AFTER_REASONABLE_ATTEMPT" as const : "UNREADABLE" as const,
      reason: printedGap === "reader_unavailable" ? "The printed-text reader could not finish this field" : printedGap === "ambiguous" ? "The printed reading was ambiguous" : "This field was not legible in the submitted photo" }
      : photoPending && reading?.extraction_status === "unreadable"
      ? { status: "UNREADABLE" as const, reason: reading.reason?.trim() || "Label extraction completed; the submitted label was unreadable" }
      : photoPending && reading?.extraction_status === "failed"
        ? { status: "UNKNOWN_AFTER_REASONABLE_ATTEMPT" as const, reason: reading.reason?.trim() || "Label extraction completed without a readable result" }
        : null;
    const confidenceMap = input.labelReadings ? reading?.confidence : input.labelConfidence;
    const printedKey = ["thermostat_photo", "thermostat_mode", "fan_mode", "thermostat_setpoint", "room_temp", "filter_nominal_dimensions", "printed_cooling_capacity"].includes(answer.field_key);
    const readConfidence = answer.source === "photo" && !gap ? labelConfidenceFor(answer.field_key, confidenceMap) ?? (printedKey ? "low" : undefined) : undefined;
    install(state, fact(answer.field_key, gap ? null : answer.value_text, answer.answered_at, { source: answer.source === "photo" ? "evidence" : "answer",
      claim_class: readConfidence ? "INFERRED" : answer.source === "photo" ? "OBSERVED" : "SUPPLIED", confidence: readConfidence ?? null,
      evidence_ids: answer.evidence_id ? [answer.evidence_id] : [],
      ...(gap ? gap : {}), ...(photoPending ? { status: "PHOTO_PENDING_EXTRACTION" as const, reason: "Photo supplied; the requested value has not been extracted" } : {}),
      ...(completionGap ?? {}),
      ...(!gap && answer.source === "confirmed" ? { status: "CONFIRMED" as const, confirmed: true } : {}) }));
    if (answer.value_text && !gap && answer.source === "typed") extract(answer.value_text, answer.answered_at, answer.evidence_id ? [answer.evidence_id] : [], "answer", answer.field_key);
  }
  for (const answer of input.diagnosisAnswers ?? []) {
    if (answer.request_id !== input.request_id) continue;
    const gap = gapStatus(answer.answer);
    install(state, fact(`check:${answer.step_id}`, answer.evidence_id && answer.answer === null ? "Photo captured for this check" : gap ? null : answer.answer,
      answer.answered_at, { source: answer.evidence_id ? "evidence" : "answer", evidence_ids: answer.evidence_id ? [answer.evidence_id] : [],
        ...(answer.evidence_id && answer.answer === null ? {} : gap ?? {}) }));
  }
  const photos = (input.evidence ?? []).filter(e => e.kind === "photo" && e.field_key);
  if (photos.length) install(state, fact("evidence_presence", `${photos.length} role-tagged photo(s)`, photos[0].captured_at, { source: "evidence", claim_class: "OBSERVED", evidence_ids: photos.map(e => e.evidence_id) }));
  if (input.safetyGateRan) install(state, fact("safety_gate", "Existing safety gate ran", problem.updated_at ?? problem.created_at, { source: "policy", claim_class: "CALCULATED" }));
  if (input.safetyCoverageComplete !== undefined) install(state, fact("safety_coverage", input.safetyCoverageComplete ? "Existing relevant hazard rules checked" : null,
    problem.updated_at ?? problem.created_at, { source: "policy", claim_class: "CALCULATED", ...(input.safetyCoverageComplete ? {} : { reason: "Relevant hazard-rule coverage has not been established" }) }));
  for (const supplied of input.additionalFacts ?? []) install(state, CurrentFact.parse(supplied));
  return CurrentFactState.parse(state);
}

export const ProviderReadinessState = z.object({
  readiness_state: z.enum(["ready", "ready_with_known_gaps", "stopped"]).nullable(), complete: z.boolean(),
  dimensions: z.array(z.object({ dimension: ReadinessDimension, name: z.string(), satisfied: z.boolean(), required_fields: z.array(z.string()), gaps: z.array(z.string()) })).length(10),
  unresolved_required: z.array(z.string()), gaps: z.array(CurrentFact), stop_reason: z.string().nullable(), technician_only: z.array(z.string()),
});
export type ProviderReadinessState = z.infer<typeof ProviderReadinessState>;
function isResolved(f: CurrentFact | undefined): boolean { return !!f && (f.value !== null || (!!f.reason && f.status !== "PHOTO_PENDING_EXTRACTION")); }
export function isFactPopulated(f: CurrentFact | undefined, minimumConfidence: "low" | "medium" | "high" = "high"): boolean {
  if (!f || f.value === null) return false;
  if (f.claim_class !== "INFERRED") return true;
  return ({ low: 1, medium: 2, high: 3 }[f.confidence ?? "low"] >= { low: 1, medium: 2, high: 3 }[minimumConfidence]);
}
export function computeProviderReadiness(registry: IntakeRegistry, state: CurrentFactState, options: { stop_reason?: string | null; safety_stopped?: boolean } = {}): ProviderReadinessState {
  const required = registry.requirements.filter(r => r.active && r.required_level === "HARD_REQUIRED");
  const unresolved_required = required.filter(r => !isResolved(state.fields[r.fact_type])).map(r => r.fact_type);
  const gaps = Object.values(state.fields).filter(f => f.value === null);
  const dimensions = ReadinessDimension.options.map(dimension => {
    const fields = required.filter(r => r.dimension === dimension).map(r => r.fact_type);
    return { dimension, name: READINESS_DIMENSIONS[dimension], satisfied: dimension === "J" ? unresolved_required.length === 0 : fields.every(key => isResolved(state.fields[key])),
      required_fields: fields, gaps: dimension === "J" ? gaps.map(f => f.field_key) : fields.filter(key => state.fields[key]?.value === null) };
  });
  const complete = unresolved_required.length === 0;
  return ProviderReadinessState.parse({ readiness_state: options.safety_stopped ? "stopped" : !complete ? null : gaps.length ? "ready_with_known_gaps" : "ready", complete,
    dimensions, unresolved_required, gaps, stop_reason: options.stop_reason ?? null, technician_only: gaps.filter(f => f.status === "TECHNICIAN_ONLY").map(f => f.field_key) });
}
/** Called only at an actual terminal condition, never at intake creation. */
export function finalizeFactState(registry: IntakeRegistry, state: CurrentFactState, reason: string): CurrentFactState {
  if (!reason.trim()) throw new Error("Finalization requires the actual stop reason");
  const result: CurrentFactState = { ...state, fields: { ...state.fields } };
  const at = Object.values(state.fields).map(f => f.captured_at).sort().at(-1) ?? new Date().toISOString();
  for (const r of registry.requirements.filter(r => r.active)) {
    const held = result.fields[r.fact_type];
    if (isResolved(held)) continue;
    result.fields[r.fact_type] = fact(r.fact_type, null, held?.captured_at ?? at, { source: "policy", claim_class: "CALCULATED",
      status: r.required_level === "TECHNICIAN_ONLY" ? "TECHNICIAN_ONLY" : "UNKNOWN_AFTER_REASONABLE_ATTEMPT", reason: held?.reason ? `${held.reason}; ${reason}` : reason,
      evidence_ids: held?.evidence_ids ?? [] });
  }
  return CurrentFactState.parse(result);
}

export const QuestionSelectionDecision = z.object({ question_id: z.string().min(1), fills_fields: z.array(z.string().min(1)).min(1), already_populated_fields: z.array(z.string()), policy_version: z.string().min(1) });
export type QuestionSelectionDecision = z.infer<typeof QuestionSelectionDecision>;
export interface QuestionScreen { screen_id: string | null; questions: QuestionDefinition[]; decisions: QuestionSelectionDecision[]; effort_used: number; effort_remaining: number; projected_effort: number; stop_reason: string | null }
export function selectQuestionScreen(registry: IntakeRegistry, state: CurrentFactState, options: {
  effort_used: number; eligible_question_ids?: readonly string[]; answered_question_ids?: readonly string[]; stop_reason?: string | null;
  minimum_confidence?: "low" | "medium" | "high";
}): QuestionScreen {
  if (!Number.isInteger(options.effort_used) || options.effort_used < 0 || options.effort_used > EFFORT_CEILING) throw new Error("Invalid cumulative effort ledger");
  const base = { screen_id: null, questions: [], decisions: [], effort_used: options.effort_used, effort_remaining: EFFORT_CEILING - options.effort_used, projected_effort: options.effort_used };
  if (options.stop_reason || options.effort_used === EFFORT_CEILING) return { ...base, stop_reason: options.stop_reason ?? "effort_ceiling" };
  const populated = Object.values(state.fields).filter(f => isFactPopulated(f, options.minimum_confidence)).map(f => f.field_key);
  const prior = new Set(options.answered_question_ids ?? []);
  const eligible = options.eligible_question_ids ? new Set(options.eligible_question_ids) : null;
  const candidates = registry.questions.map(q => QuestionDefinition.parse(q)).filter(q => q.active && !prior.has(q.question_id) &&
    (eligible ? eligible.has(q.question_id) : q.source_kind !== "check") &&
    q.requirement_ids.every(id => registry.requirements.some(r => r.active && r.requirement_id === id)) && q.effort_units <= base.effort_remaining)
    .flatMap(q => {
      const fields = q.fills_fields.filter(key => !populated.includes(key) && (!state.fields[key] || state.fields[key].value !== null));
      if (!fields.length) return [];
      // Field widgets are rendered and submitted through source_key. A label
      // capture cannot remain actionable merely because missing sibling brand
      // or age slots survive trimming when the label field itself is already
      // held or unobtainable. Select those siblings' own authored controls.
      if (q.source_kind === "field" && !fields.includes(q.source_key)) return [];
      // The address widget completes on street + locality. Optional property
      // context cannot re-emit its held-address/change summary as a new ask.
      // A skipped required address member is terminal in the same way as any
      // other explicit gap; optional details remain available for manual edit.
      if (q.source_kind === "address" && !fields.some(key => key === "property.street" || key === "property.city_state_zip")) return [];
      if (q.input_type === "confirm" && !fields.every(key => state.fields[key]?.value !== undefined && state.fields[key]?.value !== null)) return [];
      // A grouped action can retain its missing widgets, never its known ones.
      // Low-confidence inferred values use the authored confirm variant only.
      if (q.input_type !== "confirm" && fields.some(key => state.fields[key]?.claim_class === "INFERRED")) return [];
      const reqs = registry.requirements.filter(r => fields.includes(r.fact_type));
      return [{ ...q, fills_fields: fields, requirement_ids: reqs.map(r => r.requirement_id), packet_slots: [...new Set(reqs.flatMap(r => r.packet_slots))],
        estimated_data_yield: Math.max(1, Math.floor(q.estimated_data_yield * fields.length / q.fills_fields.length)) }];
    });
  // The cheapest feasible authored rung wins for overlapping fields before the
  // fields-per-turn ranking. Never combine two controls for the same target.
  const rung = { confirm: 4, closed_choice: 5, media: 6, short_text: 7, free_text: 7 };
  const survivors = candidates.filter(q => !candidates.some(other => other !== q && other.fills_fields.some(f => q.fills_fields.includes(f)) && rung[other.input_type] < rung[q.input_type]))
    .sort((a, b) => b.estimated_data_yield - a.estimated_data_yield || a.question_id.localeCompare(b.question_id));
  if (!survivors.length) return { ...base, stop_reason: "no_eligible_question" };
  const screen = survivors[0].screen_id;
  const questions: QuestionDefinition[] = [];
  const filled = new Set<string>();
  let projected = options.effort_used;
  for (const q of survivors.filter(q => q.screen_id === screen)) {
    if (q.fills_fields.some(f => filled.has(f)) || projected + q.effort_units > EFFORT_CEILING) continue;
    questions.push(q); q.fills_fields.forEach(f => filled.add(f)); projected += q.effort_units;
  }
  return { ...base, screen_id: screen, questions, decisions: questions.map(q => QuestionSelectionDecision.parse({ question_id: q.question_id, fills_fields: q.fills_fields, already_populated_fields: populated, policy_version: registry.version })), projected_effort: projected, stop_reason: null };
}

const HandoffFact = z.object({ text: z.string().min(1), claim_class: z.enum(["OBSERVED", "SUPPLIED", "CALCULATED", "INFERRED"]),
  evidence_modality: z.enum(["text", "photo", "video", "label_ocr", "none"]), verification_status: z.enum(["unverified", "confirmed", "tech_only"]),
  evidence_ids: z.array(z.string()), headline_rank: z.number().int().min(1).max(7).nullable(), captured_at: z.string().min(1),
  source_fields: z.array(z.string().min(1)).min(1).optional() });
/** A literal complaint and its provider-register rendering are one sourced
 * observation. Coverage §8.3 never equates the fact counter with array length.
 * Legacy handoffs without trace keys retain their distinct-text identity. */
export function countHandoffFacts(facts: Array<z.infer<typeof HandoffFact>>): number {
  return new Set(facts.map(f => f.source_fields?.length
    ? `fields:${JSON.stringify([...new Set(f.source_fields)].sort())}` : `text:${f.text.trim()}`)).size;
}
/** Higher-authority Directions §8 thin behaviour supersedes Coverage §8.3's
 * unconditional seven-fact invariant. Never pad a real thin handoff to seven. */
export const ProblemRecordHandoff = z.object({
  schema_version: z.literal("1.0.0"), request_id: z.string().min(1), normalized_class: z.string().min(1), problem_title: z.string().min(1), user_language: z.string().min(1),
  readiness_state: z.enum(["ready", "ready_with_known_gaps", "stopped"]), facts: z.array(HandoffFact),
  equipment: z.object({ type: z.string().nullable(), brand: z.string().nullable(), model: z.string().nullable(), serial: z.string().nullable(), age_years: z.number().nullable(), manufacture_year: z.number().nullable(),
    outdoor_location: z.string().nullable(), indoor_location: z.string().nullable(), control_device: z.string().nullable(), source_evidence_id: z.string().nullable(), confirmed_by_homeowner: z.boolean() }),
  property: z.object({ street: z.string().nullable(), city_state_zip: z.string().nullable(), type: z.string().nullable(), storeys: z.string().nullable(), source: z.enum(["lookup", "typed"]).nullable() }),
  outcome_wanted: z.enum(["restore", "stop_damage", "safety", "price", "unsure"]).nullable(), urgency: z.enum(["today", "this_week", "whenever", "planning"]).nullable(),
  safety: z.object({ gate_ran: z.boolean(), flags: z.array(z.string()), clause: z.string().min(1) }),
  timeline: z.array(z.object({ label: z.string(), text: z.string(), source: z.enum(["answer", "exif", "event_log"]), is_final: z.boolean() })),
  checks: z.array(z.object({ name: z.string(), result: z.string(), changed: z.string(), hypothesis_downgraded: z.string().nullable(), provenance: z.string().min(1) })),
  history: z.array(z.object({ question: z.string(), answer: z.string().nullable(), is_gap: z.boolean() })),
  access: z.array(z.object({ field: z.string(), value: z.string().nullable(), asked: z.boolean() })),
  hypotheses: z.array(z.object({ label: z.string(), rank: z.number().int().positive(), rank_word: z.string(), evidence_for: z.array(z.string().min(1)).min(1), evidence_against: z.array(z.string().min(1)).min(1) })),
  unknowns: z.array(z.object({ fact: z.string().min(1), status: FactStatus, reason: z.string().min(1), blocked_by: z.string().nullable() })),
  tech_only: z.array(z.object({ test: z.string().min(1) })), scope_factors: z.array(z.object({ text: z.string().min(1) })),
  evidence: z.array(z.object({ id: z.string().min(1), role: z.string().min(1), kind: z.enum(["photo", "video"]), caption: z.string(), captured_at: z.string().nullable(), duration_s: z.number().optional() })),
  counts: z.object({ facts: z.number().int().nonnegative(), photos: z.number().int().nonnegative(), checks: z.number().int().nonnegative(), made_less_likely: z.number().int().nonnegative(), tech_only: z.number().int().nonnegative() }),
  fact_state: CurrentFactState,
}).strict().superRefine((h, ctx) => {
  const error = (message: string) => ctx.addIssue({ code: "custom", message });
  const ranks = h.facts.flatMap(f => f.headline_rank === null ? [] : [f.headline_rank]);
  if (new Set(ranks).size !== ranks.length) error("Headline ranks must be distinct");
  if (h.counts.photos !== h.evidence.length || h.counts.checks !== h.checks.length || h.counts.tech_only !== h.tech_only.length || h.counts.facts !== countHandoffFacts(h.facts)) error("Counters must equal their actual lists and distinct sourced facts");
  if (!h.facts.some(f => f.text === h.user_language && f.claim_class === "SUPPLIED")) error("One supplied fact must preserve literal homeowner wording");
  if (h.timeline.filter(t => t.is_final).length !== 1 || !h.timeline.at(-1)?.is_final || h.timeline.at(-1)?.text !== "Packet generated.") error("The final generation event must be unique and last");
  if (h.fact_state.request_id !== h.request_id) error("Handoff facts belong to another request");
  if (h.readiness_state === "ready" && h.unknowns.length) error("A handoff with unknowns is not ready without known gaps");
  if (h.access.some(a => /code|lockbox/i.test(a.field) && a.value !== null)) error("Entry codes never enter the packet handoff");
});
export type ProblemRecordHandoff = z.infer<typeof ProblemRecordHandoff>;
export function validateHandoffTrace(value: unknown, registry: IntakeRegistry): string[] {
  const parsed = ProblemRecordHandoff.safeParse(value);
  if (!parsed.success) return parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`);
  const h = parsed.data;
  const issues: string[] = [];
  for (const r of registry.requirements.filter(r => r.active && r.required_level === "HARD_REQUIRED")) {
    const f = h.fact_state.fields[r.fact_type];
    if (!isResolved(f)) issues.push(`Required ${r.fact_type} has neither a value nor a terminal gap reason`);
    if (f?.value === null && !h.unknowns.some(u => u.fact === r.fact_type && u.reason === f.reason)) issues.push(`Gap ${r.fact_type} is absent from the handoff unknowns`);
  }
  for (const q of registry.questions) for (const key of q.fills_fields) {
    if (!registry.requirements.some(r => r.fact_type === key && r.packet_slots.length)) issues.push(`Orphan question field ${key}`);
  }
  const direct: Array<[string, string | null]> = [["brand", h.equipment.brand], ["equipment_type", h.equipment.type],
    ["outdoor_unit_location", h.equipment.outdoor_location], ["air_handler_location", h.equipment.indoor_location],
    ["property.street", h.property.street], ["property.city_state_zip", h.property.city_state_zip], ["property.type", h.property.type], ["property.storeys", h.property.storeys]];
  for (const [key, emitted] of direct) {
    const held = h.fact_state.fields[key]?.value?.trim() || null;
    if ((emitted?.trim() || null) !== held) issues.push(`Packet field ${key} does not trace to its held fact`);
  }
  if (h.outcome_wanted !== (h.fact_state.fields.outcome_wanted?.value ?? null)) issues.push("Packet field outcome_wanted does not trace to its held fact");
  for (const f of h.facts) {
    if (!f.source_fields) continue;
    const held = f.source_fields.filter(key => !key.startsWith("evidence:")).map(key => h.fact_state.fields[key]);
    if (held.some(value => !value || value.value === null)) issues.push(`Fact ${f.text} has an unresolved source field`);
    const sourceIds = new Set([...held.flatMap(value => value?.evidence_ids ?? []), ...f.source_fields.filter(key => key.startsWith("evidence:")).map(key => key.slice(9))]);
    if (f.evidence_ids.some(id => !sourceIds.has(id))) issues.push(`Fact ${f.text} borrows unrelated evidence`);
  }
  if (h.user_language !== h.fact_state.fields.user_language?.value) issues.push("Literal homeowner words do not trace to the opening evidence");
  return issues;
}
