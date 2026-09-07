import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";

const faults = vi.hoisted(() => ({ signing: false, runtime: false, safety_event: false, classification: false, persist: false, classificationCalls: 0, signingRows: [] as number[] }));
const canary = "synthetic-private-error-context-must-not-escape";
vi.mock("@/platform/stores/atomic-file", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/platform/stores/atomic-file")>();
  return { ...actual, withFileLock<T>(target: string, action: () => T): T {
    if (faults.signing && target.endsWith("link-secret.txt")) {
      const path = process.env.PRN_DEV_DB_PATH!;
      const rows = existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as { intake_sessions: unknown[] }).intake_sessions.length : 0;
      faults.signingRows.push(rows);
      throw Object.assign(new Error("synthetic-private-error-context-must-not-escape"), { code: "EROFS" });
    }
    return actual.withFileLock(target, action);
  } };
});
vi.mock("@/platform/stores/runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/platform/stores/runtime")>();
  return { ...actual, runtimeStore() {
    if (faults.runtime) throw Object.assign(new Error("synthetic-private-error-context-must-not-escape"), { code: "NOT_AN_ALLOWLISTED_SECRET_CANARY" });
    const store = actual.runtimeStore();
    return new Proxy(store, { get(target, key) {
      if (key === "recordJourney" && faults.persist) return async () => { throw new Error("synthetic-private-error-context-must-not-escape"); };
      if (key === "recordEvents" && faults.safety_event) return async () => { throw new Error("synthetic-private-error-context-must-not-escape"); };
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    } });
  } };
});
vi.mock("@/domain/problem/capabilities", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/domain/problem/capabilities")>();
  return { ...actual, classifyProblem: (...args: Parameters<typeof actual.classifyProblem>) => {
    faults.classificationCalls += 1;
    if (faults.classification) throw new Error("synthetic-private-error-context-must-not-escape");
    return actual.classifyProblem(...args);
  } };
});

import { POST as jsonPost } from "@/app/api/intake/route";
import { POST as doorPost } from "@/app/api/intake/start/route";
import { ACTIVE_DISCLOSURE } from "@/domain/privacy/disclosures";
import { ACTIVE_SAFETY_PACKAGE } from "@/domain/problem/safety-package";
import { MemoryAiPolicyStore, setAiPolicyStoreForTests } from "@/platform/ai/policy-store";
import { MemorySpendLedger, setSpendLedgerForTests } from "@/platform/ai/spend";
import { __resetLinkSecretForTests, verifyLink } from "@/platform/links/tokens";
import { readDevDb } from "@/platform/stores/dev-db";
import { resetRuntimeStore } from "@/platform/stores/runtime";

const network = vi.fn(() => { throw new Error("External network forbidden in hosted-entry tests"); });
const receipts: unknown[] = [];
let errorSpy: ReturnType<typeof vi.spyOn>;
let observed: unknown[];
const words = "My AC is not cooling. No smoke, burning smell, gas smell, sparks or leaking water.";
const attribution = { page_id: null, intent_cluster_id: null, search_opportunity_id: null, problem_family_hint: "hvac-cooling", experiment_id: null, variant: null, referrer: null, landing_path: "/start" };
type Transport = "json" | "door";

