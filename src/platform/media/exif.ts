/**
 * IMAGE METADATA STRIPPING — the condition on letting a photo leave.
 *
 * DECISIONS FOR MELISSA (2026-09-04), decision 1 recommendation B, states the
 * two conditions on reading a homeowner's label photo with a model: "location
 * data is stripped from the image first, and a failed or slow call falls back
 * to asking". Decision 7 puts the same condition on the provider media link:
 * "location metadata is stripped from every image before it is reachable".
 * This module is that condition, in one place, for both callers:
 *
 *   - platform/problem/ai-label.ts passes every photo through it BEFORE the
 *     bytes go anywhere near callModel;
 *   - track P3's provider media gallery strips on the way out.
 *
 * ─── WHAT IT DOES, PRECISELY ────────────────────────────────────────────────
 *
 * A JPEG is a sequence of marker segments. Everything a phone knows about a
 * photo that is not the picture itself — GPS position, timestamp, device make
 * and model, orientation, an embedded thumbnail (which carries its own copy of
 * the GPS block), XMP, IPTC captions — travels in APPn segments (markers
 * 0xFFE0..0xFFEF) and COM segments (0xFFFE) between the SOI marker and the
 * first SOS. The picture itself is DQT/SOF/DHT/DRI and the entropy-coded scan
 * after SOS. So the stripper walks the segment list once, keeps the picture,
 * drops the metadata, and copies everything from SOS to the end verbatim.
 *
 * TWO APPn SEGMENTS ARE KEPT, deliberately, because they describe the picture
 * and carry nothing about the person who took it:
 *   APP0 "JFIF"        pixel density and an optional tiny thumbnail of the
 *                      picture itself (no camera data)
 *   APP2 "ICC_PROFILE" the colour profile, which is how the label's colours
 *                      render correctly
 * Everything else in APP1..APP15 is dropped — including APP1 Exif, APP1 XMP,
 * APP13 Photoshop/IPTC and any vendor segment — and so is every COM.
 *
 * PNG and WebP are walked with rendering-chunk allowlists. Unknown encodings,
 * malformed containers and animated WebP fail closed. No unstripped format
 * is forwarded to a provider or a shared media link.
 *
 * ─── NEVER THROWS, NEVER GUESSES ────────────────────────────────────────────
 *
 * A JPEG this parser cannot walk cleanly — a truncated file, a length field
 * pointing past the end, no SOS — comes back `ok: false`. The caller decides
 * what that means; the label reader treats it as "do not send", because a file
 * whose segments could not be enumerated is a file whose metadata could not be
 * proven gone.
 *
 * Detection is by bytes, not by the declared MIME type: a browser's
 * `File.type` is a claim, the SOI marker is a fact.
 */

export type StripResult =
  | {
      ok: true;
      bytes: Buffer;
      /** True when the bytes were a JPEG and were rewritten; false when returned untouched. */
      stripped: boolean;
      /** Marker names of the segments that were removed, in file order. Empty when none. */
      removed: string[];
      /** What the bytes actually are, from their magic number. */
      format: "jpeg" | "png" | "webp" | "unknown";
    }
  | { ok: false; reason: string };

const SOI = 0xd8;
const EOI = 0xd9;
const SOS = 0xda;

export function detectImageFormat(bytes: Buffer): "jpeg" | "png" | "webp" | "unknown" {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === SOI && bytes[2] === 0xff) return "jpeg";
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "png";
  }
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString("latin1") === "RIFF" &&
    bytes.subarray(8, 12).toString("latin1") === "WEBP"
  ) {
    return "webp";
  }
  return "unknown";
}

