import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { runtimeStore, type Signup } from "@/platform/stores/runtime";
import { readAdminJson } from "@/platform/admin/body";
import { featureInterestOriginAllowed } from "@/platform/features/interest";
import { readFeatureSnapshot, stateIn } from "@/platform/features/state";

/**
 * THE VOTE BLOCK'S COLLECTOR.
 *
 * Every one of Melissa's six product preview pages ends with the same two
 * buttons and posts the result here. The serving adapter waits for this
 * collector's receipt before showing recorded/signed-up states; a failed write
 * leaves the current entries in the page for retry. This is the fourth funnel
 * step #14A §16 names, and it is the only thing on those pages that leaves the
 * browser.
 *
 * PRIVACY. A "yes" carries a name, an email, a phone and a ZIP — the most
 * identifying payload anywhere in the trial. It is USER_PRIVATE: it is written
 * to the runtime store (`saveSignup`, track F2b — the file store's `signups`
 * collection locally, the `signups` table on Supabase once migration 00020 is
 * applied), it is never logged, never echoed back in the response, and never
 * put in a URL.
 *
 * The pages send `{ vote, name, email, phone, zip, reasons, at, page, id }`.
 * `id` is the browser's own idempotency key so a re-vote CORRECTS rather than
 * duplicates (the store keys on it as `vote_id`); `at` is that browser's clock
 * and is kept as the page's own claim, while `created_at` is the server's.
 */
const SignupRequest = z.object({
  vote: z.enum(["yes", "no"]),
  page: z.string().min(1).max(120),
  /** The browser's own id for this vote — replaces an earlier one from it. */
  id: z.string().min(1).max(64).optional(),
  at: z.string().max(40).optional(),
  name: z.string().max(200).optional(),
  email: z.string().max(320).optional(),
  phone: z.string().max(60).optional(),
  zip: z.string().max(20).optional(),
  reasons: z.array(z.string().max(300)).max(20).optional(),
});

export async function POST(request: Request): Promise<NextResponse> {
  if (!featureInterestOriginAllowed(request)) return NextResponse.json({ error: "not allowed" }, { status: 403 });
  const read = await readAdminJson(request, SignupRequest, 12 * 1024);
  if (!read.ok) return read.response;
  const d = read.data;
  const productIds: Record<string, string> = {
    "Dashboard v3": "product_dashboard", "Trust Network v3": "product_trust_network",
    "SmartQuote v3": "product_smartquote", "Home Memory v2": "product_home_memory",
    "One Connected Home": "explainers", "Provider OS v2": "provider_os",
  };
  const featureId = productIds[d.page];
  if (!featureId || stateIn(await readFeatureSnapshot({ fresh: true }), featureId) === "HIDDEN") return NextResponse.json({ error: "not enabled" }, { status: 404 });
  const created_at = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const signup_id = `su_${randomUUID()}`;
  const record: Signup = {
    signup_id,
    page: d.page,
    vote: d.vote,
    ...(d.name ? { name: d.name } : {}),
    ...(d.email ? { email: d.email } : {}),
    ...(d.phone ? { phone: d.phone } : {}),
    ...(d.zip ? { zip: d.zip } : {}),
    ...(d.reasons ? { reasons: d.reasons } : {}),
    vote_id: d.id ?? signup_id,
    browser_at: d.at ?? null,
    created_at,
  };

  try {
    const store = runtimeStore();
    await store.saveSignup(record);
    return NextResponse.json({ ok: true, recorded: store.kind });
  } catch {
    return NextResponse.json({ ok: false, error: "Your response could not be saved. Try again." }, { status: 503 });
  }
}
