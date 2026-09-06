import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { emptyPrintedEvidence, normalizePrintedEvidence, type PrintedEvidenceResult } from '@/domain/problem/printed-evidence';

const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 128 * 1024;
const TIMEOUT_MS = 20_000;
let occupied = false;

/** Local Node process adapter. The shared intake calls this only for authored
 * printed-reading targets, with trusted evidence identity after consent/storage.
 * No provider calls, remote weights, raw OCR logging, or image persistence.
 * A separate process bounds native/WASM work and kills its worker on timeout.
 * One in-flight read per host process; busy callers get an explicit gap. */
export async function readPrintedEvidence(input: { evidence_id: string; image: Uint8Array }): Promise<PrintedEvidenceResult> {
  const validIdentity = typeof input.evidence_id === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(input.evidence_id);
  const validImage = input.image instanceof Uint8Array && input.image.byteLength > 0 && input.image.byteLength <= MAX_IMAGE_BYTES;
  if (!validIdentity || !validImage) return emptyPrintedEvidence(validIdentity ? input.evidence_id : '', null, 'unavailable');
  const image = Buffer.from(input.image);
  const hash = createHash('sha256').update(image).digest('hex');
  const unavailable = () => emptyPrintedEvidence(input.evidence_id, hash, 'unavailable');
  if (occupied) return unavailable();
  occupied = true;
  try {
    const raw = await new Promise<unknown>((resolve, reject) => {
      const env: NodeJS.ProcessEnv = { NODE_ENV: 'production' };
      // Do not inherit API keys, NODE_OPTIONS, proxy variables or custom paths.
      let child: ReturnType<typeof spawn>;
      try {
        child = spawn(process.execPath, [path.join(process.cwd(), 'tools', 'ocr-printed-evidence.mjs')], {
          env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch {
        occupied = false; // spawn threw before returning a child.
        reject(new Error('OCR_UNAVAILABLE'));
        return;
      }
      let size = 0;
      const chunks: Buffer[] = [];
      let failed = false;
      const fail = () => {
        if (failed) return;
        failed = true;
        clearTimeout(timer);
        try { child.kill('SIGKILL'); } catch { /* Retain occupancy until close. */ }
        reject(new Error('OCR_UNAVAILABLE'));
      };
      const timer = setTimeout(fail, TIMEOUT_MS);
      child.on('error', fail);
      child.stdin!.on('error', fail);
      child.stdout!.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_OUTPUT_BYTES) fail();
        else chunks.push(chunk);
      });
      child.stderr!.resume();
      child.on('close', code => {
        clearTimeout(timer);
        occupied = false;
        if (failed || code !== 0) { reject(new Error('OCR_UNAVAILABLE')); return; }
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch { reject(new Error('OCR_UNAVAILABLE')); }
      });
      child.stdin!.end(image);
    });
    return normalizePrintedEvidence(raw, input.evidence_id, hash);
  } catch {
    return unavailable();
  }
}
