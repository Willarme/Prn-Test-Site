import { describe, expect, it } from "vitest";
import { buildIntakeRegistry, buildCurrentFactState, computeProviderReadiness, finalizeFactState, selectQuestionScreen, CurrentFact,
  CurrentFactState, QuestionDefinition, ProblemRecordHandoff, validateHandoffTrace, QUESTION_COSTS, EFFORT_CEILING, filterProviderQuestions,
  type IntakeRegistry, type BuildFactStateInput, type ProblemRecordHandoff as Handoff } from "@/domain/intake/readiness";
import { HVAC_COOLING_PLAYBOOK } from "@/domain/intake/playbooks/hvac-cooling";
import { PLAYBOOKS, selectPlaybook } from "@/domain/intake/playbooks";
import { analyzeProblemFixture, buildJobPacketFixture } from "@/domain/problem/fixture-engine";
import { PROBLEM_CASES } from "../evals/cases/ac-not-cooling";
import type { IntakeAnswer } from "@/domain/intake/playbook";
import { assemblePacket } from "@/domain/problem/packet-assembly";

const at = "2026-09-06T15:00:00.000Z";
const later = "2026-09-06T15:01:00.000Z";
const request_id = "request-readiness";
const pb = HVAC_COOLING_PLAYBOOK;
const registry = buildIntakeRegistry(pb);
function setup(description = "My AC isn't cooling.") {
  const { problem, evidence } = analyzeProblemFixture({ description, intake_session_id: request_id, problem_family_hint: "hvac", now: at });
  return { problem, evidence };
}
function state(description?: string, answers: IntakeAnswer[] = []) {
  const data = setup(description);
  return buildCurrentFactState({ request_id, playbook: pb, problem: data.problem, evidence: [data.evidence], answers, safetyGateRan: true, safetyCoverageComplete: true });
}
function answer(field_key: string, value_text: string | null, source: IntakeAnswer["source"] = "typed", answered_at = later): IntakeAnswer {
  return { request_id, field_key, value_text, source, answered_at, evidence_id: source === "photo" || source === "confirmed" ? "label-photo" : null };
}
function additional(field_key: string, value: string | null, patch: Partial<CurrentFact> = {}): CurrentFact {
  return CurrentFact.parse({ field_key, value, status: value === null ? "INACCESSIBLE" : "PROVIDED_UNVERIFIED", reason: value === null ? "Equipment inaccessible" : null,
    source: "answer", claim_class: "SUPPLIED", evidence_ids: [], captured_at: later, confidence: null, confirmed: false, ...patch });
}
function handoff(reg: IntakeRegistry = registry): Handoff {
  const facts = finalizeFactState(reg, state(), "Homeowner chose finish with what we have");
  const gaps = Object.values(facts.fields).filter(f => f.value === null);
  return { schema_version: "1.0.0", request_id, normalized_class: "hvac_no_cool", problem_title: "Cooling problem", user_language: "My AC isn't cooling.", readiness_state: "ready_with_known_gaps",
    facts: [{ text: "My AC isn't cooling.", claim_class: "SUPPLIED", evidence_modality: "text", verification_status: "unverified", evidence_ids: [], headline_rank: 1, captured_at: at }],
    equipment: { type: null, brand: null, model: null, serial: null, age_years: null, manufacture_year: null, outdoor_location: null, indoor_location: null, control_device: null, source_evidence_id: null, confirmed_by_homeowner: false },
    property: { street: null, city_state_zip: null, type: null, storeys: null, source: null }, outcome_wanted: null, urgency: null,
    safety: { gate_ran: true, flags: [], clause: "safety not established" }, timeline: [{ label: at, text: "Packet generated.", source: "event_log", is_final: true }], checks: [], history: [], access: [], hypotheses: [],
    unknowns: gaps.map(g => ({ fact: g.field_key, status: g.status, reason: g.reason!, blocked_by: null })), tech_only: [], scope_factors: [], evidence: [],
    counts: { facts: 1, photos: 0, checks: 0, made_less_likely: 0, tech_only: 0 }, fact_state: facts };
}

