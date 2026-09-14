import Link from "next/link";
import { adminGate } from "@/components/admin/AdminGate";
import { AdminEmptyState, AdminPageHeader, AdminStatus } from "@/components/admin/AdminUI";
import { GeneratePagesButton } from "@/components/admin/GeneratePagesButton";
import { OpportunityDecision } from "@/components/admin/OpportunityDecision";
import { effectiveStatus, latestDecision } from "@/domain/search/decision";
import { loadOpportunities } from "@/platform/admin/data";
import { opportunityDecisionStore } from "@/platform/search/decision-store";

export const dynamic = "force-dynamic";
const REC_ORDER = ["NEW", "EXPAND", "MERGE", "WATCH", "REJECT"];
const STATUSES = ["candidate", "approved", "watch", "merged", "rejected", "retired", "unverified"];
const PAGE_SIZE = 20;
type Search = Record<string, string | string[] | undefined>;
const scalar = (value: Search[string]) => (Array.isArray(value) ? value[0] : value) ?? "";

/** Scores, recommendations and decision overlays stay on this server surface.
 * The client action receives only the existing ID and effective status. */
export default async function OpportunitiesPage({ searchParams }: { searchParams?: Promise<Search> }) {
  const gate = await adminGate();
  if (gate) return gate;
  const params = await searchParams ?? {};
  const query = scalar(params.q).trim().slice(0, 160);
  const recommendation = REC_ORDER.includes(scalar(params.rec)) ? scalar(params.rec) : "";
  const statusFilter = STATUSES.includes(scalar(params.status)) ? scalar(params.status) : "";
  const { opportunities, generated_at } = loadOpportunities();
  let decisions: Awaited<ReturnType<ReturnType<typeof opportunityDecisionStore>["list"]>> = [];
  let decisionsReadable = true;
  let storeKind: "file" | "supabase" | null = null;
  try {
    const store = opportunityDecisionStore();
    storeKind = store.kind;
    decisions = await store.list();
  } catch { decisionsReadable = false; }
  const sorted = opportunities.map(opportunity => ({
    opportunity,
    status: decisionsReadable ? effectiveStatus(opportunity, decisions) : "unverified",
    last: decisionsReadable ? latestDecision(opportunity.search_opportunity_id, decisions) : null,
  })).sort((a, b) => {
    const rank = (value: string | null) => { const index = REC_ORDER.indexOf(value ?? ""); return index < 0 ? REC_ORDER.length : index; };
    return rank(a.opportunity.recommendation) - rank(b.opportunity.recommendation)
      || (b.opportunity.opportunity_score ?? -1) - (a.opportunity.opportunity_score ?? -1)
      || a.opportunity.search_opportunity_id.localeCompare(b.opportunity.search_opportunity_id);
  });
  const filtered = sorted.filter(({ opportunity: o, status }) =>
    (!recommendation || o.recommendation === recommendation) && (!statusFilter || status === statusFilter)
    && (!query || [o.keyword, o.search_opportunity_id, o.problem_family_hint, o.intent_type, o.source].some(value => value?.toLowerCase().includes(query.toLowerCase()))));
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const requestedPage = Number(scalar(params.page));
  const page = Math.min(pageCount, Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1);
  const offset = (page - 1) * PAGE_SIZE;
  const shown = filtered.slice(offset, offset + PAGE_SIZE);
  const pageHref = (target: number) => {
    const next = new URLSearchParams();
    if (query) next.set("q", query);
    if (recommendation) next.set("rec", recommendation);
    if (statusFilter) next.set("status", statusFilter);
    next.set("page", String(target));
    return `/admin/opportunities?${next.toString()}`;
  };
  const opportunityIds = new Set(opportunities.map(o => o.search_opportunity_id));
  const decidedCount = new Set(decisions.filter(d => opportunityIds.has(d.search_opportunity_id)).map(d => d.search_opportunity_id)).size;

  return <div>
    <AdminPageHeader eyebrow="Growth / A04 research desk" title="Search opportunities"
      description="Review the research, distinguish the recommendation from the recorded decision, then move approved opportunities into page building."
      meta={<><AdminStatus>{opportunities.length} research records</AdminStatus><AdminStatus tone={decisionsReadable ? "neutral" : "warning"}>{decisionsReadable ? `${decidedCount} with a recorded decision` : "Decision status unverified"}</AdminStatus><span>Research evaluated {generated_at.slice(0, 10)}</span></>}
      actions={<Link className="btn btn-ghost" href="/admin/pages">Open page queue →</Link>} />
    <div className="cell" style={{ marginBottom: 24, borderLeft: "3px solid #2d5c68" }}>
      <p style={{ margin: "0 0 10px" }}><strong>Research records are not measured site traffic.</strong> Volume and difficulty are recorded research metrics; an unknown value remains unknown. Scores are deterministic prioritization, not a forecast.</p>
      <p className="adm-small" style={{ margin: 0 }}>NEW recommends a new page; MERGE points to a stronger family match; WATCH keeps an opportunity in review. The current factory requires an approved status and applies its own intent and content gates. Accepting here does not publish a page. Decision backend: {storeKind === "supabase" ? "database" : storeKind === "file" ? "local file" : "unknown"}.</p>
    </div>
    {!decisionsReadable && <div role="status" className="cell" style={{ marginBottom: 24, borderLeft: "3px solid #b78742" }}><strong>Decision status could not be verified.</strong><p className="adm-small" style={{ marginBottom: 0 }}>The decision store did not return a usable reading. Every decision status below is unverified, and decision/build controls are unavailable until the read recovers. The research artifact is still available.</p></div>}
    <form method="get" action="/admin/opportunities" aria-label="Filter search opportunities" style={{ display: "flex", alignItems: "end", gap: 12, flexWrap: "wrap", marginBottom: 22 }}>
      <label className="field" style={{ flex: "2 1 220px", minWidth: 0 }}><span className="field-label">Search research</span><input type="search" name="q" defaultValue={query} maxLength={160} placeholder="Keyword, family or ID" style={{ width: "100%" }} /></label>
      <label className="field" style={{ flex: "1 1 165px", minWidth: 0 }}><span className="field-label">Recommendation</span><select name="rec" defaultValue={recommendation} style={{ width: "100%" }}><option value="">All recommendations</option>{REC_ORDER.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
      <label className="field" style={{ flex: "1 1 165px", minWidth: 0 }}><span className="field-label">Decision status</span><select name="status" defaultValue={statusFilter} style={{ width: "100%" }}><option value="">All statuses</option>{STATUSES.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
      <button type="submit" className="btn">Apply filters</button><Link className="btn btn-ghost" href="/admin/opportunities">Reset</Link>
    </form>
    <p className="adm-small">{filtered.length ? `Showing ${offset + 1}–${offset + shown.length} of ${filtered.length}` : "0 matching records"} · {opportunities.length} total research records · recommendation order, then highest score</p>
    {!shown.length ? <AdminEmptyState title={opportunities.length ? "No research matches these filters" : "No research records returned"} action={<Link className="btn btn-ghost" href="/admin/opportunities">Reset filters</Link>}>Adjust the keyword, recommendation or decision status to review another part of the queue.</AdminEmptyState> : <div role="region" aria-label="Search opportunity ledger" tabIndex={0} style={{ overflowX: "auto", maxWidth: "100%", border: "1px solid var(--admin-line)", background: "#fff" }}>
      <table style={{ width: "100%", minWidth: 950, borderCollapse: "collapse", textAlign: "left" }}><thead><tr><th scope="col">Research / keyword</th><th scope="col">Recommendation</th><th scope="col">Recorded decision</th><th scope="col">Research metrics</th><th scope="col">Evidence & score</th><th scope="col">Next action</th></tr></thead><tbody>{shown.map(({ opportunity: o, status, last }) => <tr key={o.search_opportunity_id}>
        <td style={{ minWidth: 190 }}><strong>{o.keyword}</strong><div className="adm-small">{o.problem_family_hint ?? "Family not recorded"} · {o.intent_type}</div><div className="mono" style={{ marginTop: 8 }}>{o.search_opportunity_id}</div></td>
        <td><AdminStatus tone={o.recommendation === "WATCH" || o.recommendation === "MERGE" ? "warning" : "neutral"}>{o.recommendation ?? "Not recorded"}</AdminStatus></td>
        <td><AdminStatus tone={!decisionsReadable ? "warning" : status === "approved" ? "good" : "neutral"}>{status}</AdminStatus>{last && <div className="adm-small" style={{ marginTop: 6 }}>{last.decided_by} · {last.decided_at.slice(0, 10)}</div>}{decisionsReadable && !last && <div className="adm-small" style={{ marginTop: 6 }}>Research artifact status · no overlay decision</div>}</td>
        <td style={{ minWidth: 110 }}><strong>{o.volume_monthly?.toLocaleString() ?? "Unknown"}</strong><div className="adm-small">volume / month</div><div style={{ marginTop: 6 }}>KD {o.keyword_difficulty ?? "Unknown"}</div></td>
        <td style={{ minWidth: 170 }}><strong>{o.opportunity_score ?? "Unknown"}</strong> <span className="adm-small">score · v{o.score_version ?? "1.0.0"}</span><div className="adm-small">{o.source}</div><details style={{ marginTop: 9 }}><summary>Research provenance</summary><p className="adm-small">{o.provenance.confidence_note ?? "No confidence note recorded."}</p><p className="adm-small">Source type: {o.provenance.source_type}<br />Geography: {o.geography_assumed ? "Assumed by import" : "Recorded by source"}<br />Researched: {o.researched_at?.slice(0, 10) ?? "Date unknown"}</p>{o.score_components && <dl className="adm-small">{Object.entries(o.score_components).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl>}</details></td>
        <td style={{ minWidth: 230 }}>{decisionsReadable ? <span className="adm-action"><OpportunityDecision opportunityId={o.search_opportunity_id} status={status} />{status === "approved" && <GeneratePagesButton opportunityId={o.search_opportunity_id} />}</span> : <span className="adm-small">Unavailable until the decision state is verified.</span>}</td>
      </tr>)}</tbody></table>
    </div>}
    <nav aria-label="Opportunity result pages" style={{ display: "flex", gap: 12, justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", marginTop: 22 }}>
      {page > 1 ? <Link className="btn btn-ghost" href={pageHref(page - 1)}>← Previous</Link> : <span className="adm-small">Start of results</span>}<span className="adm-small">Page {page} of {pageCount} · up to {PAGE_SIZE} records</span>{page < pageCount ? <Link className="btn btn-ghost" href={pageHref(page + 1)}>Next →</Link> : <span className="adm-small">End of results</span>}
    </nav>
  </div>;
}
