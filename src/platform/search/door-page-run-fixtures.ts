import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readdir } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { z } from "zod";
import { DEFAULT_TENANT_ID } from "@/domain/problem/contracts";
import { doorV44Hash } from "@/domain/search/door-v44/schema-engine";
import { loadDoorV44Spec } from "@/domain/search/door-v44/loader";
import { doorPageCompilerContextSchema } from "@/domain/search/door-v44/page-version-input";
import type { DoorV44Spec } from "@/domain/search/door-v44/types";
import type { DoorV44CompilerContext } from "@/domain/search/door-v44/compiler-types";
import { DOOR_FIXTURE_PACKAGE_SHA256 } from "./door-page-run-fixture-pin";

export const DOOR_FIXTURE_IDS = ["F01", "F02", "F03", "F04", "F05", "F06", "F07", "F08", "F09", "F10", "F11"] as const;
export type DoorFixtureId = typeof DOOR_FIXTURE_IDS[number];
export const DOOR_FIXTURE_EXECUTOR_VERSION = "door-fixture-executor-1.0.0";
const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const row = z.object({ fixture_id: z.enum(DOOR_FIXTURE_IDS), label: z.string().min(1).max(100), path: z.string(), sha256: hash, bytes: z.number().int().min(1).max(8 * 1024 * 1024) }).strict();
const source = z.object({ path: z.string(), raw_sha256: hash, lf_sha256: hash, crlf_sha256: hash }).strict();
const manifestSchema = z.object({ format: z.literal("door-fixture-package/1.0.0"), executor_version: z.literal(DOOR_FIXTURE_EXECUTOR_VERSION), executor_sha256: hash,
  provenance: z.literal("synthetic_nonpublic_no_review_or_execution_attestation"), fixtures: z.array(row).length(11), sources: z.array(source).min(2).max(300) }).strict();
const diagnostic = z.object({ code: z.string().regex(/^[A-Z][A-Z0-9_]{0,127}$/), pointer: z.string().max(512).regex(/^(?:\/[A-Za-z0-9_~./-]*)?$/) }).strict();
const blockedSchema = z.object({ fixture_id: z.literal("F01"), status: z.literal("BLOCKED_CONTROL_DERIVATIVE"), candidate_hash: hash, source_pin_hash: hash, report_sha256: hash,
  diagnostics: z.array(diagnostic).min(1).max(100), release_ready: z.literal(false), compiler_pass: z.literal(false) }).strict();
export type DoorFixtureBlockedReport = z.infer<typeof blockedSchema>;
export class DoorFixturePackageError extends Error { constructor(readonly code: "FIXTURE_PACKAGE_UNAVAILABLE" | "FIXTURE_PACKAGE_DRIFT" | "FIXTURE_PACKAGE_INVALID") { super(code); } }
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

async function bytes(path: string, maximum = 8 * 1024 * 1024): Promise<Buffer> {
  const before = await lstat(path);
  if (!before.isFile() || before.isSymbolicLink() || before.size > maximum) throw new DoorFixturePackageError("FIXTURE_PACKAGE_INVALID");
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try { const stat = await file.stat(); if (stat.ino !== before.ino || stat.dev !== before.dev || stat.size !== before.size) throw new DoorFixturePackageError("FIXTURE_PACKAGE_INVALID");
    const value = await file.readFile(); if (value.length !== before.size) throw new DoorFixturePackageError("FIXTURE_PACKAGE_INVALID"); return value;
  } finally { await file.close(); }
}

/** Entire fixed package AND shipped execution source closure are checked before
 * returning any case. Source LF/CRLF representations are separately pinned.
 * These are source-byte observations, never proof of hosted execution or review.
 * repositoryRoot is trusted server/test configuration, never request input. */
