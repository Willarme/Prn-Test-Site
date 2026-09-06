import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callModel, type CallModelDeps } from "@/platform/ai/callModel";
import { MODEL_CATALOGUE, findModel } from "@/platform/ai/models";
import { AiPolicy, DEFAULT_AI_POLICY } from "@/platform/ai/policy";
import { FileAiPolicyStore, MemoryAiPolicyStore } from "@/platform/ai/policy-store";
import type { ModelCallInput, ModelCallResult, ModelProvider } from "@/platform/ai/provider";
import { buildBody, createOpenRouterProvider } from "@/platform/ai/providers/openrouter";
import { MemorySpendLedger } from "@/platform/ai/spend";
import { resolveCapability } from "@/platform/capabilities/registry";
import { TRIAL_AGENT_REGISTRY } from "@/platform/agents/registry";
import { jpegCarriesMetadata } from "@/platform/media/exif";
import {
  LABEL_REPLY_JSON_SCHEMA,
  LabelReply,
  readEquipmentLabel,
} from "@/platform/problem/ai-label";
import { recentAgentRuns, resetAgentRunLedgerForTests } from "@/platform/runs/ledger";
import { resetKillSwitchForTests } from "@/platform/killswitch";

/**
 * F2a — `read_equipment_label`, end to end through the governed door with a
 * stubbed provider. What is pinned: the bytes leave stripped, the reply is
 * validated strictly, every failure is `readable: false` and never a throw,
 * the gate refuses when the flag is off, and a photo cannot reach a text-only
 * model.
 */

function segment(marker: number, payload: Buffer): Buffer {
  const len = Buffer.alloc(2);
  len.writeUInt16BE(payload.length + 2);
  return Buffer.concat([Buffer.from([0xff, marker]), len, payload]);
}
const GPS_SENTINEL = "PRN-FAKE-GPS-SENTINEL";
const JPEG_WITH_EXIF = Buffer.concat([
  Buffer.from([0xff, 0xd8]),
  segment(0xe0, Buffer.from("JFIF\0\x01\x01\0\0\x01\0\x01\0\0", "latin1")),
  segment(0xe1, Buffer.from(`Exif\0\0II*\0GPS ${GPS_SENTINEL}`, "latin1")),
  segment(0xdb, Buffer.concat([Buffer.from([0]), Buffer.alloc(64, 1)])),
  segment(0xc0, Buffer.from([8, 0, 1, 0, 1, 1, 1, 0x11, 0])),
  segment(0xc4, Buffer.concat([Buffer.from([0]), Buffer.alloc(16, 0), Buffer.from([0])])),
  segment(0xda, Buffer.from([1, 1, 0, 0, 63, 0])),
  Buffer.from([0x12, 0x34, 0xff, 0x00]),
  Buffer.from([0xff, 0xd9]),
]);

function fakeProvider(
  replies: ModelCallResult[] | ((input: ModelCallInput, i: number) => ModelCallResult)
): { provider: ModelProvider; calls: ModelCallInput[] } {
  const calls: ModelCallInput[] = [];
  let index = 0;
  return {
    calls,
    provider: {
      id: "fake",
      async complete(input) {
        calls.push(input);
        const i = index;
        index += 1;
        return typeof replies === "function" ? replies(input, i) : replies[Math.min(i, replies.length - 1)];
      },
    },
  };
}

function ok(raw: string): ModelCallResult {
  return {
    ok: true,
    raw,
    usage: { prompt_tokens: 1_200, completion_tokens: 60, total_tokens: 1_260, reported_cost_usd: 0.0002 },
    generationId: "gen_label",
    provider: "fake",
    attempts: 1,
  };
}

function labelPolicy(enabled = true): AiPolicy {
  return AiPolicy.parse({
    ...DEFAULT_AI_POLICY,
    enabled: true,
    capabilities: {
      ...DEFAULT_AI_POLICY.capabilities,
      read_equipment_label: { ...DEFAULT_AI_POLICY.capabilities.read_equipment_label, enabled },
    },
  });
}

function deps(provider: ModelProvider | null, policy = labelPolicy()): CallModelDeps {
  return {
    provider: () => provider,
    policyStore: new MemoryAiPolicyStore(policy),
    policy,
    spend: new MemorySpendLedger(),
    now: () => new Date("2026-09-05T12:00:00Z"),
  };
}

