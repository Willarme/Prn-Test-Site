import { NextResponse } from "next/server";
import { z } from "zod";
import {
  ADMIN_COOKIE_NAME,
  adminConfigured,
  loginAllowed,
  passwordMatches,
  resetLoginAttempts,
  sessionCookie,
} from "@/platform/admin/auth";

function clientKey(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "local"
  );
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!adminConfigured()) {
    return NextResponse.json(
      { error: "No owner password configured yet (ADMIN_PASSWORD, at least 8 characters)." },
      { status: 400 }
    );
  }
  const key = clientKey(request);
  if (!loginAllowed(key)) {
    return NextResponse.json(
      { error: "Too many attempts. Wait a few minutes and try again." },
      { status: 429 }
    );
  }
  const parsed = z.object({ password: z.string() }).safeParse(await request.json().catch(() => null));
  if (!parsed.success || !passwordMatches(parsed.data.password)) {
    return NextResponse.json({ error: "That password did not match." }, { status: 401 });
  }
  resetLoginAttempts(key);
  const cookie = sessionCookie(parsed.data.password);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(cookie.name, cookie.value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: cookie.maxAge,
    path: "/",
  });
  return res;
}

export async function DELETE(): Promise<NextResponse> {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE_NAME, "", { maxAge: 0, path: "/" });
  return res;
}
