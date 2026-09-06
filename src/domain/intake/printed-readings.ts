import type { PrintedEvidenceResult, PrintedFieldKey } from '@/domain/problem/printed-evidence';

export const PRINTED_INTAKE_KEYS = {
  thermostat_mode: 'thermostat_mode', fan_mode: 'fan_mode', setpoint: 'thermostat_setpoint',
  room_temperature: 'room_temp', filter_nominal_dimensions: 'filter_nominal_dimensions',
} as const;

/** The authored upload target supplies the role. Text on an unrelated image
 * cannot turn a generic door photo into a thermostat or filter inspection. */
export function printedKeysForTarget(target: string): PrintedFieldKey[] {
  if (target === 'thermostat_photo') return ['thermostat_mode', 'fan_mode', 'setpoint', 'room_temperature'];
  if (target === 'step:filter') return ['filter_nominal_dimensions'];
  return [];
}

export function printedAnswers(target: string, read: PrintedEvidenceResult) {
  const keys = printedKeysForTarget(target);
  const answers: Array<{ field_key: string; value_text: string | null }> = [];
  const confidence: Record<string, 'medium'> = {};
  const summary: string[] = [];
  const labels = { thermostat_mode: 'Mode', fan_mode: 'Fan', setpoint: 'Setpoint', room_temperature: 'Room', filter_nominal_dimensions: 'Nominal size' };
  for (const key of keys) {
    const field = read.fields[key];
    const value = field ? `${field.value}${field.unit ? ` ${field.unit}` : ''}` : null;
    const field_key = PRINTED_INTAKE_KEYS[key];
    answers.push({ field_key, value_text: value });
    if (value !== null) {
      // OCR confidence measures characters, not the truth of a household
      // condition. Keep the authored confirmation control in the journey.
      confidence[field_key] = 'medium';
      summary.push(`${labels[key]}: ${value}`);
    }
  }
  if (target === 'thermostat_photo') {
    answers.push({ field_key: target, value_text: summary.length ? summary.join('; ') : null });
    if (summary.length) confidence[target] = 'medium';
  }
  return { answers, confidence, extraction_status: summary.length ? 'readable' as const
    : read.outcome === 'unavailable' ? 'failed' as const : 'unreadable' as const };
}

export function printedFieldGap(fieldKey: string, read: PrintedEvidenceResult): string | null {
  const key = (Object.keys(PRINTED_INTAKE_KEYS) as PrintedFieldKey[]).find(key => PRINTED_INTAKE_KEYS[key] === fieldKey);
  return key ? read.gaps.find(gap => gap.field === key)?.reason ?? null : null;
}