const VALID = JSON.stringify({
  readable: true,
  equipment_type: "Air Conditioner",
  brand: "CARRIER",
  model: "24ABC636A003",
  serial: "4021E19845",
  manufacture_year: 2018,
  confidence: { equipment_type: "high", brand: "high", model: "medium", serial: "medium", manufacture_year: "high" },
  notes: "Clear plate, slight glare on the serial.",
});

beforeEach(() => {
  resetAgentRunLedgerForTests();
  resetKillSwitchForTests();
});
afterEach(() => vi.restoreAllMocks());

describe("the label reader — a valid reply", () => {
  it("strips metadata BEFORE the bytes leave, sends one image, and returns the fields with confidence in words", async () => {
    const { provider, calls } = fakeProvider([ok(VALID)]);
    const result = await readEquipmentLabel(
      { bytes: JPEG_WITH_EXIF, mime: "image/jpeg", request_id: "rq_test_label" },
      { deps: deps(provider) }
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.readable).toBe(true);
    expect(result.fields).toEqual({
      equipment_type: "Air Conditioner",
      brand: "CARRIER",
      model: "24ABC636A003",
      serial: "4021E19845",
      manufacture_year: 2018,
    });
    expect(result.confidence).toEqual({
      equipment_type: "high",
      brand: "high",
      model: "medium",
      serial: "medium",
      manufacture_year: "high",
    });
    expect(result.run_id).toMatch(/^ar_/);
    expect(result.cost_usd).toBe(0.0002);

    // What the provider received.
    expect(calls).toHaveLength(1);
    const sent = calls[0]!;
    expect(sent.images).toHaveLength(1);
    expect(sent.images![0]!.mime).toBe("image/jpeg");
    const bytesSent = Buffer.from(sent.images![0]!.base64, "base64");
    expect(bytesSent.indexOf(Buffer.from(GPS_SENTINEL, "latin1"))).toBe(-1);
    expect(jpegCarriesMetadata(bytesSent)).toBe(false);
    expect(bytesSent.length).toBeLessThan(JPEG_WITH_EXIF.length);
    // The whole request carries nothing but the picture and the question.
    const wire = JSON.stringify(buildBody(sent));
    expect(wire).not.toContain(GPS_SENTINEL);
    expect(wire).not.toContain("rq_test_label");
    expect(sent.dataCollection).toBe("deny");
    expect(sent.mode).toBe("json_schema");

    // The ledger row names the capability and the vision model.
    const run = recentAgentRuns().at(-1)!;
    expect(run.capabilities_used).toEqual(["read_equipment_label"]);
    expect(run.tool_model_version).toBe(DEFAULT_AI_POLICY.capabilities.read_equipment_label.model_id);
    expect(run.input_ids).toEqual(["rq_test_label"]);
  });

  it("zod and the JSON schema agree on required keys, and the zod schema is strict about shape", () => {
    const required = (LABEL_REPLY_JSON_SCHEMA.required as string[]).sort();
    expect(Object.keys(LabelReply.shape).sort()).toEqual(required);
    expect(LabelReply.safeParse(JSON.parse(VALID)).success).toBe(true);
    // A year derived from nothing, a number that is not a year, a confidence that is a number: all refused.
    expect(LabelReply.safeParse({ ...JSON.parse(VALID), manufacture_year: 18 }).success).toBe(false);
    expect(LabelReply.safeParse({ ...JSON.parse(VALID), confidence: { brand: 0.9 } }).success).toBe(false);
    expect(LabelReply.safeParse({ ...JSON.parse(VALID), brand: "" }).success).toBe(false);
  });
});

