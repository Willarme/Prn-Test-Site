import { adminGate } from "@/components/admin/AdminGate";
import { ReconciliationRun } from "@/components/admin/ReconciliationRun";
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
    <div className="stat-card">
      <span className="stat-label">{label}</span>
      <div className="stat-value">{value}</div>
      {hint && <p className="stat-hint">{hint}</p>}
    </div>
  );
}

/**
 * CANON 14A §17 — the Company OS Lite area map. Every admin area the build
 * guide names, and where it lives today. A name with no trial surface yet
 * says so ("later wave") rather than linking to something that does not
 * exist: the admin never pretends.
 */
const COVERAGE: Array<{ area: string; href?: string; note?: string }> = [
  { area: "Requests", href: "/admin/requests" },
  { area: "Search / Opportunities", href: "/admin/opportunities" },
  { area: "Pages", href: "/admin/pages" },
  { area: "Controls", href: "/admin/controls", note: "page-creator policy" },
  { area: "Approvals", href: "/admin/approvals" },
  { area: "Agents", href: "/admin/agents" },
  { area: "Kill switches + flags + AI", href: "/admin/system" },
  { area: "Data + Metrics · A09", href: "/admin", note: "cockpit section" },
  { area: "Trust", note: "later wave" },
  { area: "Customers / Homes", note: "later wave" },
  { area: "Provider Match Review", note: "later wave" },
  { area: "Providers Lite", note: "later wave" },
  { area: "Templates + Prompts", note: "later wave" },
  { area: "Consent / Disclosures", note: "later wave" },
  { area: "Provenance / Rights", note: "later wave" },
  { area: "Public Derivation", note: "later wave" },
  { area: "AI Readiness · A36", note: "later wave" },
  { area: "Transition Watch · A25", note: "later wave" },
  { area: "Idea Vault / Lean · A10", note: "later wave" },
  { area: "External Agents", note: "later wave" },
  { area: "Actions", note: "later wave" },
];

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
      <div className="adm-topline">
        <div>
          <div className="eyebrow">Company OS Lite · trial cockpit</div>
          <h1 className="d2" style={{ marginBottom: 6 }}>
            Where the machine stands
          </h1>
          <p className="hint" style={{ color: "var(--on-dark-mute)" }}>
            {store.kind === "supabase" ? (
              <span className="pill pill-green">Supabase database — permanent</span>
            ) : (
              <span className="pill pill-amber">local file — temporary until the database is connected</span>
            )}
          </p>
        </div>
      </div>

      <div className="grid3" style={{ marginBottom: 26 }}>
        <Stat
          label="Search opportunities"
          value={opps.summary.total}
          hint={`${opps.summary.by_recommendation.NEW ?? 0} NEW · ${opps.summary.by_recommendation.WATCH ?? 0} WATCH · ${opps.summary.by_recommendation.MERGE ?? 0} MERGE · your decisions in Search opportunities`}
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
          hint="metrics unknown until discovery runs"
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
      <div className="adm-card" style={{ marginBottom: 26 }}>
        <div className="adm-card-head">
          <span className="stat-label">Data quality · A09</span>
          {/*
            THE TRIGGER (T1-03 clause 3, second half). `runReconciliation()`
            had no caller anywhere outside tests, so the reconciliation sweeps
            had never run against real data. This button is that caller, and it
            lives HERE rather than on a new screen for the same reason the rest
            of this section does: canon says A09's findings surface in the
            cockpit and A09 gets no dashboard of its own.

            IT IS A BUTTON, NOT A CADENCE, and the difference is not cosmetic.
            Nothing schedules this pass; an owner runs it. "Nightly" remains
            genuinely outstanding and eval row T1-03.3 still says so.
          */}
          <ReconciliationRun />
        </div>
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
          <p className="stat-hint" style={{ marginTop: 12 }}>
            {quality.could_not_verify
              ? "No findings could be read back."
              : "No unresolved data-quality findings."}
          </p>
        ) : (
          <div style={{ overflowX: "auto", marginTop: 12 }}>
            <table className="adm-table">
              <thead>
                <tr>
                  <th>Severity</th>
                  <th>Rule</th>
                  <th>Entity</th>
                  <th>Code</th>
                  <th>Suspected owner</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {queue.map((f) => (
                  <tr key={f.issue_id}>
                    <td>
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
                    <td className="mono">{f.rule_id}</td>
                    <td className="mono">
                      {f.entity_type}:{f.entity_id}
                    </td>
                    <td className="mono">{f.detail_code}</td>
                    <td className="mono">
                      {/* Never a guess: null means the ledger did not support naming one. */}
                      {f.root_hypothesis.suspected_owner ?? "unattributed"}
                    </td>
                    <td className="mono">{f.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="stat-hint" style={{ marginTop: 8 }}>
              Repairs a human must decide on appear in{" "}
              <Link href="/admin/approvals">the Approval Center</Link>.
            </p>
          </div>
        )}
      </div>

      <div className="grid2" style={{ marginBottom: 26 }}>
        <div className="adm-card">
          <div className="adm-card-head">
            <span className="stat-label">Door machine agents</span>
            <Link href="/admin/agents" className="hint" style={{ color: "var(--pink)" }}>
              Full roster →
            </Link>
          </div>
          {liveAgents.map((a) => (
            <p key={a.agent_id} style={{ marginBottom: 10 }}>
              <span className="health-dot hd-green" aria-hidden />
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
        <div className="adm-card">
          <div className="adm-card-head">
            <span className="stat-label">What is NOT live (by design)</span>
            <Link href="/admin/system" className="hint" style={{ color: "var(--pink)" }}>
              Switches →
            </Link>
          </div>
          <ul style={{ paddingLeft: 20, color: "var(--on-dark-mute)", fontSize: ".9rem", lineHeight: 1.7 }}>
            <li>
              Live discovery — awaiting owner credentials for the discovery vendor (research shown
              is your seed workbook, scored by A04)
            </li>
            <li>
              AI engine — ON in THIS environment by owner directive (runtime policy doc); a fresh
              deployment still ships all-off until its own owner writes the policy
            </li>
            <li>Trust Network, provider recommendation, Customer Lite — later waves (code not yet built)</li>
          </ul>
        </div>
      </div>

      <div className="adm-card" style={{ marginBottom: 26 }}>
        <div className="adm-card-head">
          <span className="stat-label">Company OS coverage · canon 14A §17</span>
          <span className="stat-hint">every named admin area — and where it lives today</span>
        </div>
        <div className="cover-grid">
          {COVERAGE.map((c) =>
            c.href ? (
              <Link key={c.area} href={c.href} className="cover-item">
                <span>
                  {c.area}
                  {c.note ? <span style={{ color: "var(--on-dark-faint)" }}> · {c.note}</span> : null}
                </span>
                <span className="cover-live">LIVE</span>
              </Link>
            ) : (
              <div key={c.area} className="cover-item" style={{ opacity: 0.62 }}>
                <span>{c.area}</span>
                <span className="cover-later">{c.note?.toUpperCase() ?? "LATER WAVE"}</span>
              </div>
            )
          )}
        </div>
      </div>

      <div className="grid3">
        <Link href="/admin/opportunities" className="stat-card" style={{ textDecoration: "none" }}>
          <span className="stat-label">Next →</span>
          <strong style={{ color: "var(--on-dark)" }}>Review search opportunities</strong>
          <p className="stat-hint">What A04 found and how it scored it.</p>
        </Link>
        <Link href="/admin/pages" className="stat-card" style={{ textDecoration: "none" }}>
          <span className="stat-label">Next →</span>
          <strong style={{ color: "var(--on-dark)" }}>Approve pages</strong>
          <p className="stat-hint">Preview staged doors, see QA, publish.</p>
        </Link>
        <Link href="/admin/system" className="stat-card" style={{ textDecoration: "none" }}>
          <span className="stat-label">Next →</span>
          <strong style={{ color: "var(--on-dark)" }}>System &amp; safety</strong>
          <p className="stat-hint">Flags, AI policy, kill switches, spend.</p>
        </Link>
      </div>
    </div>
  );
}
