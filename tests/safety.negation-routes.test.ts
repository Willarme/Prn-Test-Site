import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { ACTIVE_DISCLOSURE } from "@/domain/privacy/disclosures";
import { ACTIVE_SAFETY_PACKAGE } from "@/domain/problem/safety-package";
import { renderPacketHtml } from "@/domain/packet/render";
import { MemoryAiPolicyStore, setAiPolicyStoreForTests } from "@/platform/ai/policy-store";
import { MemorySpendLedger, setSpendLedgerForTests } from "@/platform/ai/spend";
import { resetRuntimeStore } from "@/platform/stores/runtime";
import { readDevDb } from "@/platform/stores/dev-db";
import { loadPacket } from "@/platform/packet/load";
import { POST as jsonPost } from "@/app/api/intake/route";
import { POST as doorPost } from "@/app/api/intake/start/route";

const words = "My AC is not cooling. No smoke, burning smell, gas smell, sparks or leaking water.";
const network = vi.fn(() => { throw new Error("No external model or network allowed in safety regression"); });
const attribution = { page_id: null, intent_cluster_id: null, search_opportunity_id: null, problem_family_hint: "hvac-cooling", experiment_id: null, variant: null, referrer: null, landing_path: "/start" };
beforeAll(() => {
  vi.stubEnv("PRN_RUNTIME_STORE", "file");
  vi.stubEnv("PRN_DEV_DB_PATH", join(mkdtempSync(join(tmpdir(), "prn-safety-negation-fixture-")), "dev-db.json"));
  vi.stubEnv("LINK_SIGNING_SECRET", "synthetic-safety-negation-test-only-secret-20260906");
  vi.stubGlobal("fetch", network);
  setAiPolicyStoreForTests(new MemoryAiPolicyStore());
  setSpendLedgerForTests(new MemorySpendLedger());
  resetRuntimeStore();
});
afterAll(() => {
  expect(network).not.toHaveBeenCalled();
  setAiPolicyStoreForTests(null);
  setSpendLedgerForTests(null);
  resetRuntimeStore();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function jsonStart(description: string) {
  return jsonPost(new Request("http://localhost/api/intake", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ description, attribution, disclosure_content_hash: ACTIVE_DISCLOSURE.content_hash }),
  }));
}
async function doorStart(description: string) {
  const body = new FormData();
  body.set("problem_description", description);
  body.set("problem_family_hint", "hvac-cooling");
  body.set("disclosure_content_hash", ACTIVE_DISCLOSURE.content_hash);
  return doorPost(new Request("http://localhost/api/intake/start", { method: "POST", body }));
}

it("JSON intake persists the actual negated narrative and its packet renders all three pages without re-halting", async () => {
  const response = await jsonStart(words);
  expect(response.status).toBe(200);
  const result = await response.json();
  expect(result.request_id).toEqual(expect.stringMatching(/^rq_/));
  expect(response.headers.get("set-cookie")).toBeTruthy();
  const packet = await loadPacket(result.request_id, { link_base: "https://example.test", owner: true });
  expect(packet?.safety_halt).toBeUndefined();
  expect(packet?.input).not.toBeNull();
  expect(JSON.stringify(packet!.journey.problem)).toContain(words);
  const rendered = renderPacketHtml(packet!.input!);
  expect(rendered.html.match(/<div class="page(?: page-detail)?">/g)).toHaveLength(3);
  expect(rendered.halted).toBe(false);
  expect(rendered.self_check).toMatchObject({ ok: true, failures: [] });
});

it("the multipart door enters its own request instead of redirecting to gas safety", async () => {
  const response = await doorStart(words);
  expect(response.status).toBe(303);
  expect(response.headers.get("location")).toMatch(/^\/complete\/rq_/);
  expect(response.headers.get("set-cookie")).toBeTruthy();
});

it.each([
  ["No gas smell, but the outlet is sparking.", "safety_fire"],
  ["I cannot rule out a gas smell.", "safety_gas"],
  ["I am not sure there is no gas smell.", "safety_gas"],
] as const)("both real transports still halt the correct active/uncertain hazard: %s", async (description, id) => {
  const before = readDevDb();
  const response = await jsonStart(description);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ request_id: null, safety: {
    intake_may_continue: false,
    message: ACTIVE_SAFETY_PACKAGE.rules.find(rule => rule.safety_rule_id === id)!.approved_response,
  } });
  expect((await doorStart(description)).headers.get("location")).toBe("/safety/" + id);
  const after = readDevDb();
  expect(after.problems.length).toBe(before.problems.length);
  expect(after.packets.length).toBe(before.packets.length);
});
