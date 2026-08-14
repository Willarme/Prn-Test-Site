import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SeoFactoryPolicy, TRIAL_DEFAULT_SEO_FACTORY_POLICY } from "@/domain/search/policy";
import { FilePolicyStore } from "@/platform/stores/policy-file";

describe("FilePolicyStore (owner-editable configuration, no deploy needed)", () => {
  it("falls back to trial defaults when no file exists", async () => {
    const dir = await mkdtemp(join(tmpdir(), "prn-policy-"));
    const store = new FilePolicyStore(join(dir, "policy.json"));
    const active = await store.getActive();
    expect(active.publish_mode).toBe("OWNER_APPROVAL");
    expect(active.geography_plan.national.enabled).toBe(true);
  });

  it("round-trips a valid edit and re-validates on save", async () => {
    const dir = await mkdtemp(join(tmpdir(), "prn-policy-"));
    const path = join(dir, "policy.json");
    const store = new FilePolicyStore(path);
    const edited = SeoFactoryPolicy.parse({
      ...TRIAL_DEFAULT_SEO_FACTORY_POLICY,
      target_qualified_pages_per_period: 10,
      version: 2,
    });
    await store.save(edited);
    const reloaded = await store.getActive();
    expect(reloaded.target_qualified_pages_per_period).toBe(10);
    expect(reloaded.version).toBe(2);
    expect(JSON.parse(await readFile(path, "utf-8")).version).toBe(2);
  });

  it("refuses to persist a policy that violates trial invariants", async () => {
    const dir = await mkdtemp(join(tmpdir(), "prn-policy-"));
    const store = new FilePolicyStore(join(dir, "policy.json"));
    const invalid = {
      ...TRIAL_DEFAULT_SEO_FACTORY_POLICY,
      publish_mode: "LOW_RISK_AUTO" as const, // forbidden at T0
    };
    await expect(store.save(invalid)).rejects.toThrow();
  });

  it("the committed data/seo-factory-policy.json is itself a valid policy", async () => {
    const store = new FilePolicyStore(join(process.cwd(), "data", "seo-factory-policy.json"));
    const active = await store.getActive();
    expect(active.policy_id).toBe("seo_factory_policy_default");
    expect(active.human_approval_required).toBe(true);
  });
});