beforeEach(() => {
  Object.assign(faults, { signing: false, runtime: false, safety_event: false, classification: false, persist: false, classificationCalls: 0, signingRows: [] });
  observed = [];
  vi.stubEnv("PRN_RUNTIME_STORE", "file");
  vi.stubEnv("PRN_DEV_DB_PATH", join(mkdtempSync(join(tmpdir(), "prn-hosted-entry-case-")), "dev-db.json"));
  vi.stubEnv("LINK_SIGNING_SECRET", "");
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("VERCEL", "");
  vi.stubGlobal("fetch", network);
  network.mockClear();
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  setAiPolicyStoreForTests(new MemoryAiPolicyStore());
  setSpendLedgerForTests(new MemorySpendLedger());
  resetRuntimeStore();
  __resetLinkSecretForTests();
});
afterEach(() => {
  receipts.push({ test: expect.getState().currentTestName, observed, signing_rows_at_fault: [...faults.signingRows], saved_sessions: readDevDb().intake_sessions.length, network_calls: network.mock.calls.length });
  expect(network).not.toHaveBeenCalled();
  errorSpy.mockRestore();
  setAiPolicyStoreForTests(null);
  setSpendLedgerForTests(null);
  resetRuntimeStore();
  __resetLinkSecretForTests();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
afterAll(() => {
  if (process.env.PRN_HOSTED_ENTRY_RECEIPT) writeFileSync(process.env.PRN_HOSTED_ENTRY_RECEIPT, JSON.stringify(receipts, null, 2) + "\n");
});

async function submit(transport: Transport, description = words, disclosure = ACTIVE_DISCLOSURE.content_hash) {
  try {
    let response: Response;
    if (transport === "json") {
      response = await jsonPost(new Request("http://localhost/api/intake", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ description, attribution, disclosure_content_hash: disclosure }) }));
    } else {
      const form = new FormData();
      form.set("problem_description", description);
      form.set("problem_family_hint", "hvac-cooling");
      form.set("disclosure_content_hash", disclosure);
      response = await doorPost(new Request("http://localhost/api/intake/start", { method: "POST", body: form }));
    }
    observed.push({ transport, status: response.status, cookie_returned: Boolean(response.headers.get("set-cookie")), success_location: Boolean(response.headers.get("location")?.startsWith("/complete/")) });
    return { response, thrown: false };
  } catch {
    observed.push({ transport, thrown: true });
    return { response: null, thrown: true };
  }
}

async function expectUnavailable(transport: Transport, result: Awaited<ReturnType<typeof submit>>, phase: string, code: string) {
  expect(result.thrown).toBe(false);
  expect(result.response).not.toBeNull();
  const response = result.response!;
  expect(response.headers.get("set-cookie")).toBeNull();
  if (transport === "json") {
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error).toMatch(/could not|couldn.t/i);
    expect(JSON.stringify(body)).not.toContain(canary);
    expect(JSON.stringify(body)).not.toContain("NOT_AN_ALLOWLISTED_SECRET_CANARY");
    expect(body).not.toHaveProperty("request_id");
    expect(body).not.toHaveProperty("next");
    expect(body.detail).toEqual(expect.stringMatching(/^isd_[0-9a-f-]{36}$/));
    expect(errorSpy.mock.calls.some((call) => call[0] === "intake.start_failed" && (call[1] as { diagnostic_id?: string }).diagnostic_id === body.detail)).toBe(true);
  } else {
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/problems/ac-blowing-warm-air?error=try_again#intake");
  }
  const diagnostics = errorSpy.mock.calls.filter((call) => call[0] === "intake.start_failed").map((call) => call[1] as Record<string, unknown>);
  expect(diagnostics.length).toBeGreaterThan(0);
  const latest = diagnostics.at(-1)!;
  expect(Object.keys(latest).sort()).toEqual(["diagnostic_id", "error_code", "phase"]);
  expect(latest).toMatchObject({ phase, error_code: code });
  expect(latest.diagnostic_id).toEqual(expect.stringMatching(/^isd_[0-9a-f-]{36}$/));
  expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(canary);
}

it.each(["json", "door"] as const)("%s: EROFS signing failure and retry create no hidden journeys, then recovery creates exactly one", async (transport) => {
  faults.signing = true;
  const first = await submit(transport);
  const second = await submit(transport);
  expect({ thrown: [first.thrown, second.thrown], signing_rows: faults.signingRows, saved_sessions: readDevDb().intake_sessions.length }).toEqual({ thrown: [false, false], signing_rows: [0, 0], saved_sessions: 0 });
  await expectUnavailable(transport, first, "owner_signing", "EROFS");
  await expectUnavailable(transport, second, "owner_signing", "EROFS");
  const diagnostics = errorSpy.mock.calls.filter((call) => call[0] === "intake.start_failed").map((call) => (call[1] as { diagnostic_id: string }).diagnostic_id);
  expect(new Set(diagnostics).size).toBe(2);
  faults.signing = false;
  vi.stubEnv("LINK_SIGNING_SECRET", "synthetic-hosted-entry-explicit-key-for-tests-only");
  const recovered = await submit(transport);
  expect(recovered.thrown).toBe(false);
  expect(recovered.response!.status).toBe(transport === "json" ? 200 : 303);
  expect(recovered.response!.headers.get("set-cookie")).toBeTruthy();
  expect(readDevDb().intake_sessions).toHaveLength(1);
});

