import { beforeEach, expect, it, vi } from "vitest";

// Port private 8b2f678's explicit request scoping, immutable issuance and
// missing/denied storage assertions to public 00024's service-only RPCs.
// The private soft-empty fallback is deliberately rejected: an outage must
// never look like an empty revocation history. Real SQL/RLS remains covered
// by the unmodified t8-39.link-ledger-shared integration suite.
const state = vi.hoisted(() => ({ scoped: true, failure: false, calls: [] as unknown[], rpc: vi.fn() }));
vi.mock("@/platform/db/client", () => {
  function client(kind: string) {
    return { rpc: state.rpc, from(table: string) {
      const call = { kind, table, filters: [] as unknown[], order: [] as string[], range: [] as number[] };
      state.calls.push(call);
      const chain = {
        select() { return chain; }, eq(key: string, value: string) { call.filters.push([key, value]); return chain; },
        order(key: string) { call.order.push(key); return chain; },
        async range(from: number, to: number) { call.range = [from, to]; return { data: [], error: state.failure ? { code: "42501", message: "SYNTHETIC_PRIVATE_DETAIL" } : null }; },
        async maybeSingle() { return { data: null, error: state.failure ? { code: "42P01", message: "SYNTHETIC_PRIVATE_DETAIL" } : null }; },
      };
      return chain;
    } };
  }
  return { requestScopedClient: () => state.scoped ? client("scoped") : null, requireServiceClient: () => client("service") };
});
import { readSharedLedger, recordSharedLink, requestSharedKeep } from "@/platform/links/ledger-shared";
const context = { requestId: "rq_ported", tenantId: "tenant_ported", problemId: "problem_ported" };
beforeEach(() => { state.scoped = true; state.failure = false; state.calls = []; state.rpc.mockReset(); });

it.each([true, false])("both request JWT and service fallback explicitly scope reads by request AND tenant (scoped=%s)", async scoped => {
  state.scoped = scoped;
  expect(await readSharedLedger(context)).toEqual({ request_id: context.requestId, links: [], keep: null });
  expect(state.calls).toEqual([
    { kind: scoped ? "scoped" : "service", table: "issued_request_links", filters: [["request_id", context.requestId], ["tenant_id", context.tenantId]], order: ["created_at", "link_id"], range: [0, 199] },
    { kind: scoped ? "scoped" : "service", table: "request_keep_state", filters: [["request_id", context.requestId], ["tenant_id", context.tenantId]], order: [], range: [] },
  ]);
});
it("denied storage cannot masquerade as empty history and does not disclose backend messages", async () => {
  state.failure = true;
  await expect(readSharedLedger(context)).rejects.toThrow(/^Shared link history is unavailable\.$/);
});
it("issuance uses the immutable service RPC with exact identity and no direct upsert", async () => {
  const token = Buffer.from(JSON.stringify({ r: context.requestId, id: "lk_ported", s: "packet", e: null })).toString("base64url") + ".synthetic";
  const link = { link_id: "lk_ported", scope: "packet" as const, token, created_at: "2026-09-13T00:00:00.000Z", exp: null };
  state.rpc.mockResolvedValue({ data: { ...link, request_id: context.requestId, tenant_id: context.tenantId, problem_id: context.problemId }, error: null });
  expect(await recordSharedLink(context, link)).toEqual(link);
  expect(state.rpc).toHaveBeenCalledExactlyOnceWith("register_request_link", { p_request_id: context.requestId, p_tenant_id: context.tenantId, p_link: link });
  expect(state.calls).toEqual([]);
});
it.each(["42P01", "42501", "23505"])("failed issuance/keep registration (%s) is closed, generic and never silently acknowledged", async code => {
  state.rpc.mockResolvedValue({ data: null, error: { code, message: "SYNTHETIC_PRIVATE_DETAIL" } });
  await expect(recordSharedLink(context, { link_id: "lk_ported", scope: "packet", token: "synthetic", created_at: "2026-09-13T00:00:00.000Z", exp: null })).rejects.toThrow(/^Shared link history is unavailable\.$/);
  await expect(requestSharedKeep(context, { email_id: null, magic_id: "mg_ported" })).rejects.toThrow(/^Shared link history is unavailable\.$/);
  expect(state.calls).toEqual([]);
});
