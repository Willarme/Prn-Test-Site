import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  buildClassificationJsonSchema,
  buildClassificationSchema,
} from "@/platform/problem/ai-classify";
import {
  A06_CRITIC_CHECK_IDS,
  CRITIC_REPLY_JSON_SCHEMA,
} from "@/platform/search/page-qa-critic";
import { AI_CAPABILITY_KEYS, DEFAULT_AI_POLICY } from "@/platform/ai/policy";
import { CAPABILITY_REGISTRY, resolveCapability } from "@/platform/capabilities/registry";
import { TRIAL_AGENT_REGISTRY } from "@/platform/agents/registry";

/**
 * THE ZOD SCHEMA AND THE JSON SCHEMA MUST AGREE.
 *
 * Every model-backed capability carries two descriptions of the same contract: a
 * zod schema that VALIDATES the reply, and a JSON Schema that ASKS for it — sent
 * to the API in json_schema mode and rendered into the prompt in json_object
 * mode. They are hand-authored side by side rather than generated, because this
 * repo has no schema-generation dependency and adding one to reach an
 * OpenAI-compatible endpoint would have been a dependency for a single POST.
 *
 * The cost of hand-authoring is drift, and drift here is quiet and expensive: the
 * model is asked for one shape and judged against another, so every reply fails
 * validation, every call falls back, and the system reports "the model cannot
 * follow a schema" when what is actually broken is our own bookkeeping. This
 * file is the check that makes the hand-authored pair safe — and it is a stronger
 * guarantee than a generator, because it fails when they disagree rather than
 * silently producing whatever the generator thinks.
 */

interface JsonObjectSchema {
  type: string;
  required?: string[];
  properties?: Record<string, { type?: string | string[]; enum?: unknown[] }>;
  additionalProperties?: boolean;
}

function requiredKeysOf(schema: z.ZodObject<z.ZodRawShape>): string[] {
  return Object.entries(schema.shape)
    .filter(([, value]) => !(value instanceof z.ZodOptional))
    .map(([key]) => key)
    .sort();
}

function assertAgrees(
  label: string,
  zodSchema: z.ZodObject<z.ZodRawShape>,
  jsonSchema: Record<string, unknown>
): void {
  const json = jsonSchema as unknown as JsonObjectSchema;
  expect(json.type, `${label}: the JSON schema must describe an object`).toBe("object");
  expect(
    json.additionalProperties,
    `${label}: additionalProperties must be false, or the model may add fields nothing validates`
  ).toBe(false);
  expect([...(json.required ?? [])].sort(), `${label}: required keys`).toEqual(
    requiredKeysOf(zodSchema)
  );
  expect(
    Object.keys(json.properties ?? {}).sort(),
    `${label}: property names`
  ).toEqual(Object.keys(zodSchema.shape).sort());
}

describe("every capability's two schema descriptions agree", () => {
  it("A01 classification — including the taxonomy enum, which is built from config", () => {
    const trades = ["hvac", "plumbing", "electrical", "general_home_problem"];
    const zodSchema = buildClassificationSchema(trades);
    const jsonSchema = buildClassificationJsonSchema(trades);
    assertAgrees("A01Classification", zodSchema, jsonSchema);

    // The enum the API is told about is the enum the validator enforces.
    const props = (jsonSchema as unknown as JsonObjectSchema).properties!;
    expect(props.service_category.enum).toEqual([...trades, null]);
  });

  it("A01 classification — provenance is a literal in BOTH descriptions", () => {
    const jsonSchema = buildClassificationJsonSchema(["hvac"]) as Record<string, unknown>;
    const facts = (jsonSchema.properties as Record<string, Record<string, unknown>>).facts;
    const items = facts.items as Record<string, unknown>;
    const props = items.properties as Record<string, { enum?: unknown[] }>;
    expect(props.provenance.enum).toEqual(["inferred"]);

    const zodSchema = buildClassificationSchema(["hvac"]);
    const bad = zodSchema.safeParse({
      service_category: "hvac",
      service_category_confidence: "high",
      intent_cluster: "x",
      facts: [{ key: "k", value: "v", confidence: "high", provenance: "observed" }],
      reason: "r",
    });
    expect(bad.success).toBe(false);
  });

  it("A06 critic — check ids match the exported vocabulary exactly", () => {
    const json = CRITIC_REPLY_JSON_SCHEMA as unknown as JsonObjectSchema;
    expect([...(json.required ?? [])].sort()).toEqual(["findings", "reason", "verdict"]);
    const findings = (CRITIC_REPLY_JSON_SCHEMA as Record<string, Record<string, unknown>>)
      .properties.findings as Record<string, unknown>;
    const items = findings.items as Record<string, unknown>;
    const props = items.properties as Record<string, { enum?: unknown[] }>;
    expect(props.check.enum).toEqual([...A06_CRITIC_CHECK_IDS]);
    expect(props.severity.enum).toEqual(["blocker", "major", "minor"]);
    // No field for release, publication, or clearing anything.
    expect(Object.keys(props)).toEqual([
      "check",
      "severity",
      "where",
      "message",
      "repair_instructions",
    ]);
  });
});

