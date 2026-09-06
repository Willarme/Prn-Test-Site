import type {
  ModelCallInput,
  ModelCallResult,
  ModelProvider,
  ModelUsage,
} from "@/platform/ai/provider";
import { MAX_MODEL_HTTP_ATTEMPTS } from "@/platform/ai/provider";

/**
 * THE ONE VENDOR-SPECIFIC FILE IN THIS BUILD.
 *
 * Everything OpenRouter knows about PRN, and everything PRN knows about
 * OpenRouter, is in here. Delete this file and write a sibling and the rest of
 * the system does not notice — that is the whole point of provider.ts.
 *
 * PLAIN `fetch`, NO SDK — a deliberate call, not laziness. The surface actually
 * needed is one POST to /chat/completions. Adding the `openai` package to reach
 * an OpenAI-COMPATIBLE endpoint would put a vendor's name in package.json for a
 * vendor this project does not use, drag a dependency tree behind a single HTTP
 * call, and quietly imply an OpenAI dependency to anyone reading the manifest.
 * Node's global fetch is available on this runtime.
 *
 * THE KEY IS READ FROM THE ENVIRONMENT AND NEVER LEAVES THIS FILE. It is not
 * logged, not echoed into a failure detail, not returned in a result, and not
 * written to the ledger. `no_key` is a REASON, never a value. The client-boundary
 * test asserts nothing under platform/ai reaches a browser bundle.
 *
 * ─── THE TWO STRUCTURED-OUTPUT MODES ───────────────────────────────────────
 *
 * mode "json_schema"  →  response_format: { type: "json_schema", json_schema:
 *                        { name, strict: true, schema } }. The API enforces it.
 *
 * mode "json_object"  →  response_format: { type: "json_object" }. The model
 *                        guarantees syntactically valid JSON and NOTHING about
 *                        its shape. The schema travels in the system prompt
 *                        (rendered by the caller) and the caller validates with
 *                        zod, repairs once, then falls back. This is the mode
 *                        `stealth/ox-alpha` needs, verified 2026-08-25: its
 *                        `supported_parameters` carries `response_format` and
 *                        `tools` but NOT `structured_outputs`.
 *
 * Which mode a model takes is CONFIG (models.ts), never a guess here.
 *
 * ─── PRIVACY ROUTING ───────────────────────────────────────────────────────
 *
 * `provider: { data_collection: "deny" }` excludes upstreams that retain
 * prompts. It is sent whenever the caller asks for it, and the caller asks for
 * it on every capability that handles homeowner text. The refusal that matters
 * happens ABOVE this file though — a customer-data capability never reaches a
 * provider whose config says `allows_customer_data: false`, so `deny` is the
 * second belt, not the only one.
 *
 * ─── RELIABILITY ───────────────────────────────────────────────────────────
 *
 * The free ox-alpha pool saturates and returns 429 `upstream_provider_shared_pool`
 * for everyone at once — recorded in this project's own operations log, not a
 * hypothetical. Retries with backoff are therefore mandatory, and a 429 that
 * survives them is a typed `rate_limited` result the caller turns into a
 * deterministic fallback. It must never surface to a customer.
 */

const BASE_URL = "https://openrouter.ai/api/v1";
export const OPENROUTER_PROVIDER_ID = "openrouter";

/** Attempts on a retryable status (429 / 5xx / network). One initial + this many retries. */
const MAX_RETRIES = MAX_MODEL_HTTP_ATTEMPTS - 1;
/** Backoff base in ms; doubled per retry. Kept short — the caller has a timeout budget. */
const BACKOFF_BASE_MS = 400;

/**
 * Attribution headers OpenRouter recommends. They identify the CALLING APP, so
 * they are read from the environment rather than written here: this file is
 * platform code and carries no client's brand, market or product name (A00
 * white-label approval condition 1). Unset means the header is simply omitted.
 */
function attributionHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const referer = process.env.OPENROUTER_APP_URL;
  const title = process.env.OPENROUTER_APP_TITLE;
  if (referer) headers["HTTP-Referer"] = referer;
  if (title) headers["X-Title"] = title;
  return headers;
}

interface ChatCompletionResponse {
  id?: string;
  choices?: Array<{
    message?: { content?: string | null };
    finish_reason?: string | null;
    native_finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    cost?: number;
  };
  error?: { message?: string; code?: number | string };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Truncate anything that came back from the wire before it is put in a detail
 * string. A provider error body is untrusted text: it is DATA describing a
 * failure, never an instruction, and it never needs to be long to be useful.
 */
function safeDetail(text: string, limit = 300): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat;
}

/**
 * THE USER TURN, in the two shapes the chat-completions API accepts.
 *
 * Text-only calls send `content` as a plain string — the exact body every
 * existing test pins. A call carrying images sends the OpenAI-style parts
 * array instead: the text first, then one `image_url` part per image as a data
 * URL. Nothing else in the body changes, and the branch is taken ONLY when at
 * least one image is present, so a text call is byte-identical to before this
 * field existed.
 */
