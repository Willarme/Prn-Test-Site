import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { requirePolicyNumber } from "@/platform/policy/store";

/**
 * Private media storage for customer photos/video (#14A §19: private
 * attachments only; short-lived signed URLs or server-mediated access).
 * Originals stay private forever; any public derivative (later) is a separate
 * object with EXIF stripped.
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
  private db = createClient(
    process.env.SUPABASE_URL as string,
    process.env.SUPABASE_SERVICE_ROLE_KEY as string,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
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
  private root = join(process.cwd(), "data", "runtime", "media");

  async put(key: string, data: Buffer, mime: string): Promise<StoredMedia> {
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
    const key = storageRef.replace(/^local\//, "");
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
    cached =
      process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
        ? new SupabaseMediaStore()
        : new FileMediaStore();
  }
  return cached;
}

export function localMediaFile(storageRef: string): Buffer | null {
  const store = mediaStore();
  return store instanceof FileMediaStore ? store.read(storageRef) : null;
}
