import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  aiProviderConfigured,
  defaultAiProvider,
  resetAiProviderForTests,
} from "@/platform/ai/client";
import {
  MODEL_CATALOGUE,
  MODEL_CATALOGUE_PROBED_AT,
  actualModelCost,
  estimateModelCall,
  findModel,
} from "@/platform/ai/models";
import {
  OPENROUTER_PROVIDER_ID,
  createOpenRouterProvider,
} from "@/platform/ai/providers/openrouter";
import type { ModelCallInput } from "@/platform/ai/provider";

/**
 * AI STEP 1 — THE PORT, THE VENDOR FILE, AND THE MODEL CATALOGUE.
 *
 * What these tests are actually protecting: the promise that the model is
 * swappable. If a vendor name leaks past provider.ts, or a price becomes a
 * literal at a call site, or the provider throws on a bad day, the swap stops
 * being a data edit and becomes a rewrite.
 */

const SECRET = "sk-or-v1-TESTONLY-not-a-real-credential-000000";

function input(overrides: Partial<ModelCallInput> = {}): ModelCallInput {
  return {
    modelId: "stealth/ox-alpha",
    system: "Answer with JSON.",
    user: "ping",
    schemaName: "probe",
    jsonSchema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] },
    mode: "json_object",
    maxTokens: 64,
    timeoutMs: 5_000,
    dataCollection: "deny",
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("the model port keeps vendors on one side of a line", () => {
  it("only the OpenRouter provider file names the OpenRouter endpoint", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(entry)) files.push(full);
      }
    };
    walk(join(process.cwd(), "src"));
    for (const file of files) {
      const normalized = file.replace(/\\/g, "/");
      if (normalized.endsWith("platform/ai/providers/openrouter.ts")) continue;
      // models.ts CITES the probe URL as the provenance of its prices — the same
      // distinction platform/economics/rates.ts draws, and the same one the
      // client-boundary test draws when it allows PolicyForm to NAME a
      // server-side type in prose. Quoting where a number came from is not
      // calling an endpoint. What must not exist outside the provider file is a
      // REQUEST to one.
      if (normalized.endsWith("platform/ai/models.ts")) {
        const code = readFileSync(file, "utf-8");
        expect(code, file).not.toMatch(/fetch\s*\(/);
        continue;
      }
      expect(readFileSync(file, "utf-8"), file).not.toMatch(/openrouter\.ai/);
    }
  });

  it("the port itself carries no vendor type, name or import", () => {
    const port = readFileSync(join(process.cwd(), "src/platform/ai/provider.ts"), "utf-8");
    const code = port.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/\bimport\b/);
    expect(code).not.toMatch(/openrouter|openai|anthropic|deepseek/i);
  });

  it("no capability wiring names a model id — models come from config", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(entry)) files.push(full);
      }
    };
    walk(join(process.cwd(), "src"));
    for (const file of files) {
      const normalized = file.replace(/\\/g, "/");
      // models.ts IS the catalogue; policy.ts names the default the owner may edit.
      if (normalized.endsWith("platform/ai/models.ts")) continue;
      if (normalized.endsWith("platform/ai/policy.ts")) continue;
      const code = readFileSync(file, "utf-8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      for (const model of MODEL_CATALOGUE) {
        expect(code, `${file} hardcodes model ${model.id}`).not.toContain(model.id);
      }
    }
  });
});

