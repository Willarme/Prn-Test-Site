import { NextResponse } from "next/server";
import { z } from "zod";
import { readAdminJson } from "@/platform/admin/body";
import { adminBoundary, guardAdminMutation } from "@/platform/admin/request";
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
  scope_ref: z.string().min(1).max(200).optional(),
  reason: z.string().max(280).optional(),
});

export async function POST(request: Request): Promise<NextResponse> {
  return adminBoundary(async () => {
    const refusal = await guardAdminMutation(request);
    if (refusal) return refusal;

    const parsed = await readAdminJson(request, Body);
    if (!parsed.ok) return parsed.response;
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
    } catch {
      return NextResponse.json(
        { error: "The switch could not be updated. Try again later." },
        { status: 500 }
      );
    }
  });
}
