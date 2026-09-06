import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ownerAllowed } from "@/platform/links/owner";
import { flagEnabled } from "@/platform/flags";
import { loadJourneyContext, regeneratePacket } from "@/platform/intake/complete";
import { finishIntakeEffort } from "@/platform/intake/effort";

const Body = z.object({ request_id: z.string().min(1), k: z.string().max(4096).optional() });
export async function POST(request: Request) {
  if (!flagEnabled("intake_shell_enabled")) return NextResponse.json({ error: "not enabled" }, { status: 404 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const { request_id, k } = parsed.data;
  if (!(await ownerAllowed(request_id, k))) return NextResponse.json({ error: "Unknown request" }, { status: 404 });
  const ctx = await loadJourneyContext(request_id);
  if (!ctx) return NextResponse.json({ error: "Unknown request" }, { status: 404 });
  try {
    await finishIntakeEffort({ request_id, tenant_id: ctx.journey.problem.tenant_id ?? "prn", operation_id: `finish:${randomUUID()}` });
    await regeneratePacket(request_id);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Could not save your finish. Your saved packet remains available." }, { status: 503 });
  }
}
