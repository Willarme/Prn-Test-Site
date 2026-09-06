import { z } from "zod";
import type { FactBundle } from "@/domain/search/contracts";
import { lintPageBeforeQa } from "@/domain/search/page-lint";
import type { PageFactoryPolicy } from "@/domain/search/page-factory-policy";
import { PageSpec } from "@/domain/search/pages";
import { runDeterministicStage } from "@/domain/search/qa";
import type { PageQaContext } from "@/domain/search/qa";
import { callModel, type CallModelDeps } from "@/platform/ai/callModel";
import type { PromptIdentity } from "@/platform/ai/prompt";

/**
 * A05 — MODEL-WRITTEN PAGE COPY, behind the content bank.
 *
 * ─── THE ONE RULE THIS FILE EXISTS TO ENFORCE ──────────────────────────────
 *
 * MODEL TEXT THAT FAILS A LINT NEVER REACHES THE PUBLISH PATH. Not "is flagged
 * on the way past" — never reaches it. A draft is assembled into a candidate
 * PageSpec and then put through the SAME two gauntlets the page would face
 * later, before anything is returned:
 *
 *   1. A05's own pre-filter, `lintPageBeforeQa` — the urgency-slot and
 *      directory-framing rules.
 *   2. A06's deterministic stage, `runDeterministicStage` — every blocker check
 *      it runs on a real page, run here on a draft.
 *
 * A single blocker from either, and the model's text is discarded and the
 * content bank's copy is returned unchanged. The page a homeowner would see is
 * then byte-identical to today's. This is deliberately redundant with what
 * happens downstream: a page that fails at A06 has already cost a QA run, an
 * owner's attention on a queue, and a repair cycle. Catching it here costs one
 * function call.
 *
 * ─── WHAT THE SCHEMA MAKES STRUCTURALLY IMPOSSIBLE ─────────────────────────
 *
 * Two of the five prohibitions are not checks at all, they are types:
 *
 *   - `block_id` is a CLOSED ENUM of the slots the deterministic spec already
 *     built. The model cannot add a section, remove one, or reorder the page.
 *   - `source_fact_bundle_ids` is a CLOSED ENUM of the bundle ids it was
 *     handed; a block citing none fails `.min(1)`. This proves reference
 *     membership only. It does not prove that a sentence is supported by the
 *     referenced statement; the review must not claim semantic provenance.
 *
 * The other three — invented prices, manufactured urgency, directory framing —
 * are stated in the prompt and checked against bounded patterns afterwards.
 * Those patterns catch named prohibited classes; they are not a complete
 * semantic safety or factual-support checker.
 *
 * ─── AND ONE MORE, WHICH IS THE REASON FOR THE WHOLE FILE'S CAUTION ────────
 *
 * NO NEW SAFETY INSTRUCTIONS. The content bank's safety copy is human-written,
 * US-jurisdiction-specific and reviewed. A model that helpfully adds "call 911"
 * or "shut off your gas at the meter" to a page has written safety guidance
 * nobody approved, on the surface a frightened person reads first. So any
 * emergency-instruction phrasing in model copy that is not already present in
 * the supplied bundles is a rejection.
 *
 * ─── PRIVACY ───────────────────────────────────────────────────────────────
 *
 * `handles_customer_data: false`, and it is structural rather than a promise: a
 * PageSpec carries no customer data by contract ("doors, not brains"), and the
 * brief below is assembled from the page's own copy and approved public-safe
 * FactBundles. Nothing a homeowner typed can reach this prompt.
 */

export const PAGE_COPY_PROMPT: PromptIdentity = {
  prompt_id: "a05.generate_page_copy",
  prompt_version: "1.0.0",
};

const PAGE_COPY_CAPABILITY = "generate_page_copy";

/* -------------------------------------------------------------------------- */
/* THE POST-HOC CODE CHECKS — A05's own, independent of A06's                 */
/* -------------------------------------------------------------------------- */

/**
 * A THIRD implementation of these families, and that is the point. A05's
 * pre-filter has one, A06's inspector has another written from the same canon
 * rule by a different build, and this is a third that runs on model output
 * specifically. Three lists written independently catch each other's gaps; one
 * list shared three ways fails three times on the input it misses.
 */
const INVENTED_PRICE =
  /(\$\s?\d|\b\d+\s?(dollars|usd)\b|\bcosts? (about|around|roughly|typically|usually|between)\b|\btypical(ly)? costs?\b|\baverage (cost|price)\b|\bper hour\b|\bflat (rate|fee)\b|\bfree estimate\b|\bno[- ]obligation quote\b)/i;

