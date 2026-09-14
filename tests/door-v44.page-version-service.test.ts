import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { compileDoorV44Page, doorV44IntentReviewHash } from "@/domain/search/door-v44/compiler";
import { writeDoorV44Artifact } from "@/domain/search/door-v44/artifact-store";
import type { DoorPageVersionStore } from "@/domain/search/door-v44/page-version";
import { doorPageVersionStore } from "@/platform/search/door-page-version-store";
import { readDoorPageVersionArtifact, registerDoorPageArtifact } from "@/platform/search/door-page-version-service";
import { readDevDb } from "@/platform/stores/dev-db";
import { compilerFixture } from "./fixtures/door-v44/compiler-fixture";

let root: string;
let store: DoorPageVersionStore;
const at = "2026-09-13T19:00:00.000Z";
const actor = "system:synthetic-test";
const reason = "Offline candidate catalogue verification";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "door-page-version-service-"));
  vi.stubEnv("PRN_DEV_DB_PATH", join(root, "records.json"));
  store = doorPageVersionStore(() => null);
});
afterEach(() => {
  vi.unstubAllEnvs();
  const checked = resolve(root);
  if (!checked.startsWith(resolve(tmpdir()) + sep) || !checked.includes("door-page-version-service-")) throw new Error("unsafe fixture cleanup");
  rmSync(checked, { recursive: true, force: true });
});

async function build(version = 1) {
  const { spec, context } = await compilerFixture();
  spec.identity.page_version = version;
  context.intent_review.content_hash = doorV44IntentReviewHash(spec);
  const identity = { tenant_id: spec.identity.tenant_id, page_id: spec.identity.page_id,
    canonical_intent_id: spec.identity.canonical_intent_id, canonical_url: new URL(spec.identity.canonical_path, spec.head.site.origin).href };
  const operation_id = `synthetic-build-${version}`;
  // This real path reserves the number before invoking the compiler.
  await store.reserveVersion({ ...identity, operation_id, expected_latest_version: version - 1, actor, reason, at });
  const compiled = await compileDoorV44Page(spec, context);
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.errors));
  const artifactRoot = join(root, "artifacts");
  const written = await writeDoorV44Artifact(artifactRoot, compiled);
  if (!written.ok) throw new Error(JSON.stringify(written.errors));
  const input = { tenant_id: identity.tenant_id, page_id: identity.page_id, operation_id,
    artifact_hash: compiled.receipt.artifact_hash, actor, reason, at };
  return { artifactRoot, compiled, input, identity };
}

