import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { DEFAULT_TENANT_ID } from "@/domain/problem/contracts";
import { compileDoorV44Page } from "@/domain/search/door-v44/compiler";
import { doorV44Hash } from "@/domain/search/door-v44/schema-engine";
import { doorPageMetadataSchema, type DoorPageVersion, type DoorPageVersionReservation } from "@/domain/search/door-v44/page-version";
import { prepareDoorPageVersionInput, type DoorPageVersionInputRecord } from "@/domain/search/door-v44/page-version-input";
import { issueDoorEvidenceReceipt, type DoorEvidencePayload, type DoorEvidenceReceipt } from "@/domain/search/door-v44/release-evidence";
import type { DoorV44PublicSelection } from "@/platform/pages/door-v44-public-response";
import { loadDoorCreatorDetail, loadDoorCreatorOverview, loadDoorTemplateKitView, doorTemplateDocument, type DoorCreatorReadDependencies } from "@/platform/admin/door-creator";
import { compilerFixture } from "./fixtures/door-v44/compiler-fixture";

let built: DoorPageVersion, saved: DoorPageVersionInputRecord, identity: Awaited<ReturnType<DoorCreatorReadDependencies["identities"]>>[number];
const at = "2026-09-13T20:00:00.000Z", H = "a".repeat(64);
beforeAll(async () => {
  const { spec, context } = await compilerFixture();
  spec.identity.tenant_id = DEFAULT_TENANT_ID;
  context.validation.tenant_id = DEFAULT_TENANT_ID;
  for (const group of [context.validation.pages, context.validation.eligibilities, context.validation.visual_assets]) for (const row of group) row.tenant_id = DEFAULT_TENANT_ID;
  const reserve = { tenant_id: DEFAULT_TENANT_ID, page_id: spec.identity.page_id, canonical_intent_id: spec.identity.canonical_intent_id,
    canonical_path: spec.identity.canonical_path, canonical_url: new URL(spec.identity.canonical_path, context.validation.origin).href,
    operation_id: "synthetic-owner-review", expected_latest_version: 0, page_version: 1, actor: "system:synthetic-test", reason: "Offline owner read model test", reserved_at: at };
  const reservation: DoorPageVersionReservation = { ...reserve, reservation_id: doorV44Hash({ tenant_id: reserve.tenant_id, page_id: reserve.page_id, operation_id: reserve.operation_id }) };
  saved = prepareDoorPageVersionInput({ tenant_id: reservation.tenant_id, page_id: reservation.page_id, reservation_id: reservation.reservation_id,
    spec, context, model_provenance: { status: "fixture_no_model_calls", fixture_id: "F04" }, actor: reservation.actor, reason: reservation.reason, at }, reservation).record;
  const compiled = await compileDoorV44Page(saved.spec, saved.context);
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.errors));
  built = { tenant_id: reservation.tenant_id, page_id: reservation.page_id, page_version: 1, reservation_id: reservation.reservation_id,
    metadata: doorPageMetadataSchema.parse({ receipt: compiled.receipt, receipt_sha256: doorV44Hash(compiled.receipt), provenance_status: "unattested", build_provenance_sha256: null }),
    actor: reservation.actor, reason: reservation.reason, registered_at: at };
  identity = { tenant_id: reserve.tenant_id, page_id: reserve.page_id, canonical_intent_id: reserve.canonical_intent_id, canonical_url: reserve.canonical_url, canonical_path: reserve.canonical_path, latest_version: 2 };
});
function deps(overrides: Partial<DoorCreatorReadDependencies> = {}): DoorCreatorReadDependencies {
  return {
    identities: vi.fn(async () => [structuredClone(identity)]), versions: vi.fn(async () => [structuredClone(built)]),
    input: vi.fn(async () => structuredClone(saved)), evidence: vi.fn(async () => []), serving: vi.fn(async () => { throw new Error("PRIVATE HOST DETAIL"); }),
    artifactRoot: () => resolve("artifacts", "owner-read-model-test"), now: () => Date.parse("2026-09-13T21:00:00Z"), ...overrides,
  };
}
function receipt(overrides: Partial<DoorEvidencePayload> = {}): DoorEvidenceReceipt {
  return issueDoorEvidenceReceipt({ format: "door-v44-evidence/1.0.0", kind: "artifact_integrity",
    subject: { tenant_id: DEFAULT_TENANT_ID, page_id: built.page_id, page_version: built.page_version, reservation_id: built.reservation_id,
      input_sha256: saved.input_sha256, artifact_hash: built.metadata.receipt.artifact_hash, compile_receipt_sha256: built.metadata.receipt_sha256 },
    producer: { id: "test-producer", version: "1", implementation_sha256: H, run_id: "test-run", actor_id: "system-test", actor_kind: "system", trust_scope: "synthetic_test" },
    environment: { id: "test", manifest_sha256: H, commit: "a".repeat(40), origin: "https://fixture.example" }, dependencies: [],
    started_at: at, finished_at: "2026-09-13T20:01:00Z", expires_at: "2026-09-13T22:00:00Z", verdict: "PASS", findings: [], attachments: [],
    output: { artifact_read_verified: true, semantic_verified: true, input_verified: true }, ...overrides } as DoorEvidencePayload);
}

