import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AgentDefinition } from "@/platform/agents/contracts";
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
      expect(AgentDefinition.safeParse(agent).success, agent.agent_id).toBe(true);
    }
  });

  it("has unique agent ids", () => {
    const ids = TRIAL_AGENT_REGISTRY.map((a) => a.agent_id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("is a superset of the build-kit JSON (kit preserved unmodified per D-6)", () => {
    for (const kitAgent of kitRegistry) {
      const ours = TRIAL_AGENT_REGISTRY.find((a) => a.agent_id === kitAgent.id);
      expect(ours, `${kitAgent.id} from kit must exist`).toBeDefined();
      expect(ours!.stage).toBe(kitAgent.stage);
      expect(ours!.name).toBe(kitAgent.name);
    }
  });

  it("fixes the kit's A12/A13 omission (#14A §12 wins)", () => {
    const ids = TRIAL_AGENT_REGISTRY.map((a) => a.agent_id);
    expect(ids).toContain("A12");
    expect(ids).toContain("A13");
    expect(kitRegistry.map((a) => a.id)).not.toContain("A12");
  });

  it("keeps A03 test-only and A16 later (D-1)", () => {
    expect(TRIAL_AGENT_REGISTRY.find((a) => a.agent_id === "A03")!.stage).toBe("TEST_ONLY");
    const a16 = TRIAL_AGENT_REGISTRY.find((a) => a.agent_id === "A16")!;
    expect(a16.stage).toBe("LATER");
    expect(a16.name).toMatch(/Trust Network Intelligence/);
  });

  it("keeps the door-machine agents (A04/A05/A06) registered LIVE with distinct duties", () => {
    const a04 = TRIAL_AGENT_REGISTRY.find((a) => a.agent_id === "A04")!;
    const a05 = TRIAL_AGENT_REGISTRY.find((a) => a.agent_id === "A05")!;
    const a06 = TRIAL_AGENT_REGISTRY.find((a) => a.agent_id === "A06")!;
    expect(a04.stage).toBe("LIVE");
    expect(a05.stage).toBe("LIVE");
    expect(a06.stage).toBe("LIVE");
    expect(a04.mandate).toMatch(/Cannot publish/);
    expect(a06.mandate).toMatch(/publish gate/i);
  });
});
