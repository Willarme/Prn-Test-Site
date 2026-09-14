import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const reads = vi.hoisted(() => ({ gate: vi.fn(), policy: vi.fn(), spend: vi.fn(), switches: vi.fn() }));
vi.mock("@/components/admin/AdminGate", () => ({ adminGate: reads.gate }));
vi.mock("@/platform/ai/policy-store", () => ({ aiPolicyStore: () => ({ getActive: reads.policy }) }));
vi.mock("@/platform/ai/spend", () => ({ spendLedger: () => ({ read: reads.spend }), utcDay: () => "2026-09-06" }));
vi.mock("@/platform/killswitch", () => ({ readKillSwitchSnapshot: reads.switches }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import AdminSystem from "../src/app/admin/system/page";
import { DEFAULT_AI_POLICY, AI_CAPABILITY_KEYS } from "../src/platform/ai/policy";
import { DEFAULT_FLAGS } from "../src/platform/flags";
import { CAPABILITY_REGISTRY } from "../src/platform/capabilities/registry";

beforeEach(() => {
  vi.resetAllMocks();
  reads.gate.mockResolvedValue(null);
  reads.policy.mockResolvedValue(structuredClone(DEFAULT_AI_POLICY));
  reads.spend.mockResolvedValue({ day: "2026-09-06", total_usd: 0.000017, calls: 1, by_capability: { generate_page_copy: 0.000017 }, figure_label: "TEST" });
  reads.switches.mockResolvedValue({ verified: true, source: "process_memory", states: [] });
});

describe("system observation presentation", () => {
  it("does not read private operating state until the admin gate passes", async () => {
    reads.gate.mockResolvedValue(createElement("p", null, "Sign in"));
    expect(renderToStaticMarkup(await AdminSystem())).toContain("Sign in");
    expect(reads.policy).not.toHaveBeenCalled();
    expect(reads.spend).not.toHaveBeenCalled();
    expect(reads.switches).not.toHaveBeenCalled();
  });

  it("renders one global control using the fresh observed state", async () => {
    reads.switches.mockResolvedValue({ verified: true, source: "database", states: [{ key: "global", scope: "GLOBAL", engaged: true, reason: "Owner pause" }] });
    const html = renderToStaticMarkup(await AdminSystem());
    expect(html.match(/aria-label="Release global stop"/g)).toHaveLength(1);
    expect(html).not.toContain('aria-label="Engage global stop"');
    expect(html).toContain("Fresh database reading");
    expect(html).toContain("Owner pause");
    expect(html).toContain("block the separate owner edit and publish actions");
    expect(html).toContain("older than 30 seconds");
  });

  it("disables global and agent controls when the database observation fails", async () => {
    reads.switches.mockResolvedValue({ verified: false, source: "database", states: [{ key: "global", scope: "GLOBAL", engaged: true }, { key: "agent:A05", scope: "AGENT", scope_ref: "A05", engaged: true }] });
    const html = renderToStaticMarkup(await AdminSystem());
    expect(html).toContain("State unverified");
    expect(html.match(/<button[^>]*disabled=""[^>]*aria-label="Release (?:global|A05) stop"/g)).toHaveLength(2);
    expect(html.match(/Control unavailable/g)).toHaveLength(2);
  });

  it("does not replace failed policy and spend reads with healthy zero readings", async () => {
    reads.policy.mockRejectedValue(new Error("unavailable"));
    reads.spend.mockRejectedValue(new Error("unavailable"));
    const html = renderToStaticMarkup(await AdminSystem());
    expect(html).toContain("Saved policy unverified");
    expect(html).toContain("does not establish zero spend");
    expect(html).not.toContain("$0.00");
    for (const flag of DEFAULT_FLAGS) expect(html).toContain(flag.flag_key);
    for (const capability of CAPABILITY_REGISTRY) expect(html).toContain(capability.capability_key);
    for (const key of AI_CAPABILITY_KEYS) expect(html).toContain(key);
  });

  it("identifies disabled policy fallback as unverified and retains small nonzero recorded cost", async () => {
    reads.policy.mockResolvedValue(DEFAULT_AI_POLICY);
    const html = renderToStaticMarkup(await AdminSystem());
    expect(html).toContain("The gateway returned disabled defaults; the saved policy was not verified.");
    expect(html).toContain("$0.000017");
    expect(html).toContain("not a vendor invoice or a remaining-budget calculation");
  });
});