describe("the model catalogue is data, sourced and dated", () => {
  it("every seeded model carries its probe as its price source", () => {
    for (const model of MODEL_CATALOGUE) {
      expect(model.price_source, model.id).toContain(MODEL_CATALOGUE_PROBED_AT);
      expect(model.price_source, model.id).toMatch(/openrouter\.ai\/api\/v1\/models/);
    }
  });

  it("the free starting model is json_object mode — it has no strict-schema support", () => {
    const ox = findModel("stealth/ox-alpha")!;
    expect(ox.mode).toBe("json_object");
    expect(ox.free).toBe(true);
    expect(ox.price_in_per_mtok).toBe(0);
    expect(ox.price_out_per_mtok).toBe(0);
  });

  it("both structured-output modes are represented, so a swap has somewhere to go", () => {
    const modes = new Set(MODEL_CATALOGUE.map((m) => m.mode));
    expect(modes.has("json_object")).toBe(true);
    expect(modes.has("json_schema")).toBe(true);
  });

  it("NO seeded model is cleared for customer data — the fail-closed default", () => {
    for (const model of MODEL_CATALOGUE) {
      expect(model.allows_customer_data, model.id).toBe(false);
    }
  });

  it("an unknown model is unestimable, and unestimable means refused — never free", () => {
    const estimate = estimateModelCall("some/model-nobody-registered", 4_000, 500);
    expect(estimate.known).toBe(false);
    expect(estimate.estimated_usd).toBe(Number.POSITIVE_INFINITY);
    expect(actualModelCost("some/model-nobody-registered", 10, 10).known).toBe(false);
  });

  it("estimates price the OUTPUT CEILING, not a hoped-for short answer", () => {
    const cheap = estimateModelCall("deepseek/deepseek-v4-flash", 4_000, 100);
    const dear = estimateModelCall("deepseek/deepseek-v4-flash", 4_000, 4_000);
    expect(dear.estimated_usd).toBeGreaterThan(cheap.estimated_usd);
  });

  it("every derived dollar figure is TEST-labeled, vendor prices are not", () => {
    expect(estimateModelCall("stealth/ox-alpha", 100, 100).figure_label).toBe("TEST");
    expect(actualModelCost("stealth/ox-alpha", 100, 100).figure_label).toBe("TEST");
    // The vendor's own price is a sourced fact and carries its source, not a TEST label.
    expect(findModel("deepseek/deepseek-v4-flash")!.price_in_per_mtok).toBe(0.0886);
  });
});

