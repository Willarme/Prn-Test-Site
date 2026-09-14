import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from "vitest";
import { SAMPLE_PAGE_SPEC } from "@/domain/search/fixtures/sample-page-spec";
import { IntentPage, PageSpec } from "@/domain/search/pages";
import { findPublishedByPath } from "@/domain/search/page-store";
import { loadIssueLibrary, selectIssueLibrary, type IssueLibraryInput } from "@/platform/search/issue-library";
import { FIXED_DOORS, ISSUE_LIBRARY_FAMILIES, loadFixedDoors, readFixedDoor } from "@/platform/search/fixed-door-registry";
import { updateDevDb } from "@/platform/stores/dev-db";
import { resetRuntimeStore, unguardedRuntimeStore } from "@/platform/stores/runtime";
import { featureDefinition } from "@/platform/features/registry";
import { featureSnapshot } from "./helpers/feature-snapshot";
import ProblemsPage from "@/app/problems/page";
import CoolingPage from "@/app/cooling/page";
import { GET as acDoorGet } from "@/app/problems/ac-blowing-warm-air/route";

const spies = vi.hoisted(() => ({ snapshot: vi.fn(), state: vi.fn(), source: vi.fn() }));
vi.mock("@/platform/db/client", async original => ({ ...await original<typeof import("@/platform/db/client")>(), serviceConfigured: () => false, serviceClientProvider: () => null }));
vi.mock("@/platform/features/state", async original => ({ ...await original<typeof import("@/platform/features/state")>(), readFeatureSnapshot: spies.snapshot, featureState: spies.state }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); } }));
vi.mock("node:fs/promises", async original => {
  const actual = await original<typeof import("node:fs/promises")>();
  return { ...actual, readFile: spies.source.mockImplementation(actual.readFile) };
});
let actualRead: typeof readFile;
beforeAll(async () => {
  actualRead = (await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises")).readFile;
  const root = await mkdtemp(join(tmpdir(), "door-issue-library-"));
  vi.stubEnv("PRN_DEV_DB_PATH", join(root, "fixture.json"));
  resetRuntimeStore();
});
afterAll(() => { vi.unstubAllEnvs(); resetRuntimeStore(); });
beforeEach(() => {
  spies.snapshot.mockResolvedValue(featureSnapshot({ issue_library: "LIVE" })); spies.state.mockResolvedValue("LIVE");
  spies.source.mockImplementation(actualRead);
  updateDevDb(db => { db.intent_pages = []; db.staged_specs = []; db.published_page_ids = []; });
});
function fixture(suffix = "one") {
  const spec = PageSpec.parse({ ...structuredClone(SAMPLE_PAGE_SPEC), page_id: "fixture_" + suffix, page_spec_id: "fixture_" + suffix + "_v1",
    canonical_path: "/problems/ac-fixture-" + suffix, status: "QA_PASS", qa: { state: "PASS", reasons: [] },
    h1: "Unused alternative heading", hero: { headline: "The AC fixture " + suffix + " is noisy", subheadline: null },
    internal_links: [{ label: "Cooling", path: "/cooling/" }], tenant_id: "prn" });
  const page = IntentPage.parse({ page_id: spec.page_id, schema_version: "1.0.0", tenant_id: "prn", canonical_path: spec.canonical_path,
    current_page_spec_id: spec.page_spec_id, lifecycle_status: "PUBLISHED", published_at: "2026-09-13T00:00:00Z", retired_at: null,
    redirect_to_path: null, created_at: "2026-08-14T00:00:00Z" });
  return { spec, page };
}
function input(): IssueLibraryInput {
  const { spec, page } = fixture();
  return { corpus: { specs: [spec], pages: [page] }, published: new Set([spec.page_id]), fixed: [], snapshot: featureSnapshot(), seo_doors_enabled: true };
}
const links = (candidate: IssueLibraryInput) => selectIssueLibrary(candidate).flatMap(family => family.doors);

describe("Issue Library source candidate membership", () => {
  it("uses the actual current public renderer H1 and only a real family index", async () => {
    const candidate = input();
    expect(links(candidate)).toEqual([{ id: "fixture_one", path: "/problems/ac-fixture-one", label: "The AC fixture one is noisy", kind: "published_spec" }]);
    for (const family of ISSUE_LIBRARY_FAMILIES) expect(await actualRead(join(process.cwd(), "src/app", family.path, "page.tsx"), "utf8")).toContain("CoolingPage");
  });
  it.each(["unpublished", "staged", "retired", "redirect", "no-date", "missing-current", "bad-spec", "qa-fail", "critic-fail", "foreign-page", "foreign-spec", "missing-family-route", "hvac-without-cooling", "wrong-path", "duplicate-registry", "duplicate-spec", "feature-hidden", "flag-off"])("omits %s rather than inventing an eligible row", change => {
    const candidate = input(); const page = candidate.corpus.pages[0]; const spec = candidate.corpus.specs[0];
    if (change === "unpublished") candidate.published = new Set();
    if (change === "staged") page.lifecycle_status = "STAGED";
    if (change === "retired") page.retired_at = "2026-09-13T01:00:00Z";
    if (change === "redirect") page.redirect_to_path = "/start";
    if (change === "no-date") page.published_at = null;
    if (change === "missing-current") page.current_page_spec_id = "missing";
    if (change === "bad-spec") spec.title = "";
    if (change === "qa-fail") spec.qa.state = "FAIL";
    if (change === "critic-fail") spec.qa.ai_critic = { status: "FAIL", reason: "fixture", findings: [], provider: null, cost_usd: null, latency_ms: null };
    if (change === "foreign-page") page.tenant_id = "other";
    if (change === "foreign-spec") spec.tenant_id = "other";
    if (change === "missing-family-route") spec.problem_family = "plumbing";
    if (change === "hvac-without-cooling") spec.internal_links = [{ label: "Heating", path: "/heating" }];
    if (change === "wrong-path") { spec.canonical_path = "/no-hot-water"; page.canonical_path = spec.canonical_path; }
    if (change === "duplicate-registry") candidate.corpus.pages.push(structuredClone(page));
    if (change === "duplicate-spec") candidate.corpus.specs.push(structuredClone(spec));
    if (change === "feature-hidden") candidate.snapshot = featureSnapshot({ door_pages: "HIDDEN" });
    if (change === "flag-off") candidate.seo_doors_enabled = false;
    expect(links(candidate)).toEqual([]);
  });
  it.each(["newer", "tie", "newer-invalid", "newer-foreign"])("omits registry current v1 when actual route selects %s", change => {
    const candidate = input(); const next = structuredClone(candidate.corpus.specs[0]);
    next.page_spec_id = "fixture_one_v2"; next.version = change === "tie" ? 1 : 2;
    if (change === "newer-invalid") next.title = "";
    if (change === "newer-foreign") next.tenant_id = "other";
    candidate.corpus.specs.push(next);
    expect(links(candidate)).toEqual([]);
  });
  it("a real local publication-ID update adds/removes exactly one row without editing source", async () => {
    const { spec, page } = fixture();
    updateDevDb(db => { db.staged_specs = [spec]; db.intent_pages = [page]; });
    const store = unguardedRuntimeStore();
    const before = await loadIssueLibrary(featureSnapshot());
    await store.setPublished(spec, true);
    const after = await loadIssueLibrary(featureSnapshot());
    expect(after.families[0].doors.length).toBe(before.families[0].doors.length + 1);
    expect(after.families[0].doors.find(row => row.id === spec.page_id)?.label).toBe((await findPublishedByPath(spec.canonical_path))?.hero.headline);
    await store.setPublished(spec, false);
    expect(await loadIssueLibrary(featureSnapshot())).toEqual(before);
  });
  it("uses pinned real fixed-asset bytes through the same descriptor as the AC route", async () => {
    const fixed = await readFixedDoor(FIXED_DOORS[0].id);
    expect(fixed?.label).toBe("AC running but blowing warm air?");
    expect(fixed?.kind).toBe("fixed_asset");
    expect(await loadFixedDoors()).toHaveLength(1);
    const response = await acDoorGet(new Request("https://fixture.example/problems/ac-blowing-warm-air"));
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("<h1>AC running but blowing <em>warm air?</em></h1>");
    expect(html).toContain('noindex');
  });
  it.each(["missing", "changed"])("fixed asset %s is omitted and actual route returns404", async change => {
    spies.source.mockImplementation(async () => { if (change === "missing") throw new Error("fixture absent"); return "<h1>Unreviewed replacement</h1>"; });
    expect(await readFixedDoor(FIXED_DOORS[0].id)).toBeNull();
    expect(await loadFixedDoors()).toEqual([]);
    expect((await acDoorGet(new Request("https://fixture.example/problems/ac-blowing-warm-air"))).status).toBe(404);
  });
  it("never lets a generated registry row shadow the separately served AC asset", () => {
    const candidate = input();
    candidate.corpus.specs[0].canonical_path = FIXED_DOORS[0].canonical_path;
    candidate.corpus.pages[0].canonical_path = FIXED_DOORS[0].canonical_path;
    expect(links(candidate)).toEqual([]);
  });
  it("retains only the verified fixed asset when the real registry reader rejects damaged data", async () => {
    const { spec, page } = fixture();
    updateDevDb(db => { db.staged_specs = [spec]; db.published_page_ids = [spec.page_id];
      db.intent_pages = [{ ...page, current_page_spec_id: 123 } as unknown as IntentPage]; });
    const result = await loadIssueLibrary(featureSnapshot());
    expect(result.registry_available).toBe(false);
    expect(result.families.flatMap(family => family.doors).map(door => door.kind)).toEqual(["fixed_asset"]);
  });
});

describe("guarded native directory components", () => {
  it("keeps source registry activation unchanged and refuses the default hidden Issue Library", async () => {
    expect(featureDefinition("issue_library")?.launch_state).toBe("HIDDEN");
    expect(featureDefinition("issue_library")?.launch_word).toBe("TO BUILD");
    spies.snapshot.mockResolvedValue(featureSnapshot());
    await expect(ProblemsPage()).rejects.toThrow("NOT_FOUND");
  });
  it("shows the baseline, family index and direct root intake only when their real gates allow", async () => {
    const html = renderToStaticMarkup(await ProblemsPage());
    expect(html).toContain('href="/cooling"');
    expect(html).toContain('href="/problems/ac-blowing-warm-air"');
    expect(html).toContain("AC running but blowing warm air?");
    expect(html).toContain('href="/#intake"');
    expect(html).not.toContain("coming soon");
  });
  it.each(["intake", "explainers"])("omits the form link with %s hidden", async feature => {
    spies.snapshot.mockResolvedValue(featureSnapshot({ issue_library: "LIVE", [feature]: "HIDDEN" }));
    expect(renderToStaticMarkup(await ProblemsPage())).not.toContain('href="/#intake"');
    expect(renderToStaticMarkup(await CoolingPage())).not.toContain('href="/#intake"');
  });
  it("Cooling obeys door_pages directly and never advertises a hidden Issue Library", async () => {
    spies.snapshot.mockResolvedValue(featureSnapshot());
    expect(renderToStaticMarkup(await CoolingPage())).not.toContain('href="/problems"');
    spies.snapshot.mockResolvedValue(featureSnapshot({ door_pages: "HIDDEN" }));
    await expect(CoolingPage()).rejects.toThrow("NOT_FOUND");
    spies.state.mockResolvedValue("HIDDEN");
    expect((await acDoorGet(new Request("https://fixture.example/problems/ac-blowing-warm-air"))).status).toBe(404);
  });
  it("renders a truthful empty state when the enabled library has no available doors", async () => {
    spies.snapshot.mockResolvedValue(featureSnapshot({ issue_library: "LIVE", door_pages: "HIDDEN", intake: "HIDDEN" }));
    const html = renderToStaticMarkup(await ProblemsPage());
    expect(html).toContain("No problem pages are listed right now.");
    expect(html).not.toContain('href="/cooling"');
    expect(html).not.toContain('href="/#intake"');
  });
});
