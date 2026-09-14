import { isAbsolute, parse, resolve } from "node:path";
import { DEFAULT_TENANT_ID } from "@/domain/problem/contracts";
import type { DoorV44CompiledAsset } from "@/domain/search/door-v44/compiler-types";
import { guardAdminRead } from "@/platform/admin/request";
import { doorCreatorRecords } from "@/platform/admin/door-creator-records";
import { doorPageVersionStore } from "@/platform/search/door-page-version-store";
import { DoorPageArtifactError, readDoorPageVersionArtifact } from "@/platform/search/door-page-version-service";

type PreviewParams = { page_id: string; version: string; asset?: string };
const PAGE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const ASSET = /^[a-f0-9]{64}\.(?:png|webp)$/;
const CSP = "default-src 'none'; img-src 'self'; style-src 'none'; script-src 'none'; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'self'; object-src 'none'";

export function doorCreatorPreviewHref(pageId: string, version: number): string {
  if (!PAGE_ID.test(pageId) || !Number.isInteger(version) || version < 1 || version > 2147483646) throw new Error("Invalid preview identity");
  return `/admin/page-creator/${pageId}/versions/${version}/preview`;
}

export function privateResponse(request: Request, response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "private, no-store, max-age=0");
  headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("Content-Security-Policy", CSP);
  headers.set("X-Frame-Options", "SAMEORIGIN");
  headers.set("X-PRN-Draft-Preview", "exact-version; nonpublic; not-release-evidence");
  return new Response(request.method === "HEAD" ? null : response.body, { status: response.status, headers });
}
const error = (code: string, status: number) => Response.json({ error: code }, { status });

/** Only for the verified deterministic serializer's escaped, double-quoted
 * attributes. Do not rewrite text, links, canonical metadata, or JSON-LD.
 * Response bytes differ from the saved artifact solely at these asset URLs;
 * this unstyled, nonpublic view is not a fidelity or publication observation. */
export function previewHtml(html: string, assets: readonly DoorV44CompiledAsset[], base: string): string {
  const urls = new Map(assets.map(asset => [asset.url, `${base}/assets/${asset.path.slice("/media/door-v44/".length)}`]));
  return html.replace(/<(img|source|meta)\b[^>]*>/g, (tag: string, kind: string) => {
    const attr = kind === "img" ? "src" : kind === "source" ? "srcset"
      : / (?:name|property)="(?:og:image|twitter:image)"/.test(tag) ? "content" : null;
    if (!attr) return tag;
    return tag.replace(new RegExp(` ${attr}="([^"]*)"`, "g"), (original: string, url: string) => {
      const mapped = urls.get(url); return mapped ? ` ${attr}="${mapped}"` : original;
    });
  });
}

/** Authentication runs before even resolving route parameters or configuration.
 * Every asset request re-verifies the same exact registered version and bundle. */
export async function serveDoorCreatorPreview(request: Request, params: () => Promise<PreviewParams>, kind: "html" | "asset"): Promise<Response> {
  try {
    const refusal = await guardAdminRead(request);
    if (refusal) return privateResponse(request, refusal);
    if (!["GET", "HEAD"].includes(request.method)) {
      const response = error("Method not allowed", 405); response.headers.set("Allow", "GET, HEAD");
      return privateResponse(request, response);
    }
    const target = await params();
    if (typeof target.page_id !== "string" || typeof target.version !== "string" || !PAGE_ID.test(target.page_id) || !/^[1-9][0-9]{0,9}$/.test(target.version)
      || Number(target.version) > 2147483646 || (kind === "asset" && (typeof target.asset !== "string" || !ASSET.test(target.asset)))) {
      return privateResponse(request, error("Invalid preview identity", 400));
    }
    const root = process.env.PRN_DOOR_V44_ARTIFACT_ROOT;
    if (!root || !isAbsolute(root) || resolve(root) === parse(resolve(root)).root) return privateResponse(request, error("Preview unavailable", 503));
    const records = doorCreatorRecords();
    const store = { ...doorPageVersionStore(), getVersion: (tenantId: string, pageId: string, version: number) => {
      if (tenantId !== DEFAULT_TENANT_ID) throw new Error("Invalid preview tenant");
      // The admin adapter filters/counts the exact SQL version; never rely on
      // the legacy uncounted history lookup, which can truncate large pages.
      return records.version(pageId, version);
    } };
    const { compiled } = await readDoorPageVersionArtifact(store, root, DEFAULT_TENANT_ID, target.page_id, Number(target.version));
    if (kind === "asset") {
      const asset = compiled.assets.find(row => row.path === `/media/door-v44/${target.asset}`);
      if (!asset) return privateResponse(request, error("Preview asset not found", 404));
      const bytes = Buffer.from(asset.base64, "base64");
      return privateResponse(request, new Response(bytes, { headers: { "Content-Type": asset.mime, "Content-Length": String(bytes.length) } }));
    }
    const body = previewHtml(compiled.html, compiled.assets, doorCreatorPreviewHref(target.page_id, Number(target.version)));
    return privateResponse(request, new Response(body, { headers: { "Content-Type": "text/html; charset=utf-8",
      "X-PRN-Preview-Remapping": "version-bound-assets", "X-PRN-Artifact-SHA256": compiled.receipt.artifact_hash } }));
  } catch (caught) {
    return privateResponse(request, error(caught instanceof DoorPageArtifactError && caught.code === "VERSION_NOT_FOUND" ? "Preview version not found" : "Preview unavailable",
      caught instanceof DoorPageArtifactError && caught.code === "VERSION_NOT_FOUND" ? 404 : 503));
  }
}
