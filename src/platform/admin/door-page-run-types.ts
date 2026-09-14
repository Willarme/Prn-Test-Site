/** Owner response DTOs. No input context, raw model content or storage paths. */
export type DoorRunFixture = { fixture_id: string; label: string };
export type DoorRunFixtureCatalog = { fixtures: DoorRunFixture[]; package_sha256: string; executor_version: string };
export type DoorRunCreateRequest = { mode: "fixture" | "live"; dry_run: boolean; opportunity_ids: string[]; count: number; reason: string };
export type DoorRunItemView = {
  item_id: string; fixture_id: string; page_id: string;
  status: "PENDING" | "RUNNING" | "BUILT" | "BLOCKED" | "FAILED";
  attempts: number; diagnostics: { code: string; pointer: string }[];
  preview_href: string | null; version_href: string | null;
  input_sha256: string | null; artifact_hash: string | null;
  model_calls: number; cost_usd: number;
};
export type DoorRunView = {
  run_id: string; revision: number; mode: "fixture"; dry_run: boolean;
  status: "PENDING" | "RUNNING" | "COMPLETE";
  created_at: string; updated_at: string; resumable: boolean; retry_after: string | null;
  package_sha256: string; executor_version: string;
  items: DoorRunItemView[]; terminal_count: number; model_calls: number; cost_usd: number;
  release_ready: false;
};
