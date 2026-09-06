import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { withFileLock, writeFileAtomic } from "@/platform/stores/atomic-file";
import { basename, dirname, join } from "node:path";
import {
  projectWalkthroughView,
  resolveWalkthroughPosition,
  type WalkthroughView,
} from "@/domain/intake/playbook";
import {
  MEDIA_ALLOWLIST,
  MEDIA_MAX_BYTES,
  mediaStore,
} from "@/platform/adapters/media-storage";
import { emitClarifierAnswered, reclassifyOnNewEvidence } from "@/domain/problem/capabilities";
import { photoCapDecisionFor } from "@/domain/problem/evidence-caps";
import { DEFAULT_TENANT_ID } from "@/domain/problem/contracts";
import { loadJourneyContext, nowIso, regeneratePacket } from "@/platform/intake/complete";
import { journeySafetyRule } from "@/domain/problem/journey-safety";
import { runtimeStore } from "@/platform/stores/runtime";
import { appendIntakeEffort } from "@/platform/intake/effort";
import { intakeReadiness } from "@/platform/intake/readiness";
import { readPrintedEvidence } from "@/platform/problem/printed-evidence";
import { emptyPrintedEvidence, StoredPrintedEvidence, type PrintedEvidenceResult } from "@/domain/problem/printed-evidence";
import { printedAnswers, printedKeysForTarget } from "@/domain/intake/printed-readings";

/**
 * THE EVIDENCE ATTACH PATH, AS A FUNCTION.
 *
 * This is the body that used to live inside `POST /api/intake/media`, moved out
 * for the same reason `startIntake` was: the static door page uploads its
 * photos, its video and its voice note through the multipart adapter
 * (`POST /api/intake/start`), and the walkthrough uploads through the media
 * route. Both must hit the same cap, the same allowlist, the same
 * authorization, the same evidence write and the same regeneration. One
 * function, two callers.
 *
 * Playbook field keys and `step:<id>` targets retain the server-side replay
 * that proves a step is this customer's actual current step. After the write,
 * the shared known-fact/effort selector controls which next check is emitted.
 */

/**
 * AUDIO IS ACCEPTED HERE, NOT IN THE SHARED ALLOWLIST.
 *
 * `MEDIA_ALLOWLIST` in adapters/media-storage.ts is the photo/video contract
 * the Supabase bucket is created with (`allowedMimeTypes`), and widening it
 * would change what that bucket accepts for every caller. Voice is a door-only
 * capability under an open decision (T1-17), so it carries its own narrow list
 * until that decision lands.
 */
export const VOICE_ALLOWLIST: Record<string, string> = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac": "aac",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
};

/**
 * WHAT A VOICE NOTE'S EvidenceObject SAYS.
 *
 * Routine decision 12: a voice note is accepted and stored and NOTHING is
 * claimed about what is in it. No transcription runs, so the record says so in
 * its own words rather than carrying a transcript-shaped blank. The bytes are
 * still written to storage under `<request_id>/voice_note/<evidence_id>.<ext>`,
 * which is recoverable from the request id and the evidence id on the record.
 */
export const VOICE_NOTE_EVIDENCE_CONTENT = "Voice note received, not transcribed";

/** The door's three upload slots. Everything else is a playbook target. */
export const DOOR_TARGETS = ["door_photo", "door_video", "voice_note"] as const;
export type DoorTarget = (typeof DOOR_TARGETS)[number];

function isDoorTarget(target: string): target is DoorTarget {
  return (DOOR_TARGETS as readonly string[]).includes(target);
}

// ---------------------------------------------------------------------------
// The label reader (F2's `read_equipment_label`), loaded lazily.
// ---------------------------------------------------------------------------

export type LabelReadResult =
  | {
      ok: true;
      readable: boolean;
      fields: {
        equipment_type?: string;
        brand?: string;
        model?: string;
        serial?: string;
        manufacture_year?: number;
        capacity?: string;
      };
      capacity_reading?: { printed_label: string; printed_value: string; printed_unit: string };
      confidence: Record<string, "high" | "medium" | "low">;
      run_id: string | null;
      /** The real reader distinguishes unreadable pixels from a call that
       * could not run/finish. Absent on legacy injected readers. */
      extraction_status?: "unreadable" | "failed";
    }
  | { ok: false; reason: string };

