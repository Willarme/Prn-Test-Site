import type { EvidenceObject } from "@/domain/problem/contracts";
import type { IntakeAnswer } from "@/domain/intake/playbook";
import { findPlaybook } from "@/domain/intake/playbooks";
import { buildDirectionsInput } from "@/domain/packet/directions-input";
import type { EvidenceBlock, Reading } from "@/domain/packet/types";
import { loadJourneyContext } from "@/platform/intake/complete";
import { readKeepState, type KeepState } from "@/platform/links/ledger";
import { runtimeStore, type Journey } from "@/platform/stores/runtime";
import type { AskAnswer, JobAddress, KeepClaim } from "@/platform/stores/interfaces";

/**
 * THE RECORD, READ FOR A LINK (track P3). Everything /keep, /ask and /media
 * show comes through here, so the three surfaces cannot drift apart on what
 * a "fact", a "photo" or a "moment" is. Pages call this; no page reads the
 * store directly (docs/canon/AUTHORITY.md: pages call capabilities).
 *
 * Each page then takes the SUBSET its audience may see:
 *   /keep  the homeowner's own record, all of it;
 *   /ask   the first observed statement, nothing else;
 *   /media the photos and video plus the statement, no contact, no address.
 */
export interface RecordFact {
  label: string;
  value: string;
  /** Provenance in the homeowner's words. */
  source: string;
}

export interface RecordMoment {
  at: string;
  what: string;
}

export interface RecordView {
  request_id: string;
  journey: Journey;
  /** "your AC" for the cooling door; "your home" when the request came in some other way. */
  thing: string;
  statement: string;
  summary: string;
  facts: RecordFact[];
  media: EvidenceObject[];
  moments: RecordMoment[];
  address: JobAddress | null;
  keepClaim: KeepClaim | null;
  keepState: KeepState | null;
  askAnswers: AskAnswer[];
}

const FIELD_LABELS: Record<string, string> = {
  brand: "Brand",
  unit_model_serial: "Model and serial number",
  system_age: "Age",
  symptom_timing: "When it started",
  thermostat_photo: "Thermostat",
  thermostat_mode: "Thermostat mode",
  fan_mode: "Fan setting",
  thermostat_setpoint: "Set temperature",
  room_temp: "Room temperature",
  filter_nominal_dimensions: "Printed filter size",
  printed_cooling_capacity: "Printed cooling capacity",
};

const FIELD_ALIASES: Record<string, string> = {
  thermostat_reading: "thermostat_photo", thermostat_setpoint_f: "thermostat_setpoint", room_temp_f: "room_temp",
};
const THERMOSTAT_FIELDS = ["thermostat_mode", "fan_mode", "thermostat_setpoint", "room_temp"] as const;

/** Only the short labeled display summary duplicates the component rows.
 * Freeform observations remain visible as the homeowner's literal notes. */
function readingOnlySummary(value: string | null | undefined, readings: EvidenceBlock["readings"]): boolean {
  const clauses = value?.split(/[;,\n]+/).map(part => part.trim()).filter(Boolean) ?? [];
  const seen = new Set<string>();
  const compact = (text: string) => text.replace(/[\s°]/g, "").toLowerCase();
  return clauses.length > 0 && clauses.every(part => {
    const mode = /^(?:thermostat\s+)?mode\s*:?\s*(cool|heat|off|auto)$/i.exec(part);
    const fan = /^fan(?:\s+mode)?\s*:?\s*(auto|on|circulate)$/i.exec(part);
    const temperature = /^(setpoint|set|target|room(?:\s+temperature)?)\s*:?\s*(-?\d+(?:\.\d+)?\s*°?\s*[FC]?)$/i.exec(part);
    const field = mode ? "thermostat_mode" : fan ? "fan_mode" : temperature
      ? /^room/i.test(temperature[1]) ? "room_temp" : "thermostat_setpoint" : null;
    if (!field || seen.has(field)) return false;
    seen.add(field);
    const reading = readings?.[field];
    if (!reading) return false;
    let represented = String(reading.value);
    if (temperature && reading.unit && /^-?\d+(?:\.\d+)?$/.test(represented)) represented += reading.unit;
    return compact(mode?.[1] ?? fan?.[1] ?? temperature![2]) === compact(represented);
  });
}

const SOURCE_WORDS: Record<string, string> = {
  photo: "from your photo",
  typed: "you typed it",
  auto_detected: "from your own words",
  customer_text: "from your own words",
  inference: "worked out from what you said",
  confirmed: "you confirmed it",
};

