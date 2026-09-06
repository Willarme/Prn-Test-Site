import { PacketHaltError, renderPacketHtml } from "@/domain/packet/render";
import { escapeAttr, escapeHtml } from "@/domain/packet/script";
import { recordCustomerEvent } from "@/platform/events/customer";
import { loadPacket, resolvePacketAccess } from "@/platform/packet/load";
import { demoAwareOrigin } from "@/platform/demo-origin";

/**
 * GET /packet/[request_id] — the Job Packet as a standalone print document
 * (campaign track P1, 2026-09-05). A route handler, not a page: the app shell
 * is not wanted around a print document, and the packet's own CSS is the
 * approved mockup's.
 *
 * Outcomes, all of them a page a browser can render:
 *   - unknown journey, or a share link that does not open it → 404
 *   - no job address yet → the address form (Directions §3.3 requires one;
 *     routine decision 10 says ask inline, never dead-end) → POST
 *     /api/packet/address → 303 back here
 *   - the packet, with a small no-print toolbar (Download PDF / Print)
 *   - `?print=1` opens the print dialog on load (the PDF route's fallback
 *     when Chrome is not available)
 *
 * A packet that fails its own self-check (Directions §10.4) is still shown —
 * a homeowner is never dead-ended — with a held-for-review line in the
 * toolbar, and the PDF route refuses it. The failures go to the server log.
 */
export const dynamic = "force-dynamic";

const PROPERTY_TYPES = ["single-family", "townhouse", "condo", "duplex", "mobile"] as const;
const STOREYS = ["1 storey", "2 storey", "3 storey"] as const;

