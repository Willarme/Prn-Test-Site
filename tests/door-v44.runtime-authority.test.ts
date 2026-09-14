import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DOOR_RELEASE_CHECK_IDS } from "@/domain/search/door-v44/release-evidence";
import { doorV44Hash } from "@/domain/search/door-v44/schema-engine";
import { DEFAULT_AI_POLICY } from "@/platform/ai/policy";
import { DOOR_AUTHORITY_REPOSITORY_INPUTS, doorAuthorityEnvironment, doorAuthorityFeatureDigest, doorAuthorityRepositoryDigest, readDoorRuntimeAuthority,
  type DoorRuntimeAuthorityConfig, type DoorRuntimeAuthorityManifest } from "@/platform/pages/door-v44-runtime-authority";
import { featureSnapshot } from "./helpers/feature-snapshot";

let root: string, config: DoorRuntimeAuthorityConfig, baseline: DoorRuntimeAuthorityManifest;
const features = () => ({ ...featureSnapshot({}, "LIVE"), observed_at: Date.now() });
const save = (manifest: unknown) => writeFile(config.authorityPath, JSON.stringify(manifest));
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "door-current-authority-"));
  config = { authorityPath: join(root, "authority.json"), artifactRoot: join(root, "artifacts"), repositoryRoot: join(root, "repository"),
    origin: "https://fixture.invalid", commit: "a".repeat(40), aiPolicyPaths: [join(root, "ai-policy.json")] };
  await mkdir(config.artifactRoot); await mkdir(config.repositoryRoot);
  // Tiny, explicitly synthetic repository inventories exercise actual byte reads.
  for (const paths of Object.values(DOOR_AUTHORITY_REPOSITORY_INPUTS)) for (const path of paths) {
    const target = join(config.repositoryRoot, /\.(?:ts|json|html)$/.test(path) ? path : `${path}/fixture.txt`);
    await mkdir(dirname(target), { recursive: true }); await writeFile(target, `Synthetic authority input ${path}`);
  }
  const locators: DoorRuntimeAuthorityManifest["locators"] = Object.keys(DOOR_AUTHORITY_REPOSITORY_INPUTS).map(kind => ({ type: "repository", kind: kind as keyof typeof DOOR_AUTHORITY_REPOSITORY_INPUTS, id: kind, version: "1" }));
  const dependencies = await Promise.all(locators.map(async row => ({ kind: row.kind, id: row.id, version: row.version,
    sha256: await doorAuthorityRepositoryDigest(config.repositoryRoot, row.kind as keyof typeof DOOR_AUTHORITY_REPOSITORY_INPUTS) })));
  for (const kind of ["source", "capability"] as const) {
    const path = join(root, `${kind}.json`), value = { format: "door-v44-current-records/1.0.0", tenant_id: "prn", kind, version: "1",
      records: [{ id: `fixture.${kind}`, version: "1", status: "active", value: { synthetic: true } }] };
    await writeFile(path, JSON.stringify(value));
    locators.push({ type: "current_records", kind, id: kind, version: "1", path });
    dependencies.push({ kind, id: kind, version: "1", sha256: doorV44Hash(value) });
  }
  for (const kind of ["feature_state", "ai_policy"] as const) {
    locators.push({ type: "runtime", kind, id: kind, version: "1" });
    dependencies.push({ kind, id: kind, version: "1", sha256: kind === "feature_state" ? doorAuthorityFeatureDigest(features()) : doorV44Hash(DEFAULT_AI_POLICY) });
  }
  baseline = { format: "door-v44-runtime-authority/1.0.0", tenant_id: "prn", revision: 4, dependency_revision: 2, hold_revision: 3, public_publish_hold: false, locators,
    policy: { version: "fixture.1", required_checks: [...DOOR_RELEASE_CHECK_IDS], producers: [{ id: "fixture.producer", version: "1", implementation_sha256: "b".repeat(64), actor_kind: "system", trust_scope: "reviewed_repository", kinds: ["check_matrix"], check_ids: [...DOOR_RELEASE_CHECK_IDS] }],
      dependencies: dependencies.sort((a, b) => `${a.kind}/${a.id}` < `${b.kind}/${b.id}` ? -1 : 1),
      environment: doorAuthorityEnvironment(config, "prn", "fixture.environment"), max_evidence_age_seconds: 3600,
      holds: { public_publish: false, door_pages_live: true, trial_noindex: true } } };
});
beforeEach(async () => { await save(baseline); await rm(config.aiPolicyPaths[0], { force: true }); });
afterAll(async () => { if (!resolve(root).startsWith(resolve(tmpdir()) + sep) || !root.includes("door-current-authority-")) throw new Error("Unsafe fixture path"); await rm(root, { recursive: true }); });

