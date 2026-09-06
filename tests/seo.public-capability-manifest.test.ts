import { afterEach, describe, expect, it, vi } from "vitest";
import { getV43DoorBinding } from "@/domain/search/door-template";
import { publicCapabilityManifest } from "@/platform/pages/public-capability-manifest";
import { GET } from "@/app/capabilities/home-problem-analyzer.json/route";
import { GET as redirectMethodology } from "@/app/repair-records/methodology/route";
import registry from "../content/door-template/v43/spec/ac-blowing-warm-air/capability-registry.json";

afterEach(() => vi.restoreAllMocks());

describe("public capability claims", () => {
  it("serves all nine exact page claims with pending verification and no internal provenance", async () => {
    const response = GET();
    const manifest = await response.json();
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("application/json");
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    expect(manifest.production_runtime_verified).toBe(false);
    expect(manifest.disclaimer).toContain("not a ranking factor");
    expect(manifest.capabilities).toHaveLength(9);
    expect(manifest.capabilities.map((row: { live_status: string }) => row.live_status))
      .toEqual(Array(9).fill("CLAIMED_ON_PAGE_PENDING_RUNTIME_VERIFICATION"));
    expect(manifest.capabilities.map((row: { visible_row_question: string }) => row.visible_row_question))
      .toEqual(getV43DoorBinding().capability_questions.map((row) => row.question));
    expect(manifest.tool.public_routes).toContain("/problems/ac-blowing-warm-air");
    expect(manifest.tool.public_routes).not.toContain("/ac-blowing-warm-air");
    expect(manifest.tool.accepted_inputs_scope).toContain("Visible homeowner controls only");
    expect(manifest.tool.required_form_context[0].field).toBe("disclosure_content_hash");
    const publicJson = JSON.stringify(manifest);
    expect(publicJson).not.toMatch(/Project\/|C:[\\/]|_source|_what|_public_routes_note|<textarea|\{\{/);
    const checkKeys = (value: unknown) => {
      if (value && typeof value === "object") {
        for (const [key, child] of Object.entries(value)) {
          expect(key.startsWith("_")).toBe(false);
          checkKeys(child);
        }
      }
    };
    checkKeys(manifest);
  });

  it("refuses status promotion or visible-table drift instead of advertising an unverified live action", () => {
    const row = registry.capabilities[0];
    const original = row.live_status;
    try {
      row.live_status = "LIVE";
      expect(() => publicCapabilityManifest()).toThrow("differs");
      expect(GET().status).toBe(503);
    } finally { row.live_status = original; }
  });

  it("returns independent values so a consumer cannot mutate the next manifest", () => {
    const result = publicCapabilityManifest();
    result.capabilities[0].required_inputs.push("injected");
    result.safety_boundaries.never.length = 0;
    expect(publicCapabilityManifest().capabilities[0].required_inputs).not.toContain("injected");
    expect(publicCapabilityManifest().safety_boundaries.never.length).toBeGreaterThan(0);
  });

  it("refuses a registry endpoint or input drift away from the shared form", () => {
    const endpoint = registry.tool.endpoint;
    const field = registry.tool.accepted_inputs[0].field;
    try {
      registry.tool.endpoint = "/api/another-action";
      expect(GET().status).toBe(503);
      registry.tool.endpoint = endpoint;
      registry.tool.accepted_inputs[0].field = "another_field";
      expect(GET().status).toBe(503);
    } finally {
      registry.tool.endpoint = endpoint;
      registry.tool.accepted_inputs[0].field = field;
    }
  });

  it("redirects the old methodology spelling directly to the established same-origin path", () => {
    const response = redirectMethodology(new Request("https://prn-test-site.vercel.app/repair-records/methodology?old=1"));
    expect(response.status).toBe(308);
    expect(response.headers.get("Location")).toBe("https://prn-test-site.vercel.app/local-records/methodology");
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
  });
});
