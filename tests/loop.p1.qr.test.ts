import { describe, expect, it } from "vitest";
import {
  alignmentPositions,
  chooseVersion,
  encodeQr,
  numDataCodewords,
  numRawDataModules,
  qrSvg,
  rsDivisor,
  rsRemainder,
  type EcLevel,
  type QrSymbol,
} from "@/domain/packet/qr";

/**
 * THE QR ENCODER, CHECKED BY AN INDEPENDENT READER (track P1). The reader
 * below is written from the symbol side of the specification, not from the
 * encoder: it recovers the mask from the format information (BCH-checked),
 * unmasks, rebuilds the function-module map on its own, walks the zigzag,
 * de-interleaves the blocks, verifies every block against the Reed–Solomon
 * generator (a zero remainder) and finally parses the byte segment. A bug in
 * placement, format bits, interleaving or ECC shows up here as a decode
 * failure rather than an encoder that agrees with itself.
 *
 * Known vectors: the ISO/IEC 18004 capacity table for level M (byte mode),
 * and the standard's own alignment-pattern coordinates.
 */

function bit(x: number, i: number): number {
  return (x >>> i) & 1;
}

function decodeFormat(sym: QrSymbol): { ecl: EcLevel; mask: number } {
  // Read the first copy of the format bits from around the top-left finder.
  const m = sym.modules;
  const bits: number[] = [];
  for (let i = 0; i <= 5; i++) bits.push(m[i][8] ? 1 : 0);
  bits.push(m[7][8] ? 1 : 0);
  bits.push(m[8][8] ? 1 : 0);
  bits.push(m[8][7] ? 1 : 0);
  for (let i = 9; i < 15; i++) bits.push(m[8][14 - i] ? 1 : 0);
  let word = 0;
  for (let i = 0; i < 15; i++) word |= bits[i] << i;
  word ^= 0x5412;
  // BCH check: the 10-bit remainder must match the 5 data bits.
  const data = word >>> 10;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  expect(word & 0x3ff).toBe(rem & 0x3ff);
  const eclBits = data >>> 3;
  const ecl: EcLevel = eclBits === 1 ? "L" : "M";
  expect([0, 1]).toContain(eclBits);
  return { ecl, mask: data & 7 };
}

function functionMap(size: number, version: number): boolean[][] {
  const f = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const mark = (x: number, y: number) => {
    if (x >= 0 && y >= 0 && x < size && y < size) f[y][x] = true;
  };
  for (let i = 0; i < size; i++) {
    mark(6, i);
    mark(i, 6);
  }
  const finder = (cx: number, cy: number) => {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) mark(cx + dx, cy + dy);
  };
  finder(3, 3);
  finder(size - 4, 3);
  finder(3, size - 4);
  const align = alignmentPositions(version);
  const n = align.length;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) mark(align[i] + dx, align[j] + dy);
    }
  }
  // format information areas: 9 modules beside the top-left finder on each
  // axis, 8 beside the other two (the 8th on the bottom-left is the dark module)
  for (let i = 0; i <= 8; i++) {
    mark(8, i);
    mark(i, 8);
  }
  for (let i = 0; i < 8; i++) {
    mark(size - 1 - i, 8);
    mark(8, size - 1 - i);
  }
  if (version >= 7) {
    for (let i = 0; i < 18; i++) {
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      mark(a, b);
      mark(b, a);
    }
  }
  return f;
}

function maskBit(mask: number, x: number, y: number): boolean {
  switch (mask) {
    case 0: return (x + y) % 2 === 0;
    case 1: return y % 2 === 0;
    case 2: return x % 3 === 0;
    case 3: return (x + y) % 3 === 0;
    case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5: return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    default: return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
  }
}

const ECC_M = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28];
const BLOCKS_M = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49];
const ECC_L = [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30];
const BLOCKS_L = [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25];

