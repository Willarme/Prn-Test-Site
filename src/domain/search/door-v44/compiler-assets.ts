import sharp from "sharp";
import { createHash } from "node:crypto";
import type { DoorV44AssetRecord, DoorV44CompiledAsset } from "./compiler-types";
import type { DoorV44Diagnostic, DoorV44Visual } from "./types";

/** Decode actual bytes; file names and caller-provided dimension declarations are not evidence. */
export async function compileDoorV44Assets(
  visuals: readonly DoorV44Visual[], records: readonly DoorV44AssetRecord[], origin: string,
): Promise<{ ok: true; assets: DoorV44CompiledAsset[] } | { ok: false; errors: DoorV44Diagnostic[] }> {
  const assets: DoorV44CompiledAsset[] = [];
  const errors: DoorV44Diagnostic[] = [];
  for (const [index, visual] of visuals.entries()) {
    const pointer = `/visuals/${index}`;
    const record = records.find(row => row.asset_id === visual.asset_id);
    if (!record || !record.license_receipt || !record.renderer_identity) {
      errors.push({ code: "IMAGE_RECORD_MISSING", pointer }); continue;
    }
    try {
      if (record.raster_base64.length > 16 * 1024 * 1024 || record.inline_source.length > 2 * 1024 * 1024
        || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(record.raster_base64)) throw new Error();
      const bytes = Buffer.from(record.raster_base64, "base64");
      if (!bytes.length || bytes.toString("base64") !== record.raster_base64) throw new Error();
      if (createHash("sha256").update(bytes).digest("hex") !== visual.raster_hash
        || createHash("sha256").update(record.inline_source.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n")).digest("hex") !== visual.inline_hash) {
        errors.push({ code: "IMAGE_HASH_MISMATCH", pointer }); continue;
      }
      const decoded = sharp(bytes, { failOn: "warning", limitInputPixels: 8192 * 8192 });
      const metadata = await decoded.metadata();
      if (metadata.format !== (visual.mime === "image/png" ? "png" : "webp") || metadata.width !== visual.width
        || metadata.height !== visual.height || (metadata.pages ?? 1) !== 1 || (metadata.orientation ?? 1) !== 1) {
        errors.push({ code: "IMAGE_METADATA_MISMATCH", pointer }); continue;
      }
      // metadata() alone accepts some truncated bodies; decode every pixel without re-encoding the artifact.
      await decoded.raw().toBuffer();
      const path = `/media/door-v44/${visual.raster_hash}.${metadata.format === "png" ? "png" : "webp"}`;
      assets.push({ asset_id: visual.asset_id, path, url: new URL(path, origin).href, sha256: visual.raster_hash,
        mime: visual.mime, width: visual.width, height: visual.height, base64: record.raster_base64 });
    } catch { errors.push({ code: "IMAGE_DECODE_FAILED", pointer }); }
  }
  return errors.length ? { ok: false, errors } : { ok: true, assets };
}
