import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DoorCreatorDetail, DoorCreatorOverview, DoorTemplateKitView } from "@/platform/admin/door-creator-types";

const reads = vi.hoisted(() => ({ gate: vi.fn(), overview: vi.fn(), detail: vi.fn(), kit: vi.fn() }));
vi.mock("@/components/admin/AdminGate", () => ({ adminGate: reads.gate }));
vi.mock("@/platform/admin/door-creator", () => ({ loadDoorCreatorOverview: reads.overview, loadDoorCreatorDetail: reads.detail, loadDoorTemplateKitView: reads.kit }));
import Overview from "@/app/admin/page-creator/page";
import Detail from "@/app/admin/page-creator/[page_id]/page";
import Templates from "@/app/admin/templates/page";

const page = { page_id: "fixture-page", canonical_intent_id: "fixture.intent", canonical_path: "/problems/fixture-page", latest_version: 3 };
const summary = (version: number) => ({ page_version: version, registered_at: "2026-09-13T10:00:00Z", artifact_hash: String(version).repeat(64), mode: "fixture" as const });
function detail(): DoorCreatorDetail {
  return { status: "ready", page, versions: [summary(2), summary(1)], selected: { ...summary(2), receipt_sha256: "a".repeat(64), reservation_id: "b".repeat(64),
    provenance_status: "unattested", preview_href: "/admin/fixture-exact-preview/2", pending_checks: ["responsive", "hosted_runtime"], source_ids: ["fixture.source"], claim_ids: ["fixture.claim"] },
    input: { status: "saved", input_sha256: "c".repeat(64), assignments: [{ label: "Template", value: "door-v44.0.0" }, { label: "Schema", value: "doorspec/2.0.0" }], models: [], model_status: "not_recorded" },
    evidence: { status: "ready", rows: [{ kind: "independent_critic", verdict: "PASS", receipt_sha256: "d".repeat(64), finished_at: "2026-09-13T11:00:00Z", expires_at: "2026-09-14T11:00:00Z",
      time_status: "current", trust_scope: "reviewed_repository", producer_id: "fixture.producer", run_id: "fixture.run", findings: [], model_id: null, cost_usd: null }] },
    serving: { status: "ready", guard_status: "current", page_version: 1, as_of: "2026-09-13T12:00:00Z" } };
}
function kit(): DoorTemplateKitView {
  return { baseline: "ac-v43", template_version: "door-v44.0.0", schema_version: "doorspec/2.0.0", order_profile: "fixture-order",
    order: ["hero", "intake", "stats", "closer"], constants: [{ key: "hero_answer", value: "The short answer" }, { key: "intake_start", value: "Start here" }, { key: "hero_home", value: "Home" }],
    mutability: [{ class: "immutable", count: 3, description: "Fixed source furniture" }], documents: [{ id: "fixture.contract", label: "Compatibility contract", href: "/api/admin/fixture-contract", sha256: "e".repeat(64) }],
    theme_slots: Array.from({ length: 10 }, (_, i) => ({ id: `theme_${i + 1}`, status: "not_registered" })) };
}
const renderDetail = async (version?: string | string[]) => renderToStaticMarkup(await Detail({ params: Promise.resolve({ page_id: page.page_id }), searchParams: Promise.resolve(version === undefined ? {} : { version }) }));
beforeEach(() => {
  vi.resetAllMocks(); reads.gate.mockResolvedValue(null);
  reads.overview.mockResolvedValue({ status: "ready", pages: [page] } satisfies DoorCreatorOverview);
  reads.detail.mockResolvedValue(detail()); reads.kit.mockResolvedValue(kit());
});

