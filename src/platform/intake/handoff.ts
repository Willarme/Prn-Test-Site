import { ProblemRecordHandoff, validateHandoffTrace, buildIntakeRegistry, buildCurrentFactState,
  finalizeFactState, computeProviderReadiness, selectQuestionScreen, countHandoffFacts, QUESTION_COSTS, READINESS_POLICY_VERSION } from "@/domain/intake/readiness";
import { buildDirectionsInput, parseModelSerial } from "@/domain/packet/directions-input";
import { selectFacts } from "@/domain/packet/render";
import type { JobPacket } from "@/domain/problem/contracts";
import type { loadJourneyContext } from "@/platform/intake/complete";
import type { intakeReadiness } from "@/platform/intake/readiness";
import type { IntakeAnswer, DiagnosisAnswer } from "@/domain/intake/playbook";
import type { FactClaim } from "@/domain/problem/contracts";

type Context = NonNullable<Awaited<ReturnType<typeof loadJourneyContext>>>;
type Snapshot = Awaited<ReturnType<typeof intakeReadiness>>;

/** First generation has a real opening action but no prior durable request to
 * join yet. Its known cost is written with the journey and the matching opening
 * ledger operation is recorded before ownership is issued to the browser. */
export function initialPacketSnapshot(ctx: Context, answers: IntakeAnswer[], diagnosis: DiagnosisAnswer[], claims: FactClaim[]): NonNullable<JobPacket["intake_snapshot"]> {
  const registry = buildIntakeRegistry(ctx.playbook);
  const facts = buildCurrentFactState({ request_id: ctx.journey.session.request_id, playbook: ctx.playbook,
    problem: ctx.journey.problem, evidence: ctx.allEvidence, answers, diagnosisAnswers: diagnosis, claims,
    safetyGateRan: true, safetyCoverageComplete: false });
  const finalFacts = finalizeFactState(registry, facts, "packet_requested");
  const readiness = computeProviderReadiness(registry, finalFacts);
  const ledger: Snapshot["ledger"] = { request_id: ctx.journey.session.request_id, tenant_id: ctx.journey.problem.tenant_id ?? "prn",
    problem_id: ctx.journey.problem.problem_id, policy_version: READINESS_POLICY_VERSION, effort_spent: QUESTION_COSTS.free_text,
    max_effort: 20 as const, finished_at: null, finish_reason: null, attempts: [] };
  const snapshot: Snapshot = { registry, facts, finalFacts, readiness, ledger, answers, diagnosis, claims,
    position: { currentStepId: ctx.playbook.first_step_id, outcomeId: null },
    screen: selectQuestionScreen(registry, facts, { effort_used: ledger.effort_spent }) };
  return { packet_id: ctx.journey.packet.job_packet_id, packet_version: ctx.journey.packet.packet_version,
    policy_version: registry.version, effort_spent: ledger.effort_spent,
    handoff: buildIntakeHandoff(ctx, snapshot, ctx.journey.packet), readiness };
}

/** Private versioned handoff: existing Directions transforms are reused. The
 * provider/public renderers continue to apply their existing privacy firewall. */
