import type { Metadata } from "next";
import { LinkOff } from "@/components/links/LinkOff";

/**
 * /link-off — the switched-off screen as a URL (track P3), for the route
 * handlers (/p/<token>) that cannot render a page of their own. The link
 * pages render the same component inline.
 */
export const metadata: Metadata = {
  title: "This link has been switched off",
  robots: { index: false, follow: false },
};

export default async function LinkOffPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const reason = query.reason === "unavailable" ? "unavailable" : query.reason === "expired" ? "expired" : query.reason === "used" ? "used" : "off";
  return <LinkOff reason={reason} />;
}