/** Is this marker one that carries no length word at all? */
function isStandalone(marker: number): boolean {
  // RST0..RST7, TEM, and SOI/EOI themselves.
  return (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01 || marker === SOI || marker === EOI;
}

function segmentName(marker: number, payload: Buffer): string {
  if (marker >= 0xe0 && marker <= 0xef) {
    const n = marker - 0xe0;
    const head = payload.subarray(0, 32).toString("latin1");
    const tag = head.startsWith("Exif\0")
      ? "Exif"
      : head.startsWith("http://ns.adobe.com/xap")
        ? "XMP"
        : head.startsWith("ICC_PROFILE\0")
          ? "ICC_PROFILE"
          : head.startsWith("JFIF\0") || head.startsWith("JFXX\0")
            ? "JFIF"
            : head.startsWith("Photoshop")
              ? "Photoshop"
              : null;
    return tag ? `APP${n}/${tag}` : `APP${n}`;
  }
  if (marker === 0xfe) return "COM";
  return `0x${marker.toString(16)}`;
}

/** The two APPn segments that describe the picture and nothing about its author. */
function isKeptApp(marker: number, payload: Buffer): boolean {
  const head = payload.subarray(0, 12).toString("latin1");
  if (marker === 0xe0) return head.startsWith("JFIF\0") || head.startsWith("JFXX\0");
  if (marker === 0xe2) return head.startsWith("ICC_PROFILE\0");
  return false;
}

/**
 * Strip metadata from JPEG bytes. Returns a NEW buffer; the input is not
 * modified. See the module header for exactly what is kept and dropped.
 */
export function stripJpegMetadata(input: Buffer): StripResult {
  if (detectImageFormat(input) !== "jpeg") {
    return { ok: false, reason: "not a JPEG (no SOI marker)" };
  }
  const out: Buffer[] = [input.subarray(0, 2)];
  const removed: string[] = [];
  let pos = 2;

  while (pos < input.length) {
    if (input[pos] !== 0xff) {
      return { ok: false, reason: `expected a marker at byte ${pos}, found 0x${input[pos]!.toString(16)}` };
    }
    // Fill bytes: any number of 0xFF may precede a marker.
    while (pos < input.length && input[pos] === 0xff) pos += 1;
    if (pos >= input.length) return { ok: false, reason: "file ends inside a marker" };
    const marker = input[pos]!;
    const markerStart = pos - 1;
    pos += 1;

    if (marker === SOS) {
      if (pos + 2 > input.length) return { ok: false, reason: "truncated JPEG scan header" };
      const length = input.readUInt16BE(pos);
      if (length < 2 || pos + length > input.length) return { ok: false, reason: "invalid JPEG scan header" };
      let scanEnd = pos + length;
      // Stuffed FF00 and restart markers belong to the image. Other markers
      // end the scan, including metadata between progressive JPEG scans.
      while (scanEnd < input.length) {
        if (input[scanEnd] !== 0xff) { scanEnd++; continue; }
        const next = input[scanEnd + 1];
        if (next === 0x00 || (next !== undefined && next >= 0xd0 && next <= 0xd7)) { scanEnd += 2; continue; }
        if (next === 0xff) { scanEnd++; continue; }
        break;
      }
      if (scanEnd >= input.length) return { ok: false, reason: "unterminated JPEG scan" };
      out.push(input.subarray(markerStart, scanEnd));
      pos = scanEnd;
      continue;
    }
    if (marker === EOI) {
      // No scan before EOI: structurally a JPEG with no image. Keep what we have.
      out.push(input.subarray(markerStart, pos));
      return { ok: true, bytes: Buffer.concat(out), stripped: true, removed, format: "jpeg" };
    }
    if (isStandalone(marker)) {
      out.push(input.subarray(markerStart, pos));
      continue;
    }
    if (pos + 2 > input.length) return { ok: false, reason: "file ends inside a segment length" };
    const length = input.readUInt16BE(pos);
    if (length < 2) return { ok: false, reason: `segment 0x${marker.toString(16)} has an impossible length ${length}` };
    const segmentEnd = pos + length;
    if (segmentEnd > input.length) {
      return { ok: false, reason: `segment 0x${marker.toString(16)} runs past the end of the file` };
    }
    const payload = input.subarray(pos + 2, segmentEnd);
    const isApp = marker >= 0xe0 && marker <= 0xef;
    const isCom = marker === 0xfe;
    if ((isApp && !isKeptApp(marker, payload)) || isCom) {
      removed.push(segmentName(marker, payload));
    } else {
      out.push(input.subarray(markerStart, segmentEnd));
    }
    pos = segmentEnd;
  }
  return { ok: false, reason: "no SOS marker — the file has no image scan" };
}

/**
 * The one entry point callers use: strip what can be stripped, pass the rest
 * through untouched, and say which happened. Detection is by magic number;
 * `mime` is recorded on nothing and used for nothing but a reason string.
 */
export function stripImageMetadata(bytes: Buffer, mime?: string): StripResult {
  const format = detectImageFormat(bytes);
  if (format === "jpeg") return stripJpegMetadata(bytes);
  void mime;
  if (format === "png") return stripPngMetadata(bytes);
  if (format === "webp") return stripWebpMetadata(bytes);
  return { ok: false, reason: "unsupported image encoding" };
}

/** Keep only PNG rendering chunks. This removes eXIf, text/XMP, timestamps,
 * vendor chunks and trailing bytes; lengths and CRCs are validated first. */
function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
export function stripPngMetadata(input: Buffer): StripResult {
  const out = [input.subarray(0, 8)];
  const removed: string[] = [];
  const keep = new Set(["IHDR", "PLTE", "IDAT", "IEND", "tRNS", "gAMA", "cHRM", "sRGB", "sBIT"]);
  let pos = 8, image = false, header = false;
  while (pos + 12 <= input.length) {
    const length = input.readUInt32BE(pos), end = pos + 12 + length;
    if (end > input.length) return { ok: false, reason: "truncated PNG chunk" };
    const type = input.toString("ascii", pos + 4, pos + 8);
    if (crc32(input.subarray(pos + 4, end - 4)) !== input.readUInt32BE(end - 4)) return { ok: false, reason: "invalid PNG chunk CRC" };
    if (!header && (type !== "IHDR" || length !== 13)) return { ok: false, reason: "missing PNG header" };
    header = true;
    if (type === "IDAT") image = true;
    if (keep.has(type)) out.push(input.subarray(pos, end)); else removed.push(type);
    pos = end;
    if (type === "IEND") return image && length === 0
      ? { ok: true, bytes: Buffer.concat(out), stripped: true, removed, format: "png" }
      : { ok: false, reason: "PNG has no image data" };
  }
  return { ok: false, reason: "PNG has no complete end chunk" };
}
/** WebP RIFF allowlist strips EXIF/XMP and resets their VP8X flags. */
export function stripWebpMetadata(input: Buffer): StripResult {
  if (input.length < 12 || input.readUInt32LE(4) + 8 !== input.length) return { ok: false, reason: "invalid WebP size" };
  const out: Buffer[] = []; const removed: string[] = [];
  let pos = 12, image = false;
  while (pos + 8 <= input.length) {
    const type = input.toString("ascii", pos, pos + 4), size = input.readUInt32LE(pos + 4);
    const end = pos + 8 + size + (size % 2);
    if (end > input.length) return { ok: false, reason: "truncated WebP chunk" };
    // Animated frames may nest chunks. Refuse rather than pass unknown nested metadata.
    if (type === "ANIM" || type === "ANMF") return { ok: false, reason: "animated WebP is not supported for sharing" };
    if (["VP8 ", "VP8L", "ALPH", "VP8X"].includes(type)) {
      const chunk = Buffer.from(input.subarray(pos, end));
      if (type === "VP8X") {
        if (size !== 10) return { ok: false, reason: "invalid WebP extended header" };
        chunk[8] = chunk[8]! & ~0x2c; // EXIF, XMP, ICC (all removed)
      }
      if (type === "VP8 " || type === "VP8L") image = true;
      out.push(chunk);
    } else removed.push(type);
    pos = end;
  }
  if (pos !== input.length || !image) return { ok: false, reason: "incomplete WebP image" };
  const payload = Buffer.concat(out), head = Buffer.from("RIFF0000WEBP", "ascii");
  head.writeUInt32LE(payload.length + 4, 4);
  return { ok: true, bytes: Buffer.concat([head, payload]), stripped: true, removed, format: "webp" };
}

/**
 * A quick, conservative check used by tests and by the label reader's own
 * self-audit: does this buffer still contain an Exif or XMP APP1 header
 * anywhere before its first SOS? (Bytes after SOS are entropy-coded and can
 * contain any sequence by chance, so the scan stops there.)
 */
export function jpegCarriesMetadata(bytes: Buffer): boolean {
  if (detectImageFormat(bytes) !== "jpeg") return false;
  const sos = bytes.indexOf(Buffer.from([0xff, SOS]));
  const head = sos === -1 ? bytes : bytes.subarray(0, sos);
  return (
    head.indexOf(Buffer.from("Exif\0", "latin1")) !== -1 ||
    head.indexOf(Buffer.from("http://ns.adobe.com/xap", "latin1")) !== -1
  );
}
