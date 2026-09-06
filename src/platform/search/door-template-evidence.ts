import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import reviewed from "../../../content/door-template/v43/binding.json";
import type { PageSpec } from "@/domain/search/pages";
import { requiresV43DoorChecks, V43_QA_RENDER_ORIGIN, type DoorTemplateEvidence, type DoorAssetEvidence } from "@/domain/search/door-template-qa";
import { renderV43DoorPage, renderV43Template } from "@/platform/pages/v43-door-renderer";

const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const lf = (value: Buffer) => value.toString("utf8").replace(/\r\n/g, "\n");
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function inside(root: string, path: string): string {
  const base = resolve(root);
  const absolute = resolve(base, path.replace(/^\//, ""));
  if (!absolute.startsWith(base + sep)) throw new Error("Asset path escapes reviewed root");
  return absolute;
}

/** No model/network request. Re-read actual files and rendering on EVERY call. */
export function collectDoorTemplateEvidence(specs: readonly PageSpec[]): Record<string, DoorTemplateEvidence> {
  return Object.fromEntries(specs.filter(requiresV43DoorChecks).map((spec) => {
    const evidence: DoorTemplateEvidence = {
      page_spec_id: spec.page_spec_id, collected_at: new Date().toISOString(),
      reference_sha256: null, source_tree_sha256: null, binding_sha256: null, rendered_sha256: null,
      source_date_evidence_text: null, final_rendered_html: null,
      assets: [], social: null, sources: [], capabilities: [], production: null, errors: [],
    };
    const kit = join(process.cwd(), "content/door-template/v43");
    try {
      const manifest = JSON.parse(readFileSync(join(kit, "manifest.json"), "utf8")) as { files: Array<{ path: string }> };
      const files = manifest.files.map(({ path }) => ({ path, sha256: sha(lf(readFileSync(inside(kit, path)))) }));
      evidence.source_tree_sha256 = sha(JSON.stringify(files));
      evidence.reference_sha256 = sha(lf(readFileSync(join(kit, "reference/approved-v43.html"))));
      evidence.source_date_evidence_text = lf(readFileSync(join(kit, "reference/content-date-evidence.json")));
      const binding = JSON.parse(readFileSync(join(kit, "binding.json"), "utf8")) as Record<string, unknown>;
      delete binding.binding_sha256;
      evidence.binding_sha256 = sha(JSON.stringify(binding));
    } catch { evidence.errors.push("The current v43 source/reference/binding files could not be read and independently hashed."); }

    let imageObjects: Array<Record<string, unknown>> = [];
    try {
      evidence.rendered_sha256 = sha(renderV43Template(spec).replace(/\r\n/g, "\n"));
      const actual = renderV43DoorPage(spec, V43_QA_RENDER_ORIGIN);
      evidence.final_rendered_html = actual;
      const meta = (name: string) => actual.match(new RegExp('<meta (?:property|name)="' + name + '" content="([^"]*)"'))?.[1] ?? null;
      evidence.social = { og_image: meta("og:image"), twitter_image: meta("twitter:image"),
        width: Number(meta("og:image:width")) || null, height: Number(meta("og:image:height")) || null, encoding_format: meta("og:image:type") };
      const json = actual.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1];
      if (!json) throw new Error("Missing ImageObject metadata");
      const graph = JSON.parse(json) as { "@graph": Array<Record<string, unknown>> };
      imageObjects = graph["@graph"].flatMap((node) => node["@type"] === "WebPage" && Array.isArray(node.image) ? node.image : []);
    } catch { evidence.errors.push("The actual v43 renderer or its image metadata failed independent inspection."); }

    for (const asset of reviewed.visual_assets) {
      const actual: DoorAssetEvidence = {
        asset_id: asset.asset_id, source_sha256: null, svg_path: asset.public_svg_path, svg_sha256: null,
        raster_path: asset.raster_path, raster_sha256: null, encoding_format: null, width: null, height: null, metadata: null,
      };
      try {
        actual.source_sha256 = sha(lf(readFileSync(inside(kit, asset.source_path))));
        const vector = readFileSync(inside(join(process.cwd(), "public"), asset.public_svg_path));
        if (!/<svg\b/.test(lf(vector))) throw new Error("Invalid SVG");
        actual.svg_sha256 = sha(lf(vector));
        const raster = readFileSync(inside(join(process.cwd(), "public"), asset.raster_path));
        actual.raster_sha256 = sha(raster);
        if (raster.length < 24 || !raster.subarray(0, 8).equals(PNG_SIGNATURE) || raster.toString("ascii", 12, 16) !== "IHDR") {
          throw new Error("Invalid PNG signature");
        }
        actual.encoding_format = "image/png";
        actual.width = raster.readUInt32BE(16);
        actual.height = raster.readUInt32BE(20);
        const metadata = imageObjects.find((item) => {
          try { return new URL(String(item.contentUrl)).pathname === asset.raster_path; } catch { return false; }
        });
        if (metadata) actual.metadata = { content_url: String(metadata.contentUrl), encoding_format: String(metadata.encodingFormat),
          width: Number(metadata.width), height: Number(metadata.height) };
      } catch { evidence.errors.push(`Actual image receipt could not be completed for ${asset.asset_id}.`); }
      evidence.assets.push(actual);
    }

    // Deliberately empty. The imported ledger's September 1 prose is retained
    // provenance, not a fresh source fetch. There is no authenticated production
    // verification adapter yet. PageSpec and the capability manifest cannot
    // author their own source/runtime/launch proof. These remain release blockers.
    return [spec.page_spec_id, evidence];
  }));
}
