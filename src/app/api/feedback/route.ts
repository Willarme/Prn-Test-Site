import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { flagEnabled } from "@/platform/flags";
import { runtimeStore, type Feedback } from "@/platform/stores/runtime";
import { ownerAllowed } from "@/platform/links/owner";

/**
 * POST /api/feedback — the feedback popup's collector (campaign track P2).
 *
 * Four fields, exactly the popup's (Unique Links and Feedback Popup decisions
 * §2): the three-chip score, which is the one number that matters; the four
 * "what did it get right?" options, posted as short keys so each design claim
 * they measure can be counted; and the single free-text near-miss question,
 * capped. Nothing about price, nothing about providers, nothing we cannot act
 * on.
 *
 * The signed owner cookie or matching keep capability is checked before the
 * journey lookup. Storage failures return 503 so the popup retains the answer
 * for retry; only a successful receipt ends the survey.
 */
const RIGHT_KEYS = ["asked_unexpected", "remembered", "understand_better", "ready_to_talk"] as const;

const Body = z.object({
  request_id: z.string().min(1).max(120),
  k: z.string().max(4096).optional(),
  score: z.enum(["not_really", "somewhat", "very"]),
  right: z.array(z.enum(RIGHT_KEYS)).max(RIGHT_KEYS.length).default([]),
  slow: z.string().max(500).nullable().default(null),
});

export async function POST(request: Request): Promise<NextResponse> {
  if (!flagEnabled("results_shell_enabled")) {
    return NextResponse.json({ error: "not enabled" }, { status: 404 });
  }
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const { request_id, score, right, slow } = parsed.data;
  if (!(await ownerAllowed(request_id, parsed.data.k))) return NextResponse.json({ error: "unavailable" }, { status: 404 });

  const store = runtimeStore();
  let known = false;
  try {
    known = (await store.getJourney(request_id)) !== null;
  } catch {
    /* a lookup failure is treated as unknown, below */
  }
  if (!known) return NextResponse.json({ ok: false, error: "unavailable" }, { status: 404 });

  const feedback: Feedback = {
    feedback_id: `fb_${randomUUID()}`,
    request_id,
    score,
    right: Array.from(new Set(right)),
    slow: slow && slow.trim() ? slow.trim() : null,
    created_at: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
  };
  try {
    await store.saveFeedback(feedback);
    return NextResponse.json({ ok: true, recorded: store.kind });
  } catch {
    return NextResponse.json({ ok: false, error: "Could not save feedback" }, { status: 503 });
  }
}
