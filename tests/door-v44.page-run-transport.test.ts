import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { DoorRunCreateRequest, DoorRunView } from "../src/platform/admin/door-page-run-types";
import { advanceDoorRun, doorRunCreation, doorRunTransport, resumeDoorRun } from "../src/components/admin/door-page-run-transport";
import { DoorPageRuns, DoorRunResults } from "../src/components/admin/DoorPageRuns";

const key = "31a961c2-4158-4d46-9a38-fdf575276dbc";
const id = `run-${key}`;
const hash = "a".repeat(64);
const request: DoorRunCreateRequest = { mode: "fixture", dry_run: true, opportunity_ids: ["F01", "F04"], count: 2, reason: "Check controlled fixture results" };
function run(revision = 1): DoorRunView {
  return { run_id: id, revision, mode: "fixture", dry_run: true, status: "PENDING", created_at: "2026-09-13T00:00:00.000Z", updated_at: "2026-09-13T00:00:00.000Z", resumable: true, retry_after: null, package_sha256: hash, executor_version: "fixture-v1", terminal_count: 0, model_calls: 0, cost_usd: 0, release_ready: false,
    items: ["F01", "F04"].map(fixture_id => ({ item_id: `${id}:${fixture_id}`, fixture_id, page_id: `fixture.${fixture_id.toLowerCase()}`, status: "PENDING", attempts: 0, diagnostics: [], preview_href: null, version_href: null, input_sha256: null, artifact_hash: null, model_calls: 0, cost_usd: 0 })) };
}
function completed(): DoorRunView {
  const result = run(3);
  result.status = "COMPLETE"; result.resumable = false; result.terminal_count = 2;
  result.items[0] = { ...result.items[0], status: "BLOCKED", attempts: 1, diagnostics: [{ code: "F01_CONTROL_BLOCKED", pointer: "/release" }] };
  result.items[1] = { ...result.items[1], status: "BUILT", attempts: 1, preview_href: `/admin/page-creator/runs/${id}/items/F04/preview`, input_sha256: hash, artifact_hash: hash };
  return result;
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("fixture run transport and explicit processing", () => {
  it("sends the exact request and stable UUID key with the authenticated same-origin contract", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ run: run() }, { status: 202 })); vi.stubGlobal("fetch", fetch);
    expect(await doorRunTransport.create(request, key)).toEqual(run());
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith("/api/admin/page-runs", expect.objectContaining({ method: "POST", credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json", "Idempotency-Key": key }, body: JSON.stringify(request) }));
  });
  it("retains an unchanged creation key after uncertain writes; changed inputs receive a new key", async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError("connection")); vi.stubGlobal("fetch", fetch);
    const first = doorRunCreation(request, null, () => key);
    await expect(doorRunTransport.create(request, first.key)).rejects.toThrow("may have reached the server");
    const retry = doorRunCreation({ ...request, opportunity_ids: ["F04", "F01"] }, first, () => "wrong");
    expect(retry).toBe(first);
    expect(doorRunCreation({ ...request, dry_run: false }, first, () => "new-key").key).toBe("new-key");
    expect(fetch).toHaveBeenCalledOnce();
  });
  it("reads a saved URL without any POST and rejects a substituted run identity", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ run: { ...run(), run_id: `run-${key.replace("31a", "41a")}` } })); vi.stubGlobal("fetch", fetch);
    await expect(doorRunTransport.read(id)).rejects.toThrow("invalid run receipt");
    expect(fetch).toHaveBeenCalledWith(`/api/admin/page-runs/${id}`, expect.objectContaining({ method: "GET", cache: "no-store" }));
    expect(fetch).toHaveBeenCalledOnce();
  });
  it("never sends an invalid or path-traversal run address", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    await expect(doorRunTransport.read("../publish")).rejects.toThrow("Invalid run address");
    await expect(doorRunTransport.create(request, "bad")).rejects.toThrow("Invalid creation key");
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(["ab", " a ", "x".repeat(241)])("refuses reason outside the server's trimmed bounds before sending %#", async reason => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    await expect(doorRunTransport.create({ ...request, reason }, key)).rejects.toThrow("between 3 and 240");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("requires a durable 202 create receipt instead of accepting an ordinary OK response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ run: run() })));
    await expect(doorRunTransport.create(request, key)).rejects.toMatchObject({ status: 200 });
  });
  it.each([true, { run: { ...run(), release_ready: true } }, { run: { ...run(), terminal_count: 2 } }, { run: { ...run(), items: [{ ...run().items[0], preview_href: "https://example.com/private" }] } }])("refuses malformed or misleading receipts %#", async value => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(value)));
    await expect(doorRunTransport.read(id)).rejects.toThrow("invalid run receipt");
  });
  it.each(["/admin/page-creator/%2e%2e/%2e%2e/api/admin/logout", "/admin/page-creator/fixture/versions/1/preview?next=private", "/admin/page-creator/fixture?version=2147483647"])("refuses noncanonical private links: %s", async href => {
    const value = completed(); value.items[1].preview_href = href;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ run: value })));
    await expect(doorRunTransport.read(id)).rejects.toThrow("invalid run receipt");
  });
  it("accepts the exact generated dry-run and saved-version review paths", async () => {
    const dry = completed(); const saved = completed(); saved.dry_run = false;
    saved.items[1].preview_href = `/admin/page-creator/${saved.items[1].page_id}/versions/1/preview`;
    saved.items[1].version_href = `/admin/page-creator/${saved.items[1].page_id}?version=1`;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json({ run: dry })).mockResolvedValueOnce(Response.json({ run: saved })));
    expect(await doorRunTransport.read(id)).toEqual(dry); expect(await doorRunTransport.read(id)).toEqual(saved);
  });
  it("retains named server refusal and explains expired authentication without mutation retries", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ error: "RUN_REVISION_CONFLICT" }, { status: 409 }))
      .mockResolvedValueOnce(new Response("Forbidden", { status: 403 })); vi.stubGlobal("fetch", fetch);
    await expect(doorRunTransport.advance(run())).rejects.toThrow("RUN_REVISION_CONFLICT");
    await expect(doorRunTransport.read(id)).rejects.toThrow("session may have ended");
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("aborts a bounded hung request once without retrying or claiming failure of the server-side action", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn((_url, init: RequestInit) => new Promise<Response>((_resolve, reject) => init.signal!.addEventListener("abort", () => reject(new Error("aborted"))))); vi.stubGlobal("fetch", fetch);
    const result = expect(doorRunTransport.create(request, key)).rejects.toThrow("may have reached the server");
    await vi.advanceTimersByTimeAsync(45_000); await result;
    expect(fetch).toHaveBeenCalledOnce();
  });
  it("validates all eleven distinct fixture choices and refuses an incomplete catalogue", async () => {
    const catalog = { fixtures: Array.from({ length: 11 }, (_, i) => ({ fixture_id: `F${String(i + 1).padStart(2, "0")}`, label: `Fixture ${i + 1}` })), package_sha256: hash, executor_version: "fixture-v1" };
    const fetch = vi.fn().mockResolvedValueOnce(Response.json(catalog)).mockResolvedValueOnce(Response.json({ ...catalog, fixtures: catalog.fixtures.slice(0, 10) })); vi.stubGlobal("fetch", fetch);
    expect(await doorRunTransport.catalog()).toEqual(catalog);
    await expect(doorRunTransport.catalog()).rejects.toThrow("could not be verified");
  });
  it("sends the last verified revision and stops if no new revision is returned", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ run: run(7) })); vi.stubGlobal("fetch", fetch);
    await expect(doorRunTransport.advance(run(7))).rejects.toThrow("did not advance");
    expect(fetch).toHaveBeenCalledWith(`/api/admin/page-runs/${id}/advance`, expect.objectContaining({ body: '{"expected_revision":7}' }));
  });
  it("resumes with a fresh GET before choosing work, never regenerating completed items", async () => {
    const calls: string[] = [];
    const fresh = run(9);
    const transport = { read: vi.fn(async () => { calls.push("read"); return fresh; }), advance: vi.fn(async value => { calls.push(`advance-${value.revision}`); return completed(); }) };
    await resumeDoorRun(id, transport, () => true, () => undefined);
    expect(calls).toEqual(["read", "advance-9"]);
    transport.read.mockResolvedValue(completed()); transport.advance.mockClear();
    await resumeDoorRun(id, transport, () => true, () => undefined);
    expect(transport.advance).not.toHaveBeenCalled();
  });
  it("does not mutate after a failed fresh read on Resume", async () => {
    const advance = vi.fn();
    await expect(resumeDoorRun(id, { read: vi.fn().mockRejectedValue(new Error("unavailable")), advance }, () => true, () => undefined)).rejects.toThrow("unavailable");
    expect(advance).not.toHaveBeenCalled();
  });
  it("Pause allows the in-flight receipt to finish and prevents a second advance", async () => {
    let continueWork = true;
    let resolve!: (value: DoorRunView) => void;
    const advance = vi.fn(() => new Promise<DoorRunView>(done => { resolve = done; }));
    const receipts: DoorRunView[] = [];
    const pending = advanceDoorRun(run(), { advance }, () => continueWork, value => receipts.push(value));
    expect(advance).toHaveBeenCalledOnce();
    continueWork = false; resolve(run(2));
    await pending;
    expect(receipts).toEqual([run(2)]); expect(advance).toHaveBeenCalledOnce();
  });
  it("advances sequentially and stops on failure without silently retrying", async () => {
    const advance = vi.fn().mockResolvedValueOnce(run(2)).mockRejectedValueOnce(new Error("write uncertain"));
    const receipts: DoorRunView[] = [];
    await expect(advanceDoorRun(run(), { advance }, () => true, value => receipts.push(value))).rejects.toThrow("write uncertain");
    expect(advance).toHaveBeenNthCalledWith(2, run(2)); expect(advance).toHaveBeenCalledTimes(2); expect(receipts).toEqual([run(2)]);
  });
  it("does not advance without opt-in or while another request holds a lease", async () => {
    const advance = vi.fn();
    await advanceDoorRun(run(), { advance }, () => false, () => undefined);
    await advanceDoorRun({ ...run(), retry_after: "2026-09-14T00:00:00.000Z" }, { advance }, () => true, () => undefined);
    await advanceDoorRun({ ...run(), resumable: false }, { advance }, () => true, () => undefined);
    expect(advance).not.toHaveBeenCalled();
  });
});

