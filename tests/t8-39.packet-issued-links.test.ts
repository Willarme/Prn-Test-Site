import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ACTIVE_DISCLOSURE } from "@/domain/privacy/disclosures";
import { closePdfRenderer, countPdfPages, pdfRendererAvailable } from "@/domain/packet/pdf";
import { MemoryAiPolicyStore, setAiPolicyStoreForTests } from "@/platform/ai/policy-store";
import { MemorySpendLedger, setSpendLedgerForTests } from "@/platform/ai/spend";
import * as dbClient from "@/platform/db/client";
import * as mediaAdapter from "@/platform/adapters/media-storage";
import { listIssuedLinks } from "@/platform/links/ledger";
import { decodeLink, signLink, verifyLink, type LinkScope } from "@/platform/links/tokens";
import { loadPacket } from "@/platform/packet/load";
import * as runtime from "@/platform/stores/runtime";
import { POST as startPost } from "@/app/api/intake/route";
import { POST as finishPost } from "@/app/api/intake/finish/route";
import { POST as answerPost } from "@/app/api/intake/answer/route";
import { GET as htmlGet } from "@/app/packet/[request_id]/route";
import { GET as pdfGet } from "@/app/packet/[request_id]/pdf/route";
import { POST as revokePost } from "@/app/api/links/revoke/route";

const cookieJar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => cookieJar.has(name) ? { name, value: cookieJar.get(name)! } : undefined }),
}));
const origin = "http://localhost";
let dir: string;
const network = vi.fn(() => { throw new Error("No external network in packet-link tests"); });
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "packet-link-ack-"));
  vi.stubEnv("PRN_DEV_DB_PATH", join(dir, "db.json")); vi.stubEnv("PRN_RUNTIME_STORE", "file");
  vi.stubEnv("LINK_SIGNING_SECRET", "synthetic-packet-link-acknowledgement-test-only");
  vi.stubEnv("VITEST", "1"); vi.stubEnv("PRN_AI_LIVE_TESTS", "0"); vi.stubEnv("PRN_PDF_DISABLED", "");
  network.mockClear(); vi.stubGlobal("fetch", network); cookieJar.clear();
  runtime.resetRuntimeStore(); setAiPolicyStoreForTests(new MemoryAiPolicyStore()); setSpendLedgerForTests(new MemorySpendLedger());
});
afterEach(async () => {
  await closePdfRenderer(); expect(network).not.toHaveBeenCalled();
  vi.restoreAllMocks(); runtime.resetRuntimeStore(); setAiPolicyStoreForTests(null); setSpendLedgerForTests(null);
  vi.unstubAllEnvs(); vi.unstubAllGlobals(); rmSync(dir, { recursive: true, force: true });
});
const params = (request_id: string) => ({ params: Promise.resolve({ request_id }) });
const post = (path: string, body: object) => new Request(origin + path, {
  method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(body),
});
async function createPacket() {
  const response = await startPost(post("/api/intake", {
    description: "My Carrier AC is not cooling since yesterday.", disclosure_content_hash: ACTIVE_DISCLOSURE.content_hash,
    attribution: { landing_path: "/start", problem_family_hint: "hvac-cooling", page_id: null,
      intent_cluster_id: null, search_opportunity_id: null, experiment_id: null, variant: null, referrer: null },
  }));
  expect(response.status).toBe(200);
  for (const raw of response.headers.getSetCookie()) {
    const pair = raw.split(";")[0], eq = pair.indexOf("=");
    cookieJar.set(pair.slice(0, eq), decodeURIComponent(pair.slice(eq + 1)));
  }
  const id = (await response.json()).request_id as string;
  const done = await finishPost(post("/api/intake/finish", { request_id: id }));
  expect(done.status).toBe(200);
  expect((await runtime.runtimeStore().getJourney(id))?.packet.intake_snapshot).toBeTruthy();
  return id;
}
const scopes = ["keep", "ask", "media"] as const;
function ownerTokens(urls: string[]) {
  return scopes.map(scope => {
    const prefix = origin + "/" + scope + "/";
    const url = urls.find(value => value.startsWith(prefix));
    expect(url, "Expected actual " + scope + " link in rendered output").toBeTruthy();
    return { scope, token: url!.slice(prefix.length) };
  });
}
async function assertRecordedAndRevocable(id: string, links: Array<{ scope: LinkScope; token: string }>) {
  const ledger = await listIssuedLinks(id);
  const ids: string[] = [];
  for (const { scope, token } of links) {
    const decoded = decodeLink(token); expect(decoded.ok).toBe(true);
    if (!decoded.ok) throw new Error("Fixture output was not a valid token");
    expect(decoded.request_id).toBe(id); expect(decoded.scope).toBe(scope);
    expect(ledger.find(row => row.link_id === decoded.link_id)).toMatchObject({ scope, token });
    expect((await verifyLink(token, scope)).ok).toBe(true);
    const revoked = await revokePost(post("/api/links/revoke", { request_id: id, link_id: decoded.link_id }));
    expect(revoked.status).toBe(200); expect(await revoked.json()).toMatchObject({ ok: true, revoked: true });
    expect(await verifyLink(token, scope)).toMatchObject({ ok: false, reason: "revoked" });
    ids.push(decoded.link_id);
  }
  expect(new Set(ids).size).toBe(3);
  expect(await runtime.runtimeStore().getJourney(id)).not.toBeNull();
  return ids;
}

