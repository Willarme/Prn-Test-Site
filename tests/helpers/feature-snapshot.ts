import { FEATURES, FEATURE_DECISION_REF } from "@/platform/features/registry";
import type { FeatureSnapshot } from "@/platform/features/state";
import type { FeatureState } from "@/domain/features/types";

/** Explicit synthetic state, for tests of preserved LIVE behavior and state cuts. */
export function featureSnapshot(overrides: Record<string, FeatureState> = {}, defaultState?: FeatureState): FeatureSnapshot {
  return {
    tenant_id: "prn", observed_at: 0, verified: true,
    rows: new Map(FEATURES.map(feature => [feature.id, {
      tenant_id: "prn", feature_id: feature.id,
      state: overrides[feature.id] ?? defaultState ?? feature.launch_state,
      version: 1, actor: "test", reason: "Explicit synthetic feature fixture",
      decision_ref: FEATURE_DECISION_REF, updated_at: "2026-09-13T00:00:00Z",
    }])),
  };
}
