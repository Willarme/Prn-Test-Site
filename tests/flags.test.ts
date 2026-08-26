import { describe, expect, it } from "vitest";
import { DEFAULT_FLAGS, FeatureFlag, flagEnabled } from "@/platform/flags";

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

  it("keeps every RISKY surface off until its wave gate", () => {
    for (const key of [
      // seo_doors_enabled REMOVED from this list 2026-08-26: flipped ON by
      // owner directive (test environment) — see flags.ts OWNER-DIRECTIVE-
      // 2026-08-26. The publish gate in front of it is unchanged and tested.
      "trust_enabled",
      "monetization_enabled",
      "mcp_enabled",
      "sms_enabled",
    ]) {
      expect(flagEnabled(key), `${key} must be off`).toBe(false);
    }
  });

  it("every enabled flag cites the gate decision that flipped it", () => {
    for (const flag of DEFAULT_FLAGS.filter((f) => f.enabled)) {
      expect(flag.decision_ref, `${flag.flag_key} needs a decision_ref`).not.toBeNull();
    }
  });

  it("flagEnabled is safe on unknown keys", () => {
    expect(flagEnabled("does_not_exist")).toBe(false);
  });
});
