import type { DoorV44CompileReceipt, DoorV44CompiledAsset } from "./compiler-types";
import { doorV44Hash } from "./schema-engine";

/** Content addressing binds immutable page identity as well as exact HTML, semantic document and asset bytes. */
export function doorV44ArtifactHash(
  receipt: Pick<DoorV44CompileReceipt, "tenant_id" | "page_id" | "page_version" | "canonical_intent_id" | "canonical_url" | "html_hash" | "semantic_hash" | "input_hashes">,
  assets: readonly DoorV44CompiledAsset[],
): string {
  return doorV44Hash({
    identity: { tenant_id: receipt.tenant_id, page_id: receipt.page_id, page_version: receipt.page_version,
      canonical_intent_id: receipt.canonical_intent_id, canonical_url: receipt.canonical_url },
    html_hash: receipt.html_hash, semantic_hash: receipt.semantic_hash, input_hashes: receipt.input_hashes,
    assets: assets.map(row => ({ asset_id: row.asset_id, path: row.path, sha256: row.sha256, mime: row.mime, width: row.width, height: row.height }))
      .sort((a, b) => a.asset_id < b.asset_id ? -1 : a.asset_id > b.asset_id ? 1 : 0),
  });
}
