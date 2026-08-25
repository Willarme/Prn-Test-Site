import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { FEATURE_CONCEPTS } from "@/domain/feature-lab/concepts";
import type { JobPacket, ProblemRecord } from "@/domain/problem/contracts";
import { ACTIVE_PACKET_COPY, fillCopy } from "@/domain/problem/packet-copy";
import { SAFETY_RULES } from "@/domain/problem/safety";
import { recordCustomerEvent } from "@/platform/events/customer";
import { flagEnabled } from "@/platform/flags";
import { runtimeStore } from "@/platform/stores/runtime";
import { AlreadyHaveSomeone, PacketActions } from "@/components/results/PacketActions";

export const metadata: Metadata = {
  title: "Your Job Packet is ready",
  robots: { index: false, follow: false }, // customer results are always private
};

export const dynamic = "force-dynamic";

export default async function ResultsPage({
  params,
}: {
  params: Promise<{ request_id: string }>;
}) {
  if (!flagEnabled("results_shell_enabled")) notFound();
  const { request_id } = await params;
  const store = runtimeStore();
  const journey = await store.getJourney(request_id);

  let problem: ProblemRecord | undefined = journey?.problem;
  let packet: JobPacket | undefined = journey?.packet;
  let fromCookie = false;

  // Fallback ONLY when there is no database configured (local dev / a preview
  // deploy without credentials): the journey rides in the tester own browser
  // cookie so the flow can still be walked end to end. Never used once the
  // database is wired.
  if (!packet && store.kind === "file") {
    const raw = (await cookies()).get("prn_last_journey")?.value;
    if (raw) {
      try {
        const j = JSON.parse(Buffer.from(raw, "base64url").toString("utf-8")) as {
          request_id: string;
          problem: ProblemRecord;
          packet: JobPacket;
        };
        if (j.request_id === request_id) {
          problem = j.problem;
          packet = j.packet;
          fromCookie = true;
        }
      } catch {
        /* ignore malformed cookie */
      }
    }
  }

  if (!problem || !packet) notFound();

  const safetyRule = SAFETY_RULES.find((r) => r.safety_rule_id === problem.safety_rule_id) ?? null;
  const copySummary = packet.call_script;
  /**
   * PACKET COPY FROM CONFIG (Loop Spec Audit A02 condition 8). Every heading and
   * label inside the packet card below moved VERBATIM to
   * domain/problem/packet-copy.ts — same words, sourced from a package a
   * white-label deployment can swap. The page copy AROUND the packet (the hero,
   * the three-paths section, the Feature Lab) is deliberately NOT moved: it is
   * not packet copy, and the Trust wording in particular is owned elsewhere
   * (#15 / OD-11).
   */
  const S = ACTIVE_PACKET_COPY.sections;

  /**
   * packet.viewed — REGISTERED SINCE #14A §18.2, EMITTED BY NOTHING UNTIL NOW
   * (Trial Spec Audit §4: grepping for a producer outside the dictionary files
   * returned zero). This page is `force-dynamic`, so a render IS a view, and a
   * server-rendered view is the only reading that does not depend on a browser
   * cooperating.
   *
   * TIME-CRITICAL, WHICH IS WHY IT SHIPS WITH A02 RATHER THAN WITH A07: events
   * are append-only history. A packet view during the trial that nobody
   * recorded is gone permanently, and A07's first KpiSnapshot would then have
   * no baseline to compare against.
   *
   * Awaited but fail-soft by contract — recordCustomerEvent never throws, so
   * this cannot stop a homeowner seeing their packet.
   */
  await recordCustomerEvent({
    event_name: "packet.viewed",
    guest_session_id: journey?.session.guest_session_id ?? null,
    context: {
      request_id,
      problem_id: packet.problem_id,
      job_packet_id: packet.job_packet_id,
      packet_version: String(packet.packet_version),
      source: fromCookie ? "browser_fallback" : "store",
    },
    landing_path: `/results/${request_id}`,
    versions: { schema: packet.schema_version, engine: packet.engine },
  });

  return (
    <main>
      {safetyRule && (
        // Prints deliberately: safety guidance belongs on the paper copy too.
        <div style={{ background: "var(--amber)", color: "#1a1408", padding: "14px 0" }}>
          <div className="wrap">
            <strong>Safety first:</strong> {safetyRule.approved_response}
          </div>
        </div>
      )}
      <section className="section" style={{ paddingBottom: 48 }}>
        <div className="wrap-narrow">
          <div className="eyebrow">Request {request_id}</div>
          <h1 className="d2">
            Your Job Packet is <em>ready</em>.
          </h1>
          <p className="lede" style={{ margin: "16px 0 6px" }}>
            Give a provider the whole problem once. Your packet organizes the symptoms,
            context and useful answers before the conversation starts — that can mean less
            provider time spent gathering information, and potentially less of your money
            spent on that time where it&apos;s billable.
          </p>
          <p style={{ marginTop: 14 }} className="no-print">
            <Link href={`/complete/${request_id}`} className="btn btn-ghost btn-sm">
              ← Add details or walk through it (strengthens the packet)
            </Link>
          </p>
          <p className="mono" style={{ color: "var(--on-dark-faint)", marginTop: 12 }}>
            Packet {packet.job_packet_id} · v{packet.packet_version} · engine: {packet.engine}
            {fromCookie ? " · preview: shown from this browser only" : ""}
          </p>
        </div>
      </section>

      <section className="section section-light packet-print" style={{ paddingTop: 56 }}>
        <div className="wrap-narrow">
          <div className="card-light">
            <span className="pill pill-pink no-print">{S.packet_label}</span>
            <PacketActions copyText={copySummary} requestId={request_id} />
            <div className="prose">
              <h2>{S.problem_in_your_words}</h2>
              <p>{packet.summary_plain}</p>

              {(packet.collected_details.length > 0 || packet.media_count > 0) && (
                <>
                  <h2>{S.details_supplied}</h2>
                  <ul>
                    {packet.collected_details.map((d, i) => (
                      <li key={i}>
                        <strong>{d.label}:</strong> {d.value}
                      </li>
                    ))}
                    {packet.media_count > 0 && (
                      <li>
                        <strong>{S.media_attached_label}</strong> {packet.media_count}{" "}
                        {S.media_attached_note}
                      </li>
                    )}
                  </ul>
                </>
              )}

              {packet.diagnosis && (
                <>
                  <h2>{S.guided_walkthrough_findings}</h2>
                  <p>
                    <strong>{packet.diagnosis.outcome_title}</strong> — {packet.diagnosis.likely_cause}
                  </p>
                  <ul>
                    {packet.diagnosis.steps_answered.map((s, i) => (
                      <li key={i}>
                        {s.step}: <em>{s.answer}</em>
                      </li>
                    ))}
                  </ul>
                  <p className="hint">{S.provider_note_prefix} {packet.diagnosis.provider_note}</p>
                </>
              )}

              <h2>{S.likely_service_category}</h2>
              <p>
                {packet.likely_service_category.value ?? S.service_category_unknown}{" "}
                <span className="pill pill-amber">
                  {fillCopy(S.inference_badge_template, {
                    confidence: packet.likely_service_category.confidence,
                  })}
                </span>
              </p>
              <p className="hint">{packet.likely_service_category.note}</p>

              <h2>{S.what_remains_unknown}</h2>
              <ul>
                {packet.what_remains_unknown.map((u, i) => (
                  <li key={i}>{u}</li>
                ))}
              </ul>

              <h2>{S.useful_preparation}</h2>
              <ul>
                {packet.safe_prep_notes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>

              <h2>{S.questions_for_provider}</h2>
              <ul>
                {packet.questions_for_provider.map((q, i) => (
                  <li key={i}>{q}</li>
                ))}
              </ul>

              <h2>{S.call_script}</h2>
              <p style={{ fontStyle: "italic" }}>&ldquo;{packet.call_script}&rdquo;</p>
            </div>
          </div>

          <p style={{ margin: "26px 0 10px", maxWidth: "62ch" }}>
            <strong>Compare the same problem, not three interpretations of it.</strong> Sending
            this same packet to each provider gives every quote a consistent starting point —
            and helps whoever comes arrive better prepared.
          </p>
        </div>
      </section>

      <section className="section section-lighter no-print">
        <div className="wrap">
          <div className="eyebrow">What happens next</div>
          <h2 className="d2" style={{ marginBottom: 26 }}>
            Three ways forward. Your call.
          </h2>
          <div className="grid3">
            <AlreadyHaveSomeone callScript={packet.call_script} requestId={request_id} />
            {/* Descriptive-neutral copy only: #15 owns Trust wording (OD-11). */}
            <div className="cell">
              <span className="tag">Path 2 · In build</span>
              <h3 className="d3">Ask My People</h3>
              <p style={{ margin: "8px 0 14px" }}>
                Send a small ask to someone you trust — they can answer in seconds, with no
                signup on their side.
              </p>
              <span className="pill pill-amber">Arriving in this trial — being wired now</span>
            </div>
            <div className="cell">
              <span className="tag">Path 3 · In build</span>
              <h3 className="d3">Find someone for me</h3>
              <p style={{ margin: "8px 0 14px" }}>
                One suggested provider, with the specific reasons behind the suggestion.
              </p>
              <span className="pill pill-amber">Arriving in this trial — being wired now</span>
            </div>
          </div>
        </div>
      </section>

      <section className="section no-print">
        <div className="wrap">
          <div className="eyebrow">We&apos;re building what homeowners actually want next</div>
          <h2 className="d3" style={{ marginBottom: 22 }}>
            A look at what&apos;s coming — tell us what&apos;s worth building first.
          </h2>
          <div className="grid2">
            {FEATURE_CONCEPTS.map((c) => (
              <div className="cell" key={c.slug}>
                <span className="tag">{c.name}</span>
                <h3 className="d3">{c.card_hook}</h3>
                <p style={{ margin: "8px 0 14px" }}>{c.card_line}</p>
                <Link className="btn btn-ghost btn-sm" href={`/future/${c.slug}`}>
                  See what we&apos;re thinking →
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
