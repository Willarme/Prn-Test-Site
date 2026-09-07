import { NextResponse } from "next/server";
import { readBody, redirect303 } from "@/platform/links/body";
import { ledgerHasLink } from "@/platform/links/ledger";
import { ownerAllowed } from "@/platform/links/owner";
import { revokeLink } from "@/platform/links/tokens";

/**
 * POST /api/links/revoke {link_id, request_id, k?} — SWITCH A LINK OFF
 * (track P3; DECISIONS FOR MELISSA decision 8, recommendation A: the link
 * dies, the record lives).
 *
 * WHO MAY. The homeowner, shown two ways: the journey cookie for this
 * request, or `k`, a keep-scoped token for the same request (the record's
 * own capability link, printed on their packet). The cookie alone would not
 * do: startIntake scopes it to path=/results, so a browser never sends it
 * to /links or here. The link must also be one this request's ledger says
 * it issued, so a link id from some other journey cannot be killed from
 * this one, and an unknown id is a no-op rather than a ledger row.
 *
 * Revoking twice is one dead link (revokeLink is idempotent). The store's
 * revocation ledger gains a row; nothing is deleted, nothing else changes.
 * The owner check lives in src/platform/links/owner.ts, shared with the
 * /links page.
 */
export async function POST(request: Request): Promise<Response> {
  const { data, wantsJson } = await readBody(request);
  const link_id = data.link_id ?? "";
  const request_id = data.request_id ?? "";
  const k = data.k || undefined;
  const back = `/links/${encodeURIComponent(request_id)}${k ? `?k=${encodeURIComponent(k)}` : ""}`;

  if (!link_id || !request_id) {
    return wantsJson ? NextResponse.json({ error: "link_id and request_id are required" }, { status: 400 }) : redirect303(back);
  }
  if (!(await ownerAllowed(request_id, k))) {
    return wantsJson ? NextResponse.json({ error: "forbidden" }, { status: 403 }) : redirect303(back);
  }
  if (!(await ledgerHasLink(request_id, link_id))) {
    return wantsJson ? NextResponse.json({ error: "unknown link" }, { status: 404 }) : redirect303(back);
  }

  await revokeLink(link_id, request_id);

  if (wantsJson) return NextResponse.json({ ok: true, link_id, revoked: true });
  return redirect303(`${back}${k ? "&" : "?"}off=${encodeURIComponent(link_id)}`);
}