describe("T1-35 versioned registry and shared memory", () => {
  it("a strictly later homeowner correction replaces confirmation, while OCR and tied weaker answers cannot", () => {
    const initial = answer("filter_nominal_dimensions", "16 x 20 x 1 in", "confirmed", at);
    const correction = answer("filter_nominal_dimensions", "20 x 25 x 1 in", "typed", later);
    const photo = answer("filter_nominal_dimensions", "16 x 20 x 1 in", "photo", "2026-09-06T15:02:00.000Z");
    const current = state(undefined, [initial, correction, photo]);
    expect(current.fields.filter_nominal_dimensions).toMatchObject({ value: "20 x 25 x 1 in", source: "answer", claim_class: "SUPPLIED", confirmed: false, evidence_ids: [] });
    expect(state(undefined, [initial, { ...correction, answered_at: at }]).fields.filter_nominal_dimensions.confirmed).toBe(true);
    expect(state(undefined, [initial, { ...correction, value_text: null }]).fields.filter_nominal_dimensions).toMatchObject({ value: null, confirmed: false });
  });
  it("wraps every existing playbook without orphan slots or a code question", () => {
    for (const playbook of PLAYBOOKS) {
      const reg = buildIntakeRegistry(playbook);
      expect(reg.questions.length).toBeGreaterThan(0);
      for (const q of reg.questions) {
        expect(QuestionDefinition.safeParse(q).success).toBe(true);
        expect(q.fills_fields.every(f => reg.requirements.some(r => r.fact_type === f && r.packet_slots.length > 0))).toBe(true);
        expect(q.fills_fields.some(f => /gate.*code|entry.*code/.test(f))).toBe(false);
      }
      expect(reg.questions.filter(q => q.source_kind === "check").length).toBe(playbook.diagnostic_steps.length);
    }
  });
  it("uses one field map for dense opening text, checked observations and fixture suggestions", () => {
    const description = "My Carrier AC is 8 years old and blowing warm air since Tuesday. The filter is clean. The outdoor fan is spinning.";
    const facts = state(description);
    expect(facts.fields.brand.value).toBe("Carrier");
    expect(facts.fields.system_age.value).toBe("8 years");
    expect(facts.fields.symptom_timing.value).toBe("since Tuesday");
    expect(facts.fields["check:filter"].value).toBe("reported_clean");
    const selected = selectQuestionScreen(registry, facts, { effort_used: 5, eligible_question_ids: registry.questions.map(q => q.question_id) });
    expect(selected.questions.flatMap(q => q.fills_fields)).not.toEqual(expect.arrayContaining(["brand", "system_age", "symptom_timing", "check:filter", "check:fan_moving"]));
    for (const q of selected.questions) expect(q.fills_fields.some(f => ["brand", "system_age", "symptom_timing", "check:filter", "check:fan_moving"].includes(f))).toBe(false);
    const data = setup(description);
    const packet = buildJobPacketFixture(data.problem, data.evidence, at);
    expect(packet.questions_for_provider).not.toContain("Roughly how old is the system, if you know?");
    expect(packet.questions_for_provider).not.toContain("When did this start, and has it gotten better or worse?");
  });
  it("label facts and prior answers remove individual members from a grouped capture", () => {
    const facts = state(undefined, [answer("brand", "Carrier", "photo"), answer("system_age", "8 years", "confirmed")]);
    const selection = selectQuestionScreen(registry, facts, { effort_used: 5, eligible_question_ids: ["field:unit_model_serial:media"] });
    expect(selection.questions[0].fills_fields.sort()).toEqual(["equipment_type", "unit_model_serial"]);
    expect(selection.decisions[0].already_populated_fields).toContain("brand");
    expect(selection.decisions[0].fills_fields).not.toContain("brand");
    const all = state(undefined, [answer("brand", "Carrier", "photo"), answer("system_age", "8 years", "photo"), answer("unit_model_serial", "24ABC636A003", "photo"), answer("equipment_type", "Split AC", "photo")]);
    expect(selectQuestionScreen(registry, all, { effort_used: 8, eligible_question_ids: ["field:unit_model_serial:media"] }).questions).toEqual([]);
  });
  it("the actual assembly path filters provider asks using later stored answers, with a different intake-session ID", () => {
    const data = setup(); data.problem.intake_session_id = "different-attribution-session";
    const packet = assemblePacket({ request_id, problem: data.problem, textEvidence: data.evidence, allEvidence: [data.evidence],
      playbook: pb, answers: [answer("system_age", "8 years", "photo"), answer("thermostat_photo", "Display responds; set to cool", "confirmed")], diagnosis: [], version: 2, now: later });
    expect(packet.questions_for_provider).not.toContain("Roughly how old is the system, if you know?");
    expect(packet.questions_for_provider).not.toContain("Is the thermostat set to the mode you expect (heat/cool), and does its display respond?");
  });
  it("preserves a confirmed fact against later inferred or uncertain supplied data", () => {
    const data = setup();
    const held = buildCurrentFactState({ request_id, playbook: pb, problem: data.problem,
      answers: [answer("brand", "Carrier", "confirmed")],
      additionalFacts: [additional("brand", "Trane", { claim_class: "INFERRED", confidence: "high", captured_at: "2026-09-06T16:00:00.000Z" })] });
    expect(held.fields.brand.value).toBe("Carrier");
    expect(held.fields.brand.confirmed).toBe(true);
    expect(held.fields.brand.evidence_ids).toEqual(["label-photo"]);
  });
  it("confirms low-confidence inference instead of re-requesting the value", () => {
    const facts = state();
    facts.fields.brand = additional("brand", "Carrier", { claim_class: "INFERRED", confidence: "low" });
    const selected = selectQuestionScreen(registry, facts, { effort_used: 5, eligible_question_ids: ["field:brand:confirm", "field:brand:short_text"] });
    expect(selected.questions.map(q => q.question_id)).toEqual(["field:brand:confirm"]);
  });
  it("uses actual low OCR confidence for a confirm, preserves photo provenance, and does not emit another upload", () => {
    const data = setup();
    const facts = buildCurrentFactState({ request_id, playbook: pb, problem: data.problem,
      answers: [answer("unit_model_serial", "24ABC636A003 / 123456789", "photo")], labelConfidence: { model: "high", serial: "low" } });
    expect(facts.fields.unit_model_serial).toMatchObject({ claim_class: "INFERRED", confidence: "low", evidence_ids: ["label-photo"], confirmed: false });
    const selected = selectQuestionScreen(registry, facts, { effort_used: 8, eligible_question_ids: registry.questions.filter(q => q.source_key === "unit_model_serial").map(q => q.question_id) });
    expect(selected.questions.map(q => q.question_id)).toEqual(["field:unit_model_serial:confirm"]);
  });
  it("does not assume a missing model/serial confidence is high and cannot overwrite a homeowner confirmation with OCR", () => {
    const data = setup();
    const medium = buildCurrentFactState({ request_id, playbook: pb, problem: data.problem,
      answers: [answer("unit_model_serial", "24ABC636A003", "photo")], labelConfidence: { model: "medium" } });
    expect(medium.fields.unit_model_serial.confidence).toBe("medium");
    const confirmed = buildCurrentFactState({ request_id, playbook: pb, problem: data.problem,
      answers: [answer("brand", "Carrier", "confirmed", at), answer("brand", "Trane", "photo", later)], labelConfidence: { brand: "low" } });
    expect(confirmed.fields.brand).toMatchObject({ value: "Carrier", claim_class: "SUPPLIED", confirmed: true, confidence: null });
  });
  it("binds confidence to the actual evidence ID and maps actual type/year reader keys", () => {
    const data = setup();
    const facts = buildCurrentFactState({ request_id, playbook: pb, problem: data.problem,
      answers: [answer("equipment_type", "Split AC", "photo"), answer("system_age", "About 8 years old (2018 on the label)", "photo"), answer("unit_model_serial", "Model X24ABCDE", "photo")],
      labelReadings: [
        { evidence_id: "label-photo", confidence: { equipment_type: "medium", manufacture_year: "low", model: "medium" } },
        { evidence_id: "different-label", confidence: { equipment_type: "high", manufacture_year: "high", model: "high", serial: "high" } },
      ] });
    expect(facts.fields.equipment_type.confidence).toBe("medium"); expect(facts.fields.system_age.confidence).toBe("low"); expect(facts.fields.unit_model_serial.confidence).toBe("medium");
    const absent = buildCurrentFactState({ request_id, playbook: pb, problem: data.problem, answers: [answer("brand", "Carrier", "photo")],
      labelReadings: [{ evidence_id: "different-label", confidence: { brand: "high" } }], labelConfidence: { brand: "high" } });
    expect(absent.fields.brand.confidence).toBeNull();
  });
  for (const [extraction_status, status] of [["unreadable", "UNREADABLE"], ["failed", "UNKNOWN_AFTER_REASONABLE_ATTEMPT"]] as const) {
    it(`completed ${extraction_status} extraction records the actual gap instead of leaving permanent pending`, () => {
      const data = setup();
      const facts = buildCurrentFactState({ request_id, playbook: pb, problem: data.problem,
        answers: [answer("unit_model_serial", null, "photo")], labelReadings: [{ evidence_id: "label-photo", confidence: {}, extraction_status, reason: "Actual completed reader outcome" }] });
      expect(facts.fields.unit_model_serial).toMatchObject({ value: null, status, reason: "Actual completed reader outcome", evidence_ids: ["label-photo"] });
      expect(selectQuestionScreen(registry, facts, { effort_used: 8, eligible_question_ids: ["field:unit_model_serial:media"] }).questions).toEqual([]);
    });
  }
  it("new readable evidence replaces a completed unreadable gap without borrowing another evidence outcome", () => {
    const data = setup();
    const old = answer("unit_model_serial", null, "photo", at);
    const replacement = { ...answer("unit_model_serial", "Model X24ABCDE", "photo", later), evidence_id: "new-readable-photo" };
    const readings: NonNullable<BuildFactStateInput["labelReadings"]> = [
      { evidence_id: "label-photo", confidence: {}, extraction_status: "unreadable" as const, reason: "Characters unreadable" },
      { evidence_id: "new-readable-photo", confidence: { model: "high" as const }, extraction_status: "readable" as const },
    ];
    const completed = buildCurrentFactState({ request_id, playbook: pb, problem: data.problem, answers: [old, replacement], labelReadings: readings });
    expect(completed.fields.unit_model_serial).toMatchObject({ value: "Model X24ABCDE", status: "PROVIDED_UNVERIFIED", reason: null, evidence_ids: ["new-readable-photo"] });
    const pending = buildCurrentFactState({ request_id, playbook: pb, problem: data.problem, answers: [{ ...old, evidence_id: "unrelated-photo" }], labelReadings: readings });
    expect(pending.fields.unit_model_serial.status).toBe("PHOTO_PENDING_EXTRACTION");
  });
  it("pending extraction, inaccessible and explicit unknown answers never produce another missing-field ask", () => {
    for (const submitted of [answer("unit_model_serial", null, "photo"), answer("unit_model_serial", "__cannot_reach__"), answer("unit_model_serial", "Not sure")]) {
      const selection = selectQuestionScreen(registry, state(undefined, [submitted]), { effort_used: 8, eligible_question_ids: ["field:unit_model_serial:media", "field:unit_model_serial:short_text"] });
      expect(selection.questions.flatMap(q => q.fills_fields)).not.toContain("unit_model_serial");
    }
  });
  for (const primary of [
    answer("unit_model_serial", "__cannot_reach__"),
    answer("unit_model_serial", "Not sure"),
    answer("unit_model_serial", null, "photo"),
    answer("unit_model_serial", "Model X24ABCDE", "photo"),
    answer("unit_model_serial", "Model X24ABCDE", "confirmed"),
  ]) it(`does not emit a label widget with an unavailable primary action: ${primary.source}/${primary.value_text}`, () => {
    const facts = state(undefined, [primary]);
    const eligible = ["field:unit_model_serial:media", "field:brand:short_text", "field:system_age:short_text", "field:sh_refrigerant:closed_choice"];
    const first = selectQuestionScreen(registry, facts, { effort_used: 5, eligible_question_ids: eligible });
    expect(first.questions.some(q => q.source_key === "unit_model_serial")).toBe(false);
    expect(first.questions.map(q => q.source_key)).toEqual(["brand", "system_age"]);
    expect(first.questions.every(q => q.fills_fields.includes(q.source_key))).toBe(true);
    facts.fields.brand = additional("brand", "Carrier"); facts.fields.system_age = additional("system_age", "8 years");
    const next = selectQuestionScreen(registry, facts, { effort_used: first.projected_effort, eligible_question_ids: eligible });
    expect(next.screen_id).toBe("history");
    expect(next.questions.map(q => q.source_key)).toEqual(["sh_refrigerant"]);
    facts.fields.sh_refrigerant = additional("sh_refrigerant", null, { status: "UNKNOWN_AFTER_REASONABLE_ATTEMPT", reason: "Homeowner chose Not sure" });
    expect(selectQuestionScreen(registry, facts, { effort_used: next.projected_effort, eligible_question_ids: eligible }).stop_reason).toBe("no_eligible_question");
  });
  it("does not treat a photo storage reference or a graph satisfies_fields declaration as a reading", () => {
    const data = setup();
    const facts = buildCurrentFactState({ request_id, playbook: pb, problem: data.problem, evidence: [{ evidence_id: "photo1", kind: "photo", content: "private://store/Carrier.png", privacy: "private", captured_at: at, field_key: "unit_model_serial" }] });
    expect(facts.fields.brand).toBeUndefined();
    expect(facts.fields.unit_model_serial).toBeUndefined();
    expect(facts.fields.evidence_presence.value).toBe("1 role-tagged photo(s)");
  });
  it("retains all literal opening text when ProblemRecord's summary was truncated", () => {
    const text = `My AC isn't cooling. ${"More detail from the homeowner. ".repeat(15)}My Carrier is 8 years old.`;
    const data = setup(text);
    expect(data.problem.problem_summary!.length).toBe(240);
    const facts = buildCurrentFactState({ request_id, playbook: pb, problem: data.problem, evidence: [data.evidence] });
    expect(facts.fields.user_language.value).toBe(text);
    expect(facts.fields.brand.value).toBe("Carrier");
  });
});

