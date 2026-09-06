import Link from "next/link";

/**
 * THE PLAIN "THIS LINK HAS BEEN SWITCHED OFF" SCREEN (track P3).
 *
 * One component for every scoped link that will not open: revoked, forged,
 * malformed, wrong scope (all four say the same thing, because to the person
 * holding it there is nothing different to say), expired, and a magic link
 * that was already used. The strings are homeowner-facing and listed in the
 * track report for Melissa's review.
 */
export type LinkOffReason = "off" | "expired" | "used" | "unavailable";

export function linkOffReason(reason: "malformed" | "bad_signature" | "expired" | "revoked" | "unavailable"): LinkOffReason {
  return reason === "expired" || reason === "unavailable" ? reason : "off";
}

export function LinkOff({ reason, resultsHref }: { reason: LinkOffReason; resultsHref?: string }) {
  const heading =
    reason === "unavailable" ? "This link is temporarily unavailable." : reason === "expired"
      ? "This link has expired."
      : reason === "used"
        ? "This link was already used."
        : "This link has been switched off.";
  return (
    <main className="section section-light">
      <div className="wrap-narrow">
        <p className="eyebrow">Link</p>
        <h1 className="d2">{heading}</h1>
        {reason === "used" ? (
          <>
            <p className="lede">The record it opened is kept. Your results page has everything.</p>
            {resultsHref && (
              <p>
                <Link className="btn btn-pink" href={resultsHref}>
                  Open my results
                </Link>
              </p>
            )}
          </>
        ) : (
          <p className="lede">{reason === "unavailable" ? "Try this link again in a moment." : "The person who shared it can send a new one."}</p>
        )}
      </div>
    </main>
  );
}