it.each(["json", "door"] as const)("%s: production without an explicit signing key stops before persistence", async (transport) => {
  vi.stubEnv("NODE_ENV", "production");
  const result = await submit(transport);
  expect({ thrown: result.thrown, saved_sessions: readDevDb().intake_sessions.length }).toEqual({ thrown: false, saved_sessions: 0 });
  await expectUnavailable(transport, result, "owner_signing", "LINK_SIGNING_NOT_CONFIGURED");
  expect(existsSync(join(process.env.PRN_DEV_DB_PATH!, "..", "link-secret.txt"))).toBe(false);
});

it.each(["runtime", "classification", "persist"] as const)("unexpected %s failure is sanitized, structured and does not return an owner cookie", async (stage) => {
  vi.stubEnv("LINK_SIGNING_SECRET", "synthetic-hosted-entry-explicit-key-for-tests-only");
  faults[stage] = true;
  const result = await submit("json");
  await expectUnavailable("json", result, stage === "persist" ? "journey_persist" : stage, "UNEXPECTED");
  expect(readDevDb().intake_sessions).toHaveLength(0);
});

it("configured production signing returns a request-bound owner cookie only after the real save", async () => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("VERCEL", "1");
  vi.stubEnv("LINK_SIGNING_SECRET", "synthetic-hosted-entry-explicit-key-for-tests-only");
  const result = await submit("json");
  expect(result.thrown).toBe(false);
  expect(result.response!.status).toBe(200);
  const body = await result.response!.json();
  expect(readDevDb().intake_sessions.map((session) => session.request_id)).toEqual([body.request_id]);
  const raw = result.response!.headers.get("set-cookie")!.match(/^[^=]+=([^;]+)/)![1];
  expect(await verifyLink(decodeURIComponent(raw), "keep")).toMatchObject({ ok: true, request_id: body.request_id });
  expect(errorSpy).not.toHaveBeenCalled();
});

it("consent and fixed safety responses remain ahead of signing configuration", async () => {
  vi.stubEnv("NODE_ENV", "production");
  expect((await submit("json", words, "wrong-disclosure")).response!.status).toBe(409);
  const gas = await submit("json", "There is a gas smell.");
  expect(gas.response!.status).toBe(200);
  expect(await gas.response!.json()).toMatchObject({ request_id: null, safety: { intake_may_continue: false, message: ACTIVE_SAFETY_PACKAGE.rules.find((rule) => rule.safety_rule_id === "safety_gas")!.approved_response } });
  expect(readDevDb().intake_sessions).toHaveLength(0);
  expect(errorSpy).not.toHaveBeenCalled();
});

it.each([
  ["json", "runtime"], ["json", "safety_event"], ["door", "runtime"], ["door", "safety_event"],
] as const)("%s: positive gas still returns its canonical halt when %s fails", async (transport, stage) => {
  vi.stubEnv("NODE_ENV", "production");
  faults[stage] = true;
  const result = await submit(transport, "There is a gas smell.");
  expect(result.thrown).toBe(false);
  expect(result.response!.headers.get("set-cookie")).toBeNull();
  if (transport === "json") {
    expect(result.response!.status).toBe(200);
    expect(await result.response!.json()).toMatchObject({ request_id: null, safety: { intake_may_continue: false, message: ACTIVE_SAFETY_PACKAGE.rules.find((rule) => rule.safety_rule_id === "safety_gas")!.approved_response } });
  } else {
    expect(result.response!.status).toBe(303);
    expect(result.response!.headers.get("location")).toBe("/safety/safety_gas");
  }
  expect(faults.classificationCalls).toBe(0);
  expect(readDevDb().intake_sessions).toHaveLength(0);
  expect(errorSpy.mock.calls).toEqual([["intake.start_failed", { diagnostic_id: expect.stringMatching(/^isd_[0-9a-f-]{36}$/), phase: stage, error_code: "UNEXPECTED" }]]);
  expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(canary);
});
