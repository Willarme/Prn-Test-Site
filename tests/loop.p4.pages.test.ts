import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ACTIVE_DISCLOSURE } from "@/domain/privacy/disclosures";
import { signLink } from "@/platform/links/tokens";

/**
 * The pages track P4 owns, rendered the way the server renders them (server
 * components awaited, client components rendered as SSR would), with the
 * app-router hooks stubbed the way a page test has to.
 *
 *   - /complete: the acknowledgement names the three C1 facts and the box
 *     does not ask for them again (checklist C1/C2, the blocker above all);
 *   - /complete for a garage door: the route-out, and no thermostat/filter
 *     step (F6);
 *   - the five furniture routes and /results/[id]/find render.
 */
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => undefined, push: () => undefined }),
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

let jsonPost: (req: Request) => Promise<Response>;

beforeAll(async () => {
  const dir = await mkdtemp(join(tmpdir(), "prn-devdb-p4-pages-"));
  process.env.PRN_DEV_DB_PATH = join(dir, "dev-db.json");
  ({ POST: jsonPost } = await import("@/app/api/intake/route"));
});

afterAll(() => {
  delete process.env.PRN_DEV_DB_PATH;
});

async function startJourney(description: string, hint: string | null = "hvac-cooling"): Promise<string> {
  const res = await jsonPost(
    new Request("http://localhost/api/intake", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        description,
        disclosure_content_hash: ACTIVE_DISCLOSURE.content_hash,
        attribution: {
          page_id: hint ? "page_ac_blowing_warm_air" : null,
          intent_cluster_id: null,
          search_opportunity_id: null,
          problem_family_hint: hint,
          experiment_id: null,
          variant: null,
          referrer: null,
          landing_path: hint ? "/problems/ac-blowing-warm-air" : "/start",
        },
      }),
    })
  );
  expect(res.status).toBe(200);
  return ((await res.json()) as { request_id: string }).request_id;
}

async function renderPage(
  mod: { default: (props: { params: Promise<{ request_id: string }>; searchParams?: Promise<{ k?: string }> }) => Promise<ReactElement> | ReactElement },
  request_id = "none"
): Promise<string> {
  const el = await mod.default({ params: Promise.resolve({ request_id }), searchParams: Promise.resolve({ k: signLink({ scope: "keep", request_id }) }) });
  return renderToStaticMarkup(el);
}

