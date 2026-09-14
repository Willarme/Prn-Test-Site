import { DEFAULT_TENANT_ID } from "@/domain/problem/contracts";
import { readDoorV44Artifact } from "@/domain/search/door-v44/artifact-store";
import { doorV44Hash } from "@/domain/search/door-v44/schema-engine";
import type { DoorPageSelectionGuard, DoorSelectionFence } from "@/domain/search/door-v44/page-selection";
import { readFeatureSnapshot, type FeatureSnapshot } from "@/platform/features/state";
import { doorPageSelectionStore } from "@/platform/search/door-page-selection-store";
import { doorRuntimeAuthorityConfig, readDoorRuntimeAuthority } from "./door-v44-runtime-authority";
import { doorV44PublicRefusal, doorV44SelectionResponse, verifyDoorV44ServingSnapshot, type DoorV44PublicSelection } from "./door-v44-public-response";

/** Server-only freshness provider for selection writes. It reads actual authority
 * independently of the guard supplied by the store's compare-and-set boundary. */
export async function readDoorV44FreshFence(tenantId: string, guard: DoorPageSelectionGuard): Promise<DoorSelectionFence | null> {
  if (tenantId !== DEFAULT_TENANT_ID || guard.tenant_id !== tenantId) return null;
  const features = await readFeatureSnapshot({ tenantId, fresh: true });
  const authority = await readDoorRuntimeAuthority(features, doorRuntimeAuthorityConfig());
  return authority.ok && guard.state.policy_sha256 === authority.policy_sha256 && doorV44Hash(guard.state.release_policy) === authority.policy_sha256 ? authority.fence : null;
}

/** The production reader always asks the real catalog for managed identities.
 * Missing authority is not an unmanaged result. Read errors propagate so neither
 * the public route nor directory can fall back to mutable legacy versions. */
export async function loadDoorV44PublicSelection(features?: FeatureSnapshot): Promise<DoorV44PublicSelection> {
  const snapshot = features ?? await readFeatureSnapshot({ tenantId: DEFAULT_TENANT_ID, fresh: true });
  if (snapshot.tenant_id !== DEFAULT_TENANT_ID) throw new Error("Selection tenant mismatch");
  const store = doorPageSelectionStore();
  const [guard, authority] = await Promise.all([store.getGuard(DEFAULT_TENANT_ID), readDoorRuntimeAuthority(snapshot, doorRuntimeAuthorityConfig())]);
  const current = authority.ok && guard?.tenant_id === DEFAULT_TENANT_ID && guard.state.policy_sha256 === authority.policy_sha256
    && doorV44Hash(guard.state.release_policy) === authority.policy_sha256;
  const selected = await store.getServingSnapshot(DEFAULT_TENANT_ID, current ? authority.fence : null);
  return verifyDoorV44ServingSnapshot(selected, { features: snapshot, origin: authority.ok ? authority.origin : "" },
    hash => authority.ok ? readDoorV44Artifact(authority.artifactRoot, hash) : Promise.resolve({ ok: false, errors: [{ code: "ARTIFACT_UNAVAILABLE", pointer: "" }] }));
}

export async function doorV44RuntimeResponse(request: Request): Promise<Response | null> {
  try { return doorV44SelectionResponse(request, await loadDoorV44PublicSelection()); }
  catch { return doorV44PublicRefusal(503, request.method === "HEAD"); }
}
