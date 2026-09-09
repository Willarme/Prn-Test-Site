import type { EvidenceObject } from "@/domain/problem/contracts";
import { requirePolicyNumber } from "@/platform/policy/store";

/**
 * THE PHOTO CAP — decided on 20 August, built on 25 August (Loop Spec Audit A01
 * condition 13; A01 §3, §10 and §11).
 *
 * ─── WHAT WAS ACTUALLY WRONG ───────────────────────────────────────────────
 *
 * Three separate documents state "max 4 pictures per request" as a live hard
 * constraint. `grep -rn photo src/` returned no count check of any kind: the
 * upload route validated MIME type and file size, then accepted the file, every
 * time, without limit. The cap existed as a decision and as prose and nowhere
 * else. That is the specific failure the condition names — "or it stays a
 * decision nobody built".
 *
 * ─── WHY IT IS ENFORCED SERVER-SIDE, AND ONLY SERVER-SIDE ──────────────────
 *
 * The count is taken from the evidence already attached to the ProblemRecord,
 * inside the upload handler, after the journey is loaded. Not in the browser: a
 * client-side limit is a courtesy, not a cap, and the surface being capped is a
 * file-upload endpoint. Whatever the page does or does not do, the fifth photo
 * is refused here.
 *
 * ─── WHAT IT COUNTS, AND WHAT IT DELIBERATELY DOES NOT ─────────────────────
 *
 * PICTURES. `kind: "photo"`. The decision of record is about pictures; video
 * length is a separate, explicitly undecided cap, and quietly folding videos
 * into a photo limit would be inventing a number by arithmetic. A request may
 * therefore hold four photos and still attach a video — which is the decided
 * behaviour, not an oversight.
 *
 * Crew 451b88: one optional video has its own 30-second versioned ceiling.
 */

/** The configured ceiling. Read from policy — never a literal at a call site. */
export function maxPhotosPerRequest(): number {
  return requirePolicyNumber("intake.max_photos_per_request");
}

/** How many pictures are already attached. Videos and text are not pictures. */
export function countPhotos(evidence: readonly EvidenceObject[]): number {
  return evidence.filter((e) => e.kind === "photo").length;
}

export interface PhotoCapDecision {
  allowed: boolean;
  /** Photos already attached, before this one. */
  current: number;
  max: number;
  /** Plain, non-alarming copy for the homeowner. Null when allowed. */
  message: string | null;
}

/**
 * THE DECISION, taken before anything is stored. Kept pure so the same rule can
 * be asserted directly in a test and reached through the route.
 */
export function photoCapDecision(current: number, max: number): PhotoCapDecision {
  if (current >= max) {
    return {
      allowed: false,
      current,
      max,
      // The closing number tracks the configured cap (raised to 6 on 2026-09-05,
      // policy store) so the copy can never contradict the limit it explains.
      message: `You've added ${current} photos, which is the most we ask for (${max}). Your saved photos and packet are still available.`,
    };
  }
  return { allowed: true, current, max, message: null };
}

/** Convenience for a caller holding the request's evidence list. */
export function photoCapDecisionFor(
  evidence: readonly EvidenceObject[],
  max: number = maxPhotosPerRequest()
): PhotoCapDecision {
  return photoCapDecision(countPhotos(evidence), max);
}