export function buildIntakeHandoff(ctx: Context, snapshot: Snapshot, packet: JobPacket): ProblemRecordHandoff {
  const { finalFacts, registry } = snapshot;
  const input = buildDirectionsInput({ ...ctx, journey: { ...ctx.journey, packet },
    answers: snapshot.answers, diagnosis: snapshot.diagnosis, claims: snapshot.claims, evidence: ctx.allEvidence,
  }, { link_base: "https://handoff.invalid", home_memory_url: "", trust_network_url: "", media_link: null, now: packet.generated_at });
  const value = (key: string) => finalFacts.fields[key]?.value ?? null;
  const literal = ctx.textEvidence.content;
  const selected = selectFacts(input.narrative.facts).facts;
  const facts: ProblemRecordHandoff["facts"] = input.narrative.facts.map(candidate => {
    const fields = candidate.source_fields;
    if (!fields?.length) throw new Error("Packet fact has no authored source fields");
    const held = fields.filter(key => !key.startsWith("evidence:")).map(key => finalFacts.fields[key]);
    if (held.some(f => !f || f.value === null)) throw new Error("Packet fact has an unresolved source field");
    const ids = [...new Set([...held.flatMap(f => f.evidence_ids), ...fields.filter(key => key.startsWith("evidence:")).map(key => key.slice(9))])];
    const evidence = ids.map(id => ctx.allEvidence.find(e => e.evidence_id === id));
    if (evidence.some(e => !e)) throw new Error("Packet fact references missing evidence");
    const at = [...held.map(f => f.captured_at), ...evidence.map(e => e!.captured_at)].sort().at(-1);
    if (!at) throw new Error("Packet fact has no source capture time");
    const visual = candidate.provenance === "seen_in_photo_or_video" || candidate.provenance === "read_from_label";
    const modality = candidate.provenance === "read_from_label" ? "label_ocr" : visual
      ? evidence.some(e => e!.kind === "video") ? "video" : "photo"
      : evidence.some(e => e!.kind === "customer_text" || e!.kind === "voice_transcript") ? "text" : "none";
    const rank = selected.indexOf(candidate);
    return { text: candidate.text, claim_class: candidate.provenance === "inference" ? "INFERRED" : visual ? "OBSERVED" : "SUPPLIED",
      evidence_modality: modality, verification_status: candidate.provenance === "confirmed_by_homeowner" ? "confirmed" : "unverified",
      evidence_ids: ids, source_fields: fields, headline_rank: rank >= 0 ? rank + 1 : null, captured_at: at };
  });
  // Retain the exact original as a supplied FactClaim. The provider-register
  // complaint shares its source identity, so this does not inflate the count.
  facts.unshift({ text: literal, claim_class: "SUPPLIED", evidence_modality: "text", verification_status: "unverified",
    evidence_ids: [ctx.textEvidence.evidence_id], source_fields: ["user_language"], headline_rank: null, captured_at: ctx.textEvidence.captured_at });
  const equipmentIds = parseModelSerial(value("unit_model_serial") ?? "");
  const media = input.evidence.media.filter(e => e.kind === "photo" || e.kind === "video").map(e => ({
    id: e.id, role: e.subject, kind: e.kind as "photo" | "video", caption: e.subject, captured_at: e.captured_at ?? null,
    ...(e.duration_seconds !== null && e.duration_seconds !== undefined ? { duration_s: e.duration_seconds } : {}),
  }));
  const checks = input.provider.checks.map(c => ({ name: c.name, result: c.result, changed: c.changed,
    hypothesis_downgraded: null, provenance: c.result_provenance }));
  const unknowns = Object.values(finalFacts.fields).filter(f => f.value === null).map(f => ({
    fact: f.field_key, status: f.status, reason: f.reason!, blocked_by: f.status === "TECHNICIAN_ONLY" ? "technician" : null,
  }));
  const tech_only = input.provider.technician_only.map(test => ({ test }));
  const h = ProblemRecordHandoff.parse({
    schema_version: "1.0.0", request_id: ctx.journey.session.request_id,
    normalized_class: ctx.playbook.playbook_id, problem_title: input.problem.title, user_language: literal,
    readiness_state: snapshot.readiness.readiness_state, facts,
    equipment: { type: value("equipment_type"), brand: value("brand"),
      model: equipmentIds.model, serial: equipmentIds.serial, age_years: input.equipment.age_years ?? null,
      manufacture_year: input.equipment.manufacture_year ?? null, outdoor_location: input.equipment.outdoor_unit_location?.value ?? null,
      indoor_location: input.equipment.air_handler_location?.value ?? null, control_device: input.equipment.thermostat?.value ?? null,
      source_evidence_id: finalFacts.fields.unit_model_serial?.evidence_ids[0] ?? null,
      confirmed_by_homeowner: finalFacts.fields.unit_model_serial?.confirmed ?? false },
    property: { street: ctx.address?.street ?? null, city_state_zip: ctx.address?.city_state_zip ?? null,
      type: ctx.address?.property_type ?? null, storeys: ctx.address?.storeys ?? null, source: ctx.address ? "typed" : null },
    outcome_wanted: value("outcome_wanted"),
    // The newer Directions vocabulary is not equivalent to the older handoff
    // enum: preserve exact urgency in fact_state and map only exact meanings.
    urgency: value("urgency")?.toLowerCase() === "today" ? "today" : value("urgency")?.toLowerCase() === "planned work" ? "planning" : null,
    safety: { gate_ran: value("safety_gate") !== null, flags: input.problem.hazard_flags,
      clause: input.problem.safety_state },
    timeline: [...input.narrative.timeline.map(t => ({ label: t.label, text: t.text, source: "answer" as const, is_final: false })),
      { label: packet.generated_at, text: "Packet generated.", source: "event_log", is_final: true }],
    checks,
    history: input.provider.service_history.map(h => ({ question: h.question_id, answer: h.answer, is_gap: h.provenance === "unknown" })),
    access: [...ctx.playbook.required_fields.filter(f => f.optional_group === "access").map(f => ({
      field: f.field_key, value: value(f.field_key), asked: snapshot.ledger.attempts.some(a => a.operation.selection_decisions.some(d => d.fills_fields.includes(f.field_key))) })),
      { field: "gate_entry", value: null, asked: false }],
    hypotheses: input.provider.branches.map((b, i) => ({ label: b.name, rank: i + 1, rank_word: b.confidence,
      evidence_for: [b.for], evidence_against: [b.against] })), unknowns, tech_only,
    scope_factors: input.provider.scope_factors.map(text => ({ text })), evidence: media,
    counts: { facts: countHandoffFacts(facts), photos: media.length, checks: checks.length,
      made_less_likely: input.provider.checks.filter(c => ["rules_out", "unlikely", "less_likely"].includes(c.certainty)).length,
      tech_only: tech_only.length }, fact_state: finalFacts,
  });
  const issues = validateHandoffTrace(h, registry);
  if (issues.length) throw new Error(`Invalid intake handoff: ${issues.join("; ")}`);
  return h;
}
