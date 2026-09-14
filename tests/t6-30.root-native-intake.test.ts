import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Home from "@/app/page";
import StartPage from "@/app/start/page";
import { NativeIntakeForm } from "@/components/intake/NativeIntakeForm";
import { ACTIVE_DISCLOSURE } from "@/domain/privacy/disclosures";
import { readFeatureSnapshot } from "@/platform/features/state";
import { POST } from "@/app/api/intake/start/route";
import { featureSnapshot } from "./helpers/feature-snapshot";

const seams = vi.hoisted(() => ({ start: vi.fn(), attach: vi.fn() }));
vi.mock("@/platform/intake/start", () => ({ startIntake: seams.start }));
vi.mock("@/platform/intake/media", () => ({ attachMedia: seams.attach }));
let enabled = true;
let snapshot = featureSnapshot({ intake: "LIVE" });
vi.mock("@/platform/flags", () => ({ flagEnabled: () => enabled }));
vi.mock("@/platform/features/state", async importOriginal => ({
  ...await importOriginal<typeof import("@/platform/features/state")>(),
  readFeatureSnapshot: vi.fn(async () => snapshot),
}));

const page = async (error?: string | string[]) => renderToStaticMarkup(await Home({ searchParams: Promise.resolve({ error }) }));

/** Submit the fields actually rendered by the server, without a client bundle. */
function postedForm(html: string, files = false): Request {
  const form = new FormData();
  for (const tag of html.match(/<input\b[^>]*type="hidden"[^>]*>/g) ?? []) {
    const name = /\bname="([^"]+)"/.exec(tag)![1];
    form.set(name, /\bvalue="([^"]*)"/.exec(tag)![1]);
  }
  form.set(/<textarea[^>]*name="([^"]+)"/.exec(html)![1], "TEST ONLY. The air is coming out but is not cold.");
  if (files) for (const tag of html.match(/<input\b[^>]*type="file"[^>]*>/g) ?? []) {
    const name = /\bname="([^"]+)"/.exec(tag)![1];
    form.append(name, new File(["synthetic adapter-boundary bytes"], "fixture.bin", { type: "application/octet-stream" }));
  }
  return new Request("https://example.test/api/intake/start", {
    method: "POST", headers: { origin: "https://example.test", referer: "https://example.test/" }, body: form,
  });
}

beforeEach(() => {
  vi.clearAllMocks(); enabled = true; snapshot = featureSnapshot({ intake: "LIVE" });
  seams.start.mockResolvedValue({ kind: "started", request_id: "rq_synthetic_root", next: "/complete/rq_synthetic_root", cookie: null });
  seams.attach.mockResolvedValue({ ok: true, evidence_id: "ev_synthetic_root" });
});

