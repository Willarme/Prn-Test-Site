/**
 * A MINIMAL QR ENCODER — byte mode, any version 1–40, error-correction level
 * M (default) or L, rendered as inline SVG. Written for the two scan targets
 * on packet page 1 (Directions §4.4 / §4.5) with NO new npm dependency
 * (campaign track P1 ownership rule).
 *
 * Why not "version 1–6 is enough": the packet's links are SIGNED tokens
 * (tokens.ts — a base64url payload plus an HMAC), so a Home Memory URL is
 * ~200 characters, which is version 10–12 at level M. The encoder therefore
 * carries the full block tables rather than a short-URL subset.
 *
 * The algorithm is ISO/IEC 18004 as it is usually implemented: data segment,
 * terminator and pad bytes; Reed–Solomon over GF(2^8) with the 0x11D field
 * polynomial; block interleaving; function patterns; format and version
 * information; mask selection by the four penalty rules. tests/loop.p1.qr
 * decodes the output with an independent reader written in the test.
 */

export type EcLevel = "L" | "M";

const FORMAT_BITS: Record<EcLevel, number> = { L: 1, M: 0 };

// ECC codewords per block, indexed by version (index 0 unused).
const ECC_PER_BLOCK: Record<EcLevel, readonly number[]> = {
  L: [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  M: [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
};

// Number of error-correction blocks, indexed by version (index 0 unused).
const NUM_BLOCKS: Record<EcLevel, readonly number[]> = {
  L: [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  M: [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
};

export function numRawDataModules(ver: number): number {
  let result = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const numAlign = Math.floor(ver / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (ver >= 7) result -= 36;
  }
  return result;
}

export function numDataCodewords(ver: number, ecl: EcLevel): number {
  return Math.floor(numRawDataModules(ver) / 8) - ECC_PER_BLOCK[ecl][ver] * NUM_BLOCKS[ecl][ver];
}

function byteModeCapacity(ver: number, ecl: EcLevel): number {
  const countBits = ver <= 9 ? 8 : 16;
  return Math.floor((numDataCodewords(ver, ecl) * 8 - 4 - countBits) / 8);
}

/** The smallest version whose byte-mode capacity holds `bytes`. */
export function chooseVersion(bytes: number, ecl: EcLevel): number {
  for (let v = 1; v <= 40; v++) if (byteModeCapacity(v, ecl) >= bytes) return v;
  throw new Error(`qr: ${bytes} bytes does not fit in any version at level ${ecl}`);
}

// ---------------------------------------------------------------------------
// GF(256) Reed–Solomon
// ---------------------------------------------------------------------------

function gfMul(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

export function rsDivisor(degree: number): number[] {
  const result: number[] = new Array(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = gfMul(result[j], root);
      if (j + 1 < degree) result[j] ^= result[j + 1];
    }
    root = gfMul(root, 2);
  }
  return result;
}

export function rsRemainder(data: readonly number[], divisor: readonly number[]): number[] {
  const result: number[] = new Array(divisor.length).fill(0);
  for (const b of data) {
    const factor = b ^ (result.shift() as number);
    result.push(0);
    divisor.forEach((coef, i) => {
      result[i] ^= gfMul(coef, factor);
    });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Codewords
// ---------------------------------------------------------------------------

export function dataCodewords(bytes: Uint8Array, ver: number, ecl: EcLevel): number[] {
  const bits: number[] = [];
  const push = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, ver <= 9 ? 8 : 16);
  for (const b of bytes) push(b, 8);
  const capacity = numDataCodewords(ver, ecl) * 8;
  push(0, Math.min(4, capacity - bits.length));
  while (bits.length % 8 !== 0) bits.push(0);
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) push(pad, 8);
  const out: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let v = 0;
    for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j];
    out.push(v);
  }
  return out;
}

export function addEccAndInterleave(data: readonly number[], ver: number, ecl: EcLevel): number[] {
  const numBlocks = NUM_BLOCKS[ecl][ver];
  const blockEccLen = ECC_PER_BLOCK[ecl][ver];
  const rawCodewords = Math.floor(numRawDataModules(ver) / 8);
  const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
  const shortBlockLen = Math.floor(rawCodewords / numBlocks);
  const blocks: number[][] = [];
  const divisor = rsDivisor(blockEccLen);
  let k = 0;
  for (let i = 0; i < numBlocks; i++) {
    const datLen = shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1);
    const dat = data.slice(k, k + datLen);
    k += datLen;
    const ecc = rsRemainder(dat, divisor);
    if (i < numShortBlocks) dat.push(0);
    blocks.push(dat.concat(ecc));
  }
  const result: number[] = [];
  for (let i = 0; i < blocks[0].length; i++) {
    blocks.forEach((block, j) => {
      if (i !== shortBlockLen - blockEccLen || j >= numShortBlocks) result.push(block[i]);
    });
  }
  return result;
}

// ---------------------------------------------------------------------------
// The symbol
// ---------------------------------------------------------------------------

export interface QrSymbol {
  version: number;
  size: number;
  mask: number;
  ecl: EcLevel;
  /** modules[y][x] — true is dark. */
  modules: boolean[][];
}

export function alignmentPositions(ver: number): number[] {
  if (ver === 1) return [];
  const numAlign = Math.floor(ver / 7) + 2;
  const size = ver * 4 + 17;
  const step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (numAlign * 2 - 2)) * 2;
  const result: number[] = [6];
  for (let pos = size - 7; result.length < numAlign; pos -= step) result.splice(1, 0, pos);
  return result;
}

