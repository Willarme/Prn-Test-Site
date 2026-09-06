import type { DiagnosisAnswer, IntakeAnswer, IntakePlaybook } from "@/domain/intake/playbook";
import type { EvidenceObject, FactClaim } from "@/domain/problem/contracts";
import type { AskAnswer, JobAddress, Journey } from "@/platform/stores/runtime";
import {
  DEFAULT_TIME_ZONE,
  WEEKDAYS_LONG,
  daysBefore,
  isoDate,
  wallClock,
  weekdayDayMon,
  type WallClock,
} from "@/domain/packet/dates";
import {
  HVAC_COOLING_TITLE,
  HVAC_LABELS_SET,
  HVAC_SERVICE_HISTORY_IDS,
  HVAC_COOLING_TECHNICIAN_ONLY,
  hvacCoolingBranches,
  hvacCoolingChecks,
  hvacCoolingFacts,
  hvacCoolingScopeFactors,
  hvacCoolingScriptParts,
  hvacCoolingSummary,
  hvacCoolingUnknowns,
  type HvacCoolingView,
} from "@/domain/packet/knowledge-hvac-cooling";
import { ageSpoken } from "@/domain/packet/script";
import type {
  AccessBlock,
  AccessKey,
  DirectionsInput,
  EvidenceBlock,
  Fact,
  MediaItem,
  OnsetCharacter,
  Provenance,
  Reading,
  ScriptParts,
  ServiceHistoryAnswer,
  TimelineRow,
  Trade,
  Valued,
} from "@/domain/packet/types";
import { decideUrgency } from "@/domain/packet/urgency";
import { redactSharedText } from "@/domain/privacy/share-text";
import { fieldConflictText, heldFieldConflicts } from "@/domain/intake/field-conflicts";

/**
 * JOURNEY → DIRECTIONS INPUT (campaign track P1, 2026-09-05).
 *
 * The one place the repo's stored journey — ProblemRecord, playbook,
 * IntakeAnswers, DiagnosisAnswers, EvidenceObjects, FactClaims, the job
 * address — is mapped onto the ten-key ProblemRecord JSON the Directions
 * describe (§3). It ASKS nothing, INFERS nothing beyond what the knowledge
 * file licenses, and INVENTS nothing: a value with no recorded source becomes
 * the honest-absent state, and the renderer prints that state.
 *
 * DEVIATION FROM THE DIRECTIONS, RECORDED: §3.4 builds `home_memory_url` as
 * `link_base + "/keep/" + packet.id`. Here the two URLs are SIGNED,
 * revocable links (src/platform/links/tokens.ts, scope `keep` / `ask`) minted
 * by the caller and passed in `opts`, because a plain id in a URL is a
 * guessable capability and decisions 7/8 rule that out. `packet.id` still
 * appears in the meta block; the self-check counts it there and counts one
 * keep and one ask link instead of two id occurrences.
 *
 * DEFAULTS TAKEN (logged for the report):
 *   - routine decision 10: the address is REQUIRED; when absent the route
 *     shows the address form first. This builder does not halt — it returns a
 *     property block with empty strings and the renderer refuses (§3.3 Halt).
 *   - routine decision 12: a voice note is listed as evidence, one item.
 *   - routine decision 7A: the provider media link comes in `opts.media_link`.
 *   - The display time zone for `Z` timestamps: America/New_York.
 */
export interface LabelReadRow {
  evidence_id: string;
  confidence: Record<string, "high" | "medium" | "low">;
}

export interface DirectionsBuildContext {
  journey: Journey;
  playbook: IntakePlaybook;
  textEvidence: EvidenceObject;
  allEvidence: EvidenceObject[];
  address: JobAddress | null;
  answers: IntakeAnswer[];
  diagnosis: DiagnosisAnswer[];
  claims: FactClaim[];
  evidence: EvidenceObject[];
  askAnswers?: AskAnswer[];
  /** Rows of data/runtime/label-reads/<request_id>.json, read by the route. */
  label_reads?: LabelReadRow[] | null;
  /** evidence_id → data: URI, when the route could read the stored bytes. */
  thumbnails?: Record<string, string>;
}

export interface DirectionsBuildOptions {
  link_base: string;
  media_link: string | null;
  /** The signed links. When absent the Directions' plain form is used. */
  home_memory_url?: string;
  trust_network_url?: string;
  /** Generation moment; defaults to now. Tests pin it. */
  now?: string;
  time_zone?: string;
}

/** Track P4's "I cannot reach it" markers, on a step or on a field. */
export const CANNOT_REACH_STEP = "cannot_reach";
export const CANNOT_REACH_FIELD = "__cannot_reach__";

// Printed-reader answers are independent observations, not diagnostic checks.
// Treat the historical Fahrenheit keys as aliases when choosing corrections.
const PRINTED_READING_GROUPS: Record<string, string> = {
  thermostat_mode: "thermostat_mode", fan_mode: "fan_mode",
  thermostat_setpoint: "thermostat_setpoint", thermostat_setpoint_f: "thermostat_setpoint",
  room_temp: "room_temp", room_temp_f: "room_temp",
  filter_nominal_dimensions: "filter_nominal_dimensions",
  printed_cooling_capacity: "printed_cooling_capacity",
  thermostat_photo: "thermostat_reading", thermostat_reading: "thermostat_reading",
};

function homeownerAnswer(answer: IntakeAnswer): boolean {
  return answer.source === "typed" || answer.source === "confirmed";
}

function printedReading(answer: IntakeAnswer, value: string): Reading {
  return {
    value,
    provenance: answer.source === "photo" || answer.source === "auto_detected" ? "inference"
      : answer.source === "confirmed" ? "confirmed_by_homeowner" : "reported",
    source_media: answer.evidence_id,
    ...(answer.source === "confirmed" ? { confirmed_by_homeowner: true } : {}),
  };
}

