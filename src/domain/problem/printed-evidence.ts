import { z } from 'zod';

export const PRINTED_READER_VERSION = 'printed-evidence-v1/tesseract.js@7.0.0/eng@1.0.0/45b4cb346724ac1774f1c36f42f182b887bcdb28ebe63e6fff90ac41f3fcff91';
const Bbox = z.object({ x0: z.number().int().nonnegative(), y0: z.number().int().nonnegative(), x1: z.number().int().positive(), y1: z.number().int().positive() }).strict();
export const OcrLines = z.object({
  reader_version: z.literal(PRINTED_READER_VERSION),
  width: z.number().int().min(1).max(1800), height: z.number().int().min(1).max(1800),
  lines: z.array(z.object({ text: z.string().max(240), confidence: z.number().min(0).max(100), bbox: Bbox }).strict()).max(100),
}).strict().superRefine((data, ctx) => {
  if (data.lines.some(({ bbox: b }) => b.x0 >= b.x1 || b.y0 >= b.y1 || b.x1 > data.width || b.y1 > data.height)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid prepared-image bounds' });
  }
});
export type OcrLines = z.infer<typeof OcrLines>;
export type PrintedFieldKey = 'thermostat_mode' | 'fan_mode' | 'setpoint' | 'room_temperature' | 'filter_nominal_dimensions';
export type PrintedField = {
  value: string; unit: 'F' | 'C' | 'in' | null; confidence: number;
  basis: 'ocr_transcription'; source_media: [string];
  // Coordinates identify the OCR preparation, not the original photo.
  prepared_image: { width: number; height: number; bbox: z.infer<typeof Bbox> };
};
export type PrintedEvidenceResult = {
  reader_version: typeof PRINTED_READER_VERSION;
  outcome: 'readable' | 'unreadable' | 'unavailable';
  evidence_id: string; image_sha256: string | null;
  fields: Record<PrintedFieldKey, PrintedField | null>;
  gaps: Array<{ field: PrintedFieldKey; reason: 'not_legible' | 'ambiguous' | 'reader_unavailable' }>;
};
export const PRINTED_FIELD_KEYS: PrintedFieldKey[] = ['thermostat_mode', 'fan_mode', 'setpoint', 'room_temperature', 'filter_nominal_dimensions'];

export function emptyPrintedEvidence(evidenceId: string, hash: string | null, outcome: 'unreadable' | 'unavailable'): PrintedEvidenceResult {
  return { outcome, reader_version: PRINTED_READER_VERSION, evidence_id: evidenceId, image_sha256: hash,
    fields: { thermostat_mode: null, fan_mode: null, setpoint: null, room_temperature: null, filter_nominal_dimensions: null },
    gaps: PRINTED_FIELD_KEYS.map(field => ({ field, reason: outcome === 'unavailable' ? 'reader_unavailable' : 'not_legible' })),
  };
}

/** Narrow transcription grammar. Unlabelled digits, diagram legends, equipment
 * model codes, filter dirt, ice and rotating/sounding equipment are not facts.
 * An accepted OCR value is still an unconfirmed reading, never diagnosis. */
export function normalizePrintedEvidence(raw: unknown, evidenceId: string, hash: string): PrintedEvidenceResult {
  const parsed = OcrLines.safeParse(raw);
  if (!parsed.success) return emptyPrintedEvidence(evidenceId, hash, 'unavailable');
  const { width, height, lines } = parsed.data;
  const result = emptyPrintedEvidence(evidenceId, hash, 'unreadable');
  const candidates = new Map<PrintedFieldKey, PrintedField[]>();
  const ambiguous = new Set<PrintedFieldKey>();
  function add(field: PrintedFieldKey, value: string, unit: PrintedField['unit'], line: OcrLines['lines'][number]) {
    if (line.confidence < 85) { ambiguous.add(field); return; }
    const list = candidates.get(field) ?? [];
    list.push({ value, unit, confidence: line.confidence / 100, basis: 'ocr_transcription', source_media: [evidenceId], prepared_image: { width, height, bbox: line.bbox } });
    candidates.set(field, list);
  }
  for (const line of lines) {
    const text = line.text.trim().toUpperCase().replace(/\s+/g, ' ');
    const mode = /^(?:SYSTEM|MODE|SYSTEM MODE)\s*[:=]?\s*(COOL|HEAT|AUTO|OFF)$/.exec(text);
    if (mode) add('thermostat_mode', mode[1].toLowerCase(), null, line);
    else if (/^(?:SYSTEM|MODE)\b/.test(text)) ambiguous.add('thermostat_mode');
    const fan = /^FAN(?: MODE)?\s*[:=]?\s*(AUTO|ON|CIRCULATE)$/.exec(text);
    if (fan) add('fan_mode', fan[1].toLowerCase(), null, line);
    else if (/^FAN\b/.test(text)) ambiguous.add('fan_mode');
    for (const [field, label] of [['setpoint', '(?:SETPOINT|SET TO|SET TEMP)'], ['room_temperature', '(?:ROOM|INSIDE|ROOM TEMP|INDOOR TEMP)']] as const) {
      const match = new RegExp(`^${label}\\s*[:=]?\\s*(-?\\d{1,3}(?:\\.\\d)?)\\s*°?\\s*(F|C)$`).exec(text);
      if (match) {
        const value = Number(match[1]);
        const unit = match[2] as 'F' | 'C';
        if ((unit === 'F' && value >= 32 && value <= 120) || (unit === 'C' && value >= 0 && value <= 50)) add(field, String(value), unit, line);
        else ambiguous.add(field);
      } else if (new RegExp(`^${label}\\b`).test(text)) ambiguous.add(field);
    }
    // Require the label to explicitly say nominal. Actual rack measurements
    // and rounded actual dimensions cannot safely become a purchase size.
    const size = /^NOMINAL(?: SIZE| DIMENSIONS)?\s*[:=]?\s*(\d{1,2}(?:\.\d{1,2})?)\s*[X×]\s*(\d{1,2}(?:\.\d{1,2})?)\s*[X×]\s*(\d{1,2}(?:\.\d{1,2})?)\s*(?:IN|INCH|INCHES|")$/.exec(text);
    if (size) {
      const dimensions = size.slice(1, 4).map(Number);
      if (dimensions.every(value => value > 0 && value <= 60) && dimensions[2] <= 12) add('filter_nominal_dimensions', dimensions.join(' x '), 'in', line);
      else ambiguous.add('filter_nominal_dimensions');
    } else if (/^NOMINAL\b/.test(text)) ambiguous.add('filter_nominal_dimensions');
  }
  result.gaps = [];
  for (const field of PRINTED_FIELD_KEYS) {
    const list = candidates.get(field) ?? [];
    const distinct = new Set(list.map(item => `${item.value}|${item.unit}`));
    if (!ambiguous.has(field) && distinct.size === 1) result.fields[field] = list.sort((a, b) => b.confidence - a.confidence)[0];
    else result.gaps.push({ field, reason: ambiguous.has(field) || distinct.size > 1 ? 'ambiguous' : 'not_legible' });
  }
  if (Object.values(result.fields).some(Boolean)) result.outcome = 'readable';
  return result;
}
