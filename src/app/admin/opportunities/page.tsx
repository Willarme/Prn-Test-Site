import { adminGate } from "@/components/admin/AdminGate";
import { OpportunityDecision } from "@/components/admin/OpportunityDecision";
import { effectiveStatus, latestDecision } from "@/domain/search/decision";
import { loadOpportunities } from "@/platform/admin/data";
import { opportunityDecisionStore } from "@/platform/search/decision-store";

export const dynamic = "force-dynamic";

const REC_ORDER = ["NEW", "EXPAND", "MERGE", "WATCH", "REJECT"];

/**
 * A04's review queue — and, since this build, the loop's FIRST HUMAN GATE.
 *
 * SERVER COMPONENT, DELIBERATELY (Loop Spec Audit condition 10). Every score,
 * every score component, the whole candidate queue and the recommendation
 * reasoning are read and rendered HERE. The only thing that crosses into the
 * browser is <OpportunityDecision>, which takes an id and a status string.
 * tests/client-boundary.test.ts pins that: no "use client" file may import
 * domain/search or platform/search, and none may name a score field.
 *
 * TWO COLUMNS THAT LOOK ALIKE AND ARE NOT. "Rec" is A04's OPINION
 * (recommendation). "Status" is the OWNER'S DECISION. Until this build the page
 * showed only the first, and the page factory keyed off it — an agent's opinion
 * with no human in between. They are now side by side precisely so the
 * difference is visible: a NEW recommendation sitting at status "candidate" is
 * a proposal awaiting a decision, not an approval.
 *
 * The decisions are an OVERLAY joined at read time; the committed artifact
 * data/factory/opportunities.json is never rewritten by a click.
 */
const STATUS_PILL: Record<string, string> = {
  approved: "pill-green",
  candidate: "",
  watch: "pill-amber",
  merged: "pill-amber",
  rejected: "",
  retired: "",
};

export default async function OpportunitiesPage() {
  const gate = await adminGate();
  if (gate) return gate;

  const { opportunities, summary, generated_at } = loadOpportunities();

  // Decisions are an overlay, and reading them must never take the page down:
  // an unapplied migration or an unwritable dev store means "no decisions yet",
  // not a 500 on the owner's queue.
  let decisions: Awaited<ReturnType<ReturnType<typeof opportunityDecisionStore>["list"]>> = [];
  let decisionsReadable = true;
  try {
    decisions = await opportunityDecisionStore().list();
  } catch {
    decisionsReadable = false;
  }

  const sorted = [...opportunities].sort((a, b) => {
    const ra = REC_ORDER.indexOf(a.recommendation ?? "REJECT");
    const rb = REC_ORDER.indexOf(b.recommendation ?? "REJECT");
    if (ra !== rb) return ra - rb;
    return (b.opportunity_score ?? 0) - (a.opportunity_score ?? 0);
  });

  const decidedCount = new Set(decisions.map((d) => d.search_opportunity_id)).size;

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
      <div className="cell" style={{ margin: "0 0 24px" }}>
        <strong>Rec is the agent&apos;s opinion. Status is your decision.</strong> Nothing becomes a
        page until you accept it here — and accepting still does not publish anything: the page is
        built, QA&apos;d, and published by you separately. {decidedCount} of {summary.total} decided.
        {!decisionsReadable && (
          <span style={{ color: "var(--amber)" }}>
            {" "}
            Decisions could not be read just now, so every row shows its stored status.
          </span>
        )}
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".9rem" }}>
          <thead>
            <tr className="mono" style={{ textAlign: "left", color: "var(--on-dark-mute)" }}>
              <th style={{ padding: "8px 10px" }}>Rec</th>
              <th style={{ padding: "8px 10px" }}>Status</th>
              <th style={{ padding: "8px 10px" }}>Keyword</th>
              <th style={{ padding: "8px 10px" }}>Intent</th>
              <th style={{ padding: "8px 10px" }}>Family</th>
              <th style={{ padding: "8px 10px" }}>Vol/mo</th>
              <th style={{ padding: "8px 10px" }}>KD</th>
              <th style={{ padding: "8px 10px" }}>Score</th>
              <th style={{ padding: "8px 10px" }}>Source</th>
              <th style={{ padding: "8px 10px" }}>Decision</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((o) => {
              const status = effectiveStatus(o, decisions);
              const last = latestDecision(o.search_opportunity_id, decisions);
              return (
                <tr key={o.search_opportunity_id} style={{ borderTop: "1px solid var(--line-d)" }}>
                  <td style={{ padding: "8px 10px" }}>
                    <span className={`pill ${o.recommendation === "NEW" ? "pill-green" : o.recommendation === "WATCH" || o.recommendation === "MERGE" ? "pill-amber" : ""}`}>
                      {o.recommendation}
                    </span>
                  </td>
                  <td style={{ padding: "8px 10px" }}>
                    <span className={`pill ${STATUS_PILL[status] ?? ""}`}>{status}</span>
                    {last && (
                      <span
                        className="hint"
                        style={{ display: "block", color: "var(--on-dark-mute)" }}
                      >
                        {last.decided_by} · {last.decided_at.slice(0, 10)}
                      </span>
                    )}
                  </td>
                  <td style={{ padding: "8px 10px" }}>{o.keyword}</td>
                  <td style={{ padding: "8px 10px" }}>{o.intent_type}</td>
                  <td style={{ padding: "8px 10px" }}>{o.problem_family_hint ?? "—"}</td>
                  <td style={{ padding: "8px 10px" }}>{o.volume_monthly?.toLocaleString() ?? "?"}</td>
                  <td style={{ padding: "8px 10px" }}>{o.keyword_difficulty ?? "?"}</td>
                  <td style={{ padding: "8px 10px" }}>{o.opportunity_score ?? "—"}</td>
                  <td style={{ padding: "8px 10px", color: "var(--on-dark-mute)" }}>{o.source}</td>
                  <td style={{ padding: "8px 10px" }}>
                    <OpportunityDecision
                      opportunityId={o.search_opportunity_id}
                      status={status}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
