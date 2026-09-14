import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AdminAgents from "@/app/admin/agents/page";
import { TRIAL_AGENT_REGISTRY } from "@/platform/agents/registry";
import type { RunHistory } from "@/platform/admin/run-history";

const state = vi.hoisted(() => ({ unlocked: true, reads: 0, history: {} as RunHistory }));
vi.mock("@/components/admin/AdminGate", () => ({ adminGate: async () => state.unlocked ? null : createElement("p", null, "LOCKED_ROSTER") }));
vi.mock("@/platform/admin/run-history", () => ({ readRunHistory: async (limit: number) => { state.reads++; expect(limit).toBe(80); return state.history; } }));

beforeEach(() => {
  state.unlocked = true; state.reads = 0;
  state.history = { rows: [], state: "available", source: "local receipts", scanned: 0, skipped: 0, limit: 80, observed_at: "2026-09-06T04:00:00Z" };
});
async function render(search: Record<string, string> = {}) {
  return renderToStaticMarkup(await AdminAgents({ searchParams: Promise.resolve(search) }));
}

describe("agent declarations and observed receipts", () => {
  it("does not read private execution history before the admin gate", async () => {
    state.unlocked = false;
    expect(await render()).toContain("LOCKED_ROSTER");
    expect(state.reads).toBe(0);
  });

  it("keeps LIVE/TBD agents as declarations and never replaces absent runs with static health", async () => {
    const html = await render();
    expect(html).toContain("No run receipts returned");
    expect(html).toContain("No observed runs in this read");
    expect(html).not.toContain("The Black Car trial&#x27;s working agents");
    expect(html).not.toContain("health-dot");
    expect(html).not.toContain("adm-status--good");
    for (const id of ["A07", "A10", "A14", "A15"]) {
      const agent = TRIAL_AGENT_REGISTRY.find(entry => entry.agent_id === id)!;
      const detail = html.split(`id="${id}"`)[1]?.split("</details>")[0];
      expect(detail).toContain(`Declared ${agent.status}`);
      expect(detail).toContain("No observed runs in this read");
      expect(detail).toContain("Not declared (TBD)");
    }
    expect(html).toContain("An empty declaration does not prove no access");
    expect(html).toContain("does not mean unlimited authority");
  });

  it("shows a real receipt and unknown cost without describing invocation as a successful result", async () => {
    state.history.rows = [{ run_id: "ar_synthetic_observation", agent_id: "A05", trigger: "admin_action", created_at: "2026-09-06T03:59:00Z", provider: "OpenRouter", model: "synthetic-model", cost_usd: null, latency_ms: 540, error_count: 2, capability_count: 1 }];
    state.history.scanned = 1;
    const html = await render();
    expect(html).toContain("ar_synthetic_observation");
    expect(html).toContain("synthetic-model"); expect(html).toContain("2 recorded");
    expect(html).toContain("1 receipt in this read");
    expect(html).toContain("No recorded errors does not prove a useful outcome");
    expect(html).not.toContain("$0.000000");
    expect(html).not.toContain("adm-status--good");
  });

  it("reports failed and partial history without a zero-activity conclusion", async () => {
    state.history.state = "unavailable"; state.history.source = "database";
    let html = await render({ activity: "no-observed" });
    expect(html).toContain("Activity is unavailable");
    expect(html).toContain("Run history unavailable");
    expect(html).not.toContain("No observed runs in this read");
    expect(html).not.toContain("No run receipts returned");
    expect(html).toContain('name="activity" disabled=""');
    state.history.state = "partial"; state.history.source = "process buffer"; state.history.skipped = 2;
    html = await render();
    expect(html).toContain("partial reading, not complete history");
    expect(html).toContain("2 unreadable or excluded entries");
    expect(html).toContain("can lose its history on restart");
  });

  it("filters by identity, phase and observed activity while preserving the separate activity section", async () => {
    state.history.rows = [{ run_id: "ar_synthetic_filter", agent_id: "A05", trigger: "admin_action", created_at: "2026-09-06T03:59:00Z", provider: null, model: null, cost_usd: 0, latency_ms: null, error_count: 0, capability_count: 1 }];
    const phase = TRIAL_AGENT_REGISTRY.find(agent => agent.agent_id === "A05")!.phase_band;
    const html = await render({ q: "a05", phase, activity: "observed" });
    expect(html).toContain('id="A05"'); expect(html).not.toContain('id="A07"');
    expect(html).toContain("ar_synthetic_filter"); expect(html).toContain("$0.000000");
    expect(await render({ q: "does-not-exist" })).toContain("No registry entries match");
  });
});