it("records the actual loader's three owner capabilities before returning and makes each revocable", async () => {
  const id = await createPacket();
  const loaded = await loadPacket(id, { owner: true, link_base: origin });
  expect(loaded?.input).toBeTruthy();
  const config = loaded!.input!.config;
  await assertRecordedAndRevocable(id, ownerTokens([config.home_memory_url!, config.trust_network_url!, config.media_link!]));
});

it("embeds a re-encoded thumbnail from private Supabase evidence instead of a file-only placeholder", async () => {
  const id = await createPacket();
  const journey = (await runtime.runtimeStore().getJourney(id))!;
  const ref = `private-evidence/${id}/thermostat_photo/synthetic.png`;
  await runtime.runtimeStore().attachEvidence(journey.problem.problem_id, id, {
    evidence_id: "ev_hosted_thumbnail", kind: "photo", content: ref,
    captured_at: "2026-09-09T15:50:00+00:00", privacy: "private", field_key: "thermostat_photo",
  });
  const sharp = (await import("sharp")).default;
  const original = await sharp({ create: { width: 30, height: 20, channels: 3, background: "white" } }).png().toBuffer();
  const read = vi.spyOn(mediaAdapter, "readPrivateMediaBytes").mockResolvedValue(original);
  const loaded = await loadPacket(id, { owner: true, link_base: origin });
  expect(read).toHaveBeenCalledWith(ref);
  const uri = loaded!.input!.evidence.media[0].thumbnail_data_uri!;
  expect(uri).toMatch(/^data:image\/jpeg;base64,/);
  const derivative = Buffer.from(uri.split(",")[1], "base64");
  expect(derivative.equals(original)).toBe(false);
  expect((await sharp(derivative).metadata()).exif).toBeUndefined();
});

it("actual owner HTML and real PDF expose only recorded, independently revocable link IDs", async () => {
  expect(pdfRendererAvailable(), "A real configured PDF renderer is required; do not silently skip").toBe(true);
  const id = await createPacket();
  const html = await htmlGet(new Request(origin + "/packet/" + id), params(id));
  expect(html.status).toBe(200); expect(html.headers.get("x-packet-self-check")).toBe("ok");
  const htmlUrls = [...(await html.text()).matchAll(/href="([^"]+)"/g)].map(match => match[1]);
  const htmlIds = await assertRecordedAndRevocable(id, ownerTokens(htmlUrls));

  const response = await pdfGet(new Request(origin + "/packet/" + id + "/pdf"), params(id));
  expect(response.status).toBe(200); expect(response.headers.get("content-type")).toBe("application/pdf");
  const bytes = Buffer.from(await response.arrayBuffer());
  expect(bytes.subarray(0, 4).toString()).toBe("%PDF"); expect(bytes.length).toBeGreaterThan(10_000);
  expect(countPdfPages(bytes)).toBe(3);
  // Chromium writes actual clickable PDF annotations as URI literal strings.
  const pdfUrls = [...bytes.toString("latin1").matchAll(/\/URI\s*\(([^)]+)\)/g)].map(match => match[1]);
  const pdfIds = await assertRecordedAndRevocable(id, ownerTokens(pdfUrls));
  expect(pdfIds.every(value => !htmlIds.includes(value))).toBe(true);
  expect(await listIssuedLinks(id)).toHaveLength(6);
}, 60_000);

