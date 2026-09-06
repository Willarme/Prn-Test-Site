import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ACTIVE_DISCLOSURE } from "@/domain/privacy/disclosures";

const cookieJar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => cookieJar.has(name) ? { name, value: cookieJar.get(name)! } : undefined }),
}));

/**
 * THE PACKET ROUTES (track P1): unknown journey → 404; no address → the
 * address form → POST /api/packet/address → 303 → the packet; the share
 * token as an alternative way in; the PDF route's fallback when Chrome is
 * unavailable, and a real PDF when it is; the events recorded.
 */
type Runtime = typeof import("@/platform/stores/runtime");
type Handler = (req: Request, ctx: { params: Promise<{ request_id: string }> }) => Promise<Response>;

let runtime: Runtime;
let dir: string;
let intakePost: (req: Request) => Promise<Response>;
let packetGet: Handler;
let pdfGet: Handler;
let addressPost: (req: Request) => Promise<Response>;
let tokens: typeof import("@/platform/links/tokens");
let pdfMod: typeof import("@/domain/packet/pdf");

const ORIGIN = "http://localhost:3111";
const params = (request_id: string) => ({ params: Promise.resolve({ request_id }) });

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "prn-p1-routes-"));
  process.env.PRN_DEV_DB_PATH = join(dir, "dev-db.json");
  process.env.PRN_RUNTIME_STORE = "file";
  process.env.LINK_SIGNING_SECRET = "p1-test-secret-not-real-0123456789";
  runtime = await import("@/platform/stores/runtime");
  runtime.resetRuntimeStore();
  tokens = await import("@/platform/links/tokens");
  tokens.__resetLinkSecretForTests();
  pdfMod = await import("@/domain/packet/pdf");
  ({ POST: intakePost } = await import("@/app/api/intake/route"));
  ({ GET: packetGet } = await import("@/app/packet/[request_id]/route"));
  ({ GET: pdfGet } = await import("@/app/packet/[request_id]/pdf/route"));
  ({ POST: addressPost } = await import("@/app/api/packet/address/route"));
});

afterAll(async () => {
  await pdfMod.closePdfRenderer();
  delete process.env.PRN_DEV_DB_PATH;
  delete process.env.PRN_RUNTIME_STORE;
  delete process.env.LINK_SIGNING_SECRET;
  delete process.env.PRN_PDF_DISABLED;
  rmSync(dir, { recursive: true, force: true });
});

async function createJourney(description: string): Promise<string> {
  const res = await intakePost(
    new Request(`${ORIGIN}/api/intake`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        description,
        disclosure_content_hash: ACTIVE_DISCLOSURE.content_hash,
        attribution: {
          page_id: "page_ac_blowing_warm_air",
          intent_cluster_id: "ic_hvac_cooling_no_cold_air",
          search_opportunity_id: null,
          problem_family_hint: "hvac",
          experiment_id: null,
          variant: null,
          referrer: null,
          landing_path: "/problems/ac-blowing-warm-air",
        },
      }),
    })
  );
  expect(res.status).toBe(200);
  for (const cookie of res.headers.getSetCookie()) {
    const pair = cookie.split(";")[0];
    const eq = pair.indexOf("=");
    cookieJar.set(pair.slice(0, eq), decodeURIComponent(pair.slice(eq + 1)));
  }
  return ((await res.json()) as { request_id: string }).request_id;
}

function addressForm(requestId: string, overrides: Record<string, string> = {}): Request {
  const form = new FormData();
  const fields: Record<string, string> = {
    request_id: requestId,
    return_to: `/packet/${requestId}`,
    street: "1114 Oakhurst Dr",
    city_state_zip: "Fort Wayne, IN 46815",
    property_type: "single-family",
    storeys: "2 storey",
    ...overrides,
  };
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  return new Request(`${ORIGIN}/api/packet/address`, { method: "POST", body: form });
}