describe("T6-30 root native intake source candidate", () => {
  it("renders one usable native multipart form before the benefit sections and preserves the root copy", async () => {
    const html = await page();
    expect(html).toContain("Something happened in your home.");
    expect(html).toContain("provider-ready Job Packet.");
    expect(html.match(/<form\b/g)).toHaveLength(1);
    const formTag = /<form\b[^>]*>/.exec(html)![0];
    for (const attribute of ['id="intake"', 'action="/api/intake/start"', 'method="post"', 'encType="multipart/form-data"']) {
      expect(formTag).toContain(attribute);
    }
    expect(html.indexOf("<form")).toBeLessThan(html.indexOf("Plain words are enough"));
    expect(html).toContain('name="problem_description"');
    expect(html).toContain('required=""');
    expect(html).toContain('minLength="8"');
    expect(html).toContain('<button type="submit"');
    expect(html).not.toContain('href="/start"');
    expect(html).not.toContain("<script");
    expect(readFeatureSnapshot).toHaveBeenCalledOnce();
  });

  it("keeps current disclosure text and hash inside the form with labelled optional media", async () => {
    const html = renderToStaticMarkup(createElement(NativeIntakeForm));
    const text = html.replace(/<[^>]*>/g, "");
    expect(text).toContain(ACTIVE_DISCLOSURE.content_text);
    expect(html).toContain(`name="disclosure_content_hash" value="${ACTIVE_DISCLOSURE.content_hash}"`);
    for (const href of ["/terms", "/privacy"]) {
      expect(html).toContain(`href="${href}" target="_blank" rel="noopener noreferrer"`);
    }
    for (const id of ["problem-description", "intake-photos", "intake-video", "intake-voice"]) {
      expect(html).toContain(`for="${id}"`); expect(html).toContain(`id="${id}"`);
    }
    for (const [name, accept] of [["photos", "image/*"], ["video", "video/*"], ["voice_note", "audio/*"]]) {
      const tag = (html.match(/<input\b[^>]*>/g) ?? []).find(input => input.includes(`name="${name}"`))!;
      expect(tag).toContain(`accept="${accept}"`);
      expect(tag).not.toContain("required");
      if (name === "photos") expect(tag).toContain('multiple=""');
    }
    expect(text).toContain("not transcribed");
    expect(text).not.toMatch(/email to start|read the model|LIVE Walkthrough Tool|1 to 5 minutes/);
  });

  it("the rendered fields reach the real multipart adapter with null general attribution and all media slots", async () => {
    const response = await POST(postedForm(await page(), true));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/complete/rq_synthetic_root");
    expect(seams.start).toHaveBeenCalledOnce();
    expect(seams.start).toHaveBeenCalledWith(expect.objectContaining({
      disclosure_content_hash: ACTIVE_DISCLOSURE.content_hash,
      attribution: { page_id: null, intent_cluster_id: null, search_opportunity_id: null, problem_family_hint: null,
        experiment_id: null, variant: null, landing_path: "/", referrer: "https://example.test/" },
    }));
    expect(seams.attach.mock.calls.map(([input]) => input.target)).toEqual(["door_photo", "door_video", "voice_note"]);
  });

  it.each([[400, "needs_description"], [409, "consent"], [404, "unavailable"], [503, "try_again"]] as const)(
    "renders bounded recovery after adapter status %s", async (status, error) => {
      seams.start.mockResolvedValue({ kind: "error", status, error: "PRIVATE SERVER DETAIL" });
      const response = await POST(postedForm(await page()));
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe(`/?error=${error}#intake`);
      const html = await page(error);
      expect(html).toContain('role="alert"');
      expect(html).toContain("Enter your description and choose any files again");
      expect(html).not.toMatch(/PRIVATE SERVER DETAIL|still here|could not be saved/);
      expect(seams.attach).not.toHaveBeenCalled();
    },
  );

  it.each(["<script>private</script>", "constructor", "__proto__", ["consent", "unavailable"]])(
    "ignores unrecognized or repeated error query values: %s", async error => {
      const html = await page(error);
      expect(html).not.toContain('role="alert"');
      expect(html).not.toContain("<script>");
    },
  );

  it("preserves the adapter safety halt and never forwards media before a request exists", async () => {
    seams.start.mockResolvedValue({ kind: "safety_halt", rule_id: "synthetic_safety" });
    const response = await POST(postedForm(await page(), true));
    expect(response.headers.get("location")).toBe("/safety/synthetic_safety");
    expect(seams.attach).not.toHaveBeenCalled();
  });

  it("preserves the partial-upload warning instead of claiming every file succeeded", async () => {
    seams.attach.mockResolvedValueOnce({ ok: false, status: 415, error: "unsupported" });
    const response = await POST(postedForm(await page(), true));
    expect(response.headers.get("location")).toBe("/complete/rq_synthetic_root?uploads=partial");
  });

  it("uses the real Next permanent redirect signal when the root form is enabled", async () => {
    await expect(StartPage()).rejects.toMatchObject({ digest: "NEXT_REDIRECT;replace;/;308;" });
  });

  it.each(["HIDDEN", "PREVIEW"] as const)("removes intake and refuses /start when persisted intake is %s", async state => {
    snapshot = featureSnapshot({ intake: state });
    expect(await page()).not.toContain("<form");
    await expect(StartPage()).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
  });

  it("fails closed on an unverified snapshot and on the legacy intake switch", async () => {
    snapshot = { ...snapshot, verified: false };
    expect(await page()).not.toContain("<form");
    await expect(StartPage()).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
    snapshot = featureSnapshot({ intake: "LIVE" }); enabled = false;
    expect(await page()).not.toContain("<form");
    await expect(StartPage()).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
  });

  it.each(["HIDDEN", "PREVIEW"] as const)("withholds intake when its mandatory disclosure pages are %s", async state => {
    snapshot = featureSnapshot({ intake: "LIVE", explainers: state });
    const html = await page();
    expect(html).not.toContain("<form");
    expect(html).not.toContain('href="/terms"');
    expect(html).not.toContain('href="/privacy"');
    await expect(StartPage()).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
  });
});
