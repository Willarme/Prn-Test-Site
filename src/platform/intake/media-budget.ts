import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import { requireServiceClient } from "@/platform/db/client";
import { getPolicySetting } from "@/platform/policy/store";
import { withFileLock, writeFileAtomic } from "@/platform/stores/atomic-file";
import { runtimeStore } from "@/platform/stores/runtime";
import { DEFAULT_TENANT_ID } from "@/domain/problem/contracts";

const id = z.string().regex(/^[a-zA-Z0-9_.:-]{1,160}$/);
const reservation = z.object({ operation_id: id, kind: z.enum(["photo", "video"]), duration_seconds: z.number().positive().nullable() }).strict();
const policyReceipt = z.object({ photos:z.number().int().positive(), videos:z.number().int().positive(), seconds:z.number().int().positive(), photo_version:z.number().int().positive(), video_version:z.number().int().positive(), seconds_version:z.number().int().positive() }).strict();
const localReservation = reservation.extend({policy:policyReceipt});
const ledger = z.object({ request_id: id, tenant_id: id, problem_id: id, baseline_photos: z.number().int().nonnegative(), baseline_videos: z.number().int().nonnegative(), reservations: z.array(localReservation).max(5) }).strict();
export function mediaPolicy() {
  const setting = (key: string) => {
    const s = getPolicySetting<number>(key);
    if (!s || !Number.isSafeInteger(s.value) || s.value < 1 || !Number.isSafeInteger(s.version) || s.version < 1) throw new Error("Media policy unavailable");
    return { value: s.value, version: s.version };
  };
  return { photos: setting("intake.max_photos_per_request"), videos: setting("intake.max_videos_per_request"), seconds: setting("intake.max_video_seconds") };
}

/** Reserve before any bucket write. Unknown/failed attempts retain their slot;
 * retries never manufacture capacity after a server restart. Existing evidence
 * is counted once when the first budget is initialized, under the same lock. */
export async function reserveMedia(input: { request_id: string; tenant_id: string; operation_id: string; kind: "photo" | "video"; duration_seconds: number | null }) {
  id.parse(input.request_id); id.parse(input.tenant_id);
  const op = reservation.parse({ operation_id: input.operation_id, kind: input.kind, duration_seconds: input.duration_seconds });
  const policy = mediaPolicy();
  const receipt = policyReceipt.parse({ photos:policy.photos.value, videos:policy.videos.value, seconds:policy.seconds.value, photo_version:policy.photos.version, video_version:policy.videos.version, seconds_version:policy.seconds.version });
  const localOp = {...op,policy:receipt};
  if ((op.kind === "photo" && op.duration_seconds !== null) || (op.kind === "video" && (op.duration_seconds === null || op.duration_seconds > policy.seconds.value))) throw new Error("Invalid media duration");
  const store = runtimeStore(), journey = await store.getJourney(input.request_id);
  if (!journey || journey.session.request_id !== input.request_id || (journey.problem.tenant_id ?? DEFAULT_TENANT_ID) !== input.tenant_id) throw new Error("Media request ownership mismatch");
  if (store.kind === "supabase") {
    const { data, error } = await requireServiceClient().rpc("reserve_request_media", {
      p_request_id: input.request_id, p_tenant_id: input.tenant_id, p_operation: op,
      p_policy: { photos: policy.photos.value, videos: policy.videos.value, seconds: policy.seconds.value,
        photo_version: policy.photos.version, video_version: policy.videos.version, seconds_version: policy.seconds.version },
    });
    if (error) throw new Error("Shared media admission unavailable");
    return z.object({ accepted: z.boolean(), duplicate: z.boolean(), used: z.number().int().nonnegative(), max: z.number().int().positive() }).strict().parse(data);
  }
  const root = process.env.PRN_DEV_DB_PATH ? dirname(process.env.PRN_DEV_DB_PATH) : join(process.cwd(), "data", "runtime");
  const path = join(root, "media-budgets", createHash("sha256").update(input.tenant_id+":"+input.request_id).digest("hex")+".json");
  const evidence = await store.listEvidence(journey.problem.problem_id, input.request_id);
  return withFileLock(path, () => {
    const held = existsSync(path) ? ledger.parse(JSON.parse(readFileSync(path,"utf8"))) : ledger.parse({
      request_id: input.request_id, tenant_id: input.tenant_id, problem_id: journey.problem.problem_id,
      baseline_photos: evidence.filter(e=>e.kind === "photo").length, baseline_videos: evidence.filter(e=>e.kind === "video").length, reservations: [],
    });
    if (held.request_id !== input.request_id || held.tenant_id !== input.tenant_id || held.problem_id !== journey.problem.problem_id) throw new Error("Media ledger identity mismatch");
    const previous = held.reservations.find(r=>r.operation_id === op.operation_id);
    if (previous && JSON.stringify(previous) !== JSON.stringify(localOp)) throw new Error("Media operation identity reused");
    const used = (op.kind === "photo" ? held.baseline_photos : held.baseline_videos) + held.reservations.filter(r=>r.kind === op.kind).length;
    const max = op.kind === "photo" ? policy.photos.value : policy.videos.value;
    if (previous) return { accepted: true, duplicate: true, used, max };
    if (used >= max) return { accepted: false, duplicate: false, used, max };
    held.reservations.push(localOp); writeFileAtomic(path, JSON.stringify(ledger.parse(held)));
    return { accepted: true, duplicate: false, used: used + 1, max };
  });
}
