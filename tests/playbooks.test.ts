import { describe, expect, it } from "vitest";
import { detectFields } from "@/domain/intake/extract";
import { IntakePlaybook, nextFor, validatePlaybookGraph } from "@/domain/intake/playbook";
import { PLAYBOOKS, selectPlaybook } from "@/domain/intake/playbooks";
import { HVAC_COOLING_PLAYBOOK } from "@/domain/intake/playbooks/hvac-cooling";
import { analyzeProblemFixture } from "@/domain/problem/fixture-engine";
import { assemblePacket, resolveDiagnosis } from "@/domain/problem/packet-assembly";

const NOW = "2026-08-19T12:00:00Z";

describe("generated-once intake playbooks", () => {
  it("every playbook validates against the contract", () => {
    for (const pb of PLAYBOOKS) {
      expect(IntakePlaybook.safeParse(pb).success, pb.playbook_id).toBe(true);
    }
  });

  it("no walkthrough can dead-end: every branch points at a real step or outcome", () => {
    for (const pb of PLAYBOOKS) {
      expect(validatePlaybookGraph(pb), pb.playbook_id).toEqual([]);
    }
  });

  it("every step input kind has a branch that can always fire", () => {
    for (const pb of PLAYBOOKS) {
      for (const step of pb.diagnostic_steps) {
        const kinds = step.input.kind;
        if (kinds === "yes_no") {
          expect(nextFor(step, "yes"), `${pb.playbook_id}/${step.step_id} yes`).not.toBeNull();
          expect(nextFor(step, "no"), `${pb.playbook_id}/${step.step_id} no`).not.toBeNull();
        }
        if (kinds === "rating") {
          for (const r of [0, 5, 6, 10]) {
            expect(nextFor(step, String(r)), `${pb.playbook_id}/${step.step_id} rating ${r}`).not.toBeNull();
          }
        }
        if (step.input.kind === "choice") {
          for (const o of step.input.options) {
            expect(nextFor(step, o), `${pb.playbook_id}/${step.step_id} "${o}"`).not.toBeNull();
          }
        }
        if (kinds === "photo" || kinds === "text") {
          expect(nextFor(step, "any"), `${pb.playbook_id}/${step.step_id} any`).not.toBeNull();
        }
      }
    }
  });

  it("never invents prices or guarantees (OD-13, #14A 5.2)", () => {
    for (const pb of PLAYBOOKS) {
      const text = JSON.stringify(pb);
      expect(text, pb.playbook_id).not.toMatch(/\$\s?\d/);
      expect(text, pb.playbook_id).not.toMatch(/guarantee/i);
    }
  });

  it("safety-relevant steps carry a safety note and never instruct dangerous actions", () => {
    for (const pb of PLAYBOOKS) {
      const text = JSON.stringify(pb).toLowerCase();
      // "never remove the inner cover" is the correct instruction; an
      // affirmative instruction to remove it must never appear.
      expect(text).not.toMatch(/(?<!never )(?<!not )(?<!don't )remove the (panel|inner)( panel)? cover/);
      // "do NOT touch wires" is the correct instruction; an affirmative
      // "touch the wires" must never appear.
      expect(text).not.toMatch(/(?<!not )(?<!never )touch(ing)? (the )?wires/);
      for (const step of pb.diagnostic_steps) {
        // Electrical-adjacent steps must carry an explicit safety line.
        if (/breaker|disconnect|fuse|electrical panel|outlet/.test(step.instruction.toLowerCase())) {
          expect(step.safety_note, `${pb.playbook_id}/${step.step_id} needs a safety note`).not.toBeNull();
        }
      }
    }
  });
});

describe("playbook routing", () => {
  it("routes the owner's AC example to the cooling playbook", () => {
    const pb = selectPlaybook("my ac is blowing warm air since yesterday", "hvac");
    expect(pb.playbook_id).toBe("pb_hvac_cooling_v1");
    expect(selectPlaybook("AC not cooling the house", "hvac").playbook_id).toBe("pb_hvac_cooling_v1");
  });

  it("routes a dead system to the no-power playbook", () => {
    expect(selectPlaybook("the furnace won't turn on at all", "hvac").playbook_id).toBe("pb_hvac_no_power_v1");
  });

  it.each(["My furnace won’t turn on since last night.", "My AC won’t start today."])(
    "routes typographic no-power input to the actual no-power walkthrough: %s", description => {
      expect(selectPlaybook(description, "hvac").playbook_id).toBe("pb_hvac_no_power_v1");
    }
  );

  it("routes leaks to plumbing and unknowns to the generic playbook", () => {
    expect(selectPlaybook("water dripping from the ceiling", "plumbing").playbook_id).toBe("pb_plumbing_leak_v1");
    expect(selectPlaybook("the thing in the garage is weird", null).playbook_id).toBe("pb_generic_home_problem_v1");
  });
});

describe("green checks from the customer's own words", () => {
  it("detects brand, age and timing without asking", () => {
    const found = detectFields(
      "Our Carrier AC is 8 years old and started blowing warm air since yesterday",
      HVAC_COOLING_PLAYBOOK.required_fields
    );
    const keys = found.map((f) => f.field_key);
    expect(keys).toContain("brand");
    expect(keys).toContain("system_age");
    expect(keys).toContain("symptom_timing");
    expect(found.find((f) => f.field_key === "brand")!.value_text.toLowerCase()).toBe("carrier");
    // Normalised to "8 years" since track P4 (the acknowledgement says "about 8 years old").
    expect(found.find((f) => f.field_key === "system_age")!.value_text).toMatch(/^8 years/);
    expect(found.find((f) => f.field_key === "symptom_timing")!.value_text).toMatch(/since yesterday/);
  });

  it("detects a model number when the customer gives one", () => {
    const found = detectFields(
      "Model number 24ACC636A003 outside unit, not cooling",
      HVAC_COOLING_PLAYBOOK.required_fields
    );
    expect(found.find((f) => f.field_key === "unit_model_serial")?.value_text).toBe("24ACC636A003");
  });

  it("detects nothing when nothing was said", () => {
    expect(detectFields("it is warm in here", HVAC_COOLING_PLAYBOOK.required_fields)).toEqual([]);
  });
});

describe("packet assembly from details + walkthrough", () => {
  const { problem, evidence } = analyzeProblemFixture({
    description: "Carrier AC blowing warm air since yesterday",
    intake_session_id: "is_1",
    problem_family_hint: null,
    now: NOW,
  });

  it("resolves the elimination trail to the right outcome", () => {
    const diag = resolveDiagnosis(HVAC_COOLING_PLAYBOOK, [
      { request_id: "rq", step_id: "filter", answer: "3", evidence_id: null, answered_at: NOW },
      { request_id: "rq", step_id: "outdoor_unit", answer: null, evidence_id: "ev_p", answered_at: NOW },
      { request_id: "rq", step_id: "fan_moving", answer: "no", evidence_id: null, answered_at: NOW },
      { request_id: "rq", step_id: "power_check", answer: null, evidence_id: "ev_p2", answered_at: NOW },
    ]);
    expect(diag?.outcome_title).toMatch(/fan isn't running/i);
    expect(diag?.steps_answered.length).toBe(4);
  });

  it("a very dirty filter short-circuits to the DIY outcome", () => {
    const diag = resolveDiagnosis(HVAC_COOLING_PLAYBOOK, [
      { request_id: "rq", step_id: "filter", answer: "9", evidence_id: null, answered_at: NOW },
    ]);
    expect(diag?.outcome_title).toMatch(/clogged filter/i);
  });

  it("folds details, media and findings into the packet and drops already-answered questions", () => {
    const packet = assemblePacket({
      problem,
      textEvidence: evidence,
      allEvidence: [
        evidence,
        { evidence_id: "ev_p", kind: "photo", content: "private-evidence/x.jpg", privacy: "private", captured_at: NOW },
      ],
      playbook: HVAC_COOLING_PLAYBOOK,
      answers: [
        { request_id: "rq", field_key: "brand", value_text: "Carrier", evidence_id: null, source: "auto_detected", answered_at: NOW },
        { request_id: "rq", field_key: "unit_model_serial", value_text: null, evidence_id: "ev_p", source: "photo", answered_at: NOW },
      ],
      diagnosis: [{ request_id: "rq", step_id: "filter", answer: "9", evidence_id: null, answered_at: NOW }],
      version: 2,
      now: NOW,
    });
    expect(packet.packet_version).toBe(2);
    expect(packet.media_count).toBe(1);
    expect(packet.collected_details.map((d) => d.label)).toContain("Brand");
    expect(packet.diagnosis?.outcome_title).toMatch(/clogged filter/i);
    expect(packet.questions_for_provider.join(" ")).not.toMatch(/how old is the system/i);
    expect(JSON.stringify(packet)).not.toMatch(/guarantee/i);
  });
});
