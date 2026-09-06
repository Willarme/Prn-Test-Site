import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signLink } from "@/platform/links/tokens";
import { ACTIVE_DISCLOSURE } from "@/domain/privacy/disclosures";
import { CANNOT_REACH_FIELD_VALUE, CANNOT_REACH_STEP_ANSWER } from "@/domain/intake/extract";
import type { WalkthroughView } from "@/domain/intake/playbook";
import { __setLabelReaderForTests } from "@/platform/intake/media";

/**
 * The answer route as the walkthrough uses it (campaign track P4):
 *   - a step answered "cannot_reach" is recorded with that marker and the
 *     walkthrough advances (checklist C8 / F5 — no dead end);
 *   - a field answered "__cannot_reach__" is recorded with that marker;
 *   - the address round-trips through saveJobAddress / getJobAddress;
 *   - a confirmed photo read is stored with source "confirmed";
 *   - every step answer comes back with the line saying what it changed (C6).
 */
let answerPost: (req: Request) => Promise<Response>;
let jsonPost: (req: Request) => Promise<Response>;
let runtimeStore: typeof import("@/platform/stores/runtime").runtimeStore;

beforeAll(async () => {
  const dir = await mkdtemp(join(tmpdir(), "prn-devdb-p4-"));
  process.env.PRN_DEV_DB_PATH = join(dir, "dev-db.json");
  ({ POST: answerPost } = await import("@/app/api/intake/answer/route"));
  ({ POST: jsonPost } = await import("@/app/api/intake/route"));
  ({ runtimeStore } = await import("@/platform/stores/runtime"));
});

afterAll(() => {
  delete process.env.PRN_DEV_DB_PATH;
});

async function startJourney(description: string): Promise<string> {
  const res = await jsonPost(
    new Request("http://localhost/api/intake", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        description,
        disclosure_content_hash: ACTIVE_DISCLOSURE.content_hash,
        attribution: {
          page_id: "page_ac_blowing_warm_air",
          intent_cluster_id: "ic_hvac_cooling_no_cold_air",
          search_opportunity_id: "so_ac_blowing_warm_air",
          problem_family_hint: "hvac-cooling",
          experiment_id: null,
          variant: null,
          referrer: null,
          landing_path: "/problems/ac-blowing-warm-air",
        },
      }),
    })
  );
  expect(res.status).toBe(200);
  const data = (await res.json()) as { request_id: string };
  expect(data.request_id).toMatch(/^rq_/);
  return data.request_id;
}

function answer(body: Record<string, unknown>): Promise<Response> {
  return answerPost(
    new Request("http://localhost/api/intake/answer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, k: signLink({ scope: "keep", request_id: String(body.request_id) }) }),
    })
  );
}