describe("T1-35 deterministic screen selection and effort", () => {
  it("charges canonical actual costs and rejects fabricated or duplicate yields", () => {
    expect(QUESTION_COSTS).toEqual({ closed_choice: 1, confirm: 1, media: 3, short_text: 4, free_text: 5 });
    expect(QuestionDefinition.safeParse({ ...registry.questions[0], effort_units: 0 }).success).toBe(false);
    expect(QuestionDefinition.safeParse({ ...registry.questions[0], fills_fields: ["brand", "brand"] }).success).toBe(false);
    expect(QuestionDefinition.safeParse({ ...registry.questions[0], fills_fields: [] }).success).toBe(false);
  });
  it("does not expose any not-yet-authorized graph step by default", () => {
    expect(selectQuestionScreen(registry, state(), { effort_used: 5 }).questions.some(q => q.source_kind === "check")).toBe(false);
  });
  it("selects media before a typed label answer and groups without overlapping facts", () => {
    const selected = selectQuestionScreen(registry, state(), { effort_used: 5 });
    expect(selected.questions.some(q => q.question_id === "field:unit_model_serial:media")).toBe(true);
    const fields = selected.questions.flatMap(q => q.fills_fields);
    expect(new Set(fields).size).toBe(fields.length);
    expect(selected.projected_effort).toBeLessThanOrEqual(EFFORT_CEILING);
  });
  it("accounts each constituent action in a grouped history screen", () => {
    const ids = registry.questions.filter(q => q.screen_id === "history").map(q => q.question_id);
    const screen = selectQuestionScreen(registry, state(), { effort_used: 5, eligible_question_ids: ids });
    expect(screen.questions.length).toBe(4);
    // Existing recent-service field is short typed input (4); the other three
    // are closed sets (1). Grouping cannot magically price this card at one.
    expect(screen.projected_effort).toBe(12);
  });
  it("handles every remaining budget without crossing twenty and stops at the exact ceiling", () => {
    for (let used = 0; used <= EFFORT_CEILING; used++) {
      const s = selectQuestionScreen(registry, state(), { effort_used: used });
      expect(s.projected_effort).toBeLessThanOrEqual(20);
      expect(s.projected_effort).toBe(used + s.questions.reduce((n, q) => n + q.effort_units, 0));
    }
    expect(selectQuestionScreen(registry, state(), { effort_used: 20 }).stop_reason).toBe("effort_ceiling");
    expect(() => selectQuestionScreen(registry, state(), { effort_used: 21 })).toThrow();
  });
  it("a previously attempted question and an explicit finish prevent a second imposition", () => {
    const ids = ["field:unit_model_serial:media"];
    expect(selectQuestionScreen(registry, state(), { effort_used: 8, eligible_question_ids: ids, answered_question_ids: ids }).questions).toEqual([]);
    expect(selectQuestionScreen(registry, state(), { effort_used: 5, stop_reason: "homeowner_finish" }).questions).toEqual([]);
  });
  it("uses the authored property group and omits populated address widgets", () => {
    const facts = state(); facts.fields["property.street"] = additional("property.street", "101 Example St");
    const q = selectQuestionScreen(registry, facts, { effort_used: 5, eligible_question_ids: ["address:short_text"] }).questions[0];
    expect(q.screen_id).toBe("property"); expect(q.effort_units).toBe(4); expect(q.fills_fields).not.toContain("property.street");
  });
  it("does not ask for a saved address again to collect missing optional type or storeys", () => {
    const facts = state();
    facts.fields["property.street"] = additional("property.street", "101 Example St");
    facts.fields["property.city_state_zip"] = additional("property.city_state_zip", "Fort Wayne, IN 46801");
    const selected = selectQuestionScreen(registry, facts, { effort_used: 9, eligible_question_ids: ["address:short_text", "field:sh_refrigerant:closed_choice"] });
    expect(selected.questions.some(q => q.source_kind === "address")).toBe(false);
    expect(selected.screen_id).toBe("history");
    expect(facts.fields["property.type"]).toBeUndefined();
    expect(facts.fields["property.storeys"]).toBeUndefined();
  });
  it("a skipped address stays terminal without a new ask for optional residual fields", () => {
    const facts = state();
    for (const key of ["property.street", "property.city_state_zip", "property.type", "property.storeys"]) facts.fields[key] = additional(key, null, {
      status: "UNKNOWN_AFTER_REASONABLE_ATTEMPT", reason: "Homeowner chose to skip the address screen" });
    expect(selectQuestionScreen(registry, facts, { effort_used: 6, eligible_question_ids: ["address:short_text"] }).stop_reason).toBe("no_eligible_question");
  });
  it("a held street and an explicit locality gap do not create an optional-only address loop", () => {
    const facts = state();
    facts.fields["property.street"] = additional("property.street", "101 Example St");
    facts.fields["property.city_state_zip"] = additional("property.city_state_zip", null, {
      status: "UNKNOWN_AFTER_REASONABLE_ATTEMPT", reason: "Homeowner could not provide locality" });
    expect(selectQuestionScreen(registry, facts, { effort_used: 9, eligible_question_ids: ["address:short_text"] }).questions).toEqual([]);
  });
  for (const c of PROBLEM_CASES) it(`full existing corpus no-repeat clause (d): ${c.id}`, () => {
    const data = setup(c.description);
    const playbook = selectPlaybook(c.description, data.problem.service_category);
    const reg = buildIntakeRegistry(playbook);
    const facts = buildCurrentFactState({ request_id, playbook, problem: data.problem, evidence: [data.evidence] });
    const selected = selectQuestionScreen(reg, facts, { effort_used: 5, stop_reason: c.hard_stop ? "existing_safety_halt" : null });
    for (const q of selected.questions) for (const field of q.fills_fields) expect(facts.fields[field]?.value == null).toBe(true);
    expect(selected.projected_effort).toBeLessThanOrEqual(20);
  });
});

