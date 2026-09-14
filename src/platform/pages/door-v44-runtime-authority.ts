import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { z } from "zod";
import { doorReleasePolicySchema, type DoorReleaseFence, type DoorReleasePolicy } from "@/domain/search/door-v44/release-evidence";
import { doorV44Hash, isPlainDoorJson } from "@/domain/search/door-v44/schema-engine";
import { AiPolicy, DEFAULT_AI_POLICY } from "@/platform/ai/policy";
import { FEATURES, FEATURE_DECISION_REF } from "@/platform/features/registry";
import { featureIsLive, type FeatureSnapshot } from "@/platform/features/state";

/** Source locators are versioned server configuration, never request parameters.
 * A current-records file is an operational authority inventory, not a review or
 * an approval. Its operator must maintain source/capability revocations; there is
 * no general external revocation feed in this repository. Missing files refuse. */
export const DOOR_AUTHORITY_REPOSITORY_INPUTS = {
  compiler: ["src/domain/search/door-v44"],
  schema: ["content/door-template/v44/schemas"],
  template: ["content/door-template/v44/contracts"],
  taxonomy: ["content/door-template/v44/taxonomy"],
  wording: ["content/door-template/v44/wording"],
  prompt: ["src/platform/ai", "src/platform/search/ai-page-copy.ts", "src/platform/search/page-qa-critic.ts", "src/platform/search/door-page-critic.ts"],
  fixture_corpus: ["tests/fixtures/door-v44"],
  theme: ["content/door-template/v44/contracts/classes.json", "content/door-template/v44/inputs/sources/vault-approved-v43.html"],
  disclosure: ["src/domain/privacy/disclosures.ts"],
} as const;
const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,149}$/);
const counter = z.number().int().min(0).max(2147483646);
const locator = z.discriminatedUnion("type", [
  z.object({ type: z.literal("repository"), kind: z.enum(["compiler", "schema", "template", "taxonomy", "wording", "prompt", "fixture_corpus", "theme", "disclosure"]), id, version: id }).strict(),
  z.object({ type: z.literal("current_records"), kind: z.enum(["source", "capability"]), id, version: id, path: z.string().min(1).max(4096) }).strict(),
  z.object({ type: z.literal("runtime"), kind: z.enum(["feature_state", "ai_policy"]), id, version: id }).strict(),
]);
export const doorRuntimeAuthoritySchema = z.object({
  format: z.literal("door-v44-runtime-authority/1.0.0"), tenant_id: id,
  revision: counter, dependency_revision: counter, hold_revision: counter,
  public_publish_hold: z.boolean(), policy: doorReleasePolicySchema,
  locators: z.array(locator).length(13),
}).strict();
export type DoorRuntimeAuthorityManifest = z.infer<typeof doorRuntimeAuthoritySchema>;
const currentRecords = z.object({ format: z.literal("door-v44-current-records/1.0.0"), tenant_id: id,
  kind: z.enum(["source", "capability"]), version: id,
  records: z.array(z.object({ id, version: id, status: z.enum(["active", "revoked"]), value: z.unknown() }).strict()).min(1).max(1000),
}).strict();
export interface DoorRuntimeAuthorityConfig {
  authorityPath: string; artifactRoot: string; origin: string; commit: string; repositoryRoot: string;
  aiPolicyPaths: string[];
}
export type DoorRuntimeAuthority = { ok: true; fence: DoorReleaseFence; policy: DoorReleasePolicy; policy_sha256: string;
  artifactRoot: string; origin: string } | { ok: false; code: "DOOR_AUTHORITY_UNAVAILABLE" };
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const within = (root: string, path: string) => { const r = relative(root, path); return r === "" || (!r.startsWith(`..${sep}`) && r !== ".." && !isAbsolute(r)); };