const MANUFACTURED_URGENCY =
  /\b(act (now|fast|today)|before it'?s too late|limited[- ]time|last chance|today only|don'?t wait|hurry|while supplies last|call (now|today) to (avoid|save)|every (minute|hour|day) counts|the longer you wait|will only get worse|could cost you thousands|don'?t risk)\b/i;

const DIRECTORY_FRAMING =
  /\b(compare (providers|contractors|quotes|pros|prices)|browse (all|our|hundreds)|hundreds of (trusted )?(providers|contractors|pros)|choose from (our|hundreds|dozens)|provider directory|directory of (providers|contractors)|shop around|find the best (provider|contractor|pro)|top \d+ (providers|contractors)|our network of|list of (providers|contractors)|get (multiple|several) quotes)\b/i;

const CREDENTIAL_CLAIM =
  /\b(licensed and insured|fully licensed|vetted|background[- ]checked|pre[- ]screened|certified professionals?|our (verified|vetted|trusted) (pros|providers|contractors)|we (verify|vet|screen))\b/i;

/**
 * EMERGENCY-INSTRUCTION PHRASING. Not "any mention of safety" — describing a
 * hazard is exactly what a door page is for. This matches an INSTRUCTION to take
 * an emergency action, which is the class of copy that is human-written,
 * jurisdiction-specific and approved elsewhere.
 */
const SAFETY_INSTRUCTION =
  /\b(call 9-?1-?1|dial 9-?1-?1|emergency (line|services|number)|evacuate|leave the (building|house|home) (now|immediately)|shut off the (gas|main|water main|breaker)|turn off the (gas|main|power) at|gas utility|utility'?s emergency)\b/i;

// These checks apply in every generated body, including an allowed intent-answer
// slot. Protecting the safety block IDs alone does not stop a model from placing
// work instructions in another paragraph. Match action/subject co-occurrence
// across unapproved sentences to also catch passive and pronoun continuations.
// Deliberately conservative: an uncertain new instruction falls back to the
// reviewed bank. These are bounded patterns, never a complete safety guarantee.
const HAZARDOUS_SUBJECT = /\b(capacitors?|contactors?|refrigerant|freon|r[- ]?410a|r[- ]?22|(?:live|energized|electrical)\s+(?:circuits?|wires?|terminals?|contacts?))\b/i;
const WORK_ACTION = /\b(open(?:ed|ing)?|remov(?:e|ed|ing)|touch(?:ed|ing)?|short(?:ed|ing)?|bridg(?:e|ed|ing)|discharg(?:e|ed|ing)|bypass(?:ed|ing)?|charg(?:e|ed|ing)|recharg(?:e|ed|ing)|add(?:ed|ing)?|inject(?:ed|ing)?|refill(?:ed|ing)?|vent(?:ed|ing)?|releas(?:e|ed|ing)|test(?:ed|ing)?|measur(?:e|ed|ing)|prob(?:e|ed|ing)|check(?:ed|ing)?|inspect(?:ed|ing)?|swap(?:ped|ping)?|replac(?:e|ed|ing)|connect(?:ed|ing)?|disconnect(?:ed|ing)?)\b|\btop(?:ped|ping)?\b.{0,50}\b(?:up|off)\b/i;
const ENCLOSURE_SUBJECT = /\b(panels?|compartments?|covers?|cabinets?|(?:outdoor|indoor|condenser|air[ -]?handler)\s+units?)\b/i;
const ACCESS_ACTION = /\b(open(?:ed|ing)?|remov(?:e|ed|ing)|unscrew(?:ed|ing)?|detach(?:ed|ing)?|disassembl(?:e|ed|ing)|lift(?:ed|ing)?|pry|pried|prying|access(?:ed|ing)?|reach(?:ed|ing)?\s+(?:inside|into)|expos(?:e|ed|ing))\b|\btak(?:e|en|ing)\b.{0,60}\b(?:off|apart)\b/i;

function safetySentences(text: string): string[] {
  // Compare complete source sentences, ignoring layout-only Markdown/whitespace.
  // A shared short match such as "shut off the main" grants no exception to a
  // longer/new instruction that happens to start with those same words.
  return (text.normalize("NFKC").replace(/[*_`]/g, "").match(/[^.!?\n]+[.!?]?/g) ?? [])
    .map(sentence => sentence.replace(/^\s*[-+]\s+/, "").replace(/\s+/g, " ").trim().toLowerCase())
    .filter(Boolean);
}

export interface CopyRejection {
  check: string;
  where: string;
  message: string;
}

/**
 * Every reason this draft is not usable. Returns them ALL rather than the first:
 * a rejection an owner reads should carry the whole trail, the same discipline
 * `exclusionHits` uses on the A04 side.
 */
export function checkGeneratedCopy(
  blocks: ReadonlyArray<{ block_id: string; body_md: string }>,
  approvedSafetyText: string
): CopyRejection[] {
  const rejections: CopyRejection[] = [];
  const approvedSentences = new Set(safetySentences(approvedSafetyText));
  // A model can introduce equipment in one block and refer to it as "it" in
  // another. Section boundaries cannot erase that hazardous subject context.
  const subjectContext = blocks.flatMap(block => safetySentences(block.body_md)).join(" ");

  for (const block of blocks) {
    for (const [check, pattern, message] of [
      ["copy.no_invented_price", INVENTED_PRICE, "a price or cost claim — every PRN dollar is a TEST figure and no consumer pricing is decided"],
      ["copy.no_manufactured_urgency", MANUFACTURED_URGENCY, "manufactured urgency — describe the hazard, never apply pressure"],
      ["copy.no_directory_framing", DIRECTORY_FRAMING, "comparison-shopping / directory framing — the page offers one clear next step"],
      ["copy.no_credential_claim", CREDENTIAL_CLAIM, "a claim about someone's credentials — the verification standard is undecided (Master Todo T2-07)"],
    ] as const) {
      const hit = block.body_md.match(pattern);
      if (hit) {
        rejections.push({
          check,
          where: block.block_id,
          message: `${message}: "${hit[0].trim()}"`,
        });
      }
    }

    const sentences = safetySentences(block.body_md);
    const unapproved = sentences.filter(sentence => !approvedSentences.has(sentence)).join(" ");
    if (SAFETY_INSTRUCTION.test(unapproved)) {
      rejections.push({
        check: "copy.no_new_safety_instruction",
        where: block.block_id,
        message: "Generated emergency guidance is not an exact approved-source sentence; use the reviewed safety copy unchanged.",
      });
    }
    if ((HAZARDOUS_SUBJECT.test(subjectContext) && WORK_ACTION.test(unapproved)) ||
      (ENCLOSURE_SUBJECT.test(subjectContext) && ACCESS_ACTION.test(unapproved))) {
      rejections.push({
        check: "copy.no_hazardous_work_instruction",
        where: block.block_id,
        message: "Generated copy combines a high-risk electrical, refrigerant or enclosure subject with work/access directions; use the reviewed source unchanged.",
      });
    }
  }
  return rejections;
}

/* -------------------------------------------------------------------------- */
/* THE CALL                                                                   */
/* -------------------------------------------------------------------------- */

function buildSchema(blockIds: readonly string[], bundleIds: readonly string[]) {
  return z.object({
    blocks: z
      .array(
        z.object({
          block_id: z.enum(blockIds as [string, ...string[]]),
          body_md: z.string().min(80).max(2_500),
          source_fact_bundle_ids: z
            .array(z.enum(bundleIds as [string, ...string[]]))
            .min(1),
        })
      )
      .min(1)
      .max(blockIds.length),
  });
}

function buildJsonSchema(
  blockIds: readonly string[],
  bundleIds: readonly string[]
): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: ["blocks"],
    properties: {
      blocks: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["block_id", "body_md", "source_fact_bundle_ids"],
          properties: {
            block_id: { type: "string", enum: [...blockIds] },
            body_md: { type: "string" },
            source_fact_bundle_ids: {
              type: "array",
              minItems: 1,
              items: { type: "string", enum: [...bundleIds] },
            },
          },
        },
      },
    },
  };
}

const SYSTEM = [
  "You are rewriting the body copy of ONE page that answers ONE home-repair search. The page's structure, headings and sections are fixed and were decided before you were called. You are writing the text inside sections that already exist.",
  "",
  "YOUR ONLY SOURCE IS THE FACT BUNDLES BELOW. Every statement you make must be supported by one of them, and every block must name the bundle ids it drew from. You have no other knowledge of this topic for the purposes of this page. If a bundle does not support a sentence you want to write, do not write it.",
  "",
  "WRITE FOR SOMEONE WHOSE HOME HAS A PROBLEM RIGHT NOW. Plain, calm, specific. Short paragraphs and short lists. No marketing register, no rhetorical questions, no 'don't worry'.",
  "",
  "ABSOLUTELY NOT, and each of these is checked in code after you answer — a violation discards your entire draft:",
  "  - No prices, cost ranges, hourly rates, 'free estimates', or any money figure.",
  "  - No urgency devices: no 'act now', no countdowns, no scarcity, no warnings that waiting will cost them.",
  "  - No comparison shopping and no directory framing: never 'compare providers', 'browse our network', 'get multiple quotes'.",
  "  - No claims about anyone's licensing, insurance, vetting, screening or certification.",
  "  - No emergency instructions of your own. Not 'call 911', not 'shut off the gas', not 'evacuate'. Safety copy on this page was written and reviewed by a person; if a bundle carries it, you may restate it; you may never add to it.",
  "",
  "DESCRIBING A HAZARD IS NOT URGENCY. 'A burning smell means stop using the circuit' is guidance the bundles support. 'Every minute counts' is pressure. The line is whether the sentence tells them what is true or tells them how to feel.",
  "",
  "Return only the blocks you were asked for, keyed by their ids.",
].join("\n");

function userPrompt(
  spec: PageSpec,
  bundles: readonly FactBundle[],
  slots: ReadonlyArray<{ block_id: string; kind: string; heading: string | null }>
): string {
  return [
    `SEARCH THIS PAGE ANSWERS: ${spec.primary_query}`,
    `PROBLEM AREA: ${spec.problem_family ?? "not classified"}`,
    "",
    "FACT BUNDLES — your only source:",
    ...bundles.flatMap((b) => [
      `  bundle ${b.fact_bundle_id} (topic: ${b.topic})`,
      ...b.facts.map((f) => `    - [${f.confidence}] ${f.statement}`),
    ]),
    "",
    "SECTIONS TO WRITE:",
    ...slots.map(
      (s) => `  ${s.block_id} — kind "${s.kind}", heading "${s.heading ?? "(none)"}"`
    ),
  ].join("\n");
}

export interface GeneratePageCopyOptions {
  /** A caller can keep approved safety sections outside the model's writable schema. */
  writableBlockIds?: readonly string[];
  /** A05's namespaced policy sub-block, for the lint. */
  policy?: PageFactoryPolicy;
  /** Context for A06's deterministic re-check. Same shape the QA run uses. */
  qaContext?: PageQaContext;
  deps?: CallModelDeps;
}

export interface PageCopyOutcome {
  /**
   * ALWAYS PRESENT. On every rejection and every failure path this is the spec
   * that was handed in — the content bank's page, unchanged, byte for byte.
   */
  spec: PageSpec;
  engine: "content_bank" | "model" | "frozen_template";
  /** Null on the model path; the recorded reason on every fallback. */
  fallback_reason: string | null;
  /** Which gauntlet rejected the draft, when one did. Empty otherwise. */
  rejections: CopyRejection[];
  run_id: string | null;
  /** TEST. Null when no model ran. */
  cost_usd: number | null;
}

export async function generatePageCopy(
  spec: PageSpec,
  bundles: readonly FactBundle[],
  options: GeneratePageCopyOptions = {}
): Promise<PageCopyOutcome> {
  if (spec.door_template || spec.template_id === "door-v43") {
    PageSpec.parse(spec);
    return { spec, engine: "frozen_template", fallback_reason: "Reviewed v43 copy is frozen; update the reviewed source kit before creating a new version.", rejections: [], run_id: null, cost_usd: null };
  }
  const fallback = (
    reason: string,
    rejections: CopyRejection[] = [],
    runId: string | null = null,
    cost: number | null = null
  ): PageCopyOutcome => ({
    spec,
    engine: "content_bank",
    fallback_reason: reason,
    rejections,
    run_id: runId,
    cost_usd: cost,
  });

  if (bundles.length === 0) {
    return fallback(
      "no approved fact bundles were supplied — a model with no sources can only invent, so it is not asked"
    );
  }

  const slots = spec.content_blocks.filter(b => !options.writableBlockIds || options.writableBlockIds.includes(b.block_id)).map((b) => ({
    block_id: b.block_id,
    kind: b.kind as string,
    heading: b.heading,
  }));
  if (slots.length === 0) return fallback("no writable content blocks were supplied");
  const blockIds = slots.map((s) => s.block_id);
  const bundleIds = bundles.map((b) => b.fact_bundle_id);

  const call = await callModel({
    agent_id: "A05",
    capability: PAGE_COPY_CAPABILITY,
    // Structural, not a promise: a PageSpec carries no customer data by contract
    // and the brief is the page's own copy plus approved public-safe bundles.
    handles_customer_data: false,
    prompt_id: PAGE_COPY_PROMPT.prompt_id,
    prompt_version: PAGE_COPY_PROMPT.prompt_version,
    system: SYSTEM,
    user: userPrompt(spec, bundles, slots),
    schema_name: "A05PageCopy",
    schema: buildSchema(blockIds, bundleIds),
    json_schema: buildJsonSchema(blockIds, bundleIds),
    input_ids: [spec.page_spec_id, ...bundleIds],
    tenant_id: spec.tenant_id,
    trigger: "job",
    deps: options.deps,
  });

  if (!call.ok) {
    return fallback(`${call.reason}: ${call.detail}`, [], call.run_id);
  }

  const draft = call.value as { blocks: Array<{ block_id: string; body_md: string; source_fact_bundle_ids: string[] }> };
  const byId = new Map(draft.blocks.map((b) => [b.block_id, b]));

  /**
   * THE PATTERN CHECKS, on the model's text only. `approvedSafetyText` is the
   * copy the deterministic page already carries, so a model that repeats the
   * approved safety line is fine and a model that writes a new one is not.
   */
  const approvedSafetyText = spec.content_blocks.map((b) => b.body_md).join("\n");
  const rejections = checkGeneratedCopy(
    draft.blocks.map((b) => ({ block_id: b.block_id, body_md: b.body_md })),
    approvedSafetyText
  );
  if (rejections.length > 0) {
    return fallback(
      `the draft failed A05's copy checks (${rejections.length}) — the content bank's copy is used instead`,
      rejections,
      call.run_id,
      call.cost_usd
    );
  }

  // Assemble the candidate. Blocks the model did not return keep the bank's copy.
  const candidateBlocks = spec.content_blocks.map((block) => {
    const written = byId.get(block.block_id);
    if (!written) return block;
    return {
      ...block,
      body_md: written.body_md,
      /**
       * PROVENANCE IS THE UNION, never a replacement. The bank's bundle stays
       * cited because the block's structure and its heading still come from it;
       * the model's cited bundles are added. A06's provenance check reads the
       * page-level list, so the page keeps citing everything its blocks do.
       */
      source_fact_bundle_ids: [
        ...new Set([...block.source_fact_bundle_ids, ...written.source_fact_bundle_ids]),
      ],
    };
  });

  const parsed = PageSpec.safeParse({
    ...spec,
    content_blocks: candidateBlocks,
    source_fact_bundle_ids: [
      ...new Set(candidateBlocks.flatMap((b) => b.source_fact_bundle_ids)),
    ],
    generation: {
      model: call.model_id,
      prompt_id: PAGE_COPY_PROMPT.prompt_id,
      prompt_version: PAGE_COPY_PROMPT.prompt_version,
    },
  });
  if (!parsed.success) {
    return fallback(
      `the draft did not produce a valid PageSpec: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
      [],
      call.run_id,
      call.cost_usd
    );
  }
  const candidate = parsed.data;

  // A05's OWN pre-filter — the gate a bank-written page passes today.
  const lint = lintPageBeforeQa(candidate, options.policy);
  if (!lint.passed) {
    return fallback(
      "the draft failed A05's pre-QA lint — the content bank's copy is used instead",
      lint.findings
        .filter((f) => f.severity === "blocker")
        .map((f) => ({ check: f.check, where: f.where, message: f.message })),
      call.run_id,
      call.cost_usd
    );
  }

  /**
   * A06's DETERMINISTIC STAGE, run here on the draft. Not a courtesy check: this
   * is the gauntlet that decides whether the page can ever be published, and
   * running it before the copy is accepted is what makes "model text that fails a
   * lint never reaches the publish path" true rather than aspirational.
   */
  const qa = runDeterministicStage(candidate, options.qaContext ?? {});
  const blockers = qa.findings.filter((f) => f.severity === "blocker");
  if (blockers.length > 0) {
    return fallback(
      `the draft failed A06's deterministic checks (${blockers.length} blocker${blockers.length === 1 ? "" : "s"}) — the content bank's copy is used instead`,
      blockers.map((f) => ({ check: f.check, where: f.where, message: f.message })),
      call.run_id,
      call.cost_usd
    );
  }

  return {
    spec: candidate,
    engine: "model",
    fallback_reason: null,
    rejections: [],
    run_id: call.run_id,
    cost_usd: call.cost_usd,
  };
}
