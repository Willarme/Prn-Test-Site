import { PacketHaltError, renderPacketHtml } from "@/domain/packet/render";
import { renderPacketPdf } from "@/domain/packet/pdf";
import { recordCustomerEvent } from "@/platform/events/customer";
import { loadPacket, resolvePacketAccess } from "@/platform/packet/load";
import { demoAwareOrigin } from "@/platform/demo-origin";

/**
 * GET /packet/[request_id]/pdf — the same packet as a real PDF (campaign
 * track P1, 2026-09-05). `application/pdf`, shown inline, named
 * "Job Packet <id>.pdf". When Chrome or puppeteer-core is not on this
 * machine the route sends the homeowner to the HTML view with `?print=1`,
 * which opens the print dialog: a document either way, never a dead end.
 *
 * `packet.downloaded` is recorded here with `surface: "pdf"` — a real PDF
 * render "emits the same name from the same moment" (api/packet-activity).
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function redirect(request: Request, path: string): Response {
  return Response.redirect(new URL(path, new URL(request.url).origin), 303);
}

export async function GET(request: Request, ctx: { params: Promise<{ request_id: string }> }): Promise<Response> {
  const { request_id } = await ctx.params;
  const url = new URL(request.url);
  const share = url.searchParams.get("share");
  const keep = url.searchParams.get("k") || undefined;
  const q = share ? `?share=${encodeURIComponent(share)}` : keep ? `?k=${encodeURIComponent(keep)}` : "";
  const htmlView = `/packet/${encodeURIComponent(request_id)}${q}`;

  const access = await resolvePacketAccess(request_id, share, keep);
  if (!access.ok) return new Response("not found", { status: 404 });

  let loaded: Awaited<ReturnType<typeof loadPacket>>;
  try {
    loaded = await loadPacket(request_id, { link_base: demoAwareOrigin(request), owner: access.owner });
  } catch {
    loaded = null;
  }
  if (!loaded) return new Response("not found", { status: 404 });
  if (loaded.safety_halt) return redirect(request, `/safety/${encodeURIComponent(loaded.safety_halt)}`);
  if (!loaded.input) return redirect(request, htmlView);

  let rendered: ReturnType<typeof renderPacketHtml>;
  try {
    rendered = renderPacketHtml(loaded.input);
  } catch (err) {
    if (err instanceof PacketHaltError) return redirect(request, htmlView);
    throw err;
  }
  if (!rendered.self_check.ok) {
    return redirect(request, htmlView);
  }

  const pdf = await renderPacketPdf(rendered.html);
  if (!pdf) return redirect(request, `${htmlView}${q ? "&" : "?"}print=1`);

  await recordCustomerEvent({
    event_name: "packet.downloaded",
    guest_session_id: loaded.journey.session.guest_session_id,
    context: {
      request_id,
      problem_id: loaded.journey.problem.problem_id,
      job_packet_id: loaded.journey.packet.job_packet_id,
      packet_version: String(loaded.journey.packet.packet_version),
      surface: "pdf",
    },
    landing_path: `/packet/${request_id}/pdf`,
  });

  const filename = `Job Packet ${loaded.input.packet.id}.pdf`;
  return new Response(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${filename}"`,
      "content-length": String(pdf.byteLength),
      "cache-control": "no-store",
      "x-packet-halted": rendered.halted ? "1" : "0",
    },
  });
}