describe("owner saved-version read models", () => {
  it("discovers real identities without exposing tenant or compiler context", async () => {
    const view = await loadDoorCreatorOverview(deps());
    expect(view).toEqual({ status: "ready", pages: [{ page_id: built.page_id, canonical_intent_id: identity.canonical_intent_id, canonical_path: identity.canonical_path, latest_version: 2 }] });
  });
  it("distinguishes empty catalogue from failed or foreign catalogue", async () => {
    expect(await loadDoorCreatorOverview(deps({ identities: async () => [] }))).toEqual({ status: "ready", pages: [] });
    for (const identities of [async () => { throw new Error("PRIVATE DATABASE DETAIL"); }, async () => [{ ...identity, tenant_id: "foreign" }], async () => [identity, identity]]) {
      expect(await loadDoorCreatorOverview(deps({ identities }))).toEqual({ status: "unavailable", pages: [] });
    }
  });
  it("shows newest registered build while retaining the later unbuilt reservation", async () => {
    const view = await loadDoorCreatorDetail(built.page_id, undefined, deps());
    expect(view).toMatchObject({ status: "ready", page: { latest_version: 2 }, selected: { page_version: 1, mode: "fixture", artifact_hash: built.metadata.receipt.artifact_hash }, input: { status: "saved", model_status: "fixture_no_model_calls" } });
    expect(view.selected?.preview_href).toBe(`/admin/page-creator/${built.page_id}/versions/1/preview`);
    expect(view.input.assignments).toContainEqual({ label: "template_version", value: "door-v44.0.0" });
    expect(JSON.stringify(view)).not.toMatch(/raster_base64|asset_records|disclosure_text|source_records|PRIVATE HOST DETAIL/);
    expect(view.serving.status).toBe("unavailable");
  });
  it.each(["2", "3", "01", "0", "-1", "1e0", "2147483647", "1/preview", ""])("never falls back from explicit missing or invalid version %s", async version => {
    expect((await loadDoorCreatorDetail(built.page_id, version, deps())).status).toBe("not_found");
  });
  it("rejects an unsafe page before any storage access", async () => {
    const d = deps();
    expect((await loadDoorCreatorDetail("../foreign", undefined, d)).status).toBe("not_found");
    expect(d.identities).not.toHaveBeenCalled();
  });
  it("retains a reserved page with no build rather than inventing a version", async () => {
    const view = await loadDoorCreatorDetail(built.page_id, undefined, deps({ versions: async () => [] }));
    expect(view).toMatchObject({ status: "ready", page: { latest_version: 2 }, versions: [], selected: null });
  });
  it("rejects mismatched and duplicate version history", async () => {
    for (const versions of [async () => [built, built], async () => [{ ...built, tenant_id: "foreign" }], async () => [{ ...built, page_version: 2 }]]) {
      expect((await loadDoorCreatorDetail(built.page_id, undefined, deps({ versions }))).status).toBe("unavailable");
    }
  });
  it.each([undefined, "relative/artifacts"])("omits preview link when owned artifact storage is unconfigured: %s", async root => {
    expect((await loadDoorCreatorDetail(built.page_id, "1", deps({ artifactRoot: () => root }))).selected?.preview_href).toBeNull();
  });
  it("keeps missing inputs separate from adapter failures and mismatched bindings", async () => {
    expect((await loadDoorCreatorDetail(built.page_id, "1", deps({ input: async () => null }))).input.status).toBe("missing");
    for (const input of [async () => { throw new Error("PRIVATE INPUT DETAIL"); }, () => { throw new Error("PRIVATE SYNC DETAIL"); }, async () => ({ ...saved, reservation_id: H })]) {
      const view = await loadDoorCreatorDetail(built.page_id, "1", deps({ input }));
      expect(view.status).toBe("ready"); expect(view.input.status).toBe("unavailable"); expect(view.selected?.page_version).toBe(1);
      expect(JSON.stringify(view)).not.toContain("PRIVATE");
    }
  });
  it("shows synthetic PASS as recorded evidence with time status, never approval", async () => {
    const r = receipt();
    const view = await loadDoorCreatorDetail(built.page_id, "1", deps({ evidence: async () => [r] }));
    expect(view.evidence).toMatchObject({ status: "ready", rows: [{ verdict: "PASS", trust_scope: "synthetic_test", time_status: "current", model_id: null, cost_usd: null }] });
    expect(JSON.stringify(view)).not.toContain('"eligible":true');
  });
  it.each([["2026-09-13T20:00:00Z", "future"], ["2026-09-13T22:00:00Z", "expired"]])("describes evidence at %s as %s", async (now, status) => {
    const view = await loadDoorCreatorDetail(built.page_id, "1", deps({ evidence: async () => [receipt()], now: () => Date.parse(now) }));
    expect(view.evidence.rows[0]?.time_status).toBe(status);
  });
  it("refuses mismatched, duplicate or corrupt evidence without reporting an empty success", async () => {
    const r = receipt();
    for (const rows of [[r, r], [{ ...r, receipt_sha256: H }], [receipt({ subject: { ...r.subject, artifact_hash: H } })]]) {
      expect((await loadDoorCreatorDetail(built.page_id, "1", deps({ evidence: async () => rows }))).evidence).toEqual({ status: "unavailable", rows: [] });
    }
  });
  it("does not make up a model spend total from a compilation receipt", async () => {
    const view = await loadDoorCreatorDetail(built.page_id, "1", deps());
    expect(view.input.models).toEqual([]); expect(view.evidence.rows).toEqual([]);
    expect(JSON.stringify(view)).not.toContain('"cost_usd":"0"');
  });
  it("shows current serving guard independently from selected draft version", async () => {
    const selection = { snapshot: { tenant_id: DEFAULT_TENANT_ID, guard_status: "unconfigured", as_of: at }, entries: [] } as unknown as DoorV44PublicSelection;
    const view = await loadDoorCreatorDetail(built.page_id, "1", deps({ serving: async () => selection }));
    expect(view.serving).toEqual({ status: "ready", guard_status: "unconfigured", page_version: null, as_of: at });
    expect(view.selected?.page_version).toBe(1);
  });
});

describe("checked-in template inspection", () => {
  it("keeps three identities distinct, exposes real order and no invented theme approvals", async () => {
    const view = await loadDoorTemplateKitView();
    expect(view).toMatchObject({ baseline: "ac-v43", template_version: "door-v44.0.0", schema_version: "doorspec/2.0.0", order_profile: "order-b" });
    expect(view.order.slice(0, 2)).toEqual(["HERO", "INTAKE"]); expect(view.theme_slots).toHaveLength(10);
    expect(view.theme_slots.every(row => row.status === "not_registered")).toBe(true);
    expect(view.constants.find(row => row.key === "intake_duration")?.value).toBe("Takes 1 to 5 minutes");
  });
  it("downloads only named contracts with exact response-body hashes", async () => {
    for (const doc of (await loadDoorTemplateKitView()).documents) {
      const actual = doorTemplateDocument(doc.id)!;
      expect(actual.sha256).toBe(doc.sha256); expect(createHash("sha256").update(actual.body).digest("hex")).toBe(doc.sha256);
      expect(JSON.parse(actual.body)).toBeTypeOf("object");
    }
    for (const id of ["../.env", "__proto__", "constructor", "README", "compatibility.json"]) expect(doorTemplateDocument(id)).toBeNull();
  });
});