describe("catalogue and immutable artifact integration", () => {
  it("reserves before compilation, registers verified bytes and reads the exact candidate without publishing", async () => {
    const { artifactRoot, compiled, input } = await build();
    const version = await registerDoorPageArtifact(store, artifactRoot, input);
    const read = await readDoorPageVersionArtifact(store, artifactRoot, input.tenant_id, input.page_id, 1);
    expect(read.version).toEqual(version);
    expect(read.compiled).toEqual(compiled);
    expect(version.metadata.receipt.release_ready).toBe(false);
    expect(JSON.stringify(version)).not.toContain(artifactRoot);
    expect(readDevDb().published_page_ids).toEqual([]);
    expect(readDevDb().intent_pages).toEqual([]);
    expect(await registerDoorPageArtifact(store, artifactRoot, input)).toEqual(version);
    expect(await store.listVersions(input.tenant_id, input.page_id)).toHaveLength(1);
  });

  it("does not register a bundle without its pre-existing operation reservation", async () => {
    const { artifactRoot, input } = await build();
    await expect(registerDoorPageArtifact(store, artifactRoot, { ...input, operation_id: "not-reserved" }))
      .rejects.toMatchObject({ code: "RESERVATION_NOT_FOUND" });
    expect(await store.listVersions(input.tenant_id, input.page_id)).toEqual([]);
  });

  it("rejects another page's artifact while retaining the failed build's reservation", async () => {
    const { artifactRoot, input, identity } = await build();
    const page_id = "another-page";
    const operation_id = "other-build";
    await store.reserveVersion({ ...identity, page_id, canonical_intent_id: "other-intent", canonical_url: "https://fixture.example/problems/other",
      operation_id, expected_latest_version: 0, actor, reason, at });
    await expect(registerDoorPageArtifact(store, artifactRoot, { ...input, page_id, operation_id }))
      .rejects.toMatchObject({ code: "RESERVATION_ARTIFACT_MISMATCH" });
    expect(await store.getReservation(input.tenant_id, page_id, operation_id)).toMatchObject({ page_version: 1 });
    expect(await store.listVersions(input.tenant_id, page_id)).toEqual([]);
  });

  it("does not replace version one when a subsequent candidate is compiled and registered", async () => {
    const first = await build();
    await registerDoorPageArtifact(store, first.artifactRoot, first.input);
    const second = await build(2);
    await registerDoorPageArtifact(store, second.artifactRoot, second.input);
    expect(second.compiled.receipt.artifact_hash).not.toEqual(first.compiled.receipt.artifact_hash);
    const read = await readDoorPageVersionArtifact(store, first.artifactRoot, first.input.tenant_id, first.input.page_id, 1);
    expect(read.compiled.html).toBe(first.compiled.html);
    expect(await store.listVersions(first.input.tenant_id, first.input.page_id)).toHaveLength(2);
  });

  it("rejects missing versions and foreign tenant reads without falling back to another version", async () => {
    const { artifactRoot, input } = await build();
    await registerDoorPageArtifact(store, artifactRoot, input);
    await expect(readDoorPageVersionArtifact(store, artifactRoot, input.tenant_id, input.page_id, 2))
      .rejects.toMatchObject({ code: "VERSION_NOT_FOUND" });
    await expect(readDoorPageVersionArtifact(store, artifactRoot, "other-tenant", input.page_id, 1))
      .rejects.toMatchObject({ code: "VERSION_NOT_FOUND" });
  });

  it("re-verifies bundle bytes after registration instead of trusting a prior successful read", async () => {
    const { artifactRoot, input } = await build();
    await registerDoorPageArtifact(store, artifactRoot, input);
    const file = join(artifactRoot, "bundles", input.artifact_hash, "index.html");
    writeFileSync(file, readFileSync(file, "utf8") + "<!-- modified -->");
    await expect(readDoorPageVersionArtifact(store, artifactRoot, input.tenant_id, input.page_id, 1))
      .rejects.toMatchObject({ code: "ARTIFACT_UNAVAILABLE" });
    await expect(registerDoorPageArtifact(store, artifactRoot, input)).rejects.toMatchObject({ code: "ARTIFACT_UNAVAILABLE" });
    expect(await store.listVersions(input.tenant_id, input.page_id)).toHaveLength(1);
  });

  it("rejects metadata substitution even when a valid bundle exists", async () => {
    const { artifactRoot, input } = await build();
    const version = await registerDoorPageArtifact(store, artifactRoot, input);
    const substituted = structuredClone(version);
    substituted.metadata.receipt.html_hash = "0".repeat(64);
    const altered = Object.create(store) as DoorPageVersionStore;
    altered.getVersion = async () => substituted;
    await expect(readDoorPageVersionArtifact(altered, artifactRoot, input.tenant_id, input.page_id, 1))
      .rejects.toMatchObject({ code: "VERSION_ARTIFACT_MISMATCH" });
  });

  it("captures the requested artifact before asynchronous store access", async () => {
    const { artifactRoot, input } = await build();
    const request = { ...input };
    const pending = registerDoorPageArtifact(store, artifactRoot, request);
    request.artifact_hash = "0".repeat(64);
    await expect(pending).resolves.toMatchObject({ metadata: { receipt: { artifact_hash: input.artifact_hash } } });
  });

  it("rejects a foreign reservation returned by an adapter before registering an artifact", async () => {
    const { artifactRoot, input } = await build();
    const reservation = await store.getReservation(input.tenant_id, input.page_id, input.operation_id);
    const altered = Object.create(store) as DoorPageVersionStore;
    altered.getReservation = async () => ({ ...reservation!, tenant_id: "foreign-tenant" });
    await expect(registerDoorPageArtifact(altered, artifactRoot, input)).rejects.toMatchObject({ code: "RESERVATION_ARTIFACT_MISMATCH" });
    expect(await store.listVersions(input.tenant_id, input.page_id)).toEqual([]);
  });

  it.each(["tenant_id", "page_id", "page_version"] as const)("rejects an adapter row whose %s differs from the requested version", async key => {
    const { artifactRoot, input } = await build();
    const version = await registerDoorPageArtifact(store, artifactRoot, input);
    const altered = Object.create(store) as DoorPageVersionStore;
    altered.getVersion = async () => ({ ...version, [key]: key === "page_version" ? 2 : "foreign" });
    await expect(readDoorPageVersionArtifact(altered, artifactRoot, input.tenant_id, input.page_id, 1))
      .rejects.toMatchObject({ code: "VERSION_ARTIFACT_MISMATCH" });
  });
});
