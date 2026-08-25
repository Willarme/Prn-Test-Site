import { createOpenRouterProvider } from "@/platform/ai/providers/openrouter";
import type { ModelProvider } from "@/platform/ai/provider";

/**
 * MODEL PROVIDER SEAM — the same shape as platform/db/client.ts, on purpose.
 *
 * A00's database layer is built as `PlatformClientProvider = () => Client | null`
 * so every module ACCEPTS a provider instead of importing a concrete one. That
 * pattern is what makes the database swappable, testable and absent-able; the
 * model layer needs all three properties for the same reasons, so it gets the
 * same shape rather than a second invention.
 *
 * `null` IS A FIRST-CLASS ANSWER, not an error. No key configured means this
 * deployment has no model — which is the state every deployment is in by default
 * and the state the whole fallback contract is written around. Nothing logs an
 * alarm, nothing throws, and every capability returns its deterministic result.
 *
 * THE KEY IS READ HERE AND NOWHERE ELSE outside providers/openrouter.ts. It is
 * never hardcoded, never logged, never returned, never written to the ledger.
 */
export type AiProviderFactory = () => ModelProvider | null;

/** True when this deployment has a model credential at all. */
export function aiProviderConfigured(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY);
}

let cached: ModelProvider | null = null;
let cachedForKey: string | null = null;

/**
 * The default factory: an OpenRouter provider when a key is set, otherwise null.
 *
 * SWAPPING VENDORS IS THIS FUNCTION. Add `providers/<vendor>.ts`, choose here on
 * whatever configuration signal the owners pick, and every call site above is
 * unchanged — they are all written against `ModelProvider`.
 */
export const defaultAiProvider: AiProviderFactory = () => {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return null;
  if (!cached || cachedForKey !== key) {
    cached = createOpenRouterProvider(key);
    cachedForKey = key;
  }
  return cached;
};

/** Test seam: forces re-selection of the provider. */
export function resetAiProviderForTests(): void {
  cached = null;
  cachedForKey = null;
}
