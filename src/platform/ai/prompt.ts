/**
 * PROMPTS AS VERSIONED DATA, and the machinery that makes json_object mode safe.
 *
 * TWO THINGS LIVE HERE AND NEITHER OF THEM IS A PROMPT. This file is platform
 * code: it carries no market vocabulary, no brand, no trade names, no product
 * copy. Actual prompt TEXT lives with the capability that owns it, is stamped
 * with a `prompt_version`, and takes its vocabulary from configuration — so a
 * second client's deployment changes a config document, not this module.
 *
 * ─── 1. THE SCHEMA-IN-THE-PROMPT RENDERER ───────────────────────────────────
 *
 * In `json_schema` mode the API enforces the shape and this is unused. In
 * `json_object` mode the API guarantees only that the reply is syntactically
 * valid JSON, so the SHAPE has to be stated in the prompt and enforced by us
 * afterwards. `stealth/ox-alpha` — the model the owner is starting on — is in
 * that class.
 *
 * The rendering is deliberately blunt: the literal JSON Schema, plus rules that
 * leave no room for a friendly preamble. Every failure mode observed with
 * schema-in-prompt models is a formatting habit, not a comprehension problem —
 * a ```json fence, an apology, a "Here is the JSON:" line — so the rules name
 * each one.
 *
 * ─── 2. THE REPAIR MESSAGE ──────────────────────────────────────────────────
 *
 * When a reply fails zod, the ONE retry gets the validation error back verbatim.
 * Not a re-ask: a diff. A model told "expected an array at .findings, received a
 * string" fixes it; a model told "that was wrong, try again" produces a different
 * wrong answer.
 */

/** Strip the code fence a schema-in-prompt model habitually adds. */
export function unfence(raw: string): string {
  const trimmed = raw.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed);
  if (fenced) return fenced[1].trim();
  return trimmed;
}

/**
 * Pull the first balanced JSON object out of a reply that wrapped it in prose.
 * Returns null when there is nothing object-shaped to find — a null here becomes
 * `invalid_json`, never a guess.
 */
export function extractJsonObject(raw: string): string | null {
  const text = unfence(raw);
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      if (inString) escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * The rules appended to a system prompt in json_object mode. Vocabulary-free by
 * construction — it talks about JSON, not about the domain.
 */
export function renderSchemaInstructions(
  schemaName: string,
  jsonSchema: Record<string, unknown>
): string {
  return [
    "",
    "OUTPUT CONTRACT — this is not a style preference, it is the interface.",
    "",
    `Reply with ONE JSON object matching the schema named "${schemaName}" below.`,
    "",
    "Rules, all of them absolute:",
    "  1. The entire reply is the JSON object. No prose before it, none after.",
    "  2. No markdown code fence. No ``` of any kind.",
    "  3. Every required property is present. No properties outside the schema.",
    "  4. Where the schema names an enum, use one of its values exactly, character for character.",
    "  5. If you cannot determine a value, use the schema's stated null/empty form. Do not invent one, and do not omit the property.",
    "  6. Never explain, apologise, or add a field to comment on your own answer.",
    "",
    "SCHEMA:",
    JSON.stringify(jsonSchema, null, 2),
  ].join("\n");
}

/**
 * The one repair turn. Carries the model's own reply back with the exact
 * validation error, because a specific correction lands and a vague one does not.
 */
export function renderRepairPrompt(previousReply: string, validationError: string): string {
  return [
    "Your previous reply did not satisfy the output contract.",
    "",
    "WHAT YOU SENT:",
    previousReply.slice(0, 4_000),
    "",
    "WHY IT WAS REJECTED:",
    validationError,
    "",
    "Send the corrected JSON object and nothing else. Same rules as before: no prose, no code fence, every required property present, enum values exact.",
  ].join("\n");
}

/**
 * A prompt's identity on the ledger row. Every model-backed capability exports
 * one of these, and it travels onto every run record and every event — so "which
 * prompt produced this output" is answerable from history rather than from
 * whatever is in the file today.
 */
export interface PromptIdentity {
  prompt_id: string;
  prompt_version: string;
}