describe("POST /api/intake/answer — the escape hatch", () => {
  it("'cannot_reach' on the first step records the marker and advances to the next step", async () => {
    const request_id = await startJourney("My Carrier AC is 8 years old and blowing warm air since Tuesday");
    const res = await answer({ request_id, step: { step_id: "filter", answer: CANNOT_REACH_STEP_ANSWER } });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { ok: boolean; view: { step: { step_id: string } | null; outcome: unknown }; changed?: string };
    expect(data.ok).toBe(true);
    expect(data.view.step?.step_id).toBe("outdoor_unit");
    expect(data.changed).toBe("The filter goes in the packet as not checked. Next: the outdoor unit.");

    const saved = await runtimeStore().listDiagnosisAnswers(request_id);
    expect(saved.find((d) => d.step_id === "filter")?.answer).toBe(CANNOT_REACH_STEP_ANSWER);

    // The next step is now the active one: the walkthrough moved, it did not loop.
    const again = await answer({ request_id, step: { step_id: "filter", answer: "3" } });
    expect(again.status).toBe(409);
  });

  it("cannot_reach all the way down still reaches an outcome (F5: a packet is always reachable)", async () => {
    const request_id = await startJourney("My Carrier AC is 8 years old and blowing warm air since Tuesday");
    const path: string[] = [];
    let step: string | null = "filter";
    for (let i = 0; i < 10 && step; i += 1) {
      const res = await answer({ request_id, step: { step_id: step, answer: CANNOT_REACH_STEP_ANSWER } });
      expect(res.status).toBe(200);
      const data = (await res.json()) as { view: { step: { step_id: string } | null; outcome: { outcome_id: string } | null } };
      path.push(step);
      step = data.view.step?.step_id ?? null;
      if (data.view.outcome) {
        expect(data.view.outcome.outcome_id).toBe("needs_technician_cooling");
      }
    }
    expect(step).toBeNull();
    expect(path).toEqual(["filter", "outdoor_unit", "fan_moving", "fins_blocked"]);
  });

  it.each([CANNOT_REACH_STEP_ANSWER, "skipped photo"])("%s photo receipt follows the actual next check and retains unknown fins", async (skipAnswer) => {
    const request_id = await startJourney("My Carrier AC is blowing warm air. The filter is clean. The outdoor fan runs. I see no ice.");
    const before = await runtimeStore().listDiagnosisAnswers(request_id);
    expect(before).toEqual(expect.arrayContaining([
      expect.objectContaining({ step_id: "filter", answer: "reported_clean" }),
      expect.objectContaining({ step_id: "fan_moving", answer: "yes" }),
      expect.objectContaining({ step_id: "ice_check", answer: "no" }),
    ]));

    const res = await answer({ request_id, step: { step_id: "outdoor_unit", answer: skipAnswer } });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { view: WalkthroughView; changed: string };
    expect(data.changed).toBe("The outdoor photo check goes in the packet as not checked. Next: the fins.");
    expect(data.view.step?.step_id).toBe("fins_blocked");
    expect(data.view.step?.instruction).not.toContain("your side photo");
    expect(data.view.step?.instruction).toContain("If you can see them safely");
    const journey = await runtimeStore().getJourney(request_id);
    expect(journey).not.toBeNull();
    const evidence = await runtimeStore().listEvidence(journey!.problem.problem_id, request_id);
    expect(evidence.filter((item) => item.kind !== "customer_text")).toEqual([]);
    expect(await runtimeStore().listDiagnosisAnswers(request_id)).toEqual(expect.arrayContaining([
      expect.objectContaining({ step_id: "outdoor_unit", answer: skipAnswer, evidence_id: null }),
    ]));

    const skippedFins = await answer({ request_id, step: { step_id: "fins_blocked", answer: CANNOT_REACH_STEP_ANSWER } });
    expect(skippedFins.status).toBe(200);
    const completed = (await skippedFins.json()) as { view: WalkthroughView; changed: string };
    expect(completed.view.step).toBeNull();
    expect(completed.view.outcome?.outcome_id).toBe("needs_technician_cooling");
    expect(completed.changed).toBe("The fins go in the packet as not checked.");
    expect(JSON.stringify(completed.view.outcome)).not.toMatch(/clear fins|fins clear|ruled out|power look fine|Customer verified/i);
    expect(completed.view.outcome?.decision_frame.join(" ")).toContain("not checked");
    expect(await runtimeStore().listDiagnosisAnswers(request_id)).toEqual(expect.arrayContaining([
      expect.objectContaining({ step_id: "fins_blocked", answer: CANNOT_REACH_STEP_ANSWER }),
    ]));
  });

  it("skipping a disconnect photo never acknowledges an uploaded photo", async () => {
    const request_id = await startJourney("My AC is blowing warm air. The filter is clean. The outdoor fan isn't running.");
    const outdoor = await answer({ request_id, step: { step_id: "outdoor_unit", answer: CANNOT_REACH_STEP_ANSWER } });
    expect(outdoor.status).toBe(200);
    const first = (await outdoor.json()) as { view: WalkthroughView; changed: string };
    expect(first.view.step?.step_id).toBe("power_check");
    expect(first.changed).toBe("The outdoor photo check goes in the packet as not checked. Next: the disconnect box.");
    const res = await answer({ request_id, step: { step_id: "power_check", answer: CANNOT_REACH_STEP_ANSWER } });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { view: WalkthroughView; changed: string };
    expect(data.changed).toBe("The disconnect photo check goes in the packet as not checked.");
    expect(data.view.outcome?.outcome_id).toBe("fan_not_running");
    expect(data.view.outcome?.provider_note).not.toMatch(/disconnect photographed|fuses:|Customer has NOT opened/i);
    const frame = data.view.outcome!.decision_frame.join(" ");
    expect(frame).toContain("Keep electrical covers closed");
    expect(frame).toContain("Leave fuse, capacitor and wiring tests or replacement to a licensed technician");
    expect(frame).not.toMatch(/if you're comfortable|rent a multimeter|on a gamble|cheap fuses|quick swap/i);
  });

  it("a dirty filter answer does not record a replacement or repair result", async () => {
    const request_id = await startJourney("My AC is blowing warm air.");
    const res = await answer({ request_id, step: { step_id: "filter", answer: "9" } });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { view: WalkthroughView };
    expect(data.view.outcome?.outcome_id).toBe("dirty_filter");
    expect(data.view.outcome?.provider_note).toContain("Filter rated very dirty");
    expect(data.view.outcome?.provider_note).not.toMatch(/replaced on|symptoms \[resolved|\[date\]/i);
  });

  it("clogged fins with an unchecked fan do not claim a running fan or completed cleaning", async () => {
    const request_id = await startJourney("My AC is blowing warm air.");
    for (const step_id of ["filter", "outdoor_unit", "fan_moving"]) {
      expect((await answer({ request_id, step: { step_id, answer: CANNOT_REACH_STEP_ANSWER } })).status).toBe(200);
    }
    const res = await answer({ request_id, step: { step_id: "fins_blocked", answer: "Pretty clogged" } });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { view: WalkthroughView };
    expect(data.view.outcome?.outcome_id).toBe("clogged_condenser");
    expect(data.view.outcome?.provider_note).toContain("Condenser fins reported clogged");
    expect(data.view.outcome?.provider_note).not.toMatch(/outdoor fan runs|rinsed on|symptoms \[resolved|\[date\]/i);
    expect(data.view.outcome?.decision_frame.join(" ")).not.toMatch(/ruled out|costs nothing/i);
  });

  it("'__cannot_reach__' on a field records the marker P1 reads", async () => {
    const request_id = await startJourney("My Carrier AC is 8 years old and blowing warm air since Tuesday");
    const res = await answer({ request_id, fields: [{ field_key: "unit_model_serial", value: CANNOT_REACH_FIELD_VALUE }] });
    expect(res.status).toBe(200);
    const saved = await runtimeStore().listIntakeAnswers(request_id);
    const row = saved.filter((a) => a.field_key === "unit_model_serial").at(-1);
    expect(row?.value_text).toBe(CANNOT_REACH_FIELD_VALUE);
    expect(row?.source).toBe("typed");
  });
});

describe("POST /api/intake/answer — what each answer changed (C6)", () => {
  it("a clean filter records the reported observation and moves on", async () => {
    const request_id = await startJourney("My Carrier AC is 8 years old and blowing warm air since Tuesday");
    const res = await answer({ request_id, step: { step_id: "filter", answer: "2" } });
    const data = (await res.json()) as { changed?: string; view: { step: { step_id: string } | null } };
    expect(data.changed).toBe("You rated the filter as mostly clean. Next: the outdoor unit.");
    expect(data.view.step?.step_id).toBe("outdoor_unit");
  });
});

describe("POST /api/intake/answer — the address and the confirm", () => {
  it("the address round-trips to getJobAddress", async () => {
    const request_id = await startJourney("My Carrier AC is 8 years old and blowing warm air since Tuesday");
    expect(await runtimeStore().getJobAddress(request_id)).toBeNull();
    const res = await answer({
      request_id,
      address: { street: "1 Test Lane", city_state_zip: "Fort Wayne, IN 46802", property_type: "House", storeys: "2" },
    });
    expect(res.status).toBe(200);
    const saved = await runtimeStore().getJobAddress(request_id);
    expect(saved).toEqual({ street: "1 Test Lane", city_state_zip: "Fort Wayne, IN 46802", property_type: "House", storeys: "2" });
  });

  it("an address with a blank street is refused, and nothing else on the body is lost", async () => {
    const request_id = await startJourney("My Carrier AC is 8 years old and blowing warm air since Tuesday");
    const res = await answer({ request_id, address: { street: "", city_state_zip: "Fort Wayne, IN 46802" } });
    expect(res.status).toBe(400);
    expect(await runtimeStore().getJobAddress(request_id)).toBeNull();
  });

  it("a Yes on a photo read stores the value with source 'confirmed'", async () => {
    const request_id = await startJourney("My Carrier AC is 8 years old and blowing warm air since Tuesday");
    const { POST: mediaPost } = await import("@/app/api/intake/media/route");
    const form = new FormData();
    form.set("request_id", request_id); form.set("k", signLink({ scope: "keep", request_id }));
    form.set("target", "unit_model_serial");
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
    form.set("file", new File([png], "synthetic-label.png", { type: "image/png" }));
    __setLabelReaderForTests(async () => ({ ok: true, readable: true, fields: { model: "24ABC636A003" },
      confidence: { model: "low" }, run_id: "synthetic-p4-label" }));
    try {
      expect((await mediaPost(new Request("http://localhost/api/intake/media", { method: "POST", body: form }))).status).toBe(200);
    } finally { __setLabelReaderForTests(undefined); }
    const held = (await runtimeStore().listIntakeAnswers(request_id)).findLast(a => a.field_key === "unit_model_serial" && a.value_text);
    expect(held).toMatchObject({ value_text: "Model 24ABC636A003", source: "photo", evidence_id: expect.any(String) });
    const res = await answer({ request_id, fields: [{ field_key: "unit_model_serial", value: held!.value_text, confirmed: true }] });
    expect(res.status).toBe(200);
    const saved = await runtimeStore().listIntakeAnswers(request_id);
    const row = saved.filter((a) => a.field_key === "unit_model_serial").at(-1);
    expect(row?.value_text).toBe(held!.value_text);
    expect(row?.source).toBe("confirmed");
  });
});