type LabelReader = (input: {
  bytes: Buffer;
  mime: string;
  request_id: string;
  tenant_id?: string;
  evidence_id?: string;
}) => Promise<LabelReadResult>;

/**
 * WHY THIS IS A DYNAMIC IMPORT AND NOT A NORMAL ONE.
 *
 * `platform/problem/ai-label.ts` is a narrow capability owned by another track
 * and lands independently. Reading a rating plate is a BONUS on top of a photo
 * the homeowner has already successfully attached: if the capability is not
 * installed, the upload must still work and the homeowner types the model
 * later, exactly as they do today. A static import would make the whole
 * evidence path fail to build over a feature that is allowed to be absent.
 *
 * The template specifier keeps the bundler from treating the module as a hard
 * dependency; a missing module rejects the promise and is caught below.
 */
const LABEL_MODULE = "ai-label";
let labelReader: LabelReader | null | undefined;

async function loadLabelReader(): Promise<LabelReader | null> {
  if (labelReader !== undefined) return labelReader;
  try {
    const mod = (await import(
      /* @vite-ignore */ `@/platform/problem/${LABEL_MODULE}`
    )) as { readEquipmentLabel?: LabelReader };
    labelReader = typeof mod.readEquipmentLabel === "function" ? mod.readEquipmentLabel : null;
  } catch {
    labelReader = null;
  }
  return labelReader;
}

/** Test seam: inject or clear the reader without touching the module graph. */
export function __setLabelReaderForTests(reader: LabelReader | null | undefined): void {
  labelReader = reader;
}

// ---------------------------------------------------------------------------
// The confidence and extraction-completion sidecar.
// ---------------------------------------------------------------------------

/**
 * WHERE THE LABEL-READ CONFIDENCE LIVES, AND WHY IT IS NOT IN `value_text`.
 *
 * The brief allowed either a `value_text` suffix or a sidecar. The suffix was
 * rejected: `value_text` is rendered to the homeowner on the walkthrough AND
 * printed into the packet's collected details, so a suffix would put
 * "(read from your photo, medium confidence)" into provider-facing copy that
 * Melissa has never reviewed, and would do it inside a field whose `source`
 * column already carries the provenance. `value_text` therefore holds the value
 * and nothing else.
 *
 * The confidence is written beside the runtime data as
 * `data/runtime/label-reads/<request_id>.json` and read back with
 * `readLabelConfidence(request_id)` — which is what the walkthrough's confirm
 * ladder needs ("is this right?" asked harder when the read was weak).
 *
 * HONEST LIMIT: completion persistence is currently local-file based. A failed
 * aggregate write uses a separate atomic completion file; failure of both
 * returns503 before extracted answers are saved. This is not shared/serverless
 * durability. A shared completion adapter is required for hosted verification.
 */
export interface LabelConfidenceRecord {
  request_id: string;
  evidence_id: string;
  read_at: string;
  run_id: string | null;
  /** field_key -> the word. Confidence in words only (routine decision 5). */
  confidence: Record<string, "high" | "medium" | "low">;
  /** Completion belongs to this evidence, never in a printable answer value. */
  extraction_status?: "readable" | "unreadable" | "failed";
  reason?: string;
  /** No raw OCR transcript or source image. Exact bounded typed fields and gaps. */
  printed_evidence?: PrintedEvidenceResult;
  target?: string;
}

function labelSidecarPath(requestId: string): string {
  const safe = requestId.replace(/[^a-z0-9_-]/gi, "_");
  return join(process.env.PRN_DEV_DB_PATH ? dirname(process.env.PRN_DEV_DB_PATH) : join(process.cwd(), "data", "runtime"), "label-reads", `${safe}.json`);
}

function reserveLabelAttempt(requestId: string, evidenceId: string): boolean {
  // One attempt for these bytes. A new accepted capture may retry, subject to
  // the cumulative effort ledger and callModel's shared request/spend ceiling.
  const file = labelSidecarPath(requestId) + `.${evidenceId}.attempt`;
  try { return withFileLock(file, () => {
    if (existsSync(file)) return false;
    writeFileAtomic(file, new Date().toISOString());
    return true;
  }); } catch { return false; }
}

const LABEL_ID = /^[a-z0-9_-]+$/i;

