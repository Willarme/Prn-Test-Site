import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { withFileLock, writeFileAtomic } from "@/platform/stores/atomic-file";
import { dirname, join } from "node:path";
import {
  advanceWalkthrough,
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
import { loadJourneyContext, nowIso, regeneratePacket } from "@/platform/intake/complete";
import { journeySafetyRule } from "@/domain/problem/journey-safety";
import { runtimeStore } from "@/platform/stores/runtime";

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
 * The walkthrough behaviour is UNCHANGED — playbook field keys and `step:<id>`
 * targets do exactly what they did, including the server-side replay that
 * proves a step target is this customer's actual current step.
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
      };
      confidence: Record<string, "high" | "medium" | "low">;
      run_id: string | null;
    }
  | { ok: false; reason: string };

type LabelReader = (input: {
  bytes: Buffer;
  mime: string;
  request_id: string;
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
// The confidence sidecar.
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
 * HONEST LIMIT: this is the FILE store's environment only, which is the whole
 * demo. With Supabase configured the sidecar is not written and the reader
 * returns null, so a caller gets "no confidence recorded" rather than a wrong
 * one. A column on intake_details is owed before the Supabase path uses this.
 */
export interface LabelConfidenceRecord {
  request_id: string;
  evidence_id: string;
  read_at: string;
  run_id: string | null;
  /** field_key -> the word. Confidence in words only (routine decision 5). */
  confidence: Record<string, "high" | "medium" | "low">;
}

function labelSidecarPath(requestId: string): string {
  const safe = requestId.replace(/[^a-z0-9_-]/gi, "_");
  return join(process.env.PRN_DEV_DB_PATH ? dirname(process.env.PRN_DEV_DB_PATH) : join(process.cwd(), "data", "runtime"), "label-reads", `${safe}.json`);
}

function reserveLabelAttempt(requestId: string): boolean {
  // One label-model request per journey, including concurrent photo uploads.
  const file = labelSidecarPath(requestId) + ".attempt";
  try { return withFileLock(file, () => {
    if (existsSync(file)) return false;
    writeFileAtomic(file, new Date().toISOString());
    return true;
  }); } catch { return false; }
}

function writeLabelConfidence(record: LabelConfidenceRecord): void {
  try {
    const path = labelSidecarPath(record.request_id);
    withFileLock(path, () => {
      const existing = readLabelConfidence(record.request_id);
      writeFileAtomic(path, JSON.stringify([...(existing ?? []), record]));
    });
  } catch {
    /* a sidecar is never worth a homeowner's upload */
  }
}

/** Every label read recorded for this request, oldest first. Null when none. */
export function readLabelConfidence(requestId: string): LabelConfidenceRecord[] | null {
  try {
    const raw = readFileSync(labelSidecarPath(requestId), "utf-8");
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as LabelConfidenceRecord[]) : null;
  } catch {
    return null;
  }
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

  const now = nowIso();
  const evidenceId = `ev_${randomUUID()}`;
  // No ":" in the key — a colon in a path segment is invalid on Windows, and
  // FileMediaStore joins the key straight onto the filesystem. "step:x" targets
  // become "step_x" here; step detection reads the target, never the key.
  const key = `${requestId}/${target.replace(/[^a-z0-9_-]/gi, "_")}/${evidenceId}.${ext}`;
  const data = Buffer.from(await file.arrayBuffer());
  let view: WalkthroughView | undefined;
  let labelRead: LabelReadResult | undefined;
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
    if (isStep) {
      const stepId = target.slice(5);
      await store.saveDiagnosisAnswer({
        request_id: requestId,
        step_id: stepId,
        answer: null,
        evidence_id: evidenceId,
        answered_at: now,
      });
      // Same branch resolution a typed/choice answer gets — a photo answers
      // "any" (DiagnoseWalkthrough never asks which branch a photo took).
      view = advanceWalkthrough(ctx.playbook, stepId, "any") ?? undefined;
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
    } else if (!isDoor) {
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
     * Everything below this line is a bonus: a failed, slow or absent reader
     * leaves the homeowner exactly where they were, which is being asked to
     * type the model later. It never becomes an error, and it never overwrites
     * an answer this person already gave (never ask twice, and never contradict
     * them with a guess).
     */
    if (kind === "photo") {
      try {
        const reader = await loadLabelReader();
        if (reader && reserveLabelAttempt(requestId)) {
          labelRead = await reader({ bytes: data, mime: file.type, request_id: requestId });
          if (labelRead.ok && labelRead.readable) {
            const existing = await store.listIntakeAnswers(requestId);
            const alreadyAnswered = new Set(
              existing.filter((a) => a.value_text !== null).map((a) => a.field_key)
            );
            const fresh = answersFromLabel(labelRead, now).filter(
              (a) => !alreadyAnswered.has(a.field_key)
            );
            if (fresh.length > 0) {
              await store.saveIntakeAnswers(
                fresh.map((a) => ({
                  request_id: requestId,
                  field_key: a.field_key,
                  value_text: a.value_text,
                  evidence_id: evidenceId,
                  source: "photo" as const,
                  answered_at: now,
                }))
              );
              writeLabelConfidence({
                request_id: requestId,
                evidence_id: evidenceId,
                read_at: now,
                run_id: labelRead.run_id,
                confidence: labelRead.confidence,
              });
            }
          }
        }
      } catch {
        /* the homeowner types it later — that is the designed fallback */
      }
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
      const position = resolveWalkthroughPosition(ctx.playbook, await store.listDiagnosisAnswers(requestId));
      view = projectWalkthroughView(ctx.playbook, position.currentStepId, position.outcomeId);
    }
  } catch (err) {
    return {
      ok: false,
      status: 503,
      error: "We could not save that file right now — please try again.",
      detail: err instanceof Error ? err.message : String(err),
    };
  }
  return {
    ok: true,
    evidence_id: evidenceId,
    ...(view ? { view } : {}),
    ...(labelRead ? { label_read: labelRead } : {}),
  };
}
