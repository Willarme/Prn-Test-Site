import { NextResponse } from "next/server";
import { z } from "zod";
import { adminConfigured, passwordMatches, sessionCookie } from "@/platform/admin/auth";

export async function POST(request: Request): Promise<NextResponse> {
  if (!adminConfigured()) {
    return NextResponse.json(
      { error: "No owner password configured yet (ADMIN_PASSWORD, at least 8 characters)." },
      { status: 400 }
    );
  }
  const parsed = z.object({ password: z.string() }).safeParse(await request.json().catch(() => null));
  if (!parsed.success || !passwordMatches(parsed.data.password)) {
    return NextResponse.json({ error: "That password didn't match." }, { status: 401 });
  }
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
  res.cookies.set("prn_admin", "", { maxAge: 0, path: "/" });
  return res;
}
