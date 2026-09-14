import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DOOR_RELEASE_CHECK_IDS, DOOR_RELEASE_DEPENDENCY_KINDS, issueDoorEvidenceReceipt, parseDoorEvidenceReceipt, evaluateDoorRelease, type DoorEvidencePayload, type DoorEvidenceReceipt, type DoorReleasePolicy, type DoorEvidenceSubject } from "@/domain/search/door-v44/release-evidence";
import { doorV44Hash } from "@/domain/search/door-v44/schema-engine";
import { doorPageEvidenceStore } from "@/platform/search/door-page-evidence-store";
import { doorPageVersionStore } from "@/platform/search/door-page-version-store";
import { doorPageVersionInputStore } from "@/platform/search/door-page-version-input-store";
import { doorPageMetadataSchema, type DoorPageVersionReservation } from "@/domain/search/door-v44/page-version";
import { prepareDoorPageVersionInput } from "@/domain/search/door-v44/page-version-input";
import { compilerFixture } from "./fixtures/door-v44/compiler-fixture";
import { compileDoorV44Page } from "@/domain/search/door-v44/compiler";
import { readDevDb } from "@/platform/stores/dev-db";
import type { PlatformClientProvider } from "@/platform/db/client";

// Entire producer registry and all PASS observations below are injected TEST
// data. They exercise the gate, never attest real H01-H18 or hosted release.
const H = "a".repeat(64), B = "b".repeat(64), now = "2026-09-13T21:00:00Z";
const environment = { id: "synthetic-test", manifest_sha256: H, commit: "a".repeat(40), origin: "https://fixture.example" };
const dependencies = [...DOOR_RELEASE_DEPENDENCY_KINDS].sort().map(kind => ({ kind, id: "v44", version: "1", sha256: H }));
const writerModels = [{ provider: "fixture", model_id: "writer" }];
const writer = { models: writerModels, assignments_sha256: doorV44Hash(writerModels) };
const policy: DoorReleasePolicy = { version: "test-policy", required_checks: [...DOOR_RELEASE_CHECK_IDS],
  producers: [{ id: "test-system", version: "1", implementation_sha256: H, actor_kind: "system", trust_scope: "governed_execution", kinds: ["artifact_integrity", "independent_critic", "check_matrix", "technical_assessment", "release_evaluation", "revocation"], check_ids: [...DOOR_RELEASE_CHECK_IDS] },
    { id: "test-human", version: "1", implementation_sha256: H, actor_kind: "human", trust_scope: "human_action", kinds: ["content_approval", "publish_action", "review"], check_ids: [] }],
  dependencies, environment, max_evidence_age_seconds: 86400,
  holds: { public_publish: false, door_pages_live: true, trial_noindex: true } };
