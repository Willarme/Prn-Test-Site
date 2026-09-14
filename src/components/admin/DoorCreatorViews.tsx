import Link from "next/link";
import type { ReactNode } from "react";
import type { DoorCreatorDetail } from "@/platform/admin/door-creator-types";
import { AdminStatus } from "./AdminUI";

/** Owner review uses the existing ink/paper workspace, short operating summaries
 * and expandable source records. No status here creates approval or activation. */
export function DoorReviewSection({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return <section className="cell adm-door-section" aria-labelledby={id}><h2 id={id}>{title}</h2>{children}</section>;
}

export function DoorUnavailableActions({ template = false }: { template?: boolean }) {
  const actions = template ? [
    { id: "theme", label: "Register or change a theme", reason: "A governed theme registry and its review process are not connected to this workspace." },
    { id: "impact", label: "Check template impact", reason: "A durable impact-analysis runner and affected-page review are not connected." },
  ] : [
    { id: "generate", label: "Generate live pages", reason: "The durable generation runner for live opportunities and governed input selection are not connected to this workspace. Fixture runs are available separately." },
    { id: "dry-run", label: "Run live preflight", reason: "Live preflight needs governed opportunity inputs and current live prerequisites. The fixture dry run does not establish them." },
    { id: "regenerate", label: "Regenerate this page", reason: "Regeneration needs a new reserved version, reviewed input changes and a durable run." },
    { id: "qa", label: "Run QA", reason: "The complete QA runner and its required review evidence are not connected." },
    { id: "approve", label: "Approve content", reason: "Content approval needs an explicit owner review of the exact version and its current assessment." },
    { id: "publish", label: "Publish", reason: "Publishing needs current release evidence, content approval and a verified serving authority. This workspace does not submit that action." },
    { id: "rollback", label: "Roll back serving", reason: "Rollback needs an eligible saved version, current serving revision and an explicit reviewed selection change." },
    { id: "impact", label: "Check impact", reason: "A durable impact-analysis runner and affected-page review are not connected." },
  ];
  return <details className="adm-door-action-panel"><summary>Unavailable actions ({actions.length})</summary><DoorReviewSection id={template ? "template-actions" : "creator-actions"} title="Actions awaiting connection">
    <p className="adm-small">These actions remain unavailable until their prerequisites and controls are connected. Fixture results do not satisfy live generation or publication gates.</p>
    <ul className="adm-door-actions">{actions.map(action => <li key={action.id}>
      <button type="button" className="btn btn-ghost" disabled aria-describedby={`door-${action.id}-reason`}>{action.label}</button>
      <p id={`door-${action.id}-reason`} className="adm-small">{action.reason}</p>
    </li>)}</ul>
    {template && <p className="adm-small">Automatic sending and publishing are also unavailable here. Their reviewed activation authority and durable automation are not connected to this workspace.</p>}
  </DoorReviewSection></details>;
}

export function DoorTechnicalDetails({ title = "Technical record", children }: { title?: string; children: ReactNode }) {
  return <details className="adm-door-details"><summary>{title}</summary><div className="adm-door-details-body">{children}</div></details>;
}

export function DoorEvidence({ evidence }: { evidence: DoorCreatorDetail["evidence"] }) {
  return <DoorReviewSection id="version-evidence" title="Recorded evidence">
    <p className="adm-small">A recorded PASS is the result of that check at that time. It is not a current QA approval or permission to publish. Time-window labels describe dates only.</p>
    {evidence.status === "unavailable" ? <p role="status">Evidence could not be read. Its presence and outcome are unverified.</p>
      : !evidence.rows.length ? <p>No evidence receipts are recorded for this version.</p>
        : <div className="adm-door-evidence">{evidence.rows.map(row => <article key={row.receipt_sha256}>
          <div className="adm-door-row"><h3>{row.kind.replace(/_/g, " ")}</h3><AdminStatus tone={row.verdict === "FAIL" || row.verdict === "BLOCKED" ? "warning" : "neutral"}>Recorded {row.verdict}</AdminStatus></div>
          <p className="adm-small">Finished <time dateTime={row.finished_at}>{row.finished_at}</time> · {row.time_status === "current" ? "Within recorded time window" : row.time_status === "expired" ? "Recorded time window expired" : "Recorded time is in the future"}</p>
          <p className="adm-small">Model: {row.model_id ?? "Not recorded"} · {row.cost_usd === null ? "Cost not recorded" : `Recorded cost: USD ${row.cost_usd}`}</p>
          <DoorTechnicalDetails title="Receipt and findings"><dl className="adm-door-facts">
            <div><dt>Receipt hash</dt><dd className="mono">{row.receipt_sha256}</dd></div>
            <div><dt>Producer</dt><dd>{row.producer_id}</dd></div><div><dt>Run</dt><dd>{row.run_id}</dd></div>
            <div><dt>Trust scope</dt><dd>{row.trust_scope}</dd></div><div><dt>Expires</dt><dd><time dateTime={row.expires_at}>{row.expires_at}</time></dd></div>
          </dl>{row.findings.length ? <ul>{row.findings.map((finding, i) => <li key={i}><strong>{finding.severity}</strong> · {finding.code}<span className="mono"> {finding.pointer}</span></li>)}</ul> : <p>No findings recorded in this receipt.</p>}</DoorTechnicalDetails>
        </article>)}</div>}
  </DoorReviewSection>;
}

export function DoorVersionHistory({ data }: { data: DoorCreatorDetail }) {
  return <DoorReviewSection id="version-history" title="Registered version history">
    {!data.versions.length ? <p>No built version is recorded. A reservation alone does not contain a compiled page.</p>
      : <div className="adm-door-table" role="region" aria-label="Registered version history" tabIndex={0}><table><thead><tr><th scope="col">Version</th><th scope="col">Candidate type</th><th scope="col">Registered</th></tr></thead><tbody>{data.versions.map(version => <tr key={version.page_version}>
        <th scope="row"><Link href={`/admin/page-creator/${encodeURIComponent(data.page!.page_id)}?version=${version.page_version}`} aria-current={data.selected?.page_version === version.page_version ? "page" : undefined}>Version {version.page_version}</Link></th>
        <td>{version.mode === "fixture" ? "Synthetic fixture" : "Live-mode candidate"}</td><td><time dateTime={version.registered_at}>{version.registered_at}</time></td>
      </tr>)}</tbody></table></div>}
  </DoorReviewSection>;
}
