import { loadOpportunities } from "@/platform/admin/data";

const REC_ORDER = ["NEW", "EXPAND", "MERGE", "WATCH", "REJECT"];

export default function OpportunitiesPage() {
  const { opportunities, summary, generated_at } = loadOpportunities();
  const sorted = [...opportunities].sort((a, b) => {
    const ra = REC_ORDER.indexOf(a.recommendation ?? "REJECT");
    const rb = REC_ORDER.indexOf(b.recommendation ?? "REJECT");
    if (ra !== rb) return ra - rb;
    return (b.opportunity_score ?? 0) - (a.opportunity_score ?? 0);
  });

  return (
    <div>
      <div className="eyebrow">A04 · Search Opportunity</div>
      <h1 className="d2">Search opportunities</h1>
      <p className="lede" style={{ margin: "12px 0 24px" }}>
        {summary.total} keywords from your research workbook, scored deterministically (v1) and
        recommended against each other. Only <strong>NEW</strong> can become a page; MERGE means a
        stronger keyword in the same family already claims the page (anti-doorway rule); WATCH means
        the metrics are unknown until the vendor enrichment runs. Evaluated {generated_at.slice(0, 10)}.
      </p>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".9rem" }}>
          <thead>
            <tr className="mono" style={{ textAlign: "left", color: "var(--on-dark-mute)" }}>
              <th style={{ padding: "8px 10px" }}>Rec</th>
              <th style={{ padding: "8px 10px" }}>Keyword</th>
              <th style={{ padding: "8px 10px" }}>Intent</th>
              <th style={{ padding: "8px 10px" }}>Family</th>
              <th style={{ padding: "8px 10px" }}>Vol/mo</th>
              <th style={{ padding: "8px 10px" }}>KD</th>
              <th style={{ padding: "8px 10px" }}>Score</th>
              <th style={{ padding: "8px 10px" }}>Source</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((o) => (
              <tr key={o.search_opportunity_id} style={{ borderTop: "1px solid var(--line-d)" }}>
                <td style={{ padding: "8px 10px" }}>
                  <span className={`pill ${o.recommendation === "NEW" ? "pill-green" : o.recommendation === "WATCH" || o.recommendation === "MERGE" ? "pill-amber" : ""}`}>
                    {o.recommendation}
                  </span>
                </td>
                <td style={{ padding: "8px 10px" }}>{o.keyword}</td>
                <td style={{ padding: "8px 10px" }}>{o.intent_type}</td>
                <td style={{ padding: "8px 10px" }}>{o.problem_family_hint ?? "—"}</td>
                <td style={{ padding: "8px 10px" }}>{o.volume_monthly?.toLocaleString() ?? "?"}</td>
                <td style={{ padding: "8px 10px" }}>{o.keyword_difficulty ?? "?"}</td>
                <td style={{ padding: "8px 10px" }}>{o.opportunity_score ?? "—"}</td>
                <td style={{ padding: "8px 10px", color: "var(--on-dark-mute)" }}>{o.source}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
