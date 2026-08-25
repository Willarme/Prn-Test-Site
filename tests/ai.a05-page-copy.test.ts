import { beforeEach, describe, expect, it } from "vitest";
import { contentBankBundle } from "@/domain/search/content-bank-provenance";
import { SAMPLE_PAGE_SPEC } from "@/domain/search/fixtures/sample-page-spec";
import { lintPageBeforeQa } from "@/domain/search/page-lint";
import type { PageSpec } from "@/domain/search/pages";
import { runDeterministicStage } from "@/domain/search/qa";
import { AiPolicy, DEFAULT_AI_POLICY } from "@/platform/ai/policy";
import { MemoryAiPolicyStore } from "@/platform/ai/policy-store";
import type { ModelCallResult, ModelProvider } from "@/platform/ai/provider";
import { MemorySpendLedger } from "@/platform/ai/spend";
import { generatePageCopy, checkGeneratedCopy } from "@/platform/search/ai-page-copy";
import { resetKillSwitchForTests } from "@/platform/killswitch";
import { resetAgentRunLedgerForTests } from "@/platform/runs/ledger";

/**
 * AI STEP 4 — A05's COPY WRITER.
 *
 * The claim under test is narrow and total: model text that fails a lint never
 * reaches the publish path. So every rejection case below asserts the SAME
 * thing — the returned spec is the one that went in, unchanged — because that is
 * what "the content bank is used instead" has to mean if it means anything.
 */

const BUNDLE = contentBankBundle(
  "hvac",
  {
    intent_answer:
      "A cooling system that runs without cooling usually traces to power, controls, airflow or a component a technician can test on site.",
    safe_checks:
      "Check the thermostat mode and set point. Check the filter. Look for a tripped breaker and reset it once at most.",
    do_not_do: "Do not open the outdoor unit. Do not reset a breaker that keeps tripping.",
    when_urgency_changes:
      "A burning smell, visible sparking, or a breaker that re-trips immediately means stop and get a professional.",
    who_handles_it: "A heating and cooling technician handles this.",
  },
  { geography: { mode: "national", country: "US" }, created_at: "2026-08-25T00:00:00Z" }
);

function provider(replies: ModelCallResult[]): { provider: ModelProvider; calls: number } {
  let index = 0;
  const state = { calls: 0 };
  const p: ModelProvider = {
    id: "fake",
    async complete() {
      state.calls += 1;
      const r = replies[Math.min(index, replies.length - 1)];
      index += 1;
      return r;
    },
  };
  return {
    provider: p,
    get calls() {
      return state.calls;
    },
  } as { provider: ModelProvider; calls: number };
}

function reply(payload: unknown): ModelCallResult {
  return {
    ok: true,
    raw: JSON.stringify(payload),
    usage: { prompt_tokens: 900, completion_tokens: 600, total_tokens: 1500, reported_cost_usd: 0 },
    generationId: "gen_a05",
    provider: "fake",
    attempts: 1,
  };
}

function enabled(): AiPolicy {
  return AiPolicy.parse({
    ...DEFAULT_AI_POLICY,
    enabled: true,
    capabilities: {
      ...DEFAULT_AI_POLICY.capabilities,
      generate_page_copy: {
        ...DEFAULT_AI_POLICY.capabilities.generate_page_copy,
        enabled: true,
      },
    },
  });
}

function deps(p: ModelProvider | null, policy: AiPolicy = enabled()) {
  return {
    provider: () => p,
    policyStore: new MemoryAiPolicyStore(policy),
    policy,
    spend: new MemorySpendLedger(),
    now: () => new Date("2026-08-25T12:00:00Z"),
  };
}

/** Copy that is clean, long enough not to trip the thin-content check, and sourced. */
function cleanBlocks(spec: PageSpec) {
  return spec.content_blocks.map((b) => ({
    block_id: b.block_id,
    body_md:
      "A cooling system that runs without cooling usually traces to power, controls, airflow, or a component a technician can test on site. " +
      "The thermostat mode and set point are worth checking, and a matted filter can starve the system until it shuts itself down. " +
      "A tripped breaker is worth one reset and no more. What the system does, and does not do, narrows this quickly for whoever comes out.",
    source_fact_bundle_ids: [BUNDLE.fact_bundle_id],
  }));
}

beforeEach(() => {
  resetAgentRunLedgerForTests();
  resetKillSwitchForTests();
});

