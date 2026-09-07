import { describe, expect, it } from "vitest";
import { hvacCoolingBranches, hvacCoolingChecks, hvacCoolingFacts, type HvacCoolingView } from "@/domain/packet/knowledge-hvac-cooling";

function view(overrides: Partial<HvacCoolingView> = {}): HvacCoolingView {
  return {
    filter_rating: null, filter_age_weeks: null, filter_photo: false,
    outdoor_photo: false, fan_moving: null, fins: null, power_photo: false,
    ice: null, ice_photo: false, compressor_audible: null, vent_airflow: null,
    thermostat_setpoint_f: null, room_temp_f: null, thermostat_reading_provenance: null,
    safety_negative: null, onset_character: null, onset_weekday: null, onset_span_days: null,
    brand: null, equipment_type: null, model: null, age_years: null, air_handler_location: null,
    cannot_reach: new Set(), walkthrough_started: false, ...overrides,
  };
}

describe("packet branch evidence matches the supplied filter assessment", () => {
  it.each([1, 2, 3, 4, 5])("preserves rating %i wording and homeowner source in both branch clauses", rating => {
    const input = view({ filter_rating: rating, fan_moving: "yes" });
    const fact = hvacCoolingFacts(input).find(f => f.source_fields?.includes("check:filter"))!;
    const exactAssessment = fact.text[0].toLowerCase() + fact.text.slice(1);
    const result = hvacCoolingBranches(input);
    const refrigerant = result.branches.find(b => b.name === "Low refrigerant charge / leak")!;
    const airflow = result.branches.find(b => b.name === "Airflow restriction downstream of the filter")!;
    expect(refrigerant.for).toContain(`${exactAssessment}.`);
    expect(refrigerant.for).toContain("outdoor fan turning");
    expect(refrigerant.for).not.toContain("running normally");
    expect(airflow.against).toBe(`${exactAssessment}.`);
    expect(fact.provenance).toBe("reported");
    expect(hvacCoolingBranches({ ...input, filter_photo: true })).toEqual(result);
  });

  it("reproduces the accepted thermostat plus filter5 fixture without relabeling dusty as clean", () => {
    const input = view({ filter_rating: 5, thermostat_mode: "cool", thermostat_setpoint_f: 72,
      room_temp_f: 79, thermostat_reading_provenance: "reported" });
    expect(hvacCoolingChecks(input).find(c => c.name === "Filter condition")?.result).toBe("Lightly dusty, rated 5/10");
    const result = hvacCoolingBranches(input);
    expect(result).toEqual({ branches: [], top: null });
  });

  it("retains the source limiter when another observation shares the Against clause", () => {
    const result = hvacCoolingBranches(view({ filter_rating: 5, vent_airflow: "normal", fan_moving: "yes" }));
    const airflow = result.branches.find(b => b.name === "Airflow restriction downstream of the filter")!;
    expect(airflow.against).toBe("filter lightly dusty, rated 5/10 by the homeowner and vent airflow reported normal.");
  });

  it("does not invent a rating from an unassessed filter photo", () => {
    expect(hvacCoolingBranches(view({ filter_photo: true }))).toEqual({ branches: [], top: null });
  });

  it.each([1, 5, 8])("does not rank a lone filter rating %i against an untested gap", rating => {
    expect(hvacCoolingBranches(view({ filter_rating: rating }))).toEqual({ branches: [], top: null });
  });

  it("retains comparisons when different candidates have recorded support", () => {
    const result = hvacCoolingBranches(view({ fan_moving: "no", power_photo: true }));
    expect(result.branches.length).toBeGreaterThanOrEqual(2);
    expect(result.branches[0].name).toBe("No power to the condenser / blown disconnect fuse");
    expect(result.branches[0].confidence).toBe("Most consistent");
  });
});
