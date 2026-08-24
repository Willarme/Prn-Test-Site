import { z } from "zod";
import { IsoDateTime } from "@/domain/shared/primitives";
import {
  serviceClientProvider,
  type PlatformClientProvider,
} from "@/platform/db/client";
import { emitPlatformEvent } from "@/platform/events/emit";

/**
 * A00 Kill Switch (spec §4, §9 step 8) — a human can pause one agent or
 * everything, without taking the website down.
 *
 * SCOPES BUILT: GLOBAL and AGENT only (approved recommendation, 2026-08-24).
 * "CAPABILITY" and "PAGE_CLASS" are in the contract type but have no
 * engage/release path yet — added when a real use case needs them.
 * "TENANT" is a RESERVED FUTURE value (white-label approval condition b,
 * 2026-08-24): per-client deployments may later need a per-tenant halt in a
 * central fleet view. It is documented here only — NOT implemented, NOT in
 * the type union yet, no logic anywhere.
 *
 * CACHING STRATEGY (build-time choice the spec §10 delegates to this build):
 * the source of truth is the `kill_switch` table (migration 00008 — written,
 * NOT applied). The synchronous gate reads an in-process cache — never a
 * network round trip per call (spec §2) — which is:
 *   - updated IMMEDIATELY on every same-process toggle (write-through), so
 *     the engage→next-call-blocked KPI is effectively zero in-process;
 *   - refreshed lazily from the database when stale (30s TTL), fire-and-
 *     forget and FAIL-SOFT, so cross-process toggles propagate within one
 *     TTL once the table exists — and a missing table changes nothing.
 * Every toggle also emits a platform.kill_switch_* envelope (provisional
 * name, pending A08) so the HISTORY of toggles stays append-only even though
 * the current state is a mutable flag.
 */
export const KillSwitchScope = z.enum(["GLOBAL", "AGENT", "CAPABILITY", "PAGE_CLASS"]);
export type KillSwitchScope = z.infer<typeof KillSwitchScope>;

export const KillSwitchState = z.object({
  /** See the header note: GLOBAL + AGENT operative; "TENANT" reserved future value (condition b). */
  scope: KillSwitchScope,
  /** Reserved — white-label approval condition (a), 2026-08-24. Default "prn"; NO tenant logic. */
  tenant_id: z.string().min(1).optional(),
  /** agent_id when scope is AGENT; capability/page-class ref for future scopes. */
  scope_ref: z.string().optional(),
  engaged: z.boolean(),
  engaged_by: z.string().optional(),
  engaged_at: IsoDateTime.optional(),
  reason: z.string().optional(),
});
export type KillSwitchState = z.infer<typeof KillSwitchState>;

export interface KillSwitchCheck {
  engaged: boolean;
  scope: "GLOBAL" | "AGENT" | null;
  reason?: string;
}

const GLOBAL_KEY = "global";
function agentKey(agentId: string): string {
  return `agent:${agentId}`;
}

/** In-process cache — the synchronous gate. Keyed by switch key. */
const cache = new Map<string, KillSwitchState>();
const TTL_MS = 30_000;
let lastRefresh = 0;
let refreshing = false;
let missLogged = false;

function logMiss(reason: string): void {
  if (missLogged) return;
  missLogged = true;
  console.warn(
    `[a00-killswitch] durable state unavailable (${reason}) — switches are in-process only. ` +
      "Apply supabase/migrations/00008_kill_switch.sql to enable cross-process propagation."
  );
}

function now(): string {
  return new Date().toISOString().replace(/\.\d+Z$/, "Z");
}

/** Lazy, non-blocking cache refresh from the durable store. Fail-soft. */
function maybeRefresh(clientProvider: PlatformClientProvider): void {
  if (refreshing || Date.now() - lastRefresh < TTL_MS) return;
  refreshing = true;
  void (async () => {
    try {
      const client = clientProvider();
      if (!client) return; // no database configured — in-process cache is authoritative
      const { data, error } = await client.from("kill_switch").select("*");
      if (error) {
        logMiss(error.message);
        return;
      }
      for (const row of data ?? []) {
        const clean = Object.fromEntries(
          Object.entries(row as Record<string, unknown>).filter(
            ([k, v]) => v !== null && k !== "switch_key" && k !== "updated_at"
          )
        );
        const parsed = KillSwitchState.safeParse(clean);
        if (parsed.success) {
          cache.set((row as { switch_key: string }).switch_key, parsed.data);
        }
      }
      lastRefresh = Date.now();
    } catch (err) {
      logMiss(err instanceof Error ? err.message : String(err));
    } finally {
      refreshing = false;
    }
  })();
}

