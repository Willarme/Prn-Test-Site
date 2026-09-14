/** Storage contracts; the registry owns defaults and public visibility policy. */
export type FeatureState = "LIVE" | "PREVIEW" | "HIDDEN";
export interface FeatureStateRow {
  tenant_id: string;
  feature_id: string;
  state: FeatureState;
  version: number;
  actor: string;
  reason: string;
  decision_ref: string;
  updated_at: string;
}
export interface FeatureStateChange {
  feature_id: string;
  state: FeatureState;
  expected_version: number;
}
export interface SetFeatureStatesInput {
  tenant_id: string;
  changes: FeatureStateChange[];
  actor: string;
  reason: string;
  decision_ref: string;
  at: string;
}
export type FeatureInterestAnswer = "yes" | "no" | "maybe";
export interface FeatureInterestInput {
  tenant_id: string;
  feature_id: string;
  feature_version: number;
  page: string;
  answer: FeatureInterestAnswer;
  visitor_hash: string;
  dedupe_key: string;
  created_at: string;
}
export interface FeatureInterestCount {
  feature_id: string;
  yes: number;
  no: number;
  maybe: number;
  total: number;
}
