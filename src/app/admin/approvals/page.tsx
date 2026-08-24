import { adminGate } from "@/components/admin/AdminGate";
import { listApprovals } from "@/platform/approvals/center";

export const dynamic = "force-dynamic";

/**
 * A00 Approval Center — minimal owner list view (Wave 0). Read-gated like
 * every admin page: the DATA never renders without an owner session, not
 * just the buttons. Expected empty until A06 (Wave 2) starts queueing publish
 * approvals here; deliberately disconnected from the existing Pages
 * approve/publish flow (that migration is A06's job).
 */
export default async function ApprovalsPage() {
  const gate = await adminGate();
  if (gate) return gate;

  const items = await listApprovals();

  return (
    <div>
      <div className="eyebrow">Approval Center · platform</div>
      <h1 className="d2">Approvals</h1>
      <p className="lede" style={{ margin: "12px 0 24px" }}>
        One queue for anything a digital worker needs a human &quot;yes&quot; for: what happened,
        evidence, impact, risk, reversibility, and the exact proposed change. The first agent to
        use this queue is the page-release gate (A06) — until then it stays empty by design.
      </p>
      {items.length === 0 ? (
        <div className="cell">
          Nothing waiting for approval. When an agent proposes a consequential change, it will
          appear here with its evidence and an approve / modify / reject decision.
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".9rem" }}>
            <thead>
              <tr className="mono" style={{ textAlign: "left", color: "var(--on-dark-mute)" }}>
                <th style={{ padding: "8px 10px" }}>When</th>
                <th style={{ padding: "8px 10px" }}>Agent</th>
                <th style={{ padding: "8px 10px" }}>What happened</th>
                <th style={{ padding: "8px 10px" }}>Impact</th>
                <th style={{ padding: "8px 10px" }}>Risk</th>
                <th style={{ padding: "8px 10px" }}>Reversibility</th>
                <th style={{ padding: "8px 10px" }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.approval_id} style={{ borderTop: "1px solid var(--line-d)" }}>
                  <td style={{ padding: "8px 10px" }}>
                    {item.created_at.replace("T", " ").replace("Z", " UTC").slice(0, 19)}
                  </td>
                  <td className="mono" style={{ padding: "8px 10px" }}>{item.agent_id}</td>
                  <td style={{ padding: "8px 10px" }}>{item.what_happened}</td>
                  <td style={{ padding: "8px 10px" }}>{item.impact}</td>
                  <td style={{ padding: "8px 10px" }}>{item.risk}</td>
                  <td style={{ padding: "8px 10px" }}>{item.reversibility}</td>
                  <td style={{ padding: "8px 10px" }}>
                    <span className={`pill ${item.status === "PENDING" ? "pill-amber" : "pill-green"}`}>
                      {item.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
