import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const captured = vi.hoisted(() => [] as Array<{ capability: string; request_id?: string | null; tenant_id?: string }>);
vi.mock("@/platform/ai/callModel", () => ({
  callModel: vi.fn(async (input: { capability: string; request_id?: string; tenant_id?: string }) => {
    captured.push(input);
    return { ok: false, reason: "over_budget", detail: "synthetic ceiling refusal", run_id: null };
  }),
}));

import { POST } from "@/app/api/intake/route";
import { ACTIVE_DISCLOSURE } from "@/domain/privacy/disclosures";
import { DEFAULT_TENANT_ID } from "@/domain/problem/contracts";
import { resetRuntimeStore } from "@/platform/stores/runtime";
import { __setLabelReaderForTests, attachMedia } from "@/platform/intake/media";
import { readEquipmentLabel } from "@/platform/problem/ai-label";
import { resetKillSwitchForTests } from "@/platform/killswitch";
import { resetAgentRunLedgerForTests } from "@/platform/runs/ledger";

let root: string;
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "request-call-threading-test-"));
  vi.stubEnv("PRN_RUNTIME_STORE", "file");
  vi.stubEnv("PRN_DEV_DB_PATH", join(root, "db.json"));
  resetRuntimeStore(); resetKillSwitchForTests(); resetAgentRunLedgerForTests();
});
beforeEach(() => { captured.length = 0; });
afterAll(() => {
  __setLabelReaderForTests(undefined); resetRuntimeStore();
  vi.unstubAllEnvs(); rmSync(root, { recursive: true, force: true });
});

async function start() {
  const response = await POST(new Request("http://localhost/api/intake", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({
      description: "The air conditioner stopped cooling and the kitchen faucet leaks",
      disclosure_content_hash: ACTIVE_DISCLOSURE.content_hash,
      request_id: "rq_forged_client_budget", tenant_id: "tenant_forged_client_budget",
      attribution: { page_id: null, intent_cluster_id: null, search_opportunity_id: null,
        problem_family_hint: null, experiment_id: null, variant: null, referrer: null, landing_path: "/start" },
    }),
  }));
  expect(response.status).toBe(200);
  return (await response.json()).request_id as string;
}

describe("T1-14 trusted identity across the real intake adapter chain", () => {
  it("threads server identity through classification while T1-35 selects questions deterministically; client budget keys are ignored", async () => {
    const requestId = await start();
    expect(requestId).not.toBe("rq_forged_client_budget");
    expect(captured.map(call => call.capability)).toEqual(["classify_problem"]);
    expect(captured.every(call => call.request_id === requestId && call.tenant_id === DEFAULT_TENANT_ID)).toBe(true);
  });

  it("threads the same saved journey identity from media storage into the real OCR adapter and keeps the upload on model refusal", async () => {
    const requestId = await start();
    captured.length = 0;
    __setLabelReaderForTests(readEquipmentLabel);
    const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
    const result = await attachMedia({ request_id: requestId, target: "door_photo", source: "door_form",
      file: new File([new Uint8Array(bytes)], "synthetic-label.png", { type: "image/png" }) });
    expect(result).toMatchObject({ ok: true, evidence_id: expect.stringMatching(/^ev_/) });
    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({ capability: "read_equipment_label", request_id: requestId, tenant_id: DEFAULT_TENANT_ID });
  });
});