describe("the happy path: clean, sourced copy is accepted and recorded as model-written", () => {
  it("replaces block bodies, keeps the structure, and stamps the generation", async () => {
    const p = provider([reply({ blocks: cleanBlocks(SAMPLE_PAGE_SPEC) })]);
    const out = await generatePageCopy(SAMPLE_PAGE_SPEC, [BUNDLE], { deps: deps(p.provider) });

    expect(out.engine).toBe("model");
    expect(out.rejections).toEqual([]);
    expect(out.spec.content_blocks).toHaveLength(SAMPLE_PAGE_SPEC.content_blocks.length);
    expect(out.spec.content_blocks.map((b) => b.block_id)).toEqual(
      SAMPLE_PAGE_SPEC.content_blocks.map((b) => b.block_id)
    );
    expect(out.spec.generation.model).toBe("stealth/ox-alpha");
    expect(out.spec.generation.prompt_id).toBe("a05.generate_page_copy");
    expect(out.spec.generation.prompt_version).toBe("1.0.0");
  });

  it("provenance is the UNION — the bank's bundle is never dropped", async () => {
    const p = provider([reply({ blocks: cleanBlocks(SAMPLE_PAGE_SPEC) })]);
    const out = await generatePageCopy(SAMPLE_PAGE_SPEC, [BUNDLE], { deps: deps(p.provider) });
    for (const original of SAMPLE_PAGE_SPEC.content_blocks) {
      const now = out.spec.content_blocks.find((b) => b.block_id === original.block_id)!;
      for (const id of original.source_fact_bundle_ids) {
        expect(now.source_fact_bundle_ids).toContain(id);
      }
      expect(now.source_fact_bundle_ids).toContain(BUNDLE.fact_bundle_id);
    }
    // The page-level list carries the union of its blocks' — A06 checks exactly this.
    for (const block of out.spec.content_blocks) {
      for (const id of block.source_fact_bundle_ids) {
        expect(out.spec.source_fact_bundle_ids).toContain(id);
      }
    }
  });

  it("the accepted page passes BOTH gauntlets — which is why it was accepted", async () => {
    const p = provider([reply({ blocks: cleanBlocks(SAMPLE_PAGE_SPEC) })]);
    const out = await generatePageCopy(SAMPLE_PAGE_SPEC, [BUNDLE], { deps: deps(p.provider) });
    expect(lintPageBeforeQa(out.spec).passed).toBe(true);
    expect(runDeterministicStage(out.spec).findings.filter((f) => f.severity === "blocker")).toEqual([]);
  });
});

describe("the five prohibitions, each rejecting the whole draft", () => {
  const cases: Array<[string, string, RegExp]> = [
    [
      "an invented price",
      "A visit for this usually costs about $180 in most areas, and a replacement part is extra on top of that. Beyond the money, the pattern of what the system does narrows the cause quickly for whoever comes out to look at it.",
      /no_invented_price/,
    ],
    [
      "manufactured urgency",
      "Act now — the longer you wait the worse this gets, and every day counts once a system is struggling. Beyond that, the pattern of what the system does narrows the cause quickly for whoever comes out to look at it.",
      /no_manufactured_urgency/,
    ],
    [
      "directory framing",
      "Compare providers in your area and get multiple quotes before you decide anything at all. Beyond that, the pattern of what the system does narrows the cause quickly for whoever comes out to look at it.",
      /no_directory_framing/,
    ],
    [
      "a credential claim",
      "Every one of our vetted pros is licensed and insured, so you can book with confidence today. Beyond that, the pattern of what the system does narrows the cause quickly for whoever comes out to look at it.",
      /no_credential_claim/,
    ],
    [
      "a new safety instruction",
      "If you notice anything unusual at the panel, evacuate the building immediately and call 911 from outside. Beyond that, the pattern of what the system does narrows the cause quickly for whoever comes out to look at it.",
      /no_new_safety_instruction/,
    ],
  ];

  for (const [label, copy, check] of cases) {
    it(`${label} discards the draft and returns the content bank's page UNCHANGED`, async () => {
      const blocks = cleanBlocks(SAMPLE_PAGE_SPEC);
      blocks[0] = { ...blocks[0], body_md: copy };
      const p = provider([reply({ blocks })]);
      const out = await generatePageCopy(SAMPLE_PAGE_SPEC, [BUNDLE], { deps: deps(p.provider) });

      expect(out.engine).toBe("content_bank");
      expect(out.rejections.some((r) => check.test(r.check))).toBe(true);
      // The whole page, byte for byte.
      expect(out.spec).toEqual(SAMPLE_PAGE_SPEC);
    });
  }

  it("safety copy the bundle ALREADY carries is not a new instruction", () => {
    const approved = "If you smell gas, leave the building now and call your gas utility from outside.";
    const rejections = checkGeneratedCopy(
      [{ block_id: "b1", body_md: `Repeating the approved line: ${approved}` }],
      approved
    );
    expect(rejections).toEqual([]);
  });
});

