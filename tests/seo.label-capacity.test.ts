import { beforeEach, describe, expect, it } from "vitest";
import type { CallModelDeps } from "@/platform/ai/callModel";
import { DEFAULT_AI_POLICY, type AiPolicy } from "@/platform/ai/policy";
import type { ModelCallInput, ModelCallResult, ModelProvider } from "@/platform/ai/provider";
import { buildBody } from "@/platform/ai/providers/openrouter";
import { MemorySpendLedger } from "@/platform/ai/spend";
import { resetKillSwitchForTests } from "@/platform/killswitch";
import { recentAgentRuns, resetAgentRunLedgerForTests } from "@/platform/runs/ledger";
import {
  LABEL_PROMPT, LABEL_REPLY_JSON_SCHEMA, LABEL_SCHEMA_NAME, LabelReply,
  normalizeLabelReply, PrintedCapacity, readEquipmentLabel, type LegacyLabelReply,
} from "@/platform/problem/ai-label";

// Stub provider and synthetic bytes: this proves governed decoding/mapping,
// never OCR accuracy, deployment, activation or a real provider result.
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
const legacy: LegacyLabelReply = {
  readable: true, equipment_type: "Air Conditioner", brand: "Example", model: "MODEL036",
  serial: null, manufacture_year: null,
  confidence: { equipment_type: "high", brand: "high", model: "high", serial: "low", manufacture_year: "low" },
  notes: "Synthetic nameplate.",
};
function reply(capacity: unknown = null, confidence = "high"): unknown {
  return { ...legacy, capacity, confidence: { ...legacy.confidence, capacity: confidence } };
}
const printed = (value = "36,000", unit = "BTU/h", label = "Cooling capacity") => ({
  printed_label: label, printed_value: value, printed_unit: unit,
});
function normalized(value: unknown) {
  const result = normalizeLabelReply(LabelReply.parse(value), "ar_synthetic", 0);
  if (!result.ok) throw new Error("Unexpected input error");
  return result;
}
function governed(raw: unknown, enabled = true, failure?: ModelCallResult, cap?: number) {
  const calls: ModelCallInput[] = [];
  const provider: ModelProvider = {
    id: "fake", async complete(input) {
      calls.push(input);
      if (failure) return failure;
      return { ok: true, raw: JSON.stringify(raw), provider: "fake", attempts: 1,
        usage: { prompt_tokens: 100, completion_tokens: 100, total_tokens: 200, reported_cost_usd: 0.0001 }, generationId: "synthetic" };
    },
  };
  const policy: AiPolicy = structuredClone(DEFAULT_AI_POLICY);
  policy.enabled = true;
  policy.capabilities.read_equipment_label.enabled = enabled;
  if (cap !== undefined) policy.capabilities.read_equipment_label.max_cost_per_call_usd = cap;
  const deps: CallModelDeps = { provider: () => provider, policy, spend: new MemorySpendLedger(), now: () => new Date("2026-09-06T12:00:00Z") };
  return { calls, read: (evidence_id?: string) => readEquipmentLabel({ bytes: JPEG, mime: "image/jpeg", request_id: "rq_capacity_synthetic", ...(evidence_id ? { evidence_id } : {}) }, { deps }) };
}

beforeEach(() => { resetKillSwitchForTests(); resetAgentRunLedgerForTests(); });