describe("fixture run owner content", () => {
  it("initial rendering cannot create or advance; dry run is checked and reloaded run is read-only until resumed", () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const html = renderToStaticMarkup(createElement(DoorPageRuns, { initialRunId: id }));
    expect(html).toContain("Dry run — do not register page versions"); expect(html).toContain('type="checkbox" checked=""');
    expect(html).toContain("Resume unfinished items"); expect(html).toContain("No paid model calls"); expect(fetch).not.toHaveBeenCalled();
  });
  it("shows actual blocked and built outcomes, private review links and recorded costs without a QA/publication claim", () => {
    const html = renderToStaticMarkup(createElement(DoorRunResults, { run: completed() }));
    expect(html).toContain("Complete: every item has a recorded outcome"); expect(html).toContain("F01_CONTROL_BLOCKED");
    expect(html).toContain("/release"); expect(html).toContain("BLOCKED"); expect(html).toContain("BUILT");
    expect(html).toContain("Private draft preview"); expect(html).toContain("Content review only");
    expect(html).toContain("Recorded cost: USD 0"); expect(html).toContain("does not approve QA or publish pages");
    expect(html).not.toContain("Review registered version");
  });
  it("keeps an unfinished nonresumable run visibly unresolved", () => {
    const html = renderToStaticMarkup(createElement(DoorRunResults, { run: { ...run(), resumable: false } }));
    expect(html).toContain("needs operator support"); expect(html).toContain("0 of 2 items");
    expect(html).not.toContain("Complete: every item");
  });
});
