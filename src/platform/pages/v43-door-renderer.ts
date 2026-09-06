import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { join, resolve, sep } from "node:path";
import { PageSpec } from "@/domain/search/pages";
import { renderDoorDocument } from "@/platform/pages/door-document";
import assetReceipt from "../../../config/ac-door-assets.json";
import manifest from "../../../content/door-template/v43/manifest.json";

const kit = () => join(process.cwd(), "content/door-template/v43");
const sha = (text: string) => createHash("sha256").update(text.replace(/\r\n/g, "\n")).digest("hex");
const read = (file: string) => readFileSync(file, "utf8").replace(/\r\n/g, "\n");

/** Rebuild from the reviewed files, using the content version date, never checkout mtime. */
export function renderV43Template(candidate: PageSpec): string {
  const spec = PageSpec.parse(candidate);
  if (!spec.door_template || spec.template_id !== "door-v43") throw new Error("A reviewed v43 PageSpec is required.");
  const root = resolve(kit());
  if (manifest.source_tree_sha256 !== spec.door_template.source_tree_sha256 ||
      manifest.binding_sha256 !== spec.door_template.binding_sha256 ||
      sha(JSON.stringify(manifest.files)) !== manifest.source_tree_sha256) {
    throw new Error("The v43 template version receipt does not match this PageSpec.");
  }
  // Check the engine before loading executable code, and every file it consumes.
  for (const file of manifest.files) {
    const absolute = resolve(root, file.path);
    if (!absolute.startsWith(root + sep) || sha(read(absolute)) !== file.sha256) {
      throw new Error("Reviewed v43 source changed or is missing: " + file.path);
    }
  }
  const dateEvidence = JSON.parse(read(join(root, "reference/content-date-evidence.json"))) as {
    source_modified_at: string; source_commit: string;
  };
  if (manifest.content_date_basis.modified_at !== dateEvidence.source_modified_at ||
      manifest.content_date_basis.commit !== dateEvidence.source_commit ||
      manifest.content_date !== dateEvidence.source_modified_at.slice(0, 10) ||
      manifest.content_date !== spec.door_template.content_date) {
    throw new Error("The v43 content date differs from its pinned source-version evidence.");
  }
  // Preserve Node's runtime loader. Webpack rewrites a direct createRequire
  // plus computed-path invocation to undefined in the production server.
  // The source and every consumed file have already passed pinned hashes.
  const nativeCreateRequire = Reflect.get(nodeModule, "createRequire") as typeof nodeModule.createRequire;
  const requireKit = nativeCreateRequire(join(root, "build.js"));
  const builder = requireKit(join(root, "build.js")) as {
    build: (specPath: string, orderPath: string, options: { dateModified: string }) => { html: string };
  };
  const { html } = builder.build(join(root, "spec/ac-blowing-warm-air"), join(root, "TEMPLATE_SECTION_ORDER.json"), { dateModified: manifest.content_date });
  if (sha(html) !== manifest.rendered_sha256 || sha(html) !== spec.door_template.rendered_sha256) {
    throw new Error("Rendered v43 content differs from its reviewed version.");
  }
  return html;
}

function attribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** The real kit output plus the same intake/metadata adapter as the approved demo door. */
export function renderV43DoorPage(candidate: PageSpec, origin: string): string {
  const spec = PageSpec.parse(candidate);
  const source = renderV43Template(spec);
  const base = new URL(origin);
  if (!/^https?:$/.test(base.protocol) || base.username || base.password) throw new Error("An HTTP serving origin is required.");
  let html = renderDoorDocument(source, new Request(new URL(spec.canonical_path, base.origin)), {
    source_sha256_lf: manifest.rendered_sha256,
    source_modified_at: manifest.content_date_basis.modified_at,
    assets: assetReceipt.assets,
  }, spec.canonical_path);
  const attribution = { ...spec.intake_context, landing_path: spec.canonical_path };
  const fields = Object.entries(attribution).map(([name, value]) =>
    `<input type="hidden" name="${name}" value="${attribute(value ?? "")}">`).join("\n");
  html = html.replace("</form>", fields + "\n</form>");
  return html;
}