describe("the model cannot name a source it was not given, or a section that does not exist", () => {
  it("citing an unsupplied bundle id fails the schema and falls back", async () => {
    const blocks = cleanBlocks(SAMPLE_PAGE_SPEC).map((b) => ({
      ...b,
      source_fact_bundle_ids: ["fb_something_the_model_made_up"],
    }));
    const p = provider([reply({ blocks })]);
    const out = await generatePageCopy(SAMPLE_PAGE_SPEC, [BUNDLE], { deps: deps(p.provider) });
    expect(out.engine).toBe("content_bank");
    expect(out.fallback_reason).toMatch(/invalid_after_repair/);
    expect(out.spec).toEqual(SAMPLE_PAGE_SPEC);
  });

  it("citing NO bundle fails the schema — every block names where it came from", async () => {
    const blocks = cleanBlocks(SAMPLE_PAGE_SPEC).map((b) => ({
      ...b,
      source_fact_bundle_ids: [],
    }));
    const p = provider([reply({ blocks })]);
    const out = await generatePageCopy(SAMPLE_PAGE_SPEC, [BUNDLE], { deps: deps(p.provider) });
    expect(out.engine).toBe("content_bank");
    expect(out.spec).toEqual(SAMPLE_PAGE_SPEC);
  });

  it("inventing a block id fails the schema — the page's structure is not the model's", async () => {
    const p = provider([
      reply({
        blocks: [
          {
            block_id: "blk_the_model_added_a_section",
            body_md: "x".repeat(200),
            source_fact_bundle_ids: [BUNDLE.fact_bundle_id],
          },
        ],
      }),
    ]);
    const out = await generatePageCopy(SAMPLE_PAGE_SPEC, [BUNDLE], { deps: deps(p.provider) });
    expect(out.engine).toBe("content_bank");
    expect(out.spec).toEqual(SAMPLE_PAGE_SPEC);
  });
});

describe("A06's own deterministic stage is the last gate before the copy is accepted", () => {
  it("copy thin enough to fail A06 is rejected here, before it ever reaches A06", async () => {
    const blocks = SAMPLE_PAGE_SPEC.content_blocks.map((b) => ({
      block_id: b.block_id,
      body_md: "Short.".padEnd(90, " ok"),
      source_fact_bundle_ids: [BUNDLE.fact_bundle_id],
    }));
    const p = provider([reply({ blocks })]);
    const out = await generatePageCopy(SAMPLE_PAGE_SPEC, [BUNDLE], { deps: deps(p.provider) });
    expect(out.engine).toBe("content_bank");
    expect(out.fallback_reason).toMatch(/A06's deterministic checks/);
    expect(out.rejections.some((r) => r.check === "content.not_thin")).toBe(true);
    expect(out.spec).toEqual(SAMPLE_PAGE_SPEC);
  });
});

describe("the fallback contract", () => {
  it("with the flag off — the shipped state — no model is called and the page is the bank's", async () => {
    const p = provider([reply({ blocks: cleanBlocks(SAMPLE_PAGE_SPEC) })]);
    const out = await generatePageCopy(SAMPLE_PAGE_SPEC, [BUNDLE], {
      deps: deps(p.provider, DEFAULT_AI_POLICY),
    });
    expect(out.engine).toBe("content_bank");
    expect(out.fallback_reason).toMatch(/^disabled/);
    expect(p.calls).toBe(0);
    expect(out.spec).toEqual(SAMPLE_PAGE_SPEC);
  });

  it("no bundles means no call — a model with no sources can only invent", async () => {
    const p = provider([reply({ blocks: cleanBlocks(SAMPLE_PAGE_SPEC) })]);
    const out = await generatePageCopy(SAMPLE_PAGE_SPEC, [], { deps: deps(p.provider) });
    expect(out.engine).toBe("content_bank");
    expect(p.calls).toBe(0);
    expect(out.spec).toEqual(SAMPLE_PAGE_SPEC);
  });

  for (const reason of ["rate_limited", "timeout", "refused", "http_error"] as const) {
    it(`${reason} returns the content bank's page unchanged`, async () => {
      const p = provider([
        { ok: false, reason, detail: "simulated", provider: "fake", attempts: 1 },
      ]);
      const out = await generatePageCopy(SAMPLE_PAGE_SPEC, [BUNDLE], { deps: deps(p.provider) });
      expect(out.engine).toBe("content_bank");
      expect(out.fallback_reason).toContain(reason);
      expect(out.spec).toEqual(SAMPLE_PAGE_SPEC);
    });
  }
});