describe("fresh actual serving authority", () => {
  it("recomputes every dependency and environment before returning a fence", async () => {
    const result = await readDoorRuntimeAuthority(features(), config);
    expect(result.ok).toBe(true); if (!result.ok) return;
    expect(result.policy_sha256).toBe(doorV44Hash(baseline.policy));
    expect(result.fence).toEqual({ revision: 4, dependency_revision: 2, hold_revision: 3, dependencies_sha256: doorV44Hash(baseline.policy.dependencies),
      environment_sha256: doorV44Hash(baseline.policy.environment), holds_sha256: doorV44Hash(baseline.policy.holds) });
  });
  it.each(["tenant", "unknown-field", "unknown-locator", "duplicate-kind", "missing-kind", "claimed-hash", "environment", "hold"])("refuses %s without trusting claimed hashes", async mutation => {
    const candidate = structuredClone(baseline);
    if (mutation === "tenant") candidate.tenant_id = "foreign";
    if (mutation === "unknown-field") Object.assign(candidate, { approved: true });
    if (mutation === "unknown-locator") Object.assign(candidate.locators[0], { kind: "anything" });
    if (mutation === "duplicate-kind") candidate.locators[1] = candidate.locators[0];
    if (mutation === "missing-kind") candidate.locators.pop();
    if (mutation === "claimed-hash") candidate.policy.dependencies[0].sha256 = "0".repeat(64);
    if (mutation === "environment") candidate.policy.environment.commit = "c".repeat(40);
    if (mutation === "hold") candidate.public_publish_hold = true;
    await save(candidate); expect((await readDoorRuntimeAuthority(features(), config)).ok).toBe(false);
  });
  it.each(["authorityPath", "artifactRoot", "origin", "commit", "repositoryRoot"] as const)("refuses absent configured %s", async key => {
    expect((await readDoorRuntimeAuthority(features(), { ...config, [key]: "" })).ok).toBe(false);
  });
  it("rejects a changed feature snapshot and unverifiable state", async () => {
    expect((await readDoorRuntimeAuthority({ ...features(), verified: false }, config)).ok).toBe(false);
    const changed = features(); changed.rows = new Map(changed.rows).set("intake", { ...changed.rows.get("intake")!, state: "HIDDEN" });
    expect((await readDoorRuntimeAuthority(changed, config)).ok).toBe(false);
  });
  it("rejects corrupt AI policy instead of silently fingerprinting the OFF fallback", async () => {
    await writeFile(config.aiPolicyPaths[0], "{"); expect((await readDoorRuntimeAuthority(features(), config)).ok).toBe(false);
    await writeFile(config.aiPolicyPaths[0], JSON.stringify({ ...DEFAULT_AI_POLICY, version: 2 })); expect((await readDoorRuntimeAuthority(features(), config)).ok).toBe(false);
  });
  it("detects source revocation bytes even when the saved manifest is unchanged", async () => {
    const path = join(root, "source.json"), prior = await readFile(path, "utf8");
    try { const value = JSON.parse(prior); value.records[0].status = "revoked"; await writeFile(path, JSON.stringify(value)); expect((await readDoorRuntimeAuthority(features(), config)).ok).toBe(false); }
    finally { await writeFile(path, prior); }
  });
  it("detects compiler changes and additional unclaimed files", async () => {
    const path = join(config.repositoryRoot, "src/domain/search/door-v44/new.txt");
    try { await writeFile(path, "changed"); expect((await readDoorRuntimeAuthority(features(), config)).ok).toBe(false); }
    finally { await rm(path); }
  });
  it("rejects a junction ancestor of a configured record source", async () => {
    const path = join(root, "linked-directory"), candidate = structuredClone(baseline);
    await symlink(root, path, "junction");
    const source = candidate.locators.find(row => row.kind === "source")!; if (source.type !== "current_records") throw new Error(); source.path = join(path, "source.json");
    await save(candidate); expect((await readDoorRuntimeAuthority(features(), config)).ok).toBe(false);
  });
});
