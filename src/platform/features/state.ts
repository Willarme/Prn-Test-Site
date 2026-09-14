import { DEFAULT_TENANT_ID } from "@/domain/problem/contracts";
import type { FeatureState, FeatureStateRow, FeatureStateChange } from "@/domain/features/types";
import { runtimeStore, type RuntimeStore } from "@/platform/stores/runtime";
import { FEATURES, FEATURE_DECISION_REF, featureDefinition, requiredFeaturesForPath } from "./registry";

export const FEATURE_CACHE_MS = 30_000;
export type FeatureSnapshot = { tenant_id: string; observed_at: number; verified: boolean; rows: ReadonlyMap<string, FeatureStateRow> };
let cache = new WeakMap<RuntimeStore, Map<string, FeatureSnapshot>>();

export function invalidateFeatureStates(): void { cache = new WeakMap(); }
export async function readFeatureSnapshot(options: { tenantId?: string; store?: RuntimeStore; fresh?: boolean; now?: number } = {}): Promise<FeatureSnapshot> {
  const tenant_id = options.tenantId ?? DEFAULT_TENANT_ID;
  const now = options.now ?? Date.now();
  const started = Date.now();
  const generation = cache;
  const unavailable = (): FeatureSnapshot => ({ tenant_id, observed_at: now, verified: false, rows: new Map() });
  let store: RuntimeStore;
  try { store = options.store ?? runtimeStore(); }
  catch { return unavailable(); }
  const saved = cache.get(store)?.get(tenant_id);
  if (!options.fresh && saved && now >= saved.observed_at && now - saved.observed_at < FEATURE_CACHE_MS) return saved;
  try {
    const records = await store.listFeatureStates(tenant_id);
    // An in-flight pre-change read must never refill a cache invalidated by a
    // confirmed write. Slow reads also cannot issue an already-expired grant.
    const elapsed = Date.now() - started;
    if (cache !== generation || elapsed < 0 || elapsed >= FEATURE_CACHE_MS) return unavailable();
    const newer = generation.get(store)?.get(tenant_id);
    if (newer && newer.observed_at > now) return newer;
    const rows = new Map(records.filter(row => row.tenant_id === tenant_id && featureDefinition(row.feature_id)).map(row => [row.feature_id, row]));
    const snapshot = { tenant_id, observed_at: now, verified: true, rows };
    const tenants = cache.get(store) ?? new Map();
    tenants.set(tenant_id, snapshot);
    cache.set(store, tenants);
    return snapshot;
  } catch {
    // Never reuse an expired LIVE snapshot when persistence is unavailable.
    if (cache === generation && (cache.get(store)?.get(tenant_id)?.observed_at ?? 0) <= now) cache.get(store)?.delete(tenant_id);
    return unavailable();
  }
}
export function stateIn(snapshot: FeatureSnapshot, featureId: string): FeatureState {
  const definition = featureDefinition(featureId);
  const state = snapshot.verified && definition ? snapshot.rows.get(featureId)?.state : undefined;
  if (!state || (state === "PREVIEW" && !definition?.marketing_path)) return "HIDDEN";
  return state;
}
export async function featureState(featureId: string): Promise<FeatureState> { return stateIn(await readFeatureSnapshot(), featureId); }
export function featureIsLive(snapshot: FeatureSnapshot, id: string): boolean { return stateIn(snapshot, id) === "LIVE"; }
export function featureHref(snapshot: FeatureSnapshot, href: string): string | null {
  if (!href.startsWith("/") || href.startsWith("//")) return href;
  const ids = requiredFeaturesForPath(href);
  for (const id of ids) {
    const state = stateIn(snapshot, id);
    if (state === "HIDDEN") return null;
    if (state === "PREVIEW") return featureDefinition(id)?.marketing_path ?? null;
  }
  return href;
}
export async function featureRouteRefusal(path: string, options: { api?: boolean; store?: RuntimeStore } = {}): Promise<Response | null> {
  const ids = requiredFeaturesForPath(path);
  if (!ids.length) return null;
  let normalizedPath: string;
  try { normalizedPath = decodeURIComponent(path.split("?")[0]!).replace(/\/+$/, "") || "/"; }
  catch { normalizedPath = ""; }
  const snapshot = await readFeatureSnapshot({ store: options.store });
  const allowed = ids.every(id => {
    const state = stateIn(snapshot, id);
    return state === "LIVE" || (!options.api && state === "PREVIEW" && featureDefinition(id)?.marketing_path === normalizedPath);
  });
  if (allowed) return null;
  return new Response("not found", { status: 404, headers: { "Cache-Control": "private, no-store" } });
}

export type FeaturePreset = "launch" | "show_all" | "preview_only" | "hide_all";
export function presetChanges(snapshot: FeatureSnapshot, preset: FeaturePreset): FeatureStateChange[] {
  return FEATURES.filter(feature => feature.launch_word !== "TO BUILD" && feature.launch_word !== "YOURS").map(feature => ({
    feature_id: feature.id, expected_version: snapshot.rows.get(feature.id)?.version ?? 0,
    state: feature.group === "Retired" || feature.live_eligible === false ? "HIDDEN" : preset === "show_all" ? "LIVE" : preset === "hide_all" ? "HIDDEN" : preset === "preview_only" ? feature.marketing_path ? "PREVIEW" : "HIDDEN" : feature.launch_state,
  }));
}
export async function saveFeatureChanges(changes: FeatureStateChange[], reason: string, options: { store?: RuntimeStore; tenantId?: string } = {}): Promise<FeatureStateRow[]> {
  for (const change of changes) {
    const definition = featureDefinition(change.feature_id);
    if (!definition || (change.state === "PREVIEW" && !definition.marketing_path) ||
        (definition.live_eligible === false && change.state !== "HIDDEN") ||
        definition.launch_word === "TO BUILD" || definition.launch_word === "YOURS" ||
        (definition.group === "Retired" && change.state !== "HIDDEN")) throw new Error("Invalid feature state change");
  }
  const rows = await (options.store ?? runtimeStore()).setFeatureStates({
    tenant_id: options.tenantId ?? DEFAULT_TENANT_ID, changes, reason,
    actor: "authenticated-owner", decision_ref: FEATURE_DECISION_REF, at: new Date().toISOString(),
  });
  invalidateFeatureStates();
  return rows;
}
