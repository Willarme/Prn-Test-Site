"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { flagEnabled } from "@/platform/flags";
import { ownerAllowed } from "@/platform/links/owner";
import { runtimeStore } from "@/platform/stores/runtime";
import { journeySafetyRule } from "@/domain/problem/journey-safety";
import { SHARE_UNAVAILABLE, buildShareMessage, type ShareMessage } from "@/platform/results/share";

/**
 * The server action behind the "I already have someone" form. Transport only:
 * it reads the request origin (routine decision 9: link_base = the request
 * origin) and hands the rest to the share capability. A "use server" module
 * may export only async functions (and types), which is why the strings live
 * in the capability module.
 */
export type ShareState =
  | { status: "idle" }
  | { status: "ready"; message: ShareMessage; person: string | null }
  | { status: "error"; error: string };

const Input = z.object({
  request_id: z.string().min(1).max(120),
  k: z.string().max(4096).optional(),
  person: z.string().trim().max(120).optional(),
  contact: z.string().trim().max(320).optional(),
});

async function requestOrigin(): Promise<string> {
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "http";
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  return `${proto}://${host}`;
}

export async function makeShareLink(_prev: ShareState, formData: FormData): Promise<ShareState> {
  if (!flagEnabled("results_shell_enabled")) return { status: "error", error: SHARE_UNAVAILABLE };
  const parsed = Input.safeParse({
    request_id: formData.get("request_id"),
    k: formData.get("k") ?? undefined,
    person: formData.get("person") ?? undefined,
    contact: formData.get("contact") ?? undefined,
  });
  if (!parsed.success) return { status: "error", error: SHARE_UNAVAILABLE };
  const { request_id, person, contact } = parsed.data;
  if (!(await ownerAllowed(request_id, parsed.data.k))) return { status: "error", error: SHARE_UNAVAILABLE };
  const journey = await runtimeStore().getJourney(request_id);
  if (!journey) return { status: "error", error: SHARE_UNAVAILABLE };
  const safety = journeySafetyRule(journey.problem);
  if (safety && !safety.intake_may_continue) redirect(`/safety/${encodeURIComponent(safety.safety_rule_id)}`);
  const message = await buildShareMessage({
    request_id,
    origin: await requestOrigin(),
    contact: contact && contact.length > 0 ? contact : null,
  });
  if (!message) return { status: "error", error: SHARE_UNAVAILABLE };
  return { status: "ready", message, person: person && person.length > 0 ? person : null };
}
