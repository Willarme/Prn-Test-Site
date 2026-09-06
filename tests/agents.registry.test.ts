import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AgentDefinition, PhaseBand } from "@/platform/agents/contracts";
import { TRIAL_AGENT_REGISTRY } from "@/platform/agents/registry";

const kitRegistry = JSON.parse(
  readFileSync(
    join(
      process.cwd(),
      "docs",
      "canon",
      "build-kit",
      "PRN_Black_Car_Coding_Agent_Build_Kit_REV_D",
      "reference",
      "agent_registry_trial.json"
    ),
    "utf-8"
  )
) as Array<{ id: string; name: string; stage: string }>;

describe("canonical agent registry", () => {
  it("every entry parses against the AgentDefinition contract", () => {
    for (const agent of TRIAL_AGENT_REGISTRY) {
      const parsed = AgentDefinition.safeParse(agent);
      expect(parsed.success, `${agent.agent_id}: ${JSON.stringify(parsed.success ? "" : parsed.error.issues)}`).toBe(true);
    }
  });

  it("has unique agent ids", () => {
    const ids = TRIAL_AGENT_REGISTRY.map((a) => a.agent_id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // A00 §9 step 1 migration gate: every reader of the old `stage` field must
  // observe the exact value it always did, now via `status`. The kit JSON is
  // preserved unmodified (D-6), so its field is still literally named `stage`
  // — the assertion below IS the reader-compatibility proof.
  it("stage→status migration: every kit `stage` value survives verbatim via `status`", () => {
    for (const kitAgent of kitRegistry) {
      const ours = TRIAL_AGENT_REGISTRY.find((a) => a.agent_id === kitAgent.id);
      expect(ours, `${kitAgent.id} from kit must exist`).toBeDefined();
      expect(ours!.status).toBe(kitAgent.stage);
      expect(ours!.name).toBe(kitAgent.name);
    }
  });

  it("stage→status migration: no entry still carries an old `stage` field", () => {
    for (const agent of TRIAL_AGENT_REGISTRY) {
      expect("stage" in agent, `${agent.agent_id} must not keep a legacy stage field`).toBe(false);
    }
  });

  it("is a superset of the build-kit JSON (kit preserved unmodified per D-6)", () => {
    for (const kitAgent of kitRegistry) {
      const ours = TRIAL_AGENT_REGISTRY.find((a) => a.agent_id === kitAgent.id);
      expect(ours, `${kitAgent.id} from kit must exist`).toBeDefined();
    }
  });

  it("fixes the kit's A12/A13 omission (#14A §12 wins)", () => {
    const ids = TRIAL_AGENT_REGISTRY.map((a) => a.agent_id);
    expect(ids).toContain("A12");
    expect(ids).toContain("A13");
    expect(kitRegistry.map((a) => a.id)).not.toContain("A12");
  });

  it("keeps A03 test-only and A16 later (D-1)", () => {
    expect(TRIAL_AGENT_REGISTRY.find((a) => a.agent_id === "A03")!.status).toBe("TEST_ONLY");
    const a16 = TRIAL_AGENT_REGISTRY.find((a) => a.agent_id === "A16")!;
    expect(a16.status).toBe("LATER");
    expect(a16.name).toMatch(/Trust Network Intelligence/);
  });

  it("keeps the door-machine agents (A04/A05/A06) registered LIVE with distinct duties", () => {
    const a04 = TRIAL_AGENT_REGISTRY.find((a) => a.agent_id === "A04")!;
    const a05 = TRIAL_AGENT_REGISTRY.find((a) => a.agent_id === "A05")!;
    const a06 = TRIAL_AGENT_REGISTRY.find((a) => a.agent_id === "A06")!;
    expect(a04.status).toBe("LIVE");
    expect(a05.status).toBe("LIVE");
    expect(a06.status).toBe("LIVE");
    expect(a04.mandate).toMatch(/Cannot publish/);
    expect(a06.mandate).toMatch(/publish gate/i);
  });

  // --- A00 extended schema (spec §4, approval conditions 2026-08-24) ---

  it("A00: every entry carries the new platform fields with real or explicit-TBD values", () => {
    for (const agent of TRIAL_AGENT_REGISTRY) {
      // Autonomy scale is an OPEN two-scale canon conflict — must ship "TBD",
      // never a picked scale (approval condition e).
      expect(agent.autonomy_level).toBe("TBD");
      expect(agent.policy_version).toBe("TBD");
      expect(agent.purpose.length).toBeGreaterThan(0);
      expect(agent.owner_layer).toBe("TBD");
      expect(PhaseBand.safeParse(agent.phase_band).success).toBe(true);
      expect(Array.isArray(agent.allowed_capabilities)).toBe(true);
      expect(Array.isArray(agent.data_access)).toBe(true);
      expect(Array.isArray(agent.write_access)).toBe(true);
      expect(typeof agent.budgets).toBe("object");
      expect(agent.kill_switch_ref).toBe(`agent:${agent.agent_id}`);
    }
  });

  it("A00: phase_band mirrors sourced architecture-prompt frontmatter without activating A36", () => {
    const band = (id: string) => TRIAL_AGENT_REGISTRY.find((a) => a.agent_id === id)!.phase_band;
    for (const id of ["A01", "A02", "A03", "A04", "A05", "A06", "A07", "A08", "A09", "A10"]) {
      expect(band(id), id).toBe("TRIAL");
    }
    for (const id of ["A12", "A13", "A14", "A15", "A16", "A25", "A27"]) {
      expect(band(id), id).toBe("PHASE2");
    }
    expect(band("A36")).toBe("TRIAL");
    const a36 = TRIAL_AGENT_REGISTRY.find((a) => a.agent_id === "A36")!;
    expect(a36.status).toBe("SKELETON_LIVE");
    expect(a36.allowed_capabilities).toEqual([]);
    expect(a36.data_access).toEqual([]);
    expect(a36.write_access).toEqual([]);
    expect(a36.budgets).toEqual({});
    expect(a36.schedule).toBeUndefined();
  });

  it("A00: no budget carries an un-labeled dollar figure (hard canon rule 4 — none set yet)", () => {
    for (const agent of TRIAL_AGENT_REGISTRY) {
      expect(agent.budgets.ai_api_dollars_per_day).toBeUndefined();
    }
  });

  it("A00: spec-documented capability bindings are present (A01/A02/A04)", () => {
    const caps = (id: string) =>
      TRIAL_AGENT_REGISTRY.find((a) => a.agent_id === id)!.allowed_capabilities;
    expect(caps("A01")).toContain("classify_problem");
    expect(caps("A02")).toContain("build_job_packet");
    expect(caps("A04")).toContain("get_search_metrics");
  });
});
