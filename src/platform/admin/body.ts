import type { z } from "zod";
import type { NextResponse } from "next/server";
import { adminError } from "@/platform/admin/request";

type ReadResult<T> = { ok: true; data: T } | { ok: false; response: NextResponse };
const MAX_BODY_BYTES = 64 * 1024;

async function boundedBody(request: Request, maximum: number, allowAbsent = false): Promise<ReadResult<Uint8Array>> {
  if (request.headers.has("content-encoding")) return { ok: false, response: adminError("Unsupported request encoding", 415) };
  const length = request.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length)))) return { ok: false, response: adminError("Invalid request body", 400) };
  if (length !== null && Number(length) > maximum) return { ok: false, response: adminError("Request body too large", 413) };
  const reader = request.body?.getReader();
  if (!reader) return allowAbsent ? { ok: true, data: new Uint8Array(0) } : { ok: false, response: adminError("Invalid request body", 400) };
  const chunks: Uint8Array[] = [];
  let size = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("body timeout")), 10_000);
  });
  try {
    while (true) {
      const part = await Promise.race([reader.read(), expired]);
      if (part.done) break;
      size += part.value.byteLength;
      if (size > maximum) {
        void reader.cancel().catch(() => {});
        return { ok: false, response: adminError("Request body too large", 413) };
      }
      chunks.push(part.value);
    }
    const body = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    return { ok: true, data: body };
  } catch {
    void reader.cancel().catch(() => {});
    return { ok: false, response: adminError("Invalid request body", 400) };
  } finally { clearTimeout(timer); reader.releaseLock(); }
}

/** Next may represent an empty DELETE body as a stream. Check bytes, not its presence. */
export async function readAdminEmpty(request: Request): Promise<ReadResult<Uint8Array>> {
  return boundedBody(request, 0, true);
}

function validate<T>(schema: z.ZodType<T>, body: unknown): ReadResult<T> {
  const parsed = schema.safeParse(body);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false, response: adminError("Invalid request body", 400) };
}

export async function readAdminJson<T>(request: Request, schema: z.ZodType<T>, maximum = MAX_BODY_BYTES): Promise<ReadResult<T>> {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get("content-type") ?? "")) return { ok: false, response: adminError("JSON request required", 415) };
  const read = await boundedBody(request, Math.min(maximum, MAX_BODY_BYTES));
  if (!read.ok) return read;
  try { return validate(schema, JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(read.data))); }
  catch { return { ok: false, response: adminError("Invalid request body", 400) }; }
}

export async function readAdminForm<T>(request: Request, schema: z.ZodType<T>): Promise<ReadResult<T>> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^application\/x-www-form-urlencoded(?:\s*;\s*charset=utf-8)?$/i.test(contentType) &&
      !/^multipart\/form-data;\s*boundary=[A-Za-z0-9'()+_,\-./:=?]{1,100}$/i.test(contentType)) return { ok: false, response: adminError("Form request required", 415) };
  const read = await boundedBody(request, MAX_BODY_BYTES);
  if (!read.ok) return read;
  try {
    const form = await new Response(Buffer.from(read.data), { headers: { "Content-Type": contentType } }).formData();
    const body: Record<string, string> = Object.create(null) as Record<string, string>;
    for (const [key, value] of form.entries()) {
      if (typeof value !== "string" || Object.hasOwn(body, key) || key.length > 100) return { ok: false, response: adminError("Invalid request body", 400) };
      body[key] = value;
    }
    return validate(schema, body);
  } catch { return { ok: false, response: adminError("Invalid request body", 400) }; }
}
