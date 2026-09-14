import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { POST as keepPost } from "@/app/api/keep/route";
import { signLink } from "@/platform/links/tokens";
import { readDevDb } from "@/platform/stores/dev-db";
import { resetRuntimeStore, runtimeStore } from "@/platform/stores/runtime";
import { DEFAULT_TENANT_ID } from "@/domain/problem/contracts";
import { invalidateFeatureStates } from "@/platform/features/state";
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "prn-link-boundary-"));
  vi.stubEnv("PRN_RUNTIME_STORE", "file"); vi.stubEnv("PRN_DEV_DB_PATH", join(dir, "db.json"));
  vi.stubEnv("LINK_SIGNING_SECRET", "synthetic-link-secret"); vi.stubEnv("EMAIL_MODE", "preview");
  vi.stubGlobal("fetch", () => { throw new Error("External network forbidden"); }); resetRuntimeStore(); invalidateFeatureStates();
});
afterEach(() => { resetRuntimeStore(); invalidateFeatureStates(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); rmSync(dir, { recursive: true, force: true }); });
it("actual Keep POST does not queue a message when its durable receipt cannot be recorded", async () => {
  // This is the saved LIVE flow's ledger-failure test, not the default HIDDEN
  // route test. Enable only Keep in this isolated fixture to reach that seam.
  await runtimeStore().setFeatureStates({ tenant_id: DEFAULT_TENANT_ID,
    changes: [{ feature_id: "keep", state: "LIVE", expected_version: 0 }],
    actor: "system:test-fixture", reason: "Exercise durable Keep receipt failure", decision_ref: "fixture-only",
    at: "2026-09-13T12:00:00.000Z" });
  const token = signLink({ scope: "keep", request_id: "rq_keep_fault" });
  writeFileSync(join(dir, "links"), "synthetic blocked storage");
  const response = await keepPost(new Request("http://localhost/api/keep", { method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ token, contact: "fixture@example.invalid" }) }));
  expect(response.status).toBe(503); expect(await response.json()).toEqual({ error: "unavailable" });
  expect(readDevDb().email_outbox).toHaveLength(0);
  expect(readDevDb().magic_links.every(row => row.consumed_at === null)).toBe(true);
});
