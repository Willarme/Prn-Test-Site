import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { FeedbackPopup } from "@/components/results/FeedbackPopup";
import { ResultsShell } from "@/components/results/ResultsShell";
import { SendForm } from "@/components/results/SendForm";
import { flagEnabled } from "@/platform/flags";
import { ownerAllowed } from "@/platform/links/owner";
import { runtimeStore } from "@/platform/stores/runtime";
import { journeySafetyRule } from "@/domain/problem/journey-safety";
import { makeShareLink } from "./actions";

export const metadata: Metadata = {
  referrer: "no-referrer",
  title: "Send your Job Packet",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * GET /results/[request_id]/send — "I already have someone" (track P2).
 *
 * The homeowner names the person (optionally), the server action mints one
 * signed packet link, and the share text comes back on screen with a copy
 * button and sms:/mailto: targets. The person is never stored: there is no
 * "your people" store surface in the trial yet (home_person.* is reserved in
 * the event registry and nothing writes it), so "Save them to your people"
 * on the results card resolves to sending, which is the part that works
 * today. Noted in the P2 report.
 *
 * New strings (listed in the report): "Send your Job Packet to the person you
 * already have" / "One link opens your packet for them. Add their number or
 * email and the message is ready to send." / "Back to your results".
 */
export default async function SendPacketPage({
  params,
  searchParams,
}: {
  params: Promise<{ request_id: string }>;
  searchParams?: Promise<{ k?: string }>;
}) {
  if (!flagEnabled("results_shell_enabled")) notFound();
  const { request_id } = await params;
  const k = (await searchParams)?.k;
  if (!(await ownerAllowed(request_id, k))) notFound();
  const journey = await runtimeStore().getJourney(request_id);
  if (!journey) notFound();
  const safety = journeySafetyRule(journey.problem);
  if (safety && !safety.intake_may_continue) redirect(`/safety/${encodeURIComponent(safety.safety_rule_id)}`);
  const resultsHref = `/results/${encodeURIComponent(request_id)}${k ? `?k=${encodeURIComponent(k)}` : ""}`;

  return (
    <ResultsShell>
      <p className="cta-eyebrow">Your Job Packet</p>
      <h1 className="sub-h">Send your Job Packet to the person you already have</h1>
      <p className="sub-p">
        One link opens your packet for them. Add their number or email and the message is ready
        to send.
      </p>
      <p className="fine" role="note">This demo prepares your message. A saved Your People address book is not available yet.</p>
      <SendForm requestId={request_id} ownerKey={k} action={makeShareLink} />
      <a className="back" href={resultsHref}>
        Back to your results
      </a>
      <FeedbackPopup requestId={request_id} ownerKey={k} />
    </ResultsShell>
  );
}
