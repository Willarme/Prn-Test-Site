import { describe, expect, it } from "vitest";
import { DoorAttribution, IntakeSession, ROUTES } from "@/domain/intake/contracts";

describe("routes (frozen Door Wave 0 contracts)", () => {
  it("keeps the stable /start route", () => {
    expect(ROUTES.start).toBe("/start");
  });

  it("keeps the stable results route shape", () => {
    expect(ROUTES.resultsPattern).toBe("/results/[request_id]");
    expect(ROUTES.results("req_123")).toBe("/results/req_123");
  });
});

describe("DoorAttribution", () => {
  it("requires only landing_path — every door field is optional prior context", () => {
    expect(
      DoorAttribution.safeParse({
        page_id: null,
        intent_cluster_id: null,
        search_opportunity_id: null,
        problem_family_hint: null,
        experiment_id: null,
        variant: null,
        referrer: null,
        landing_path: "/start",
      }).success
    ).toBe(true);
  });

  it("rejects a missing landing_path", () => {
    const r = DoorAttribution.safeParse({
      page_id: "page_x",
      intent_cluster_id: null,
      search_opportunity_id: null,
      problem_family_hint: null,
      experiment_id: null,
      variant: null,
      referrer: null,
      landing_path: "",
    });
    expect(r.success).toBe(false);
  });
});

describe("IntakeSession (D-2: additive attribution record)", () => {
  it("accepts a guest arriving through a door", () => {
    const r = IntakeSession.safeParse({
      intake_session_id: "is_1",
      schema_version: "1.0.0",
      guest_session_id: "gs_1",
      request_id: null,
      attribution: {
        page_id: "page_ac_not_turning_on",
        intent_cluster_id: "ic_hvac_no_power",
        search_opportunity_id: "so_ac_not_turning_on",
        problem_family_hint: "hvac",
        experiment_id: null,
        variant: null,
        referrer: "https://www.google.com/",
        landing_path: "/problems/ac-not-turning-on",
      },
      consent_event_ids: [],
      entered_at: "2026-08-14T12:00:00Z",
      intake_started_at: null,
    });
    expect(r.success).toBe(true);
  });

  it("accepts a direct /start arrival with no door at all", () => {
    const r = IntakeSession.safeParse({
      intake_session_id: "is_2",
      schema_version: "1.0.0",
      guest_session_id: null,
      request_id: null,
      attribution: {
        page_id: null,
        intent_cluster_id: null,
        search_opportunity_id: null,
        problem_family_hint: null,
        experiment_id: null,
        variant: null,
        referrer: null,
        landing_path: "/start",
      },
      consent_event_ids: [],
      entered_at: "2026-08-14T12:00:00Z",
      intake_started_at: null,
    });
    expect(r.success).toBe(true);
  });
});