function userContent(input: ModelCallInput): string | Array<Record<string, unknown>> {
  const images = input.images ?? [];
  if (images.length === 0) return input.user;
  return [
    { type: "text", text: input.user },
    ...images.map((image) => ({
      type: "image_url",
      image_url: { url: `data:${image.mime};base64,${image.base64}` },
    })),
  ];
}

export function buildBody(input: ModelCallInput): Record<string, unknown> {
  const response_format =
    input.mode === "json_schema"
      ? {
          type: "json_schema",
          json_schema: {
            name: input.schemaName,
            strict: true,
            schema: input.jsonSchema,
          },
        }
      : { type: "json_object" };

  return {
    model: input.modelId,
    messages: [
      { role: "system", content: input.system },
      { role: "user", content: userContent(input) },
    ],
    response_format,
    max_tokens: input.maxTokens,
    // Schema extraction needs a short answer. Keep reasoning explicit for the
    // owner's DeepSeek model; its default thinking exhausted the 30s intake
    // budget in two live checks. OpenRouter reasoning docs, 2026-09-05.
    ...(input.reasoningEnabled !== undefined ? { reasoning: { enabled: input.reasoningEnabled } } : {}),
    // Deterministic-as-possible: PRN wants a schema-shaped answer, not variety.
    temperature: 0,
    // Ask the API to report usage/cost on the response so the ledger records what
    // the vendor says it charged rather than only what we estimated.
    usage: { include: true },
    provider: { data_collection: input.dataCollection, sort: "latency", require_parameters: true },
  };
}

/**
 * THE TEST-RUN GUARD (campaign routine decision, raised by track F1 and the
 * companion review's R7, 2026-09-05).
 *
 * Once a model is cleared for customer data, every intake the test suite
 * starts would reach this file with a real key from `.env.local` and make a
 * real, billed call — 1,700 tests' worth, on every run, from every track. So
 * under vitest this provider refuses to touch the network unless the run says
 * in so many words that it wants live calls (`PRN_AI_LIVE_TESTS=1`).
 *
 * The refusal is a typed `not_permitted` result, which `callModel` records
 * and every caller turns into its deterministic fallback — the same path a
 * disabled flag takes, so a test that exercises intake sees exactly what a
 * keyless deployment sees.
 *
 * Wire tests inject their fake transport explicitly. A changed global fetch
 * is never evidence of isolation: instrumentation may forward to the network.
 */
export const LIVE_CALLS_DISABLED_DETAIL = "live model calls disabled under vitest";

function liveCallsDisabledUnderTest(): boolean {
  return (
    Boolean(process.env.VITEST) &&
    process.env.PRN_AI_LIVE_TESTS !== "1"
  );
}