function completedLabelRecord(value: unknown, requestId: string): value is LabelConfidenceRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Partial<LabelConfidenceRecord>;
  return record.request_id === requestId && typeof record.evidence_id === "string" && LABEL_ID.test(record.evidence_id)
    && typeof record.read_at === "string" && Number.isFinite(Date.parse(record.read_at))
    && (record.run_id === null || typeof record.run_id === "string")
    && !!record.confidence && typeof record.confidence === "object" && !Array.isArray(record.confidence)
    && Object.values(record.confidence).every(word => ["high", "medium", "low"].includes(word))
    && (record.extraction_status === undefined || ["readable", "unreadable", "failed"].includes(record.extraction_status))
    && (record.reason === undefined || typeof record.reason === "string")
    && (record.printed_evidence === undefined || (StoredPrintedEvidence.safeParse(record.printed_evidence).success
      && record.printed_evidence.evidence_id === record.evidence_id && typeof record.target === "string" && printedKeysForTarget(record.target).length > 0));
}

/** A real completed result, not the earlier reservation, survives an aggregate
 * sidecar failure in its own atomic file. Neither location holds photo bytes. */
function writeLabelConfidence(record: LabelConfidenceRecord): boolean {
  if (!LABEL_ID.test(record.request_id) || !completedLabelRecord(record, record.request_id)) return false;
  const path = labelSidecarPath(record.request_id);
  try {
    withFileLock(path, () => {
      const existing = readLabelReadings(record.request_id);
      writeFileAtomic(path, JSON.stringify([...(existing ?? []), record]));
    });
    return true;
  } catch {
    const fallback = `${path}.${record.evidence_id}.completion.json`;
    try {
      withFileLock(fallback, () => writeFileAtomic(fallback, JSON.stringify(record)));
      return true;
    } catch {
      // The photo is already stored. The caller reports this narrower failure
      // instead of claiming the completed extraction result was persisted.
      return false;
    }
  }
}

/** Every completed label attempt, including explicit gaps, oldest first. */
export function readLabelReadings(requestId: string): LabelConfidenceRecord[] | null {
  if (!LABEL_ID.test(requestId)) return null;
  const path = labelSidecarPath(requestId);
  const records: LabelConfidenceRecord[] = [];
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf-8"));
    if (Array.isArray(parsed)) records.push(...parsed.filter(record => completedLabelRecord(record, requestId)));
  } catch { /* Independent per-evidence completions may still be available. */ }
  try {
    const prefix = `${basename(path)}.`;
    const suffix = ".completion.json";
    for (const entry of readdirSync(dirname(path), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isFile() || !entry.name.startsWith(prefix) || !entry.name.endsWith(suffix)) continue;
      const evidenceId = entry.name.slice(prefix.length, -suffix.length);
      if (!LABEL_ID.test(evidenceId)) continue;
      try {
        const record: unknown = JSON.parse(readFileSync(join(dirname(path), entry.name), "utf-8"));
        if (completedLabelRecord(record, requestId) && record.evidence_id === evidenceId && record.extraction_status !== undefined) records.push(record);
      } catch { /* Corrupt/unavailable files establish no completed result. */ }
    }
  } catch { /* Missing directory establishes no completed result either. */ }
  const latest = new Map<string, LabelConfidenceRecord>();
  for (const record of records) {
    const held = latest.get(record.evidence_id);
    // On equal timestamps prefer the aggregate copy; recovery copies the same
    // result there. Stable insertion order preserves legacy chronological ties.
    if (!held || Date.parse(record.read_at) > Date.parse(held.read_at)) latest.set(record.evidence_id, record);
  }
  const completed = [...latest.values()].sort((a, b) => Date.parse(a.read_at) - Date.parse(b.read_at));
  return completed.length ? completed : null;
}

/** Legacy packet callers use these ids as read-from-label provenance. An
 * unreadable/failed attempt must never enter that successful-read view. */
export function readLabelConfidence(requestId: string): LabelConfidenceRecord[] | null {
  const readable = readLabelReadings(requestId)?.filter(record =>
    record.extraction_status === undefined || record.extraction_status === "readable");
  return readable?.length ? readable : null;
}

// ---------------------------------------------------------------------------
// attachMedia
// ---------------------------------------------------------------------------

