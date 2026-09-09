import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requirePolicyNumber } from "@/platform/policy/store";
import { fileStoreForced, requireServiceClient, serviceConfigured } from "@/platform/db/client";

/**
 * Private media storage for customer photos/video (#14A §19: private
 * attachments only; short-lived signed URLs or server-mediated access).
 * Originals stay private forever; any public derivative (later) is a separate
 * object with EXIF stripped.
 *
 * INTERNAL (service-role) by design — see docs/security/SERVICE-KEY-AUDIT.md:
 * Supabase Storage bucket access is a distinct RLS surface (storage.objects
 * policies, not this repo's public-schema tables) from the request-scoped
 * read seam this item builds; `signedUrl()` below is not called from any
 * live route yet (grepped — no caller), so there is no customer-facing read
 * path here today to move.
 */
export const MEDIA_ALLOWLIST: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
};
// A00 step 6: the 25 MB cap moved to the versioned Policy + Config Store
// (key intake.media_max_bytes) — same value, same behavior, one less magic
// number. This export stays so existing readers are untouched.
export const MEDIA_MAX_BYTES = requirePolicyNumber("intake.media_max_bytes");

export interface StoredMedia {
  storage_ref: string;
  mime: string;
  bytes: number;
}

export interface MediaStore {
  readonly kind: "supabase" | "file";
  put(key: string, data: Buffer, mime: string): Promise<StoredMedia>;
  /** Short-lived URL for the owner/customer UI only. */
  signedUrl(storageRef: string, seconds?: number): Promise<string | null>;
}

const BUCKET = "private-evidence";

class SupabaseMediaStore implements MediaStore {
  readonly kind = "supabase" as const;
  private db: SupabaseClient = requireServiceClient();
  private ensured = false;

  private async ensureBucket(): Promise<void> {
    if (this.ensured) return;
    const { data } = await this.db.storage.getBucket(BUCKET);
    if (!data) {
      const { error } = await this.db.storage.createBucket(BUCKET, {
        public: false,
        fileSizeLimit: MEDIA_MAX_BYTES,
        allowedMimeTypes: Object.keys(MEDIA_ALLOWLIST),
      });
      if (error && !/already exists/i.test(error.message)) {
        throw new Error(`create bucket: ${error.message}`);
      }
    }
    this.ensured = true;
  }

  async put(key: string, data: Buffer, mime: string): Promise<StoredMedia> {
    await this.ensureBucket();
    const { error } = await this.db.storage.from(BUCKET).upload(key, data, {
      contentType: mime,
      upsert: false,
    });
    if (error) throw new Error(`upload: ${error.message}`);
    return { storage_ref: `${BUCKET}/${key}`, mime, bytes: data.byteLength };
  }

  async signedUrl(storageRef: string, seconds = 600): Promise<string | null> {
    const key = storageRef.replace(`${BUCKET}/`, "");
    const { data, error } = await this.db.storage.from(BUCKET).createSignedUrl(key, seconds);
    if (error || !data) return null;
    return data.signedUrl;
  }
}

class FileMediaStore implements MediaStore {
  readonly kind = "file" as const;
  private root = join(process.env.PRN_DEV_DB_PATH ? dirname(process.env.PRN_DEV_DB_PATH) : join(process.cwd(), "data", "runtime"), "media");

  private validKey(key: string): boolean {
    // Exactly the shape issued by attachMedia: never normalize user-supplied
    // separators, encoded segments, dot segments or Windows drive syntax.
    return /^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+\.[a-zA-Z0-9]+$/.test(key);
  }

  async put(key: string, data: Buffer, mime: string): Promise<StoredMedia> {
    if (!this.validKey(key)) throw new Error("Invalid private media key");
    const path = join(this.root, key);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, data);
    return { storage_ref: `local/${key}`, mime, bytes: data.byteLength };
  }

  async signedUrl(storageRef: string): Promise<string | null> {
    // Served through the media route which reads the file server-side.
    return `/api/intake/media?ref=${encodeURIComponent(storageRef)}`;
  }

  read(storageRef: string): Buffer | null {
    if (!storageRef.startsWith("local/")) return null;
    const key = storageRef.replace(/^local\//, "");
    if (!this.validKey(key)) return null;
    try {
      return readFileSync(join(this.root, key));
    } catch {
      return null;
    }
  }
}

let cached: MediaStore | null = null;

export function mediaStore(): MediaStore {
  if (!cached) {
    // PRN_RUNTIME_STORE=file (track F2b): a local demo or a test run must never
    // upload a customer-like photo into the trial project's private bucket,
    // even though .env.local on this machine carries the service key. The
    // explicit check here is deliberate belt-and-braces on top of
    // serviceConfigured() honouring the same override.
    cached =
      !fileStoreForced() && serviceConfigured() ? new SupabaseMediaStore() : new FileMediaStore();
  }
  return cached;
}

export function localMediaFile(storageRef: string): Buffer | null {
  const store = mediaStore();
  return store instanceof FileMediaStore ? store.read(storageRef) : null;
}

/** Server-only read after the caller has authorized this request's evidence. */
export async function readPrivateMediaBytes(storageRef: string): Promise<Buffer | null> {
  const local = localMediaFile(storageRef);
  if (local) return local;
  const store = mediaStore();
  if (store.kind !== "supabase" || !/^private-evidence\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+\.[a-zA-Z0-9]+$/.test(storageRef)) return null;
  try {
    // The short-lived storage URL stays on the server, never in HTML or PDF.
    const url = await store.signedUrl(storageRef, 60);
    if (!url || !/^https:\/\//.test(url)) return null;
    const response = await fetch(url);
    if (!response.ok) return null;
    const declaredSize = Number(response.headers.get("content-length"));
    if (declaredSize > MEDIA_MAX_BYTES) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    return bytes.length <= MEDIA_MAX_BYTES ? bytes : null;
  } catch { return null; }
}