describe("authenticated Page Creator review screens", () => {
  it("gates every screen before route promises or protected loaders", async () => {
    reads.gate.mockResolvedValue(createElement("p", null, "Owner sign-in required"));
    const params = { get then() { throw new Error("Private route params accessed"); } } as unknown as Promise<{ page_id: string }>;
    const searchParams = { get then() { throw new Error("Private query accessed"); } } as unknown as Promise<Record<string, string>>;
    expect(renderToStaticMarkup(await Overview({ searchParams }))).toContain("Owner sign-in required");
    expect(renderToStaticMarkup(await Detail({ params, searchParams }))).toContain("Owner sign-in required");
    expect(renderToStaticMarkup(await Templates())).toContain("Owner sign-in required");
    expect(reads.overview).not.toHaveBeenCalled(); expect(reads.detail).not.toHaveBeenCalled(); expect(reads.kit).not.toHaveBeenCalled();
  });
  it("connects saved identities to review without suggesting the latest reservation is built", async () => {
    const html = renderToStaticMarkup(await Overview({}));
    expect(html).toContain('href="/admin/page-creator/fixture-page"'); expect(html).toContain('href="/admin/templates"');
    expect(html).toContain("Latest reserved version"); expect(html).toContain("Version 3"); expect(html).toContain("1 saved page identities");
    expect(html).not.toContain("/api/admin/pages/generate"); expect(html).not.toContain("/api/admin/pages/publish");
  });
  it.each(["status", "throw"])("distinguishes unavailable catalogue (%s) from a real empty reading", async failure => {
    if (failure === "status") reads.overview.mockResolvedValue({ status: "unavailable", pages: [] }); else reads.overview.mockRejectedValue(new Error("private-path-secret"));
    const html = renderToStaticMarkup(await Overview({}));
    expect(html).toContain("The page catalogue could not be read"); expect(html).not.toContain("No saved page identities"); expect(html).not.toContain("private-path-secret"); expect(html).not.toContain("0 saved page identities");
  });
  it("shows a real empty catalogue without invented fixture rows", async () => {
    reads.overview.mockResolvedValue({ status: "ready", pages: [] });
    const html = renderToStaticMarkup(await Overview({})); expect(html).toContain("No saved page identities"); expect(html).not.toContain("fixture-page");
  });
  it("labels default latest built version and current serving separately", async () => {
    const html = await renderDetail();
    expect(reads.detail).toHaveBeenCalledWith("fixture-page", undefined);
    expect(html).toContain("Default view: latest built version"); expect(html).toContain("Reviewing version 2");
    expect(html).toMatch(/id="current-serving"[\s\S]*?Version 1/); expect(html).toContain("Latest reservation");
    expect(html).toContain('href="/admin/page-creator/fixture-page?version=1"');
  });
  it("passes the exact version and uses only the supplied preview URL", async () => {
    const record = detail(); record.selected = { ...record.selected!, ...summary(1), preview_href: "/private/exact-immutable-preview" }; reads.detail.mockResolvedValue(record);
    const html = await renderDetail("1"); expect(reads.detail).toHaveBeenCalledWith("fixture-page", "1");
    expect(html).toContain("Exact requested version"); expect(html).toContain('href="/private/exact-immutable-preview"');
    expect(html).not.toContain("staged-template"); expect(html).not.toContain("Default view: latest built version");
    expect(html).toContain("Private draft preview"); expect(html).toContain("Content review only; styling and interactive walkthrough acceptance are still pending.");
  });
  it("does not interpret repeated version parameters as default latest", async () => {
    reads.detail.mockResolvedValue({ ...detail(), status: "not_found", selected: null });
    expect(await renderDetail(["1", "2"])).toContain("Page or version not found");
    expect(reads.detail).toHaveBeenCalledWith("fixture-page", "invalid-repeated-version");
  });
  it.each(["not_found", "unavailable"] as const)("shows %s without replacing the requested version", async status => {
    reads.detail.mockResolvedValue({ ...detail(), status }); const html = await renderDetail("99");
    expect(html).toContain(status === "not_found" ? "Page or version not found" : "Page records unavailable");
    expect(html).not.toContain("Reviewing version 2"); expect(html).not.toContain("fixture-exact-preview");
  });
  it("keeps a reserved-only identity distinct from a built candidate", async () => {
    reads.detail.mockResolvedValue({ ...detail(), selected: null, versions: [] }); const html = await renderDetail();
    expect(html).toContain("No built version selected"); expect(html).toContain("A reservation alone does not contain a compiled page"); expect(html).not.toContain("Private draft preview");
  });
  it("does not invent model provenance or zero cost from absent evidence values", async () => {
    const html = await renderDetail(); expect(html).toContain("Model provenance was not recorded"); expect(html).toContain("Cost not recorded"); expect(html).not.toContain("USD 0");
    expect(html).toContain("Recorded PASS"); expect(html).toContain("not a current QA approval"); expect(html).toContain("Time-window labels describe dates only");
    expect(html).toContain("Within recorded time window");
  });
  it("shows recorded model, cost, expiry and findings without assigning a current approval", async () => {
    const record = detail(); record.input.model_status = "recorded"; record.input.models = [{ capability: "write_page", provider: "fixture-provider", model_id: "fixture-writer", run_id: "writer-run" }];
    Object.assign(record.evidence.rows[0], { cost_usd: "0.023", model_id: "fixture-critic", time_status: "expired", findings: [{ severity: "review", code: "CHECK_WORDING", pointer: "/hero" }] });
    reads.detail.mockResolvedValue(record); const html = await renderDetail();
    for (const value of ["fixture-writer", "fixture-critic", "USD 0.023", "Recorded time window expired", "CHECK_WORDING", "/hero"]) expect(html).toContain(value);
    expect(html).toContain("<details"); expect(html).not.toContain("Approved for publication");
  });
  it("separates missing inputs, unavailable evidence and unknown serving state", async () => {
    const record = detail(); record.input = { status: "missing", input_sha256: null, assignments: [], models: [], model_status: "unavailable" };
    record.evidence = { status: "unavailable", rows: [] }; record.serving.status = "unavailable"; reads.detail.mockResolvedValue(record);
    const html = await renderDetail(); expect(html).toContain("No saved input record was found"); expect(html).toContain("Evidence could not be read"); expect(html).toContain("current served version is unverified");
    expect(html).not.toContain("No evidence receipts are recorded"); expect(html).not.toContain("No version selected");
  });
  it("does not turn an ineligible serving result into a claim that no selection is stored", async () => {
    const record = detail(); record.serving = { status: "ready", guard_status: "stale", page_version: null, as_of: "2026-09-13T12:00:00Z" }; reads.detail.mockResolvedValue(record);
    const html = await renderDetail(); expect(html).toContain("No version currently eligible to serve"); expect(html).not.toContain("No version selected"); expect(html).toContain("Serving guard: stale");
    expect(html).toContain("Version details come from the saved catalogue");
  });
  it("has disabled actions with nearby specific descriptions, without posting to legacy APIs", async () => {
    const html = await renderDetail(), buttons = html.match(/<button\b[^>]*>/g) ?? [];
    expect(buttons).toHaveLength(8);
    for (const button of buttons) { expect(button).toContain('disabled=""'); const id = /aria-describedby="([^"]+)"/.exec(button)?.[1]; expect(id).toBeTruthy(); expect(html).toContain(`id="${id}"`); }
    expect(html).toContain("durable generation runner"); expect(html).toContain("explicit owner review"); expect(html).toContain("verified serving authority"); expect(html).not.toContain("/api/admin/pages/");
    expect(html).toContain('<details class="adm-door-action-panel"><summary>Unavailable actions (8)</summary>');
  });
  it("escapes saved labels and exposes no link when preview is unavailable", async () => {
    const record = detail(); record.page = { ...page, page_id: '<script>alert("x")</script>' }; record.selected!.preview_href = null; reads.detail.mockResolvedValue(record);
    const html = await renderDetail(); expect(html).not.toContain("<script>"); expect(html).toContain("&lt;script&gt;"); expect(html).toContain("A verified draft preview is unavailable");
  });
});

