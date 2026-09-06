import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ACTIVE_DISCLOSURE } from "@/domain/privacy/disclosures";

/**
 * JOURNEY → DIRECTIONS INPUT (track P1): a real journey, created through the
 * real intake path on a temp file store, then answered and walked through
 * the way the walkthrough writes it, then mapped. Every mapping rule the
 * builder promises is pinned here: provenance from `source`, the label
 * confirmation, the cannot-reach markers, the knowledge-driven checks and
 * branches, and the thin case.
 */
type Runtime = typeof import("@/platform/stores/runtime");
type Complete = typeof import("@/platform/intake/complete");
type Builder = typeof import("@/domain/packet/directions-input");
type Render = typeof import("@/domain/packet/render");

let runtime: Runtime;
let complete: Complete;
let builder: Builder;
let render: Render;
let dir: string;
let intakePost: (req: Request) => Promise<Response>;

const NOW = "2026-09-05T15:30:00Z"; // 11:30 in Fort Wayne (EDT), a Saturday

beforeAll(async () => {
  // The synthetic answers below start at 15:01. Pin creation before them so
  // chronological assertions do not depend on when the test machine runs.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-05T15:00:00Z"));
  dir = mkdtempSync(join(tmpdir(), "prn-p1-input-"));
  process.env.PRN_DEV_DB_PATH = join(dir, "dev-db.json");
  process.env.PRN_RUNTIME_STORE = "file";
  runtime = await import("@/platform/stores/runtime");
  runtime.resetRuntimeStore();
  complete = await import("@/platform/intake/complete");
  builder = await import("@/domain/packet/directions-input");
  render = await import("@/domain/packet/render");
  ({ POST: intakePost } = await import("@/app/api/intake/route"));
});

afterAll(() => {
  vi.useRealTimers();
  delete process.env.PRN_DEV_DB_PATH;
  delete process.env.PRN_RUNTIME_STORE;
  rmSync(dir, { recursive: true, force: true });
});

async function createJourney(description: string): Promise<string> {
  const res = await intakePost(
    new Request("http://localhost/api/intake", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        description,
        disclosure_content_hash: ACTIVE_DISCLOSURE.content_hash,
        attribution: {
          page_id: "page_ac_blowing_warm_air",
          intent_cluster_id: "ic_hvac_cooling_no_cold_air",
          search_opportunity_id: null,
          problem_family_hint: "hvac",
          experiment_id: null,
          variant: null,
          referrer: null,
          landing_path: "/problems/ac-blowing-warm-air",
        },
      }),
    })
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as { request_id: string };
  return body.request_id;
}

async function build(requestId: string, address = true) {
  const store = runtime.runtimeStore();
  const ctx = await complete.loadJourneyContext(requestId);
  expect(ctx).not.toBeNull();
  const [answers, diagnosis, claims] = await Promise.all([
    store.listIntakeAnswers(requestId),
    store.listDiagnosisAnswers(requestId),
    store.listClaims(ctx!.journey.problem.problem_id),
  ]);
  return builder.buildDirectionsInput(
    {
      ...ctx!,
      address: address ? { street: "1114 Oakhurst Dr", city_state_zip: "Fort Wayne, IN 46815", property_type: "single-family", storeys: "2 storey" } : null,
      answers,
      diagnosis,
      claims,
      evidence: ctx!.allEvidence,
      label_reads: [],
    },
    {
      link_base: "http://localhost:3111",
      media_link: "http://localhost:3111/media/tok",
      home_memory_url: "http://localhost:3111/keep/tok-keep",
      trust_network_url: "http://localhost:3111/ask/tok-ask",
      now: NOW,
    }
  );
}

