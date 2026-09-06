import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, vi } from "vitest";

/** Existing adapter unit tests now supply the same explicit identity and local
 * durability mode required of production callers. Each test has a fresh disk;
 * this never turns a real runtime's existing request into a fresh allowance. */
export function useLocalRequestBudgetFixtures(): void {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "model-adapter-request-fixture-"));
    vi.stubEnv("PRN_RUNTIME_STORE", "file");
    vi.stubEnv("PRN_DEV_DB_PATH", join(root, "db.json"));
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  });
}

export function modelRequest(): { request_id: string; tenant_id: string } {
  return { request_id: `rq_fixture_${randomUUID()}`, tenant_id: "prn" };
}