const fence = { revision: 1, dependency_revision: 1, hold_revision: 1, dependencies_sha256: doorV44Hash(dependencies), environment_sha256: doorV44Hash(environment), holds_sha256: doorV44Hash(policy.holds) };
let subject: DoorEvidenceSubject;
let fixture: Awaited<ReturnType<typeof compilerFixture>>;
let metadata: ReturnType<typeof doorPageMetadataSchema.parse>;
let reservation: DoorPageVersionReservation;
let wire: ReturnType<typeof prepareDoorPageVersionInput>["wire"];
let db: PGlite;
let temp: string | null = null;
const audit = { actor: "system:synthetic-test", reason: "Offline synthetic evidence fixture", at: "2026-09-13T19:00:00Z" };
function receipt(kind: DoorEvidenceReceipt["kind"], output: unknown, changes: Record<string, unknown> = {}): DoorEvidenceReceipt {
  const human = ["content_approval", "publish_action", "review"].includes(kind);
  return issueDoorEvidenceReceipt({ format: "door-v44-evidence/1.0.0", kind, subject, producer: { id: human ? "test-human" : "test-system", version: "1", implementation_sha256: H, run_id: "synthetic-run", actor_id: human ? "synthetic-owner" : "system:synthetic-test", actor_kind: human ? "human" : "system", trust_scope: human ? "human_action" : "governed_execution" },
    environment, dependencies, started_at: "2026-09-13T20:00:00Z", finished_at: "2026-09-13T20:01:00Z", expires_at: "2026-09-13T23:00:00Z", verdict: "PASS", findings: [], attachments: [], output, ...changes } as DoorEvidencePayload);
}
function reissue(r: DoorEvidenceReceipt, changes: Record<string, unknown>) { const { receipt_sha256: _hash, ...body } = r; void _hash; return issueDoorEvidenceReceipt({ ...body, ...changes } as DoorEvidencePayload); }
function base() {
  return [receipt("artifact_integrity", { artifact_read_verified: true, semantic_verified: true, input_verified: true }),
    receipt("independent_critic", { provider: "fixture", model_id: "critic", generation_id: null, prompt_id: "test", prompt_version: "1", prompt_sha256: H, policy_sha256: H, projection_sha256: H, writer_assignments_sha256: writer.assignments_sha256, repair_iteration: 0, prior_attempt_sha256: null, schema_repaired: false, cost_usd: "0.000001", usage: { prompt_tokens: 2, completion_tokens: 2, total_tokens: 4 } }),
    receipt("check_matrix", { checks: DOOR_RELEASE_CHECK_IDS.map(check_id => ({ check_id, verdict: "PASS", result_sha256: H })) })];
}
function evaluate(rows: DoorEvidenceReceipt[], phase: "technical" | "publish" = "technical", changes = {}) { return evaluateDoorRelease({ phase, subject, receipts: rows, active_receipt_hashes: rows.map(r => r.receipt_sha256), writer, policy, fence, now, ...changes }); }
function approved() {
  const rows = base(); const result = evaluate(rows); expect(result.eligible).toBe(true);
  const { reasons: _r, valid_until: _v, ...output } = result; void _r; void _v;
  const assessment = receipt("technical_assessment", output, { started_at: "2026-09-13T20:02:00Z", finished_at: "2026-09-13T20:03:00Z" });
  const approval = receipt("content_approval", { assessment_sha256: assessment.receipt_sha256, decision: "APPROVE" }, { started_at: "2026-09-13T20:04:00Z", finished_at: "2026-09-13T20:05:00Z" });
  return [...rows, assessment, approval];
}
const sqlAppend = async (r: unknown) => (await db.query<{ result: unknown }>("select append_door_page_evidence($1::jsonb) as result", [JSON.stringify(r)])).rows[0].result;
beforeAll(async () => {
  db = new PGlite(); await db.exec("create role anon; create role authenticated; create role service_role bypassrls; grant usage on schema public to anon,authenticated,service_role;");
  for (const name of ["00002_journey_runtime.sql", "00003_service_role_grants.sql", "00012_page_registry.sql", "00013_admin_audit_duration.sql", "00028_door_page_versions.sql", "00029_door_page_version_inputs.sql", "00030_door_page_evidence.sql"]) await db.exec(readFileSync(`supabase/migrations/${name}`, "utf8"));
  fixture = await compilerFixture(); const identity = fixture.spec.identity;
  const reserved = { tenant_id: identity.tenant_id, page_id: identity.page_id, canonical_intent_id: identity.canonical_intent_id, canonical_url: new URL(identity.canonical_path, fixture.context.validation.origin).href, operation_id: "evidence-fixture", expected_latest_version: 0, ...audit };
  reservation = (await db.query<{ result: DoorPageVersionReservation }>("select reserve_door_page_version($1::jsonb) as result", [JSON.stringify(reserved)])).rows[0].result;
  wire = prepareDoorPageVersionInput({ tenant_id: identity.tenant_id, page_id: identity.page_id, reservation_id: reservation.reservation_id, spec: fixture.spec, context: fixture.context, model_provenance: { status: "fixture_no_model_calls", fixture_id: "F04" }, ...audit }, reservation).wire;
  await db.query("select capture_door_page_version_input($1::jsonb)", [JSON.stringify(wire)]);
  const compiled = await compileDoorV44Page(fixture.spec, fixture.context); if (!compiled.ok) throw new Error("Synthetic compiler fixture failed");
  metadata = doorPageMetadataSchema.parse({ receipt: compiled.receipt, receipt_sha256: doorV44Hash(compiled.receipt), provenance_status: "unattested", build_provenance_sha256: null });
  await db.query("select register_door_page_version($1::jsonb)", [JSON.stringify({ tenant_id: identity.tenant_id, page_id: identity.page_id, reservation_id: reservation.reservation_id, metadata, ...audit })]);
  subject = { tenant_id: identity.tenant_id, page_id: identity.page_id, page_version: 1, reservation_id: reservation.reservation_id, input_sha256: wire.input_sha256, artifact_hash: compiled.receipt.artifact_hash, compile_receipt_sha256: metadata.receipt_sha256 };
}, 20_000);
afterEach(async () => {
  await db.exec("reset role"); vi.unstubAllEnvs();
  if (temp) { const checked = resolve(temp); if (!checked.startsWith(resolve(tmpdir()) + sep) || !checked.includes("door-evidence-test-")) throw new Error("Unsafe cleanup"); rmSync(checked, { recursive: true, force: true }); temp = null; }
});
afterAll(async () => { await db.close(); });

