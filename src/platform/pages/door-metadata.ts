import { createHash } from "node:crypto";
import manifest from "../../../config/ac-door-assets.json";

function attr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export type DoorMetadataReceipt = Pick<typeof manifest, "source_sha256_lf" | "source_modified_at" | "assets">;

/** Callers supply only a server-owned reviewed receipt, never request JSON. */
export function adaptDoorMetadata(source: string, origin: string, receipt: DoorMetadataReceipt = manifest, canonicalPath?: string): string {
  const normalized = source.replace(/\r\n/g, "\n");
  const hash = createHash("sha256").update(normalized).digest("hex");
  if (hash !== receipt.source_sha256_lf) {
    throw new Error("Door content changed without a matching source-version receipt; update the reviewed source date and hash.");
  }
  const base = new URL(origin).origin;
  if (!/^https?:\/\//.test(base)) throw new Error("A real HTTP preview origin is required.");
  let html = source.replaceAll("https://propertyresponsenetwork.com", attr(base));
  const canonical = canonicalPath ? new URL(canonicalPath, base).href : undefined;
  if (canonical && (new URL(canonical).origin !== base || !canonicalPath?.startsWith("/") || /[?#]/.test(canonicalPath))) {
    throw new Error("A same-origin canonical path is required.");
  }
  if (canonical) {
    html = html.replace(/(<link rel="canonical" href=")[^"]*(">)/, "$1" + attr(canonical) + "$2");
    html = html.replace(/(<meta property="og:url" content=")[^"]*(">)/, "$1" + attr(canonical) + "$2");
  }
  html = html.replace(/<meta name="robots" content="[^"]*">/, '<meta name="robots" content="noindex,nofollow">');
  html = html.replace(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/, (_match, raw: string) => {
    const graph = JSON.parse(raw);
    for (const node of graph["@graph"] ?? []) {
      if (node["@type"] !== "WebPage") continue;
      if (canonical) {
        node.url = canonical;
        node["@id"] = canonical + "#webpage";
      }
      node.dateModified = receipt.source_modified_at.slice(0, 10);
      for (const image of node.image ?? []) {
        const asset = receipt.assets.find((item) => item.png === image.contentUrl);
        if (!asset) throw new Error("ImageObject has no reviewed image asset: " + String(image.contentUrl));
        image.contentUrl = new URL(asset.png, base).href;
        image.encodingFormat = "image/png";
        image.width = asset.width;
        image.height = asset.height;
      }
    }
    return '<script type="application/ld+json">' + JSON.stringify(graph, null, 2).replace(/</g, "\\u003c") + '</script>';
  });
  const value = (property: string) => (html.match(new RegExp('<meta property="' + property + '" content="([^"]*)">')) ?? [])[1];
  const title = value("og:title");
  const description = value("og:description");
  const image = receipt.assets.find((asset) => asset.og_image);
  if (!title || !description || !image) throw new Error("Missing source social metadata.");
  const social = [
    '<meta name="twitter:title" content="' + title + '">',
    '<meta name="twitter:description" content="' + description + '">',
    '<meta name="twitter:image" content="' + attr(new URL(image.png, base).href) + '">',
    '<meta property="og:image:type" content="image/png">',
    '<meta property="og:image:width" content="' + image.width + '">',
    '<meta property="og:image:height" content="' + image.height + '">',
  ].join("\n");
  // Joshua authorized this narrow wrapping repair on 2026-09-06 after the
  // browser audit found 31px overflow at 320px. Keep the reviewed source and
  // its CSS intact; only the methodology link's small-screen grid may wrap.
  html = html.replace("</head>", `<style id="door-narrow-methodology-repair">
@media (max-width:360px){
  #repair-record .record-method{grid-template-columns:minmax(0,1fr);min-width:0;}
  #repair-record .record-method a{white-space:normal;overflow-wrap:anywhere;text-wrap:pretty;}
}
</style></head>`);
  return html.replace('<meta name="twitter:card" content="summary_large_image">', '<meta name="twitter:card" content="summary_large_image">\n' + social);
}
