import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACTIVE_DISCLOSURE } from "@/domain/privacy/disclosures";
import { MemoryAiPolicyStore, setAiPolicyStoreForTests } from "@/platform/ai/policy-store";
import { MemorySpendLedger, setSpendLedgerForTests } from "@/platform/ai/spend";
import { signLink } from "@/platform/links/tokens";
import { resetRuntimeStore, runtimeStore } from "@/platform/stores/runtime";
import { readIntakeEffort } from "@/platform/intake/effort";
import { POST as startPost } from "@/app/api/intake/route";
import { POST as answerPost } from "@/app/api/intake/answer/route";
import { POST as addressPost } from "@/app/api/packet/address/route";

// New security counterexamples through accepted request handlers. No direct
// store injection, no live model, no network and no production data.
describe("T1-35 adversarial server-authored answer costs", () => {
  let dir: string;
  const network = vi.fn(() => { throw new Error("External transport forbidden"); });
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "t135-admission-"));
    vi.stubEnv("PRN_DEV_DB_PATH", join(dir, "dev-db.json"));
    vi.stubEnv("PRN_RUNTIME_STORE", "file");
    vi.stubEnv("VITEST", "1"); vi.stubEnv("PRN_AI_LIVE_TESTS", "0");
    vi.stubGlobal("fetch", network);
    resetRuntimeStore();
    setAiPolicyStoreForTests(new MemoryAiPolicyStore());
    setSpendLedgerForTests(new MemorySpendLedger());
  });
  afterEach(() => {
    expect(network).not.toHaveBeenCalled();
    resetRuntimeStore(); setAiPolicyStoreForTests(null); setSpendLedgerForTests(null);
    vi.unstubAllEnvs(); vi.unstubAllGlobals();
    rmSync(dir, { recursive: true, force: true });
  });
  async function start(description = "My AC is not cooling") {
    const response = await startPost(new Request("http://localhost/api/intake", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ description, disclosure_content_hash: ACTIVE_DISCLOSURE.content_hash,
        attribution: { landing_path: "/start", problem_family_hint: "hvac-cooling", page_id: null,
          intent_cluster_id: null, search_opportunity_id: null, experiment_id: null, variant: null, referrer: null } }),
    }));
    expect(response.status).toBe(200);
    return (await response.json()).request_id as string;
  }
  async function answer(id: string, fields: object[]) {
    return answerPost(new Request("http://localhost/api/intake/answer", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ request_id: id, k: signLink({ scope: "keep", request_id: id }), fields }),
    }));
  }
  const ledger = (id: string) => readIntakeEffort({ request_id: id, tenant_id: "prn" });
  async function packetAddress(id: string) {
    const form = new FormData();
    form.set("request_id", id); form.set("k", signLink({ scope: "keep", request_id: id }));
    form.set("street", "123 Synthetic Example Street"); form.set("city_state_zip", "Example Town, IN 00000");
    return addressPost(new Request("http://localhost/api/packet/address", { method: "POST", body: form }));
  }

  it("cannot turn a first-time typed value into a one-unit confirmation by setting a client flag", async () => {
    const id = await start();
    const before = await ledger(id);
    expect((await runtimeStore().listIntakeAnswers(id)).some(a => a.field_key === "brand")).toBe(false);
    const response = await answer(id, [{ field_key: "brand", value: "Carrier", confirmed: true }]);
    // Either reject a nonexistent confirmation or price it as actual new text.
    if (response.status === 200) {
      expect((await ledger(id)).effort_spent - before.effort_spent).toBe(4);
    } else {
      expect([400, 409]).toContain(response.status);
      expect((await ledger(id)).effort_spent).toBe(before.effort_spent);
      expect((await runtimeStore().listIntakeAnswers(id)).some(a => a.field_key === "brand")).toBe(false);
    }
  });

  it("cannot submit a different value at the one-unit confirmation price", async () => {
    const id = await start("My Carrier AC is not cooling");
    const before = await ledger(id);
    const response = await answer(id, [{ field_key: "brand", value: "Trane", confirmed: true }]);
    if (response.status === 200) {
      expect((await ledger(id)).effort_spent - before.effort_spent).toBe(4);
    } else {
      expect([400, 409]).toContain(response.status);
      expect((await ledger(id)).effort_spent).toBe(before.effort_spent);
    }
  });

  it("refuses new typed work with only one effort unit left even when the client calls it a confirmation", async () => {
    const id = await start();
    while ((await ledger(id)).effort_spent < 19) {
      // Distinct accepted choice attempts are real retries and each costs one.
      expect((await answer(id, [{ field_key: "urgency", value: "Today" }])).status).toBe(200);
    }
    expect((await ledger(id)).effort_spent).toBe(19);
    const response = await answer(id, [{ field_key: "brand", value: "Carrier", confirmed: true }]);
    expect([400, 409]).toContain(response.status);
    expect((await ledger(id)).effort_spent).toBe(19);
    expect((await runtimeStore().listIntakeAnswers(id)).some(a => a.field_key === "brand")).toBe(false);
    expect(await runtimeStore().getJourney(id)).not.toBeNull();
  });

  it("charges the packet address form as the same four-unit typed group as intake address", async () => {
    const id = await start();
    const before = await ledger(id);
    expect((await packetAddress(id)).status).toBe(303);
    expect((await ledger(id)).effort_spent - before.effort_spent).toBe(4);
    expect(await runtimeStore().getJobAddress(id)).toMatchObject({ street: "123 Synthetic Example Street" });
  });

  it("the separate packet address form cannot save four-unit work with only three units left", async () => {
    const id = await start();
    while ((await ledger(id)).effort_spent < 17) {
      expect((await answer(id, [{ field_key: "urgency", value: "Today" }])).status).toBe(200);
    }
    await packetAddress(id);
    // A redirect to an honest packet or an explicit refusal is acceptable;
    // persisting extra customer work for free is not.
    expect((await ledger(id)).effort_spent).toBe(17);
    expect(await runtimeStore().getJobAddress(id)).toBeNull();
    expect(await runtimeStore().getJourney(id)).not.toBeNull();
  });
});
