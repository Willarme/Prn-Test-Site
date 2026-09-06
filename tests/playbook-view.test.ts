import { describe, expect, it } from "vitest";
import { advanceWalkthrough, projectWalkthroughView } from "@/domain/intake/playbook";
import { HVAC_COOLING_PLAYBOOK } from "@/domain/intake/playbooks/hvac-cooling";
import { PLAYBOOKS } from "@/domain/intake/playbooks";

/**
 * Direct, fast, no-server unit coverage of the T1-15 view-model boundary
 * itself (`projectWalkthroughView` / `advanceWalkthrough`, playbook.ts).
 * These are the two functions every server call site (page.tsx, the answer
 * route, the media route, the walkthrough-reset route) routes through, so
 * proving them correct in isolation is proving the whole boundary correct —
 * complementary to, not a replacement for, the real-HTTP tests in
 * playbook-exposure.test.ts and playbook-walkthrough-e2e.test.ts.
 *
 * This file also covers the ONE thing playbook-walkthrough-e2e.test.ts
 * cannot exercise through a real HTTP round trip on this machine: the media
 * route's photo-branch resolution (`advanceWalkthrough(pb, stepId, "any")`)
 * — blocked there by the pre-existing Windows path bug in
 * media-storage.ts (flagged separately), which is in the storage write,
 * not in this resolution logic.
 */

const GENERIC = PLAYBOOKS.find((p) => p.problem_family === "general_home_problem")!;

describe("projectWalkthroughView", () => {
  it("projects the current step's own content — never branches, never other steps", () => {
    const view = projectWalkthroughView(HVAC_COOLING_PLAYBOOK, "filter", null);
    expect(view.outcome).toBeNull();
    expect(view.step).not.toBeNull();
    expect(view.step!.step_id).toBe("filter");
    expect(view.step!.step_number).toBe(1);
    expect(view.step!.total_steps).toBe(5);
    expect(view.step!.instruction).toContain("Find the panel that opens on your indoor unit");
    expect(view.step!.input).toEqual({ kind: "rating", min_label: "0 — pristine white", max_label: "10 — you could grow a plant on it" });
    // The projection must never carry a graph edge.
    expect(view.step).not.toHaveProperty("branches");
    expect(view.step).not.toHaveProperty("satisfies_fields");
    // Nor any other step's text.
    const json = JSON.stringify(view);
    expect(json).not.toContain("Snap a photo of it with the cover open"); // power_check
    expect(json).not.toContain("starves the system of air"); // dirty_filter outcome
  });

  it("projects a choice step's own options as part of its input", () => {
    const view = projectWalkthroughView(HVAC_COOLING_PLAYBOOK, "fins_blocked", null);
    expect(view.step!.input).toEqual({ kind: "choice", options: ["Mostly clear", "Pretty clogged"] });
  });

  it("projects the reached outcome's own content — never the step graph, never a different outcome", () => {
    const view = projectWalkthroughView(HVAC_COOLING_PLAYBOOK, null, "dirty_filter");
    expect(view.step).toBeNull();
    expect(view.outcome).not.toBeNull();
    expect(view.outcome!.outcome_id).toBe("dirty_filter");
    expect(view.outcome!.likely_cause).toContain("starves the system of air");
    const json = JSON.stringify(view);
    expect(json).not.toContain("dumping heat outside"); // clogged_condenser — a different outcome
    expect(json).not.toContain('"branches"');
  });

  it("outcome id wins over a stale current-step id (an outcome always means the walkthrough is over)", () => {
    const view = projectWalkthroughView(HVAC_COOLING_PLAYBOOK, "filter", "dirty_filter");
    expect(view.step).toBeNull();
    expect(view.outcome!.outcome_id).toBe("dirty_filter");
  });

  it("a playbook with no walkthrough (GENERIC) projects to nothing, without throwing", () => {
    expect(GENERIC.first_step_id).toBeNull();
    expect(() => projectWalkthroughView(GENERIC, GENERIC.first_step_id, null)).not.toThrow();
    expect(projectWalkthroughView(GENERIC, GENERIC.first_step_id, null)).toEqual({ step: null, outcome: null });
  });

  it("an unknown step id projects to nothing rather than throwing", () => {
    expect(projectWalkthroughView(HVAC_COOLING_PLAYBOOK, "not_a_real_step", null)).toEqual({ step: null, outcome: null });
  });
});

describe("advanceWalkthrough — the resolver every round-trip (typed answer, choice, rating, and photo/skip) shares", () => {
  it("a rating answer at or above the threshold reaches the matching outcome", () => {
    const view = advanceWalkthrough(HVAC_COOLING_PLAYBOOK, "filter", "8");
    expect(view!.step).toBeNull();
    expect(view!.outcome!.outcome_id).toBe("dirty_filter");
  });

  it("a rating answer below the threshold advances to the next step", () => {
    const view = advanceWalkthrough(HVAC_COOLING_PLAYBOOK, "filter", "2");
    expect(view!.outcome).toBeNull();
    expect(view!.step!.step_id).toBe("outdoor_unit");
  });

  it("a photo step resolves its 'any' branch exactly like a real upload or a skip — this is what the media route calls", () => {
    const view = advanceWalkthrough(HVAC_COOLING_PLAYBOOK, "outdoor_unit", "any");
    expect(view!.step!.step_id).toBe("fan_moving");
  });

  it("a choice answer takes the matching named branch", () => {
    const view = advanceWalkthrough(HVAC_COOLING_PLAYBOOK, "fins_blocked", "Pretty clogged");
    expect(view!.outcome!.outcome_id).toBe("clogged_condenser");
  });

  it("an unknown step id returns null (the caller 400s) rather than a fabricated view", () => {
    expect(advanceWalkthrough(HVAC_COOLING_PLAYBOOK, "not_a_real_step", "yes")).toBeNull();
  });
});
