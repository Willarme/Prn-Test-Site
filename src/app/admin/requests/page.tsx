import { adminGate } from "@/components/admin/AdminGate";
import Link from "next/link";
import { runtimeStore } from "@/platform/stores/runtime";

export const dynamic = "force-dynamic";

export default async function RequestsPage() {
  const gate = await adminGate();
  if (gate) return gate;

  const store = runtimeStore();
  const [journeys, audit] = await Promise.all([store.listJourneys(100), store.listAudit(30)]);

  return (
    <div>
      <div className="eyebrow">Requests · {store.kind === "supabase" ? "database" : "local file"}</div>
      <h1 className="d2">Requests</h1>
      <p className="lede" style={{ margin: "12px 0 24px" }}>
        Every intake journey: where it came from (door attribution), the consent version recorded,
        the safety state, and the packet.
        {store.kind === "supabase"
          ? " These are stored permanently in your database."
          : " No database is configured here, so this list is temporary."}
      </p>
      {journeys.length === 0 ? (
        <div className="cell">
          No journeys yet. Start one from any door page or /start.
        </div>
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
              {journeys.map(({ session, problem }) => (
                <tr key={session.intake_session_id} style={{ borderTop: "1px solid var(--line-d)" }}>
                  <td style={{ padding: "8px 10px" }}>
                    {String(session.entered_at).replace("T", " ").replace("Z", " UTC").slice(0, 19)}
                  </td>
                  <td style={{ padding: "8px 10px" }}>
                    {session.attribution.page_id
                      ? `door · ${session.attribution.landing_path}`
                      : "direct /start"}
                  </td>
                  <td style={{ padding: "8px 10px" }}>
                    {problem.service_category ?? "—"}{" "}
                    <span className="hint" style={{ color: "var(--on-dark-mute)" }}>
                      {problem.service_category_confidence}
                    </span>
                  </td>
                  <td style={{ padding: "8px 10px" }}>
                    <span className={`pill ${problem.safety_state === "normal" ? "" : "pill-amber"}`}>
                      {problem.safety_state}
                    </span>
                  </td>
                  <td style={{ padding: "8px 10px", color: "var(--on-dark-mute)" }}>
                    {session.consent_event_ids.length > 0 ? "recorded" : "—"}
                  </td>
                  <td style={{ padding: "8px 10px" }}>
                    <Link href={`/results/${session.request_id}`} className="mono" style={{ color: "var(--pink)" }}>
                      view
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {audit.length > 0 && (
        <div className="cell" style={{ marginTop: 26 }}>
          <span className="tag">Owner audit trail</span>
          <ul style={{ paddingLeft: 18, color: "var(--on-dark-mute)" }}>
            {audit.map((a, i) => (
              <li key={i}>
                {String(a.at).slice(0, 19).replace("T", " ")} · {a.action} · {a.target}
                {a.detail ? ` · ${a.detail}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
