import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { log } from "node:console";
import sharp from "sharp";

// Deterministic conversion of the reviewed, self-contained vector source files.
// It does not replace the visible inline plates or claim a pixel-equivalence pass.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(await readFile(join(root, "config/ac-door-assets.json"), "utf8"));
const receipts = [];
for (const asset of manifest.assets) {
  const src = await readFile(join(root, "public", asset.svg));
  const pixels = await sharp(src, { density: 144 })
    .resize(asset.width, asset.height, { fit: "contain", background: "#ffffff" })
    .flatten({ background: "#ffffff" })
    .png({ palette: false, compressionLevel: 9 }).toBuffer();
  const meta = await sharp(pixels).metadata();
  if (meta.width !== asset.width || meta.height !== asset.height || meta.format !== "png") {
    throw new Error("Rendered dimensions/format do not match " + asset.png);
  }
  await writeFile(join(root, "public", asset.png), pixels);
  receipts.push({ svg: asset.svg, png: asset.png, width: meta.width, height: meta.height,
    sha256: createHash("sha256").update(pixels).digest("hex") });
}
log(JSON.stringify({ source: manifest.source, rendered: receipts }, null, 2));
