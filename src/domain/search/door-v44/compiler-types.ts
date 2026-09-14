import type { DoorV44Diagnostic, DoorV44ValidationContext } from "./types";
import type { DoorV44Document } from "./render-types";

/** Reviewed records supplied by orchestration. None of this is writer-controlled. */
export interface DoorV44SourceRecord {
  source_id: string; content_hash: string; title: string; publisher: string;
  url: string; canonical_url: string; http_status: 200; redirect_to: null;
  checked_at: string; expires_at: string;
}
export interface DoorV44FactRecord {
  claim_id: string; content_hash: string; permitted_labels: string[];
  publisher: string; geography: string; window: string;
  denominator: string; sample_size: string; observed_at: string; methodology_id: string;
}
export interface DoorV44AssetRecord {
  asset_id: string; inline_source: string; raster_base64: string;
  license_receipt: string; renderer_identity: string;
}
export interface DoorV44VisibleComponent { component_id: string; content_hash: string }
export interface DoorV44VisibleApproval extends DoorV44VisibleComponent { approved_at: string }
export interface DoorV44CompilerContext {
  validation: DoorV44ValidationContext;
  site: { name: string; current_year: number };
  disclosure_text: string;
  /** Actual text bytes are pinned separately because the existing disclosure id uses a short hash. */
  disclosure_text_sha256: string;
  source_records: DoorV44SourceRecord[];
  fact_records: DoorV44FactRecord[];
  asset_records: DoorV44AssetRecord[];
  visible_approvals: DoorV44VisibleApproval[];
  /** A semantic reviewer must bind its result to these exact intent fields, not just a page id. */
  intent_review: { receipt_id: string; content_hash: string };
}
export interface DoorV44CompiledAsset {
  asset_id: string; path: string; url: string; sha256: string;
  mime: "image/png" | "image/webp"; width: number; height: number; base64: string;
}
export interface DoorV44CompileReceipt {
  receipt_id: string; compiler_version: "door-v44-compiler/1.0.0";
  content_baseline_id: "ac-v43"; tenant_id: string; page_id: string; page_version: number; canonical_intent_id: string;
  input_hashes: Record<string, string>; html_hash: string; semantic_hash: string;
  artifact_hash: string; canonical_url: string; robots: string;
  date_modified: string | null; visible_components: DoorV44VisibleComponent[];
  source_ids: string[]; claim_ids: string[]; section_order: string[];
  derived_counts: Record<string, number>; rendered_capability_ids: string[];
  constants: Array<{ key: string; value: string }>;
  mode: "fixture" | "live";
  /** Compilation cannot supply the independent critic, visual, hosted or lifecycle QA. */
  release_ready: false; pending_checks: string[];
  wording_findings: Array<{ code: string; pointer: string; severity: "blocker" | "review" }>;
}
export type DoorV44CompileResult = {
  ok: true; html: string; document: DoorV44Document; assets: DoorV44CompiledAsset[]; receipt: DoorV44CompileReceipt;
} | { ok: false; errors: DoorV44Diagnostic[] };
