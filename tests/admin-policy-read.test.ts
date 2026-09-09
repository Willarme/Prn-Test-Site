import { beforeEach, expect, it, vi } from "vitest";
const { unlocked, read } = vi.hoisted(() => ({ unlocked: vi.fn(), read: vi.fn() }));
vi.mock("@/platform/admin/auth", () => ({ isAdminUnlocked: unlocked }));
vi.mock("@/platform/admin/data", () => ({ policyStore: () => ({ getActive: read }) }));
import { GET } from "@/app/api/admin/policy/route";
beforeEach(() => { vi.clearAllMocks(); });
it("refuses anonymous policy reads before touching the store", async () => {
  unlocked.mockResolvedValue(false);
  const response = await GET();
  expect(response.status).toBe(403);
  expect(read).not.toHaveBeenCalled();
});
it("allows an authenticated owner to read the active policy", async () => {
  unlocked.mockResolvedValue(true); read.mockResolvedValue({ version: 17 });
  const response = await GET();
  expect(response.status).toBe(200); expect(await response.json()).toEqual({ version: 17 });
});