describe("GET /complete/[request_id] — the acknowledgement and never-ask-twice", () => {
  it("acknowledges a persisted voice note without claiming transcription", async () => {
    const request_id = await startJourney("My AC is blowing warm air");
    const mod = await import("@/app/complete/[request_id]/page");
    expect(await renderPage(mod, request_id)).not.toContain("data-voice-receipt");
    const { attachMedia } = await import("@/platform/intake/media");
    const receipt = await attachMedia({ request_id, target: "voice_note", source: "door_form", file: new File(["synthetic audio"], "note.m4a", { type: "audio/mp4" }) });
    expect(receipt.ok).toBe(true);
    const html = await renderPage(mod, request_id);
    expect(html).toContain("data-voice-receipt");
    expect(html).toContain("Voice note received, not transcribed.");
  });
  it("keeps an attachment retry path on the saved request, including voice", async () => {
    const request_id = await startJourney("My AC is blowing warm air");
    const Page = (await import("@/app/complete/[request_id]/page")).default;
    const element = await Page({ params: Promise.resolve({ request_id }), searchParams: Promise.resolve({ uploads: "partial", k: signLink({ scope: "keep", request_id }) }) });
    const html = renderToStaticMarkup(element);
    expect(html).toContain("Your description is saved");
    expect(html).toContain('id="retry-attachment"');
    expect(html).toContain("Voice note");
    expect(html).toContain(`/results/${request_id}`);
  });
  it("names the three facts and collapses their fields (C1, C2)", async () => {
    const request_id = await startJourney("My Carrier AC is 8 years old and blowing warm air since Tuesday");
    const html = await renderPage(await import("@/app/complete/[request_id]/page"), request_id);

    expect(html).toContain("Got it — Carrier, about 8 years old, started Tuesday.");
    // Each held field is a collapsed line, never an empty typed box.
    expect(html).toContain('data-held="brand"');
    expect(html).toContain('data-held="system_age"');
    expect(html).toContain('data-held="symptom_timing"');
    expect(html).not.toMatch(/aria-label="Brand"/);
    expect(html).not.toMatch(/aria-label="Roughly how old is the system\?"/);
    expect(html).not.toMatch(/aria-label="When did it start/);
    // No praise, no negative form.
    expect(html).not.toMatch(/Great job|really helpful|don&#x27;t need to tell us|You don't need/);
    // T1-35 emits one missing-fact group at a time; known facts stay in review.
    expect(html).toContain("data-active-intake-screen");
    const active = html.slice(html.indexOf("data-active-intake-screen"));
    expect(active).toContain('data-field="unit_model_serial"');
    expect(active).not.toContain('data-field="brand"');
    expect(active).not.toContain("Check the air filter");
  });

  it("a garage door typed into the AC door gets the route-out and no thermostat or filter step (F6)", async () => {
    const request_id = await startJourney("my garage door won't close and my car is stuck inside");
    const html = await renderPage(await import("@/app/complete/[request_id]/page"), request_id);
    expect(html).toContain("data-route-out");
    expect(html).toContain("We cannot help with this one yet.");
    expect(html).toContain("garage door repair near me");
    expect(html).toContain(`/results/${request_id}`);
    expect(html).not.toContain("Thermostat");
    expect(html).not.toContain("Check the air filter");
    expect(html).not.toContain("Details a technician will want");
  });

  it("a ceiling leak from the AC door routes out toward a plumber, packet still reachable", async () => {
    const request_id = await startJourney("there's water coming through my ceiling in the upstairs hallway");
    const html = await renderPage(await import("@/app/complete/[request_id]/page"), request_id);
    expect(html).toContain("data-route-out");
    expect(html).toContain("plumber near me");
    expect(html).toContain("View my Job Packet");
    expect(html).not.toContain("thermostat");
  });

  it("a thin AC sentence stays in scope (F2 gets a packet, not a route-out)", async () => {
    const request_id = await startJourney("my ac isn't working");
    const html = await renderPage(await import("@/app/complete/[request_id]/page"), request_id);
    expect(html).not.toContain("data-route-out");
    expect(html).toContain("Details a technician will want");
  });
});

describe("GET /results/[request_id] — confirmed keep receipt outside the frozen template", () => {
  it("requires the current claim's actual confirmation, never the query alone", async () => {
    const request_id = await startJourney("My AC is blowing warm air");
    const Page = (await import("@/app/results/[request_id]/page")).default;
    const render = async () => renderToStaticMarkup(await Page({ params: Promise.resolve({ request_id }), searchParams: Promise.resolve({ kept: "1", k: signLink({ scope: "keep", request_id }) }) }));
    expect(await render()).not.toContain("data-keep-receipt");
    const { runtimeStore } = await import("@/platform/stores/runtime");
    const { recordKeepRequested, markKeepConfirmed } = await import("@/platform/links/ledger");
    const claimed_at = new Date().toISOString();
    const claim = { request_id, contact: "preview@example.com", contact_kind: "email" as const, claimed_at, magic_link_id: "mg_preview_current" };
    await runtimeStore().saveKeepClaim(claim);
    recordKeepRequested(request_id, { email_id: null, magic_id: claim.magic_link_id });
    expect(await render()).not.toContain("data-keep-receipt");
    expect(markKeepConfirmed(request_id, claimed_at, claim.magic_link_id)).toBe(true);
    const confirmed = await render();
    expect(confirmed).toContain("Saved to Home Memory.");
    expect(confirmed).toContain("Open your saved record");
    await runtimeStore().saveKeepClaim({ ...claim, magic_link_id: "mg_preview_replacement" });
    expect(await render()).not.toContain("data-keep-receipt");
  });
});

describe("GET /complete/[request_id] — the confirm ladder (C3, C4, F4)", () => {
  it("a value read off a photo is confirmed, never asserted; an unreadable label says so and opens the typed box", async () => {
    const request_id = await startJourney("My AC is blowing warm air, started yesterday afternoon");
    const { runtimeStore } = await import("@/platform/stores/runtime");
    const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
    await runtimeStore().saveIntakeAnswers([
      { request_id, field_key: "brand", value_text: "Carrier", evidence_id: "ev_label", source: "photo", answered_at: now },
      { request_id, field_key: "unit_model_serial", value_text: null, evidence_id: "ev_label", source: "photo", answered_at: now },
    ]);
    const html = await renderPage(await import("@/app/complete/[request_id]/page"), request_id);
    expect(html).toContain('data-confirm="brand"');
    expect(html).toMatch(/We read <strong>Carrier<\/strong> — is that right\?/);
    expect(html).toContain('data-unread="unit_model_serial"');
    expect(html).toContain("We could not read that one.");
    expect(html).toContain('aria-label="Model &amp; serial number"');
    // The acknowledgement names only what the first sentence carried, not the photo read.
    expect(html).not.toContain("Got it — Carrier");
  });

  it.each([false, true])("a confirmed value collapses with truthful photo provenance (photo: %s)", async fromPhoto => {
    const request_id = await startJourney("My AC is blowing warm air, started yesterday afternoon");
    const { runtimeStore } = await import("@/platform/stores/runtime");
    const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
    await runtimeStore().saveIntakeAnswers([
      ...(fromPhoto ? [{ request_id, field_key: "brand", value_text: "Carrier", evidence_id: "ev_label", source: "photo" as const, answered_at: now }] : []),
      { request_id, field_key: "brand", value_text: "Carrier", evidence_id: null, source: "confirmed", answered_at: now },
    ]);
    const html = await renderPage(await import("@/app/complete/[request_id]/page"), request_id);
    expect(html).toContain('data-held="brand"');
    expect(html).toContain(fromPhoto ? "from your photo, confirmed" : "confirmed by you");
    expect(html).not.toContain('data-confirm="brand"');
  });
});

describe("GET /results/[request_id]/find — the honest route-out", () => {
  it("renders what she can do today and no provider list", async () => {
    const request_id = await startJourney("My Carrier AC is 8 years old and blowing warm air since Tuesday");
    const html = await renderPage(await import("@/app/results/[request_id]/find/page"), request_id);
    expect(html).toContain("data-find-route-out");
    expect(html).toContain("The matched shortlist is still being built for this trial.");
    expect(html).toContain("Open your Job Packet");
    expect(html).toContain("Ask your people");
    expect(html).toContain("Use the call script");
    expect(html).not.toMatch(/\$\d/);
  });

  it("an unknown request is a 404", async () => {
    await expect(renderPage(await import("@/app/results/[request_id]/find/page"), "rq_nope")).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

describe("the furniture the door links to", () => {
  it("/cooling has the door's H1 as its one card, linking the door", async () => {
    const html = renderToStaticMarkup(createElement((await import("@/app/cooling/page")).default));
    expect(html).toContain("AC running but blowing warm air?");
    expect(html).toContain('href="/problems/ac-blowing-warm-air"');
  });

  it("/what-this-tool-can-help-with has question-shaped H2s with a limit per group", async () => {
    const html = renderToStaticMarkup(createElement((await import("@/app/what-this-tool-can-help-with/page")).default));
    const h2s = html.match(/<h2[^>]*>([^<]+)<\/h2>/g) ?? [];
    expect(h2s.length).toBeGreaterThanOrEqual(10);
    for (const h of h2s) expect(h).toMatch(/\?<\/h2>$/);
    expect((html.match(/The limit:/g) ?? []).length).toBe(5);
    expect(html).not.toMatch(/\$\d/);
  });

  it("/local-records/methodology mirrors the door's paragraph verbatim and publishes no number", async () => {
    const html = renderToStaticMarkup(createElement((await import("@/app/local-records/methodology/page")).default));
    expect(html).toContain("Percentages never publish without a denominator. Small cells are suppressed. A provider-confirmed cause is never inferred from a homeowner guess.");
    expect(html).toContain("Building the repair record");
    expect(html).not.toMatch(/\d+%/);
  });

  it("/terms and /privacy carry the draft line and the exact disclosure text", async () => {
    for (const path of ["@/app/terms/page", "@/app/privacy/page"] as const) {
      const html = renderToStaticMarkup(createElement((await import(path)).default));
      expect(html).toContain("Draft — counsel review pending");
      expect(html).toContain("Your details stay private. We use what you share to build your request and Job Packet.");
      expect(html).toContain(ACTIVE_DISCLOSURE.version_label);
    }
  });
});
