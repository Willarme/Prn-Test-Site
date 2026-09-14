/** Deliberately small owner read models. Compiler context and asset bytes never cross this boundary. */
export interface DoorCreatorIdentity {
  page_id: string; canonical_intent_id: string; canonical_path: string; latest_version: number;
}
export interface DoorCreatorOverview {
  status: "ready" | "unavailable"; pages: DoorCreatorIdentity[];
}
export interface DoorCreatorVersionSummary {
  page_version: number; registered_at: string; artifact_hash: string; mode: "fixture" | "live";
}
export interface DoorCreatorEvidenceSummary {
  kind: string; verdict: string; receipt_sha256: string; finished_at: string; expires_at: string;
  time_status: "current" | "expired" | "future"; trust_scope: string;
  producer_id: string; run_id: string; findings: Array<{ code: string; pointer: string; severity: string }>;
  model_id: string | null; cost_usd: string | null;
}
export interface DoorCreatorDetail {
  status: "ready" | "not_found" | "unavailable";
  page: DoorCreatorIdentity | null; versions: DoorCreatorVersionSummary[];
  selected: (DoorCreatorVersionSummary & {
    receipt_sha256: string; reservation_id: string; provenance_status: string;
    preview_href: string | null; pending_checks: string[]; source_ids: string[]; claim_ids: string[];
  }) | null;
  input: {
    status: "saved" | "missing" | "unavailable"; input_sha256: string | null;
    assignments: Array<{ label: string; value: string }>;
    models: Array<{ capability: string; provider: string; model_id: string; run_id: string }>;
    model_status: "recorded" | "not_recorded" | "fixture_no_model_calls" | "unavailable";
  };
  evidence: { status: "ready" | "unavailable"; rows: DoorCreatorEvidenceSummary[] };
  serving: { status: "ready" | "unavailable"; guard_status: "current" | "stale" | "unconfigured" | null; page_version: number | null; as_of: string | null };
}
export interface DoorTemplateKitView {
  baseline: string; template_version: string; schema_version: string; order_profile: string;
  order: string[]; constants: Array<{ key: string; value: string }>;
  mutability: Array<{ class: string; count: number; description: string }>;
  documents: Array<{ id: string; label: string; href: string; sha256: string }>;
  theme_slots: Array<{ id: string; status: "not_registered" }>;
}
