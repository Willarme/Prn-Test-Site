import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LinkOff, linkOffReason } from "@/components/links/LinkOff";
import { consumeKeepLink } from "@/platform/links/ledger";
import { verifyLinkForRoute as verifyLink } from "@/platform/links/tokens";

/**
 * /claim/<magic> — THE MAGIC LINK, CONSUMED (track P3).
 *
 * Signed token, scope "magic", carrying only a random magic_id (never the
 * contact). The store's consumeMagicLink is the single-use gate: the first
 * visit stamps consumed_at and returns the row; every later visit gets null
 * and the "already used" screen (WORDING: a fact about the world, stated
 * flat). On success the claim is marked confirmed and the homeowner lands
 * back on their exact results state (§15 BINDING: "return the homeowner to
 * the exact results state").
 *
 * A page, so it renders inside the app shell. Next's redirect() from a
 * server component answers 307, which a browser follows as a GET exactly as
 * it would a 303; the campaign brief's "303" is met in effect, and the test
 * pins the Location.
 *
 * Known property of every magic link, not a bug of this one: a mail scanner
 * that pre-fetches URLs would consume it. Preview mode never sends, so the
 * demo cannot hit that; live mode inherits it and the launch list notes it.
 */
export const metadata: Metadata = {
  referrer: "no-referrer",
  title: "Keep this",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function ClaimPage({ params }: { params: Promise<{ magic: string }> }) {
  const { magic } = await params;
  const link = await verifyLink(magic, "magic");
  if (!link.ok) return <LinkOff reason={linkOffReason(link.reason)} />;

  const magicId = link.extra.magic_id;
  if (!magicId) return <LinkOff reason="off" />;

  const now = new Date().toISOString();
  let owner;
  try { owner = await consumeKeepLink(link.request_id, magicId, now); }
  catch { return <LinkOff reason="unavailable" />; }
  if (!owner) return <LinkOff reason="used" resultsHref={`/results/${link.request_id}`} />;
  redirect(`/results/${link.request_id}?kept=1&k=${encodeURIComponent(owner.token)}`);
}
