"use client";

import { useState } from "react";
import Link from "next/link";
import { requestStatusLabel, selectRequestRows, type AdminRequestRow } from "@/domain/admin/request-view";
import { AdminEmptyState, AdminStatus } from "@/components/admin/AdminUI";

export function AdminRequestTable({ rows }: { rows: AdminRequestRow[] }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [category, setCategory] = useState("");
  const [page, setPage] = useState(1);
  const selected = selectRequestRows(rows, { query, status, category, page });
  return <section className="adm-card" aria-label="Request explorer">
    <div className="adm-filter-bar" style={{ display: "flex", flexWrap: "wrap", gap: 14, marginBottom: 18 }}>
      <label style={{ flex: "1 1 240px" }}>Search requests
        <input type="search" value={query} maxLength={200} placeholder="Request ID, entry page or category" onChange={event => { setQuery(event.target.value); setPage(1); }} style={{ width: "100%", display: "block", marginTop: 6 }} />
      </label>
      <label>Status
        <select value={status} onChange={event => { setStatus(event.target.value); setPage(1); }} style={{ display: "block", marginTop: 6 }}>
          <option value="">All statuses</option>{[...new Set(rows.map(row => row.status))].sort().map(value => <option key={value} value={value}>{requestStatusLabel(value)}</option>)}
        </select>
      </label>
      <label>Category
        <select value={category} onChange={event => { setCategory(event.target.value); setPage(1); }} style={{ display: "block", marginTop: 6 }}>
          <option value="">All categories</option>{[...new Set(rows.map(row => row.category))].sort().map(value => <option key={value} value={value}>{value}</option>)}
        </select>
      </label>
    </div>
    <p className="hint" role="status" aria-live="polite">{selected.total} matching {selected.total === 1 ? "request" : "requests"} within the latest {rows.length} loaded.</p>
    {selected.rows.length ? <div style={{ overflowX: "auto" }} tabIndex={0} role="region" aria-label="Requests table">
      <table className="adm-table">
        <thead><tr><th scope="col">Request / received</th><th scope="col">Entry / category</th><th scope="col">Stored status</th><th scope="col">Current safety</th><th scope="col">Record</th></tr></thead>
        <tbody>{selected.rows.map(row => <tr key={row.requestId}>
          <td><Link href={`/admin/requests/${encodeURIComponent(row.requestId)}`} className="mono" style={{ overflowWrap: "anywhere" }}>{row.requestId}</Link><div className="hint">{row.enteredAt.replace("T", " ").replace(/\.\d+Z$/, " UTC").replace(/Z$/, " UTC")}</div>{row.synthetic && <AdminStatus>Synthetic demo</AdminStatus>}</td>
          <td><div style={{ overflowWrap: "anywhere" }}>{row.source}</div><div className="hint">{row.category}{row.confidence ? ` · ${row.confidence} confidence · inferred` : ""}</div></td>
          <td>{requestStatusLabel(row.status)}</td>
          <td><AdminStatus tone={row.safety === "urgent" ? "danger" : row.safety === "normal" ? "neutral" : "warning"}>{row.safety === "unverified" ? "Safety unverified" : row.safety === "normal" ? "No recorded flag" : row.safety === "urgent" ? "Safety stop" : "Safety review"}</AdminStatus></td>
          <td><Link href={`/admin/requests/${encodeURIComponent(row.requestId)}`}>Inspect record →</Link><div className="hint">Packet v{row.packetVersion} · {row.consentReferences} consent {row.consentReferences === 1 ? "reference" : "references"}</div></td>
        </tr>)}</tbody>
      </table>
    </div> : <AdminEmptyState title="No matching requests">Change the search or filters to widen this view.</AdminEmptyState>}
    <nav aria-label="Request pages" style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", marginTop: 20 }}>
      <button className="btn btn-ghost btn-sm" disabled={selected.page <= 1} onClick={() => setPage(selected.page - 1)}>Previous</button>
      <span className="hint">Page {selected.page} of {selected.pages} · 20 per page</span>
      <button className="btn btn-ghost btn-sm" disabled={selected.page >= selected.pages} onClick={() => setPage(selected.page + 1)}>Next</button>
    </nav>
  </section>;
}