export async function loadDoorFixturePackage(repositoryRoot = process.cwd()) {
  try {
    if (!isAbsolute(repositoryRoot)) throw new DoorFixturePackageError("FIXTURE_PACKAGE_INVALID");
    const root = resolve(repositoryRoot), directory = join(root, "content/door-v44-fixtures/v1");
    const directoryStat = await lstat(directory);
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) throw new DoorFixturePackageError("FIXTURE_PACKAGE_INVALID");
    const rawManifest = await bytes(join(directory, "manifest.json"));
    if (digest(rawManifest) !== DOOR_FIXTURE_PACKAGE_SHA256) throw new DoorFixturePackageError("FIXTURE_PACKAGE_DRIFT");
    const manifest = manifestSchema.parse(JSON.parse(rawManifest.toString("utf8")));
    if (manifest.fixtures.some((f, i) => f.fixture_id !== DOOR_FIXTURE_IDS[i] || f.path !== f.fixture_id.toLowerCase() + ".json")
      || new Set(manifest.sources.map(s => s.path)).size !== manifest.sources.length
      || doorV44Hash(manifest.sources) !== manifest.executor_sha256) throw new DoorFixturePackageError("FIXTURE_PACKAGE_INVALID");
    const inventory = (await readdir(directory)).sort();
    if (JSON.stringify(inventory) !== JSON.stringify(["manifest.json", ...manifest.fixtures.map(f => f.path)].sort())) throw new DoorFixturePackageError("FIXTURE_PACKAGE_INVALID");
    for (const file of manifest.sources) {
      if (!/^(?:src\/[A-Za-z0-9_./-]+\.tsx?|content\/door-template\/[A-Za-z0-9_./-]+\.json|package(?:-lock)?\.json)$/.test(file.path) || file.path.split("/").includes("..")) throw new DoorFixturePackageError("FIXTURE_PACKAGE_INVALID");
      if (![file.raw_sha256, file.lf_sha256, file.crlf_sha256].includes(digest(await bytes(join(root, file.path), 16 * 1024 * 1024)))) throw new DoorFixturePackageError("FIXTURE_PACKAGE_DRIFT");
    }
    const inputs = new Map<DoorFixtureId, { spec: DoorV44Spec; context: DoorV44CompilerContext }>();
    let blocked: DoorFixtureBlockedReport | undefined;
    for (const file of manifest.fixtures) {
      const data = await bytes(join(directory, file.path));
      if (data.length !== file.bytes || digest(data) !== file.sha256) throw new DoorFixturePackageError("FIXTURE_PACKAGE_DRIFT");
      const decoded: unknown = JSON.parse(data.toString("utf8"));
      if (file.fixture_id === "F01") { blocked = blockedSchema.parse(decoded); continue; }
      const parsed = z.object({ fixture_id: z.literal(file.fixture_id), spec: z.unknown(), context: doorPageCompilerContextSchema }).strict().parse(decoded);
      if (parsed.context.validation.mode !== "fixture" || parsed.context.validation.index_policy !== "staged_noindex" || parsed.context.validation.approved_content_at !== null) throw new DoorFixturePackageError("FIXTURE_PACKAGE_INVALID");
      const loaded = loadDoorV44Spec(parsed.spec, parsed.context.validation);
      if (!loaded.ok || loaded.spec.identity.family_id !== file.fixture_id) throw new DoorFixturePackageError("FIXTURE_PACKAGE_INVALID");
      inputs.set(file.fixture_id, { spec: loaded.spec, context: parsed.context });
    }
    if (!blocked) throw new DoorFixturePackageError("FIXTURE_PACKAGE_INVALID");
    return { manifest, sha256: DOOR_FIXTURE_PACKAGE_SHA256, inputs, blocked };
  } catch (error) { if (error instanceof DoorFixturePackageError) throw error; throw new DoorFixturePackageError((error as NodeJS.ErrnoException)?.code ? "FIXTURE_PACKAGE_UNAVAILABLE" : "FIXTURE_PACKAGE_INVALID"); }
}
export async function getDoorFixturePackage(repositoryRoot?: string) {
  const loaded = await loadDoorFixturePackage(repositoryRoot);
  return { sha256: loaded.sha256, executor_version: loaded.manifest.executor_version, executor_sha256: loaded.manifest.executor_sha256,
    fixtures: loaded.manifest.fixtures.map(({ fixture_id, label }) => ({ fixture_id, label })) };
}

export function doorFixtureIdentity(run_id: string, fixture_id: DoorFixtureId) {
  id.parse(run_id); z.enum(DOOR_FIXTURE_IDS).parse(fixture_id);
  const page_id = "fixture_" + doorV44Hash({ tenant_id: DEFAULT_TENANT_ID, run_id }).slice(0, 24) + "_" + fixture_id.toLowerCase();
  return { page_id, operation_id: page_id + "_v1", canonical_intent_id: page_id + ".intent", opportunity_id: page_id + ".opportunity", intent_cluster_id: page_id + ".cluster",
    canonical_path: "/problems/" + page_id.replaceAll("_", "-") };
}

/** Remap identity/reference fields, never freeform copy or synthetic review data. */
export function assembleDoorFixture(input: { spec: DoorV44Spec; context: DoorV44CompilerContext }, run_id: string, fixture_id: DoorFixtureId, packageHash: string, executorHash: string) {
  const { spec, context } = structuredClone(input), identity = doorFixtureIdentity(run_id, fixture_id), old = spec.identity;
  const values = new Map([[old.page_id, identity.page_id], [old.canonical_intent_id, identity.canonical_intent_id], [old.opportunity_id, identity.opportunity_id], [old.intent_cluster_id, identity.intent_cluster_id]]);
  const identityKeys = new Set(["page_id", "canonical_intent_id", "opportunity_id", "search_opportunity_id", "intent_cluster_id"]);
  function remap(value: unknown): void {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (key === "tenant_id" && typeof child === "string") (value as Record<string, unknown>)[key] = DEFAULT_TENANT_ID;
      else if (identityKeys.has(key) && typeof child === "string" && values.has(child)) (value as Record<string, unknown>)[key] = values.get(child)!;
      else remap(child);
    }
  }
  remap(spec); remap(context);
  spec.identity.page_version = 1; spec.identity.slug = identity.canonical_path.slice("/problems/".length); spec.identity.canonical_path = identity.canonical_path;
  spec.intake.attribution.landing_path = identity.canonical_path;
  const page = context.validation.pages.find(p => p.page_id === identity.page_id);
  if (!page) throw new DoorFixturePackageError("FIXTURE_PACKAGE_INVALID");
  page.canonical_path = identity.canonical_path;
  context.validation.input_hashes.fixture_package_sha256 = hash.parse(packageHash);
  context.validation.input_hashes.fixture_executor_sha256 = hash.parse(executorHash);
  return { spec, context };
}
