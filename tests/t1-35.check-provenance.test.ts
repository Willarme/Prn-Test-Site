import { describe, expect, it } from "vitest";
import {
  hvacCoolingBranches,
  hvacCoolingChecks,
  hvacCoolingFacts,
  type HvacCoolingView,
} from "@/domain/packet/knowledge-hvac-cooling";

function view(overrides: Partial<HvacCoolingView> = {}): HvacCoolingView {
  return {
    filter_rating: null, filter_age_weeks: null, filter_photo: false,
    outdoor_photo: false, fan_moving: null, fins: null, power_photo: false,
    ice: null, ice_photo: false, compressor_audible: null, vent_airflow: null,
    thermostat_setpoint_f: null, room_temp_f: null, thermostat_reading_provenance: null,
    safety_negative: null, onset_character: null, onset_weekday: null, onset_span_days: null,
    brand: null, equipment_type: null, model: null, age_years: null, air_handler_location: null,
    cannot_reach: new Set(), walkthrough_started: false,
    ...overrides,
  };
}

describe("diagnostic assessment provenance is not attachment presence", () => {
  it.each([2, 8])("keeps homeowner filter rating %i reported after a photo is attached", rating => {
    const before = view({ filter_rating: rating });
    const after = { ...before, filter_photo: true };
    expect(hvacCoolingFacts(after)).toEqual(hvacCoolingFacts(before));
    expect(hvacCoolingChecks(after)).toEqual(hvacCoolingChecks(before));
    expect(hvacCoolingFacts(after)[0].provenance).toBe("reported");
    expect(hvacCoolingChecks(after)[0].result_provenance).toBe("reported");
  });

  it.each(["mostly clear", "pretty clogged"] as const)("keeps the homeowner's %s fins assessment after an outdoor photo", fins => {
    const before = view({ fins });
    const after = { ...before, outdoor_photo: true };
    expect(hvacCoolingFacts(after)).toEqual(hvacCoolingFacts(before));
    expect(hvacCoolingChecks(after)).toEqual(hvacCoolingChecks(before));
    expect(hvacCoolingFacts(after)[0].provenance).toBe("confirmed_by_homeowner");
    expect(hvacCoolingChecks(after)[0].result_provenance).toBe("confirmed_by_homeowner");
  });

  it.each([
    { ice: "yes" as const, reported: false },
    { ice: "no" as const, reported: false },
    { ice: "yes" as const, reported: true },
    { ice: "no" as const, reported: true },
  ])("does not promote ice=$ice, reported=$reported when a photo exists", ({ ice, reported }) => {
    const before = view({ ice, ice_reported: reported });
    const after = { ...before, ice_photo: true };
    const provenance = reported ? "reported" : "confirmed_by_homeowner";
    expect(hvacCoolingFacts(after)).toEqual(hvacCoolingFacts(before));
    expect(hvacCoolingChecks(after)).toEqual(hvacCoolingChecks(before));
    expect(hvacCoolingFacts(after)[0].provenance).toBe(provenance);
    expect(hvacCoolingChecks(after)[0].result_provenance).toBe(provenance);
  });

  it("does not turn unassessed filter/outdoor/ice media into a completed assessment", () => {
    const unassessed = view({ filter_photo: true, outdoor_photo: true, ice_photo: true });
    expect(hvacCoolingFacts(unassessed)).toEqual([]);
    expect(hvacCoolingChecks(unassessed)).toEqual([]);
  });

  it("does not invent a photo assessment in the clogged-fins branch rationale", () => {
    // Two observed candidate supports make this a ranking case; the photo
    // still supplies no additional assessment or provenance.
    const before = view({ fins: "pretty clogged", fan_moving: "no" });
    const withoutPhoto = hvacCoolingBranches(before);
    const withPhoto = hvacCoolingBranches({ ...before, outdoor_photo: true });
    expect(withPhoto).toEqual(withoutPhoto);
    const branch = withoutPhoto.branches.find(candidate => candidate.name === "Blocked condenser coil");
    expect(branch).toBeDefined();
    expect(branch!.against).toContain("homeowner");
    expect(branch!.against).not.toContain("photo");
  });

  it.each(["reported", "seen_in_photo_or_video"] as const)("retains explicitly supplied thermostat reading provenance %s", provenance => {
    const reading = view({ thermostat_mode: "cool", thermostat_setpoint_f: 72, room_temp_f: 80,
      thermostat_reading_provenance: provenance });
    expect(hvacCoolingFacts(reading)[0].provenance).toBe(provenance);
    expect(hvacCoolingChecks(reading)[0].result_provenance).toBe(provenance);
    expect(hvacCoolingChecks(reading)[0].changed_provenance).toBe("inference");
  });

  it.each(["yes", "no"] as const)("retains an explicitly observed fan=%s source rather than downgrading it", fan => {
    const observed = view({ fan_moving: fan, fan_provenance: "seen_in_photo_or_video" });
    expect(hvacCoolingFacts(observed)[0].provenance).toBe("seen_in_photo_or_video");
    expect(hvacCoolingChecks(observed)[0].result_provenance).toBe("seen_in_photo_or_video");
    expect(hvacCoolingChecks(observed)[0].changed_provenance).toBe("inference");
  });

  it("retains photo provenance for the attachment fact itself", () => {
    const attachment = view({ power_photo: true });
    expect(hvacCoolingFacts(attachment)).toEqual([
      { text: "Outdoor disconnect photographed", provenance: "seen_in_photo_or_video", kind: "other", source_fields: ["check:power_check"] },
    ]);
    expect(hvacCoolingChecks(attachment)[0]).toMatchObject({
      name: "Disconnect photographed?", result: "Yes — exterior photographed", result_provenance: "seen_in_photo_or_video",
    });
  });
});