export interface AttachMediaInput {
  request_id: string;
  /** "door_photo" | "door_video" | "voice_note", a playbook field key, or "step:<id>". */
  target: string;
  file: File;
  source: "door_form" | "walkthrough";
}

export type AttachMediaResult =
  | {
      ok: true;
      evidence_id: string;
      /** The next walkthrough view, when a `step:` target advanced it. */
      view?: WalkthroughView;
      /** What the label reader made of a photo, when it ran at all. */
      label_read?: LabelReadResult;
      printed_read?: PrintedEvidenceResult;
    }
  | {
      ok: false;
      status: number;
      error: string;
      /** Photo-cap detail the media route already returned to its callers. */
      photos?: number;
      max_photos?: number;
      /** The underlying failure, for the route's existing `detail` field. */
      detail?: string;
    };

/**
 * THE FIELDS A RATING PLATE CAN ANSWER, in the hvac-cooling playbook's own
 * key names (domain/intake/playbooks/hvac-cooling.ts). A read that returns a
 * brand fills `brand`; model and serial together fill `unit_model_serial`; a
 * manufacture year becomes `system_age` in words, because "roughly how old" is
 * what that field asks and a year is not an answer to it.
 */
function answersFromLabel(
  read: Extract<LabelReadResult, { ok: true }>,
  now: string
): { field_key: string; value_text: string }[] {
  const out: { field_key: string; value_text: string }[] = [];
  const f = read.fields;
  if (f.equipment_type) out.push({ field_key: "equipment_type", value_text: f.equipment_type });
  if (f.brand) out.push({ field_key: "brand", value_text: f.brand });
  if (f.capacity && read.capacity_reading) out.push({ field_key: "printed_cooling_capacity",
    value_text: `${read.capacity_reading.printed_label}: ${read.capacity_reading.printed_value} ${read.capacity_reading.printed_unit}` });
  const modelSerial = [f.model ? `Model ${f.model}` : null, f.serial ? `Serial ${f.serial}` : null]
    .filter(Boolean)
    .join(", ");
  if (modelSerial) out.push({ field_key: "unit_model_serial", value_text: modelSerial });
  if (typeof f.manufacture_year === "number" && Number.isFinite(f.manufacture_year)) {
    const years = new Date(now).getUTCFullYear() - f.manufacture_year;
    if (years >= 0 && years < 60) {
      out.push({
        field_key: "system_age",
        value_text:
          years === 0
            ? `Made this year (${f.manufacture_year} on the label)`
            : `About ${years} year${years === 1 ? "" : "s"} old (${f.manufacture_year} on the label)`,
      });
    }
  }
  return out;
}

