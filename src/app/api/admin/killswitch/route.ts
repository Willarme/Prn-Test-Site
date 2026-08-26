import { NextResponse } from "next/server";
import { z } from "zod";
import { isAdminUnlocked } from "@/platform/admin/auth";
import { engageKillSwitch, releaseKillSwitch } from "@/platform/killswitch";

/**
 * OWNER-ONLY kill switch toggling. Same auth gate as every other admin API
 * route: 403 unless the owner session is unlocked. The engage/release logic
 * itself is the platform's own (platform/killswitch) — this route adds no
 * second implementation of what a switch does, it only carries the owner's
 * hand to it.
 */
const Body = z.object({
  action: z.enum(["engage", "release"]),
  scope: z.enum(["GLOBAL", "AGENT"]),
  scope_ref: z.string().min(1).optional(),
  reason: z.string().max(280).optional(),
});

export async function POST(request: Request): Promise<NextResponse> {
  if (!(await isAdminUnlocked())) {
    return NextResponse.json({ error: "Owner sign-in required" }, { status: 403 });
  }

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const { action, scope, scope_ref, reason } = parsed.data;
  if (scope === "AGENT" && !scope_ref) {
    return NextResponse.json({ error: "scope_ref is required for AGENT scope" }, { status: 400 });
  }

  try {
    const state =
      action === "engage"
        ? await engageKillSwitch({ scope, scope_ref, by: "owner-admin", reason })
        : await releaseKillSwitch({ scope, scope_ref, by: "owner-admin", reason });
    return NextResponse.json(state);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "The switch did not move" },
      { status: 500 }
    );
  }
}