describe("the provider never throws, and never leaks the key", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("sends json_schema strict mode when the model supports it", async () => {
    let captured: Record<string, unknown> = {};
    globalThis.fetch = vi.fn(async (_url, init) => {
      captured = JSON.parse(String((init as RequestInit).body));
      return jsonResponse({
        id: "gen_1",
        choices: [{ message: { content: '{"ok":true}' }, finish_reason: "stop" }],
        usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13, cost: 0 },
      });
    }) as unknown as typeof fetch;

    const provider = createOpenRouterProvider(SECRET);
    const result = await provider.complete(input({ mode: "json_schema" }));

    expect(result.ok).toBe(true);
    const format = captured.response_format as { type: string; json_schema?: { strict?: boolean } };
    expect(format.type).toBe("json_schema");
    expect(format.json_schema?.strict).toBe(true);
  });

  it("falls back to json_object mode and sends no schema to the API", async () => {
    let captured: Record<string, unknown> = {};
    globalThis.fetch = vi.fn(async (_url, init) => {
      captured = JSON.parse(String((init as RequestInit).body));
      return jsonResponse({
        id: "gen_2",
        choices: [{ message: { content: '{"ok":true}' }, finish_reason: "stop" }],
        usage: { prompt_tokens: 8, completion_tokens: 2, total_tokens: 10 },
      });
    }) as unknown as typeof fetch;

    const provider = createOpenRouterProvider(SECRET);
    const result = await provider.complete(input({ mode: "json_object" }));

    expect(result.ok).toBe(true);
    expect(captured.response_format).toEqual({ type: "json_object" });
  });

  it("sends the privacy routing preference the caller asked for", async () => {
    let captured: Record<string, unknown> = {};
    globalThis.fetch = vi.fn(async (_url, init) => {
      captured = JSON.parse(String((init as RequestInit).body));
      return jsonResponse({
        choices: [{ message: { content: "{}" }, finish_reason: "stop" }],
      });
    }) as unknown as typeof fetch;

    await createOpenRouterProvider(SECRET).complete(input({ dataCollection: "deny" }));
    expect(captured.provider).toEqual({ data_collection: "deny" });
  });

  it("retries a 429 and reports rate_limited when the pool stays saturated", async () => {
    const fetchMock = vi.fn(async () =>
      new Response("upstream_provider_shared_pool", { status: 429 })
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await createOpenRouterProvider(SECRET).complete(input());

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("rate_limited");
    expect(result.attempts).toBeGreaterThan(1);
    expect(fetchMock.mock.calls.length).toBe(result.attempts);
  });

  it("a 429 that clears on retry succeeds — the customer never sees the blip", async () => {
    let call = 0;
    globalThis.fetch = vi.fn(async () => {
      call += 1;
      if (call === 1) return new Response("busy", { status: 429 });
      return jsonResponse({
        id: "gen_3",
        choices: [{ message: { content: '{"ok":true}' }, finish_reason: "stop" }],
      });
    }) as unknown as typeof fetch;

    const result = await createOpenRouterProvider(SECRET).complete(input());
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.attempts).toBe(2);
  });

  it("a 401 is no_key, and the detail carries no credential", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: "invalid api key" }), { status: 401 })
    ) as unknown as typeof fetch;

    const result = await createOpenRouterProvider(SECRET).complete(input());
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("no_key");
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it("an aborted request is a timeout, not a retry storm", async () => {
    const fetchMock = vi.fn(async (_url: unknown, init: RequestInit) => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      const err = new Error("aborted");
      err.name = "AbortError";
      void init;
      throw err;
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await createOpenRouterProvider(SECRET).complete(input({ timeoutMs: 10 }));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("timeout");
    expect(result.attempts).toBe(1);
  });

  /**
   * FOUND BY THE LIVE SMOKE, 2026-08-25, not by reading. A 100-token ceiling on
   * stealth/ox-alpha returned `finish_reason: length` with no content at all —
   * the model spent its whole output budget before emitting the object. The
   * detail has to name that, because "invalid JSON" sends an owner looking for a
   * parsing bug in a reply that was never JSON to begin with.
   */
  it("a truncated reply names the ceiling as the cause, not the JSON", async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({ choices: [{ message: { content: "" }, finish_reason: "length" }] })
    ) as unknown as typeof fetch;

    const result = await createOpenRouterProvider(SECRET).complete(input());
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("invalid_json");
    expect(result.detail).toMatch(/output ceiling/);
    expect(result.detail).toMatch(/max_output_tokens/);
  });

  it("a content-filter stop is `refused`, never an empty pass", async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({ choices: [{ message: { content: null }, finish_reason: "content_filter" }] })
    ) as unknown as typeof fetch;

    const result = await createOpenRouterProvider(SECRET).complete(input());
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("refused");
  });

  it("a thrown network error becomes a typed result — the provider NEVER rejects", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("ECONNRESET");
    }) as unknown as typeof fetch;

    const result = await createOpenRouterProvider(SECRET).complete(input());
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("http_error");
    expect(result.detail).toMatch(/ECONNRESET/);
  });

  it("the key travels in the Authorization header and nowhere else", async () => {
    let seen: RequestInit = {};
    globalThis.fetch = vi.fn(async (_url, init) => {
      seen = init as RequestInit;
      return jsonResponse({ choices: [{ message: { content: "{}" } }] });
    }) as unknown as typeof fetch;

    await createOpenRouterProvider(SECRET).complete(input());
    const headers = seen.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${SECRET}`);
    expect(String(seen.body)).not.toContain(SECRET);
  });
});

describe("the provider factory mirrors the database seam", () => {
  const saved = process.env.OPENROUTER_API_KEY;
  beforeEach(() => resetAiProviderForTests());
  afterEach(() => {
    if (saved === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = saved;
    resetAiProviderForTests();
  });

  it("no key means null — a deployment with no model, not an error", () => {
    delete process.env.OPENROUTER_API_KEY;
    expect(aiProviderConfigured()).toBe(false);
    expect(defaultAiProvider()).toBeNull();
  });

  it("a key means a provider, and the same one twice", () => {
    process.env.OPENROUTER_API_KEY = SECRET;
    expect(aiProviderConfigured()).toBe(true);
    const first = defaultAiProvider();
    expect(first?.id).toBe(OPENROUTER_PROVIDER_ID);
    expect(defaultAiProvider()).toBe(first);
  });
});
