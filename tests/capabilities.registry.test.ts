import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CapabilityDefinition } from "@/platform/capabilities/contracts";
import { CAPABILITY_REGISTRY, resolveCapability } from "@/platform/capabilities/registry";
import { TRIAL_AGENT_REGISTRY } from "@/platform/agents/registry";

const scopeStates = JSON.parse(
  readFileSync(
    join(
      process.cwd(),
      "docs",
      "canon",
      "build-kit",
      "PRN_Black_Car_Coding_Agent_Build_Kit_REV_D",
      "reference",
      "scope_states.json"
    ),
    "utf-8"
  )
) as { LIVE: string[]; TEST_DOOR: string[]; FUTURE_DISABLED: string[] };

describe("capability registry", () => {
  it("every entry parses against the CapabilityDefinition contract", () => {
    for (const cap of CAPABILITY_REGISTRY) {
      const r = CapabilityDefinition.safeParse(cap);
      expect(r.success, `${cap.capability_key} must be a valid CapabilityDefinition`).toBe(true);
    }
  });

  it("has unique capability keys", () => {
    const keys = CAPABILITY_REGISTRY.map((c) => c.capability_key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("registers every kit FUTURE_DISABLED runtime as FUTURE_DISABLED", () => {
    for (const key of scopeStates.FUTURE_DISABLED) {
      const cap = CAPABILITY_REGISTRY.find((c) => c.capability_key === key);
      expect(cap, `${key} must be registered`).toBeDefined();
      expect(cap!.status).toBe("FUTURE_DISABLED");
    }
  });

  it("has NOTHING live at Wave 0 — capabilities go LIVE only at their wave gates", () => {
    expect(CAPABILITY_REGISTRY.every((c) => c.status !== "LIVE")).toBe(true);
  });

  it("registers the #23 §8.2 SEO/economics capabilities", () => {
    const keys = CAPABILITY_REGISTRY.map((c) => c.capability_key);
    for (const key of [
      "seo.discover_opportunities",
      "seo.refresh_metrics",
      "seo.ingest_search_console",
      "seo.build_candidate_pages",
      "seo.qa_candidate_pages",
      "seo.publish_page",
      "economics.record_usage_cost",
      "economics.record_revenue",
      "economics.forecast",
      "monetization.render_public_ads",
    ]) {
      expect(keys).toContain(key);
    }
  });

  it("keeps public publishing and monetization at R4+ risk with admin-only scope", () => {
    for (const key of ["seo.publish_page", "monetization.render_public_ads"]) {
      const cap = CAPABILITY_REGISTRY.find((c) => c.capability_key === key)!;
      expect(["R4", "R5", "R6"]).toContain(cap.risk_class);
      expect(cap.required_scopes).toContain("admin.full");
    }
  });

  it("keeps money-touching future capabilities at R5", () => {
    for (const key of ["payments", "quote_acceptance", "scheduling", "purchasing"]) {
      const cap = CAPABILITY_REGISTRY.find((c) => c.capability_key === key)!;
      expect(cap.risk_class).toBe("R5");
    }
  });

  // --- A00 §9 step 2: the registry DESCRIBES what already exists ---

  it("A00: resolves the three spec capability names to the correct existing implementations", () => {
    const classify = resolveCapability("classify_problem");
    expect(classify).not.toBeNull();
    expect(classify!.capability_key).toBe("classify_home_problem");
    expect(classify!.current_implementation).toBe("deterministic");
    expect(classify!.implementation_ref).toContain("fixture-engine.ts");
    expect(classify!.implementation_ref).toContain("FixtureProblemAnalyzer");
    expect(classify!.owning_agent_ids).toEqual(["A01"]);

    const packet = resolveCapability("build_job_packet");
    expect(packet).not.toBeNull();
    expect(packet!.capability_key).toBe("generate_job_packet");
    expect(packet!.current_implementation).toBe("deterministic");
    expect(packet!.implementation_ref).toContain("FixtureJobPacketBuilder");
    expect(packet!.owning_agent_ids).toEqual(["A02"]);

    const metrics = resolveCapability("get_search_metrics");
    expect(metrics).not.toBeNull();
    expect(metrics!.capability_key).toBe("seo.refresh_metrics");
    expect(metrics!.current_implementation).toBe("external_adapter");
    expect(metrics!.implementation_ref).toContain("dataforseo.ts");
    expect(metrics!.owning_agent_ids).toEqual(["A04"]);
  });

  it("A00: canonical keys still resolve, and unknown names return null", () => {
    expect(resolveCapability("classify_home_problem")!.capability_key).toBe("classify_home_problem");
    expect(resolveCapability("no_such_capability")).toBeNull();
  });

  it("A00: no alias collides with a canonical key or another alias", () => {
    const keys = CAPABILITY_REGISTRY.map((c) => c.capability_key);
    const aliases = CAPABILITY_REGISTRY.flatMap((c) => c.aliases ?? []);
    for (const alias of aliases) {
      expect(keys, `alias ${alias} must not shadow a canonical key`).not.toContain(alias);
    }
    expect(new Set(aliases).size).toBe(aliases.length);
  });

  it("A00: owning agents' registry entries list the capability (by alias) back", () => {
    // The Agent Registry's allowed_capabilities and this registry's
    // owning_agent_ids must agree — one governed system, not two lists.
    const pairs: Array<[string, string]> = [
      ["classify_problem", "A01"],
      ["build_job_packet", "A02"],
      ["get_search_metrics", "A04"],
    ];
    for (const [alias, agentId] of pairs) {
      const agent = TRIAL_AGENT_REGISTRY.find((a) => a.agent_id === agentId)!;
      expect(agent.allowed_capabilities, `${agentId} allows ${alias}`).toContain(alias);
      expect(resolveCapability(alias)!.owning_agent_ids).toContain(agentId);
    }
  });
});
