import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const browserState = vi.hoisted(() => ({ cookie: undefined as string | undefined }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => browserState.cookie ? { value: browserState.cookie } : undefined }) }));
vi.mock("@/platform/stores/runtime", () => ({ runtimeStore: () => { throw new Error("Hosted sample must never construct a runtime store"); } }));
vi.mock("@/platform/ai/client", () => ({ getAiClient: () => { throw new Error("Hosted sample must never call a model"); } }));

import { buildHostedSample, emptyHostedSampleState, HOSTED_SAMPLE_COOKIE, hostedWalkthrough, parseHostedSampleState, renderHostedSamplePacket } from "@/domain/demo/hosted-sample";
import { ResultsTemplate } from "@/components/results/ResultsTemplate";
import { POST as choose } from "@/app/demo/sample/choose/route";
import { GET as packet } from "@/app/demo/sample/packet/route";
import { metadata as sampleMetadata } from "@/app/demo/sample/layout";

beforeEach(() => { browserState.cookie = undefined; });

function choice(body: string, origin = "http://localhost:3188") {
  return new Request("http://localhost:3188/demo/sample/choose", { method: "POST", headers: { Origin: origin, "Content-Type": "application/x-www-form-urlencoded" }, body });
}

describe("the hosted prepared sample has no runtime prerequisite", () => {
  it("reconstructs identical synthetic records without storage, credentials or model calls", () => {
    expect(buildHostedSample()).toEqual(buildHostedSample());
    const sample = buildHostedSample();
    expect(sample.journey.session.consent_event_ids).toEqual([]);
    expect(sample.input.property.street).toContain("synthetic");
    expect(sample.input.config.home_memory_url).toBe("https://prn-test-site.vercel.app/demo/sample/keep");
    expect(sample.input.config.trust_network_url).toBe("https://prn-test-site.vercel.app/demo/sample/ask");
    const rendered = renderHostedSamplePacket();
    expect(rendered.self_check.ok).toBe(true);
    expect(rendered.halted).toBe(false);
    expect(rendered.html.match(/Prepared sample/g)).toHaveLength(3);
    expect(rendered.html).toContain("My AC is running but blowing warm air");
    expect(rendered.html).not.toMatch(/\/keep\/eyJ|\/ask\/eyJ|api\/intake/);
  });

  it("keeps the original approved results text while isolating every request action href", () => {
    const props = { requestId: "rq_public_example", keepHref: "/demo/sample/keep", askHref: "/demo/sample/ask" };
    const original = renderToStaticMarkup(createElement(ResultsTemplate, props));
    const hosted = renderToStaticMarkup(createElement(ResultsTemplate, { ...props, navigation: { packet: "/demo/sample/packet", email: "/demo/sample/email", send: "/demo/sample/send", find: "/demo/sample/find" } }));
    const text = (html: string) => html.replace(/<[^>]*>/g, "");
    expect(text(hosted)).toBe(text(original));
    for (const target of ["packet", "email", "send", "find", "keep", "ask"]) expect(hosted).toContain(`href="/demo/sample/${target}"`);
    expect(hosted).not.toContain("/results/rq_");
    expect(hosted).not.toContain("/packet/rq_");
  });

  it("rejects origins with embedded credentials or paths before forming packet links", () => {
    for (const origin of ["https://example.com/path", "https://user:password@example.com", "javascript:alert(1)"]) expect(() => buildHostedSample(origin)).toThrow();
  });
});