export async function attachMedia(input: AttachMediaInput): Promise<AttachMediaResult> {
  const { request_id: requestId, target, file } = input;
  const isVoice = target === "voice_note";
  const ext = isVoice ? VOICE_ALLOWLIST[file.type] : MEDIA_ALLOWLIST[file.type];
  if (!ext) {
    return {
      ok: false,
      status: 415,
      error: isVoice
        ? "Please upload an audio recording (M4A, MP3, WAV, WebM or OGG)."
        : "Please upload a photo (JPG, PNG, HEIC, WebP) or a short video (MP4, MOV).",
    };
  }
  if (file.size > MEDIA_MAX_BYTES) {
    return {
      ok: false,
      status: 413,
      error: "That file is over 25 MB — try a shorter clip or a smaller photo.",
    };
  }
  const ctx = await loadJourneyContext(requestId);
  if (!ctx) return { ok: false, status: 404, error: "Unknown request" };
  const safety = journeySafetyRule(ctx.journey.problem);
  if (safety && !safety.intake_may_continue) return { ok: false, status: 409, error: safety.approved_response };

  /**
   * THE PHOTO CAP, ENFORCED SERVER-SIDE (Loop Spec Audit A01 condition 13).
   * Counted from the evidence already on the ProblemRecord and checked BEFORE
   * the file is stored, so a refused upload leaves nothing behind — no object in
   * the bucket, no EvidenceObject, no answered field, no regenerated packet.
   * The number lives in the policy store, never here.
   */
  const isPhoto = !isVoice && !file.type.startsWith("video/");
  if (isPhoto) {
    const cap = photoCapDecisionFor(ctx.allEvidence);
    if (!cap.allowed) {
      return {
        ok: false,
        status: 409,
        error: cap.message ?? "That is one photo more than we ask for.",
        photos: cap.current,
        max_photos: cap.max,
      };
    }
  }

  const store = runtimeStore();
  const isStep = target.startsWith("step:");
  const isDoor = isDoorTarget(target);
  if (!isStep && !isDoor && !ctx.playbook.required_fields.some(field => field.field_key === target)) {
    return { ok: false, status: 400, error: "Unknown evidence target" };
  }
  if (isStep) {
    // AUTHORIZATION, not just validation — `target` naming a real step is not
    // enough, it must be THIS customer's actual current step, replayed
    // server-side from their saved answers. Checked BEFORE any storage write,
    // so an illegitimate probe never even results in a real upload.
    const stepId = target.slice(5);
    const priorAnswers = await store.listDiagnosisAnswers(requestId);
    const position = resolveWalkthroughPosition(ctx.playbook, priorAnswers);
    if (position.outcomeId !== null || position.currentStepId !== stepId) {
      return {
        ok: false,
        status: 409,
        error: "That step is not currently active for this request.",
      };
    }
  }

  const selected = await intakeReadiness(ctx);
  const admission = await appendIntakeEffort({
    request_id: requestId, tenant_id: ctx.journey.problem.tenant_id ?? "prn",
    operation_id: `media:${randomUUID()}`, kind: "media", question_id: target,
    question_type: "media", decision_reason: "One media capture attempt costs three effort units.",
    selection_decisions: selected.screen.decisions,
  });
  if (!admission.accepted) return {
    ok: false, status: 409,
    error: "You have reached the intake limit. Your saved packet is available, including what is still unknown.",
  };

  const now = nowIso();
  const evidenceId = `ev_${randomUUID()}`;
  // No ":" in the key — a colon in a path segment is invalid on Windows, and
  // FileMediaStore joins the key straight onto the filesystem. "step:x" targets
  // become "step_x" here; step detection reads the target, never the key.
  const key = `${requestId}/${target.replace(/[^a-z0-9_-]/gi, "_")}/${evidenceId}.${ext}`;
  const data = Buffer.from(await file.arrayBuffer());
  let view: WalkthroughView | undefined;
  let labelRead: LabelReadResult | undefined;
  let printedRead: PrintedEvidenceResult | undefined;
  let photoSaved = false;
  const kind: "photo" | "video" | "voice_note" = isVoice
    ? "voice_note"
    : file.type.startsWith("video/")
      ? "video"
      : "photo";
  try {
    const stored = await mediaStore().put(key, data, file.type);
    await store.attachEvidence(ctx.journey.problem.problem_id, requestId, {
      evidence_id: evidenceId,
      kind,
      /**
       * Media carries its PRIVATE storage reference, never a public URL. The
       * one exception is a voice note, which says what it is instead of
       * pointing at bytes nothing can yet read (routine decision 12); its file
       * is still at `<request_id>/voice_note/<evidence_id>.<ext>`.
       */
      content: isVoice ? VOICE_NOTE_EVIDENCE_CONTENT : stored.storage_ref,
      privacy: "private",
      captured_at: now,
      mime: stored.mime,
      bytes: stored.bytes,
      /**
       * A door upload satisfies no named playbook field — it is "here is my
       * unit", before any question has been asked. The walkthrough's own
       * targets keep the field they answer.
       */
      field_key: isStep || isDoor ? null : target,
    });
    photoSaved = true;
    if (isStep) {
      const stepId = target.slice(5);
      await store.saveDiagnosisAnswer({
        request_id: requestId,
        step_id: stepId,
        answer: null,
        evidence_id: evidenceId,
        answered_at: now,
      });
      // A step photo can also satisfy required fields (e.g. unit label).
      const step = ctx.playbook.diagnostic_steps.find((s) => s.step_id === stepId);
      if (step && step.satisfies_fields.length > 0) {
        await store.saveIntakeAnswers(
          step.satisfies_fields.map((field_key) => ({
            request_id: requestId,
            field_key,
            value_text: null,
            evidence_id: evidenceId,
            source: "photo" as const,
            answered_at: now,
          }))
        );
      }
    } else if (!isDoor && !(await store.listIntakeAnswers(requestId)).some(answer => answer.field_key === target && answer.value_text !== null)) {
      await store.saveIntakeAnswers([
        {
          request_id: requestId,
          field_key: target,
          value_text: null,
          evidence_id: evidenceId,
          source: "photo",
          answered_at: now,
        },
      ]);
    }
    await store
      .recordEvents([
        {
          event_id: `ev_${randomUUID()}`,
          event_name: "intake.evidence_added",
          event_version: 1,
          occurred_at: now,
          actor: { actor_type: "guest", actor_id: null },
          guest_session_id: ctx.journey.session.guest_session_id,
          context: { problem_id: ctx.journey.problem.problem_id, kind },
          source: { channel: "web", referrer: null, landing_path: null },
          versions: { schema: "1.0.0" },
          result: { status: "ok", duration_ms: null, cost_usd: null },
          privacy_class: "private",
          trace_id: null,
          agent_run_id: null,
          action_request_id: null,
        },
      ])
      .catch(() => {});

    /**
     * READ THE RATING PLATE (routine decision 2, recommendation B).
     *
     * One narrow capability, called on a photo that is ALREADY SAFELY STORED.
     * A failed, slow or absent reader leaves the photo intact and records an
     * explicit extraction gap. It never overwrites an answer this person
     * already gave. If neither completion store can retain that outcome, the
     * response distinguishes the saved photo from the unsaved reading status.
     */
    if (kind === "photo" && printedKeysForTarget(target).length) {
      try {
        printedRead = reserveLabelAttempt(requestId, evidenceId)
          ? await readPrintedEvidence({ evidence_id: evidenceId, image: data })
          : emptyPrintedEvidence(evidenceId, null, "unavailable");
      } catch { printedRead = emptyPrintedEvidence(evidenceId, null, "unavailable"); }
      const projected = printedAnswers(target, printedRead);
      const completion: LabelConfidenceRecord = {
        request_id: requestId, evidence_id: evidenceId, read_at: new Date().toISOString(), run_id: null,
        target, printed_evidence: printedRead, confidence: projected.confidence, extraction_status: projected.extraction_status,
        ...(projected.extraction_status === "readable" ? {} : { reason: projected.extraction_status === "failed"
          ? "The printed-text reader could not finish this photo." : "This photo did not yield a legible value for the requested reading." }),
      };
      // Complete provenance first. A saved answer must never outlive a missing
      // confidence record and be promoted to an observed/confirmed fact.
      if (!writeLabelConfidence(completion)) return { ok: false, status: 503,
        error: "Your photo was saved, but its reading result could not be saved. You can keep your existing packet or add the details you can read." };
      const existing = await store.listIntakeAnswers(requestId);
      const answered = new Set(existing.filter(answer => answer.value_text !== null).map(answer => answer.field_key));
      const fresh = projected.answers.filter(answer => !answered.has(answer.field_key));
      if (fresh.length) await store.saveIntakeAnswers(fresh.map(answer => ({ ...answer, request_id: requestId,
        evidence_id: evidenceId, source: "photo" as const, answered_at: now })));
    } else if (kind === "photo") {
      let labelAnswers: Array<{ field_key: string; value_text: string }> = [];
      let completion: Pick<LabelConfidenceRecord, "extraction_status" | "reason"> = {
        extraction_status: "failed", reason: "The label reader was unavailable for this upload.",
      };
      try {
        const reader = await loadLabelReader();
        if (reader && reserveLabelAttempt(requestId, evidenceId)) {
          labelRead = await reader({ bytes: data, mime: file.type, request_id: requestId, tenant_id: ctx.journey.problem.tenant_id ?? DEFAULT_TENANT_ID, evidence_id: evidenceId });
          const extracted = labelRead.ok && labelRead.readable && labelRead.extraction_status !== "failed"
            ? answersFromLabel(labelRead, now) : [];
          completion = labelRead.ok && labelRead.extraction_status === "failed"
            ? { extraction_status: "failed", reason: "Label extraction could not run or finish for this upload." }
            : labelRead.ok
            ? extracted.length
              ? { extraction_status: "readable" }
              : { extraction_status: "unreadable", reason: "The submitted photo did not yield a readable equipment-label value." }
            : { extraction_status: "failed", reason: "The label-reading attempt did not complete with a usable result." };
          if (extracted.length) {
            const existing = await store.listIntakeAnswers(requestId);
            const alreadyAnswered = new Set(
              existing.filter((a) => a.value_text !== null).map((a) => a.field_key)
            );
            labelAnswers = extracted.filter(
              (a) => !alreadyAnswered.has(a.field_key)
            );
          }
        } else if (reader) {
          completion = { extraction_status: "failed", reason: "No additional label-reading attempt was started for this evidence." };
        }
      } catch {
        completion = { extraction_status: "failed", reason: "The label-reading attempt failed before a usable value was saved." };
      }
      const completionSaved = writeLabelConfidence({
        request_id: requestId, evidence_id: evidenceId, read_at: new Date().toISOString(),
        run_id: labelRead?.ok ? labelRead.run_id : null,
        confidence: completion.extraction_status === "readable" && labelRead?.ok ? labelRead.confidence : {},
        ...completion,
      });
      if (!completionSaved) return {
        ok: false, status: 503,
        error: "Your photo was saved, but its label-reading result could not be saved. You can keep your existing packet or add the details you can read.",
      };
      if (labelAnswers.length) await store.saveIntakeAnswers(labelAnswers.map(answer => ({ ...answer,
        request_id: requestId, evidence_id: evidenceId, source: "photo" as const, answered_at: now })));
    }

    /**
     * A01 INSTRUMENTS on the evidence path.
     *
     * `intake.clarifier_answered` — a photo of a rating plate IS an answer to a
     * question the playbook asked, and counting only typed answers would make
     * intake friction look worse for the people who did the harder thing.
     * Emitted only when the upload actually satisfies a required field.
     *
     * `problem.updated` — re-classification, emitted by reclassifyOnNewEvidence
     * ONLY IF the classification moved. New evidence is the right moment to
     * re-check; a photo that confirms what we already thought is not a change,
     * and emitting on every upload would make this a second name for
     * intake.evidence_added.
     *
     * WRAPPED, BECAUSE THE FILE IS ALREADY SAVED BY NOW. Everything above this
     * point is the homeowner's work; everything in here is telemetry. Inside the
     * outer try/catch, a throw here would return "we could not save that file"
     * for a file that WAS saved — the worst possible lie to tell someone who is
     * mid-journey. emitPlatformEvent never throws by contract; this is the belt
     * to that braces.
     */
    try {
      const answeredFieldKeys = isStep
        ? (ctx.playbook.diagnostic_steps.find((s) => s.step_id === target.slice(5))
            ?.satisfies_fields ?? [])
        : isDoor
          ? []
          : [target];
      for (const fieldKey of answeredFieldKeys) {
        await emitClarifierAnswered({
          problem_id: ctx.journey.problem.problem_id,
          request_id: requestId,
          playbook_id: ctx.playbook.playbook_id,
          field_key: fieldKey,
          source: "photo",
        });
      }
      await reclassifyOnNewEvidence({
        existing: ctx.journey.problem,
        description: ctx.textEvidence.content,
        intake_session_id: ctx.journey.session.intake_session_id,
        problem_family_hint: ctx.journey.session.attribution.problem_family_hint,
        now,
        trigger: "evidence_added",
      });
    } catch {
      /* instruments are never worth a homeowner's upload */
    }

    await regeneratePacket(requestId);
    if (isStep) {
      const fresh = await loadJourneyContext(requestId);
      view = { step: null, outcome: null };
      if (fresh) {
        const next = await intakeReadiness(fresh);
        const check = next.screen.questions.find(question => question.source_kind === "check");
        view = projectWalkthroughView(fresh.playbook, check?.source_key ?? null, next.position.outcomeId);
      }
    }
  } catch (err) {
    return {
      ok: false,
      status: 503,
      error: photoSaved ? "Your file was saved, but we could not finish updating its reading or packet. Your previous packet remains available."
        : "We could not save that file right now — please try again.",
      detail: err instanceof Error ? err.message : String(err),
    };
  }
  return {
    ok: true,
    evidence_id: evidenceId,
    ...(view ? { view } : {}),
    ...(labelRead ? { label_read: labelRead } : {}),
    ...(printedRead ? { printed_read: printedRead } : {}),
  };
}
