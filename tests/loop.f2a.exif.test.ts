import { describe, expect, it } from "vitest";
import {
  detectImageFormat,
  jpegCarriesMetadata,
  stripImageMetadata,
  stripJpegMetadata,
} from "@/platform/media/exif";

/**
 * F2a — the metadata stripper, on synthetic JPEGs built byte by byte so every
 * assertion is about a segment this test put there.
 */

function segment(marker: number, payload: Buffer): Buffer {
  const len = Buffer.alloc(2);
  len.writeUInt16BE(payload.length + 2);
  return Buffer.concat([Buffer.from([0xff, marker]), len, payload]);
}

const SOI = Buffer.from([0xff, 0xd8]);
const EOI = Buffer.from([0xff, 0xd9]);
const JFIF = segment(0xe0, Buffer.concat([Buffer.from("JFIF\0", "latin1"), Buffer.from([1, 1, 0, 0, 1, 0, 1, 0, 0])]));
const GPS_SENTINEL = "PRN-FAKE-GPS-40.0000N-085.0000W";
const EXIF = segment(
  0xe1,
  Buffer.concat([
    Buffer.from("Exif\0\0", "latin1"),
    Buffer.from("II*\0\x08\0\0\0", "latin1"),
    Buffer.from(`GPSLatitude ${GPS_SENTINEL}`, "latin1"),
  ])
);
const XMP = segment(0xe1, Buffer.from("http://ns.adobe.com/xap/1.0/\0<x:xmpmeta>device</x:xmpmeta>", "latin1"));
const ICC = segment(0xe2, Buffer.concat([Buffer.from("ICC_PROFILE\0", "latin1"), Buffer.from([1, 1, 0, 0, 0, 0])]));
const PHOTOSHOP = segment(0xed, Buffer.from("Photoshop 3.0\0caption", "latin1"));
const COM = segment(0xfe, Buffer.from("taken by someone's phone", "latin1"));
const DQT = segment(0xdb, Buffer.concat([Buffer.from([0]), Buffer.alloc(64, 1)]));
const SOF0 = segment(0xc0, Buffer.from([8, 0, 1, 0, 1, 1, 1, 0x11, 0]));
const DHT = segment(0xc4, Buffer.concat([Buffer.from([0]), Buffer.alloc(16, 0), Buffer.from([0])]));
const DRI = segment(0xdd, Buffer.from([0, 4]));
// SOS header + a scan that deliberately contains "Exif\0" and an FFE1 sequence
// after the scan start, to prove the stripper stops parsing at SOS.
const SOS = Buffer.concat([
  segment(0xda, Buffer.from([1, 1, 0, 0, 63, 0])),
  Buffer.from([0x12, 0x34, 0xff, 0x00, 0x56]),
  Buffer.from("Exif\0", "latin1"),
  Buffer.from([0xff, 0xd0, 0x99, 0xff, 0x00, 0xe1, 0x00, 0x02]),
]);

function jpeg(...parts: Buffer[]): Buffer {
  return Buffer.concat([SOI, ...parts, SOS, EOI]);
}

describe("stripJpegMetadata", () => {
  it("removes APP1 Exif, APP1 XMP, APP13 and COM; keeps SOI, JFIF, ICC, DQT, SOF, DHT, DRI, SOS and the scan", () => {
    const original = jpeg(JFIF, EXIF, XMP, ICC, DQT, PHOTOSHOP, SOF0, COM, DHT, DRI);
    expect(jpegCarriesMetadata(original)).toBe(true);
    expect(original.indexOf(Buffer.from(GPS_SENTINEL, "latin1"))).toBeGreaterThan(0);

    const result = stripJpegMetadata(original);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.stripped).toBe(true);
    expect(result.removed).toEqual(["APP1/Exif", "APP1/XMP", "APP13/Photoshop", "COM"]);

    const expected = Buffer.concat([SOI, JFIF, ICC, DQT, SOF0, DHT, DRI, SOS, EOI]);
    expect(result.bytes.equals(expected)).toBe(true);
    // The GPS payload is gone, and so is every byte of the two APP1 headers before SOS.
    expect(result.bytes.indexOf(Buffer.from(GPS_SENTINEL, "latin1"))).toBe(-1);
    expect(jpegCarriesMetadata(result.bytes)).toBe(false);
    // The input was not modified.
    expect(jpegCarriesMetadata(original)).toBe(true);
  });

  it("a JPEG with nothing to strip comes back byte-identical (still walked, still a copy)", () => {
    const clean = jpeg(JFIF, DQT, SOF0, DHT);
    const result = stripJpegMetadata(clean);
    expect(result.ok && result.bytes.equals(clean)).toBe(true);
    if (result.ok) {
      expect(result.removed).toEqual([]);
      expect(result.bytes).not.toBe(clean);
    }
  });

  it("stops parsing at SOS — the entropy-coded scan is copied verbatim whatever it contains", () => {
    const withExif = jpeg(EXIF, DQT, SOF0, DHT);
    const result = stripJpegMetadata(withExif);
    if (!result.ok) throw new Error(result.reason);
    // The scan section (from SOS on) is unchanged, including its Exif-looking bytes.
    const sosAt = result.bytes.indexOf(Buffer.from([0xff, 0xda]));
    expect(result.bytes.subarray(sosAt).equals(Buffer.concat([SOS, EOI]))).toBe(true);
  });

  it("a truncated or malformed JPEG is a refusal, never a partial file passed off as clean", () => {
    const truncated = jpeg(EXIF, DQT).subarray(0, 12);
    const r1 = stripJpegMetadata(truncated);
    expect(r1.ok).toBe(false);
    // A length word pointing past the end of the file.
    const bad = Buffer.concat([SOI, Buffer.from([0xff, 0xe1, 0xff, 0xff, 0x45, 0x78])]);
    const r2 = stripJpegMetadata(bad);
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.reason).toMatch(/past the end/);
    // No SOS at all.
    const noScan = Buffer.concat([SOI, DQT, SOF0]);
    expect(stripJpegMetadata(noScan).ok).toBe(false);
    // Not a JPEG.
    expect(stripJpegMetadata(Buffer.from("hello")).ok).toBe(false);
  });
});

describe("stripImageMetadata — the entry point every caller uses", () => {
  const PNG = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64"
  );
  const WEBP = Buffer.concat([
    Buffer.from("RIFF", "latin1"),
    Buffer.from([0x1a, 0, 0, 0]),
    Buffer.from("WEBPVP8 ", "latin1"),
    Buffer.alloc(14, 0),
  ]);

  it("detects the format from the bytes, not from the declared type", () => {
    expect(detectImageFormat(jpeg(JFIF, DQT))).toBe("jpeg");
    expect(detectImageFormat(PNG)).toBe("png");
    expect(detectImageFormat(WEBP)).toBe("webp");
    expect(detectImageFormat(Buffer.from("plain text"))).toBe("unknown");
    // A JPEG that claims to be a PNG is still stripped.
    const lied = stripImageMetadata(jpeg(EXIF, DQT, SOF0, DHT), "image/png");
    expect(lied.ok && lied.stripped && lied.format === "jpeg").toBe(true);
  });

  it("strips PNG and refuses malformed WebP instead of forwarding metadata", () => {
    const png = stripImageMetadata(PNG);
    expect(png.ok && png.stripped && png.format === "png").toBe(true);
    expect(stripImageMetadata(WEBP).ok).toBe(false);
  });
});
