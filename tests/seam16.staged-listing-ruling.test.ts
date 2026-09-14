import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Home from "@/app/page";
import { PageSpec } from "@/domain/search/pages";
import { SAMPLE_PAGE_SPEC } from "@/domain/search/fixtures/sample-page-spec";
import { DEFAULT_FLAGS, flagEnabled } from "@/platform/flags";
import { readFeatureSnapshot } from "@/platform/features/state";
import { featureSnapshot } from "./helpers/feature-snapshot";

/**
 * SEAM-16's original hide ruling is superseded by T6-29:R1 retirement.
 * Render the real async homepage: the old flag cannot restore its navigator,
 * while persisted intake state still controls the native customer intake.
 * Actual stored specifications remain history; rendering must not erase them.
 */
let legacyFlagOn = false;
let snapshot = featureSnapshot({ intake: "LIVE" });
vi.mock("@/platform/features/state", async importOriginal => ({
  ...await importOriginal<typeof import("@/platform/features/state")>(),
  readFeatureSnapshot: vi.fn(async () => snapshot),
}));
vi.mock("@/platform/flags", async importOriginal => {
  const actual = await importOriginal<typeof import("@/platform/flags")>();
  return { ...actual, flagEnabled: (key: string) =>
    key === "staged_listing_public" && legacyFlagOn ? true : actual.flagEnabled(key) };
});

const stagedPath = join(process.cwd(), "data/factory/staged-specs.json");
const storedBytes = readFileSync(stagedPath, "utf8");
const stored = JSON.parse(storedBytes) as { specs: unknown[] };
const portfolio = [SAMPLE_PAGE_SPEC, ...stored.specs.map(spec => PageSpec.parse(spec))];

async function renderHomepage(): Promise<string> {
  return renderToStaticMarkup(await Home({}));
}

function expectMeaningfulPage(html: string): void {
  expect(html.length).toBeGreaterThan(1_000);
  expect(html).toContain("Something happened in your home.");
  expect(html).toContain("Plain words are enough");
  expect(html).toContain("One Job Packet");
}

function expectNoStagedNavigator(html: string): void {
  expect(html).not.toMatch(/Staged door pages|pending QA|class="pill|href="\/staged\//i);
  for (const spec of portfolio) {
    const slug = spec.canonical_path.replace(/^\/problems\//, "");
    expect(html, `staged slug ${slug} leaked`).not.toContain(slug);
    expect(html, `staged path ${spec.canonical_path} leaked`).not.toContain(spec.canonical_path);
    expect(html, `staged headline ${spec.h1} leaked`).not.toContain(spec.h1);
  }
  for (const state of ["PASS", "FAIL", "PENDING"]) {
    expect(html, `QA state ${state} rendered publicly`).not.toContain(state);
  }
}

beforeEach(() => {
  legacyFlagOn = false;
  snapshot = featureSnapshot({ intake: "LIVE" });
  vi.clearAllMocks();
});

describe("retired staged homepage navigator", () => {
  it("retains the original OFF decision and a nonempty stored history", () => {
    const flag = DEFAULT_FLAGS.find(item => item.flag_key === "staged_listing_public")!;
    expect(flagEnabled("staged_listing_public")).toBe(false);
    expect(flag.enabled).toBe(false);
    expect(flag.decision_ref).toBeTruthy();
    expect(stored.specs.length).toBeGreaterThan(0);
    expect(portfolio.every(spec => spec.qa.state.length > 0)).toBe(true);
  });

  it.each([false, true])("renders the customer page without staged content when legacy flag is %s", async flagOn => {
    legacyFlagOn = flagOn;
    expect(flagEnabled("staged_listing_public")).toBe(flagOn);
    const html = await renderHomepage();
    expectMeaningfulPage(html);
    expect(html).toContain('action="/api/intake/start"');
    expect(html).toContain('method="post"');
    expect(html).not.toContain('href="/start"');
    expect(readFeatureSnapshot).toHaveBeenCalledOnce();
    expectNoStagedNavigator(html);
    expect(readFileSync(stagedPath, "utf8")).toBe(storedBytes);
  });

  it("cannot restore the retired navigator by turning the old flag ON", async () => {
    const off = await renderHomepage();
    legacyFlagOn = true;
    const on = await renderHomepage();
    expectMeaningfulPage(on);
    expect(on).toBe(off);
    expectNoStagedNavigator(on);
    expect(readFileSync(stagedPath, "utf8")).toBe(storedBytes);
  });

  it("removes native intake when HIDDEN while preserving meaningful homepage content and history", async () => {
    snapshot = featureSnapshot({ intake: "HIDDEN" });
    legacyFlagOn = true;
    const html = await renderHomepage();
    expectMeaningfulPage(html);
    expect(html).not.toContain('href="/start"');
    expect(html).not.toContain('action="/api/intake/start"');
    expect(html).not.toContain('class="btn btn-pink"');
    expect(readFeatureSnapshot).toHaveBeenCalledOnce();
    expectNoStagedNavigator(html);
    expect(readFileSync(stagedPath, "utf8")).toBe(storedBytes);
  });
});
