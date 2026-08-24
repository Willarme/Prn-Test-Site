import { adminGate } from "@/components/admin/AdminGate";
import Link from "next/link";
import { loadOpportunities, allStagedSpecs, publishedPageIds } from "@/platform/admin/data";
import { runtimeStore } from "@/platform/stores/runtime";
import { DEFAULT_FLAGS } from "@/platform/flags";
import { TRIAL_AGENT_REGISTRY } from "@/platform/agents/registry";
import {
  exceptionQueue,
  qualityFilteredJourneyTotals,
  qualityKpiSnapshot,
} from "@/platform/quality/kpi";

export const dynamic = "force-dynamic";

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="cell">
      <span className="tag">{label}</span>
      <div className="d2" style={{ fontSize: "2.2rem" }}>
        {value}
      </div>
      {hint && (
        <p className="hint" style={{ color: "var(--on-dark-mute)" }}>
          {hint}
        </p>
      )}
    </div>
  );
}

export default async function AdminOverview() {
  const gate = await adminGate();
  if (gate) return gate;

  const opps = loadOpportunities();
  const store = runtimeStore();
  const [staged, published, totals, safetyTriggers, quality, queue] = await Promise.all([
    allStagedSpecs(),
    publishedPageIds(),
    // A09: the journey counts honour quarantine — a record A09 contained stops
    // contributing to the owner's numbers the moment the marker exists. That is
    // the difference between quarantine and a cosmetic flag.
    qualityFilteredJourneyTotals(),
    store.countEvents("safety.triggered"),
    qualityKpiSnapshot(),
    exceptionQueue(8),
  ]);
  const qaPass = staged.filter((s) => s.qa.state === "PASS").length;
  const qaFail = staged.filter((s) => s.qa.state === "FAIL").length;
  const doorsFlag = DEFAULT_FLAGS.find((f) => f.flag_key === "seo_doors_enabled")?.enabled ?? false;
  const liveAgents = TRIAL_AGENT_REGISTRY.filter((a) => ["A04", "A05", "A06"].includes(a.agent_id));

  return (
    <div>
      <div className="eyebrow">Company OS Lite · trial cockpit</div>
      <h1 className="d2" style={{ marginBottom: 8 }}>
        Where the machine stands
      </h1>
      <p className="hint" style={{ color: "var(--on-dark-mute)", marginBottom: 24 }}>
        Storage:{" "}
        {store.kind === "supabase" ? (
          <span className="pill pill-green">Supabase database — permanent</span>
        ) : (
          <span className="pill pill-amber">local file — temporary until the database is connected</span>
        )}
      </p>

      <div className="grid3" style={{ marginBottom: 30 }}>
        <Stat
          label="Search opportunities"
          value={opps.summary.total}
          hint={`${opps.summary.by_recommendation.NEW ?? 0} NEW · ${opps.summary.by_recommendation.WATCH ?? 0} WATCH · ${opps.summary.by_recommendation.MERGE ?? 0} MERGE · ${opps.summary.by_recommendation.REJECT ?? 0} REJECT`}
        />
        <Stat
          label="Pages staged"
          value={staged.length}
          hint={`${qaPass} QA PASS (publish queue) · ${qaFail} QA FAIL`}
        />
        <Stat
          label="Pages published"
          value={published.size}
          hint={doorsFlag ? "public serving ON" : "public serving switch OFF until launch"}
        />
        <Stat
          label="Journeys recorded"
          value={totals.journeys}
          hint={`${totals.packets} packets · ${totals.consents} consent events${
            totals.excluded_by_quarantine > 0
              ? ` · ${totals.excluded_by_quarantine} withheld by data quality`
              : ""
          }${
            // The journey count is real; whether any of it SHOULD have been
            // withheld is what could not be established.
            totals.read_failed ? " · quarantine filter could not run" : ""
          }`}
        />
        <Stat label="Safety triggers" value={safetyTriggers} hint="deterministic gate, before analysis" />
        <Stat
          label="Needs vendor enrichment"
          value={opps.summary.needs_enrichment}
          hint="metrics unknown until DataForSEO runs"
        />
      </div>

      {/*
        A09 DATA QUALITY — inside the cockpit, NOT a second screen. Canon is
        explicit that A09's findings surface in A07's Company Health view and
        that A09 does not get its own dashboard, so this is a section on the
        page that already exists rather than a new top-level admin route.

        IDS AND COUNTS ONLY. Every cell below is a number, a rule id, an entity
        id or a severity word. Nothing here can render a homeowner's words, a
        photo reference or consent text — the finding shapes cannot carry them
        (platform/quality/types.ts), so this surface could not leak them even if
        it tried.
      */}
      <div className="cell" style={{ marginBottom: 30 }}>
        <span className="tag">Data quality · A09</span>
        {quality.could_not_verify ? (
          <p style={{ margin: "8px 0" }}>
            <span className="pill pill-amber">COULD NOT VERIFY</span>{" "}
            <span style={{ color: "var(--on-dark-mute)" }}>
              {/*
                The two causes read differently and must not be conflated. A lost
                WRITE leaves partial numbers; a failed READ leaves no numbers at
                all, and saying "lost 0 writes" would be the wrong reason.
              */}
              {quality.read_failed ? (
                <>
                  The A09 records could not be read back, so nothing below was verified. This is
                  not a clean bill of health — it is no reading at all. Apply
                  supabase/migrations/00010_data_quality.sql, or check that the database is
                  reachable.{" "}
                </>
              ) : null}
              {quality.findings_write_failed + quality.quarantines_write_failed > 0 ? (
                <>
                  A09 lost {quality.findings_write_failed} finding write(s) and{" "}
                  {quality.quarantines_write_failed} quarantine write(s) this process. The numbers
                  below are incomplete — read them as &quot;unknown&quot;, not as &quot;clean&quot;.
                </>
              ) : null}
            </span>
          </p>
        ) : null}
        {/*
          A dash, never a zero, when the read failed. "0 critical open" and
          "we could not look" are opposite facts and must not render alike.
        */}
        <div className="grid3" style={{ marginTop: 8 }}>
          <Stat
            label="Critical open"
            value={quality.read_failed ? "—" : quality.critical_open}
            hint={
              quality.read_failed
                ? "could not be read"
                : `${quality.critical_open_7d} in 7d · ${quality.critical_open_30d} in 30d`
            }
          />
          <Stat
            label="Unresolved"
            value={quality.read_failed ? "—" : quality.unresolved_total}
            hint={
              quality.read_failed
                ? "could not be read"
                : `${quality.unresolved_mismatches} of ${quality.mismatches_total} reconciliation mismatches`
            }
          />
          <Stat
            label="Quarantined"
            value={quality.read_failed ? "—" : quality.quarantined_active}
            hint={
              quality.read_failed
                ? "could not be read"
                : "held out of KPI counts · nothing deleted · still served to the customer"
            }
          />
        </div>
        {queue.length === 0 ? (
          <p className="hint" style={{ color: "var(--on-dark-mute)", marginTop: 12 }}>
            {quality.could_not_verify
              ? "No findings could be read back."
              : "No unresolved data-quality findings."}
          </p>
        ) : (
          <div style={{ overflowX: "auto", marginTop: 12 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".85rem" }}>
              <thead>
                <tr className="mono" style={{ textAlign: "left", color: "var(--on-dark-mute)" }}>
                  <th style={{ padding: "6px 8px" }}>Severity</th>
                  <th style={{ padding: "6px 8px" }}>Rule</th>
                  <th style={{ padding: "6px 8px" }}>Entity</th>
                  <th style={{ padding: "6px 8px" }}>Code</th>
                  <th style={{ padding: "6px 8px" }}>Suspected owner</th>
                  <th style={{ padding: "6px 8px" }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {queue.map((f) => (
                  <tr key={f.issue_id} style={{ borderTop: "1px solid var(--line-d)" }}>
                    <td style={{ padding: "6px 8px" }}>
                      <span
                        className={`pill ${
                          f.severity === "critical" || f.severity === "high"
                            ? "pill-amber"
                            : "pill-green"
                        }`}
                      >
                        {f.severity}
                      </span>
                    </td>
                    <td className="mono" style={{ padding: "6px 8px" }}>{f.rule_id}</td>
                    <td className="mono" style={{ padding: "6px 8px" }}>
                      {f.entity_type}:{f.entity_id}
                    </td>
                    <td className="mono" style={{ padding: "6px 8px" }}>{f.detail_code}</td>
                    <td className="mono" style={{ padding: "6px 8px" }}>
                      {/* Never a guess: null means the ledger did not support naming one. */}
                      {f.root_hypothesis.suspected_owner ?? "unattributed"}
                    </td>
                    <td className="mono" style={{ padding: "6px 8px" }}>{f.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="hint" style={{ color: "var(--on-dark-mute)", marginTop: 8 }}>
              Repairs a human must decide on appear in{" "}
              <Link href="/admin/approvals">the Approval Center</Link>.
            </p>
          </div>
        )}
      </div>

      <div className="grid2" style={{ marginBottom: 30 }}>
        <div className="cell">
          <span className="tag">Door machine agents</span>
          {liveAgents.map((a) => (
            <p key={a.agent_id} style={{ marginBottom: 8 }}>
              <strong>
                {a.agent_id} {a.name}
              </strong>{" "}
              {/* A00 migration: the registry's old `stage` field is now `status`
                  (same values) — this renders the identical string as before. */}
              <span className="pill pill-green">{a.status}</span>
              <br />
              <span style={{ color: "var(--on-dark-mute)", fontSize: ".9rem" }}>{a.mandate}</span>
            </p>
          ))}
        </div>
        <div className="cell">
          <span className="tag">What is NOT live (by design)</span>
          <ul style={{ paddingLeft: 20, color: "var(--on-dark-mute)" }}>
            <li>
              DataForSEO live discovery — awaiting owner credentials (research shown is your seed
              workbook, scored by A04)
            </li>
            <li>Model-written page copy + AI critic — awaiting OpenAI key (content bank v1 in use)</li>
            <li>Public serving of doors — master switch OFF until launch gate</li>
            <li>Trust Network, provider recommendation, Customer Lite — later waves</li>
          </ul>
        </div>
      </div>

      <div className="grid3">
        <Link href="/admin/opportunities" className="cell" style={{ textDecoration: "none" }}>
          <span className="tag">Next →</span>
          <strong>Review search opportunities</strong>
          <p className="hint" style={{ color: "var(--on-dark-mute)" }}>
            What A04 found and how it scored it.
          </p>
        </Link>
        <Link href="/admin/pages" className="cell" style={{ textDecoration: "none" }}>
          <span className="tag">Next →</span>
          <strong>Approve pages</strong>
          <p className="hint" style={{ color: "var(--on-dark-mute)" }}>
            Preview staged doors, see QA, publish.
          </p>
        </Link>
        <Link href="/admin/controls" className="cell" style={{ textDecoration: "none" }}>
          <span className="tag">Next →</span>
          <strong>Page-creator controls</strong>
          <p className="hint" style={{ color: "var(--on-dark-mute)" }}>
            National vs local, quotas, thresholds, budgets.
          </p>
        </Link>
      </div>
    </div>
  );
}
