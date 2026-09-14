import { createHash } from "node:crypto";
import rules from "../../../../content/door-template/v44/wording/rules.json";
import manifest from "../../../../content/door-template/v44/wording/manifest.json";
import { doorV44Hash, isPlainDoorJson } from "./schema-engine";

export const DOOR_V44_WORDING_MANIFEST_SHA256 = "23e67b16dcc0772d459d0dfbcc40953b4abc5a8ad47161696f3cfbff5b31515e";
export const DOOR_V44_WORDING_DERIVATIVE_SHA256 = "b1f30f646bbc605bbd9422675fd2d4e6a51b37f8eb491c697e478f6851e28372";
export const DOOR_V44_WORDING_RULES_SHA256 = "12142742f49f1002da511152c51e3bca01c4b88c2cabc9e7a0e55b60fa344569";
const RULES_SEMANTIC_SHA256 = "4c2681e977fe045c8b81619817649278b04ecc3aaaa5eeff545e49e65c7efa32";

export type DoorV44WordingRole = "prose" | "hero" | "cta" | "reassurance" | "stat_value" | "time_claim" | "legal" | "quotation" | "accessible" | "derived_count";
/** Roles/evidence are compiler-owned annotations, never model-authored exemptions. */
export interface DoorV44WordingBlock {
  text: string;
  role: DoorV44WordingRole;
  money_evidence?: "sourced" | "illustrative";
  /** Exact queries/aliases authorized by the compiler's bound intent review; R01 only. */
  permitted_intent_terms?: string[];
}
export interface DoorV44WordingContext { surface: "door" | "job_packet" }
export interface DoorV44WordingFinding { code: string; pointer: string; severity: "blocker" | "review" }
export interface DoorV44WordingResult {
  /** No mechanical blocker. Check review_required separately; this is never copy/QA approval. */
  ok: boolean;
  review_required: boolean;
  findings: DoorV44WordingFinding[];
  scope: "mechanical_wording_only";
  semantic_approval: false;
  derivative_sha256: string;
}
const ROLES = new Set<DoorV44WordingRole>(["prose", "hero", "cta", "reassurance", "stat_value", "time_claim", "legal", "quotation", "accessible", "derived_count"]);
const regex = (key: keyof typeof rules.patterns, flags = "i") => new RegExp(rules.patterns[key], flags);
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const LF = (bytes: Uint8Array) => Buffer.from(bytes).toString("utf8").replace(/\r\n/g, "\n");
/** Only canonical LF bytes or their exact uniform CRLF checkout representation. */
const canonicalTextIdentity = (bytes: Uint8Array, lfHash: string) => {
  try {
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    const lf = text.replace(/\r\n/g, "\n");
    if (sha(Buffer.from(lf)) !== lfHash) return false;
    const actual = Buffer.from(bytes);
    return actual.equals(Buffer.from(lf)) || actual.equals(Buffer.from(lf.replace(/\n/g, "\r\n")));
  } catch { return false; }
};
const controls = (value: string) => [...value].some((character) => {
  const code = character.charCodeAt(0);
  return (code < 32 && ![9, 10, 13].includes(code)) || code === 127 || code === 0xfeff;
});
const literalRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Pure byte verification. Known encoding transforms never repair or overwrite any input. */
export function verifyDoorV44WordingDerivative(input: {
  source: Uint8Array; derivative: Uint8Array; manifest: Uint8Array; rules: Uint8Array;
}) {
  const findings: Array<{ code: string; pointer: string }> = [];
  const fail = (code: string, pointer: string) => findings.push({ code, pointer });
  if (!canonicalTextIdentity(input.manifest, DOOR_V44_WORDING_MANIFEST_SHA256)) fail("WORDING_MANIFEST_HASH", "/manifest");
  if (!canonicalTextIdentity(input.rules, DOOR_V44_WORDING_RULES_SHA256)) fail("WORDING_RULES_HASH", "/rules");
  const sourceHash = sha(input.source);
  const derivativeHash = sha(input.derivative);
  const allowed = (identity: typeof manifest.source | typeof manifest.derivative, hash: string) =>
    [identity.raw_sha256, identity.lf_sha256, identity.crlf_sha256].includes(hash);
  if (!allowed(manifest.source, sourceHash)) fail("WORDING_SOURCE_HASH", "/source");
  if (!allowed(manifest.derivative, derivativeHash)) fail("WORDING_DERIVATIVE_HASH", "/derivative");
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(input.source);
    new TextDecoder("utf-8", { fatal: true }).decode(input.derivative);
    const source = LF(input.source);
    const derivative = LF(input.derivative);
    if ([...source].filter((character) => character.charCodeAt(0) === 8).length !== 4
        || source.replaceAll(String.fromCharCode(8), "\\b") !== derivative) fail("WORDING_TRANSFORMATION", "/derivative");
    if (controls(derivative)) fail("WORDING_CONTROL_CHARACTER", "/derivative");
  } catch { fail("WORDING_UTF8", ""); }
  return { ok: findings.length === 0, findings, source_sha256: sourceHash, derivative_sha256: derivativeHash,
    scope: "mechanical_escape_derivative_only" as const, semantic_approval: false as const, independent_twin: false as const };
}