describe("the label reader — every failure is readable:false, never a throw", () => {
  it("an invalid reply that stays invalid falls back (json_schema mode has no repair turn)", async () => {
    const { provider, calls } = fakeProvider([ok('{"readable":true,"brand":"CARRIER"}')]);
    const result = await readEquipmentLabel(
      { bytes: JPEG_WITH_EXIF, mime: "image/jpeg", request_id: "rq_bad" },
      { deps: deps(provider) }
    );
    expect(result.ok && !result.readable).toBe(true);
    if (result.ok) {
      expect(result.detail).toMatch(/^invalid_after_repair/);
      expect(result.fields).toEqual({});
      expect(result.confidence).toEqual({});
    }
    expect(calls).toHaveLength(1);
  });

  it("a photo that is not a label is readable:false with no fields, even if the model leaks a guess", async () => {
    const notALabel = JSON.stringify({
      readable: false,
      equipment_type: null,
      brand: "Carrier",
      model: null,
      serial: null,
      manufacture_year: null,
      confidence: { equipment_type: "low", brand: "low", model: "low", serial: "low", manufacture_year: "low" },
      notes: "A thermostat on a wall; no rating plate visible.",
    });
    const { provider } = fakeProvider([ok(notALabel)]);
    const result = await readEquipmentLabel(
      { bytes: JPEG_WITH_EXIF, mime: "image/jpeg", request_id: "rq_thermostat" },
      { deps: deps(provider) }
    );
    expect(result.ok && !result.readable).toBe(true);
    if (result.ok) {
      expect(result.fields).toEqual({});
      expect(result.detail).toMatch(/thermostat/);
      expect(result.run_id).toMatch(/^ar_/);
    }
  });

  it("a readable reply with every field null is unreadable — nothing to fill", async () => {
    const empty = JSON.stringify({
      readable: true,
      equipment_type: null,
      brand: null,
      model: null,
      serial: null,
      manufacture_year: null,
      confidence: { equipment_type: "low", brand: "low", model: "low", serial: "low", manufacture_year: "low" },
      notes: "",
    });
    const { provider } = fakeProvider([ok(empty)]);
    const result = await readEquipmentLabel(
      { bytes: JPEG_WITH_EXIF, mime: "image/jpeg", request_id: "rq_empty" },
      { deps: deps(provider) }
    );
    expect(result.ok && !result.readable).toBe(true);
  });

  it("THE GATE REFUSES when the policy disables the capability — no provider call, no bytes leave", async () => {
    const { provider, calls } = fakeProvider([ok(VALID)]);
    const result = await readEquipmentLabel(
      { bytes: JPEG_WITH_EXIF, mime: "image/jpeg", request_id: "rq_off" },
      { deps: deps(provider, labelPolicy(false)) }
    );
    expect(result.ok && !result.readable).toBe(true);
    if (result.ok) expect(result.detail).toMatch(/^disabled: "read_equipment_label" is disabled/);
    expect(calls).toHaveLength(0);
    expect(recentAgentRuns().at(-1)!.tool_provider).toBe("none");
  });

  it("a timed-out or keyless call is the same fallback", async () => {
    const { provider } = fakeProvider([
      { ok: false, reason: "timeout", detail: "no reply within 30000ms", provider: "fake", attempts: 1 },
    ]);
    const timedOut = await readEquipmentLabel(
      { bytes: JPEG_WITH_EXIF, mime: "image/jpeg", request_id: "rq_slow" },
      { deps: deps(provider) }
    );
    expect(timedOut.ok && !timedOut.readable).toBe(true);
    if (timedOut.ok) expect(timedOut.detail).toMatch(/^timeout/);

    const keyless = await readEquipmentLabel(
      { bytes: JPEG_WITH_EXIF, mime: "image/jpeg", request_id: "rq_nokey" },
      { deps: deps(null) }
    );
    expect(keyless.ok && !keyless.readable).toBe(true);
    if (keyless.ok) expect(keyless.detail).toMatch(/^no_key/);
  });

  it("a JPEG whose segments cannot be walked is NOT sent — unproven stripping is no stripping", async () => {
    const { provider, calls } = fakeProvider([ok(VALID)]);
    const broken = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff]), Buffer.from("Exif\0\0GPS", "latin1")]);
    const result = await readEquipmentLabel(
      { bytes: broken, mime: "image/jpeg", request_id: "rq_broken" },
      { deps: deps(provider) }
    );
    expect(result.ok && !result.readable).toBe(true);
    if (result.ok) expect(result.detail).toMatch(/not sent/);
    expect(calls).toHaveLength(0);
  });

  it("a type the reader does not accept (HEIC) is not sent; empty input is ok:false", async () => {
    const { provider, calls } = fakeProvider([ok(VALID)]);
    const heic = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypheic", "latin1"), Buffer.alloc(16)]);
    const result = await readEquipmentLabel(
      { bytes: heic, mime: "image/heic", request_id: "rq_heic" },
      { deps: deps(provider) }
    );
    expect(result.ok && !result.readable).toBe(true);
    if (result.ok) expect(result.detail).toMatch(/image\/heic/);
    expect(calls).toHaveLength(0);
    const empty = await readEquipmentLabel(
      { bytes: Buffer.alloc(0), mime: "image/jpeg", request_id: "rq_empty_bytes" },
      { deps: deps(provider) }
    );
    expect(empty.ok).toBe(false);
  });
});