async function ownedPath(path: string, directory: boolean): Promise<string> {
  if (!isAbsolute(path) || resolve(path) !== path) throw new Error("Invalid authority path");
  let cursor = path;
  for (;;) {
    const stat = await lstat(cursor);
    if (stat.isSymbolicLink()) throw new Error("Authority symlink");
    if (cursor === path && (directory ? !stat.isDirectory() : !stat.isFile())) throw new Error("Invalid authority kind");
    const parent = dirname(cursor); if (parent === cursor) break; cursor = parent;
  }
  if (resolve(await realpath(path)) !== path) throw new Error("Authority path changed");
  return path;
}
async function jsonFile(path: string): Promise<unknown> {
  await ownedPath(path, false);
  const stat = await lstat(path); if (stat.size > 8 * 1024 * 1024) throw new Error("Authority too large");
  const raw: unknown = JSON.parse(await readFile(path, "utf8"));
  if (!isPlainDoorJson(raw)) throw new Error("Invalid authority JSON");
  return raw;
}

/** Digest the actual sorted path/byte inventory, including additions/deletions.
 * Fixed repository roots prevent a locator relabelling arbitrary text 'compiler'. */
export async function doorAuthorityRepositoryDigest(repositoryRoot: string, kind: keyof typeof DOOR_AUTHORITY_REPOSITORY_INPUTS): Promise<string> {
  await ownedPath(repositoryRoot, true);
  const files: Array<{ path: string; sha256: string }> = [];
  let bytes = 0;
  const visit = async (path: string): Promise<void> => {
    if (!within(repositoryRoot, path) || files.length > 5000) throw new Error("Authority inventory boundary");
    const stat = await lstat(path); if (stat.isSymbolicLink()) throw new Error("Authority symlink");
    if (stat.isDirectory()) { for (const name of (await readdir(path)).sort()) await visit(join(path, name)); }
    else {
      if (!stat.isFile() || stat.size > 16 * 1024 * 1024 || (bytes += stat.size) > 64 * 1024 * 1024) throw new Error("Authority inventory boundary");
      const data = await readFile(path);
      files.push({ path: relative(repositoryRoot, path).split(sep).join("/"), sha256: sha(data) });
    }
  };
  for (const path of DOOR_AUTHORITY_REPOSITORY_INPUTS[kind]) {
    const absolute = join(repositoryRoot, path); const stat = await lstat(absolute);
    await ownedPath(absolute, stat.isDirectory()); await visit(absolute);
  }
  if (!files.length) throw new Error("Empty authority inventory");
  return doorV44Hash(files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
export function doorAuthorityFeatureDigest(features: FeatureSnapshot): string {
  if (!features.verified || [...features.rows].some(([id, row]) => row.tenant_id !== features.tenant_id || row.feature_id !== id)) throw new Error("Unverified features");
  return doorV44Hash({ tenant_id: features.tenant_id, registry: FEATURES, decision_ref: FEATURE_DECISION_REF,
    rows: [...features.rows.values()].sort((a, b) => a.feature_id < b.feature_id ? -1 : a.feature_id > b.feature_id ? 1 : 0) });
}
async function strictAiPolicy(paths: string[]): Promise<AiPolicy> {
  for (const path of paths) {
    try { return AiPolicy.parse(await jsonFile(path)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  // This is the actual policy-store contract for an absent file. Corrupt and
  // unreadable files above do NOT use that fallback in publication authority.
  return DEFAULT_AI_POLICY;
}
export function doorAuthorityEnvironment(config: DoorRuntimeAuthorityConfig, tenantId: string, id: string) {
  return { id, commit: config.commit, origin: config.origin,
    manifest_sha256: doorV44Hash({ format: "door-v44-deployment/1.0.0", tenant_id: tenantId, commit: config.commit,
      origin: config.origin, artifact_root: config.artifactRoot, node: process.versions.node }) };
}

/** Fresh read; no cache and no persisted fence echo. Every declared digest must
 * match the actual input. A failed observation grants no managed membership. */
export async function readDoorRuntimeAuthority(features: FeatureSnapshot, config: DoorRuntimeAuthorityConfig): Promise<DoorRuntimeAuthority> {
  try {
    const origin = new URL(config.origin);
    if (origin.origin !== config.origin || origin.protocol !== "https:" || !/^[a-f0-9]{40}$/.test(config.commit)) throw new Error("Invalid environment");
    await ownedPath(config.artifactRoot, true);
    const raw = await jsonFile(config.authorityPath), manifest = doorRuntimeAuthoritySchema.parse(raw);
    if (manifest.tenant_id !== features.tenant_id || new Set(manifest.locators.map(row => row.kind)).size !== 13) throw new Error("Authority scope");
    const actual = await Promise.all(manifest.locators.map(async source => {
      let sha256: string;
      if (source.type === "repository") sha256 = await doorAuthorityRepositoryDigest(config.repositoryRoot, source.kind);
      else if (source.type === "runtime" && source.kind === "feature_state") sha256 = doorAuthorityFeatureDigest(features);
      else if (source.type === "runtime") {
        const policy = await strictAiPolicy(config.aiPolicyPaths);
        if (policy.tenant_id !== features.tenant_id || source.version !== String(policy.version)) throw new Error("AI policy scope");
        sha256 = doorV44Hash(policy);
      } else {
        const records = currentRecords.parse(await jsonFile(source.path));
        if (records.kind !== source.kind || records.tenant_id !== manifest.tenant_id || records.version !== source.version
          || new Set(records.records.map(row => row.id)).size !== records.records.length) throw new Error("Current records scope");
        sha256 = doorV44Hash(records);
      }
      return { kind: source.kind, id: source.id, version: source.version, sha256 };
    }));
    actual.sort((a, b) => `${a.kind}/${a.id}` < `${b.kind}/${b.id}` ? -1 : 1);
    const environment = doorAuthorityEnvironment(config, manifest.tenant_id, manifest.policy.environment.id);
    const holds = { public_publish: manifest.public_publish_hold, door_pages_live: featureIsLive(features, "door_pages"), trial_noindex: true as const };
    if (doorV44Hash(actual) !== doorV44Hash(manifest.policy.dependencies) || doorV44Hash(environment) !== doorV44Hash(manifest.policy.environment)
      || doorV44Hash(holds) !== doorV44Hash(manifest.policy.holds)) throw new Error("Stale authority");
    // Catch concurrent authority replacement during the individual input reads.
    if (doorV44Hash(await jsonFile(config.authorityPath)) !== doorV44Hash(raw)) throw new Error("Authority changed");
    return { ok: true, origin: config.origin, artifactRoot: config.artifactRoot, policy: manifest.policy, policy_sha256: doorV44Hash(manifest.policy),
      fence: { revision: manifest.revision, dependency_revision: manifest.dependency_revision, hold_revision: manifest.hold_revision,
        dependencies_sha256: doorV44Hash(actual), environment_sha256: doorV44Hash(environment), holds_sha256: doorV44Hash(holds) } };
  } catch { return { ok: false, code: "DOOR_AUTHORITY_UNAVAILABLE" }; }
}

export function doorRuntimeAuthorityConfig(): DoorRuntimeAuthorityConfig {
  return { authorityPath: process.env.PRN_DOOR_V44_AUTHORITY_PATH ?? "", artifactRoot: process.env.PRN_DOOR_V44_ARTIFACT_ROOT ?? "",
    origin: process.env.PRN_DOOR_V44_ORIGIN ?? "", commit: process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.PRN_DOOR_V44_COMMIT ?? "",
    repositoryRoot: process.cwd(), aiPolicyPaths: [...(process.env.VERCEL ? [resolve("/tmp/prn-runtime/ai-policy.json")] : []), join(process.cwd(), "data", "ai-policy.json")] };
}