function html(body: string, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

function notFound(): Response {
  return html(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Not found</title></head><body style="font-family:system-ui;padding:40px;max-width:52ch"><h1 style="font-size:1.3rem">This packet is not here.</h1><p>The link may have been revoked or the address typed wrong. Start again from the page you came in on.</p></body></html>`,
    404
  );
}

/**
 * The address form. Standalone, the mockup's tokens, one screen. New
 * homeowner-visible strings (listed in the track report for Melissa).
 */
function addressForm(requestId: string, keep: string | undefined, error: string | null): string {
  const options = PROPERTY_TYPES.map((t) => `<option value="${t}">${t}</option>`).join("");
  const storeys = STOREYS.map((s) => `<option value="${s}">${s}</option>`).join("");
  const back = `/packet/${encodeURIComponent(requestId)}${keep ? `?k=${encodeURIComponent(keep)}` : ""}`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">
<title>Job Packet address</title>
<style>
  :root{--ink:#0F1114;--text:#12161A;--muted:#5A6462;--paper:#F7F7F5;--white:#fff;--pink:#FF2E7E;--pinkd:#C1004F;--green:#1F6B47;--line:rgba(18,22,26,.13);--line-s:rgba(18,22,26,.22);--r:4px;--r6:6px}
  *{box-sizing:border-box}
  body{margin:0;background:var(--paper);color:var(--text);font-family:'Public Sans',system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;line-height:1.5;padding:32px 16px}
  .card{max-width:560px;margin:0 auto;background:var(--white);border:1px solid var(--line);border-radius:var(--r6);padding:28px;box-shadow:0 3px 0 rgba(18,22,26,.09);position:relative;overflow:hidden}
  .card::before{content:"";position:absolute;inset:0 0 auto 0;height:3px;background:var(--pink)}
  .eyebrow{font:600 10.5px/1.2 ui-monospace,Menlo,monospace;letter-spacing:.16em;text-transform:uppercase;color:var(--pinkd);margin:0 0 10px}
  h1{font-size:1.5rem;letter-spacing:-.025em;margin:0 0 8px;line-height:1.15}
  p{margin:0 0 18px;color:var(--muted);font-size:.95rem}
  label{display:block;font-weight:600;font-size:.86rem;margin:14px 0 6px}
  input,select{width:100%;font:inherit;padding:10px 12px;border:1px solid var(--line-s);border-radius:var(--r);background:var(--white)}
  .row{display:grid;grid-template-columns:1fr 1fr;gap:14px}
  button{margin-top:22px;font:600 .95rem/1 inherit;color:var(--white);background:var(--green);border:0;border-radius:var(--r);padding:13px 18px;cursor:pointer}
  .err{background:#FDE8F0;color:var(--pinkd);border-radius:var(--r);padding:10px 12px;font-size:.88rem;margin-bottom:14px}
</style></head><body>
<form class="card" method="post" action="/api/packet/address">
  <p class="eyebrow">Job Packet</p>
  <h1>Where is the job?</h1>
  <p>The address prints on the provider pages so whoever comes can plan the visit.</p>
  ${error ? `<div class="err">${escapeHtml(error)}</div>` : ""}
  <input type="hidden" name="request_id" value="${escapeAttr(requestId)}">
  ${keep ? `<input type="hidden" name="k" value="${escapeAttr(keep)}">` : ""}
  <input type="hidden" name="return_to" value="${escapeAttr(back)}">
  <label for="street">Street address</label>
  <input id="street" name="street" required autocomplete="street-address" maxlength="120">
  <label for="city_state_zip">City, state and ZIP</label>
  <input id="city_state_zip" name="city_state_zip" required placeholder="Fort Wayne, IN 46815" maxlength="120">
  <div class="row">
    <div><label for="property_type">Property type</label><select id="property_type" name="property_type"><option value="">Choose one</option>${options}</select></div>
    <div><label for="storeys">Storeys</label><select id="storeys" name="storeys"><option value="">Skip this</option>${storeys}</select></div>
  </div>
  <button type="submit">Build my Job Packet</button>
</form>
</body></html>`;
}

function toolbar(requestId: string, share: string | null, keep: string | undefined, held: boolean): string {
  const q = share ? `?share=${encodeURIComponent(share)}` : keep ? `?k=${encodeURIComponent(keep)}` : "";
  const pdf = `/packet/${encodeURIComponent(requestId)}/pdf${q}`;
  const note = held ? `<span>Held for review: this packet did not pass its own checks.</span>` : "";
  return `<div class="toolbar no-print">${note}<a class="primary" href="${escapeAttr(pdf)}">Download PDF</a><button type="button" onclick="window.print()">Print</button></div>`;
}

export async function GET(request: Request, ctx: { params: Promise<{ request_id: string }> }): Promise<Response> {
  const { request_id } = await ctx.params;
  const url = new URL(request.url);
  const share = url.searchParams.get("share");
  const keep = url.searchParams.get("k") || undefined;
  const access = await resolvePacketAccess(request_id, share, keep);
  if (!access.ok) return notFound();

  let loaded: Awaited<ReturnType<typeof loadPacket>>;
  try {
    loaded = await loadPacket(request_id, { link_base: demoAwareOrigin(request), owner: access.owner });
  } catch {
    loaded = null;
  }
  if (!loaded) return notFound();
  if (loaded.safety_halt) return Response.redirect(new URL(`/safety/${encodeURIComponent(loaded.safety_halt)}`, url.origin), 303);
  if (!loaded.input) {
    if (!access.owner) return html("<!doctype html><html lang=\"en\"><body><p>The homeowner is still preparing this packet.</p></body></html>");
    return html(addressForm(request_id, keep, url.searchParams.get("error") === "address" ? "Both address lines are needed." : null));
  }

  let rendered: ReturnType<typeof renderPacketHtml>;
  try {
    rendered = renderPacketHtml(loaded.input, {
      print_on_load: url.searchParams.get("print") === "1",
      toolbar_html: "",
    });
  } catch (err) {
    if (err instanceof PacketHaltError) return html("<!doctype html><html lang=\"en\"><body><p>This packet is being checked. The saved record is unchanged.</p></body></html>");
    throw err;
  }
  if (!rendered.self_check.ok) {
    // Never publish refused copy or its private source values in HTML/logs.
    const back = `/results/${encodeURIComponent(request_id)}${keep ? `?k=${encodeURIComponent(keep)}` : ""}`;
    return html(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex,nofollow"></head><body style="font-family:system-ui;max-width:40rem;margin:3rem auto;padding:1rem"><h1>Your packet needs a quick check.</h1><p>Your description is saved. Some details cannot be included in a shareable packet.</p>${access.owner ? `<a href="${escapeAttr(back)}">Return to your saved results</a>` : "<p>The homeowner can review the saved record.</p>"}</body></html>`, 200, { "x-packet-self-check": "held" });
  }
  // The toolbar is injected after the render so the self-check never sees it.
  const body = rendered.html.replace("<body>", `<body>${toolbar(request_id, share, keep, false)}`);

  await recordCustomerEvent({
    event_name: "packet.viewed",
    guest_session_id: loaded.journey.session.guest_session_id,
    context: {
      request_id,
      problem_id: loaded.journey.problem.problem_id,
      job_packet_id: loaded.journey.packet.job_packet_id,
      packet_version: String(loaded.journey.packet.packet_version),
      source: access.via === "share_link" ? "share_link" : "packet_view",
    },
    landing_path: `/packet/${request_id}`,
  });

  return html(body, 200, {
    "x-packet-self-check": rendered.self_check.ok ? "ok" : "failed",
    "x-packet-halted": rendered.halted ? "1" : "0",
  });
}
