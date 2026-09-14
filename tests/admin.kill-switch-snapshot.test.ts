import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it } from "vitest";
import { readKillSwitchSnapshot, listKillSwitches, resetKillSwitchForTests } from "@/platform/killswitch";

function provider(data: unknown, error: unknown = null) {
  return () => ({ from: () => ({ select: async () => ({ data, error }) }) }) as unknown as SupabaseClient;
}
const global = { switch_key: "global", scope: "GLOBAL", scope_ref: null, engaged: true, engaged_at: "2026-09-06T12:00:00Z", reason: "fixture pause" };
beforeEach(resetKillSwitchForTests);

describe("fresh administrative kill-switch observations", () => {
  it("awaits real source data and does not mutate the operational cache", async () => {
    const result = await readKillSwitchSnapshot(provider([global]));
    expect(result).toMatchObject({ verified: true, source: "database", states: [{ key: "global", engaged: true }] });
    expect(listKillSwitches().size).toBe(0);
  });
  it("distinguishes an empty database from unavailable evidence and process-local state", async () => {
    expect(await readKillSwitchSnapshot(provider([]))).toEqual({ states: [], verified: true, source: "database" });
    expect(await readKillSwitchSnapshot(provider(null, { message: "private" }))).toEqual({ states: [], verified: false, source: "database" });
    expect(await readKillSwitchSnapshot(() => { throw new Error("offline"); })).toEqual({ states: [], verified: false, source: "database" });
    expect(await readKillSwitchSnapshot(() => null)).toEqual({ states: [], verified: true, source: "this process" });
  });
  it.each([
    [{ ...global, switch_key: "agent:A01" }], [{ ...global, scope_ref: "A01" }],
    [{ ...global, scope: "AGENT", switch_key: "agent:A01", scope_ref: null }],
    [{ ...global, scope: "AGENT", switch_key: "agent:A01", scope_ref: "A02" }],
    [{ ...global, engaged_at: "2026-99-06T12:00:00Z" }], [global, global], [null],
  ].map(rows => ({ rows })))("never verifies inconsistent or duplicate switch records %#", async ({ rows }) => {
    expect((await readKillSwitchSnapshot(provider(rows))).verified).toBe(false);
  });
  it("accepts a matching operative agent switch", async () => {
    const result = await readKillSwitchSnapshot(provider([{ ...global, scope: "AGENT", switch_key: "agent:A01", scope_ref: "A01" }]));
    expect(result).toMatchObject({ verified: true, states: [{ key: "agent:A01", scope: "AGENT", scope_ref: "A01" }] });
  });
});
