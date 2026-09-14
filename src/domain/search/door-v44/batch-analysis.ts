import { loadDoorV44Spec } from "./loader";
import { doorV44Hash, isPlainDoorJson } from "./schema-engine";
import { DOOR_V44_CONSTANTS } from "./template-constants";
import type { DoorV44Diagnostic, DoorV44RichText, DoorV44Spec, DoorV44ValidationContext } from "./types";

export interface DoorV44BatchInput { spec: DoorV44Spec; context: DoorV44ValidationContext }
export interface DoorV44BatchPair {
  page_ids: [string, string];
  pair_hash: string;
  dynamic_token_jaccard: number;
  identical_sentence_share: number;
  noun_swap_clone: boolean;
  findings: Array<"DYNAMIC_TOKEN_SIMILARITY" | "IDENTICAL_SENTENCE_SHARE" | "NOUN_SWAP_CLONE">;
  disposition: "NO_MECHANICAL_FLAG" | "REVIEW_REQUIRED" | "BLOCKED";
}
export type DoorV44BatchAnalysis = {
  ok: true;
  analysis_version: "door-v44-batch/1.0.0";
  input_hash: string;
  page_count: number;
  thresholds: { dynamic_token_jaccard: 0.72; identical_sentence_share: 0.25 };
  pairs: DoorV44BatchPair[];
  disposition: "NO_MECHANICAL_FLAG" | "REVIEW_REQUIRED" | "BLOCKED";
  release_ready: false;
  limitations: string[];
} | { ok: false; errors: DoorV44Diagnostic[] };

const normal = (text: string) => text.normalize("NFKC").toLowerCase().replace(/[\p{P}\p{S}]+/gu, " ").replace(/\s+/g, " ").trim();
const words = (text: string) => normal(text).match(/[\p{L}\p{N}]+/gu) ?? [];
function rich(nodes: DoorV44RichText): string {
  return nodes.map(node => "children" in node ? rich(node.children) + (node.type === "paragraph" || node.type === "list_item" ? "\n" : "")
    : node.type === "text" ? node.value : node.type === "line_break" ? "\n" : node.type === "source_ref" ? "" : node.label).join("");
}

/** Only decision-bearing dynamic copy. Furniture, generated counts, CTA grammar,
 * source titles/URLs, claim IDs and hidden capability rows cannot inflate these metrics.
 * No supplied review record can turn a heuristic into semantic or release approval. */
export function doorV44DecisionBlocks(spec: DoorV44Spec): string[] {
  const s = spec.sections;
  const constants = new Set(Object.values(DOOR_V44_CONSTANTS.strings).map(normal));
  return [rich(s.hero.h1), rich(s.hero.answer), rich(s.hero.cap_last), s.hero.value_heading, s.hero.value_claim,
    ...s.hero.value_rows.flatMap(row => [row.generic, rich(row.ours)]), rich(s.hero.value_foot),
    rich(spec.intake.heading), spec.intake.lede, spec.intake.help, spec.intake.placeholder,
    ...spec.intake.prompts.map(row => row.text), ...spec.intake.so_far_items,
    ...s.stats.cards.flatMap(row => [rich(row.value), row.statement, row.note]), rich(s.stats.band),
    ...s.observations.rows.flatMap(row => [row.look, row.rules_out]),
    ...s.common_causes.rows.flatMap(row => [row.cause, row.notice, row.fix_label,
      ...(spec.layout.conditional_sections.prices && row.range ? [rich(row.range)] : [])]),
    ...s.safe_observations.checks.flatMap(row => [row.heading, row.body]),
    ...s.safe_observations.never_items.map(row => row.text),
    ...s.safe_observations.stop_items.map(row => row.text),
    ...spec.visuals.flatMap(row => [row.title, row.description, rich(row.caption), row.alt]),
    ...s.flip.columns.map(row => row.body),
    ...s.general_vs_yours.rows.flatMap(row => [row.where, row.gives, row.ours]),
    ...s.capability.rows.filter(row => {
      const status = spec.capabilities.find(capability => capability.capability_id === row.capability_id)?.live_status;
      return status === "VERIFIED_LIVE" || (status === "UNVERIFIED" && row.chip_label === "STILL NEEDS TESTING");
    }).flatMap(row => [row.ask, row.tells]), rich(s.capability.band_hook),
    ...s.job_packet.example_rows.map(row => row.value), s.job_packet.band_hook,
    ...s.repair_record.cards.flatMap(row => [row.kicker, row.copy]),
    ...s.faq.questions.flatMap(row => [row.question, rich(row.answer)]),
    rich(s.closer.heading), s.closer.body,
  ].filter(block => normal(block).length > 0 && !constants.has(normal(block)));
}

function sentences(blocks: string[]): Set<string> {
  // Keep the original text until segmentation; normalization would discard boundaries.
  // Include separate table cells as units even when they have no terminal punctuation.
  return new Set(blocks.flatMap(block => block.split(/(?:[.!?]+(?=\s|$)|\n+)/u)).map(normal).filter(Boolean));
}
function intersection(a: Set<string>, b: Set<string>): number { return [...a].filter(value => b.has(value)).length; }
function subjectSkeleton(blocks: string[], spec: DoorV44Spec): string[] {
  const phrases = Object.entries(spec.subject).filter(([key]) => key !== "subject_id" && key !== "subject_kind")
    .map(([, value]) => words(value)).filter(value => value.length).sort((a, b) => b.length - a.length);
  return blocks.map(block => {
    const tokens = words(block);
    const result: string[] = [];
    for (let i = 0; i < tokens.length;) {
      const phrase = phrases.find(candidate => candidate.every((token, offset) => token === tokens[i + offset]));
      if (phrase) { result.push("<subject>"); i += phrase.length; }
      else result.push(tokens[i++]);
    }
    return result.join(" ");
  });
}

