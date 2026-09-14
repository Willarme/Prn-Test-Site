import { DEFAULT_TENANT_ID } from "@/domain/problem/contracts";
import { runtimeStore } from "@/platform/stores/runtime";
import { FEATURES } from "./registry";
import { readFeatureSnapshot, stateIn } from "./state";

export async function featureAdminView() {
  const [snapshot, counts] = await Promise.all([
    readFeatureSnapshot({ fresh: true }),
    Promise.resolve().then(() => runtimeStore().listFeatureInterestCounts(DEFAULT_TENANT_ID)).then(value => ({ available: true, value })).catch(() => ({ available: false, value: [] })),
  ]);
  return {
    verified: snapshot.verified, interest_available: counts.available, observed_at: new Date().toISOString(),
    features: FEATURES.map(definition => {
      const row = snapshot.rows.get(definition.id);
      return { ...definition, state: stateIn(snapshot, definition.id), version: row?.version ?? 0,
        actor: row?.actor ?? null, reason: row?.reason ?? null, decision_ref: row?.decision_ref ?? null,
        updated_at: row?.updated_at ?? null, recorded: Boolean(row),
        interest: counts.available ? counts.value.find(item => item.feature_id === definition.id) ?? { feature_id: definition.id, yes: 0, no: 0, maybe: 0, total: 0 } : null };
    }),
  };
}
export type FeatureAdminView = Awaited<ReturnType<typeof featureAdminView>>;
