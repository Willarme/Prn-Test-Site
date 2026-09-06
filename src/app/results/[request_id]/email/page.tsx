import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { FeedbackPopup } from "@/components/results/FeedbackPopup";
import { ResultsShell } from "@/components/results/ResultsShell";
import { flagEnabled } from "@/platform/flags";
import { ownerAllowed } from "@/platform/links/owner";
import { runtimeStore } from "@/platform/stores/runtime";
import { journeySafetyRule } from "@/domain/problem/journey-safety";
import { feedbackEligible } from "@/platform/feedback/eligible";

export const metadata: Metadata = {
  referrer: "no-referrer",
  title: "Email your Job Packet",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * GET /results/[request_id]/email — "Email it to me instead" (track P2).
 *
 * One required field (PRN Master Build Spec MERGED §16.1: "Email required to
 * email"), one optional name, and "Skip for now", which submits with the name
 * left blank. The form posts to /api/results/email, which stores the message
 * and lands the homeowner on /mail/<id>.
 *
 * Both this page and the submission read the current safety state, so an old
 * direct link cannot resume ordinary packet delivery after a reported hazard.
 *
 * New homeowner-visible strings (WORDING: fact, second person, no negation,
 * no praise) — all listed in the P2 report:
 *   "Email your Job Packet to yourself"
 *   "Two links arrive in one message: your packet, and the PDF."
 *   "Your email" · "Your name" · "Optional. It goes at the top of the message."
 *   "Send my Job Packet" · "Skip for now" · "Back to your results"
 *   errors: "Enter the email your packet should go to." /
 *           "Start from your results page to email this packet." /
 *           "Send it again."
 *
 * The form's legacy action marker does not arm feedback. Only a durable live
 * sent receipt on /mail can do that; failures and previews do not qualify.
 */
const ERRORS: Record<string, string> = {
  email: "Enter the email your packet should go to.",
  unavailable: "Start from your results page to email this packet.",
  try_again: "Send it again.",
};

export default async function EmailPacketPage({
  params,
  searchParams,
}: {
  params: Promise<{ request_id: string }>;
  searchParams: Promise<{ error?: string; k?: string }>;
}) {
  if (!flagEnabled("results_shell_enabled")) notFound();
  const { request_id } = await params;
  const { error, k } = await searchParams;
  if (!(await ownerAllowed(request_id, k))) notFound();
  const journey = await runtimeStore().getJourney(request_id);
  if (!journey) notFound();
  const safety = journeySafetyRule(journey.problem);
  if (safety && !safety.intake_may_continue) redirect(`/safety/${encodeURIComponent(safety.safety_rule_id)}`);
  const message = error ? (ERRORS[error] ?? null) : null;
  const resultsHref = `/results/${encodeURIComponent(request_id)}${k ? `?k=${encodeURIComponent(k)}` : ""}`;

  return (
    <ResultsShell>
      <p className="cta-eyebrow">Your Job Packet</p>
      <h1 className="sub-h">Email your Job Packet to yourself</h1>
      <p className="sub-p">Two links arrive in one message: your packet, and the PDF.</p>

      {message && (
        <p className="alert" role="alert">
          {message}
        </p>
      )}

      <form
        className="form"
        method="post"
        action="/api/results/email"
        data-feedback-trigger="email_submitted"
      >
        <input type="hidden" name="request_id" value={request_id} />
        {k && <input type="hidden" name="k" value={k} />}
        <div className="field">
          <label htmlFor="email">Your email</label>
          <input id="email" name="email" type="email" inputMode="email" autoComplete="email" required maxLength={320} />
        </div>
        <div className="field">
          <label htmlFor="name">Your name</label>
          <input id="name" name="name" type="text" autoComplete="name" maxLength={120} />
          <span className="hint">Optional. It goes at the top of the message.</span>
        </div>
        <div className="actions">
          <button type="submit" className="btn primary">
            Send my Job Packet
          </button>
          <button type="submit" className="btn quiet" name="skip" value="1">
            Skip for now
          </button>
        </div>
      </form>

      <a className="back" href={resultsHref}>
        Back to your results
      </a>
      <FeedbackPopup requestId={request_id} ownerKey={k} eligible={await feedbackEligible(request_id)} />
    </ResultsShell>
  );
}
