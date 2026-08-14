import { describe, expect, it } from "vitest";
import { DEFAULT_FLAGS, FeatureFlag } from "@/platform/flags";

describe("feature flags", () => {
  it("every flag parses against the FeatureFlag contract", () => {
    for (const flag of DEFAULT_FLAGS) {
      expect(FeatureFlag.safeParse(flag).success, flag.flag_key).toBe(true);
    }
  });

  it("has unique flag keys", () => {
    const keys = DEFAULT_FLAGS.map((f) => f.flag_key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("ships EVERYTHING off at Wave 0 — flags flip only at wave gates with owner approval", () => {
    for (const flag of DEFAULT_FLAGS) {
      expect(flag.enabled, `${flag.flag_key} must be off`).toBe(false);
    }
  });

  it("keeps the risky surfaces behind flags at all", () => {
    const keys = DEFAULT_FLAGS.map((f) => f.flag_key);
    for (const required of ["seo_doors_enabled", "monetization_enabled", "sms_enabled", "mcp_enabled"]) {
      expect(keys).toContain(required);
    }
  });
});
