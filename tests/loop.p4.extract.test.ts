import { describe, expect, it } from "vitest";
import {
  CANNOT_REACH_FIELD_VALUE,
  acknowledgementLine,
  detectFields,
  trialScope,
} from "@/domain/intake/extract";
import { HVAC_COOLING_PLAYBOOK, changedLineFor } from "@/domain/intake/playbooks/hvac-cooling";
import { PLAYBOOKS, selectPlaybook } from "@/domain/intake/playbooks";
import { nextFor, validatePlaybookGraph } from "@/domain/intake/playbook";

/**
 * Checklist C1 / F3 (never ask twice) at the extraction layer, C2 (the
 * acknowledgement in fact form), C6 (what each answer changed), C8 / F5 (the
 * escape hatch never dead-ends) and F6 (the wrong classification routes out).
 */
const C1 = "My Carrier AC is 8 years old and blowing warm air since Tuesday";
const FIELDS = HVAC_COOLING_PLAYBOOK.required_fields;

describe("extract.ts — the C1 sentence yields its three facts", () => {
  it("brand=Carrier, system_age=8 years, symptom_timing=since Tuesday", () => {
    const got = Object.fromEntries(detectFields(C1, FIELDS).map((d) => [d.field_key, d.value_text]));
    expect(got.brand).toBe("Carrier");
    expect(got.system_age).toBe("8 years");
    expect(got.symptom_timing).toBe("since Tuesday");
  });

  it("brand spelling is canonical whatever the homeowner typed", () => {
    const got = detectFields("our TRANE unit is about twelve years old, started yesterday", FIELDS);
    const map = Object.fromEntries(got.map((d) => [d.field_key, d.value_text]));
    expect(map.brand).toBe("Trane");
    expect(map.system_age).toBe("12 years");
    expect(map.symptom_timing).toBe("started yesterday");
  });

  it("dates and relative days count as onset; a plain weekday with no verb does not", () => {
    expect(detectFields("stopped cooling since June 3", FIELDS).find((d) => d.field_key === "symptom_timing")?.value_text).toBe("since June 3");
    expect(detectFields("began last Friday", FIELDS).find((d) => d.field_key === "symptom_timing")?.value_text).toBe("began Friday");
    expect(detectFields("Tuesday is my day off", FIELDS).find((d) => d.field_key === "symptom_timing")).toBeUndefined();
  });

  it("the playbook's own patterns still run for everything else (a model number)", () => {
    const got = detectFields("Model number 24ABC636A003, blowing warm", FIELDS);
    expect(got.find((d) => d.field_key === "unit_model_serial")?.value_text).toBe("24ABC636A003");
  });
});

describe("the acknowledgement line — fact form, the approved shape", () => {
  it("renders the three facts as 'Got it — Carrier, about 8 years old, started Tuesday.'", () => {
    const facts = detectFields(C1, FIELDS);
    expect(acknowledgementLine(facts)).toBe("Got it — Carrier, about 8 years old, started Tuesday.");
  });

  it("is null with nothing held (no praise without a count, WORDING 23/50)", () => {
    expect(acknowledgementLine([])).toBeNull();
    expect(acknowledgementLine([{ field_key: "brand", value_text: CANNOT_REACH_FIELD_VALUE }])).toBeNull();
  });

  it("never praises and never states the negative", () => {
    const line = acknowledgementLine(detectFields(C1, FIELDS))!;
    expect(line).not.toMatch(/great|good job|thanks|helpful/i);
    expect(line).not.toMatch(/don't|do not|won't|never|no need/i);
  });
});

describe("the escape hatch — every HVAC cooling step has a way out", () => {
  it("the graph stays valid with the cannot_reach branches", () => {
    expect(validatePlaybookGraph(HVAC_COOLING_PLAYBOOK)).toEqual([]);
  });

  it("cannot_reach resolves to a branch on every step (never a dead end)", () => {
    for (const step of HVAC_COOLING_PLAYBOOK.diagnostic_steps) {
      const branch = nextFor(step, "cannot_reach");
      expect(branch, `step ${step.step_id} has no way out`).not.toBeNull();
      expect(branch!.next_step_id !== null || branch!.outcome_id !== null).toBe(true);
    }
  });

  it("every branch has a 'changed' line and none of them praise", () => {
    for (const step of HVAC_COOLING_PLAYBOOK.diagnostic_steps) {
      for (const b of step.branches) {
        const line = changedLineFor(HVAC_COOLING_PLAYBOOK.playbook_id, step.step_id, b.when);
        expect(line, `${step.step_id}/${b.when}`).toBeTruthy();
        expect(line).not.toMatch(/great|good job|well done|nice/i);
        expect(line).not.toMatch(/\bwill\b/);
      }
    }
    expect(changedLineFor("pb_other", "filter", "any")).toBeNull();
  });
});

describe("trialScope — one trade, one county", () => {
  it("the C1 sentence is in scope (hvac from her own words)", () => {
    const pb = selectPlaybook(C1, "hvac");
    expect(trialScope({ service_category: "hvac", service_category_confidence: "medium", problem_summary: C1 }, pb).in_scope).toBe(true);
  });

  it("a thin AC sentence classified only by the door hint stays in scope", () => {
    const text = "my ac isn't working";
    const pb = selectPlaybook(text, "hvac-cooling");
    expect(trialScope({ service_category: "hvac-cooling", service_category_confidence: "low", problem_summary: text }, pb).in_scope).toBe(true);
  });

  it("the door's own test sentence (no 'ac' token, cooling words only) stays in scope", () => {
    const text = "The air is coming out but it isn't cold. Started yesterday afternoon.";
    const pb = selectPlaybook(text, "hvac-cooling");
    expect(trialScope({ service_category: "hvac-cooling", service_category_confidence: "low", problem_summary: text }, pb).in_scope).toBe(true);
  });

  it("a garage door typed into the AC door routes out, with a search term", () => {
    const text = "my garage door won't close and my car is stuck inside";
    const pb = selectPlaybook(text, "hvac-cooling");
    expect(pb.problem_family).toBe("general_home_problem");
    const scope = trialScope({ service_category: "hvac-cooling", service_category_confidence: "low", problem_summary: text }, pb);
    expect(scope.in_scope).toBe(false);
    expect(scope.search_term).toBe("garage door repair near me");
  });

  it("a ceiling leak is another trade and routes out toward a plumber", () => {
    const text = "there's water coming through my ceiling in the upstairs hallway";
    const pb = selectPlaybook(text, "plumbing");
    const scope = trialScope({ service_category: "plumbing", service_category_confidence: "medium", problem_summary: text }, pb);
    expect(scope.in_scope).toBe(false);
    expect(scope.search_term).toBe("plumber near me");
  });

  it("no classification at all routes out without inventing a term", () => {
    const text = "something is wrong somewhere";
    const scope = trialScope({ service_category: null, service_category_confidence: "low", problem_summary: text }, PLAYBOOKS[PLAYBOOKS.length - 1]);
    expect(scope.in_scope).toBe(false);
    expect(scope.search_term).toBeNull();
  });
});
