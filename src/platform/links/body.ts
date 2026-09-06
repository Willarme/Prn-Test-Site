/**
 * One body reader for the link surfaces' POST routes (track P3): a plain HTML
 * form (the pages post with no JavaScript) or a JSON body (a later client).
 * Every value comes back as a trimmed string; the caller validates.
 */
export interface ReadBody {
  data: Record<string, string>;
  /** The caller sent JSON (answer with JSON) rather than a form (answer with a redirect). */
  wantsJson: boolean;
}

export async function readBody(request: Request): Promise<ReadBody> {
  const type = request.headers.get("content-type") ?? "";
  const data: Record<string, string> = {};
  if (type.includes("application/json")) {
    const raw = (await request.json().catch(() => null)) as unknown;
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
        if (typeof v === "string") data[k] = v.trim();
        else if (typeof v === "number" || typeof v === "boolean") data[k] = String(v);
      }
    }
    return { data, wantsJson: true };
  }
  const form = await request.formData().catch(() => null);
  if (form) {
    for (const [k, v] of form.entries()) {
      if (typeof v === "string") data[k] = v.trim();
    }
  }
  return { data, wantsJson: false };
}

export function redirect303(location: string, headers?: Record<string, string>): Response {
  return new Response(null, { status: 303, headers: { Location: location, "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", ...(headers ?? {}) } });
}