describe("images through the governed door", () => {
  it("an image cannot go to a model not configured accepts_images — refused before the provider", async () => {
    const { provider, calls } = fakeProvider([ok(VALID)]);
    const textOnly = AiPolicy.parse({
      ...labelPolicy(),
      capabilities: {
        ...labelPolicy().capabilities,
        read_equipment_label: {
          ...labelPolicy().capabilities.read_equipment_label,
          // A cleared TEXT model: passes the privacy rule, fails the image rule.
          model_id: "deepseek/deepseek-v4-flash-0731",
        },
      },
    });
    expect(findModel("deepseek/deepseek-v4-flash-0731")!.allows_customer_data).toBe(true);
    const result = await readEquipmentLabel(
      { bytes: JPEG_WITH_EXIF, mime: "image/jpeg", request_id: "rq_text_model" },
      { deps: deps(provider, textOnly) }
    );
    expect(result.ok && !result.readable).toBe(true);
    if (result.ok) expect(result.detail).toMatch(/^not_permitted: .*not configured accepts_images/);
    expect(calls).toHaveLength(0);
  });

  it("the pre-call estimate prices the image, not just the text", async () => {
    /**
     * 600 max output tokens cost $0.00024. The conservative admission now
     * includes the schema and UTF-8 input allowance (~$0.000114), too.
     * One image adds $0.0002. A cap of $0.00045 sits between the two, so the
     * SAME call passes without the image and is refused with it.
     */
    const tight = AiPolicy.parse({
      ...labelPolicy(),
      capabilities: {
        ...labelPolicy().capabilities,
        read_equipment_label: { ...labelPolicy().capabilities.read_equipment_label, max_cost_per_call_usd: 0.00045, daily_cap_usd: 0.5 },
      },
    });
    const call = (images?: ModelCallInput["images"]) =>
      callModel({
        agent_id: "A01",
        capability: "read_equipment_label",
        handles_customer_data: true,
        prompt_id: "t",
        prompt_version: "1",
        system: "s",
        user: "u",
        ...(images ? { images } : {}),
        schema_name: "A01LabelRead",
        schema: LabelReply,
        json_schema: LABEL_REPLY_JSON_SCHEMA,
        deps: deps(fakeProvider([ok(VALID)]).provider, tight),
      });
    expect((await call()).ok).toBe(true);
    const withImage = await call([{ mime: "image/jpeg", base64: "AAAA" }]);
    expect(withImage.ok).toBe(false);
    if (!withImage.ok) expect(withImage.reason).toBe("over_budget");
  });

  it("the OpenRouter body carries OpenAI-style content parts ONLY when images are present", () => {
    const base: ModelCallInput = {
      modelId: "x/y",
      system: "sys",
      user: "usr",
      schemaName: "S",
      jsonSchema: { type: "object" },
      mode: "json_schema",
      maxTokens: 10,
      timeoutMs: 1_000,
      dataCollection: "deny",
    };
    const text = buildBody(base);
    expect(text.messages).toEqual([
      { role: "system", content: "sys" },
      { role: "user", content: "usr" },
    ]);
    // An explicitly empty images list is a text call: byte-identical.
    expect(JSON.stringify(buildBody({ ...base, images: [] }))).toBe(JSON.stringify(text));

    const withImage = buildBody({ ...base, images: [{ mime: "image/jpeg", base64: "AAAA" }] });
    expect(withImage.messages).toEqual([
      { role: "system", content: "sys" },
      {
        role: "user",
        content: [
          { type: "text", text: "usr" },
          { type: "image_url", image_url: { url: "data:image/jpeg;base64,AAAA" } },
        ],
      },
    ]);
    // Nothing else in the body moved.
    const { messages: _a, ...restText } = text;
    const { messages: _b, ...restImage } = withImage;
    expect(restImage).toEqual(restText);
  });

  it("the real provider sends those parts over the wire (fetch stubbed)", async () => {
    let captured: Record<string, unknown> = {};
    const original = globalThis.fetch;
    globalThis.fetch = vi.fn(async (_url, init) => {
      captured = JSON.parse(String((init as RequestInit).body));
      return new Response(
        JSON.stringify({ id: "gen_v", choices: [{ message: { content: VALID }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as unknown as typeof fetch;
    try {
      const provider = createOpenRouterProvider("sk-or-v1-TESTONLY-000", globalThis.fetch);
      const result = await provider.complete({
        modelId: "google/gemini-2.5-flash-lite",
        system: "sys",
        user: "usr",
        schemaName: "S",
        jsonSchema: LABEL_REPLY_JSON_SCHEMA,
        mode: "json_schema",
        maxTokens: 100,
        timeoutMs: 5_000,
        dataCollection: "deny",
        images: [{ mime: "image/jpeg", base64: "QUJD" }],
      });
      expect(result.ok).toBe(true);
      const messages = captured.messages as Array<{ role: string; content: unknown }>;
      expect(Array.isArray(messages[1]!.content)).toBe(true);
      expect(JSON.stringify(messages[1]!.content)).toContain("data:image/jpeg;base64,QUJD");
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe("the capability is registered as one governed thing", () => {
  it("registry, agent, policy and catalogue all name read_equipment_label consistently", () => {
    const cap = resolveCapability("read_equipment_label")!;
    expect(cap).not.toBeNull();
    expect(cap.owning_agent_ids).toEqual(["A01"]);
    expect(cap.current_implementation).toBe("model");
    expect(cap.alternate_implementations![0]!.handles_customer_data).toBe(true);
    expect(cap.alternate_implementations![0]!.enabled_policy_key).toBe("read_equipment_label");
    expect(TRIAL_AGENT_REGISTRY.find((a) => a.agent_id === "A01")!.allowed_capabilities).toContain("read_equipment_label");
    const policy = DEFAULT_AI_POLICY.capabilities.read_equipment_label;
    expect(policy.enabled).toBe(false);
    expect(policy.max_cost_per_call_usd).toBe(0.02);
    expect(policy.daily_cap_usd).toBe(0.5);
    const model = findModel(policy.model_id)!;
    expect(model.accepts_images).toBe(true);
    expect(model.allows_customer_data).toBe(true);
    expect(MODEL_CATALOGUE.filter((m) => m.accepts_images)).toHaveLength(1);
  });

  it("an explicit test policy enables the vision model while a fresh checkout stays disabled", async () => {
    const { mkdtemp, unlink, rmdir } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const dir = await mkdtemp(join(tmpdir(), "label-policy-fixture-"));
    const policyPath = join(dir, "policy.json");
    const vercel = process.env.VERCEL;
    delete process.env.VERCEL;
    try {
      const store = new FileAiPolicyStore(policyPath);
      expect((await store.getActive()).enabled).toBe(false);
      expect((await store.getActive()).capabilities.read_equipment_label.enabled).toBe(false);
      const selected = AiPolicy.parse({ ...structuredClone(DEFAULT_AI_POLICY), enabled: true });
      selected.capabilities.read_equipment_label.enabled = true;
      await store.save(selected);
      const doc = await new FileAiPolicyStore(policyPath).getActive();
      expect(doc.enabled).toBe(true);
      expect(doc.capabilities.read_equipment_label.enabled).toBe(true);
      expect(doc.capabilities.read_equipment_label.model_id).toBe("google/gemini-2.5-flash-lite");
      expect(doc.capabilities.read_equipment_label.max_cost_per_call_usd).toBe(0.02);
      expect(doc.capabilities.read_equipment_label.daily_cap_usd).toBe(0.5);
    } finally {
      if (vercel === undefined) delete process.env.VERCEL; else process.env.VERCEL = vercel;
      await unlink(policyPath).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
      await rmdir(dir);
    }
  });

  it("callModel itself passes images through to the provider input unchanged", async () => {
    const { provider, calls } = fakeProvider([ok(VALID)]);
    const result = await callModel({
      agent_id: "A01",
      capability: "read_equipment_label",
      handles_customer_data: true,
      prompt_id: "t",
      prompt_version: "1",
      system: "s",
      user: "u",
      images: [{ mime: "image/png", base64: "AAA=" }],
      schema_name: "A01LabelRead",
      schema: LabelReply,
      json_schema: LABEL_REPLY_JSON_SCHEMA,
      deps: deps(provider),
    });
    expect(result.ok).toBe(true);
    expect(calls[0]!.images).toEqual([{ mime: "image/png", base64: "AAA=" }]);
  });
});
