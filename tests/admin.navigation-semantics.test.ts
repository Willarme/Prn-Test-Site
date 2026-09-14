import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ pathname: "/admin" }));
vi.mock("next/navigation", () => ({ usePathname: () => state.pathname, useRouter: () => ({ refresh: vi.fn() }) }));

import { AdminNav } from "../src/components/admin/AdminNav";
import { AdminShell } from "../src/components/admin/AdminShell";
import { LoginForm } from "../src/components/admin/LoginForm";

afterEach(() => { state.pathname = "/admin"; });

describe("admin navigation and access presentation", () => {
  it("keeps Pages selected within a nested editor without selecting Cockpit", () => {
    state.pathname = "/admin/pages/example-spec";
    const html = renderToStaticMarkup(createElement(AdminNav));
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toMatch(/<a[^>]*aria-current="page"[^>]*href="\/admin\/pages"/);
  });

  it("does not mistake a similarly prefixed route for the Pages section", () => {
    state.pathname = "/admin/pages-other";
    expect(renderToStaticMarkup(createElement(AdminNav))).not.toContain('aria-current="page"');
  });

  it("connects Page Creator and Templates and keeps an exact version within Page Creator", () => {
    state.pathname = "/admin/page-creator/saved-page";
    const html = renderToStaticMarkup(createElement(AdminNav));
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toMatch(/<a[^>]*aria-current="page"[^>]*href="\/admin\/page-creator"/);
    expect(html).toContain('href="/admin/templates"');
    state.pathname = "/admin/templates";
    expect(renderToStaticMarkup(createElement(AdminNav))).toMatch(/<a[^>]*aria-current="page"[^>]*href="\/admin\/templates"/);
  });

  it("offers a keyboard form and a labeled password with normal submit semantics", () => {
    const html = renderToStaticMarkup(createElement(LoginForm));
    expect(html).toMatch(/<form\b/);
    expect(html).toContain('method="post"');
    expect(html).toContain('action="/api/admin/login"');
    expect(html).toContain('for="admin-password"');
    expect(html).toContain('type="password"');
    expect(html).toContain('autoComplete="current-password"');
    expect(html).toContain('type="submit"');
  });

  it("keeps navigation out of a locked shell and provides one workspace landmark", () => {
    const html = renderToStaticMarkup(createElement(AdminShell, { unlocked: false, storageKind: "file", children: createElement("p", null, "Sign in") }));
    expect(html).not.toContain('href="/admin/requests"');
    expect(html).toContain('href="#admin-content"');
    expect(html.match(/<main\b/g)).toHaveLength(1);
  });

  it("does not nest a second Company OS inside the editor preview", () => {
    state.pathname = "/admin/pages/example-spec/preview";
    const html = renderToStaticMarkup(createElement(AdminShell, { unlocked: true, storageKind: "file", children: createElement("article", null, "Approved artwork") }));
    expect(html).toContain("Approved artwork");
    expect(html).not.toContain('aria-label="Company OS sections"');
    expect(html).not.toContain('id="admin-content"');
  });
});
