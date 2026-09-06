import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import receipt from "../config/ac-door-copy-amendment-assets.json";
import { V43_ASSET_PINS, V43_QA_AMENDMENT_PINS } from "@/domain/search/door-template-qa";
import { amendV43SourceAsset, reviewV43CopyAmendment } from "@/domain/search/door-template-amendment";

const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
describe("reviewed v43 plate wording derivative", () => {
  it("retains original geometry and styles with only the two approved public SVG replacements", () => {
    const asset = receipt.assets[0];
    const svg = readFileSync(join(process.cwd(), "public", asset.public_svg_path), "utf8").replace(/\r\n/g, "\n");
    expect(sha(svg)).toBe(V43_ASSET_PINS[asset.asset_id].svg);
    let original = svg;
    for (const id of asset.replacement_ids) {
      const replacement = reviewV43CopyAmendment().replacements.find(row => row.id === id)!.rendered;
      expect(original.split(replacement.to)).toHaveLength(2);
      original = original.replace(replacement.to, replacement.from);
    }
    expect(sha(original)).toBe(asset.base_public_svg_sha256);
    const source = readFileSync(join(process.cwd(), "content/door-template/v43", asset.source_path), "utf8");
    expect(sha(amendV43SourceAsset(asset.asset_id, source))).toBe(asset.amended_source_sha256);
  });

  it("reproduces the exact measured PNG from the actual amended SVG with native sharp", async () => {
    const asset = receipt.assets[0];
    const svg = readFileSync(join(process.cwd(), "public", asset.public_svg_path));
    const actual = readFileSync(join(process.cwd(), "public", asset.raster_path));
    const expected = await sharp(svg, { density: 144 }).resize(asset.width, asset.height, { fit: "contain", background: "#ffffff" })
      .flatten({ background: "#ffffff" }).png({ palette: false, compressionLevel: 9 }).toBuffer();
    expect(actual).toEqual(expected);
    expect(sha(actual)).toBe(V43_ASSET_PINS[asset.asset_id].png);
    expect(await sharp(actual).metadata()).toMatchObject({ format: "png", width: 1200, height: 409, hasAlpha: false });
    const { receipt_sha256, ...payload } = receipt;
    expect(receipt_sha256).toBe(V43_QA_AMENDMENT_PINS.asset_receipt);
    expect(sha(JSON.stringify(payload))).toBe(V43_QA_AMENDMENT_PINS.asset_receipt);
  });
});
