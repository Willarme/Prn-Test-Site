import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ACTIVE_DISCLOSURE } from '@/domain/privacy/disclosures';
import { MemoryAiPolicyStore, setAiPolicyStoreForTests } from '@/platform/ai/policy-store';
import { MemorySpendLedger, setSpendLedgerForTests } from '@/platform/ai/spend';
import { startIntake } from '@/platform/intake/start';
import { loadJourneyContext } from '@/platform/intake/complete';
import { intakeReadiness } from '@/platform/intake/readiness';
import { __setLabelReaderForTests, readLabelReadings } from '@/platform/intake/media';
import { resetRuntimeStore, runtimeStore } from '@/platform/stores/runtime';
import { signLink } from '@/platform/links/tokens';
import { POST as mediaPost } from '@/app/api/intake/media/route';
import { POST as answerPost } from '@/app/api/intake/answer/route';

let dir: string;
const network = vi.fn(() => { throw new Error('No external service in synthetic image journeys'); });
const label = vi.fn(async () => ({ ok: false as const, reason: 'Synthetic unavailable label reader' }));
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 't6-printed-intake-'));
  vi.stubEnv('PRN_RUNTIME_STORE', 'file'); vi.stubEnv('PRN_DEV_DB_PATH', join(dir, 'db.json'));
  vi.stubEnv('PRN_AI_LIVE_TESTS', '0'); vi.stubGlobal('fetch', network);
  resetRuntimeStore(); setAiPolicyStoreForTests(new MemoryAiPolicyStore()); setSpendLedgerForTests(new MemorySpendLedger());
  label.mockClear(); __setLabelReaderForTests(label);
});
afterEach(() => {
  expect(network).not.toHaveBeenCalled(); __setLabelReaderForTests(undefined); resetRuntimeStore();
  setAiPolicyStoreForTests(null); setSpendLedgerForTests(null); vi.unstubAllEnvs(); vi.unstubAllGlobals();
  rmSync(dir, { recursive: true, force: true });
});
async function start() {
  const result = await startIntake({ description: 'My AC is not cooling', source: 'door_form', disclosure_content_hash: ACTIVE_DISCLOSURE.content_hash,
    attribution: { landing_path: '/start', problem_family_hint: 'hvac-cooling', page_id: null, intent_cluster_id: null,
      search_opportunity_id: null, experiment_id: null, variant: null, referrer: null } });
  expect(result.kind).toBe('started'); if (result.kind !== 'started') throw new Error('Synthetic start failed'); return result.request_id;
}
async function pixels(lines: string[]) {
  const text = lines.map((line, index) => `<text x="55" y="${85 + index * 95}" font-family="Arial" font-size="52" fill="black">${line}</text>`).join('');
  return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="600"><rect width="100%" height="100%" fill="white"/>${text}</svg>`)).png().toBuffer();
}
async function photo(id: string, target: string, bytes: Buffer) {
  const form = new FormData(); form.set('request_id', id); form.set('k', signLink({ scope: 'keep', request_id: id })); form.set('target', target);
  form.set('file', new File([new Uint8Array(bytes)], 'synthetic-reading.png', { type: 'image/png' }));
  const response = await mediaPost(new Request('http://localhost/api/intake/media', { method: 'POST', body: form }));
  const body = await response.json(); expect(response.status, JSON.stringify(body)).toBe(200); return body.evidence_id as string;
}
async function state(id: string) { const ctx = await loadJourneyContext(id); expect(ctx).not.toBeNull(); return intakeReadiness(ctx!); }

describe('actual printed pixels through authenticated intake, persistence and readiness', () => {
  it('reads mode, fan and temperatures from the actual uploaded image and retains unconfirmed provenance after reload', async () => {
    const id = await start(); const evidence = await photo(id, 'thermostat_photo', await pixels(['SYSTEM: COOL', 'FAN: AUTO', 'SETPOINT: 72 F', 'ROOM: 81 F']));
    expect(label).not.toHaveBeenCalled();
    const record = (await readLabelReadings(id))![0];
    expect(record).toMatchObject({ evidence_id: evidence, extraction_status: 'readable', target: 'thermostat_photo', run_id: null });
    expect(record.printed_evidence).toMatchObject({ image_sha256: expect.stringMatching(/^[a-f0-9]{64}$/), fields: {
      thermostat_mode: { value: 'cool', source_media: [evidence] }, fan_mode: { value: 'auto' }, setpoint: { value: '72', unit: 'F' }, room_temperature: { value: '81', unit: 'F' } } });
    resetRuntimeStore(); const current = await state(id);
    for (const [key, value] of Object.entries({ thermostat_mode: 'cool', fan_mode: 'auto', thermostat_setpoint: '72 F', room_temp: '81 F' })) {
      expect(current.facts.fields[key]).toMatchObject({ value, claim_class: 'INFERRED', confidence: 'medium', confirmed: false, evidence_ids: [evidence] });
    }
    expect(current.screen.questions.some(question => question.source_key === 'thermostat_photo' && question.input_type === 'confirm')).toBe(true);
    const summary = current.facts.fields.thermostat_photo.value;
    const confirmed = await answerPost(new Request('http://localhost/api/intake/answer', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ request_id: id, k: signLink({ scope: 'keep', request_id: id }), fields: [{ field_key: 'thermostat_photo', value: summary, confirmed: true }] }) }));
    expect(confirmed.status, await confirmed.text()).toBe(200);
    const after = await state(id);
    for (const key of ['thermostat_mode', 'fan_mode', 'thermostat_setpoint', 'room_temp']) expect(after.facts.fields[key]).toMatchObject({ confirmed: true, status: 'CONFIRMED', evidence_ids: [evidence] });
    expect(after.ledger.effort_spent).toBe(9);
    await runtimeStore().saveIntakeAnswers([{ request_id: id, field_key: 'fan_mode', value_text: 'on', source: 'typed',
      evidence_id: null, answered_at: new Date().toISOString() }]);
    const correctedText = 'Mode: heat; Setpoint: 23 C; Room: 21 C';
    const corrected = await answerPost(new Request('http://localhost/api/intake/answer', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ request_id: id, k: signLink({ scope: 'keep', request_id: id }), fields: [{ field_key: 'thermostat_photo', value: correctedText }] }) }));
    expect(corrected.status, await corrected.text()).toBe(200);
    const final = await state(id);
    expect(final.facts.fields.thermostat_photo).toMatchObject({ value: correctedText, confirmed: false, claim_class: 'SUPPLIED' });
    for (const key of ['thermostat_mode', 'thermostat_setpoint', 'room_temp']) expect(final.facts.fields[key]).toMatchObject({ value: null, confirmed: false, claim_class: 'SUPPLIED' });
    expect(final.facts.fields.fan_mode).toMatchObject({ value: 'on', confirmed: false, claim_class: 'SUPPLIED' });
    const ctx = await loadJourneyContext(id);
    const { buildDirectionsInput } = await import('@/domain/packet/directions-input');
    const packet = buildDirectionsInput({ ...ctx!, answers: final.answers, diagnosis: final.diagnosis, claims: final.claims,
      evidence: ctx!.allEvidence, address: null }, { link_base: 'http://localhost', media_link: null });
    expect(packet.evidence.readings?.thermostat_setpoint).toMatchObject({ value: '23 C', unit: 'C', provenance: 'reported' });
    expect(packet.evidence.readings?.room_temp_f).toBeUndefined();
    expect(packet.evidence.readings?.fan_mode).toMatchObject({ value: 'on', provenance: 'reported' });
    const { loadPacket } = await import('@/platform/packet/load');
    const loaded = await loadPacket(id, { link_base: 'http://localhost', owner: false });
    expect(loaded?.input?.evidence.media).toContainEqual(expect.objectContaining({ id: evidence, subject: 'Thermostat display', location: null }));
    expect(loaded?.input?.narrative.timeline.map(row => row.text)).toContain('Thermostat display photographed.');
    expect(loaded?.input?.narrative.timeline.map(row => row.text)).not.toContain('Equipment label photographed.');
  }, 30000);

  it('preserves partial Celsius readings and makes missing fields explicit gaps', async () => {
    const id = await start(); await photo(id, 'thermostat_photo', await pixels(['SETPOINT: 24 C', 'ROOM: 28 C']));
    const current = await state(id);
    expect(current.facts.fields.thermostat_setpoint, JSON.stringify((await readLabelReadings(id)))).toMatchObject({ value: '24 C', confirmed: false });
    expect(current.facts.fields.room_temp).toMatchObject({ value: '28 C', confirmed: false });
    for (const key of ['fan_mode', 'thermostat_mode']) expect(current.facts.fields[key]).toMatchObject({ value: null, status: 'UNREADABLE', reason: expect.any(String) });
  }, 30000);

  it('reads only nominal filter dimensions on the authorized filter step without inventing a dirt rating', async () => {
    const id = await start(); const evidence = await photo(id, 'step:filter', await pixels(['NOMINAL SIZE: 16 x 20 x 1 IN', 'SYSTEM: COOL']));
    const current = await state(id);
    expect(current.facts.fields.filter_nominal_dimensions).toMatchObject({ value: '16 x 20 x 1 in', claim_class: 'INFERRED', confirmed: false, evidence_ids: [evidence] });
    expect(current.facts.fields.thermostat_mode).toBeUndefined();
    expect((await runtimeStore().listDiagnosisAnswers(id)).find(answer => answer.step_id === 'filter')?.answer).toBeNull();
    expect(label).not.toHaveBeenCalled();
    const { loadPacket } = await import('@/platform/packet/load');
    const loaded = await loadPacket(id, { link_base: 'http://localhost', owner: false });
    expect(loaded?.input?.evidence.media).toContainEqual(expect.objectContaining({ id: evidence, subject: 'Filter', location: null }));
    expect(loaded?.input?.narrative.timeline.map(row => row.text)).toContain('Filter photographed.');
  }, 30000);

  it('preserves a homeowner reading instead of overwriting it with a later image', async () => {
    const id = await start();
    await runtimeStore().saveIntakeAnswers([{ request_id: id, field_key: 'thermostat_setpoint', value_text: '75 F', evidence_id: null, source: 'typed', answered_at: new Date().toISOString() }]);
    await photo(id, 'thermostat_photo', await pixels(['SETPOINT: 72 F']));
    expect((await state(id)).facts.fields.thermostat_setpoint).toMatchObject({ value: '75 F', claim_class: 'SUPPLIED' });
  }, 30000);

  it('retains corrupt image failure as unknown while keeping the original upload', async () => {
    const id = await start(); const evidence = await photo(id, 'thermostat_photo', Buffer.from('synthetic corrupt PNG'));
    expect((await readLabelReadings(id))?.[0]).toMatchObject({ extraction_status: 'failed', printed_evidence: { outcome: 'unavailable' } });
    expect((await state(id)).facts.fields.thermostat_photo).toMatchObject({ value: null, status: 'UNKNOWN_AFTER_REASONABLE_ATTEMPT' });
    expect((await loadJourneyContext(id))?.allEvidence.some(item => item.evidence_id === evidence)).toBe(true);
  }, 30000);

  it('does not give a generic door image a thermostat role from its text', async () => {
    const id = await start(); await photo(id, 'door_photo', await pixels(['SYSTEM: COOL', 'SETPOINT: 72 F']));
    expect(label).toHaveBeenCalledTimes(1);
    expect((await state(id)).facts.fields.thermostat_mode).toBeUndefined();
    expect((await readLabelReadings(id))?.[0].printed_evidence).toBeUndefined();
  });
});