describe("T1-35 ten dimensions, honest stop and handoff trace", () => {
  it("does not manufacture ready from a thin unfinished request", () => {
    const result = computeProviderReadiness(registry, state());
    expect(result.readiness_state).toBeNull(); expect(result.complete).toBe(false); expect(result.dimensions.map(d => d.dimension)).toEqual(["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"]);
    expect(result.unresolved_required).toContain("property.street");
  });
  it("early finish records each absent fact's actual reason and permits an honest packet", () => {
    const ended = finalizeFactState(registry, state(), "Homeowner chose finish with what we have");
    const ready = computeProviderReadiness(registry, ended, { stop_reason: "homeowner_finish" });
    expect(ready.readiness_state).toBe("ready_with_known_gaps"); expect(ready.complete).toBe(true); expect(ready.unresolved_required).toEqual([]);
    expect(ready.gaps.every(g => !!g.reason)).toBe(true); expect(ready.dimensions.every(d => d.satisfied)).toBe(true);
    expect(computeProviderReadiness(registry, ended, { safety_stopped: true }).readiness_state).toBe("stopped");
    expect(() => finalizeFactState(registry, state(), "")).toThrow();
  });
  it("requires actual gap reasons and matching map keys at schema boundary", () => {
    expect(CurrentFact.safeParse({ ...additional("brand", null), reason: null }).success).toBe(false);
    const facts = state(); facts.fields.wrong = additional("brand", "Carrier");
    expect(CurrentFactState.safeParse(facts).success).toBe(false);
  });
  it("accepts a real one-fact thin handoff without padding or invented certainty", () => {
    expect(ProblemRecordHandoff.safeParse(handoff()).success).toBe(true);
    expect(validateHandoffTrace(handoff(), registry)).toEqual([]);
  });
  it("rejects silent required gaps, orphan fields, wrong counters, duplicate ranks, missing Against and entry codes", () => {
    const missing = handoff(); delete missing.fact_state.fields.brand;
    expect(validateHandoffTrace(missing, registry).join(" ")).toContain("Required brand");
    const unshown = handoff(); unshown.unknowns = [];
    expect(validateHandoffTrace(unshown, registry).join(" ")).toContain("absent from the handoff unknowns");
    const incorrect = handoff(); incorrect.counts.photos = 9;
    expect(ProblemRecordHandoff.safeParse(incorrect).success).toBe(false);
    const duplicate = handoff(); duplicate.facts.push({ ...duplicate.facts[0] }); duplicate.counts.facts = 2;
    expect(ProblemRecordHandoff.safeParse(duplicate).success).toBe(false);
    const against = handoff(); against.hypotheses.push({ label: "Candidate", rank: 1, rank_word: "Possible", evidence_for: ["Reported symptom"], evidence_against: [] });
    expect(ProblemRecordHandoff.safeParse(against).success).toBe(false);
    const codes = handoff(); codes.access.push({ field: "gate_or_entry_code", value: "12345", asked: true });
    expect(ProblemRecordHandoff.safeParse(codes).success).toBe(false);
    expect(ProblemRecordHandoff.safeParse({ ...handoff(), invented_packet_slot: "value" }).success).toBe(false);
    const invented = handoff(); invented.equipment.brand = "Invented brand";
    expect(validateHandoffTrace(invented, registry).join(" ")).toContain("does not trace");
    expect(filterProviderQuestions(registry.provider_questions.map(q => q.display_text), registry, state("My AC is 8 years old."))).not.toContain("Roughly how old is the system, if you know?");
  });
});