/** Pure, offline batch triage for already-governed specs. Identical intent/page IDs
 * fail; clone blockers and similarity findings remain explicit. This does not run A06. */
export function analyzeDoorV44Batch(raw: unknown): DoorV44BatchAnalysis {
  if (!Array.isArray(raw) || raw.length < 2 || raw.length > 100) {
    return { ok: false, errors: [{ code: "BATCH_INPUT_INVALID", pointer: "" }] };
  }
  const inputs: DoorV44BatchInput[] = [];
  const errors: DoorV44Diagnostic[] = [];
  const pageIds = new Set<string>();
  const intentIds = new Set<string>();
  let tenant: string | undefined;
  for (let index = 0; index < raw.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(raw, String(index));
    const entry = descriptor && "value" in descriptor ? descriptor.value : undefined;
    if (!isPlainDoorJson(entry) || !entry || Array.isArray(entry) || typeof entry !== "object"
      || Object.keys(entry).sort().join(",") !== "context,spec") {
      errors.push({ code: "BATCH_INPUT_INVALID", pointer: `/${index}` }); continue;
    }
    const input = entry as DoorV44BatchInput;
    const loaded = loadDoorV44Spec(input.spec, input.context);
    if (!loaded.ok) {
      errors.push(...loaded.errors.map(error => ({ code: error.code,
        pointer: `/${index}${error.pointer === "/context" || error.pointer.startsWith("/context/")
          ? error.pointer : error.pointer === "/schema_bundle" || error.pointer.startsWith("/schema_bundle/")
            ? "/context" + error.pointer : "/spec" + error.pointer}` })));
      continue;
    }
    const identity = loaded.spec.identity;
    if (pageIds.has(identity.page_id)) errors.push({ code: "BATCH_DUPLICATE_PAGE", pointer: `/${index}/spec/identity/page_id` });
    if (intentIds.has(identity.canonical_intent_id)) errors.push({ code: "BATCH_DUPLICATE_INTENT", pointer: `/${index}/spec/identity/canonical_intent_id` });
    if (tenant !== undefined && tenant !== identity.tenant_id) errors.push({ code: "BATCH_TENANT_MISMATCH", pointer: `/${index}/spec/identity/tenant_id` });
    pageIds.add(identity.page_id); intentIds.add(identity.canonical_intent_id); tenant = identity.tenant_id;
    inputs.push({ spec: loaded.spec, context: input.context });
  }
  if (errors.length) return { ok: false, errors };
  const projections = inputs.map(input => {
    const blocks = doorV44DecisionBlocks(input.spec);
    return { id: input.spec.identity.page_id, source_hash: doorV44Hash(input),
      tokens: new Set(words(blocks.join("\n"))), sentences: sentences(blocks),
      skeleton: subjectSkeleton(blocks, input.spec) };
  }).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  if (projections.some(row => !row.tokens.size || !row.sentences.size)) return { ok: false,
    errors: [{ code: "BATCH_DYNAMIC_CONTENT_EMPTY", pointer: "" }] };
  const pairs: DoorV44BatchPair[] = [];
  for (let left = 0; left < projections.length; left++) {
    for (let right = left + 1; right < projections.length; right++) {
      const a = projections[left], b = projections[right];
      const jaccard = intersection(a.tokens, b.tokens) / new Set([...a.tokens, ...b.tokens]).size;
      // The smaller page's copied share cannot be hidden by padding the other page.
      const share = intersection(a.sentences, b.sentences) / Math.min(a.sentences.size, b.sentences.size);
      const clone = a.skeleton.length > 0 && doorV44Hash(a.skeleton) === doorV44Hash(b.skeleton);
      const findings: DoorV44BatchPair["findings"] = [];
      if (jaccard > 0.72) findings.push("DYNAMIC_TOKEN_SIMILARITY");
      if (share > 0.25) findings.push("IDENTICAL_SENTENCE_SHARE");
      if (clone) findings.push("NOUN_SWAP_CLONE");
      pairs.push({ page_ids: [a.id, b.id], pair_hash: doorV44Hash([a.source_hash, b.source_hash]),
        dynamic_token_jaccard: jaccard, identical_sentence_share: share, noun_swap_clone: clone,
        findings, disposition: clone ? "BLOCKED" : findings.length ? "REVIEW_REQUIRED" : "NO_MECHANICAL_FLAG" });
    }
  }
  return { ok: true, analysis_version: "door-v44-batch/1.0.0",
    input_hash: doorV44Hash(projections.map(row => ({ page_id: row.id, governed_input_hash: row.source_hash }))),
    page_count: projections.length, thresholds: { dynamic_token_jaccard: 0.72, identical_sentence_share: 0.25 }, pairs,
    disposition: pairs.some(row => row.disposition === "BLOCKED") ? "BLOCKED"
      : pairs.some(row => row.disposition === "REVIEW_REQUIRED") ? "REVIEW_REQUIRED" : "NO_MECHANICAL_FLAG",
    release_ready: false,
    limitations: ["Decision-bearing dynamic copy only; template furniture and repeated display grammar excluded",
      "Sentence share uses unique visible units and the smaller page denominator to resist padding",
      "Noun-swap detection proves exact normalized subject substitution only, not all paraphrase clones",
      "Similarity findings require independent intent/claim review; no automatic waiver or release approval",
      "Full F01-F11, theme, visual, hosted and A06 acceptance must be recorded separately"],
  };
}