/** Independent reader: returns the decoded text, asserting every RS block is clean. */
function readQr(sym: QrSymbol): string {
  const { ecl, mask } = decodeFormat(sym);
  const size = sym.size;
  const fn = functionMap(size, sym.version);
  const bits: number[] = [];
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!fn[y][x]) {
          const dark = sym.modules[y][x] !== maskBit(mask, x, y);
          bits.push(dark ? 1 : 0);
        }
      }
    }
  }
  const codewords: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    let v = 0;
    for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j];
    codewords.push(v);
  }
  // De-interleave.
  const numBlocks = (ecl === "M" ? BLOCKS_M : BLOCKS_L)[sym.version];
  const eccLen = (ecl === "M" ? ECC_M : ECC_L)[sym.version];
  const raw = Math.floor(numRawDataModules(sym.version) / 8);
  const numShort = numBlocks - (raw % numBlocks);
  const shortLen = Math.floor(raw / numBlocks);
  const blocks: number[][] = Array.from({ length: numBlocks }, () => []);
  let k = 0;
  for (let i = 0; i < shortLen + 1; i++) {
    for (let b = 0; b < numBlocks; b++) {
      if (i === shortLen - eccLen && b < numShort) continue; // short blocks have no such data byte
      blocks[b].push(codewords[k++]);
    }
  }
  // Every block: data followed by ecc; remainder of the whole block by the generator is zero.
  const divisor = rsDivisor(eccLen);
  const data: number[] = [];
  blocks.forEach((block, b) => {
    const rem = rsRemainder(block, divisor);
    expect(rem.every((r) => r === 0), `block ${b} has a non-zero RS remainder`).toBe(true);
    data.push(...block.slice(0, block.length - eccLen));
  });
  // Parse the byte segment.
  let pos = 0;
  const take = (n: number) => {
    let v = 0;
    for (let i = 0; i < n; i++) {
      v = (v << 1) | bit(data[pos >>> 3], 7 - (pos & 7));
      pos++;
    }
    return v;
  };
  expect(take(4)).toBe(0b0100);
  const len = take(sym.version <= 9 ? 8 : 16);
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = take(8);
  return new TextDecoder().decode(bytes);
}

describe("P1 · QR encoder", () => {
  it("matches the ISO 18004 byte-mode capacities at level M for versions 1–10", () => {
    // Known vector: data codewords per version at level M (the standard's table 7).
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((v) => numDataCodewords(v, "M"))).toEqual([16, 28, 44, 64, 86, 108, 124, 154, 182, 216]);
    // Alignment pattern coordinates, versions 2, 7 and 14 (the standard's table E.1).
    expect(alignmentPositions(2)).toEqual([6, 18]);
    expect(alignmentPositions(7)).toEqual([6, 22, 38]);
    expect(alignmentPositions(14)).toEqual([6, 26, 46, 66]);
    expect(chooseVersion(30, "M")).toBe(3);
    expect(chooseVersion(200, "M")).toBe(10);
  });

  it("round-trips a short URL, a ~220-character signed link, a single byte and UTF-8 through the independent reader", () => {
    const signed =
      "http://localhost:3111/keep/eyJ2IjoxLCJpZCI6ImxrX0FCQ0RFRkdISUpLTE1OT1BRUlNUVVYiLCJzIjoia2VlcCIsInIiOiJycV8xMjM0NTY3OC0xMjM0LTEyMzQtMTIzNC0xMjM0NTY3ODkwMTIiLCJ4Ijp7fSwiZSI6IjIwMjYtMTItMDRUMTI6MDA6MDAuMDAwWiJ9.abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG";
    for (const text of ["https://golive.com/keep/4821-A", signed, "A", "Hello, world! ✓ ünïcödé", "x".repeat(400)]) {
      for (const ecl of ["M", "L"] as const) {
        const sym = encodeQr(text, ecl);
        expect(sym.size).toBe(sym.version * 4 + 17);
        expect(readQr(sym)).toBe(text);
      }
    }
    expect(encodeQr(signed, "M").version).toBeGreaterThanOrEqual(10);
  });

  it("emits crisp inline SVG that inherits the page's ink colour", () => {
    const svg = qrSvg("https://golive.com/ask/4821-A", { quiet: 0 });
    expect(svg.startsWith("<svg ")).toBe(true);
    expect(svg).toContain('shape-rendering="crispEdges"');
    expect(svg).toContain('fill="currentColor"');
    expect(svg).not.toContain("<script");
  });
});