describe("single v44 release evidence evaluator", () => {
  it("roundtrips configured provider-native model suffixes through TS and SQL",async()=>{
    const r=base().find(r=>r.kind==="independent_critic")!;if(r.kind!=="independent_critic")throw new Error("missing critic fixture");
    const native=reissue(r,{output:{...r.output,model_id:"z-ai/glm-5.2:free"}});
    expect(parseDoorEvidenceReceipt(await sqlAppend(native))).toEqual(native);
  });
  it("accepts a complete injected technical set but requires separate human content approval", () => {
    expect(evaluate(base()).eligible).toBe(true);
    expect(evaluate(base(), "publish").reasons.map(r => r.code)).toContain("CONTENT_APPROVAL_MISSING");
    expect(evaluate(approved(), "publish").eligible).toBe(true);
  });
  it("rejects altered hashes, unknown fields, controls and malformed producer output", () => {
    const r = base()[0];
    for (const bad of [{ ...r, receipt_sha256: B }, { ...r, arbitrary: true }, { ...r, producer: { ...r.producer, actor_id: "secret\nvalue" } }, { ...r, output: { artifact_read_verified: true } }]) expect(() => parseDoorEvidenceReceipt(bad)).toThrow("DOOR_EVIDENCE_INVALID");
  });
  it("cannot replace missing H01-H18 evidence with broad category PASS", () => {
    const rows = base(); const matrix = rows[2];
    if (matrix.kind !== "check_matrix") throw new Error();
    rows[2] = reissue(matrix, { output: { checks: matrix.output.checks.filter(c => !c.check_id.startsWith("H")) } });
    expect(evaluate(rows).reasons.filter(r => r.code === "CHECK_EVIDENCE_MISSING")).toHaveLength(18);
    expect(evaluate(rows).eligible).toBe(false);
  });
  it("requires producer authorization and refuses synthetic provenance even with valid hashes", () => {
    const rows = base(); rows[0] = reissue(rows[0], { producer: { ...rows[0].producer, trust_scope: "synthetic_test" } });
    expect(evaluate(rows).reasons.map(r => r.code)).toContain("EVIDENCE_UNTRUSTED");
    const restricted = structuredClone(policy); restricted.producers[0].check_ids = [];
    expect(evaluate(base(), "technical", { policy: restricted }).reasons.filter(r => r.code === "CHECK_EVIDENCE_MISSING")).toHaveLength(42);
  });
  it("requires known independent writer identity and an actual critic PASS", () => {
    expect(evaluate(base(), "technical", { writer: null }).reasons.map(r => r.code)).toContain("CRITIC_NOT_INDEPENDENT");
    expect(evaluate(base(), "technical", { writer: { ...writer, models: [{ provider: "other", model_id: "critic" }] } }).eligible).toBe(false);
    const rows = base(); rows[1] = reissue(rows[1], { verdict: "NOT_RUN" });
    expect(evaluate(rows).reasons.map(r => r.code)).toContain("CRITIC_NOT_PASS");
  });
  it("uses selected fresh observations while retaining all revocation history", () => {
    const rows = base(); const old = reissue(rows[0], { started_at: "2026-09-12T20:00:00Z", finished_at: "2026-09-12T20:01:00Z", expires_at: "2026-09-12T23:00:00Z" });
    expect(evaluate(rows, "technical", { receipts: [...rows, old] }).eligible).toBe(true);
    const revoked = receipt("revocation", { target_receipt_sha256: rows[0].receipt_sha256, reason_code: "TEST_REVOKED" }, { started_at: "2026-09-13T20:02:00Z", finished_at: "2026-09-13T20:03:00Z" });
    expect(evaluate(rows, "technical", { receipts: [...rows, revoked] }).reasons.map(r => r.code)).toContain("EVIDENCE_REVOKED");
  });
  it("does not erase a failed critic on the same immutable artifact by omitting it", () => {
    const rows = base(); const failed = reissue(rows[1], { verdict: "FAIL" });
    expect(evaluate(rows, "technical", { receipts: [...rows, failed] }).reasons.map(r => r.code)).toContain("CRITIC_UNRESOLVED_FAILURE");
  });
  it("invalidates changed dependencies and checks current publish holds", () => {
    expect(evaluate(base(), "technical", { fence: { ...fence, dependencies_sha256: B } }).reasons.map(r => r.code)).toContain("RELEASE_FENCE_MISMATCH");
    const held = { ...policy, holds: { ...policy.holds, public_publish: true } };
    expect(evaluate(approved(), "publish", { policy: held, fence: { ...fence, holds_sha256: doorV44Hash(held.holds) } }).reasons.map(r => r.code)).toContain("PUBLISH_HOLD");
    expect(evaluate(base(), "technical", { policy: { ...policy, dependencies: [] } }).reasons.map(r => r.code)).toContain("RELEASE_INPUT_INVALID");
  });
  it("refuses an approval of a different evidence set and a newer rejection", () => {
    const rows = approved(); const assessed = rows[3]; if (assessed.kind !== "technical_assessment") throw new Error();
    const changed = reissue(assessed, { output: { ...assessed.output, evidence_hashes: [H] } });
    const approval = receipt("content_approval", { assessment_sha256: changed.receipt_sha256, decision: "APPROVE" }, { started_at: "2026-09-13T20:04:00Z", finished_at: "2026-09-13T20:05:00Z" });
    expect(evaluate([...rows.slice(0, 3), changed, approval], "publish").eligible).toBe(false);
    const rejection = receipt("content_approval", { assessment_sha256: assessed.receipt_sha256, decision: "REJECT" }, { verdict: "FAIL", started_at: "2026-09-13T20:06:00Z", finished_at: "2026-09-13T20:07:00Z" });
    expect(evaluate([...rows, rejection], "publish").eligible).toBe(false);
    expect(evaluate(rows, "publish", { receipts: [...rows, rejection] }).eligible).toBe(false);
  });
  it("allows exact reviewed critic warnings but never waives a blocker or H failure", () => {
    const rows = base(); const findings = [{ code: "TEST_MINOR", pointer: "/hero", severity: "review" as const }];
    rows[1] = reissue(rows[1], { verdict: "WARN", findings });
    expect(evaluate(rows).eligible).toBe(false);
    const review = receipt("review", { reviewed_evidence_sha256: rows[1].receipt_sha256, accepted_findings: findings });
    expect(evaluate([...rows, review]).eligible).toBe(true);
    const blocked = reissue(rows[1], { verdict: "FAIL", findings: [{ ...findings[0], severity: "blocker" }] });
    expect(evaluate([rows[0], blocked, rows[2], review]).eligible).toBe(false);
  });
  it("requires a new immutable version for each content repair and accepts prior-version history", () => {
    const previous = base()[1]; const rows = base(); if (previous.kind !== "independent_critic") throw new Error();
    const current = { ...subject, page_version: 2, artifact_hash: B, input_sha256: B, compile_receipt_sha256: B, reservation_id: B };
    const next = rows.map(r => reissue(r, { subject: current, ...(r.kind === "independent_critic" ? { output: { ...r.output, repair_iteration: 1, prior_attempt_sha256: previous.receipt_sha256 }, started_at: "2026-09-13T20:02:00Z", finished_at: "2026-09-13T20:03:00Z" } : {}) }));
    expect(evaluate(next, "technical", { subject: current, receipts: [...next, previous] }).eligible).toBe(true);
    const invalid = reissue(previous, { output: { ...previous.output, repair_iteration: 1, prior_attempt_sha256: previous.receipt_sha256 }, started_at: "2026-09-13T20:02:00Z", finished_at: "2026-09-13T20:03:00Z" });
    expect(evaluate([rows[0], invalid, rows[2]], "technical", { receipts: [rows[0], invalid, rows[2], previous] }).reasons.map(r => r.code)).toContain("CRITIC_REPAIR_CHAIN_INVALID");
  });
});

