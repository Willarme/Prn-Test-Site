import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { allStagedSpecs } from "@/platform/admin/data";
import { DEFAULT_FLAGS, flagEnabled } from "@/platform/flags";

/**
 * SEAM-16 — JOSH'S RULING, PROVED BY RENDERING THE PAGE.
 *
 * Coherence report issue 16 asked whether the public, unauthenticated homepage
 * should keep listing every staged door page with its QA-state pill. Josh ruled
 * on 2026-08-25: hide it. Those pages are not for the public yet, and A06's QA
 * verdicts are internal business — especially with a live demo coming.
 *
 * WHY THIS FILE RENDERS INSTEAD OF READING. Every existing guard on this
 * surface is a SOURCE SCAN: tests/a06.public-exposure.test.ts greps
 * src/app/page.tsx for forbidden field accesses, and the eval row reads the
 * file for an `isAdminUnlocked(` call. A source scan cannot tell the difference
 * between "the listing is gone" and "the listing is still emitted but the
 * grep pattern moved". So this file calls the real `Home()` server component,
 * renders the element tree it returns to HTML with `react-dom/server`, and
 * asserts on the BYTES A VISITOR WOULD RECEIVE.
 *
 * BOTH DIRECTIONS, because half a proof is not one. Off: the rendered HTML
 * carries no listing, no slug, no pill. On: the same component, same fixtures,
 * same render path, with ONLY `flagEnabled("staged_listing_public")` mocked
 * true — and every slug and pill comes back. That second case is what makes
 * the first case meaningful: it proves the HTML is empty of staged pages
 * BECAUSE OF THE FLAG, and not because the fixtures were empty or the render
 * quietly failed.
 */

/** Render the real homepage server component to the HTML a visitor receives. */
async function renderHomepage(): Promise<string> {
  const { default: Home } = await import("@/app/page");
  return renderToStaticMarkup(await Home());
}

/** The same render, with the one flag forced ON and nothing else changed. */
async function renderHomepageWithFlagOn(): Promise<string> {
  vi.resetModules();
  vi.doMock("@/platform/flags", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@/platform/flags")>();
    return {
      ...actual,
      flagEnabled: (key: string) =>
        key === "staged_listing_public" ? true : actual.flagEnabled(key),
    };
  });
  try {
    return await renderHomepage();
  } finally {
    vi.doUnmock("@/platform/flags");
    vi.resetModules();
  }
}

/** `/problems/ac-not-turning-on` -> `ac-not-turning-on`, the slug in the href. */
function slugOf(canonicalPath: string): string {
  return canonicalPath.replace(/^\/problems\//, "");
}

afterEach(() => {
  vi.resetModules();
});

describe("the ruling is recorded where the switch is", () => {
  it("the flag is OFF and still carries its decision ref", () => {
    expect(flagEnabled("staged_listing_public")).toBe(false);
    const flag = DEFAULT_FLAGS.find((f) => f.flag_key === "staged_listing_public")!;
    expect(flag.enabled).toBe(false);
    expect(flag.decision_ref).not.toBeNull();
  });

  it("the fixtures this test reasons about are really there — the OFF case is not vacuous", async () => {
    const staged = await allStagedSpecs();
    expect(staged.length).toBeGreaterThan(0);
    // If this ever fails, the "no slug appears" assertions below would be
    // trivially true and would prove nothing.
    expect(staged.some((s) => s.qa.state.length > 0)).toBe(true);
  });
});

describe("FLAG OFF — the rendered public homepage carries no staged page", () => {
  it("renders a real page, so the absence below is an absence and not a blank render", async () => {
    const html = await renderHomepage();
    expect(html.length).toBeGreaterThan(1_000);
    // The page still works: hero, the intake call to action, the admin link.
    expect(html).toMatch(/Something happened in your home/);
    expect(html).toMatch(/href="\/start"/);
  });

  it("emits no staged listing section at all", async () => {
    const html = await renderHomepage();
    expect(html).not.toMatch(/Staged door pages/);
    expect(html).not.toMatch(/pending QA/i);
  });

  it("emits NO SLUG — not one staged page's path or headline reaches the HTML", async () => {
    const html = await renderHomepage();
    const staged = await allStagedSpecs();
    for (const spec of staged) {
      expect(html, `slug ${slugOf(spec.canonical_path)} leaked`).not.toContain(
        slugOf(spec.canonical_path)
      );
      expect(html, `canonical path ${spec.canonical_path} leaked`).not.toContain(
        spec.canonical_path
      );
      expect(html, `h1 "${spec.h1}" leaked`).not.toContain(spec.h1);
    }
    expect(html).not.toMatch(/href="\/staged\//);
  });

  it("emits NO QA PILL — no state word and no pill markup anywhere on the page", async () => {
    const html = await renderHomepage();
    expect(html).not.toMatch(/class="pill/);
    for (const state of ["PASS", "FAIL", "PENDING"]) {
      expect(html, `QA state ${state} rendered publicly`).not.toContain(state);
    }
  });
});

describe("FLAG ON — the same render puts every one of them back", () => {
  it("brings back the section, the slugs and the pills", async () => {
    const html = await renderHomepageWithFlagOn();
    const staged = await allStagedSpecs();

    expect(html).toMatch(/Staged door pages/);
    expect(html).toMatch(/href="\/staged\//);
    expect(html).toMatch(/class="pill/);
    for (const spec of staged) {
      expect(html).toContain(`href="/staged/${slugOf(spec.canonical_path)}"`);
      expect(html).toContain(spec.qa.state);
    }
  });

  it("so the flag — not an empty fixture set — is what the OFF case proved", async () => {
    const on = await renderHomepageWithFlagOn();
    const off = await renderHomepage();
    expect(on.length).toBeGreaterThan(off.length);
    const staged = await allStagedSpecs();
    for (const spec of staged) {
      expect(on).toContain(slugOf(spec.canonical_path));
      expect(off).not.toContain(slugOf(spec.canonical_path));
    }
  });
});