function temperatureUnit(value: string, key: string, source: IntakeAnswer["source"]): "F" | "C" | null {
  const match = /^-?\d+(?:\.\d+)?\s*°?\s*([FC])?$/i.exec(value);
  if (!match) return null;
  if (match[1]) return match[1].toUpperCase() as "F" | "C";
  // Preserve the historical typed compound-display contract. An OCR value
  // without a printed unit can never acquire Fahrenheit through this fallback.
  return key.endsWith("_f") || ((key === "thermostat_photo" || key === "thermostat_reading") && source !== "photo" && source !== "auto_detected") ? "F" : null;
}

// ---------------------------------------------------------------------------
// Small parsers
// ---------------------------------------------------------------------------

/** `rq_3f9a2c1b-…` → `3F9A-2C1B`. The short display form of the request id. */
export function shortPacketId(requestId: string): string {
  const hex = requestId.replace(/^rq_/, "").replace(/[^0-9a-f]/gi, "").toUpperCase();
  const head = hex.slice(0, 8).padEnd(8, "0");
  return `${head.slice(0, 4)}-${head.slice(4, 8)}`;
}

export function tradeFor(serviceCategory: string | null): Trade {
  switch (serviceCategory) {
    case "hvac":
    case "plumbing":
    case "roofing":
    case "electrical":
    case "appliance":
      return serviceCategory;
    case "water_heater":
    case "garage_door":
      return serviceCategory;
    default:
      return "generic";
  }
}

const MODEL_RE = /\bmodel\s*(?:no\.?|number|#)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9\-/]{3,})/i;
const SERIAL_RE = /\bserial\s*(?:no\.?|number|#)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9\-/]{3,})/i;
const CODE_RE = /\b(?=[A-Z0-9\-/]*\d)(?=[A-Z0-9\-/]*[A-Z])[A-Z0-9][A-Z0-9\-/]{4,}\b/g;

export function parseModelSerial(text: string): { model: string | null; serial: string | null } {
  const model = MODEL_RE.exec(text)?.[1] ?? null;
  const serial = SERIAL_RE.exec(text)?.[1] ?? null;
  if (model || serial) return { model, serial };
  const codes = text.toUpperCase().match(CODE_RE) ?? [];
  return { model: codes[0] ?? null, serial: codes[1] ?? null };
}

export function parseAge(text: string, nowYear: number): { age_years: number | null; manufacture_year: number | null } {
  const years = /(\d{1,2})\s*(?:years?|yrs?)/i.exec(text);
  const year = /\b((?:19|20)\d{2})\b/.exec(text);
  const manufacture_year = year ? Number(year[1]) : null;
  let age_years = years ? Number(years[1]) : null;
  if (age_years === null && manufacture_year !== null) {
    const derived = nowYear - manufacture_year;
    if (derived >= 0 && derived < 80) age_years = derived;
  }
  return { age_years, manufacture_year };
}

export function parseOnsetCharacter(text: string): OnsetCharacter | null {
  const t = text.toLowerCase();
  if (/\b(on and off|intermittent|comes and goes|sometimes|off and on)\b/.test(t)) return "intermittent";
  if (/\b(gradual|gradually|slowly|bit by bit|getting worse|over (a few|several|a couple of|\d+) days|worse each day)\b/.test(t)) return "gradual";
  if (/\b(sudden|suddenly|all at once|all of a sudden|out of nowhere|just stopped|overnight|quit)\b/.test(t)) return "sudden";
  return null;
}

/** Days between "now" and when the homeowner says it started, from their words. */
export function parseOnsetSpanDays(text: string, now: WallClock): number | null {
  const t = text.toLowerCase();
  if (/\b(today|this morning|this afternoon|tonight|an hour ago|hours ago)\b/.test(t)) return 0;
  if (/\b(yesterday|last night)\b/.test(t)) return 1;
  const days = /\b(\d+)\s*days?\b/.exec(t);
  if (days) return Number(days[1]);
  const spelledDays = /\b(a couple of|couple|two|three|four|five|six)\s+days?\b/.exec(t);
  if (spelledDays) {
    const n = { "a couple of": 2, couple: 2, two: 2, three: 3, four: 4, five: 5, six: 6 }[spelledDays[1]];
    if (n) return n;
  }
  if (/\b(a week|one week|last week)\b/.test(t)) return 7;
  if (/\b(two weeks|couple of weeks|2 weeks)\b/.test(t)) return 14;
  const wd = /\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/.exec(t);
  if (wd) {
    const target = WEEKDAYS_LONG.findIndex((w) => w.toLowerCase() === wd[1]);
    const diff = (now.weekday - target + 7) % 7;
    return diff;
  }
  return null;
}

const PHONE_RE = /(\+?\d[\d\s().-]{7,}\d)/g;
const EMAIL_RE = /[\w.+-]+@[\w-]+(\.[\w-]+)+/g;

/** Strip contact details out of an access value (Directions §4.22). */
export function stripContactDetails(value: string): string {
  return value
    .replace(/\[(?:contact|access code) removed\]/gi, "")
    .replace(EMAIL_RE, "")
    .replace(PHONE_RE, "")
    .replace(/\s*,\s*(?:,\s*)+/g, ", ")
    .replace(/[,\s]+(?:or|and)\s*$/i, "")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s,;:-]+|[\s,;:.-]+$/g, "");
}

function provenanceForSource(source: string): Provenance {
  if (source === "photo") return "read_from_label";
  if (source === "confirmed") return "confirmed_by_homeowner";
  return "reported";
}

