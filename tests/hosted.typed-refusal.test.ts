import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";

const faults = vi.hoisted(() => ({ stage: "classification" as "classification" | "packet", executorCalls: [] as string[] }));
const canary = "synthetic-private-capability-context-must-not-escape";

// Fail beneath the real gateway. Its executor catch must produce the actual
// typed refusal consumed by A01/A02, rather than throwing from their wrappers.
vi.mock("@/domain/problem/fixture-engine", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/domain/problem/fixture-engine")>();
  return { ...actual, analyzeProblemFixture: (...args: Parameters<typeof actual.analyzeProblemFixture>) => {
    faults.executorCalls.push("classification");
    if (faults.stage === "classification") throw new Error("synthetic-private-capability-context-must-not-escape");
    return actual.analyzeProblemFixture(...args);
  } };
});
vi.mock("@/domain/problem/packet-assembly", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/domain/problem/packet-assembly")>();
  return { ...actual, generateJobPacket: (...args: Parameters<typeof actual.generateJobPacket>) => {
    faults.executorCalls.push("packet");
    if (faults.stage === "packet") throw new Error("synthetic-private-capability-context-must-not-escape");
    return actual.generateJobPacket(...args);
  } };
});

import { POST as jsonPost } from "@/app/api/intake/route";
import { POST as doorPost } from "@/app/api/intake/start/route";
import { ACTIVE_DISCLOSURE } from "@/domain/privacy/disclosures";
import * as gateway from "@/platform/gateway";
import { MemoryAiPolicyStore, setAiPolicyStoreForTests } from "@/platform/ai/policy-store";
import { MemorySpendLedger, setSpendLedgerForTests } from "@/platform/ai/spend";
import { __resetLinkSecretForTests } from "@/platform/links/tokens";
import { resetKillSwitchForTests } from "@/platform/killswitch";
import { resetAgentRunLedgerForTests } from "@/platform/runs/ledger";
import { readDevDb } from "@/platform/stores/dev-db";
import { resetRuntimeStore } from "@/platform/stores/runtime";

const realCapabilityCall = gateway.capability_call;
const network = vi.fn(() => { throw new Error("No network in typed-refusal tests"); });
const receipts: unknown[] = [];
let errorSpy: ReturnType<typeof vi.spyOn>;
let observed: Record<string, unknown>;
let typedRefusals: Array<{ kind: string; reason: string }>;

beforeEach(() => {
  faults.executorCalls = [];
  typedRefusals = [];
  observed = {};
  vi.stubEnv("PRN_RUNTIME_STORE", "file");
  vi.stubEnv("PRN_DEV_DB_PATH", join(mkdtempSync(join(tmpdir(), "prn-typed-refusal-case-")), "dev-db.json"));
  vi.stubEnv("LINK_SIGNING_SECRET", "synthetic-typed-refusal-key-for-local-tests-only");
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("VITEST", "1");
  vi.stubEnv("PRN_AI_LIVE_TESTS", "0");
  vi.stubGlobal("fetch", network);
  network.mockClear();
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  setAiPolicyStoreForTests(new MemoryAiPolicyStore());
  setSpendLedgerForTests(new MemorySpendLedger());
  resetRuntimeStore();
  resetKillSwitchForTests();
  resetAgentRunLedgerForTests();
  __resetLinkSecretForTests();
  vi.spyOn(gateway, "capability_call").mockImplementation(async <T>(input: gateway.CapabilityCallInput) => {
    const result = await realCapabilityCall<T>(input);
    if (!result.ok) typedRefusals.push({ kind: result.kind, reason: result.reason });
    return result;
  });
});

afterEach(() => {
  receipts.push({ test: expect.getState().currentTestName, ...observed,
    actual_executor_calls: faults.executorCalls,
    actual_gateway_private_refusal: typedRefusals.some(result => result.kind === "error" && result.reason === canary),
    saved_sessions: readDevDb().intake_sessions.length, network_calls: network.mock.calls.length });
  expect(network).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  setAiPolicyStoreForTests(null);
  setSpendLedgerForTests(null);
  resetRuntimeStore();
  resetKillSwitchForTests();
  resetAgentRunLedgerForTests();
  __resetLinkSecretForTests();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
afterAll(() => {
  if (process.env.PRN_TYPED_REFUSAL_RECEIPT) writeFileSync(process.env.PRN_TYPED_REFUSAL_RECEIPT, JSON.stringify(receipts, null, 2) + "\n");
});

it.each([
  ["json", "classification"], ["json", "packet"],
  ["door", "classification"], ["door", "packet"],
] as const)("%s: real %s executor refusal has sanitized public detail and entry diagnostics", async (transport, stage) => {
  faults.stage = stage;
  const description = "My AC is not cooling";
  let response: Response;
  if (transport === "json") {
    response = await jsonPost(new Request("http://localhost/api/intake", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
      description, disclosure_content_hash: ACTIVE_DISCLOSURE.content_hash,
      attribution: { page_id: null, intent_cluster_id: null, search_opportunity_id: null, problem_family_hint: "hvac-cooling", experiment_id: null, variant: null, referrer: null, landing_path: "/start" },
    }) }));
  } else {
    const form = new FormData();
    form.set("problem_description", description);
    form.set("problem_family_hint", "hvac-cooling");
    form.set("disclosure_content_hash", ACTIVE_DISCLOSURE.content_hash);
    response = await doorPost(new Request("http://localhost/api/intake/start", { method: "POST", body: form }));
  }
  const body = transport === "json" ? await response.json() as Record<string, unknown> : null;
  const diagnostics = errorSpy.mock.calls.filter(call => call[0] === "intake.start_failed").map(call => call[1] as Record<string, unknown>);
  observed = { status: response.status, cookie_returned: Boolean(response.headers.get("set-cookie")),
    private_canary_returned: JSON.stringify(body).includes(canary),
    random_detail_returned: typeof body?.detail === "string" && /^isd_[0-9a-f-]{36}$/.test(body.detail),
    diagnostic_count: diagnostics.length, private_canary_logged: JSON.stringify(errorSpy.mock.calls).includes(canary) };

  expect(typedRefusals).toEqual([{ kind: "error", reason: canary }]);
  expect(faults.executorCalls).toEqual(stage === "classification" ? ["classification"] : ["classification", "packet"]);
  expect(response.headers.get("set-cookie")).toBeNull();
  expect(readDevDb().intake_sessions).toHaveLength(0);
  if (body) {
    expect(response.status).toBe(503);
    expect(body.error).toBe(stage === "classification"
      ? "We could not read your request just now. Your text is still here — please try again in a moment."
      : "We could not build your Job Packet just now. Your text is still here — please try again in a moment.");
    expect(body).not.toHaveProperty("request_id");
    expect(body).not.toHaveProperty("next");
    expect(JSON.stringify(body)).not.toContain(canary);
    expect(body.detail).toEqual(expect.stringMatching(/^isd_[0-9a-f-]{36}$/));
  } else {
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/problems/ac-blowing-warm-air?error=try_again#intake");
  }
  expect(diagnostics).toEqual([{ diagnostic_id: expect.stringMatching(/^isd_[0-9a-f-]{36}$/), phase: stage, error_code: "UNEXPECTED" }]);
  if (body) expect(diagnostics[0].diagnostic_id).toBe(body.detail);
  expect(errorSpy.mock.calls).toHaveLength(1);
  expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(canary);
});