function getBit(x: number, i: number): boolean {
  return ((x >>> i) & 1) !== 0;
}

class Builder {
  readonly size: number;
  readonly modules: boolean[][];
  readonly isFunction: boolean[][];

  constructor(readonly version: number) {
    this.size = version * 4 + 17;
    this.modules = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
    this.isFunction = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
  }

  private setFn(x: number, y: number, dark: boolean): void {
    this.modules[y][x] = dark;
    this.isFunction[y][x] = true;
  }

  drawFunctionPatterns(ecl: EcLevel): void {
    for (let i = 0; i < this.size; i++) {
      this.setFn(6, i, i % 2 === 0);
      this.setFn(i, 6, i % 2 === 0);
    }
    this.drawFinder(3, 3);
    this.drawFinder(this.size - 4, 3);
    this.drawFinder(3, this.size - 4);
    const align = alignmentPositions(this.version);
    const n = align.length;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue;
        this.drawAlignment(align[i], align[j]);
      }
    }
    this.drawFormatBits(ecl, 0);
    this.drawVersion();
  }

  private drawFinder(x: number, y: number): void {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        const xx = x + dx;
        const yy = y + dy;
        if (xx >= 0 && xx < this.size && yy >= 0 && yy < this.size) {
          this.setFn(xx, yy, dist !== 2 && dist !== 4);
        }
      }
    }
  }

  private drawAlignment(x: number, y: number): void {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        this.setFn(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
  }

  drawFormatBits(ecl: EcLevel, mask: number): void {
    const data = (FORMAT_BITS[ecl] << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;
    for (let i = 0; i <= 5; i++) this.setFn(8, i, getBit(bits, i));
    this.setFn(8, 7, getBit(bits, 6));
    this.setFn(8, 8, getBit(bits, 7));
    this.setFn(7, 8, getBit(bits, 8));
    for (let i = 9; i < 15; i++) this.setFn(14 - i, 8, getBit(bits, i));
    for (let i = 0; i < 8; i++) this.setFn(this.size - 1 - i, 8, getBit(bits, i));
    for (let i = 8; i < 15; i++) this.setFn(8, this.size - 15 + i, getBit(bits, i));
    this.setFn(8, this.size - 8, true);
  }

  private drawVersion(): void {
    if (this.version < 7) return;
    let rem = this.version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (this.version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const dark = getBit(bits, i);
      const a = this.size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      this.setFn(a, b, dark);
      this.setFn(b, a, dark);
    }
  }

  drawCodewords(data: readonly number[]): void {
    let i = 0;
    for (let right = this.size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < this.size; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? this.size - 1 - vert : vert;
          if (!this.isFunction[y][x] && i < data.length * 8) {
            this.modules[y][x] = getBit(data[i >>> 3], 7 - (i & 7));
            i++;
          }
        }
      }
    }
  }

  applyMask(mask: number): void {
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        if (this.isFunction[y][x]) continue;
        let invert: boolean;
        switch (mask) {
          case 0: invert = (x + y) % 2 === 0; break;
          case 1: invert = y % 2 === 0; break;
          case 2: invert = x % 3 === 0; break;
          case 3: invert = (x + y) % 3 === 0; break;
          case 4: invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
          case 5: invert = ((x * y) % 2) + ((x * y) % 3) === 0; break;
          case 6: invert = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; break;
          default: invert = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0; break;
        }
        if (invert) this.modules[y][x] = !this.modules[y][x];
      }
    }
  }

  penalty(): number {
    const N1 = 3, N2 = 3, N3 = 40, N4 = 10;
    let score = 0;
    const size = this.size;
    const m = this.modules;
    const finderRun = (hist: number[]) => {
      const n = hist[1];
      const core = n > 0 && hist[2] === n && hist[3] === n * 3 && hist[4] === n && hist[5] === n;
      return (core && hist[0] >= n * 4 && hist[6] >= n ? 1 : 0) + (core && hist[6] >= n * 4 && hist[0] >= n ? 1 : 0);
    };
    // Nayuki's run-history scoring: the newest run sits at hist[0], and a run
    // touching the symbol edge is treated as bordered by the light quiet zone.
    const lineScore = (get: (i: number) => boolean) => {
      let s = 0;
      let runColor = false;
      let runX = 0;
      const hist = [0, 0, 0, 0, 0, 0, 0];
      const addHist = (len: number) => {
        if (hist[0] === 0) len += size;
        hist.pop();
        hist.unshift(len);
      };
      for (let i = 0; i < size; i++) {
        const c = get(i);
        if (c === runColor) {
          runX++;
          if (runX === 5) s += N1;
          else if (runX > 5) s++;
        } else {
          addHist(runX);
          if (!runColor) s += finderRun(hist) * N3;
          runColor = c;
          runX = 1;
        }
      }
      if (runColor) {
        addHist(runX);
        runX = 0;
      }
      addHist(runX + size);
      s += finderRun(hist) * N3;
      return s;
    };
    for (let y = 0; y < size; y++) score += lineScore((x) => m[y][x]);
    for (let x = 0; x < size; x++) score += lineScore((y) => m[y][x]);
    for (let y = 0; y < size - 1; y++) {
      for (let x = 0; x < size - 1; x++) {
        const c = m[y][x];
        if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) score += N2;
      }
    }
    let dark = 0;
    for (const row of m) for (const c of row) if (c) dark++;
    const total = size * size;
    const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
    score += k * N4;
    return score;
  }
}

