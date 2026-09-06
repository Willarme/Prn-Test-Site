import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { readBody, redirect303 } from "@/platform/links/body";
import { verifyLinkForRoute as verifyLink } from "@/platform/links/tokens";
import { runtimeStore } from "@/platform/stores/runtime";

/**
 * THE FRIEND'S ANSWER (track P3; WORDING 41: the friend's whole part is one
 * name and one tap, no account). The ask token proves the friend was sent
 * this request's link; the answer is written to ask_answers and nothing
 * else changes. Two fields are required, name and who they would call; the
 * rest is optional and blank stays blank.
 */
const LIMITS = { friend_name: 120, provider_name: 160, provider_contact: 200, reason: 500 } as const;

function clip(value: string | undefined, max: number): string | null {
  const v = (value ?? "").trim();
  return v ? v.slice(0, max) : null;
}

export async function POST(request: Request): Promise<Response> {
  const { data, wantsJson } = await readBody(request);
  const token = data.token ?? "";
  const back = `/ask/${encodeURIComponent(token)}`;

  const link = await verifyLink(token, "ask");
  if (!link.ok) {
    return wantsJson ? NextResponse.json({ error: link.reason === "unavailable" ? "unavailable" : "link_off" }, { status: link.reason === "unavailable" ? 503 : 403 }) : redirect303(back);
  }
  const friend_name = clip(data.friend_name, LIMITS.friend_name);
  const provider_name = clip(data.provider_name, LIMITS.provider_name);
  const missing = !friend_name ? "name" : !provider_name ? "provider" : null;
  if (missing) {
    return wantsJson
      ? NextResponse.json({ error: missing }, { status: 400 })
      : redirect303(`${back}?error=${missing}`);
  }

  await runtimeStore().saveAskAnswer({
    ask_id: `ask_${randomUUID()}`,
    request_id: link.request_id,
    friend_name: friend_name!,
    friend_contact: null,
    provider_name: provider_name!,
    provider_contact: clip(data.provider_contact, LIMITS.provider_contact),
    reason: clip(data.reason, LIMITS.reason),
    created_at: new Date().toISOString(),
  });

  if (wantsJson) return NextResponse.json({ ok: true });
  return redirect303(`${back}?thanks=1`);
}
