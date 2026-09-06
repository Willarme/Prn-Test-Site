import { describe, expect, it } from "vitest";
import { decideUrgency, detectHazardFlags, safetyBodyFor, urgencyTag } from "@/domain/packet/urgency";

/**
 * Directions §6 — the urgency tag ladder, Melissa's ruling of 2026-09-04, and
 * the §6.7 worked-example table row by row. Plus §9.1's hard-stop flags.
 */
describe("P1 · urgency tag (Directions §6)", () => {
  it("§6.7 row 1: AC out, warm air, no hazard signals, safety questions asked", () => {
    const d = decideUrgency({
      homeowner_words: "The air conditioner is on and I can feel air but it's just not cold anymore.",
      safety_questions_asked: true,
      safety_questions_negative: true,
      habitability: "degraded",
    });
    expect(d.tag).toBe("As soon as possible · not a safety hazard");
    expect(d.hazard_halt).toBe(false);
  });

  it("§6.7 row 2: no heat, 18°F outside, infant in the house, no hazard signals", () => {
    const d = decideUrgency({
      homeowner_words: "No heat at all and it is 18°F outside, we have a newborn in the house.",
      safety_questions_asked: true,
      safety_questions_negative: true,
    });
    expect(d.tag).toBe("Today · not a safety hazard");
  });

  it("§6.7 row 3: gas smell reported is a hard stop", () => {
    const d = decideUrgency({ homeowner_words: "There is a gas smell by the furnace and the AC is warm." });
    expect(d.hazard_halt).toBe(true);
    expect(d.hazard_flags).toContain("gas_smell");
    expect(d.tag).toBe("Emergency · safety hazard");
    expect(safetyBodyFor(d.hazard_flags)).toBe("gas_or_co");
  });

  it("§6.7 row 4: water heater leaking slowly, homeowner says no hurry", () => {
    const d = decideUrgency({
      homeowner_words: "Water heater is leaking slowly into the floor drain, no hurry, but I want it looked at.",
      safety_questions_asked: true,
      safety_questions_negative: true,
    });
    expect(d.tag).toBe("Soon · not a safety hazard");
  });

  it("§6.7 row 5: a quote to replace a working 19-year-old furnace", () => {
    const d = decideUrgency({
      homeowner_words: "I want a quote to replace my working 19 year old furnace before winter.",
      safety_questions_asked: true,
      safety_questions_negative: true,
    });
    expect(d.tag).toBe("Planned work · not a safety hazard");
  });

  it("§6.7 row 6: garage door will not close, car trapped, safety questions never asked", () => {
    const d = decideUrgency({ homeowner_words: "My garage door won't close and my car is stuck inside." });
    expect(d.tag).toBe("As soon as possible · safety not established");
  });

  it("§6.7 row 7: breaker tripped once last week, reset fine, no smell since", () => {
    const d = decideUrgency({
      homeowner_words: "Breaker tripped once last week, reset fine, no smell since. AC not cooling.",
      safety_rule_id: "safety_fire",
      safety_rule_halts: false,
      safety_questions_asked: true,
      safety_questions_negative: false,
    });
    expect(d.tag).toBe("As soon as possible · possible safety hazard — verify");
    expect(d.hazard_halt).toBe(false);
  });

  it("defaults UP the ladder: an ambiguous record is asap, and the safety half defaults to not established", () => {
    const d = decideUrgency({ homeowner_words: "Something is off with the AC." });
    expect(d.urgency_level).toBe("asap");
    expect(d.safety_state).toBe("safety_not_established");
  });

  it("the homeowner's stated urgency is a floor, never a ceiling", () => {
    const d = decideUrgency({ homeowner_words: "AC is warm.", stated_urgency: "same_day" });
    expect(d.urgency_level).toBe("same_day");
    const e = decideUrgency({ homeowner_words: "AC is warm, no rush.", stated_urgency: "soon" });
    expect(e.urgency_level).toBe("soon");
  });

  it("the tag never carries a banned token (§6.5) and every ladder rung is Melissa's exact string", () => {
    for (const level of ["emergency", "same_day", "asap", "soon", "planned"] as const) {
      for (const safety of ["hazard", "possible_hazard", "no_hazard_reported", "safety_not_established"] as const) {
        const tag = urgencyTag(level, safety);
        expect(tag).toMatch(/^(Emergency|Today|As soon as possible|Soon|Planned work) · (safety hazard|possible safety hazard — verify|not a safety hazard|safety not established)$/);
        expect(tag).not.toMatch(/week|within|routine|can wait|no rush|business days/i);
      }
    }
  });

  it("§9.1: the repo's halting safety rules map to flags, and words alone can halt", () => {
    expect(detectHazardFlags("the ceiling is sagging over the kitchen")).toContain("structural");
    expect(detectHazardFlags("smoke coming from the outlet")).toContain("burning_or_smoke");
    expect(detectHazardFlags("the CO detector went off")).toContain("co_alarm");
    expect(detectHazardFlags("standing water around the electrical panel")).toContain("electrical_water");
    expect(detectHazardFlags("air is warm")).toEqual([]);
    const d = decideUrgency({ homeowner_words: "furnace acting up", safety_rule_id: "safety_gas", safety_rule_halts: true });
    expect(d.hazard_flags).toEqual(["gas_smell"]);
  });
});