/**
 * The SYNCHRONOUS gate the gateway calls before every capability call
 * (spec §7: the check happens BEFORE any capability work — a call that
 * starts before the check completes is a bug). GLOBAL wins over everything.
 */
export function checkKillSwitch(
  agentId: string,
  clientProvider: PlatformClientProvider = serviceClientProvider
): KillSwitchCheck {
  maybeRefresh(clientProvider);
  const globalState = cache.get(GLOBAL_KEY);
  if (globalState?.engaged) {
    return { engaged: true, scope: "GLOBAL", reason: globalState.reason };
  }
  const agentState = cache.get(agentKey(agentId));
  if (agentState?.engaged) {
    return { engaged: true, scope: "AGENT", reason: agentState.reason };
  }
  return { engaged: false, scope: null };
}

async function persist(
  key: string,
  state: KillSwitchState,
  clientProvider: PlatformClientProvider
): Promise<void> {
  try {
    const client = clientProvider();
    if (!client) {
      logMiss("no database configured");
      return;
    }
    const { error } = await client.from("kill_switch").upsert({
      switch_key: key,
      scope: state.scope,
      tenant_id: state.tenant_id ?? "prn",
      scope_ref: state.scope_ref ?? null,
      engaged: state.engaged,
      engaged_by: state.engaged_by ?? null,
      engaged_at: state.engaged_at ?? null,
      reason: state.reason ?? null,
      updated_at: now(),
    });
    if (error) logMiss(error.message);
  } catch (err) {
    logMiss(err instanceof Error ? err.message : String(err));
  }
}

export interface ToggleInput {
  /** Only the two operative scopes can be toggled in Wave 0. */
  scope: "GLOBAL" | "AGENT";
  /** Required when scope is AGENT. */
  scope_ref?: string;
  by: string;
  reason?: string;
}

/** Engage a switch. Same-process effect is immediate; toggle emits an audit envelope. */
export async function engageKillSwitch(
  input: ToggleInput,
  clientProvider: PlatformClientProvider = serviceClientProvider
): Promise<KillSwitchState> {
  const key = input.scope === "GLOBAL" ? GLOBAL_KEY : agentKey(input.scope_ref ?? "");
  const state: KillSwitchState = KillSwitchState.parse({
    scope: input.scope,
    tenant_id: "prn",
    scope_ref: input.scope === "AGENT" ? input.scope_ref : undefined,
    engaged: true,
    engaged_by: input.by,
    engaged_at: now(),
    reason: input.reason,
  });
  cache.set(key, state);
  await persist(key, state, clientProvider);
  await emitPlatformEvent({
    event_name: "platform.kill_switch_engaged", // provisional, pending A08 (names.ts)
    context: {
      scope: input.scope,
      ...(input.scope_ref ? { scope_ref: input.scope_ref } : {}),
    },
  });
  return state;
}

/** Release a switch. Also audited — history stays append-only. */
export async function releaseKillSwitch(
  input: ToggleInput,
  clientProvider: PlatformClientProvider = serviceClientProvider
): Promise<KillSwitchState> {
  const key = input.scope === "GLOBAL" ? GLOBAL_KEY : agentKey(input.scope_ref ?? "");
  const state: KillSwitchState = KillSwitchState.parse({
    scope: input.scope,
    tenant_id: "prn",
    scope_ref: input.scope === "AGENT" ? input.scope_ref : undefined,
    engaged: false,
    engaged_by: input.by,
    engaged_at: now(),
    reason: input.reason,
  });
  cache.set(key, state);
  await persist(key, state, clientProvider);
  await emitPlatformEvent({
    event_name: "platform.kill_switch_released", // provisional, pending A08 (names.ts)
    context: {
      scope: input.scope,
      ...(input.scope_ref ? { scope_ref: input.scope_ref } : {}),
    },
  });
  return state;
}

/** Current switch states (admin-gated readers only). */
export function listKillSwitches(): ReadonlyMap<string, KillSwitchState> {
  return cache;
}

/** Test seam. */
export function resetKillSwitchForTests(): void {
  cache.clear();
  lastRefresh = 0;
  refreshing = false;
  missLogged = false;
}
