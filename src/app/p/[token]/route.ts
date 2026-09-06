import { verifyLinkForRoute as verifyLink } from "@/platform/links/tokens";

/**
 * /p/<token> — THE PACKET SHARE LINK (track P3).
 *
 * Scope "packet". Verifies, then hands the viewer to the packet page with
 * the share token attached (P1's /packet/<request_id> accepts ?share=). A
 * packet share link cannot open Home Memory, an account or any unrelated
 * record (§16.2 BINDING, pinned in tests): the only thing it can become is
 * this one redirect to this one request's packet.
 *
 * A link that will not open goes to the plain switched-off screen
 * (/link-off), which is a page so it renders inside the app shell; a route
 * handler cannot render one itself.
 */
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
): Promise<Response> {
  const { token } = await params;
  const link = await verifyLink(token, "packet");
  const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };
  if (!link.ok) {
    const reason = link.reason === "expired" || link.reason === "unavailable" ? link.reason : "off";
    return new Response(null, { status: 303, headers: { ...headers, Location: `/link-off?reason=${reason}` } });
  }
  return new Response(null, {
    status: 303,
    headers: {
      ...headers,
      Location: `/packet/${encodeURIComponent(link.request_id)}?share=${encodeURIComponent(token)}`,
    },
  });
}