function yesNo(answer: string | null | undefined): "yes" | "no" | null {
  if (!answer) return null;
  const a = answer.trim().toLowerCase();
  if (a === "yes" || a === "y" || a === "true") return "yes";
  if (a === "no" || a === "n" || a === "false") return "no";
  return null;
}

function firstSentence(text: string): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  const m = /^(.+?[.!?])(\s|$)/.exec(cleaned);
  const s = (m ? m[1] : cleaned).replace(/[.!?]+$/, "");
  return s.length > 140 ? `${s.slice(0, 137).trimEnd()}…` : s;
}

function lowerFirst(s: string): string {
  if (!s) return s;
  if (/^I\b/.test(s)) return s;
  return s[0].toLowerCase() + s.slice(1);
}

/** Printable projection only. The stored original evidence is never changed. */
export function printablePacketText(value: string): string {
  return redactSharedText(value)
    .replace(/\$\s*\d[\d,]*(?:\.\d{1,2})?/g, "[amount omitted]")
    .replace(/\b\d[\d,]*(?:\.\d{1,2})?\s*(?:dollars|bucks|USD)\b/gi, "[amount omitted]");
}

// ---------------------------------------------------------------------------
// The builder
// ---------------------------------------------------------------------------

export function buildDirectionsInput(ctx: DirectionsBuildContext, opts: DirectionsBuildOptions): DirectionsInput {
  const tz = opts.time_zone ?? DEFAULT_TIME_ZONE;
  const nowIso = opts.now ?? new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const now = wallClock(nowIso, tz) ?? wallClock(new Date().toISOString(), tz)!;
  const { journey, playbook } = ctx;
  const requestId = journey.session.request_id;
  const isHvacCooling = playbook.playbook_id === "pb_hvac_cooling_v1";
  const trade = tradeFor(journey.problem.service_category);
  const homeownerWords = printablePacketText(ctx.textEvidence.content);
  const conflicts = heldFieldConflicts(ctx.answers, ctx.allEvidence, playbook.required_fields);
  const brandConflict = conflicts.find(c => c.field_key === "brand");
  const ageConflict = conflicts.find(c => c.field_key === "system_age");

  // --- answers, latest per field, with the cannot-reach markers -------------
  const ordered = [...ctx.answers].sort((a, b) => Date.parse(a.answered_at) - Date.parse(b.answered_at));
  const cannotReach = new Set<string>();
  const latest = new Map<string, IntakeAnswer>();
  const photoValues = new Map<string, string>();
  const confirmed = new Set<string>();
  const printedLatest = new Map<string, IntakeAnswer>();
  for (const a of ordered) {
    if (a.value_text === CANNOT_REACH_FIELD) {
      cannotReach.add(a.field_key);
      continue;
    }
    const printedGroup = PRINTED_READING_GROUPS[a.field_key];
    if (printedGroup) {
      const previous = printedLatest.get(printedGroup);
      // A later reader pass cannot replace a homeowner's correction, including
      // when it uses a different temperature alias. A blank OCR field cannot
      // erase a partial reading that was successfully retained earlier.
      if (previous && (homeownerAnswer(previous) && !homeownerAnswer(a) || a.value_text === null && !homeownerAnswer(a))) continue;
      printedLatest.set(printedGroup, a);
      if (previous) latest.delete(previous.field_key);
      latest.set(a.field_key, a);
      continue;
    }
    if (a.value_text === null) {
      // A photo answer with no text still tells us the field was photographed.
      if (!latest.has(a.field_key)) latest.set(a.field_key, a);
      continue;
    }
    const prev = latest.get(a.field_key);
    if (a.source === "photo") photoValues.set(a.field_key, a.value_text.trim().toLowerCase());
    if (
      (a.source === "typed" || (a.source as string) === "confirmed") &&
      photoValues.get(a.field_key) === a.value_text.trim().toLowerCase()
    ) {
      confirmed.add(a.field_key);
      // The value stays label-sourced; the confirmation is a flag on it.
      if (prev && prev.source === "photo") continue;
    }
    latest.set(a.field_key, a);
  }
  // A01's SUPPLIED claims are the same auto-detected values, kept as fallback.
  for (const c of ctx.claims) {
    if (c.claim_class === "SUPPLIED" && c.predicate && !latest.has(c.predicate) && !printedLatest.has(PRINTED_READING_GROUPS[c.predicate])) {
      latest.set(c.predicate, {
        request_id: requestId,
        field_key: c.predicate,
        value_text: c.object,
        evidence_id: c.evidence_ids[0] ?? null,
        source: "auto_detected",
        answered_at: c.created_at,
      });
    }
  }
  const text = (key: string): string | null => {
    const raw = latest.get(key)?.value_text?.trim();
    if (!raw) return null;
    return key === "unit_model_serial" ? raw : printablePacketText(raw);
  };
  const source = (key: string): string | null => latest.get(key)?.source ?? null;
  const valued = (key: string): Valued | null => {
    const v = text(key);
    if (!v) return null;
    return {
      value: v,
      provenance: provenanceForSource(source(key) ?? "typed"),
      ...(confirmed.has(key) ? { confirmed_by_homeowner: true } : {}),
    };
  };

  // --- diagnosis answers, replayed in order ---------------------------------
  const steps = new Map<string, DiagnosisAnswer>();
  for (const d of [...ctx.diagnosis].sort((a, b) => Date.parse(a.answered_at) - Date.parse(b.answered_at))) {
    if (d.answer === CANNOT_REACH_STEP) {
      cannotReach.add(d.step_id);
      continue;
    }
    steps.set(d.step_id, d);
  }
  const stepAnswer = (id: string): string | null => steps.get(id)?.answer?.trim() ?? null;
  const stepHasPhoto = (id: string): boolean => ctx.allEvidence.some((e) => e.evidence_id === steps.get(id)?.evidence_id && e.kind === "photo");
  const stepWasReported = (id: string): boolean => ctx.allEvidence.some((e) => e.evidence_id === steps.get(id)?.evidence_id && e.kind === "customer_text");

  // --- equipment -------------------------------------------------------------
  const modelSerialText = text("unit_model_serial");
  const modelSerial = modelSerialText ? parseModelSerial(modelSerialText) : { model: null, serial: null };
  const msProvenance = provenanceForSource(source("unit_model_serial") ?? "typed");
  const msConfirmed = confirmed.has("unit_model_serial");
  const ageText = text("system_age");
  const ageParsed = ageText ? parseAge(ageText, now.year) : { age_years: null, manufacture_year: null };
  const brand = valued("brand");
  const equipmentType = valued("equipment_type");

  // --- media -----------------------------------------------------------------
  const labelReadIds = new Set((ctx.label_reads ?? []).map((r) => r.evidence_id));
  const fieldLabel = (key: string) => playbook.required_fields.find((f) => f.field_key === key)?.label ?? null;
  const mediaSource = ctx.evidence.length > 0 ? ctx.evidence : ctx.allEvidence;
  const media: MediaItem[] = mediaSource
    .filter((e) => e.kind === "photo" || e.kind === "video" || e.kind === "voice_note")
    .sort((a, b) => Date.parse(a.captured_at) - Date.parse(b.captured_at))
    .map((e) => {
      const target = /^(?:local|private-evidence)\/[^/]+\/([^/]+)\//.exec(e.content)?.[1] ?? e.field_key ?? "";
      const readLabel = labelReadIds.has(e.evidence_id);
      let subject: string;
      let location: string | null = null;
      if (e.kind === "voice_note") subject = "Voice note (not transcribed)";
      else if (readLabel || target === "unit_model_serial") subject = "Equipment label";
      else if (target === "thermostat_photo") subject = "Thermostat display";
      else if (target === "step_outdoor_unit") subject = "Outdoor unit";
      else if (target === "step_power_check") {
        subject = "Outdoor disconnect";
      } else if (target === "step_filter" || target === "filter_photo") {
        subject = "Filter";
        location = "in situ";
      } else if (target === "problem_photo") subject = "Problem area";
      else if (target === "door_photo") {
        subject = "Unit";
        location = "as uploaded with the description";
      } else if (target === "door_video") subject = "as uploaded with the description";
      else subject = fieldLabel(target) ?? (e.kind === "video" ? "as uploaded" : "Photo");
      return {
        id: e.evidence_id,
        kind: e.kind as MediaItem["kind"],
        subject,
        location,
        captured_at: e.captured_at,
        duration_seconds: null,
        provenance: readLabel ? "read_from_label" : "seen_in_photo_or_video",
        thumbnail_data_uri: ctx.thumbnails?.[e.evidence_id] ?? null,
      };
    });
  const photoByTarget = (target: string) =>
    mediaSource.some((e) => e.kind === "photo" && new RegExp(`/${target}/`).test(e.content));

  // --- the knowledge view ------------------------------------------------------
  // Onset: the symptom_timing answer first; otherwise the homeowner's own
  // description, which is where "started slowly on Thursday" usually lives.
  const timingText = text("symptom_timing");
  const onsetSource = timingText ?? homeownerWords;
  const onsetCharacter = parseOnsetCharacter(onsetSource);
  // Relative timing belongs to the report that supplied it, never the render.
  const timingAt = timingText ? latest.get("symptom_timing")?.answered_at : ctx.textEvidence.captured_at;
  const reportedAt = wallClock(timingAt ?? journey.problem.created_at, tz) ?? wallClock(journey.problem.created_at, tz)!;
  const onsetSpan = reportedAt ? parseOnsetSpanDays(onsetSource, reportedAt) : null;
  const onsetClock = reportedAt && onsetSpan !== null ? daysBefore(reportedAt, onsetSpan) : null;
  const onsetWeekday = onsetClock && onsetSpan !== null && onsetSpan <= 6 ? WEEKDAYS_LONG[onsetClock.weekday] : null;

  const filterRatingRaw = stepAnswer("filter");
  const filterRating = filterRatingRaw !== null && /^\d{1,2}$/.test(filterRatingRaw) ? Number(filterRatingRaw) : null;
  const finsRaw = stepAnswer("fins_blocked")?.toLowerCase() ?? null;
  // The walkthrough also accepts one compound typed display reading. Extract
  // only explicitly labeled values; never infer a cool mode from this cluster.
  const readingKey = text("thermostat_photo") ? "thermostat_photo" : text("thermostat_reading") ? "thermostat_reading" : null;
  const thermostatReading = readingKey ? text(readingKey) : null;
  const readings: NonNullable<EvidenceBlock["readings"]> = {};
  const readingFields = new Map<string, string>();
  const recordReading = (outputKey: keyof typeof readings, keys: string[], fallback?: RegExp) => {
    // Presence, rather than a truthy value, matters: a homeowner can clear an
    // old reading, and the stale compound photo must not resurrect it.
    const explicitKey = keys.find(key => latest.has(key));
    const explicitAnswer = explicitKey ? latest.get(explicitKey) : null;
    const compoundAnswer = readingKey ? latest.get(readingKey) : null;
    const compoundValue = fallback ? thermostatReading?.match(fallback)?.[1]?.trim() : null;
    // The authored manual control also accepts a compound display answer.
    // Respect corrections made there as well as corrections to split fields.
    const useManualCompound = compoundValue && compoundAnswer?.source === "typed" &&
      (!explicitAnswer || !homeownerAnswer(explicitAnswer) || Date.parse(compoundAnswer.answered_at) > Date.parse(explicitAnswer.answered_at) ||
        (explicitAnswer.value_text === null && explicitAnswer.evidence_id === compoundAnswer.evidence_id && explicitAnswer.answered_at === compoundAnswer.answered_at));
    const key = useManualCompound ? readingKey : explicitKey ?? readingKey;
    const value = useManualCompound ? compoundValue : explicitKey ? text(explicitKey) : compoundValue;
    const answer = key ? latest.get(key) : null;
    if (!key || !answer || !value) return;
    let reading = printedReading(answer, value);
    if (answer.source === "auto_detected") {
      const suppliedText = ctx.allEvidence.find(evidence =>
        (evidence.kind === "customer_text" || evidence.kind === "voice_transcript") &&
        (evidence.evidence_id === answer.evidence_id || (!answer.evidence_id && answer.value_text && evidence.content.includes(answer.value_text))));
      if (suppliedText) reading = { ...reading, provenance: "reported", source_media: suppliedText.evidence_id };
    }
    if (key === readingKey && answer.source === "confirmed") {
      // The answer route expands a confirmed summary only after checking its
      // trusted extraction and each held component. Do not bypass that check
      // here by promoting parsed parts that have no component confirmation.
      const originalPhoto = ordered.findLast(item => item.source === "photo" &&
        PRINTED_READING_GROUPS[item.field_key] === "thermostat_reading" && item.value_text === answer.value_text);
      reading = { value, provenance: "inference", source_media: originalPhoto?.evidence_id ?? null };
    }
    if (outputKey === "thermostat_setpoint" || outputKey === "room_temp") {
      const unit = temperatureUnit(value, key, answer.source);
      if (unit) reading.unit = unit;
      if (unit === "F") {
        const legacyKey = outputKey === "thermostat_setpoint" ? "thermostat_setpoint_f" : "room_temp_f";
        readings[legacyKey] = { ...reading, value: Number.parseFloat(value) };
      }
    }
    readings[outputKey] = reading;
    readingFields.set(outputKey, key);
  };
  recordReading("thermostat_mode", ["thermostat_mode"], /\b(?:set\s+to|mode\s*[:=]?)\s*(cool|heat|off|auto)\b/i);
  recordReading("fan_mode", ["fan_mode"], /\bfan\s*[:=]?\s*(auto|on|circulate)\b/i);
  recordReading("thermostat_setpoint", ["thermostat_setpoint_f", "thermostat_setpoint"], /\b(?:set(?:point)?(?:\s+to)?(?:\s+(?:cool|heat|auto))?(?:\s+(?:at|to))?|target)\s*[:=]?\s*(-?\d+(?:\.\d+)?(?:\s*°?\s*[FC])?)\b/i);
  recordReading("room_temp", ["room_temp_f", "room_temp"], /\b(?:reads?|room(?:\s+temperature)?(?:\s+(?:is|at))?)\s*[:=]?\s*(-?\d+(?:\.\d+)?(?:\s*°?\s*[FC])?)\b/i);
  recordReading("filter_nominal_dimensions", ["filter_nominal_dimensions"]);
  recordReading("printed_cooling_capacity", ["printed_cooling_capacity"]);

  const thermostatKeys = ["thermostat_mode", "thermostat_setpoint", "room_temp"].map(key => readingFields.get(key) ?? null);
  const thermostatReadings = [readings.thermostat_mode, readings.fan_mode, readings.thermostat_setpoint, readings.room_temp].filter((r): r is Reading => Boolean(r));
  const thermostatProvenance: Provenance | null = thermostatReadings.length === 0 ? null
    : thermostatReadings.some(r => r.provenance === "inference") ? "inference"
    : thermostatReadings.every(r => r.confirmed_by_homeowner) ? "confirmed_by_homeowner" : "reported";
  const explicitMode = String(readings.thermostat_mode?.value ?? "").toLowerCase();
  const thermostatMode = /^(cool|heat|off|auto)$/.test(explicitMode) && readings.thermostat_mode?.provenance !== "inference" ? explicitMode : null;
  const knownFahrenheit = (reading: Reading | undefined): number | null =>
    reading?.unit === "F" && reading.provenance !== "inference" && typeof reading.value === "number" ? reading.value : null;
  const displayTemperature = (reading: Reading) => /^-?\d+(?:\.\d+)?$/.test(String(reading.value)) && reading.unit
    ? `${reading.value}°${reading.unit}` : String(reading.value);
  const thermostatDisplay = [
    readings.thermostat_mode ? String(readings.thermostat_mode.value) : null,
    readings.fan_mode ? `fan ${readings.fan_mode.value}` : null,
    readings.thermostat_setpoint ? `set ${displayTemperature(readings.thermostat_setpoint)}` : null,
    readings.room_temp ? `room ${displayTemperature(readings.room_temp)}` : null,
  ].filter(Boolean).join(", ");
  const safetyRaw = (text("safety_signals") ?? stepAnswer("safety_signals") ?? stepAnswer("safety_check"))?.toLowerCase() ?? null;
  const ventRaw = (text("vent_airflow") ?? stepAnswer("vent_airflow"))?.toLowerCase() ?? null;
  const filterAge = text("filter_age_weeks");

  const view: HvacCoolingView = {
    fact_sources: {
      homeowner: ["user_language"],
      fan: ["check:fan_moving", ...(yesNo(stepAnswer("fan_moving")) === "yes" && yesNo(stepAnswer("compressor_audible")) === "yes" ? ["check:compressor_audible"] : [])],
      thermostat: [...new Set(thermostatKeys.filter((key): key is string => key !== null))],
      vent: [text("vent_airflow") ? "vent_airflow" : "check:vent_airflow"],
      ice: [stepAnswer("ice_check") ? "check:ice_check" : "check:ice_on_line"],
      filter: ["check:filter", ...(filterRating !== null && filterAge && /^\d{1,3}$/.test(filterAge) ? ["filter_age_weeks"] : [])],
      fins: ["check:fins_blocked"],
      onset: [timingText ? "symptom_timing" : "user_language"],
      safety: [text("safety_signals") ? "safety_signals" : stepAnswer("safety_signals") ? "check:safety_signals" : "check:safety_check"],
      power: mediaSource.filter(e => e.kind === "photo" && (e.evidence_id === steps.get("power_check")?.evidence_id || /\/step_power_check\//.test(e.content)))
        .map(e => `evidence:${e.evidence_id}`),
    },
    homeowner_words: firstSentence(homeownerWords),
    filter_rating: filterRating,
    filter_reported_clean: filterRatingRaw === "reported_clean",
    filter_age_weeks: filterAge && /^\d{1,3}$/.test(filterAge) ? Number(filterAge) : null,
    filter_photo: photoByTarget("step_filter") || photoByTarget("filter_photo"),
    outdoor_photo: stepHasPhoto("outdoor_unit") || photoByTarget("step_outdoor_unit"),
    fan_moving: yesNo(stepAnswer("fan_moving")),
    fan_provenance: stepWasReported("fan_moving") ? "reported" : "confirmed_by_homeowner",
    fins: finsRaw === "mostly clear" || finsRaw === "pretty clogged" ? finsRaw : null,
    power_photo: stepHasPhoto("power_check") || photoByTarget("step_power_check"),
    ice: yesNo(stepAnswer("ice_check") ?? stepAnswer("ice_on_line")),
    ice_photo: photoByTarget("step_ice_check"),
    ice_reported: stepWasReported("ice_check") || stepWasReported("ice_on_line"),
    compressor_audible: yesNo(stepAnswer("compressor_audible")),
    vent_airflow: ventRaw ? (/^(no airflow|none)$/.test(ventRaw) ? "none" : /normal|strong|fine|usual/.test(ventRaw) ? "normal" : /weak|low|barely|less/.test(ventRaw) ? "weak" : null) : null,
    thermostat_setpoint_f: knownFahrenheit(readings.thermostat_setpoint_f),
    room_temp_f: knownFahrenheit(readings.room_temp_f),
    thermostat_mode: thermostatMode,
    thermostat_reading_provenance: thermostatProvenance,
    safety_negative: safetyRaw === null || safetyRaw === "not sure" ? null : /^(no|none|nothing|none of these|no to all)$/.test(safetyRaw),
    onset_character: onsetCharacter,
    onset_weekday: onsetWeekday,
    onset_span_days: onsetSpan,
    brand: brandConflict ? null : brand?.value ?? null,
    equipment_type: equipmentType?.value ?? null,
    model: modelSerial.model,
    age_years: ageConflict ? null : ageParsed.age_years,
    air_handler_location: text("air_handler_location"),
    cannot_reach: cannotReach,
    walkthrough_started: steps.size > 0 || cannotReach.size > 0,
  };

  // --- urgency & safety --------------------------------------------------------
  const habitability = text("habitability");
  const homeUse = habitability === "lost" || habitability === "intact" ? habitability : "degraded";
  const vulnerableOccupant = yesNo(text("vulnerable_occupant")) === "yes";
  const damageAccruing = yesNo(text("damage_accruing")) === "yes";
  const urgency = decideUrgency({
    homeowner_words: homeownerWords,
    safety_rule_id: journey.problem.safety_rule_id,
    safety_rule_halts: journey.problem.safety_state === "urgent",
    safety_questions_asked: view.safety_negative !== null,
    safety_questions_negative: view.safety_negative ?? undefined,
    habitability: homeUse,
    vulnerable_occupant: vulnerableOccupant,
    damage_accruing: damageAccruing,
    stated_urgency: (() => {
      const u = text("urgency")?.toLowerCase() ?? null;
      if (!u) return null;
      if (/today|now|urgent/.test(u)) return "same_day";
      if (u === "soon") return "soon";
      if (/soon|asap|as soon/.test(u)) return "asap";
      if (/plan|quote|whenever|later/.test(u)) return "planned";
      return null;
    })(),
  });

  // --- narrative -----------------------------------------------------------------
  let facts: Fact[];
  let summary: string[];
  let scriptParts: ScriptParts;
  let title: string;
  if (isHvacCooling) {
    title = HVAC_COOLING_TITLE;
    facts = hvacCoolingFacts(view);
    summary = hvacCoolingSummary(view);
    scriptParts = hvacCoolingScriptParts(view);
  } else {
    title =
      playbook.playbook_id === "pb_generic_home_problem_v1"
        ? firstSentence(homeownerWords)
        : playbook.cluster_label;
    facts = [];
    summary = [`The homeowner describes it as: “${homeownerWords.replace(/\s+/g, " ").trim()}”.`];
    const type = equipmentType?.value ?? null;
    scriptParts = {
      problem_clause: lowerFirst(firstSentence(homeownerWords)),
      equipment_brand_type: brand?.value ? `a ${brand.value}${type ? ` ${type.toLowerCase()}` : ""}` : type ? `a ${type.toLowerCase()}` : null,
      model_number: modelSerial.model,
      onset_clause: null,
      age_spoken: null,
    };
  }
  if (ageParsed.age_years !== null && !ageConflict) scriptParts.age_spoken = ageSpoken(ageParsed.age_years);
  if (brandConflict) scriptParts.equipment_brand_type = equipmentType?.value ?? null;
  facts.push(...conflicts.map(conflict => ({ text: fieldConflictText(conflict), provenance: "reported" as const,
    source_fields: [conflict.field_key, ...conflict.evidence_ids.map(id => `evidence:${id}`)] })));
  if (thermostatDisplay && thermostatProvenance !== "inference" && !facts.some(fact => fact.text.startsWith("Thermostat:"))) {
    const unitless = [readings.thermostat_setpoint, readings.room_temp].some(reading => reading && !reading.unit);
    facts.push({ text: `Thermostat: ${thermostatDisplay}${unitless ? " (temperature units not supplied)" : ""}`,
      provenance: thermostatProvenance ?? "reported", kind: "reading",
      source_fields: [...new Set([...readingFields.entries()].filter(([key]) => !["filter_nominal_dimensions", "printed_cooling_capacity"].includes(key)).map(([, field]) => field))],
    });
  }
  const printedLabels = { filter_nominal_dimensions: "Printed filter dimensions", printed_cooling_capacity: "Printed cooling capacity" } as const;
  for (const key of Object.keys(printedLabels) as (keyof typeof printedLabels)[]) {
    const reading = readings[key];
    if (reading && reading.provenance !== "inference") facts.push({
      text: `${printedLabels[key]}: ${reading.value}`, provenance: reading.provenance, kind: "reading",
      source_fields: [key, ...(reading.source_media ? [`evidence:${reading.source_media}`] : [])],
    });
  }

  // Timeline
  const timeline: TimelineRow[] = [];
  const created = wallClock(journey.problem.created_at, tz);
  if (onsetClock && onsetSpan !== null && onsetSpan > 0) {
    timeline.push({
      label: weekdayDayMon(onsetClock, false),
      text: timingText ? `Homeowner first notices the problem. "${timingText}"` : "Homeowner first notices the problem.",
      provenance: "reported",
      at: isoDate(onsetClock),
    });
  }
  if (created) {
    timeline.push({
      label: weekdayDayMon(created, true),
      text: "Describes the problem in their own words.",
      provenance: "reported",
      at: journey.problem.created_at,
    });
  }
  for (const m of media) {
    const w = wallClock(m.captured_at, tz);
    if (!w) continue;
    const what =
      m.kind === "video" ? "Video taken." : m.kind === "voice_note" ? "Voice note recorded." : `${m.subject} photographed.`;
    timeline.push({ label: weekdayDayMon(w, true), text: what, provenance: "seen_in_photo_or_video", at: m.captured_at });
  }
  for (const [stepId, d] of steps) {
    const w = wallClock(d.answered_at, tz);
    if (!w) continue;
    let what: string | null = null;
    if (stepId === "filter" && filterRating !== null) what = `Checks the filter, rates it ${filterRating}/10.`;
    else if (stepId === "filter" && view.filter_reported_clean) what = "Reports that the filter is clean.";
    else if (stepId === "fan_moving" && view.fan_moving) what = `${stepWasReported(stepId) ? "Reports the outdoor fan" : "Looks at the outdoor unit: fan"} ${view.fan_moving === "yes" ? "turning" : "not turning"}.`;
    else if (stepId === "fins_blocked" && view.fins) what = `Outdoor fins ${view.fins}.`;
    else if (stepId === "ice_check" && view.ice) what = view.ice_reported
      ? (view.ice === "no" ? "Reports no visible ice." : "Reports visible ice.")
      : (view.ice === "no" ? "Checks the accessible line: no ice seen." : "Checks the accessible line: ice seen.");
    else if (!d.evidence_id && d.answer) {
      const step = playbook.diagnostic_steps.find((s) => s.step_id === stepId);
      if (step) what = `${step.title}: ${d.answer}.`;
    }
    if (what) timeline.push({ label: weekdayDayMon(w, true), text: what, provenance: "reported", at: d.answered_at });
  }
  timeline.sort((a, b) => (a.at ?? "").localeCompare(b.at ?? ""));

  // --- provider -------------------------------------------------------------------
  const checks = isHvacCooling ? hvacCoolingChecks(view) : [];
  const unknowns = isHvacCooling ? hvacCoolingUnknowns(view) : [];
  const thermostatUnknown = unknowns.find(unknown => unknown.item === "Thermostat setpoint and room temperature");
  if (thermostatUnknown && thermostatDisplay) {
    const celsiusPair = readings.thermostat_setpoint?.unit === "C" && readings.room_temp?.unit === "C";
    if (celsiusPair && thermostatProvenance !== "inference") thermostatUnknown.item = "Thermostat temperature comparison";
    thermostatUnknown.reason = `Recorded display values: ${thermostatDisplay}. ${thermostatProvenance === "inference"
      ? "Unconfirmed reading; compare with the display before relying on it."
      : celsiusPair ? "Celsius values are preserved as supplied; no Fahrenheit comparison was made."
      : "The remaining values or compatible temperature units were not established; no Fahrenheit comparison was made."}`;
  }
  for (const key of Object.keys(printedLabels) as (keyof typeof printedLabels)[]) {
    const reading = readings[key];
    if (reading?.provenance === "inference") unknowns.push({
      item: printedLabels[key], reason: `${reading.value} — unconfirmed photo reading; compare with the printed label before relying on it.`,
    });
  }
  unknowns.push(...conflicts.map(conflict => ({ item: `${conflict.label} needs confirmation`, reason: fieldConflictText(conflict) })));
  const technicianOnly = isHvacCooling ? [...HVAC_COOLING_TECHNICIAN_ONLY] : [];
  const ranked = isHvacCooling ? hvacCoolingBranches(view) : { branches: [], top: null };
  const scopeFactors = isHvacCooling ? hvacCoolingScopeFactors(view, ranked.top) : [];

  const serviceHistory: ServiceHistoryAnswer[] = [];
  const historyIds: readonly string[] = trade === "hvac" ? HVAC_SERVICE_HISTORY_IDS : [];
  for (const qid of historyIds) {
    const v = text(qid) ?? text(`service_history_${qid.replace(/^sh_/, "")}`);
    if (!v) continue;
    serviceHistory.push({ question_id: qid, answer: v, provenance: yesNo(v) ? "confirmed_by_homeowner" : "reported" });
  }

  // --- access ---------------------------------------------------------------------
  const ACCESS_KEYS: Record<AccessKey, RegExp> = {
    occupancy: /^access_(occupancy|someone_home)$|^occupancy$/,
    owner_present_needed: /^access_(owner_present|present)$|^owner_present(_needed)?$/,
    parking: /^access_parking$|^parking$/,
    pets: /^access_pets?$|^pets?$/,
    equipment_route: /^access_(route|equipment_route)$|^equipment_route$/,
    preferred_window: /^access_(window|preferred_window|best_time)$|^preferred_window$/,
    gate_or_entry_code: /^access_(gate|gate_code|entry_code|code)$|^gate_or_entry_code$/,
    contact_preference: /^access_(contact|contact_pref(erence)?)$|^contact_preference$/,
  };
  const access: AccessBlock = {};
  for (const key of Object.keys(ACCESS_KEYS) as AccessKey[]) {
    const match = [...latest.keys()].find((k) => ACCESS_KEYS[key].test(k));
    const raw = match ? text(match) : null;
    if (!raw) continue;
    if (key === "gate_or_entry_code") {
      // The code never reaches the page; the renderer prints "Not printed here".
      access[key] = { value: "__code_present__", provenance: "unknown" };
      continue;
    }
    const cleaned = stripContactDetails(raw);
    if (!cleaned) continue;
    access[key] = { value: cleaned, provenance: yesNo(cleaned) ? "confirmed_by_homeowner" : "reported" };
  }

  // --- counts -----------------------------------------------------------------------
  const equipmentFacts = [brand?.value, modelSerial.model, modelSerial.serial, ageParsed.age_years, equipmentType?.value].filter(
    (x) => x !== null && x !== undefined
  ).length;
  const factsCaptured = facts.length + serviceHistory.length + Object.keys(access).length + equipmentFacts;

  const address = ctx.address;
  return {
    config: {
      link_base: opts.link_base,
      keep_path: "/keep/",
      ask_path: "/ask/",
      locale: "en-GB-oxendict-us-units",
      date_style: "D MMM YYYY",
      time_style: "HH:mm",
      time_zone: tz,
      ...(opts.home_memory_url ? { home_memory_url: opts.home_memory_url } : {}),
      ...(opts.trust_network_url ? { trust_network_url: opts.trust_network_url } : {}),
      media_link: opts.media_link,
    },
    packet: {
      id: shortPacketId(requestId),
      version: `v${journey.packet.packet_version}`,
      generated_at: nowIso,
      trade,
      playbook: playbook.playbook_id,
    },
    property: {
      street: address?.street ?? "",
      city_state_zip: address?.city_state_zip ?? "",
      unknown_reason: !address && ctx.journey.packet.intake_snapshot ? "Not provided before this packet was prepared." : null,
      type: address?.property_type ?? null,
      storeys: address?.storeys ?? null,
    },
    problem: {
      title,
      homeowner_words: homeownerWords,
      onset_date: onsetClock ? isoDate(onsetClock) : null,
      onset_weekday_spoken: onsetWeekday,
      onset_character: onsetCharacter,
      onset_span_days: onsetSpan,
      urgency_level: urgency.urgency_level,
      safety_state: urgency.safety_state,
      hazard_flags: urgency.hazard_flags,
      habitability: homeUse,
      vulnerable_occupant: vulnerableOccupant,
      damage_accruing: damageAccruing,
    },
    equipment: {
      labels_set: trade === "hvac" ? HVAC_LABELS_SET : trade,
      type: equipmentType,
      brand: brandConflict ? { value: `${brandConflict.held_value} / ${brandConflict.reported_values.join(" / ")} (needs confirmation)`, provenance: "reported" } : brand,
      model: modelSerial.model
        ? { value: modelSerial.model, provenance: msProvenance, ...(msConfirmed ? { confirmed_by_homeowner: true } : {}) }
        : null,
      serial: modelSerial.serial
        ? { value: modelSerial.serial, provenance: msProvenance, ...(msConfirmed ? { confirmed_by_homeowner: true } : {}) }
        : null,
      age_years: ageConflict ? null : ageParsed.age_years,
      manufacture_year: ageConflict ? null : ageParsed.manufacture_year,
      age_provenance: ageText ? (source("system_age") === "photo" || ageParsed.manufacture_year !== null ? "inference" : "reported") : undefined,
      outdoor_unit_location: valued("outdoor_unit_location"),
      air_handler_location: valued("air_handler_location"),
      thermostat: valued("thermostat_model") ?? valued("thermostat") ??
        (thermostatDisplay
          ? { value: `${thermostatDisplay}${thermostatProvenance === "inference" ? " (unconfirmed reading)" : ""}`, provenance: thermostatProvenance ?? "reported",
              ...(thermostatReadings.every(r => r.confirmed_by_homeowner) ? { confirmed_by_homeowner: true } : {}) }
          : null),
    },
    evidence: {
      media,
      readings,
    },
    narrative: { facts, summary_observations: summary, timeline, script_parts: scriptParts },
    provider: {
      checks,
      unknowns,
      technician_only: technicianOnly,
      branches: ranked.branches,
      service_history: serviceHistory,
      scope_factors: scopeFactors,
    },
    access,
    counts: { facts_captured: factsCaptured, made_less_likely: null },
  };
}
