import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ reply: { data: null as null | Array<{ link_id: string }>, error: null as null | { code: string; message: string } } }));
vi.mock("@/platform/db/client", () => ({
  serviceConfigured: () => true,
  requestScopedClient: () => null,
  requireServiceClient: () => ({ from: () => ({ select() { return this; }, eq() { return this; }, limit: async () => state.reply }) }),
}));
import { unguardedRuntimeStore } from "@/platform/stores/runtime";
beforeEach(() => { state.reply = { data: null, error: null }; });
describe("revocation authorization faults", () => {
  it("missing Supabase schema throws rather than reopening all links", async () => {
    state.reply.error = { code: "42P01", message: "relation link_revocations does not exist" };
    await expect(unguardedRuntimeStore().isLinkRevoked("lk_fixture")).rejects.toThrow(/unavailable/);
  });
  it("other backend faults also fail closed", async () => {
    state.reply.error = { code: "08006", message: "connection unavailable" };
    await expect(unguardedRuntimeStore().isLinkRevoked("lk_fixture")).rejects.toThrow(/revocation/);
  });
  it("only a successful empty result means not revoked", async () => {
    state.reply.data = [];
    expect(await unguardedRuntimeStore().isLinkRevoked("lk_fixture")).toBe(false);
    state.reply.data = [{ link_id: "lk_fixture" }];
    expect(await unguardedRuntimeStore().isLinkRevoked("lk_fixture")).toBe(true);
  });
});
