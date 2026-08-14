import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CapabilityDefinition } from "@/platform/capabilities/contracts";
import { CAPABILITY_REGISTRY } from "@/platform/capabilities/registry";

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
});
