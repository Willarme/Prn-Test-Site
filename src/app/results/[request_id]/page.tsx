import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { FEATURE_CONCEPTS } from "@/domain/feature-lab/concepts";
import { SAFETY_RULES } from "@/domain/problem/safety";
import { flagEnabled } from "@/platform/flags";
import { readDevDb } from "@/platform/stores/dev-db";
import { AlreadyHaveSomeone, PacketActions } from "@/components/results/PacketActions";

export const metadata: Metadata = {
  title: "Your Job Packet is ready",
  robots: { index: false, follow: false }, // customer results are always private
};

export default async function ResultsPage({
  params,
}: {
  params: Promise<{ request_id: string }>;
}) {
  if (!flagEnabled("results_shell_enabled")) notFound();
  const { request_id } = await params;
  const db = readDevDb();
  const session = db.intake_sessions.find((s) => s.request_id === request_id);
  let problem = session
    ? db.problems.find((p) => p.intake_session_id === session.intake_session_id)
    : undefined;
  const problemId = problem?.problem_id;
  let packet = problemId ? db.packets.find((k) => k.problem_id === problemId) : null;
  let fromCookie = false;
  if (!packet) {
    // Staging stopgap (D-21): journey carried in the tester's own browser.
    const jar = await cookies();
    const raw = jar.get("prn_last_journey")?.value;
    if (raw) {
      try {
        const j = JSON.parse(Buffer.from(raw, "base64url").toString("utf-8")) as {
          request_id: string;
          problem: typeof problem;
          packet: NonNullable<typeof packet>;
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
  if ((!session && !fromCookie) || !problem || !packet) {
    // Staging preview uses ephemeral storage until Supabase is wired — be
    // honest instead of a bare 404 when a record didn't survive a cold start.
    if (process.env.VERCEL) {
      return (
        <main className="section">
          <div className="wrap-narrow">
            <div className="eyebrow">Preview environment</div>
            <h1 className="d2">This preview doesn&apos;t keep requests yet.</h1>
            <p className="lede" style={{ marginTop: 16 }}>
              The staging preview stores journeys in temporary memory only — this request has
              expired. The permanent database arrives with the Supabase wiring. Start a fresh
              journey from any door page to see the full flow.
            </p>
          </div>
        </main>
      );
    }
    notFound();
  }
  const safetyRule = SAFETY_RULES.find((r) => r.safety_rule_id === problem.safety_rule_id) ?? null;

  const copySummary = packet.call_script;

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
          <p className="mono" style={{ color: "var(--on-dark-faint)", marginTop: 12 }}>
            Packet {packet.job_packet_id} · v{packet.packet_version} · engine: {packet.engine}
            {fromCookie ? " · staging: shown from this browser only" : ""}
          </p>
        </div>
      </section>

      <section className="section section-light packet-print" style={{ paddingTop: 56 }}>
        <div className="wrap-narrow">
          <div className="card-light">
            <span className="pill pill-pink no-print">Job Packet</span>
            <PacketActions copyText={copySummary} />
            <div className="prose">
              <h2>The problem, in your words</h2>
              <p>{packet.summary_plain}</p>

              <h2>Likely service category</h2>
              <p>
                {packet.likely_service_category.value ?? "Not yet clear from the description"}{" "}
                <span className="pill pill-amber">
                  inference · {packet.likely_service_category.confidence} confidence
                </span>
              </p>
              <p className="hint">{packet.likely_service_category.note}</p>

              <h2>What remains unknown</h2>
              <ul>
                {packet.what_remains_unknown.map((u, i) => (
                  <li key={i}>{u}</li>
                ))}
              </ul>

              <h2>Useful preparation</h2>
              <ul>
                {packet.safe_prep_notes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>

              <h2>What a provider will likely ask — have these ready</h2>
              <ul>
                {packet.questions_for_provider.map((q, i) => (
                  <li key={i}>{q}</li>
                ))}
              </ul>

              <h2>Your 30-second call script</h2>
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
            <AlreadyHaveSomeone callScript={packet.call_script} />
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