describe("actual immutable evidence migration", () => {
  it("matches the single evaluator in actual SQL for positive, missing, revoked and held evidence", async () => {
    const rows = base(); const complete = approved();
    const revoked = receipt("revocation", { target_receipt_sha256: rows[0].receipt_sha256, reason_code: "TEST_REVOKED" }, { started_at: "2026-09-13T20:02:00Z", finished_at: "2026-09-13T20:03:00Z" });
    const rejected = receipt("content_approval", { assessment_sha256: complete[3].receipt_sha256, decision: "REJECT" }, { verdict: "FAIL", started_at: "2026-09-13T20:06:00Z", finished_at: "2026-09-13T20:07:00Z" });
    const failed = reissue(rows[1], { verdict: "FAIL" });
    const old = reissue(rows[0], { started_at: "2026-09-12T20:00:00Z", finished_at: "2026-09-12T20:01:00Z", expires_at: "2026-09-12T23:00:00Z" });
    const synthetic = reissue(rows[0], { producer: { ...rows[0].producer, trust_scope: "synthetic_test" } });
    const cases = [
      { phase: "technical" as const, receipts: rows, active_receipt_hashes: rows.map(r => r.receipt_sha256) },
      { phase: "publish" as const, receipts: complete, active_receipt_hashes: complete.map(r => r.receipt_sha256) },
      { phase: "technical" as const, receipts: rows, active_receipt_hashes: rows.slice(0, 2).map(r => r.receipt_sha256) },
      { phase: "technical" as const, receipts: [...rows, revoked], active_receipt_hashes: rows.map(r => r.receipt_sha256) },
      { phase: "publish" as const, receipts: rows, active_receipt_hashes: rows.map(r => r.receipt_sha256) },
      { phase: "publish" as const, receipts: [...complete, rejected], active_receipt_hashes: complete.map(r => r.receipt_sha256) },
      { phase: "technical" as const, receipts: [...rows, failed], active_receipt_hashes: rows.map(r => r.receipt_sha256) },
      { phase: "technical" as const, receipts: [...rows, old], active_receipt_hashes: rows.map(r => r.receipt_sha256) },
      { phase: "technical" as const, receipts: [synthetic, ...rows.slice(1)], active_receipt_hashes: [synthetic, ...rows.slice(1)].map(r => r.receipt_sha256) },
    ];
    for (const c of cases) {
      const input = { subject, writer, policy, fence, now, ...c };
      const result = (await db.query<{ result: boolean }>("select evaluate_door_release_evidence($1::jsonb) result", [JSON.stringify(input)])).rows[0].result;
      expect(result, `${c.phase}/${c.active_receipt_hashes.length}`).toBe(evaluateDoorRelease(input).eligible);
    }
  });
  it("persists typed receipts idempotently with one audit and exact decimal text", async () => {
    const r = base()[1]; const before = (await db.query<{ n: number }>("select count(*)::int n from admin_audit")).rows[0].n;
    expect(await sqlAppend(r)).toEqual(r); expect(await sqlAppend(r)).toEqual(r);
    expect((await db.query<{ n: number }>("select count(*)::int n from admin_audit")).rows[0].n).toBe(before + 1);
  });
  it("rejects tampered digests, null required values and foreign artifact subjects", async () => {
    const r = base()[0]; await expect(sqlAppend({ ...r, receipt_sha256: B })).rejects.toThrow("DOOR_EVIDENCE_INVALID");
    const nulls = { ...r, output: { artifact_read_verified: null, semantic_verified: true, input_verified: true } }; const { receipt_sha256: _h, ...body } = nulls; void _h;
    await expect(sqlAppend({ ...body, receipt_sha256: doorV44Hash(body) })).rejects.toThrow("DOOR_EVIDENCE_INVALID");
    await expect(sqlAppend(reissue(r, { subject: { ...r.subject, artifact_hash: B } }))).rejects.toThrow("DOOR_EVIDENCE_CONFLICT");
    await expect(sqlAppend(reissue(r, { subject: { ...r.subject, tenant_id: "foreign" } }))).rejects.toThrow("DOOR_EVIDENCE_CONFLICT");
    for (const [area, field] of [["producer", "actor_kind"], ["producer", "implementation_sha256"], ["environment", "commit"], ["environment", "manifest_sha256"]]) {
      const bad = structuredClone(r) as unknown as Record<string, unknown>;
      (bad[area] as Record<string, unknown>)[field] = null;
      const { receipt_sha256: _discard, ...payload } = bad; void _discard;
      await expect(sqlAppend({ ...payload, receipt_sha256: doorV44Hash(payload) })).rejects.toThrow("DOOR_EVIDENCE_INVALID");
    }
  });
  it("enforces reference existence and preserves separate assessment/approval/action rows", async () => {
    const rows = approved(); await expect(sqlAppend(rows[4])).rejects.toThrow("DOOR_EVIDENCE_CONFLICT");
    for (const r of rows) expect(await sqlAppend(r)).toEqual(r);
    const result = evaluate(rows, "publish"); const { reasons: _r, valid_until: _v, ...output } = result; void _r; void _v;
    const release = receipt("release_evaluation", { ...output, assessment_sha256: rows[3].receipt_sha256, content_approval_sha256: rows[4].receipt_sha256 }, { started_at: "2026-09-13T20:06:00Z", finished_at: "2026-09-13T20:07:00Z" });
    expect(await sqlAppend(release)).toEqual(release);
    const action = receipt("publish_action", { release_evaluation_sha256: release.receipt_sha256, content_approval_sha256: rows[4].receipt_sha256, expected_selection_revision: 0, operation_id: "test-publish", action: "publish", reason: "Synthetic workflow test only" }, { started_at: "2026-09-13T20:08:00Z", finished_at: "2026-09-13T20:09:00Z" });
    expect(await sqlAppend(action)).toEqual(action);
  });
  it("limits writes to service RPC and rejects even elevated row mutation", async () => {
    const r = base()[0];
    for (const role of ["anon", "authenticated", "service_role"]) {
      expect((await db.query("select has_table_privilege($1,'door_page_evidence','SELECT') r,has_table_privilege($1,'door_page_evidence','INSERT') w,has_function_privilege($1,'append_door_page_evidence(jsonb)','EXECUTE') x", [role])).rows[0]).toEqual({ r: role === "service_role", w: false, x: role === "service_role" });
    }
    await db.exec("set role anon"); await expect(sqlAppend(r)).rejects.toThrow(/permission denied/); await db.exec("reset role");
    await db.exec("set role service_role"); expect(await sqlAppend(r)).toEqual(r); await expect(db.exec("delete from door_page_evidence")).rejects.toThrow(/permission denied/); await db.exec("reset role");
    await sqlAppend(r); await expect(db.query("delete from door_page_evidence where receipt_sha256=$1", [r.receipt_sha256])).rejects.toThrow("DOOR_VERSION_CONFLICT immutable row");
    await expect(db.query("update door_page_evidence set kind='revocation' where receipt_sha256=$1", [r.receipt_sha256])).rejects.toThrow("DOOR_VERSION_CONFLICT immutable row");
  });
  it("appends revocation rather than mutating original evidence, with atomic audit failure", async () => {
    const r = base()[0]; const revoked = receipt("revocation", { target_receipt_sha256: r.receipt_sha256, reason_code: "TEST_REVOKED" }, { started_at: "2026-09-13T20:10:00Z", finished_at: "2026-09-13T20:11:00Z" });
    await db.exec("create function fail_evidence_audit() returns trigger language plpgsql as $$ begin raise exception 'synthetic audit failure'; end $$; create trigger fail_evidence_audit before insert on admin_audit for each row execute function fail_evidence_audit();");
    try { await expect(sqlAppend(revoked)).rejects.toThrow("synthetic audit failure"); expect((await db.query("select receipt from door_page_evidence where receipt_sha256=$1", [revoked.receipt_sha256])).rows).toEqual([]); }
    finally { await db.exec("drop trigger fail_evidence_audit on admin_audit"); }
    expect(await sqlAppend(revoked)).toEqual(revoked); expect((await db.query<{ receipt: unknown }>("select receipt from door_page_evidence where receipt_sha256=$1", [r.receipt_sha256])).rows[0].receipt).toEqual(r);
  });
});

