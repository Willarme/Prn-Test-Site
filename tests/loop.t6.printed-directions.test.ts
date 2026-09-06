import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { IntakeAnswer } from "@/domain/intake/playbook";
import { ACTIVE_DISCLOSURE } from "@/domain/privacy/disclosures";

type Answer = Pick<IntakeAnswer, "field_key" | "value_text" | "source" | "evidence_id">;
let dir: string;
let runtime: typeof import("@/platform/stores/runtime");
let complete: typeof import("@/platform/intake/complete");
let builder: typeof import("@/domain/packet/directions-input");
let render: typeof import("@/domain/packet/render");
let intakePost: (request: Request) => Promise<Response>;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "printed-directions-"));
  process.env.PRN_RUNTIME_STORE = "file";
  process.env.PRN_DEV_DB_PATH = join(dir, "db.json");
  runtime = await import("@/platform/stores/runtime");
  runtime.resetRuntimeStore();
  complete = await import("@/platform/intake/complete");
  builder = await import("@/domain/packet/directions-input");
  render = await import("@/domain/packet/render");
  ({ POST: intakePost } = await import("@/app/api/intake/route"));
});

afterAll(() => {
  delete process.env.PRN_RUNTIME_STORE;
  delete process.env.PRN_DEV_DB_PATH;
  rmSync(dir, { recursive: true, force: true });
});

const photo = (field_key: string, value_text: string | null, evidence_id = "ev_thermostat"): Answer =>
  ({ field_key, value_text, evidence_id, source: "photo" });
const manual = (field_key: string, value_text: string, source: "typed" | "confirmed" = "typed", evidence_id: string | null = null): Answer =>
  ({ field_key, value_text, evidence_id, source });

async function build(answers: Answer[]) {
  const response = await intakePost(new Request("http://localhost/api/intake", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ description: "The AC runs but the air is warm.", disclosure_content_hash: ACTIVE_DISCLOSURE.content_hash,
      attribution: { page_id: "page_ac_blowing_warm_air", intent_cluster_id: "ic_hvac_cooling_no_cold_air", search_opportunity_id: null,
        problem_family_hint: "hvac", experiment_id: null, variant: null, referrer: null, landing_path: "/problems/ac-blowing-warm-air" },
    }),
  }));
  expect(response.status).toBe(200);
  const { request_id } = await response.json() as { request_id: string };
  const stored = answers.map((answer, index) => ({ ...answer, request_id, answered_at: new Date(Date.UTC(2026, 8, 6, 15, index)).toISOString() }));
  await runtime.runtimeStore().saveIntakeAnswers(stored);
  const ctx = await complete.loadJourneyContext(request_id);
  if (!ctx) throw new Error("Synthetic intake did not create a context");
  const evidence = [...new Set(answers.flatMap(a => a.evidence_id ? [a.evidence_id] : []))].map(evidence_id => ({
    evidence_id, kind: "photo" as const, privacy: "private" as const,
    content: `private-evidence/${request_id}/thermostat_photo/${evidence_id}.png`, captured_at: "2026-09-06T15:00:00Z",
  }));
  return builder.buildDirectionsInput({ ...ctx, answers: await runtime.runtimeStore().listIntakeAnswers(request_id), diagnosis: [], claims: [],
    allEvidence: [ctx.textEvidence, ...evidence], evidence,
    address: { street: "100 Example Way", city_state_zip: "Fort Wayne, IN 46815", property_type: null, storeys: null },
  }, { link_base: "http://localhost:3111", media_link: "http://localhost:3111/media/test", now: "2026-09-06T16:00:00Z" });
}

