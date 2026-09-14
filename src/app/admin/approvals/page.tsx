import { adminGate } from "@/components/admin/AdminGate";
import { ApprovalDecision } from "@/components/admin/ApprovalDecision";
import { AdminEmptyState, AdminPageHeader, AdminStatus } from "@/components/admin/AdminUI";
import { approvalEffect, approvalEvidenceText } from "@/platform/admin/approval-view";
import { readApprovalSnapshot } from "@/platform/approvals/center";
import styles from "./approvals.module.css";

export const dynamic = "force-dynamic";

export default async function ApprovalsPage() {
  const gate = await adminGate();
  if (gate) return gate;
  const snapshot = await readApprovalSnapshot();
  const items = [...snapshot.items].sort((a, b) => Number(b.status === "PENDING") - Number(a.status === "PENDING") || Date.parse(b.created_at) - Date.parse(a.created_at));
  const pending = items.filter(item => item.status === "PENDING").length;
  return <div>
    <AdminPageHeader eyebrow="Operate / Decision queue" title="The evidence before the decision."
      description="Review the proposal, its basis and the exact consequence of a decision. Routine work follows the delegation policy; a pending item alone does not establish that an owner must decide."
      meta={<><AdminStatus tone={!snapshot.verified ? "warning" : "neutral"}>{snapshot.verified ? `${pending} pending in this view` : "Database queue unverified"}</AdminStatus><AdminStatus>{snapshot.source === "database" ? "Latest 100 database items" : "This process only"}</AdminStatus></>} />
    {snapshot.source === "this process" && <p className="adm-small" style={{ marginBottom: 22 }}>{snapshot.verified ? "These approval items live only in this server process and are lost on restart. Local request files do not make this queue durable." : "The database could not be read. Any rows shown are cached in this process; decisions are withheld until the authoritative queue is available."}</p>}
    {!items.length ? <AdminEmptyState title={snapshot.verified ? "No decisions in this view" : "The decision queue could not be verified"}>{snapshot.verified ? "A recorded proposal will appear here with its recommendation, impact and evidence. An empty process queue does not describe another server or a previous session." : "Reload to retry. An unavailable queue does not mean nothing is waiting."}</AdminEmptyState>
      : <div className={styles.list}>{items.map(item => <article key={item.approval_id} className={`adm-card ${styles.item}`}>
        <div className={styles.heading}><AdminStatus tone={item.status === "REJECTED" ? "neutral" : item.status === "PENDING" ? "warning" : "good"}>{item.status.replaceAll("_", " ")}</AdminStatus><span className="mono">{item.agent_id}</span><span className="adm-small">{item.approval_kind ?? "Kind not recorded"}</span></div>
        <h2 className={styles.title}>{item.what_happened}</h2>
        <p className="adm-small">{item.created_at} · {item.approval_id} · run {item.run_id}</p>
        <div className={styles.recommendation}><strong>Recommendation</strong><p>{item.recommendation ?? "No recommendation was recorded. Review the proposal and evidence before acting."}</p></div>
        <dl className={styles.facts}><div><dt>Impact</dt><dd>{item.impact}</dd></div><div><dt>Risk</dt><dd>{item.risk}</dd></div><div><dt>Reversibility</dt><dd>{item.reversibility.replaceAll("-", " ")}</dd></div></dl>
        <div className={styles.evidence}><details open><summary>Exact proposed change</summary><pre>{approvalEvidenceText(item.proposed_change).text}</pre></details><details open><summary>Recorded evidence</summary><pre>{approvalEvidenceText(item.evidence).text}</pre></details></div>
        <p className="adm-small">Decision class is not recorded in this item’s contract. Its status is a workflow gate, not a new delegation or execution policy.</p>
        {item.resolved_at && <p className="adm-small">Resolved {item.resolved_at} by {item.resolved_by ?? "an unrecorded actor"}. Recorded approval is distinct from verified execution.</p>}
        <div className={styles.footer}><p className="adm-small">{approvalEffect(item.approval_kind)}</p>{snapshot.verified ? <ApprovalDecision approvalId={item.approval_id} kind={item.approval_kind ?? null} status={item.status} /> : <AdminStatus tone="warning">Awaiting a verified queue read</AdminStatus>}</div>
      </article>)}</div>}
  </div>;
}