it("file adapter persists the same immutable receipt and atomically audits it", async () => {
  temp = mkdtempSync(join(tmpdir(), "door-evidence-test-")); vi.stubEnv("PRN_DEV_DB_PATH", join(temp, "db.json"));
  const versions = doorPageVersionStore(() => null); const inputs = doorPageVersionInputStore(() => null); const store = doorPageEvidenceStore(() => null);
  const r = await versions.reserveVersion({ tenant_id: subject.tenant_id, page_id: subject.page_id, canonical_intent_id: reservation.canonical_intent_id, canonical_url: reservation.canonical_url, operation_id: "evidence-fixture", expected_latest_version: 0, ...audit });
  expect(r.reservation_id).toBe(reservation.reservation_id);
  await inputs.captureInput({ tenant_id: subject.tenant_id, page_id: subject.page_id, reservation_id: r.reservation_id, spec: fixture.spec, context: fixture.context, model_provenance: { status: "fixture_no_model_calls", fixture_id: "F04" }, ...audit });
  await versions.registerVersion({ tenant_id: subject.tenant_id, page_id: subject.page_id, reservation_id: r.reservation_id, metadata, ...audit });
  const value = base()[0]; expect(await store.appendReceipt(value)).toEqual(value); expect(await store.appendReceipt(value)).toEqual(value);
  expect(await store.getReceipt(subject.tenant_id, subject.page_id, value.receipt_sha256)).toEqual(value);
  expect(await store.getReceipt("foreign", subject.page_id, value.receipt_sha256)).toBeNull();
  expect(readDevDb().admin_audit.filter(a => a.action === "door_page_evidence_appended")).toHaveLength(1);
});

