import { afterEach, describe, expect, it, vi } from "vitest";
import { adminAction, AdminActionError } from "../src/components/admin/action";

afterEach(() => vi.unstubAllGlobals());

describe("explicit admin action transport", () => {
  it("keeps the existing JSON body and same-origin session contract", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ ok: true, version: 4 }));
    vi.stubGlobal("fetch", fetch);
    await expect(adminAction("/api/admin/policy", { method: "PUT", body: { version: 3, national_enabled: false } })).resolves.toEqual({ ok: true, version: 4 });
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith("/api/admin/policy", { method: "PUT", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: '{"version":3,"national_enabled":false}' });
  });

  it("supports a body-free reconciliation action without invented fields", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ verdict: "could_not_verify" }));
    vi.stubGlobal("fetch", fetch);
    await adminAction("/api/admin/quality/reconcile");
    expect(fetch).toHaveBeenCalledWith("/api/admin/quality/reconcile", { method: "POST", credentials: "same-origin" });
  });

  it("never retries a lost mutation and describes the uncertain outcome", async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetch);
    await expect(adminAction("/api/admin/pages/publish", { body: { page_spec_id: "test", action: "publish" } })).rejects.toThrow("may have reached the server");
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("preserves an explicit server refusal", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "The policy changed. Reload before saving." }, { status: 409 })));
    await expect(adminAction("/api/admin/policy")).rejects.toMatchObject({ name: "AdminActionError", status: 409, message: "The policy changed. Reload before saving." });
  });

  it("explains session expiry when a forbidden response has no usable body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Forbidden", { status: 403 })));
    await expect(adminAction("/api/admin/killswitch")).rejects.toThrow("session may have ended");
  });

  it("does not claim success when an OK response is unreadable", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("<html>gateway</html>", { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    await expect(adminAction("/api/admin/approvals/resolve")).rejects.toThrow("check whether the action completed");
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("rejects a primitive JSON result instead of treating it as an action receipt", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(true)));
    await expect(adminAction("/api/admin/login")).rejects.toBeInstanceOf(AdminActionError);
  });
});