it("provider copies mint no owner links and unauthorized/missing/safety gates stay before issuance", async () => {
  const id = await createPacket();
  const shared = signLink({ scope: "packet", request_id: id });
  const provider = await htmlGet(new Request(origin + "/packet/" + id + "?share=" + shared), params(id));
  expect(provider.status).toBe(200); expect(await provider.text()).not.toMatch(/href="[^"]*\/(keep|ask|media)\//);
  expect(await listIssuedLinks(id)).toHaveLength(0);
  cookieJar.clear();
  expect((await htmlGet(new Request(origin + "/packet/" + id), params(id))).status).toBe(404);
  expect((await pdfGet(new Request(origin + "/packet/" + id + "/pdf"), params(id))).status).toBe(404);
  expect(await loadPacket("rq_missing_packet", { owner: true, link_base: origin })).toBeNull();
  expect(await listIssuedLinks(id)).toHaveLength(0);
  const safety = await answerPost(post("/api/intake/answer", { request_id: id,
    k: signLink({ scope: "keep", request_id: id }), fields: [{ field_key: "safety_signals", value: "Burning smell" }] }));
  expect(safety.status).toBe(200);
  expect(await safety.json()).toMatchObject({ safety: { intake_may_continue: false } });
  expect((await loadPacket(id, { owner: true, link_base: origin }))?.safety_halt).toBeTruthy();
  const owner = signLink({ scope: "keep", request_id: id });
  for (const [handler, suffix] of [[htmlGet, ""], [pdfGet, "/pdf"]] as const) {
    const response = await handler(new Request(origin + "/packet/" + id + suffix + "?k=" + owner), params(id));
    expect(response.status).toBe(303); expect(response.headers.get("location")).toContain("/safety/");
  }
  expect(await listIssuedLinks(id)).toHaveLength(0);
});

it.each(scopes)("shared %s acknowledgement failure refuses loader, HTML and PDF without exposing unacknowledged tokens", async failedScope => {
  const id = await createPacket();
  const store = runtime.runtimeStore();
  const shared = new Proxy(store, { get(target, property, receiver) {
    return property === "kind" ? "supabase" : Reflect.get(target, property, receiver);
  } });
  vi.spyOn(runtime, "runtimeStore").mockReturnValue(shared);
  const journey = (await store.getJourney(id))!;
  const rpc = vi.fn(async (_name: string, input: { p_link: { scope: string }; p_request_id: string; p_tenant_id: string }) =>
    input.p_link.scope === failedScope
      ? { data: null, error: { message: "SYNTHETIC_PRIVATE_BACKEND_DETAIL" } }
      : { data: { ...input.p_link, request_id: input.p_request_id, tenant_id: input.p_tenant_id, problem_id: journey.problem.problem_id }, error: null });
  vi.spyOn(dbClient, "requireServiceClient").mockReturnValue({ rpc } as unknown as ReturnType<typeof dbClient.requireServiceClient>);
  await expect(loadPacket(id, { owner: true, link_base: origin })).rejects.toThrow("Shared link history is unavailable.");
  for (const [handler, suffix] of [[htmlGet, ""], [pdfGet, "/pdf"]] as const) {
    const response = await handler(new Request(origin + "/packet/" + id + suffix), params(id));
    expect(response.status).toBe(404);
    const body = await response.text();
    expect(body).not.toMatch(/SYNTHETIC_PRIVATE_BACKEND_DETAIL|\/keep\/|\/ask\/|\/media\/|%PDF/);
  }
  const attempts = scopes.slice(0, scopes.indexOf(failedScope) + 1);
  expect(rpc).toHaveBeenCalledTimes(3 * attempts.length);
  expect(rpc.mock.calls.map(([, input]) => input.p_link.scope)).toEqual([...attempts, ...attempts, ...attempts]);
  for (const [name, input] of rpc.mock.calls) {
    expect(name).toBe("register_request_link"); expect(input.p_request_id).toBe(id);
  }
});
