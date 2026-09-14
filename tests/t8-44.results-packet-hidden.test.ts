import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ResultsTemplate } from "@/components/results/ResultsTemplate";
import { renderPacketHtml } from "@/domain/packet/render";
import { referenceInput } from "./loop.p1.fixtures";
import { FEATURES } from "@/platform/features/registry";
import { invalidateFeatureStates } from "@/platform/features/state";
import { loadPacket, resolvePacketAccess } from "@/platform/packet/load";
import ResultsPage from "@/app/results/[request_id]/page";

const fixture = vi.hoisted(() => ({
  live: new Set<string>(), minted: [] as string[],
  journey: { session: { guest_session_id: "synthetic-session" }, problem: { problem_id: "synthetic-problem", safety_rule_id: null }, packet: { job_packet_id: "synthetic-packet", packet_version: 1, generated_at: "2026-09-03T15:42:00Z" } },
  claim: vi.fn(async () => ({ magic_link_id: "synthetic-claim" })),
  answers: vi.fn(async () => [{ ask_id: "answer-1", provider_name: "Private answer", friend_name: "Private friend", reason: "Private reason" }]),
}));
vi.mock("@/platform/stores/runtime", () => ({ runtimeStore: () => store }));
vi.mock("@/platform/links/ledger", () => ({
  issueLink: async ({ scope }: { scope: string }) => { fixture.minted.push(scope); return { token: `synthetic-${scope}` }; },
  readKeepState: async () => ({ confirmed_at: "2026-09-03", magic_id: "synthetic-claim" }),
}));
vi.mock("@/platform/links/owner", () => ({ ownerAllowed: async () => true }));
vi.mock("@/platform/links/tokens", () => ({ verifyLink: async () => ({ ok: true, request_id: "synthetic-request", link_id: "synthetic-link" }) }));
vi.mock("@/platform/flags", () => ({ flagEnabled: () => true }));
vi.mock("@/platform/feedback/eligible", () => ({ feedbackEligible: async () => false }));
vi.mock("@/platform/events/customer", () => ({ recordCustomerEvent: async () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/platform/intake/complete", () => ({ loadJourneyContext: async () => ({ journey: fixture.journey, allEvidence: [] }) }));
vi.mock("@/platform/intake/media", () => ({ readLabelConfidence: async () => [] }));
vi.mock("@/domain/packet/directions-input", () => ({ buildDirectionsInput: (_ctx: unknown, options: object) => {
  const input = referenceInput(); input.config = { ...input.config, ...options }; return input;
} }));
const store = {
  kind: "file", getJourney: async () => fixture.journey,
  getKeepClaim: fixture.claim, listAskAnswers: fixture.answers,
  getJobAddress: async () => ({ street: "Synthetic", city_state_zip: "Test" }),
  listIntakeAnswers: async () => [], listDiagnosisAnswers: async () => [], listClaims: async () => [],
  listFeatureStates: async (tenant_id: string) => FEATURES.map(feature => ({ tenant_id, feature_id: feature.id,
    state: fixture.live.has(feature.id) ? "LIVE" : feature.marketing_path ? "PREVIEW" : "HIDDEN", version: 1,
    actor: "test", reason: "synthetic test", decision_ref: "D5", updated_at: "2026-09-13" })),
};
beforeEach(() => { fixture.live.clear(); fixture.minted.length = 0; fixture.claim.mockClear(); fixture.answers.mockClear(); invalidateFeatureStates(); });
afterEach(() => invalidateFeatureStates());
const renderResults = async () => renderToStaticMarkup(await ResultsPage({ params: Promise.resolve({ request_id: "synthetic-request" }), searchParams: Promise.resolve({ kept: "1" }) }));
const hiddenLabels = ["Save this to my home", "Not now", "Ask my people", "Who would you call for this?", "I already have someone", "Send your Job Packet to the person you already have", "Find someone for me", "Keep this", "Links you shared", "Your house is an asset with amnesia.", "You already know someone who knows someone.", "Opens already filled in", "They answer in a tap"];

it("launch Results hides entire bands, receipts and private answers before reading or minting, but preserves the four preview cards", async () => {
  const html = await renderResults();
  for (const label of hiddenLabels) expect(html).not.toContain(label);
  expect(html).not.toMatch(/href="[^"]*(?:\/keep\/|\/ask\/|\/links\/|\/p\/|\/send|\/find|\/account)/);
  expect(html).not.toContain("Private answer"); expect(html).not.toContain("Saved to Home Memory");
  expect(fixture.claim).not.toHaveBeenCalled(); expect(fixture.answers).not.toHaveBeenCalled(); expect(fixture.minted).toEqual([]);
  const order = ["Your Job Packet</p>", "Open my Job Packet", "Email it to me instead", "All four, free to you", "01 · CUSTOMER DASHBOARD", "02 · TRUST NETWORK", "03 · SMARTQUOTE ANALYZER", "04 · HOME MEMORY", "This is a preparation record."];
  let prior = -1; for (const label of order) { const position = html.indexOf(label); expect(position).toBeGreaterThan(prior); prior = position; }
});
it("runtime restoration brings back saved bands and receipts, then hides again without a code change", async () => {
  ["keep", "ask", "send", "find", "shared_links"].forEach(id => fixture.live.add(id));
  let html = await renderResults();
  for (const label of ["Save this to my home", "Ask my people", "I already have someone", "Find someone for me", "Saved to Home Memory", "Private answer"]) expect(html).toContain(label);
  expect(fixture.minted).toEqual(["keep", "ask"]);
  fixture.live.clear(); invalidateFeatureStates(); fixture.minted.length = 0;
  html = await renderResults(); expect(html).not.toContain("Save this to my home"); expect(fixture.minted).toEqual([]);
});
it("send never leaks through the restored ask answers while shared links remain hidden", async () => {
  fixture.live.add("ask"); fixture.live.add("send");
  const html = await renderResults(); expect(html).toContain("Private answer"); expect(html).not.toContain("/send");
});
it("an unspecified template visibility fails closed", () => {
  const html = renderToStaticMarkup(createElement(ResultsTemplate, { requestId: "test", keepHref: "/keep/test", askHref: "/ask/test" }));
  expect(html).not.toContain("/keep/"); expect(html).not.toContain("/ask/");
});
it("loader mints nothing for hidden owner actions, and share access refuses even a valid token", async () => {
  const loaded = await loadPacket("synthetic-request", { owner: true, link_base: "https://example.test" });
  expect(loaded!.input!.config).toMatchObject({ owner_actions: true, qr_visibility: { keep: false, ask: false }, home_memory_url: "", trust_network_url: "", media_link: null });
  const rendered = renderPacketHtml(loaded!.input!); expect(rendered.self_check.ok).toBe(true);
  for (const label of [...hiddenLabels, "Shared provider copy", "Home Memory", "Trust Network"]) expect(rendered.html.slice(rendered.html.indexOf("<body>"))).not.toContain(label);
  expect(fixture.minted).toEqual([]);
  expect(await resolvePacketAccess("synthetic-request", "synthetic-token")).toEqual({ ok: false, status: 404 });
});
it.each(["keep", "ask"] as const)("%s QR requires both the flow and its card LIVE, and remains independently reversible", async flow => {
  fixture.live.add(`pdf_${flow}_qr`);
  let loaded = await loadPacket("synthetic-request", { owner: true, link_base: "https://example.test" });
  expect(fixture.minted).toEqual([]);
  fixture.live.add(flow); invalidateFeatureStates();
  loaded = await loadPacket("synthetic-request", { owner: true, link_base: "https://example.test" });
  expect(fixture.minted).toEqual([flow]);
  const rendered = renderPacketHtml(loaded!.input!); expect(rendered.self_check.ok).toBe(true);
  expect(rendered.html.match(/<article class="x-card/g)).toHaveLength(1);
  expect(rendered.html).toContain(`/${flow}/synthetic-${flow}`);
  fixture.live.delete(`pdf_${flow}_qr`); invalidateFeatureStates(); fixture.minted.length = 0;
  loaded = await loadPacket("synthetic-request", { owner: true, link_base: "https://example.test" });
  expect(fixture.minted).toEqual([]); expect(renderPacketHtml(loaded!.input!).html).not.toContain('<article class="x-card');
});
it("a live shared-links state restores media issuance; provider copies never receive owner capabilities", async () => {
  ["shared_links", "keep", "ask", "pdf_keep_qr", "pdf_ask_qr"].forEach(id => fixture.live.add(id));
  await loadPacket("synthetic-request", { owner: true, link_base: "https://example.test" });
  expect(fixture.minted).toEqual(["keep", "ask", "media"]);
  expect(await resolvePacketAccess("synthetic-request", "synthetic-token")).toMatchObject({ ok: true, owner: false });
  fixture.minted.length = 0;
  const provider = await loadPacket("synthetic-request", { owner: false, link_base: "https://example.test" });
  expect(fixture.minted).toEqual([]); expect(renderPacketHtml(provider!.input!).self_check.ok).toBe(true);
});

describe("immutable approved source and reversible PDF layout", () => {
  it("pins the exact approved PDF mockup independently of the runtime renderer", () => {
    const source = readFileSync("tests/fixtures/loop/MOCKUP-1-job-packet-pdf.html", "utf8").replace(/\r\n/g, "\n");
    expect(createHash("sha256").update(source).digest("hex")).toBe("d1544692b8103c25351cc8df984e48dd1eb41832ea1f2bf6fca3203d8ffef16e");
    expect(source.match(/<article class="x-card/g)).toHaveLength(2);
    expect(source.match(/<div class="x-qr"/g)).toHaveLength(2);
  });
  it.each([
    ["ResultsTemplate.tsx.txt", "af4bb3d2ec0bd3cf1c8249990133b7c3d9e0da5f635f7b4ca6fb35d050e593f1"],
    ["render.ts.txt", "b55ef8d892c3ee3f78ba0177afa0d6242c07aa3b358a9d5ce35cc42f1e066ca1"],
  ])("keeps the independently pinned pre-change %s", (file, hash) => {
    const source = readFileSync(`tests/fixtures/d5-approved/${file}`, "utf8").replace(/\r\n/g, "\n");
    expect(createHash("sha256").update(source).digest("hex")).toBe(hash);
  });
  it("retains both exact approved QR article bodies behind the runtime switches", () => {
    const saved = readFileSync("tests/fixtures/d5-approved/render.ts.txt", "utf8");
    const current = readFileSync("src/domain/packet/render.ts", "utf8");
    const blocks = (text: string) => [...text.matchAll(/<article class="x-card [\s\S]*?<\/article>/g)].map(m => m[0].replace(/\r\n/g, "\n"));
    expect(blocks(saved)).toHaveLength(2); expect(blocks(current)).toEqual(blocks(saved));
  });
  it("removes the entire QR grid with no orphan caption; the call script immediately follows and pages 2 and 3 are unchanged", () => {
    const input = referenceInput(); const saved = renderPacketHtml(input);
    input.config.qr_visibility = { keep: false, ask: false }; const hidden = renderPacketHtml(input);
    expect(hidden.self_check.ok).toBe(true); expect(hidden.html).toMatch(/<section class="x-act">\s*<article class="x-script">/);
    for (const label of hiddenLabels) expect(hidden.html).not.toContain(label);
    const tail = (html: string) => html.slice(html.indexOf('<!-- ============ PROVIDER PAGE 1'));
    expect(tail(saved.html).length).toBeGreaterThan(1000); expect(tail(hidden.html)).toEqual(tail(saved.html));
    input.config.qr_visibility = { keep: true, ask: true };
    expect(renderPacketHtml(input).html).toBe(saved.html);
  });
});
