/**
 * THE MODEL PORT — the boundary no vendor type crosses.
 *
 * A00 §1 states the rule this file exists to keep: "code asks for a capability,
 * never a vendor." The AI/Tool Gateway already applies that to capabilities;
 * this applies it one level lower, to the model call itself. Everything above
 * this interface — `callModel`, every capability wiring, every test — is written
 * against `ModelProvider` and knows nothing about OpenRouter, OpenAI, Anthropic
 * or whatever comes next.
 *
 * WHY THE PORT IS THE FIRST FILE AND NOT AN AFTERTHOUGHT. The owner chose
 * OpenRouter on a free model and said, in as many words, that the model will
 * change ("maybe deepseek, we will probably change it at some point"). A build
 * that hardcodes a vendor and promises to abstract it later has already made the
 * swap expensive. Here the swap is: write one file under `providers/`, and pick
 * it in `client.ts`. Nothing else moves.
 *
 * THE THREE RULES EVERY IMPLEMENTATION KEEPS:
 *
 *  1. NEVER THROW. A provider returns a typed failure, always. The caller's job
 *     is to fall back deterministically, and it cannot do that from inside a
 *     rejected promise it did not expect. This is the same fail-soft contract
 *     A00 wrote for `emitPlatformEvent` and `recordAgentRun`.
 *  2. NEVER LOG OR RETURN THE KEY. A failure reason names the CLASS of failure
 *     and the HTTP status, never a header, never a body echo that could carry
 *     one back. `no_key` is a reason, not a value.
 *  3. RETURN RAW TEXT, NOT A PARSED OBJECT. Validation is the caller's, against
 *     a zod schema the caller owns. A provider that parsed for you would be a
 *     provider that decides what "valid" means, and PRN's specs demand strict
 *     schemas, never free prose.
 */

/**
 * HOW STRUCTURED OUTPUT IS ASKED FOR — a per-model CONFIG value, never a guess
 * at call time (see models.ts).
 *
 *  json_schema  The model's API enforces the schema server-side. Verified
 *               supported by deepseek/deepseek-v4-flash and the three free
 *               models listed in models.ts (OpenRouter /api/v1/models, probed
 *               2026-08-25: `supported_parameters` contains
 *               `structured_outputs`).
 *  json_object  The model guarantees SYNTACTICALLY valid JSON and nothing more.
 *               `stealth/ox-alpha` — the model the owner is starting on — is in
 *               this class: it advertises `response_format` and `tools` but NOT
 *               `structured_outputs`. The schema then has to be carried in the
 *               prompt and enforced by us, which is exactly what
 *               `callModel` does: render the schema into the system prompt,
 *               validate the reply with zod, allow at most one repair retry, and
 *               fall back deterministically if it still does not conform.
 *
 * There is no third mode and deliberately no "auto": asking a model whether it
 * supports strict schemas is a question with a confident wrong answer.
 */
export type StructuredOutputMode = "json_schema" | "json_object";

/**
 * Provider-side privacy routing. `deny` means "do not route this call to any
 * upstream that retains prompts".
 *
 * This is a REQUIREMENT, not a preference, for anything carrying homeowner
 * text — see `handles_customer_data` in callModel.ts. Free and stealth models
 * are generally free BECAUSE prompts may be retained, which is why the model
 * config carries `allows_customer_data` and why it ships false everywhere.
 */
export type DataCollectionPreference = "deny" | "allow";

export interface ModelCallInput {
  /** Vendor-neutral model identifier, resolved from policy — never a literal at a call site. */
  modelId: string;
  /** The rules. Carries the rendered JSON schema in json_object mode. */
  system: string;
  /** The task. Carries the (already redaction-checked) input. */
  user: string;
  /** Schema name reported to the provider in json_schema mode. */
  schemaName: string;
  /**
   * The JSON Schema the reply must satisfy — hand-authored data beside the zod
   * schema that validates the reply, so there is no schema-generation dependency
   * and no drift between "what we asked for" and "what we accept" (a test
   * asserts the two agree on required keys).
   */
  jsonSchema: Record<string, unknown>;
  mode: StructuredOutputMode;
  maxTokens: number;
  timeoutMs: number;
  dataCollection: DataCollectionPreference;
}

/**
 * WHY THESE REASONS AND NOT A STRING. Every one of them maps to a different
 * owner-visible fact and a different fix, and the fallback contract requires
 * each to be individually testable:
 *
 *  no_key        no credential configured — the deployment simply has no model
 *  rate_limited  429, including the free-pool saturation this project has
 *                already recorded in its operations log
 *  timeout       the call exceeded the configured budget
 *  refused       the model returned a refusal / content-filter stop
 *  invalid_json  a reply that is not parseable JSON at all
 *  http_error    any other non-2xx, or a network/transport failure
 *  over_budget   refused BEFORE the network by the spend gate
 *  not_permitted refused BEFORE the network by governance (privacy, kill
 *                switch, disabled flag, unknown model/capability)
 */
export type ModelFailureReason =
  | "no_key"
  | "rate_limited"
  | "timeout"
  | "refused"
  | "invalid_json"
  | "http_error"
  | "over_budget"
  | "not_permitted";

export interface ModelUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  /**
   * Cost as the API itself reported it, when it reports one. NEVER computed from
   * a hardcoded price table for a marketplace whose prices vary per model and
   * move — see the note in models.ts. null means "the API did not say", and the
   * caller then estimates from the registered per-model rate and says so.
   */
  reported_cost_usd: number | null;
}

export type ModelCallResult =
  | {
      ok: true;
      /** The reply text, unparsed and unvalidated. Validation belongs to the caller. */
      raw: string;
      usage: ModelUsage;
      /** Vendor generation id, when the vendor issues one — the join key for a later cost lookup. */
      generationId: string | null;
      /** Which provider actually answered, for the ledger row. */
      provider: string;
      /** HTTP attempts made, including retries the provider handled internally. */
      attempts: number;
    }
  | {
      ok: false;
      reason: ModelFailureReason;
      /** Human-readable, safe to log: never a header, a key, or an echoed prompt. */
      detail: string;
      provider: string;
      attempts: number;
    };

export interface ModelProvider {
  /** Stable provider id for the ledger and the report. */
  readonly id: string;
  /** NEVER throws — every failure is a typed result. */
  complete(input: ModelCallInput): Promise<ModelCallResult>;
}
