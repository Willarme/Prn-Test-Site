import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (name: string) => jar.has(name) ? { value: jar.get(name) } : undefined }) }));
import { createOwnerCookie, hasOwnerAccess, ownerAllowed, ownerCookieName } from "@/platform/links/owner";
import { decodeLink, revokeLink, signLink } from "@/platform/links/tokens";
import { updateDevDb } from "@/platform/stores/dev-db";
import { resetRuntimeStore } from "@/platform/stores/runtime";
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "prn-owner-test-"));
  vi.stubEnv("PRN_DEV_DB_PATH", join(dir, "db.json")); vi.stubEnv("PRN_RUNTIME_STORE", "file");
  vi.stubEnv("LINK_SIGNING_SECRET", "fixture-owner-key-0123456789-abcdef");
  updateDevDb(() => {}); resetRuntimeStore(); jar.clear();
});
afterEach(() => { vi.unstubAllEnvs(); resetRuntimeStore(); rmSync(dir, { recursive: true, force: true }); });
describe("signed owner authorization", () => {
  it("cookie is HTTP-only, available across routes and bound to exactly one request", async () => {
    const cookie = createOwnerCookie("rq_mine"); jar.set(cookie.name, cookie.value);
    expect(cookie.options).toMatchObject({ httpOnly: true, path: "/", sameSite: "lax" });
    expect(await hasOwnerAccess("rq_mine")).toBe(true);
    expect(await hasOwnerAccess("rq_other")).toBe(false);
    jar.set(ownerCookieName("rq_other"), cookie.value);
    expect(await hasOwnerAccess("rq_other")).toBe(false);
  });
  it("unsigned snapshot cookies and packet tokens do not establish ownership", async () => {
    jar.set("prn_journey", Buffer.from(JSON.stringify({ request_id: "rq_mine" })).toString("base64url"));
    expect(await hasOwnerAccess("rq_mine")).toBe(false);
    const packet = signLink({ scope: "packet", request_id: "rq_mine" });
    jar.set(ownerCookieName("rq_mine"), packet);
    expect(await hasOwnerAccess("rq_mine")).toBe(false);
    expect(await ownerAllowed("rq_mine", packet)).toBe(false);
  });
  it("revoked keep cookies stop opening and unavailable state grants nothing", async () => {
    const cookie = createOwnerCookie("rq_mine"); jar.set(cookie.name, cookie.value);
    const decoded = decodeLink(cookie.value); if (!decoded.ok) throw new Error("fixture decode");
    await revokeLink(decoded.link_id, decoded.request_id);
    expect(await hasOwnerAccess("rq_mine")).toBe(false);
    const second = createOwnerCookie("rq_mine"); jar.set(second.name, second.value);
    writeFileSync(process.env.PRN_DEV_DB_PATH!, "{broken fixture");
    expect(await hasOwnerAccess("rq_mine")).toBe(false);
    expect(await ownerAllowed("rq_mine", second.value)).toBe(false);
  });
});
