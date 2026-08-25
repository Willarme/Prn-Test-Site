import type { PageQAResult } from "@/domain/search/qa";

/**
 * A06's VERDICT, on the owner's screen — a SERVER component, admin-gated by the
 * pages it renders inside.
 *
 * NO NEW TOP-LEVEL PAGE. The build brief is explicit: QA results go on the
 * EXISTING admin Pages surfaces. An inspector with its own dashboard is an
 * inspector nobody opens; the verdict belongs where the owner is already looking
 * at the page.
 *
 * SERVER-ONLY, per A05's condition C16: no PageSpec internal and no QA internal
 * may reach a "use client" component, because that serializes it into the
 * browser payload. Everything here renders on the server, and the public-surface
 * scan (tests/a06.public-exposure.test.ts) proves none of it reaches an
 * unauthenticated route.
 *
 * IT SHOWS THE UNCOMFORTABLE PARTS. A queue that renders a green PASS over a
 * page nothing has read for meaning is the dishonesty this whole build exists to
 * remove, so `BLOCKED_PENDING_AI`, the skipped-critic status and the
 * NOT-MEASURABLE check list are all rendered as prominently as the verdict.
 */

function severityClass(severity: string): string {
  if (severity === "blocker") return "pill-pink";
  if (severity === "major") return "pill-amber";
  return "pill";
}

export function QaVerdictPanel({ qa, eligible, reasons }: {
  qa: PageQAResult;
  eligible: boolean;
  reasons: string[];
}) {
  const nonBlocking = qa.deterministic.findings.filter((f) => f.severity !== "blocker");
  return (
    <div className="cell" style={{ marginBottom: 18 }}>
      <span className="tag">A06 Page Quality &amp; Release · rule set {qa.rule_set_version}</span>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "10px 0 14px" }}>
        <span
          className={`pill ${qa.overall === "PASS" ? "pill-green" : qa.overall === "FAIL" ? "pill-pink" : "pill-amber"}`}
        >
          {qa.overall}
        </span>
        <span className={`pill ${eligible ? "pill-green" : "pill-pink"}`}>
          {eligible ? "READY FOR YOUR DECISION" : "NOT RELEASABLE"}
        </span>
        <span className="pill">deterministic {qa.deterministic.state}</span>
        <span className={`pill ${qa.ai_critic.status === "PASS" ? "pill-green" : "pill-amber"}`}>
          AI critic {qa.ai_critic.status}
        </span>
      </div>

      {/* WHY, always — on an eligible page as well as a blocked one. */}
      <ul style={{ paddingLeft: 18, color: "var(--on-dark-mute)", margin: "0 0 14px" }}>
        {reasons.map((reason, i) => (
          <li key={i}>{reason}</li>
        ))}
      </ul>

      {qa.ai_critic.status !== "PASS" && (
        <p className="hint" style={{ color: "var(--on-dark-mute)", marginBottom: 14 }}>
          <strong>Nothing has read this page for meaning.</strong> {qa.ai_critic.reason}
        </p>
      )}

      {qa.blockers.length > 0 && (
        <>
          <span className="tag">Blockers — these stop release, and there is no override</span>
          <ul style={{ paddingLeft: 18, marginTop: 6, marginBottom: 14 }}>
            {qa.blockers.map((f, i) => (
              <li key={i}>
                <span className={`pill ${severityClass(f.severity)}`}>{f.severity}</span>{" "}
                <span className="mono">{f.check}</span> @ {f.where} — {f.message}
                {f.repair_instructions && (
                  <div style={{ color: "var(--on-dark-mute)" }}>Fix: {f.repair_instructions}</div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      {nonBlocking.length > 0 && (
        <>
          <span className="tag">Noted, not blocking — for your judgment</span>
          <ul style={{ paddingLeft: 18, marginTop: 6, marginBottom: 14, color: "var(--on-dark-mute)" }}>
            {nonBlocking.map((f, i) => (
              <li key={i}>
                <span className={`pill ${severityClass(f.severity)}`}>{f.severity}</span>{" "}
                <span className="mono">{f.check}</span> @ {f.where} — {f.message}
              </li>
            ))}
          </ul>
        </>
      )}

      {/* THE HONEST GAP. A skipped check is not a passing check. */}
      {qa.deterministic.checks_skipped.length > 0 && (
        <>
          <span className="tag">
            Not measurable here — {qa.deterministic.checks_skipped.length} check(s) NOT run, and
            therefore NOT passed
          </span>
          <ul style={{ paddingLeft: 18, marginTop: 6, color: "var(--on-dark-mute)", fontSize: ".85rem" }}>
            {qa.deterministic.checks_skipped.map((s) => (
              <li key={s.check}>
                <span className="mono">{s.check}</span> — {s.why}
              </li>
            ))}
          </ul>
        </>
      )}

      {qa.deterministic.unknown_required_checks.length > 0 && (
        <p className="hint" style={{ color: "var(--pink)", marginTop: 12 }}>
          Policy requires {qa.deterministic.unknown_required_checks.join(", ")}, which A06 does not
          implement. Those checks did NOT run.
        </p>
      )}

      <p className="hint" style={{ color: "var(--on-dark-mute)", marginTop: 12 }}>
        {qa.deterministic.checks_run.length} checks run · value score{" "}
        {qa.user_value_score ?? "—"} (deterministic heuristic {qa.heuristic_score ?? "—"}, not a
        critic judgment)
      </p>
    </div>
  );
}