describe("T6 printed readings in Directions and printable packet", () => {
  it("retains separate evidence-bound fields, printed dimensions and capacity without asserting a photo condition", async () => {
    const input = await build([
      photo("thermostat_mode", "cool"), photo("fan_mode", "auto"), photo("thermostat_setpoint", "72 F"), photo("room_temp", "80 F", "ev_room"),
      photo("filter_nominal_dimensions", "16 x 20 x 1 in", "ev_filter"),
      photo("printed_cooling_capacity", "Cooling capacity: 36,000 Btu/h", "ev_label"),
    ]);
    expect(input.evidence.readings).toMatchObject({
      thermostat_mode: { value: "cool", provenance: "inference", source_media: "ev_thermostat" },
      fan_mode: { value: "auto", provenance: "inference", source_media: "ev_thermostat" },
      thermostat_setpoint: { value: "72 F", unit: "F", provenance: "inference", source_media: "ev_thermostat" },
      room_temp: { value: "80 F", unit: "F", provenance: "inference", source_media: "ev_room" },
      filter_nominal_dimensions: { value: "16 x 20 x 1 in", provenance: "inference", source_media: "ev_filter" },
      printed_cooling_capacity: { value: "Cooling capacity: 36,000 Btu/h", provenance: "inference", source_media: "ev_label" },
    });
    expect(Object.values(input.evidence.readings ?? {}).every(reading => !reading.confirmed_by_homeowner)).toBe(true);
    expect(input.provider.checks.some(check => check.certainty_scope === "control_setting" || check.name === "Filter condition")).toBe(false);
    expect(input.evidence.readings?.filter_condition).toBeUndefined();
    expect(input.narrative.facts.some(fact => /filter.*clean|filter.*rated|capacity/i.test(fact.text))).toBe(false);
    const output = render.renderPacketHtml(input);
    expect(output.self_check.ok, output.self_check.failures.join("\n")).toBe(true);
    for (const value of ["set 72 F", "room 80 F", "fan auto", "16 x 20 x 1 in", "36,000 Btu/h", "unconfirmed photo reading"]) expect(output.html).toContain(value);
  });

  it("prints partial Celsius readings without inventing Fahrenheit, room temperature or a completed check", async () => {
    const input = await build([photo("thermostat_setpoint", "22 C"), photo("room_temp", null), photo("fan_mode", "auto")]);
    expect(input.evidence.readings?.thermostat_setpoint).toMatchObject({ value: "22 C", unit: "C", provenance: "inference", source_media: "ev_thermostat" });
    expect(input.evidence.readings?.thermostat_setpoint_f).toBeUndefined();
    expect(input.evidence.readings?.room_temp).toBeUndefined();
    expect(input.evidence.readings?.room_temp_f).toBeUndefined();
    expect(input.provider.checks).toEqual([]);
    const html = render.renderPacketHtml(input).html;
    expect(html).toContain("set 22 C (unconfirmed reading)");
    expect(html).not.toContain("22°F");
    expect(html).not.toContain("71.6");
  });

  it("keeps actual Celsius confirmation explicit without converting it or claiming the display was not supplied", async () => {
    const input = await build([
      manual("thermostat_setpoint", "22 C", "confirmed", "ev_thermostat"), manual("room_temp", "27 C", "confirmed", "ev_room"),
    ]);
    expect(input.evidence.readings?.room_temp).toMatchObject({ value: "27 C", unit: "C", source_media: "ev_room", provenance: "confirmed_by_homeowner", confirmed_by_homeowner: true });
    expect(input.evidence.readings?.room_temp_f).toBeUndefined();
    expect(input.equipment.thermostat).toMatchObject({ value: "set 22 C, room 27 C", confirmed_by_homeowner: true });
    const html = render.renderPacketHtml(input).html;
    expect(html).toContain("Celsius values are preserved as supplied");
    expect(html).not.toContain("27°F");
  });

  it("does not overwrite a homeowner correction with a later photo or alternate Fahrenheit key", async () => {
    const input = await build([
      photo("thermostat_setpoint", "72 F"), manual("thermostat_setpoint", "23 C"), photo("thermostat_setpoint_f", "70"),
      photo("filter_nominal_dimensions", "16 x 20 x 1 in", "ev_filter"), manual("filter_nominal_dimensions", "20 x 20 x 1 in"),
      photo("filter_nominal_dimensions", "16 x 20 x 1 in", "ev_filter_later"),
    ]);
    expect(input.evidence.readings?.thermostat_setpoint).toEqual({ value: "23 C", unit: "C", provenance: "reported", source_media: null });
    expect(input.evidence.readings?.thermostat_setpoint_f).toBeUndefined();
    expect(input.evidence.readings?.filter_nominal_dimensions).toEqual({ value: "20 x 20 x 1 in", provenance: "reported", source_media: null });
    const html = render.renderPacketHtml(input).html;
    expect(html).toContain("20 x 20 x 1 in");
    expect(html).not.toContain("16 x 20 x 1 in");
  });

  it("never interprets a matching typed value as confirmation and preserves per-field provenance in mixed evidence", async () => {
    const input = await build([
      photo("thermostat_mode", "cool"), manual("thermostat_mode", "cool"),
      photo("thermostat_setpoint", "72 F"), manual("thermostat_setpoint", "72 F", "confirmed", "ev_thermostat"),
      photo("room_temp", "80 F", "ev_room"),
    ]);
    expect(input.evidence.readings?.thermostat_mode).toEqual({ value: "cool", provenance: "reported", source_media: null });
    expect(input.evidence.readings?.thermostat_setpoint).toMatchObject({ provenance: "confirmed_by_homeowner", confirmed_by_homeowner: true, source_media: "ev_thermostat" });
    expect(input.evidence.readings?.room_temp).toMatchObject({ provenance: "inference", source_media: "ev_room" });
    expect(input.evidence.readings?.room_temp?.confirmed_by_homeowner).toBeUndefined();
    expect(input.equipment.thermostat?.confirmed_by_homeowner).toBeUndefined();
    expect(input.provider.checks.some(check => check.certainty_scope === "control_setting")).toBe(false);
  });

  it("preserves explicit units in historical compound display text and does not fill missing units from the HVAC cluster", async () => {
    const compound = await build([photo("thermostat_photo", "Mode: cool; Setpoint: 22 C; Room: 27 C")]);
    expect(compound.evidence.readings?.thermostat_setpoint).toMatchObject({ value: "22 C", unit: "C", provenance: "inference" });
    expect(compound.evidence.readings?.room_temp_f).toBeUndefined();
    const unitless = await build([photo("thermostat_setpoint", "72"), photo("room_temp", "80")]);
    expect(unitless.evidence.readings?.thermostat_setpoint).toEqual({ value: "72", provenance: "inference", source_media: "ev_thermostat" });
    expect(unitless.evidence.readings?.thermostat_setpoint_f).toBeUndefined();
    expect(unitless.provider.checks).toEqual([]);
  });

  it("retains successful partial reads across unreadable retries and accepts a later manual correction to a confirmed value", async () => {
    const input = await build([
      photo("room_temp", "80 F"), photo("room_temp", null),
      manual("filter_nominal_dimensions", "16 x 20 x 1 in", "confirmed", "ev_filter"), manual("filter_nominal_dimensions", "20 x 25 x 1 in"),
    ]);
    expect(input.evidence.readings?.room_temp).toMatchObject({ value: "80 F", provenance: "inference", source_media: "ev_thermostat" });
    expect(input.evidence.readings?.filter_nominal_dimensions).toEqual({ value: "20 x 25 x 1 in", provenance: "reported", source_media: null });
    expect(render.renderPacketHtml(input).html).toContain("20 x 25 x 1 in");
  });

  it("respects the authored compound manual correction when another reader pass supplies split fields", async () => {
    const input = await build([
      photo("thermostat_photo", "Mode: cool; Setpoint: 72 F; Room: 80 F"),
      manual("thermostat_photo", "Mode: heat; Setpoint: 23 C; Room: 21 C"),
      photo("thermostat_setpoint", "72 F"), photo("room_temp", "80 F"), photo("thermostat_mode", "cool"),
      photo("thermostat_photo", "Mode: cool; Setpoint: 72 F; Room: 80 F"),
    ]);
    expect(input.evidence.readings?.thermostat_setpoint).toMatchObject({ value: "23 C", unit: "C", provenance: "reported", source_media: null });
    expect(input.evidence.readings?.room_temp).toMatchObject({ value: "21 C", unit: "C", provenance: "reported", source_media: null });
    expect(input.evidence.readings?.thermostat_mode).toMatchObject({ value: "heat", provenance: "reported" });
    expect(input.evidence.readings?.thermostat_setpoint_f).toBeUndefined();
    expect(render.renderPacketHtml(input).html).toContain("heat, set 23 C, room 21 C");
  });

  it("does not bypass trusted component confirmation or undo a manual correction when the summary is confirmed", async () => {
    const summary = "Mode: cool; Setpoint: 72 F; Room: 80 F";
    const input = await build([
      photo("thermostat_photo", summary), photo("thermostat_setpoint", "72 F"), manual("thermostat_setpoint", "23 C"),
      manual("thermostat_photo", summary, "confirmed", "ev_confirmation_text"),
      manual("room_temp", "80 F", "confirmed", "ev_thermostat"),
    ]);
    expect(input.evidence.readings?.thermostat_setpoint).toMatchObject({ value: "23 C", provenance: "reported", source_media: null });
    expect(input.evidence.readings?.room_temp).toMatchObject({ value: "80 F", provenance: "confirmed_by_homeowner", confirmed_by_homeowner: true, source_media: "ev_thermostat" });
    // Mode was deliberately not expanded by the trusted confirmation path.
    expect(input.evidence.readings?.thermostat_mode).toEqual({ value: "cool", provenance: "inference", source_media: "ev_thermostat" });
    expect(input.equipment.thermostat?.confirmed_by_homeowner).toBeUndefined();
    expect(input.provider.checks.some(check => check.certainty_scope === "control_setting")).toBe(false);
  });
});
