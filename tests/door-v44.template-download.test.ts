import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, HEAD, POST } from "@/app/api/admin/template-kit/[document]/route";
const seams = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/platform/admin/auth", () => ({ isAdminUnlocked: seams.auth }));
const context = (document: string) => ({ params: Promise.resolve({ document }) });
const request = (method = "GET") => new Request("https://admin.example/api/admin/template-kit/constants", { method });
beforeEach(() => { vi.clearAllMocks(); seams.auth.mockResolvedValue(true); });
describe("authenticated template documents", () => {
  it("authenticates before reading a requested document", async () => {
    seams.auth.mockResolvedValue(false);
    let reads = 0;
    const input = { get params(): Promise<{ document: string }> { reads++; throw new Error("PRIVATE"); } };
    const response = await GET(request(), input);
    expect(response.status).toBe(403); expect(reads).toBe(0); expect(await response.json()).toEqual({ error: "Owner sign-in required" });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  });
  it("returns named source, private headers and a body hash", async () => {
    const response = await GET(request(), context("constants"));
    expect(response.status).toBe(200); expect(response.headers.get("x-content-sha256")).toMatch(/^[a-f0-9]{64}$/);
    expect(response.headers.get("content-disposition")).toContain("door-template-constants.json");
    expect(await response.json()).toHaveProperty("baseline_id", "ac-v43");
  });
  it("HEAD has the same representation headers and no body", async () => {
    const get = await GET(request(), context("constants")), head = await HEAD(request("HEAD"), context("constants"));
    expect([...head.headers]).toEqual([...get.headers]); expect(await head.text()).toBe("");
    seams.auth.mockResolvedValue(false);
    const denied = await HEAD(request("HEAD"), context("constants"));
    expect(denied.status).toBe(403); expect(await denied.text()).toBe("");
  });
  it("unsupported methods cannot write or resolve document params", async () => {
    let reads = 0;
    const input = { get params(): Promise<{ document: string }> { reads++; throw new Error("PRIVATE"); } };
    const denied = await POST(request("POST"), input);
    expect(denied.status).toBe(405); expect(denied.headers.get("allow")).toBe("GET, HEAD"); expect(reads).toBe(0);
  });
  it("unknown/path-like documents return bounded 404 and auth failures stay private", async () => {
    const response = await GET(request(), context("../../.env")); expect(response.status).toBe(404); expect(await response.text()).toBe("Document not found");
    seams.auth.mockRejectedValue(new Error("PRIVATE BACKEND DETAIL"));
    const failed = await GET(request(), context("constants")); expect(failed.status).toBe(503); expect(await failed.text()).not.toContain("PRIVATE");
  });
});
