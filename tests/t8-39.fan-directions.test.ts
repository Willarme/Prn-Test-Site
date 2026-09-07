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


describe("T8-39 explicit fan reading semantics", () => {
  it.each(["AUTO", "ON", "CIRCULATE"])("keeps an explicit %s setting separate from observed fan motion", async mode => {
    const input = await build([manual("thermostat_photo", `Thermostat mode COOL, setpoint 72 F, room temperature 81 F, fan ${mode}.`)]);
    expect(String(input.evidence.readings?.fan_mode?.value).toLowerCase()).toBe(mode.toLowerCase());
    expect(render.renderPacketHtml(input).html.toLowerCase()).toContain(`fan ${mode.toLowerCase()}`);
    expect(input.narrative.facts.some(f => /outdoor fan.*(?:running|moving)/i.test(f.text))).toBe(false);
  });
  it.each(["not fan AUTO", "maybe fan AUTO", "fan AUTO?", "fan AUTO or ON", "fan AUTO and fan ON", "fan AUTO. I am not sure.", "fan unknown", "fan not ON",
    "fan AUTO. Or ON.", "fan AUTO. Actually ON.", "fan AUTO. I cannot tell.", "fan AUTO. I do not think so.", "fan AUTO. I don't remember."])("does not promote the uncertain/negated display report %s", async fan => {
    const input = await build([manual("thermostat_photo", `Thermostat mode COOL; setpoint 72 F; room temperature 81 F; ${fan}`)]);
    expect(input.evidence.readings?.fan_mode).toBeUndefined();
    expect(input.evidence.readings?.thermostat_mode?.value).toBe("COOL");
  });
  it.each(["AUTO", "ON", "CIRCULATE"])("accepts an exact split %s value", async mode => {
    const input = await build([manual("fan_mode", mode)]);
    expect(String(input.evidence.readings?.fan_mode?.value).toLowerCase()).toBe(mode.toLowerCase());
  });
  it("preserves fan with decimal Celsius readings and deduplicated identical fan clauses", async () => {
    const input = await build([manual("thermostat_photo", "Mode COOL; setpoint 22.5 C; room temperature 27.5 C; fan AUTO. Fan AUTO.")]);
    expect(input.evidence.readings?.fan_mode?.value).toBe("auto");
    expect(input.evidence.readings?.thermostat_setpoint?.value).toBe("22.5 C");
  });
  it("respects a later compound correction in an explicitly stored split-field history", async () => {
    // Fixture-level stored history, not a claim that the public answer route
    // accepts standalone fan_mode: that route uses the authored display field.
    const corrected = await build([manual("fan_mode", "AUTO"), manual("thermostat_photo", "Mode COOL; fan ON")]);
    expect(corrected.evidence.readings?.fan_mode?.value).toBe("on");
    expect(corrected.evidence.reading_fields?.fan_mode).toBe("thermostat_photo");
    const uncertain = await build([manual("fan_mode", "AUTO"), manual("thermostat_photo", "Mode COOL; fan not ON")]);
    expect(uncertain.evidence.readings?.fan_mode).toBeUndefined();
  });
  it.each(["not AUTO", "unknown", "AUTO or ON", "maybe ON"])("does not report unsupported split fan value %s", async value => {
    const input = await build([manual("fan_mode", value)]);
    expect(input.evidence.readings?.fan_mode).toBeUndefined();
  });
});
