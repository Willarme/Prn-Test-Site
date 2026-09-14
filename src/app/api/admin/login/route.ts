import { NextResponse } from "next/server";
import { z } from "zod";
import { ADMIN_COOKIE_NAME, adminAccessKind, loginAllowed, passwordMatches, resetLoginAttempts, sessionCookie } from "@/platform/admin/auth";
import { readAdminEmpty, readAdminJson } from "@/platform/admin/body";
import { adminBoundary, adminError, guardAdminMutation } from "@/platform/admin/request";

const Body = z.object({ password: z.string().min(1).max(1024) }).strict();

export async function POST(request: Request): Promise<NextResponse> {
  return adminBoundary(async () => {
    const refusal = await guardAdminMutation(request, { authentication: "login" });
    if (refusal) return refusal;
    if ((await adminAccessKind(request)) === "unconfigured") return adminError("Owner sign-in is not configured for this environment.", 400);
    if (!loginAllowed()) return adminError("Too many attempts. Wait a few minutes and try again.", 429);
    const parsed = await readAdminJson(request, Body, 4096);
    if (!parsed.ok) return parsed.response;
    if (!passwordMatches(parsed.data.password, request)) return adminError("That password did not match.", 401);
    resetLoginAttempts();
    const cookie = sessionCookie(parsed.data.password, request);
    const response = NextResponse.json({ ok: true });
    response.cookies.set(cookie.name, cookie.value, {
      httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production",
      maxAge: cookie.maxAge, path: "/",
    });
    return response;
  });
}

export async function DELETE(request: Request): Promise<NextResponse> {
  return adminBoundary(async () => {
    const refusal = await guardAdminMutation(request, { authentication: "logout" });
    if (refusal) return refusal;
    const empty = await readAdminEmpty(request);
    if (!empty.ok) return empty.response;
    const response = NextResponse.json({ ok: true });
    response.cookies.set(ADMIN_COOKIE_NAME, "", {
      maxAge: 0, path: "/", httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production",
    });
    return response;
  });
}
