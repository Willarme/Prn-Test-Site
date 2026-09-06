/* global process, Buffer, URL */
import './ocr-offline-guard.mjs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { createWorker, PSM } from 'tesseract.js';

const require = createRequire(import.meta.url);
const chunks = [];
let bytes = 0;
let worker;
try {
  for await (const chunk of process.stdin) {
    bytes += chunk.length;
    if (bytes > 6 * 1024 * 1024) throw new Error('INPUT_LIMIT');
    chunks.push(chunk);
  }
  const input = Buffer.concat(chunks);
  const image = sharp(input, { limitInputPixels: 8_000_000, failOn: 'warning' });
  const metadata = await image.metadata();
  if (!['png', 'jpeg', 'webp'].includes(metadata.format) || (metadata.pages ?? 1) !== 1) {
    throw new Error('UNSUPPORTED_IMAGE');
  }
  // Rotation uses EXIF once; the new PNG discards all metadata. Coordinates
  // below refer to this prepared image, never incorrectly to the original.
  const prepared = await image.rotate().resize({ width: 1800, height: 1800, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' }).grayscale().normalize().png().toBuffer({ resolveWithObject: true });
  const langPath = join(dirname(require.resolve('@tesseract.js-data/eng/package.json')), '4.0.0_best_int');
  const weightsHash = createHash('sha256').update(readFileSync(join(langPath, 'eng.traineddata.gz'))).digest('hex');
  const readerVersion = `printed-evidence-v1/tesseract.js@${require('tesseract.js/package.json').version}/eng@${require('@tesseract.js-data/eng/package.json').version}/${weightsHash}`;
  worker = await createWorker('eng', 1, {
    langPath,
    workerPath: fileURLToPath(new URL('./ocr-worker.mjs', import.meta.url)),
    cacheMethod: 'none', gzip: true,
    errorHandler: () => {},
  });
  await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
  const { data } = await worker.recognize(prepared.data, {}, { blocks: true });
  const allLines = (data.blocks ?? []).flatMap(block => block.paragraphs.flatMap(paragraph => paragraph.lines));
  // Truncation could discard a contradictory setting or unit. Refuse the
  // entire read instead of silently certifying only a prefix of the image.
  if (allLines.length > 100 || allLines.some(line => line.text.length > 240)) throw new Error('OCR_OUTPUT_LIMIT');
  const lines = allLines.map(line => ({
      text: line.text,
      confidence: Math.min(line.confidence, ...line.words.map(word => word.confidence)),
      bbox: line.bbox,
    }));
  process.stdout.write(JSON.stringify({ reader_version: readerVersion, width: prepared.info.width, height: prepared.info.height, lines }));
} catch {
  // No source image, extracted text, filesystem path, or provider error in logs.
  process.exitCode = 1;
} finally {
  if (worker) await worker.terminate();
}