it("Supabase adapter refuses a validly hashed but wrong-scope response and unavailable writes", async () => {
  const value = base()[0]; const foreign = reissue(value, { subject: { ...subject, tenant_id: "foreign" } });
  const query = { select() { return this; }, eq() { return this; }, then(resolve: (result: { data: Array<{ receipt: DoorEvidenceReceipt }>; error: null }) => unknown) { return Promise.resolve(resolve({ data: [{ receipt: foreign }], error: null })); } };
  const client = { from: () => query, rpc: async () => ({ data: foreign, error: null }) } as unknown as ReturnType<PlatformClientProvider>;
  const store = doorPageEvidenceStore(() => client);
  await expect(store.appendReceipt(value)).rejects.toMatchObject({ code: "DOOR_EVIDENCE_CORRUPT" });
  await expect(store.listReceipts(subject.tenant_id, subject.page_id, 1)).rejects.toMatchObject({ code: "DOOR_EVIDENCE_CORRUPT" });
  const failed = doorPageEvidenceStore(() => ({ rpc: async () => ({ data: null, error: { message: "transport unavailable" } }) }) as unknown as ReturnType<PlatformClientProvider>);
  await expect(failed.appendReceipt(value)).rejects.toMatchObject({ code: "DOOR_EVIDENCE_UNAVAILABLE" });
});
