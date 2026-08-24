import { describe, expect, it } from "vitest";
import { MEDIA_MAX_BYTES } from "@/platform/adapters/media-storage";
import {
  PLATFORM_POLICY_SETTINGS,
  PolicySetting,
  getPolicySetting,
  requirePolicyNumber,
} from "@/platform/policy/store";

/**
 * A00 §9 step 6 — Policy + Config Store: shape declared, exactly one real
 * trial tunable migrated (the intake media upload cap), behavior unchanged.
 */
describe("A00 policy + config store", () => {
  it("every setting parses against the PolicySetting contract", () => {
    for (const setting of PLATFORM_POLICY_SETTINGS) {
      expect(PolicySetting.safeParse(setting).success, setting.key).toBe(true);
    }
  });

  it("the migrated media cap round-trips with its version", () => {
    const setting = getPolicySetting<number>("intake.media_max_bytes");
    expect(setting).not.toBeNull();
    expect(setting!.value).toBe(25 * 1024 * 1024);
    expect(setting!.version).toBe(1);
    expect(setting!.level).toBe("COMPANY");
  });

  it("behavior unchanged: MEDIA_MAX_BYTES still exports the identical 25 MB value", () => {
    expect(MEDIA_MAX_BYTES).toBe(25 * 1024 * 1024);
    expect(MEDIA_MAX_BYTES).toBe(requirePolicyNumber("intake.media_max_bytes"));
  });

  it("a missing key is a loud programmer error, never a silent default", () => {
    expect(() => requirePolicyNumber("no.such_key")).toThrow(/missing/);
    expect(getPolicySetting("no.such_key")).toBeNull();
  });

  it("hard canon rule 4: every dollar-figure key is TEST-labeled", () => {
    for (const setting of PLATFORM_POLICY_SETTINGS) {
      if (/usd|dollar/.test(setting.key)) {
        expect(setting.is_test_figure, `${setting.key} must be is_test_figure: true`).toBe(true);
      }
    }
  });

  it("no secrets in the policy store — values are plain business tunables", () => {
    for (const setting of PLATFORM_POLICY_SETTINGS) {
      expect(["number", "boolean"]).toContain(typeof setting.value);
      expect(setting.key).not.toMatch(/key|secret|token|password/);
    }
  });

  it("has unique keys", () => {
    const keys = PLATFORM_POLICY_SETTINGS.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