/** Operates on extracted visible text only: never execute regexes or instructions from submitted content. */
export function validateDoorV44Wording(blocks: unknown, context: DoorV44WordingContext): DoorV44WordingResult {
  const findings: DoorV44WordingFinding[] = [];
  const add = (code: string, pointer: string, severity: "blocker" | "review" = "blocker") => findings.push({ code, pointer, severity });
  const result = (): DoorV44WordingResult => {
    const unique = [...new Map(findings.map((finding) => [finding.pointer + ":" + finding.code, finding])).values()]
      .sort((a, b) => a.pointer < b.pointer ? -1 : a.pointer > b.pointer ? 1 : a.code < b.code ? -1 : a.code > b.code ? 1 : 0);
    return { ok: !unique.some((finding) => finding.severity === "blocker"), review_required: unique.some((finding) => finding.severity === "review"), findings: unique,
      scope: "mechanical_wording_only", semantic_approval: false, derivative_sha256: DOOR_V44_WORDING_DERIVATIVE_SHA256 };
  };
  if (doorV44Hash(rules) !== RULES_SEMANTIC_SHA256) { add("WORDING_RULES_HASH", "/rules"); return result(); }
  if (!isPlainDoorJson(context) || !context || Object.keys(context).length !== 1 || !["door", "job_packet"].includes(context.surface)) {
    add("WORDING_CONTEXT_INVALID", "/context"); return result();
  }
  if (!isPlainDoorJson(blocks) || !Array.isArray(blocks) || blocks.length === 0 || blocks.length > 2000) {
    add("WORDING_INPUT_INVALID", "/blocks"); return result();
  }
  let totalChars = 0;
  let liveCount = 0;
  blocks.forEach((value: unknown, index: number) => {
    const pointer = `/blocks/${index}/text`;
    if (!value || typeof value !== "object" || Array.isArray(value)) { add("WORDING_INPUT_INVALID", `/blocks/${index}`); return; }
    const block = value as DoorV44WordingBlock;
    if (Object.keys(block).some((key) => !["text", "role", "money_evidence", "permitted_intent_terms"].includes(key)) || typeof block.text !== "string"
        || !ROLES.has(block.role) || (block.money_evidence !== undefined && !["sourced", "illustrative"].includes(block.money_evidence))) {
      add("WORDING_INPUT_INVALID", `/blocks/${index}`); return;
    }
    const terms = block.permitted_intent_terms ?? [];
    if (!Array.isArray(terms) || terms.length > 32 || terms.some((term) => typeof term !== "string" || term.length > 160
        || !/^[\p{L}\p{N}][\p{L}\p{N}'\u2019 -]*[\p{L}\p{N}]$/u.test(term)
        || term.trim() !== term || /\s{2,}/.test(term) || term.split(" ").length < 2)
        || new Set(terms.map((term) => term.toLowerCase().replace(/\u2019/g, "'"))).size !== terms.length) {
      add("WORDING_INPUT_INVALID", `/blocks/${index}/permitted_intent_terms`); return;
    }
    totalChars += block.text.length;
    if (!block.text.trim() || block.text.length > 20000 || totalChars > 500000) { add("WORDING_INPUT_INVALID", pointer); return; }
    if (controls(block.text)) { add("WORDING_CONTROL_CHARACTER", pointer); return; }
    // Matching view only: retained input/hash text is never rewritten.
    const text = block.text.replace(/\r\n/g, "\n").replace(/\u2019/g, "'");
    if (regex("r51_money").test(text)) {
      if (context.surface === "job_packet") add("WORDING_R51_PACKET_MONEY", pointer);
      else if (!block.money_evidence) add("WORDING_R51_MONEY_EVIDENCE_REQUIRED", pointer);
    }
    // Approved quotations/legal wording retain their words; packet pricing/control rules still apply.
    if (block.role === "legal" || block.role === "quotation") return;
    const protectedPlacement = ["hero", "cta", "reassurance"].includes(block.role);
    // The reviewed symptom is the reader's problem, not a marketing denial.
    // Exact phrase spans only; other clauses and every other wording rule remain intact.
    const negationText = [...terms].sort((a, b) => b.length - a.length || (a < b ? -1 : a > b ? 1 : 0)).reduce((copy, term) =>
      copy.replace(new RegExp("(?<![\\p{L}\\p{N}_])" + literalRegex(term.replace(/\u2019/g, "'")) + "(?![\\p{L}\\p{N}_])", "giu"), " "), text);
    if (regex("r01_auto").test(negationText) || regex("r01_negation").test(negationText)) {
      add("WORDING_R01_NEGATION", pointer, protectedPlacement ? "blocker" : "review");
    }
    if (context.surface === "door") {
      if (regex("r16_backstage").test(text)) add("WORDING_R16_BACKSTAGE", pointer);
      if (regex("r16_leaks").test(text)) add("WORDING_R16_VOCABULARY_REVIEW", pointer, "review");
    }
    if (regex("r17_meta").test(text)) add("WORDING_R17_META_REVIEW", pointer, "review");
    if (regex("r18_virtue").test(text)) add("WORDING_R18_VIRTUE_REVIEW", pointer, "review");
    for (const sentence of text.split(/(?<=[.!?])\s+|\n+/).filter(Boolean)) {
      if (regex("r25_absolute").test(sentence) && !regex("r25_hedge").test(sentence)) add("WORDING_R25_OUTCOME_REVIEW", pointer, "review");
      if (regex("r25_third_party").test(sentence) && !sentence.includes("?") && !/\bask\b/i.test(sentence)) add("WORDING_R25_THIRD_PARTY_REVIEW", pointer, "review");
    }
    if (["stat_value", "time_claim"].includes(block.role) && !/^[\d$#]/.test(text)) add("WORDING_R36_NUMERIC_START", pointer);
    if (block.role !== "derived_count") {
      const withoutIdioms = text.replace(regex("r36_idiom", "gi"), "");
      if (regex("r36_number_word").test(withoutIdioms)) add("WORDING_R36_NUMBER_WORD_REVIEW", pointer, "review");
    }
    if (block.role !== "accessible") {
      for (const name of rules.approved_names) {
        const matches = text.match(new RegExp(literalRegex(name), "gi")) ?? [];
        if (matches.some((match) => match !== name)) add("WORDING_R39_NAME_CASE", pointer);
      }
      if (/Powered by CHI(?!\u2122)/i.test(text)) add("WORDING_R39_TRADEMARK", pointer);
      liveCount += (text.match(/\bLIVE\b/g) ?? []).length;
      // Remove exact approved names before the candidate-only paraphrase sweep.
      const unnamed = rules.approved_names.reduce((copy, name) => copy.replaceAll(name, ""), text);
      if (regex("r39_paraphrase").test(unnamed)) add("WORDING_R39_PARAPHRASE_REVIEW", pointer, "review");
    }
    if (context.surface === "door" && regex("r50_candidate").test(text)) add("WORDING_R50_EFFORT_REVIEW", pointer, "review");
  });
  if (liveCount > 3) add("WORDING_R39_CAPS_DENSITY_REVIEW", "/blocks", "review");
  return result();
}