export function sourceWords(source: string): string {
  return SOURCE_WORDS[source] ?? source.replace(/_/g, " ");
}

export function thingNoun(journey: Journey): string {
  const pb = journey.session.playbook_id ?? "";
  const cat = (journey.problem.service_category ?? "").toLowerCase();
  if (pb.startsWith("pb_hvac_cooling") || /cool|hvac|air.?condition/.test(cat)) return "your AC";
  return "your home";
}

export function recordFacts(details: Journey["packet"]["collected_details"], answers: IntakeAnswer[], playbookId: string | null,
  readings?: EvidenceBlock["readings"], evidence: EvidenceObject[] = []): RecordFact[] {
  const facts: RecordFact[] = [];
  const seen = new Set<string>();
  const fields = playbookId ? findPlaybook(playbookId)?.required_fields ?? [] : [];
  const normalize = (label: string) => label.trim().toLowerCase();
  const canonical = (key: string) => FIELD_ALIASES[key] ?? key;
  const fieldForLabel = (label: string): string | undefined => {
    const normalized = normalize(label);
    const key = fields.find(field => normalize(field.label) === normalized || field.field_key === normalized)?.field_key
      ?? Object.entries(FIELD_LABELS).find(([key, value]) => key === normalized || normalize(value) === normalized)?.[0];
    return key ? canonical(key) : FIELD_ALIASES[normalized];
  };
  const labelForField = (key: string) => key === "thermostat_photo" && hasReadings ? "Thermostat notes"
    : FIELD_LABELS[key] ?? fields.find(field => field.field_key === key)?.label ?? "Additional detail";
  const latest = new Map<string, IntakeAnswer>();
  const supplied = (answer: IntakeAnswer) => answer.source === "typed" || answer.source === "confirmed";
  for (const answer of [...answers].sort((a, b) => Date.parse(a.answered_at) - Date.parse(b.answered_at))) {
    const key = canonical(answer.field_key), previous = latest.get(key);
    // Stored answers are the current record, even before packet regeneration.
    // A later automated read cannot replace a homeowner's correction.
    if (previous && (supplied(previous) && !supplied(answer) || answer.value_text === null && !supplied(answer))) continue;
    latest.set(key, answer);
  }
  const hasReadings = THERMOSTAT_FIELDS.some(key => readings?.[key]);
  const hasReadingHistory = [...latest.keys()].some(field => field === "thermostat_photo" || THERMOSTAT_FIELDS.some(key => key === field));
  const projected = (field: string, value?: string | null) => readings !== undefined && (hasReadingHistory || hasReadings) &&
    (THERMOSTAT_FIELDS.some(key => key === field) || field === "thermostat_photo" && hasReadings &&
      readingOnlySummary(latest.has(field) ? latest.get(field)!.value_text : value, readings));
  for (const d of details ?? []) {
    const field = fieldForLabel(d.label);
    const key = field ? `field:${field}` : `label:${normalize(d.label)}`;
    if (seen.has(key) || field && projected(field, d.value)) continue;
    seen.add(key);
    const answer = field ? latest.get(field) : undefined;
    const value = answer ? answer.value_text : d.value;
    if (value) facts.push({ label: field ? labelForField(field) : d.label, value, source: sourceWords(answer?.source ?? d.source) });
  }
  // Answers the packet has not folded in yet (a photo read moments ago).
  for (const [field, a] of latest) {
    if (!a.value_text || projected(field, a.value_text)) continue;
    const key = `field:${field}`;
    if (seen.has(key)) continue;
    seen.add(key);
    facts.push({ label: labelForField(field), value: a.value_text, source: sourceWords(a.source) });
  }
  // Reuse the packet's current reading projection: it binds split/compound
  // aliases to their evidence and does not borrow an older value after a correction.
  for (const field of THERMOSTAT_FIELDS) {
    const reading: Reading | undefined = readings?.[field];
    if (!reading) continue;
    let value = String(reading.value);
    if (field === "thermostat_setpoint" || field === "room_temp") {
      if (reading.unit && /^-?\d+(?:\.\d+)?$/.test(value)) value += `°${reading.unit}`;
      else if (!reading.unit) value += " (unit not supplied)";
    }
    const fromPhoto = evidence.some(item => item.evidence_id === reading.source_media && item.kind === "photo");
    const source = reading.provenance === "inference" ? fromPhoto ? "from your photo; not confirmed" : "not confirmed"
      : reading.confirmed_by_homeowner ? "you confirmed it" : "you reported it";
    facts.push({ label: labelForField(field), value, source });
  }
  return facts;
}