describe("printed cooling capacity, without model enrichment", () => {
  it.each([
    ["36,000", "BTU/h", "Cooling capacity"],
    ["3", "tons", "Nominal cooling capacity"],
    ["2.5", "TR", "Rated cooling output"],
    ["10.55", "kW", "Total cooling capacity"],
    ["36000", "BTUH", "Refrigerating capacity"],
  ])("retains explicitly printed %s %s without unit conversion", (value, unit, label) => {
    const result = normalized(reply(printed(value, unit, label), "medium"));
    expect(result.fields.capacity).toBe(`${value} ${unit}`);
    expect(result.capacity_reading).toEqual(printed(value, unit, label));
    expect(result.confidence.capacity).toBe("medium");
    expect(result.fields.model).toBe("MODEL036");
  });

  it("leaves missing capacity absent and never decodes MODEL036", () => {
    const result = normalized(reply(null, "low"));
    expect(result.fields.model).toBe("MODEL036");
    expect(result.fields).not.toHaveProperty("capacity");
    expect(result.confidence).not.toHaveProperty("capacity");
    expect(result).not.toHaveProperty("capacity_reading");
  });

  it.each([
    [printed("3.6", "kW", "Electrical input"), "high"],
    [printed("240", "V", "Cooling capacity"), "high"],
    [printed("15", "A", "MCA"), "high"],
    [printed("36,000", "BTU/h", "Heating capacity"), "high"],
    [printed("36,000 / 48,000"), "high"],
    [printed("36,000-48,000"), "high"],
    [printed("36,OOO"), "high"],
    [printed("-36000"), "high"],
    [printed("0"), "high"],
    [printed("3e4"), "high"],
    [printed("36,000", "BTU/h", "Capacity"), "high"],
    [printed(), "low"],
  ])("refuses unsupported, ambiguous or poorly legible capacity %#", (capacity, confidence) => {
    const result = normalized(reply(capacity, confidence));
    expect(result.readable).toBe(true); // Valid other plate fields survive.
    expect(result.fields).not.toHaveProperty("capacity");
    expect(result).not.toHaveProperty("capacity_reading");
  });

  it("discards even a complete capacity when the image is declared unreadable", () => {
    const result = normalized({ ...(reply(printed()) as object), readable: false, notes: "Blurred/cropped plate." });
    expect(result.readable).toBe(false);
    expect(result.extraction_status).toBe("unreadable");
    expect(result.fields).toEqual({});
    expect(result.confidence).toEqual({});
  });

  it("keeps legacy direct callers compatible without inventing the new field", () => {
    const result = normalizeLabelReply(legacy, "ar_legacy", 0);
    expect(result.ok && result.fields.model).toBe("MODEL036");
    expect(result.ok && result.fields).not.toHaveProperty("capacity");
    expect(LabelReply.safeParse(legacy).success).toBe(false); // Current wire cannot downgrade.
  });
});

describe("current strict wire and one governed call", () => {
  it("sends matching v2 prompt/schema once and keeps evidence identity off vendor wire", async () => {
    const fixture = governed(reply(printed()));
    const result = await fixture.read("ev_capacity_synthetic");
    expect(result.ok && result.readable).toBe(true);
    expect(result).not.toHaveProperty("extraction_status");
    expect(result.ok && result.fields.capacity).toBe("36,000 BTU/h");
    expect(result.ok && result.evidence_id).toBe("ev_capacity_synthetic");
    expect(fixture.calls).toHaveLength(1);
    expect(fixture.calls[0].schemaName).toBe(LABEL_SCHEMA_NAME);
    expect(fixture.calls[0].jsonSchema).toEqual(LABEL_REPLY_JSON_SCHEMA);
    expect(fixture.calls[0].mode).toBe("json_schema");
    expect(fixture.calls[0].dataCollection).toBe("deny");
    expect(fixture.calls[0].system).toMatch(/Electrical input/);
    expect(fixture.calls[0].system).toMatch(/Never calculate or convert/);
    expect(fixture.calls[0].system).toMatch(/conflicting ratings/);
    const wire = JSON.stringify(buildBody(fixture.calls[0]));
    expect(wire).not.toContain("ev_capacity_synthetic");
    expect(wire).not.toContain("rq_capacity_synthetic");
    const run = recentAgentRuns().at(-1)!;
    expect(run.input_ids).toEqual(["rq_capacity_synthetic", "ev_capacity_synthetic"]);
    expect(LABEL_PROMPT.prompt_version).toBe("2.0.0");
    expect(LABEL_SCHEMA_NAME).toBe("A01LabelRead_v2");
  });

  it.each([
    legacy,
    { ...legacy, capacity: null }, // Missing new confidence.
    reply("36,000 BTU/h"),
    reply({ ...printed(), guessed_from_model: true }),
    reply({ ...printed(), printed_value: 36000 }),
    reply({ printed_label: "Cooling capacity", printed_value: "36000" }),
    reply(printed(), "certain"),
    { ...(reply() as object), extra: "not permitted" },
  ])("malformed/current-missing fields cannot become a legacy successful reply %#", async raw => {
    const fixture = governed(raw);
    const result = await fixture.read();
    expect(result.ok && !result.readable).toBe(true);
    expect(result.extraction_status).toBe("failed");
    expect(result.ok && result.fields).toEqual({});
    expect(fixture.calls).toHaveLength(1); // No repair/model enrichment call.
  });

  it("the disabled policy still refuses before any provider call", async () => {
    const fixture = governed(reply(printed()), false);
    const result = await fixture.read();
    expect(result.ok && !result.readable).toBe(true);
    expect(result.extraction_status).toBe("failed");
    expect(fixture.calls).toHaveLength(0);
  });

  it("invalid caller evidence identity is refused before a call", async () => {
    const fixture = governed(reply(printed()));
    expect(await fixture.read("not an evidence identifier")).toEqual({ ok: false, reason: "invalid evidence identity", extraction_status: "failed" });
    expect(fixture.calls).toHaveLength(0);
  });

  it("a non-string evidence identity cannot be coerced into a valid identifier", async () => {
    const fixture = governed(reply(printed()));
    expect(await fixture.read(123 as unknown as string)).toEqual({ ok: false, reason: "invalid evidence identity", extraction_status: "failed" });
    expect(fixture.calls).toHaveLength(0);
  });

  it("JSON and Zod require the same strict fields at each object level", () => {
    const schema = LABEL_REPLY_JSON_SCHEMA as { required: string[]; additionalProperties: boolean; properties: Record<string, unknown> };
    expect(Object.keys(LabelReply.shape).sort()).toEqual([...schema.required].sort());
    expect(schema.additionalProperties).toBe(false);
    const confidence = schema.properties.confidence as { required: string[]; additionalProperties: boolean };
    expect(Object.keys(LabelReply.shape.confidence.shape).sort()).toEqual([...confidence.required].sort());
    expect(confidence.additionalProperties).toBe(false);
    const capacity = schema.properties.capacity as { anyOf: Array<{ type: string; required?: string[]; additionalProperties?: boolean }> };
    const object = capacity.anyOf.find(s => s.type === "object")!;
    expect(Object.keys(PrintedCapacity.shape).sort()).toEqual([...object.required!].sort());
    expect(object.additionalProperties).toBe(false);
    expect(capacity.anyOf.some(s => s.type === "null")).toBe(true);
  });
});

