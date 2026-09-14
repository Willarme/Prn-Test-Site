import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { PageSpec } from "@/domain/search/pages";
import { SAMPLE_PAGE_SPEC } from "@/domain/search/fixtures/sample-page-spec";
import staged from "../data/factory/staged-specs.json";
import { TRIAL_DEFAULT_SEO_FACTORY_POLICY } from "@/domain/search/policy";
import { GET as rootAlias, HEAD as rootHead } from "@/app/ac-blowing-warm-air/route";
import { GET as methodologyAlias } from "@/app/repair-records/methodology/route";
import { isRetiredLegacySpec, LEGACY_DOOR_RETIREMENT } from "@/platform/pages/route-retirement";
import { renderCustomerHeader, renderCustomerFooter, PRODUCT_LINKS } from "@/platform/pages/customer-shell";
import { featureSnapshot } from "./helpers/feature-snapshot";

const portfolio = [SAMPLE_PAGE_SPEC, ...staged.specs.map(spec => PageSpec.parse(spec))];
vi.mock("@/platform/admin/data", () => ({
  allStagedSpecs: async () => portfolio,
  publishedPageIds: async () => new Set(portfolio.map(spec => spec.page_id)),
  policyStore: () => ({ getActive: async () => TRIAL_DEFAULT_SEO_FACTORY_POLICY }),
}));
vi.mock("@/platform/search/page-registry-store", () => ({
  pageRegistryStore: () => ({ listPages: async () => [] }),
}));

describe("T6-29 canonical route aliases", () => {
  it.each([rootAlias, rootHead])("keeps navigation query parameters on the durable path", handler => {
    const response = handler(new Request("https://example.test/ac-blowing-warm-air?source=door&error=consent&x=1&x=2", { method: handler === rootHead ? "HEAD" : "GET" }));
    expect(response.status).toBe(308);
    expect(response.headers.get("Location")).toBe("https://example.test/problems/ac-blowing-warm-air?source=door&error=consent&x=1&x=2");
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
  });
  it("removes only the retired methodology selector", () => {
    const response = methodologyAlias(new Request("https://example.test/repair-records/methodology?old=1&source=packet"));
    expect(response.status).toBe(308);
    expect(response.headers.get("Location")).toBe("https://example.test/local-records/methodology?source=packet");
  });
  it.each(["POST", "PUT", "PATCH", "DELETE"])("does not forward %s bodies", method => {
    const response = rootAlias(new Request("https://example.test/ac-blowing-warm-air", { method }));
    expect(response.status).toBe(405);
    expect(response.headers.get("Location")).toBeNull();
  });
});

describe("T6-29 retained legacy history", () => {
  it("identifies exactly the five specified old-template doors", () => {
    expect(portfolio.filter(isRetiredLegacySpec).map(spec => spec.canonical_path).sort())
      .toEqual([...LEGACY_DOOR_RETIREMENT.paths].sort());
    expect(isRetiredLegacySpec({ ...SAMPLE_PAGE_SPEC, template_id: "door-v44" })).toBe(false);
  });
  it("neither staged nor published lookups return retired specifications", async () => {
    const { findStagedByPath, findPublishedByPath } = await import("@/domain/search/page-store");
    for (const pathname of LEGACY_DOOR_RETIREMENT.paths) {
      expect(await findStagedByPath(pathname)).toBeNull();
      expect(await findPublishedByPath(pathname)).toBeNull();
    }
  });
  it("retains registry rows as RETIRED and refuses publish through the shared gate", async () => {
    const { pageRegistrySnapshot, publishGate, publishQueueSnapshot } = await import("@/platform/search/page-qa-gate");
    const registry = await pageRegistrySnapshot(portfolio);
    expect(registry).toHaveLength(5);
    expect(registry.every(row => row.lifecycle_status === "RETIRED" && row.retired_at)).toBe(true);
    const queue = await publishQueueSnapshot();
    for (const row of queue) {
      expect(row.decision.release_eligible).toBe(false);
      expect(row.decision.reasons[0]).toContain("T6-29:R3:c6ff9a");
      const gate = await publishGate({ page_spec_id: row.spec.page_spec_id });
      expect(gate?.decision).toEqual(row.decision);
    }
  });
});

describe("T6-29 customer navigation", () => {
  it("carries the product menu and full footer, with owner sign-in last", () => {
    const snapshot = featureSnapshot({}, "LIVE");
    const header = renderCustomerHeader(snapshot);
    const footer = renderCustomerFooter(snapshot);
    for (const item of PRODUCT_LINKS) {
      expect(header).toContain(`href="${item.href}"`);
      expect(footer).toContain(`href="${item.href}"`);
    }
    expect(header).not.toMatch(/\/admin|\/demo|\/future|provider-os/);
    expect(footer).toMatch(/<a href="\/admin">Owner sign-in<\/a><\/nav>/);
    expect(renderCustomerHeader(snapshot, true)).toContain('href="#intake"');
  });
  it("removes root navigator controls and its unpublished-spec query", () => {
    const home = readFileSync("src/app/page.tsx", "utf8");
    expect(home).not.toMatch(/FEATURE_CONCEPTS|allStagedSpecs|Trial navigator|Open Admin|\/future\//);
    const layout = readFileSync("src/app/layout.tsx", "utf8");
    expect(layout).not.toMatch(/Explore the demo|Try the sample|PRN_CLIENT_DEMO/);
    expect(readFileSync("src/app/admin/pages/page.tsx", "utf8")).toContain('<option value="retired">Retired</option>');
  });
});
