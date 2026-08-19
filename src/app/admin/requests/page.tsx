import Link from "next/link";
import { readDevDb } from "@/platform/stores/dev-db";

export const dynamic = "force-dynamic";

export default function RequestsPage() {
  const db = readDevDb();
  const rows = [...db.intake_sessions].reverse();
  return (
    <div>
      <div className="eyebrow">Requests · this runtime store</div>
      <h1 className="d2">Requests</h1>
      <p className="lede" style={{ margin: "12px 0 24px" }}>
        Every intake journey in this environment: where it came from (door attribution), the
        consent version recorded, the safety state, and the packet. On staging this store resets on
        redeploy until the database is connected.
      </p>
      {rows.length === 0 ? (
        <div className="cell">No journeys yet in this store. Start one from any door page or /start.</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".9rem" }}>
            <thead>
              <tr className="mono" style={{ textAlign: "left", color: "var(--on-dark-mute)" }}>
                <th style={{ padding: "8px 10px" }}>When</th>
                <th style={{ padding: "8px 10px" }}>Came from</th>
                <th style={{ padding: "8px 10px" }}>Category (inferred)</th>
                <th style={{ padding: "8px 10px" }}>Safety</th>
                <th style={{ padding: "8px 10px" }}>Consent</th>
                <th style={{ padding: "8px 10px" }}>Packet</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => {
                const problem = db.problems.find((p) => p.intake_session_id === s.intake_session_id);
                const consent = db.consent_events.find((c) => s.consent_event_ids.includes(c.consent_event_id));
                return (
                  <tr key={s.intake_session_id} style={{ borderTop: "1px solid var(--line-d)" }}>
                    <td style={{ padding: "8px 10px" }}>{s.entered_at.replace("T", " ").replace("Z", " UTC")}</td>
                    <td style={{ padding: "8px 10px" }}>{s.attribution.page_id ? <span>door · {s.attribution.landing_path}</span> : "direct /start"}</td>
                    <td style={{ padding: "8px 10px" }}>{problem?.service_category ?? "—"} <span className="hint" style={{ color: "var(--on-dark-mute)" }}>{problem?.service_category_confidence}</span></td>
                    <td style={{ padding: "8px 10px" }}><span className={`pill ${problem?.safety_state === "normal" ? "" : "pill-amber"}`}>{problem?.safety_state ?? "—"}</span></td>
                    <td style={{ padding: "8px 10px", color: "var(--on-dark-mute)" }}>{consent?.disclosure_version_id ?? "—"}</td>
                    <td style={{ padding: "8px 10px" }}><Link href={`/results/${s.request_id}`} className="mono" style={{ color: "var(--pink)" }}>view</Link></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {db.admin_audit.length > 0 && (
        <div className="cell" style={{ marginTop: 26 }}>
          <span className="tag">Owner audit trail</span>
          <ul style={{ paddingLeft: 18, color: "var(--on-dark-mute)" }}>
            {[...db.admin_audit].reverse().slice(0, 30).map((a, i) => (
              <li key={i}>{a.at} · {a.action} · {a.target}{a.detail ? ` · ${a.detail}` : ""}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
