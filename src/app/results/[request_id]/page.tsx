import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { journeySafetyRule } from "@/domain/problem/journey-safety";
import type { Metadata } from "next";
import { ResultsTemplate } from "@/components/results/ResultsTemplate";
import { FeedbackSuccess } from "@/components/results/FeedbackSuccess";
import { feedbackEligible } from "@/platform/feedback/eligible";
import { JOURNEY_COOKIE_NAME, decodeJourneyCookie } from "@/domain/problem/journey-cookie";
import { recordCustomerEvent } from "@/platform/events/customer";
import { flagEnabled } from "@/platform/flags";
import { issueLink, readKeepState } from "@/platform/links/ledger";
import { ownerAllowed } from "@/platform/links/owner";
import { runtimeStore } from "@/platform/stores/runtime";
import type { AskAnswer } from "@/platform/stores/interfaces";

export const metadata: Metadata = {
  referrer: "no-referrer",
  title: "Your Job Packet is ready",
  robots: { index: false, follow: false }, // customer results are always private
};

export const dynamic = "force-dynamic";

/**
 * GET /results/[request_id] — the approved results page (MOCKUP-2), rebuilt
 * with every button live (campaign track P2, 2026-09-05).
 *
 * WHAT CHANGED FROM THE SHELL THIS REPLACES. The old page printed the packet
 * inline — the homeowner's summary, the details, the diagnosis, the call
 * script — under a hero that said "Request rq_…" and "Packet jp_… · v2 ·
 * engine". PRN Master Build Spec MERGED §6.4 (BINDING) rules the results page
 * a TEMPLATE with no per-request values, and Melissa's checklist D1 fails any
 * number or phrase that differs between a rich request and a thin one. The
 * packet itself now lives at /packet/[request_id] (track P1, the Directions
 * contract), which "Open my Job Packet" opens. This page reads the store for
 * exactly three things: that the request exists (or it is a 404), the friend's
 * Trust Network answers (rendered only when there are any), and the ids its
 * `packet.viewed` envelope carries.
 *
 * THE SAFETY BANNER the old page printed for a continue-class safety rule is
 * not on the approved page. A halt-class rule never reaches here at all
 * (startIntake sends the homeowner to /safety/[rule_id] and creates no
 * packet); a continue-class rule's approved copy prints on packet page 1,
 * where the Directions put the safety block. Noted in the P2 report.
 *
 * THE LINKS. /keep and /ask carry signed, scoped, revocable tokens (§16.2;
 * src/platform/links/tokens.ts) minted at render — a fresh link id per view,
 * each one revocable on its own, none of them carrying anything the homeowner
 * typed. /packet, /results/[id]/email, /results/[id]/send and
 * /results/[id]/find take the request id in the path: they are the
 * homeowner's own pages, reached from a page they already hold.
 *
 * ?kept=1 returns to the same frozen results template. A separate accessible
 * receipt appears only when the current claim matches the confirmed ledger;
 * a URL parameter alone can never claim that the record has been saved.
 *
 * Zero model calls, zero per-request assembly (§6.4).
 */
export default async function ResultsPage({
  params,
  searchParams,
}: {
  params: Promise<{ request_id: string }>;
  searchParams?: Promise<{ k?: string; kept?: string }>;
}) {
  if (!flagEnabled("results_shell_enabled")) notFound();
  const { request_id } = await params;
  const query = await searchParams;
  const k = query?.k;
  if (!(await ownerAllowed(request_id, k))) notFound();
  const store = runtimeStore();
  const journey = await store.getJourney(request_id);
  const safety = journey ? journeySafetyRule(journey.problem) : null;
  if (safety && !safety.intake_may_continue) redirect(`/safety/${encodeURIComponent(safety.safety_rule_id)}`);

  let exists = journey !== null;
  let fromCookie = false;
  let packetIds: { problem_id: string; job_packet_id: string; packet_version: string } | null =
    journey
      ? {
          problem_id: journey.problem.problem_id,
          job_packet_id: journey.packet.job_packet_id,
          packet_version: String(journey.packet.packet_version),
        }
      : null;

  // Fallback ONLY when there is no database configured (a keyless preview
  // deploy whose /tmp file store is per-instance): the journey rides in the
  // tester's own httpOnly cookie. See domain/problem/journey-cookie.ts for the
  // exact bounds of that exposure. It proves the request exists; nothing from
  // it renders, because nothing per-request renders here at all.
  if (!exists && store.kind === "file") {
    const payload = decodeJourneyCookie(
      (await cookies()).get(JOURNEY_COOKIE_NAME)?.value,
      request_id
    );
    if (payload) {
      exists = true;
      fromCookie = true;
      packetIds = {
        problem_id: payload.packet.problem_id,
        job_packet_id: payload.packet.job_packet_id,
        packet_version: String(payload.packet.packet_version),
      };
    }
  }

  if (!exists) notFound();

  let kept = false;
  if (query?.kept === "1") {
    try {
      const claim = await store.getKeepClaim(request_id);
      const confirmation = readKeepState(request_id);
      kept = !!(claim && confirmation?.confirmed_at && confirmation.magic_id === claim.magic_link_id);
    } catch {
      // An unavailable receipt cannot become a claim of a successful save.
    }
  }

  let askAnswers: AskAnswer[] = [];
  try {
    askAnswers = await store.listAskAnswers(request_id);
  } catch {
    // A missing answers read costs one optional block, never the page.
  }

  /**
   * packet.viewed — this page is `force-dynamic`, so a render IS a view, and a
   * server-rendered view is the only reading that does not depend on a browser
   * cooperating. Awaited but fail-soft by contract: recordCustomerEvent never
   * throws, so this cannot stop a homeowner seeing their results.
   */
  await recordCustomerEvent({
    event_name: "packet.viewed",
    guest_session_id: journey?.session.guest_session_id ?? null,
    context: {
      request_id,
      ...(packetIds ?? {}),
      source: fromCookie ? "browser_fallback" : "store",
    },
    landing_path: `/results/${request_id}`,
    ...(journey
      ? { versions: { schema: journey.packet.schema_version, engine: journey.packet.engine } }
      : {}),
  });

  const keepHref = `/keep/${issueLink({ scope: "keep", request_id }).token}`;
  const eligible = journey ? await feedbackEligible(request_id) : false;
  return <>
    {kept && eligible && <FeedbackSuccess requestId={request_id} />}
    {kept && <div role="status" className="wrap-narrow" style={{ padding: "18px 24px" }} data-keep-receipt>
      Saved to Home Memory. <a href={keepHref}>Open your saved record</a>
    </div>}
    <ResultsTemplate
      requestId={request_id}
      ownerKey={k}
      feedbackEligible={eligible}
      keepHref={keepHref}
      askHref={`/ask/${issueLink({ scope: "ask", request_id }).token}`}
      askAnswers={askAnswers}
    />
  </>;
}