describe("P1 · buildDirectionsInput", () => {
  it("a rich AC journey: equipment provenance, checks, branches, script, counters — all from the record", async () => {
    const id = await createJourney("The air conditioner is on and I can feel air but it's just not cold anymore. Started slowly on Thursday.");
    const store = runtime.runtimeStore();
    const t = (n: number) => `2026-09-05T15:${String(n).padStart(2, "0")}:00Z`;
    // A label photo read by the model, then the homeowner confirming the model, then typed answers.
    await store.saveIntakeAnswers([
      { request_id: id, field_key: "brand", value_text: "Carrier", evidence_id: "ev_label", source: "photo", answered_at: t(1) },
      { request_id: id, field_key: "unit_model_serial", value_text: "Model 24ABC636A003, Serial 4021E19845", evidence_id: "ev_label", source: "photo", answered_at: t(1) },
      { request_id: id, field_key: "system_age", value_text: "About 8 years old (2018 on the label)", evidence_id: "ev_label", source: "photo", answered_at: t(1) },
      { request_id: id, field_key: "unit_model_serial", value_text: "Model 24ABC636A003, Serial 4021E19845", evidence_id: null, source: "typed", answered_at: t(2) },
      { request_id: id, field_key: "air_handler_location", value_text: "Basement, NE corner", evidence_id: null, source: "typed", answered_at: t(3) },
      { request_id: id, field_key: "sh_refrigerant", value_text: "Not sure", evidence_id: null, source: "typed", answered_at: t(3) },
      { request_id: id, field_key: "sh_impact", value_text: "No", evidence_id: null, source: "typed", answered_at: t(3) },
      { request_id: id, field_key: "access_pets", value_text: "One dog, crated during visits", evidence_id: null, source: "typed", answered_at: t(3) },
      { request_id: id, field_key: "access_contact", value_text: "Text preferred over phone, 260-555-0134", evidence_id: null, source: "typed", answered_at: t(3) },
      { request_id: id, field_key: "access_gate_code", value_text: "4471", evidence_id: null, source: "typed", answered_at: t(3) },
      { request_id: id, field_key: "safety_signals", value_text: "none", evidence_id: null, source: "typed", answered_at: t(3) },
    ]);
    // The walkthrough: filter clean, outdoor photo, fan yes, fins clear.
    await store.saveDiagnosisAnswer({ request_id: id, step_id: "filter", answer: "1", evidence_id: null, answered_at: t(4) });
    await store.saveDiagnosisAnswer({ request_id: id, step_id: "outdoor_unit", answer: null, evidence_id: "ev_outdoor", answered_at: t(5) });
    await store.saveDiagnosisAnswer({ request_id: id, step_id: "fan_moving", answer: "yes", evidence_id: null, answered_at: t(6) });
    await store.saveDiagnosisAnswer({ request_id: id, step_id: "fins_blocked", answer: "Mostly clear", evidence_id: null, answered_at: t(7) });

    const input = await build(id);
    expect(input.packet.trade).toBe("hvac");
    expect(input.packet.id).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}$/);
    expect(input.packet.version).toBe("v1");
    expect(input.problem.title).toBe("Cooling problem");
    expect(input.problem.onset_character).toBe("gradual");
    expect(input.problem.onset_weekday_spoken).toBe("Thursday");
    expect(input.problem.onset_span_days).toBe(2);
    expect(input.problem.urgency_level).toBe("asap");
    expect(input.problem.safety_state).toBe("no_hazard_reported");
    // Equipment provenance: photo → read_from_label, confirmed by the matching typed answer; age from the label year is an inference.
    expect(input.equipment.brand).toEqual({ value: "Carrier", provenance: "read_from_label" });
    expect(input.equipment.model).toEqual({ value: "24ABC636A003", provenance: "read_from_label", confirmed_by_homeowner: true });
    expect(input.equipment.serial).toEqual({ value: "4021E19845", provenance: "read_from_label", confirmed_by_homeowner: true });
    expect(input.equipment.age_years).toBe(8);
    expect(input.equipment.manufacture_year).toBe(2018);
    expect(input.equipment.age_provenance).toBe("inference");
    expect(input.equipment.air_handler_location).toEqual({ value: "Basement, NE corner", provenance: "reported" });
    expect(input.equipment.type).toBeNull();
    // Checks and what each changed, from the knowledge file — three checks done, three demotions.
    expect(input.provider.checks.map((c) => c.name)).toEqual(["Filter condition", "Outdoor unit running?", "Outdoor fins clogged?"]);
    expect(input.provider.checks[1].changed).toBe("Rules out total power loss to the condenser");
    expect(input.provider.checks[1].certainty_scope).toBe("power_level");
    // Branches: leak most consistent, capacitor possible, airflow less likely; every one has For and Against.
    expect(input.provider.branches.map((b) => [b.name, b.confidence])).toEqual([
      ["Low refrigerant charge / leak", "Most consistent"],
      ["Failing capacitor / compressor not staging", "Possible"],
      ["Airflow restriction downstream of the filter", "Less likely"],
    ]);
    for (const b of input.provider.branches) {
      expect(b.for.length).toBeGreaterThan(0);
      expect(b.against.length).toBeGreaterThan(0);
      expect(b.for.endsWith(".")).toBe(true);
    }
    // Unknowns: the four technician-only rows, plus what this journey did not obtain, each with a reason.
    expect(input.provider.unknowns.slice(0, 4).map((u) => u.reason)).toEqual(["requires gauges", "requires meter, not homeowner-safe", "requires panel removal", "requires instrument"]);
    expect(input.provider.unknowns.some((u) => u.item === "Thermostat setpoint and room temperature" && u.reason === "not asked")).toBe(true);
    expect(input.provider.unknowns.every((u) => u.reason.length > 0)).toBe(true);
    expect(input.provider.technician_only).toHaveLength(5);
    // Scope factors: age, leak second step, basement access, permits.
    expect(input.provider.scope_factors).toEqual([
      "Unit is ~8 years old — repair-vs-replace conversation may be in scope",
      "If a leak is confirmed, locating it may need a separate diagnostic step",
      "Basement, NE corner air handler — access is straightforward, no attic or roof work",
      "No permit or utility involvement indicated",
    ]);
    // Service history: Not sure stays Not sure; a direct No is confirmed.
    expect(input.provider.service_history).toEqual([
      { question_id: "sh_refrigerant", answer: "Not sure", provenance: "reported" },
      { question_id: "sh_impact", answer: "No", provenance: "confirmed_by_homeowner" },
    ]);
    // Access: the phone number is stripped, the gate code never travels.
    expect(input.access.contact_preference?.value).toBe("Text preferred over phone");
    expect(input.access.gate_or_entry_code?.value).toBe("__code_present__");
    expect(JSON.stringify(input)).not.toContain("4471");
    expect(JSON.stringify(input)).not.toContain("555-0134");
    // Script parts from the same view.
    expect(input.narrative.script_parts).toMatchObject({
      problem_clause: "The air conditioner is on and I can feel air but it's just not cold anymore",
      equipment_brand_type: "a Carrier",
      age_spoken: "about eight years old",
      model_number: "24ABC636A003",
      onset_clause: "started gradually on Thursday",
      outdoor_state_clause: "the outdoor fan's turning",
      filter_clause: "the filter's clean",
    });
    // Facts: the safety negative, the machine state, the maintenance state, the onset — and never an inference.
    expect(input.narrative.facts.map((f) => f.text)).toEqual([
      "Homeowner reports: “The air conditioner is on and I can feel air but it's just not cold anymore”",
      "Outdoor fan is turning",
      "Filter clean, rated 1/10 by the homeowner",
      "Outdoor fins mostly clear",
      "Onset gradual over ~2 days, not sudden",
      "No breaker trips, no burning smell, no water",
    ]);
    expect(input.narrative.facts.every((f) => f.provenance !== "inference")).toBe(true);
    // 6 facts + 2 history answers + 3 access answers (the withheld code is still a recorded fact) + 4 equipment values.
    expect(input.counts.facts_captured).toBe(6 + 2 + 3 + 4);
    // The timeline is chronological and carries the generated row only when rendered.
    // (The "Describes the problem" row is stamped with the journey's real creation
    // time, so its position among the fixed-time fixture rows is not asserted.)
    const rows = input.narrative.timeline.map((r) => r.text);
    expect(rows).toContain("Describes the problem in their own words.");
    expect(rows.filter((t) => !t.startsWith("Describes"))).toEqual([
      "Homeowner first notices the problem.",
      "Checks the filter, rates it 1/10.",
      "Looks at the outdoor unit: fan turning.",
      "Outdoor fins mostly clear.",
    ]);
    const ats = input.narrative.timeline.map((r) => r.at ?? "");
    expect([...ats].sort()).toEqual(ats);
    // And it renders clean.
    const out = render.renderPacketHtml(input);
    expect(out.self_check.ok, out.self_check.failures.join("\n")).toBe(true);
    expect(out.html).toContain("As soon as possible · not a safety hazard");
    expect(out.html).toContain('href="http://localhost:3111/keep/tok-keep"');
    expect(out.html).toContain("Provider link");
    expect(out.html).toContain(`It's a Carrier, about eight years old, model <span class="x-mono">24ABC636A003</span>. Started gradually on Thursday. The outdoor fan's turning, the filter's clean. I've got a Job Packet`);
  });

  it("the thin request (description only) produces the honest thin packet", async () => {
    const id = await createJourney("AC is blowing warm air, not cooling at all.");
    const input = await build(id);
    expect(input.equipment.brand).toBeNull();
    expect(input.equipment.model).toBeNull();
    expect(input.evidence.media).toEqual([]);
    expect(input.provider.checks).toEqual([]);
    expect(input.provider.branches).toEqual([]);
    expect(input.problem.safety_state).toBe("safety_not_established");
    expect(input.provider.unknowns.map((u) => u.item)).toContain("Model and serial");
    expect(input.provider.unknowns.find((u) => u.item === "Filter condition")?.reason).toBe("not asked");
    const out = render.renderPacketHtml(input);
    expect(out.self_check.ok, out.self_check.failures.join("\n")).toBe(true);
    const counters = [...out.html.matchAll(/<div class="n">(\d+)<\/div>/g)].map((m) => m[1]);
    expect(counters).toEqual(["1", "0", "0", "0", "5"]);
    expect(out.html).toContain("The facts worth reading first");
    expect(out.html).toContain("The evidence recorded so far does not point one way.");
    expect(out.html).toContain(`"Hi — AC is blowing warm air, not cooling at all. I've got a Job Packet I can send you before you come out."`);
  });

  it("the cannot-reach markers become unknowns with the homeowner's reason (checklist F5)", async () => {
    const id = await createJourney("AC running but the air is warm since yesterday.");
    const store = runtime.runtimeStore();
    await store.saveIntakeAnswers([
      { request_id: id, field_key: "unit_model_serial", value_text: "__cannot_reach__", evidence_id: null, source: "typed", answered_at: NOW },
    ]);
    await store.saveDiagnosisAnswer({ request_id: id, step_id: "filter", answer: "cannot_reach", evidence_id: null, answered_at: NOW });
    const input = await build(id);
    expect(input.equipment.model).toBeNull();
    expect(input.provider.unknowns.find((u) => u.item === "Model and serial")?.reason).toBe("homeowner could not reach the label");
    expect(input.provider.unknowns.find((u) => u.item === "Filter condition")?.reason).toBe("homeowner could not reach the filter");
    expect(input.problem.onset_span_days).toBe(1);
    expect(input.problem.onset_weekday_spoken).toBe("Friday");
    expect(JSON.stringify(input)).not.toContain("__cannot_reach__");
  });

  it("carries explicit compound thermostat readings and reported initial observations without invented confirmation", async () => {
    const id = await createJourney("My AC is blowing warm air. The outdoor fan is spinning and the filter is clean.");
    const store = runtime.runtimeStore();
    const ctx = await complete.loadJourneyContext(id);
    await store.saveIntakeAnswers([
      { request_id: id, field_key: "thermostat_photo", value_text: "Thermostat is set to cool at 72 and reads 80.", evidence_id: null, source: "typed", answered_at: NOW },
    ]);
    await store.saveDiagnosisAnswer({ request_id: id, step_id: "fan_moving", answer: "yes", evidence_id: ctx!.textEvidence.evidence_id, answered_at: NOW });
    await store.saveDiagnosisAnswer({ request_id: id, step_id: "filter", answer: "reported_clean", evidence_id: ctx!.textEvidence.evidence_id, answered_at: NOW });
    const input = await build(id);
    expect(input.evidence.readings).toMatchObject({
      thermostat_mode: { value: "cool", provenance: "reported" },
      thermostat_setpoint_f: { value: 72, provenance: "reported" },
      room_temp_f: { value: 80, provenance: "reported" },
    });
    expect(input.equipment.thermostat?.value).toBe("cool, set 72°F, room 80°F");
    expect(input.narrative.facts.find((f) => f.text === "Outdoor fan is turning")?.provenance).toBe("reported");
    expect(input.provider.checks.find((c) => c.name === "Outdoor unit running?")?.result_provenance).toBe("reported");
    expect(input.provider.checks.some((c) => c.name === "Filter condition")).toBe(false);
    expect(input.narrative.facts).toContainEqual(expect.objectContaining({ text: "Homeowner reports the filter is clean", provenance: "reported", kind: "maintenance", source_fields: ["check:filter"] }));
    expect(input.provider.unknowns.some((u) => /thermostat setpoint|filter condition/i.test(u.item))).toBe(false);
    expect(input.problem.safety_state).toBe("safety_not_established");
    const rendered = render.renderPacketHtml(input);
    expect(rendered.self_check.ok, rendered.self_check.failures.join("\n")).toBe(true);
    expect(rendered.html).toContain("The thermostat's set to 72 and the room's at 80");
  });

  it("does not invent cool mode or a control-setting exclusion when only temperatures are supplied", async () => {
    const id = await createJourney("AC running but blowing warm air.");
    await runtime.runtimeStore().saveIntakeAnswers([
      { request_id: id, field_key: "thermostat_photo", value_text: "Setpoint 72, room temperature 80", evidence_id: null, source: "typed", answered_at: NOW },
    ]);
    const input = await build(id);
    expect(input.evidence.readings?.thermostat_setpoint_f?.value).toBe(72);
    expect(input.evidence.readings?.room_temp_f?.value).toBe(80);
    expect(input.evidence.readings?.thermostat_mode).toBeUndefined();
    expect(input.provider.checks.some((c) => c.certainty_scope === "control_setting")).toBe(false);
  });

  it("projects obvious contact details, access codes and dollar amounts out of printable free text", async () => {
    const id = await createJourney("AC blowing warm air. Call 260-555-0134 or jane@example.com, gate code 4471. Last repair cost $450.");
    const input = await build(id);
    expect(input.problem.homeowner_words).not.toMatch(/555-0134|jane@example|4471|\$450/);
    expect(input.problem.homeowner_words).toContain("[amount omitted]");
    expect(render.renderPacketHtml(input).self_check.ok).toBe(true);
  });

  it("a previously saved record with a newly reported hazard halts the packet at render", async () => {
    // Fresh hazards are stopped by intake; the renderer also protects an
    // existing record when a hazard becomes known after its initial creation.
    const id = await createJourney("The AC is running but the air is warm.");
    const input = await build(id);
    input.problem.homeowner_words = "There is a burning smell from the vents and the AC is warm.";
    const out = render.renderPacketHtml(input);
    expect(out.halted).toBe(true);
    expect(out.html).not.toContain("Page 2 —");
  });

  it("a non-HVAC family gets honest empties, never HVAC content", async () => {
    const id = await createJourney("There is water dripping from the ceiling in the upstairs hallway.");
    const input = await build(id);
    expect(input.packet.trade).not.toBe("hvac");
    expect(input.provider.checks).toEqual([]);
    expect(input.provider.technician_only).toEqual([]);
    expect(input.provider.unknowns).toEqual([]);
    expect(input.provider.scope_factors).toEqual([]);
    expect(JSON.stringify(input)).not.toMatch(/refrigerant|capacitor/i);
    const out = render.renderPacketHtml(input);
    expect(out.self_check.ok, out.self_check.failures.join("\n")).toBe(true);
    expect(out.html).toContain("To be set on arrival.");
    expect(out.html).toContain("Nothing outstanding was identified at intake.");
  });

  it("a typed T1-35 address gap renders honestly; an untyped missing address still halts", async () => {
    const id = await createJourney("AC is blowing warm air, not cooling at all.");
    const input = await build(id, false);
    expect(input.property.street).toBe("");
    expect(input.property.unknown_reason).toBeTruthy();
    expect(render.renderPacketHtml(input).html).toContain("Job address still unknown");
    delete input.property.unknown_reason;
    expect(() => render.renderPacketHtml(input)).toThrow(render.PacketHaltError);
  });

  it("small parsers: model/serial, age, onset", () => {
    expect(builder.parseModelSerial("Model 24ABC636A003, Serial 4021E19845")).toEqual({ model: "24ABC636A003", serial: "4021E19845" });
    expect(builder.parseModelSerial("carrier 24abc636a003")).toEqual({ model: "24ABC636A003", serial: null });
    expect(builder.parseAge("about 8 years", 2026)).toEqual({ age_years: 8, manufacture_year: null });
    expect(builder.parseAge("installed 2018", 2026)).toEqual({ age_years: 8, manufacture_year: 2018 });
    expect(builder.parseOnsetCharacter("it just stopped all of a sudden")).toBe("sudden");
    expect(builder.parseOnsetCharacter("comes and goes")).toBe("intermittent");
    expect(builder.shortPacketId("rq_3f9a2c1b-1234-5678-9abc-def012345678")).toBe("3F9A-2C1B");
    expect(builder.stripContactDetails("Text me, 260-555-0134, or jane@example.com")).toBe("Text me");
  });
});