describe("typed extraction outcome, independent of explanatory prose", () => {
  it("a parsed unreadable image stays unreadable even when its notes contain failure words", async () => {
    const fixture = governed({ ...(reply(null, "low") as object), readable: false, notes: "Timeout error is printed on the image; no rating plate." });
    const result = await fixture.read();
    expect(result.ok && result.readable).toBe(false);
    expect(result.extraction_status).toBe("unreadable");
    expect(fixture.calls).toHaveLength(1);
  });

  it("a parsed image with no usable fields is unreadable rather than an execution failure", () => {
    const result = normalized({ readable: true, equipment_type: null, brand: null, model: null, serial: null, manufacture_year: null,
      capacity: null, confidence: { equipment_type: "low", brand: "low", model: "low", serial: "low", manufacture_year: "low", capacity: "low" }, notes: "Provider unavailable appears on a sticker." });
    expect(result.readable).toBe(false);
    expect(result.extraction_status).toBe("unreadable");
  });

  it.each(["timeout", "refused", "http_error"] as const)("%s is failed even when provider prose says unreadable", async reason => {
    const fixture = governed(reply(), true, { ok: false, reason, detail: "unreadable label", provider: "fake", attempts: 1 });
    const result = await fixture.read();
    expect(result.ok && result.readable).toBe(false);
    expect(result.extraction_status).toBe("failed");
    expect(fixture.calls).toHaveLength(1);
  });

  it("budget refusal is failed, with zero provider calls", async () => {
    const fixture = governed(reply(), true, undefined, 0.000001);
    const result = await fixture.read();
    expect(result.ok && result.readable).toBe(false);
    expect(result.extraction_status).toBe("failed");
    expect(fixture.calls).toHaveLength(0);
  });

  it("unsupported or malformed images fail before the provider rather than claiming a pixel read", async () => {
    for (const input of [
      { bytes: Buffer.alloc(0), mime: "image/jpeg" },
      { bytes: Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff]), mime: "image/jpeg" },
      { bytes: Buffer.from("not-an-image"), mime: "image/heic" },
    ]) {
      const result = await readEquipmentLabel({ ...input, request_id: "rq_not_sent" }, { deps: { provider: () => { throw new Error("provider must not be resolved"); } } });
      expect(result.extraction_status).toBe("failed");
    }
  });
});