describe("the policy, the capability registry and the agent registry describe one system", () => {
  it("every AI policy key is a real capability key", () => {
    for (const key of AI_CAPABILITY_KEYS) {
      const capability = resolveCapability(key);
      expect(capability, `${key} must resolve in the capability registry`).not.toBeNull();
      expect(capability!.capability_key).toBe(key);
    }
  });

  it("every policy entry names a model that exists in the catalogue", async () => {
    const { findModel } = await import("@/platform/ai/models");
    for (const [key, cap] of Object.entries(DEFAULT_AI_POLICY.capabilities)) {
      expect(findModel(cap.model_id), `${key} names model ${cap.model_id}`).not.toBeNull();
    }
  });

  it("every model-backed capability's alternate names the policy key that turns it on", () => {
    for (const capability of CAPABILITY_REGISTRY) {
      for (const alternate of capability.alternate_implementations ?? []) {
        expect(
          AI_CAPABILITY_KEYS as readonly string[],
          `${capability.capability_key} -> ${alternate.enabled_policy_key}`
        ).toContain(alternate.enabled_policy_key);
        expect(
          DEFAULT_AI_POLICY.capabilities[alternate.enabled_policy_key],
          `${alternate.enabled_policy_key} must have a policy entry`
        ).toBeDefined();
      }
    }
  });

  it("every model-backed capability's owner lists it back — one governed system, not two lists", () => {
    for (const capability of CAPABILITY_REGISTRY) {
      if ((capability.alternate_implementations ?? []).length === 0) continue;
      for (const agentId of capability.owning_agent_ids ?? []) {
        const agent = TRIAL_AGENT_REGISTRY.find((a) => a.agent_id === agentId)!;
        const named =
          agent.allowed_capabilities.includes(capability.capability_key) ||
          (capability.aliases ?? []).some((a) => agent.allowed_capabilities.includes(a));
        expect(named, `${agentId} must allow ${capability.capability_key}`).toBe(true);
      }
    }
  });

  it("a deterministic implementation is never overwritten by a model alternate", () => {
    for (const capability of CAPABILITY_REGISTRY) {
      const alternates = capability.alternate_implementations ?? [];
      if (alternates.length === 0) continue;
      // Where a deterministic implementation existed, it is still the current one.
      if (capability.capability_key === "classify_home_problem" || capability.capability_key === "select_next_clarifier") {
        expect(capability.current_implementation, capability.capability_key).toBe("deterministic");
      }
      for (const alternate of alternates) {
        expect(alternate.falls_back_to.length, capability.capability_key).toBeGreaterThan(10);
      }
    }
  });
});

describe("no prompt names a model, a vendor, or a credential", () => {
  it("the capability wirings take their model from policy and their vocabulary from config", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.ts$/.test(entry)) files.push(full);
      }
    };
    walk(join(process.cwd(), "src/platform/problem"));
    files.push(join(process.cwd(), "src/platform/search/ai-page-copy.ts"));
    files.push(join(process.cwd(), "src/platform/search/page-qa-critic.ts"));

    /**
     * COMMENTS ARE STRIPPED FIRST — the same distinction A06's own build drew
     * when it scanned for the removed `fixtureCritic`: naming a model in prose,
     * to record WHY a capability cannot run on it, is not the same as coupling to
     * it. What must not exist is a model id, a vendor call or a credential read in
     * the CODE.
     */
    for (const file of files) {
      const code = readFileSync(file, "utf-8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      expect(code, file).not.toMatch(/openrouter|openai|anthropic|deepseek|ox-alpha/i);
      expect(code, file).not.toMatch(/process\.env/);
      expect(code, file).not.toMatch(/fetch\(/);
    }
  });
});