describe("sample browser choices are bounded examples, never authority", () => {
  it.each([undefined, "invalid", "x".repeat(2801), JSON.stringify({ v: 1, trail: [], kept: true, contact: "personal@example.com" }), JSON.stringify({ v: 1, trail: ["personal@example.com"], kept: false }), JSON.stringify({ v: 1, trail: Array(21).fill("0"), kept: false })])("discards malformed or unapproved cookie input", raw => {
    expect(parseHostedSampleState(raw)).toEqual(emptyHostedSampleState());
  });

  it("projects only the currently reached step and retains no hidden playbook graph", () => {
    const first = hostedWalkthrough()!;
    expect(first.step?.step_id).toBe("filter");
    expect(first.step).not.toHaveProperty("branches");
    expect(first).not.toHaveProperty("diagnostic_steps");
    const second = hostedWalkthrough(["0"]);
    expect(second).not.toBeNull();
    expect(second?.step?.step_id).not.toBe(first.step?.step_id);
    const state = parseHostedSampleState(JSON.stringify({ v: 1, trail: ["0"], kept: true }));
    expect(state.trail).toEqual(["0"]);
    expect(state.kept).toBe(true);
  });

  it("does not retain the prepared clean-filter claim when exploring a different fictional answer", () => {
    const sample = buildHostedSample(undefined, { v: 1, trail: ["10"], kept: false });
    expect(sample.journey.problem.problem_summary).not.toContain("The filter is clean");
    expect(sample.diagnosis[0]).toMatchObject({ step_id: "filter", answer: "10" });
    expect(renderHostedSamplePacket(undefined, { v: 1, trail: ["10"], kept: false }).self_check.ok).toBe(true);
  });

  it("records an allowed example choice in a short sample-only cookie", async () => {
    expect(sampleMetadata.referrer).toBe("same-origin");
    const response = await choose(choice("action=answer&step=filter&answer=0"));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/demo/sample/walkthrough");
    const cookie = response.headers.get("set-cookie")!;
    expect(cookie).toContain(HOSTED_SAMPLE_COOKIE + "=");
    expect(cookie).toContain("Path=/demo/sample");
    expect(cookie).toContain("HttpOnly");
    expect(cookie.length).toBeLessThan(3000);
    expect(cookie).not.toMatch(/prn_owner_|prn_admin/);
  });

  it("refuses arbitrary steps, free text, cross-origin posts and oversized payloads", async () => {
    expect((await choose(choice("action=answer&step=guessed&answer=0"))).status).toBe(409);
    expect((await choose(choice("action=answer&step=filter&answer=personal%40example.com"))).status).toBe(409);
    expect((await choose(choice("action=keep", "https://attacker.example"))).status).toBe(403);
    expect((await choose(choice("action=keep", "null"))).status).toBe(403);
    expect((await choose(choice("action=keep&unknown=" + "x".repeat(1100)))).status).toBe(400);
  });

  it("cancels oversized streamed choices even with a dishonest zero content length", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(1025)); }, cancel });
    const request = new Request("http://localhost:3188/demo/sample/choose", { method: "POST", headers: { Origin: "http://localhost:3188", "Content-Type": "application/x-www-form-urlencoded", "Content-Length": "0" }, body: stream, duplex: "half" } as RequestInit);
    const response = await choose(request);
    expect(response.status).toBe(400);
    expect(cancel).toHaveBeenCalledOnce();
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("cancels a stalled choice stream at its deadline without setting state", async () => {
    vi.useFakeTimers();
    try {
      const cancel = vi.fn();
      const stream = new ReadableStream<Uint8Array>({ pull: () => new Promise(() => {}), cancel });
      const request = new Request("http://localhost:3188/demo/sample/choose", { method: "POST", headers: { Origin: "http://localhost:3188", "Content-Type": "application/x-www-form-urlencoded" }, body: stream, duplex: "half" } as RequestInit);
      const pending = choose(request);
      await vi.advanceTimersByTimeAsync(5000);
      const response = await pending;
      expect(response.status).toBe(400);
      expect(cancel).toHaveBeenCalledOnce();
      expect(response.headers.get("set-cookie")).toBeNull();
    } finally { vi.useRealTimers(); }
  });

  it("serves actual packet HTML with truthful fixed-PDF and current-view actions", async () => {
    browserState.cookie = JSON.stringify({ v: 1, trail: ["0"], kept: false });
    const response = await packet(new Request("https://sample.example/demo/sample/packet"));
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html).toContain("This view includes your sample choices");
    expect(html).toContain('href="/demo/sample/packet.pdf"');
    expect(html).toContain("Print this view");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});