function momentsFrom(
  journey: Journey,
  media: EvidenceObject[],
  keepClaim: KeepClaim | null,
  keepState: KeepState | null,
  asks: AskAnswer[],
  thing: string
): RecordMoment[] {
  const moments: RecordMoment[] = [
    { at: journey.problem.created_at, what: `You said what ${thing} is doing` },
  ];
  for (const m of media) {
    if (m.kind !== "photo" && m.kind !== "video" && m.kind !== "voice_note") continue;
    const what =
      m.kind === "video" ? "Video added" : m.kind === "voice_note" ? "Voice note added" : "Photo added";
    moments.push({ at: m.captured_at, what });
  }
  moments.push({
    at: journey.packet.generated_at,
    what: `Job Packet built, version ${journey.packet.packet_version}`,
  });
  for (const a of asks) {
    moments.push({ at: a.created_at, what: `${a.friend_name} sent a name: ${a.provider_name}` });
  }
  if (keepClaim) moments.push({ at: keepClaim.claimed_at, what: "You asked to keep this record" });
  if (keepState?.confirmed_at) moments.push({ at: keepState.confirmed_at, what: "Kept" });
  return moments.sort((a, b) => a.at.localeCompare(b.at));
}

export async function loadRecordView(requestId: string): Promise<RecordView | null> {
  const ctx = await loadJourneyContext(requestId);
  if (!ctx) return null;
  const store = runtimeStore();
  const [answers, address, keepClaim, askAnswers] = await Promise.all([
    store.listIntakeAnswers(requestId),
    store.getJobAddress(requestId),
    store.getKeepClaim(requestId),
    store.listAskAnswers(requestId),
  ]);
  const recordedKeep = (await readKeepState(requestId));
  const keepState = recordedKeep && recordedKeep.magic_id === keepClaim?.magic_link_id
    ? recordedKeep : recordedKeep ? { ...recordedKeep, confirmed_at: null } : null;
  const { journey } = ctx;
  const readings = buildDirectionsInput({ ...ctx, answers, address, askAnswers, diagnosis: [], claims: [], evidence: ctx.allEvidence },
    { link_base: "", media_link: null, now: journey.packet.generated_at }).evidence.readings;
  const thing = thingNoun(journey);
  const media = ctx.allEvidence.filter((e) => e.kind === "photo" || e.kind === "video");
  const statement =
    journey.packet.observed_statements[0] ?? ctx.textEvidence.content ?? journey.packet.summary_plain;
  return {
    request_id: requestId,
    journey,
    thing,
    statement,
    summary: journey.packet.summary_plain,
    facts: recordFacts(journey.packet.collected_details, answers, journey.session.playbook_id ?? null, readings, ctx.allEvidence),
    media,
    moments: momentsFrom(journey, ctx.allEvidence, keepClaim, keepState, askAnswers, thing),
    address,
    keepClaim,
    keepState,
    askAnswers,
  };
}

// ---------------------------------------------------------------------------
// Contact helpers shared by /api/keep and the pages
// ---------------------------------------------------------------------------

export type ContactKind = "email" | "phone";

/** One field, email or phone. Null when it is neither. */
export function classifyContact(raw: string): { kind: ContactKind; value: string } | null {
  const value = raw.trim();
  if (!value || value.length > 320) return null;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) return { kind: "email", value: value.toLowerCase() };
  const digits = value.replace(/[^\d+]/g, "");
  if (/^\+?\d{7,15}$/.test(digits) && /^[\d\s()+.-]+$/.test(value)) return { kind: "phone", value: digits };
  return null;
}

/** j***@example.com / ***4567. Enough to recognise, too little to copy. */
export function maskContact(contact: string, kind: ContactKind): string {
  if (kind === "email") {
    const [user, domain] = contact.split("@");
    return `${user.slice(0, 1)}***@${domain ?? ""}`;
  }
  return `***${contact.slice(-4)}`;
}

/** The request origin, for links a message carries (routine decision 9). */
export function linkBase(request: Request): string {
  // An arbitrary Origin header must never choose where a secret link points.
  return new URL(request.url).origin;
}

export function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