export function encodeQr(text: string, ecl: EcLevel = "M", minVersion = 1): QrSymbol {
  const bytes = new TextEncoder().encode(text);
  const version = Math.max(minVersion, chooseVersion(bytes.length, ecl));
  const data = addEccAndInterleave(dataCodewords(bytes, version, ecl), version, ecl);
  const b = new Builder(version);
  b.drawFunctionPatterns(ecl);
  b.drawCodewords(data);
  let best = -1;
  let bestPenalty = Number.POSITIVE_INFINITY;
  for (let mask = 0; mask < 8; mask++) {
    b.applyMask(mask);
    b.drawFormatBits(ecl, mask);
    const p = b.penalty();
    if (p < bestPenalty) {
      bestPenalty = p;
      best = mask;
    }
    b.applyMask(mask); // undo (XOR is its own inverse)
  }
  b.applyMask(best);
  b.drawFormatBits(ecl, best);
  return { version, size: b.size, mask: best, ecl, modules: b.modules.map((r) => [...r]) };
}

/**
 * Inline SVG, crisp at any size: one path of unit squares on a `size`-unit
 * viewBox with a 4-module quiet zone. Colours are inherited from CSS
 * (`fill: currentColor`) so the mockup's ink token paints it.
 */
export function qrSvg(text: string, opts: { ecl?: EcLevel; quiet?: number; title?: string } = {}): string {
  const sym = encodeQr(text, opts.ecl ?? "M");
  const quiet = opts.quiet ?? 4;
  const dim = sym.size + quiet * 2;
  const parts: string[] = [];
  for (let y = 0; y < sym.size; y++) {
    for (let x = 0; x < sym.size; x++) {
      if (sym.modules[y][x]) parts.push(`M${x + quiet} ${y + quiet}h1v1h-1z`);
    }
  }
  const title = opts.title ? `<title>${escapeXml(opts.title)}</title>` : "";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}" shape-rendering="crispEdges" role="img" aria-label="QR code">` +
    `${title}<rect width="${dim}" height="${dim}" fill="#fff"/><path d="${parts.join("")}" fill="currentColor"/></svg>`
  );
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