describe("P1 · GET /packet/[request_id]", () => {
  it("404s an unknown journey, and a share token for a different journey", async () => {
    const res = await packetGet(new Request(`${ORIGIN}/packet/rq_nope`), params("rq_nope"));
    expect(res.status).toBe(404);
    const id = await createJourney("AC is running but blowing warm air since yesterday.");
    const other = tokens.signLink({ scope: "packet", request_id: "rq_someone_else" });
    const wrong = await packetGet(new Request(`${ORIGIN}/packet/${id}?share=${other}`), params(id));
    expect(wrong.status).toBe(404);
    const keepScope = tokens.signLink({ scope: "keep", request_id: id });
    const scoped = await packetGet(new Request(`${ORIGIN}/packet/${id}?share=${keepScope}`), params(id));
    expect(scoped.status).toBe(404);
  });

  it("renders an honest address gap, then adds the accepted address to the next packet", async () => {
    const id = await createJourney("The air conditioner is on and I can feel air but it's just not cold anymore.");
    const first = await packetGet(new Request(`${ORIGIN}/packet/${id}`), params(id));
    expect(first.status).toBe(200);
    const formHtml = await first.text();
    expect(formHtml).toContain("Job address still unknown");
    expect(first.headers.get("x-packet-self-check")).toBe("ok");
    expect(formHtml).toContain("Page 1 — for the homeowner");

    // Both lines are required: a short post bounces back with the error code.
    const bad = await addressPost(addressForm(id, { city_state_zip: "" }));
    expect(bad.status).toBe(303);
    expect(bad.headers.get("location")).toBe(`${ORIGIN}/packet/${id}?error=address`);

    const saved = await addressPost(addressForm(id));
    expect(saved.status).toBe(303);
    expect(saved.headers.get("location")).toBe(`${ORIGIN}/packet/${id}`);
    expect(await runtime.runtimeStore().getJobAddress(id)).toEqual({
      street: "1114 Oakhurst Dr",
      city_state_zip: "Fort Wayne, IN 46815",
      property_type: "single-family",
      storeys: "2 storey",
    });

    const packet = await packetGet(new Request(`${ORIGIN}/packet/${id}`), params(id));
    expect(packet.status).toBe(200);
    expect(packet.headers.get("content-type")).toContain("text/html");
    expect(packet.headers.get("x-packet-self-check")).toBe("ok");
    const html = await packet.text();
    expect(html).toContain("Page 1 — for the homeowner");
    expect(html).toContain("Page 2 — for the provider · head start · executive summary");
    expect(html).toContain("Page 3 — for the provider · detail");
    expect(html).toContain("1114 Oakhurst Dr · Fort Wayne, IN 46815 · single-family, 2 storey");
    expect(html).toContain("As soon as possible · safety not established");
    expect(html).toContain(`href="/packet/${id}/pdf"`);
    expect(html).toContain(">Download PDF<");
    expect(html).toContain(">Print<");
    // The three signed links, on this origin, one per scope.
    const keep = /href="http:\/\/localhost:3111\/keep\/([^"]+)"/.exec(html)!;
    const ask = /href="http:\/\/localhost:3111\/ask\/([^"]+)"/.exec(html)!;
    const media = /href="http:\/\/localhost:3111\/media\/([^"]+)"/.exec(html)!;
    expect((await tokens.verifyLink(keep[1], "keep")).ok).toBe(true);
    expect((await tokens.verifyLink(ask[1], "ask")).ok).toBe(true);
    expect((await tokens.verifyLink(media[1], "media")).ok).toBe(true);
    // Two QR codes on the page.
    expect((html.match(/<svg xmlns="http:\/\/www.w3.org\/2000\/svg" viewBox="0 0 \d+ \d+" shape-rendering="crispEdges"/g) ?? []).length).toBe(2);
    // The share token opens it too, and ?print=1 arms the print dialog.
    const share = tokens.signLink({ scope: "packet", request_id: id });
    const shared = await packetGet(new Request(`${ORIGIN}/packet/${id}?share=${share}&print=1`), params(id));
    expect(shared.status).toBe(200);
    const sharedHtml = await shared.text();
    expect(sharedHtml).toContain("window.print()");
    expect(sharedHtml).toContain("Shared provider copy");
    expect(sharedHtml).not.toMatch(/href="[^"]*\/(keep|ask|media)\//);
    // packet.viewed recorded, with the source distinguishing the share link.
    const events = (await import("@/platform/stores/dev-db")).readDevDb().events.filter((e) => e.event_name === "packet.viewed" && e.context.request_id === id);
    expect(events.map((e) => e.context.source)).toEqual(["packet_view", "packet_view", "share_link"]);
    expect(events[0].actor.actor_type).toBe("guest");
  });

  it("the address route refuses an unknown journey and an off-site return path", async () => {
    const missing = await addressPost(addressForm("rq_unknown"));
    expect(missing.status).toBe(404);
    const id = await createJourney("AC warm air, started today.");
    const offsite = await addressPost(addressForm(id, { return_to: "https://evil.example/x" }));
    expect(offsite.headers.get("location")).toBe(`${ORIGIN}/packet/${id}`);
  });

  it("requires signed owner access, accepts a same-request keep link on a new device, and refuses a share token for address writes", async () => {
    const id = await createJourney("AC runs but the vents blow warm air.");
    await addressPost(addressForm(id));
    cookieJar.clear();
    expect((await packetGet(new Request(`${ORIGIN}/packet/${id}`), params(id))).status).toBe(404);
    const share = tokens.signLink({ scope: "packet", request_id: id });
    expect((await addressPost(addressForm(id, { k: share }))).status).toBe(404);
    const keep = tokens.signLink({ scope: "keep", request_id: id });
    const reopened = await packetGet(new Request(`${ORIGIN}/packet/${id}?k=${keep}`), params(id));
    expect(reopened.status).toBe(200);
    const html = await reopened.text();
    expect(html).toContain(`/packet/${id}/pdf?k=${keep}`);
    expect(html).toMatch(/href="[^"]*\/keep\//);
  });
});