describe("versioned template inspection", () => {
  it("renders the real checked-in kit through the current loader contract", async () => {
    const actual = await vi.importActual<typeof import("@/platform/admin/door-creator")>("@/platform/admin/door-creator");
    const source = await actual.loadDoorTemplateKitView(); reads.kit.mockResolvedValue(source);
    const html = renderToStaticMarkup(await Templates()); expect(html).toContain(source.template_version); expect(html).toContain(source.schema_version);
    expect(html.match(/>Not registered</g)).toHaveLength(10); expect(html).toContain("SHA-256:"); expect(html).not.toContain("The template kit could not be verified");
  });
  it("shows source identities, exact order, grouped constants and document links", async () => {
    const html = renderToStaticMarkup(await Templates());
    for (const value of ["ac-v43", "door-v44.0.0", "doorspec/2.0.0", "hero · 2 strings", "The short answer", "immutable · 3 entries"]) expect(html).toContain(value);
    expect(html).toMatch(/<ol[^>]*><li>hero<\/li><li>intake<\/li><li>stats<\/li><li>closer<\/li>/);
    expect(html).toContain('href="/api/admin/fixture-contract"'); expect(html).toContain('download=""'); expect(html).toContain("conditional and source-only strings");
  });
  it("shows ten unregistered slots instead of ten approved themes", async () => {
    const html = renderToStaticMarkup(await Templates()); expect(html.match(/>Not registered</g)).toHaveLength(10);
    expect(html).toContain("not registered themes"); expect(html).not.toContain("10 approved themes");
    const buttons = html.match(/<button\b[^>]*>/g) ?? []; expect(buttons).toHaveLength(2); buttons.forEach(button => expect(button).toContain('disabled=""'));
  });
  it("does not replace missing contracts with a synthetic kit", async () => {
    reads.kit.mockRejectedValue(new Error("private-source-path")); const html = renderToStaticMarkup(await Templates());
    expect(html).toContain("The template kit could not be verified"); expect(html).not.toContain("ac-v43"); expect(html).not.toContain("private-source-path");
  });
});
