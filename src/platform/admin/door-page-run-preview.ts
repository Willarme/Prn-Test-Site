import { DEFAULT_TENANT_ID } from "@/domain/problem/contracts";
import { doorV44Hash } from "@/domain/search/door-v44/schema-engine";
import { doorPageRunStore } from "@/platform/search/door-page-run-store";
import { readDoorFixtureRunArtifact } from "@/platform/search/door-page-run-executor";
import { guardAdminRead } from "@/platform/admin/request";
import { privateResponse, previewHtml } from "@/platform/admin/door-creator-preview";
import { doorRunDryPreviewHref } from "@/platform/admin/door-page-runs";

type Params = { run_id: string; fixture_id: string; asset?: string };
const error = (code: string, status: number) => Response.json({ error: code }, { status });
export async function serveDoorRunPreview(request: Request, params: () => Promise<Params>, kind: "html" | "asset") {
  try {
    const denied = await guardAdminRead(request);
    if (denied) return privateResponse(request, denied);
    if (!["GET", "HEAD"].includes(request.method)) { const response = error("METHOD_NOT_ALLOWED", 405); response.headers.set("Allow", "GET, HEAD"); return privateResponse(request, response); }
    const target = await params();
    if (!/^run-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(target.run_id)
      || !/^F(?:0[1-9]|1[01])$/.test(target.fixture_id) || (kind === "asset" && !/^[a-f0-9]{64}\.(?:png|webp)$/.test(target.asset ?? ""))) return privateResponse(request, error("RUN_PREVIEW_NOT_FOUND", 404));
    const run = await doorPageRunStore().read(DEFAULT_TENANT_ID, target.run_id);
    const item = run?.items.find(i => i.fixture_id === target.fixture_id), outcome = item?.outcome;
    if (!run?.dry_run || item?.status !== "BUILT" || !outcome?.artifact || outcome.artifact.namespace !== "dry-run"
      || !outcome.input_sha256 || !outcome.spec_sha256 || !outcome.compile_receipt_sha256 || !outcome.html_hash || !outcome.semantic_hash) return privateResponse(request, error("RUN_PREVIEW_NOT_FOUND", 404));
    const { compiled } = await readDoorFixtureRunArtifact({ run_id: run.run_id, fixture_id: item.fixture_id, page_id: item.page_id, artifact_hash: outcome.artifact.artifact_hash,
      input_sha256: outcome.input_sha256, spec_sha256: outcome.spec_sha256, compile_receipt_sha256: outcome.compile_receipt_sha256,
      html_hash: outcome.html_hash, semantic_hash: outcome.semantic_hash, package_sha256: run.package_sha256, executor_sha256: run.executor_sha256 });
    const receipt = compiled.receipt;
    if (doorV44Hash(receipt) !== outcome.compile_receipt_sha256 || receipt.html_hash !== outcome.html_hash || receipt.semantic_hash !== outcome.semantic_hash
      || receipt.input_hashes.spec_sha256 !== outcome.spec_sha256) return privateResponse(request, error("RUN_PREVIEW_UNAVAILABLE", 503));
    if (kind === "asset") {
      const asset = compiled.assets.find(a => a.path === `/media/door-v44/${target.asset}`);
      if (!asset) return privateResponse(request, error("RUN_PREVIEW_NOT_FOUND", 404));
      const bytes = Buffer.from(asset.base64, "base64");
      return privateResponse(request, new Response(bytes, { headers: { "Content-Type": asset.mime, "Content-Length": String(bytes.length) } }));
    }
    const html = previewHtml(compiled.html, compiled.assets, doorRunDryPreviewHref(run.run_id, item.fixture_id))
      .replace(/<body([^>]*)>/, '<body$1><aside role="note"><strong>DRAFT — unsaved synthetic fixture preview.</strong> No page version was saved. This content-only view has no interactive controls, QA approval or publication.</aside>');
    const response = privateResponse(request, new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "X-PRN-Artifact-SHA256": receipt.artifact_hash } }));
    response.headers.set("X-PRN-Draft-Preview", "unsaved-fixture; run-bound; not-release-evidence");
    return response;
  } catch { return privateResponse(request, error("RUN_PREVIEW_UNAVAILABLE", 503)); }
}