describe("P1 · GET /packet/[request_id]/pdf", () => {
  it("keeps a no-address packet printable and falls back to ?print=1 when the renderer is unavailable", async () => {
    const id = await createJourney("AC is running but the air is warm.");
    process.env.PRN_PDF_DISABLED = "1";
    const noAddress = await pdfGet(new Request(`${ORIGIN}/packet/${id}/pdf`), params(id));
    expect(noAddress.status).toBe(303);
    expect(noAddress.headers.get("location")).toBe(`${ORIGIN}/packet/${id}?print=1`);
    await addressPost(addressForm(id));
    process.env.PRN_PDF_DISABLED = "1";
    try {
      const fallback = await pdfGet(new Request(`${ORIGIN}/packet/${id}/pdf`), params(id));
      expect(fallback.status).toBe(303);
      expect(fallback.headers.get("location")).toBe(`${ORIGIN}/packet/${id}?print=1`);
    } finally {
      delete process.env.PRN_PDF_DISABLED;
    }
  });

  it("renders a real three-page PDF through local Chrome when it is available", async () => {
    if (!pdfMod.pdfRendererAvailable()) return; // no Chrome / puppeteer-core on this machine: the fallback above is the behaviour
    const id = await createJourney("The air conditioner is on and I can feel air but it's just not cold anymore.");
    await addressPost(addressForm(id));
    const res = await pdfGet(new Request(`${ORIGIN}/packet/${id}/pdf`), params(id));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toMatch(/^inline; filename="Job Packet [0-9A-F]{4}-[0-9A-F]{4}\.pdf"$/);
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(bytes.subarray(0, 4).toString("latin1")).toBe("%PDF");
    expect(pdfMod.countPdfPages(bytes)).toBe(3);
    const events = (await import("@/platform/stores/dev-db")).readDevDb().events.filter((e) => e.event_name === "packet.downloaded" && e.context.request_id === id);
    expect(events).toHaveLength(1);
    expect(events[0].context.surface).toBe("pdf");
  }, 60_000);
});
