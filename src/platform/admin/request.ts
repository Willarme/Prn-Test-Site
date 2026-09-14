import { NextResponse } from "next/server";
import { isAdminUnlocked } from "@/platform/admin/auth";

export function adminError(error: string, status: number): NextResponse {
  return NextResponse.json({ error }, { status, headers: { "Cache-Control": "private, no-store" } });
}

/** Keep unexpected adapter/storage messages out of HTTP responses. */
export async function adminBoundary(action: () => Promise<NextResponse>): Promise<NextResponse> {
  try {
    const response = await action();
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.set("X-Content-Type-Options", "nosniff");
    return response;
  } catch { return adminError("The admin action could not be completed. Try again later.", 500); }
}

export async function guardAdminRead(request?: Request): Promise<NextResponse | null> {
  return (await isAdminUnlocked(request)) ? null : adminError("Owner sign-in required", 403);
}

function originAllowed(request: Request): boolean {
  try {
    const requestUrl = new URL(request.url);
    const configured = process.env.PRN_ADMIN_ORIGIN;
    const expected = new URL(configured || requestUrl.origin);
    if (expected.username || expected.password || expected.pathname !== "/" || expected.search || expected.hash) return false;
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(expected.hostname);
    // A public proxy origin must come from configuration, never visitor input.
    if (!local && (!configured || expected.protocol !== "https:")) return false;
    if (local && expected.protocol !== "http:") return false;
    if (configured && configured !== expected.origin) return false;
    const host = request.headers.get("host");
    if (host !== null && host !== expected.host) return false;
    const forwardedHost = request.headers.get("x-forwarded-host");
    const forwardedProto = request.headers.get("x-forwarded-proto");
    if (request.headers.has("forwarded") ||
        (forwardedHost !== null && forwardedHost !== expected.host) ||
        (forwardedProto !== null && forwardedProto !== expected.protocol.slice(0, -1))) return false;
    return request.headers.get("origin") === expected.origin &&
      !["cross-site", "none"].includes(request.headers.get("sec-fetch-site") ?? "");
  } catch { return false; }
}

let mutationWindow = { start: 0, count: 0 };
function mutationAllowed(): boolean {
  const now = Date.now();
  if (now - mutationWindow.start >= 60_000 || now < mutationWindow.start) mutationWindow = { start: now, count: 0 };
  mutationWindow.count = Math.min(mutationWindow.count + 1, 121);
  return mutationWindow.count <= 120;
}
export function resetAdminMutationLimitForTests(): void { mutationWindow = { start: 0, count: 0 }; }

export async function guardAdminMutation(request: Request, options: { authentication?: "required" | "login" | "logout" } = {}): Promise<NextResponse | null> {
  if (options.authentication !== "login" && options.authentication !== "logout") {
    const refusal = await guardAdminRead(request);
    if (refusal) return refusal;
  }
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) return adminError("Mutation method required", 405);
  if (!originAllowed(request)) return adminError("Same-origin request required", 403);
  if (!mutationAllowed()) return adminError("Too many requests. Wait a minute and try again.", 429);
  return null;
}