export function createOpenRouterProvider(apiKey: string, testTransport?: typeof fetch): ModelProvider {
  return {
    id: OPENROUTER_PROVIDER_ID,

    async complete(input: ModelCallInput): Promise<ModelCallResult> {
      if (liveCallsDisabledUnderTest() && !testTransport) {
        return {
          ok: false,
          reason: "not_permitted",
          detail: `${LIVE_CALLS_DISABLED_DETAIL} (set PRN_AI_LIVE_TESTS=1 for a deliberate live run)`,
          provider: OPENROUTER_PROVIDER_ID,
          attempts: 0,
        };
      }
      const body = JSON.stringify(buildBody(input));
      const maxRetries = input.maxAttempts === undefined ? MAX_RETRIES : Math.max(0, Math.min(MAX_RETRIES, Math.floor(input.maxAttempts) - 1));
      if (!Number.isFinite(maxRetries) || (input.maxAttempts !== undefined && (!Number.isInteger(input.maxAttempts) || input.maxAttempts < 1))) {
        return { ok: false, reason: "not_permitted", detail: "invalid HTTP attempt ceiling", provider: OPENROUTER_PROVIDER_ID, attempts: 0 };
      }
      let attempts = 0;
      let lastRetryable = { reason: "http_error" as const, detail: "no attempt completed" };

      for (let tryIndex = 0; tryIndex <= maxRetries; tryIndex += 1) {
        attempts += 1;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), input.timeoutMs);
        try {
          const response = await (testTransport ?? fetch)(`${BASE_URL}/chat/completions`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
              ...attributionHeaders(),
            },
            body,
            signal: controller.signal,
          });

          if (response.status === 429) {
            const text = await response.text().catch(() => "");
            lastRetryable = {
              reason: "http_error",
              detail: `429 rate limited: ${safeDetail(text)}`,
            };
            if (tryIndex < maxRetries) {
              await sleep(BACKOFF_BASE_MS * 2 ** tryIndex);
              continue;
            }
            return {
              ok: false,
              reason: "rate_limited",
              detail: `429 after ${attempts} attempt(s): ${safeDetail(text)}`,
              provider: OPENROUTER_PROVIDER_ID,
              attempts,
            };
          }

          if (response.status >= 500) {
            const text = await response.text().catch(() => "");
            lastRetryable = {
              reason: "http_error",
              detail: `${response.status}: ${safeDetail(text)}`,
            };
            if (tryIndex < maxRetries) {
              await sleep(BACKOFF_BASE_MS * 2 ** tryIndex);
              continue;
            }
            return {
              ok: false,
              reason: "http_error",
              detail: `upstream ${response.status} after ${attempts} attempt(s): ${safeDetail(text)}`,
              provider: OPENROUTER_PROVIDER_ID,
              attempts,
            };
          }

          if (!response.ok) {
            // 4xx other than 429: not retryable. A 401/403 is a credential
            // problem, and the DETAIL says so without carrying the credential.
            const text = await response.text().catch(() => "");
            return {
              ok: false,
              reason: response.status === 401 || response.status === 403 ? "no_key" : "http_error",
              detail: `HTTP ${response.status}: ${safeDetail(text)}`,
              provider: OPENROUTER_PROVIDER_ID,
              attempts,
            };
          }

          const payload = (await response.json()) as ChatCompletionResponse;
          if (payload.error) {
            return {
              ok: false,
              reason: "http_error",
              detail: `provider error: ${safeDetail(String(payload.error.message ?? payload.error.code ?? "unknown"))}`,
              provider: OPENROUTER_PROVIDER_ID,
              attempts,
            };
          }

          const choice = payload.choices?.[0];
          const finish = choice?.finish_reason ?? choice?.native_finish_reason ?? null;
          if (finish === "content_filter") {
            return {
              ok: false,
              reason: "refused",
              detail: "the model stopped on a content filter — no usable reply",
              provider: OPENROUTER_PROVIDER_ID,
              attempts,
            };
          }

          const raw = choice?.message?.content;
          if (typeof raw !== "string" || raw.trim().length === 0) {
            /**
             * A `length` finish with no content is a TRUNCATION, and the fix is a
             * number rather than a retry: the model spent its whole output budget
             * before emitting the object. Measured on stealth/ox-alpha during the
             * live smoke — 100 output tokens produced no content at all — so the
             * detail names the cause instead of leaving an owner to guess at
             * "invalid JSON" for a reply that was never JSON in the first place.
             */
            const truncated = finish === "length";
            return {
              ok: false,
              reason: "invalid_json",
              detail: truncated
                ? "the model hit its output ceiling before emitting any content (finish_reason=length) — raise max_output_tokens for this capability in the AI policy"
                : `the reply carried no content (finish_reason=${String(finish)})`,
              provider: OPENROUTER_PROVIDER_ID,
              attempts,
            };
          }

          const usage: ModelUsage = {
            prompt_tokens: tokenCounter(payload.usage?.prompt_tokens),
            completion_tokens: tokenCounter(payload.usage?.completion_tokens),
            total_tokens: tokenCounter(payload.usage?.total_tokens),
            reported_cost_usd:
              typeof payload.usage?.cost === "number" ? payload.usage.cost : null,
          };

          return {
            ok: true,
            raw,
            usage,
            generationId: typeof payload.id === "string" ? payload.id : null,
            provider: OPENROUTER_PROVIDER_ID,
            attempts,
          };
        } catch (err) {
          const aborted = err instanceof Error && err.name === "AbortError";
          if (aborted) {
            // A timeout is the caller's budget expiring, not a transient blip —
            // retrying would spend the budget again on the same wait.
            return {
              ok: false,
              reason: "timeout",
              detail: `no reply within ${input.timeoutMs}ms`,
              provider: OPENROUTER_PROVIDER_ID,
              attempts,
            };
          }
          lastRetryable = {
            reason: "http_error",
            detail: `network: ${safeDetail(err instanceof Error ? err.message : String(err))}`,
          };
          if (tryIndex < maxRetries) {
            await sleep(BACKOFF_BASE_MS * 2 ** tryIndex);
            continue;
          }
        } finally {
          clearTimeout(timer);
        }
      }

      return {
        ok: false,
        reason: lastRetryable.reason,
        detail: `${lastRetryable.detail} (after ${attempts} attempt(s))`,
        provider: OPENROUTER_PROVIDER_ID,
        attempts,
      };
    },
  };
}

function tokenCounter(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/**
 * A generation's exact billed cost, read back from the vendor AFTER the call.
 *
 * WHY THIS EXISTS SEPARATELY. The chat response reports usage; the authoritative
 * cost for one call is GET /api/v1/generation?id=<id>. Nothing in the request
 * path awaits it — a customer must never wait on an accounting lookup — so this
 * is a reconciliation helper for the smoke script and any later cost audit.
 * NEVER THROWS: an unavailable figure is null, not an exception.
 */
export async function fetchGenerationCost(
  apiKey: string,
  generationId: string,
  timeoutMs = 10_000
): Promise<number | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(
      `${BASE_URL}/generation?id=${encodeURIComponent(generationId)}`,
      {
        headers: { Authorization: `Bearer ${apiKey}`, ...attributionHeaders() },
        signal: controller.signal,
      }
    );
    if (!response.ok) return null;
    const payload = (await response.json()) as { data?: { total_cost?: number } };
    const cost = payload.data?.total_cost;
    return typeof cost === "number" ? cost : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
