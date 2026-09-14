import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const reads = vi.hoisted(() => ({ mode: vi.fn(), store: vi.fn() }));
vi.mock("@/platform/admin/auth", () => ({ adminMode: reads.mode }));
vi.mock("@/platform/stores/runtime", () => ({ runtimeStore: reads.store }));
vi.mock("next/navigation", () => ({ usePathname: () => "/admin", useRouter: () => ({ refresh: vi.fn() }) }));
import AdminLayout from "../src/app/admin/layout";

beforeEach(() => { vi.resetAllMocks(); });

describe("admin shell storage resilience", () => {
  it("does not construct the data adapter for a locked sign-in shell", async () => {
    reads.mode.mockResolvedValue("locked");
    reads.store.mockImplementation(() => { throw new Error("invalid database URL"); });
    const html = renderToStaticMarkup(await AdminLayout({ children: createElement("p", null, "Sign in form") }));
    expect(html).toContain("Sign in form");
    expect(reads.store).not.toHaveBeenCalled();
  });

  it("keeps an unlocked shell navigable without falsely claiming a file fallback", async () => {
    reads.mode.mockResolvedValue("unlocked");
    reads.store.mockImplementation(() => { throw new Error("invalid database URL"); });
    const html = renderToStaticMarkup(await AdminLayout({ children: createElement("p", null, "Page observation") }));
    expect(html).toContain("Page observation");
    expect(html).toContain("Storage unavailable");
    expect(html).toContain('href="/admin/connections"');
    expect(html).not.toContain("Local file storage");
    expect(html).not.toContain("Database configured");
  });
});
