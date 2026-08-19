import Link from "next/link";
import { loadOpportunities, allStagedSpecs, publishedPageIds } from "@/platform/admin/data";
import { runtimeStore } from "@/platform/stores/runtime";
import { DEFAULT_FLAGS } from "@/platform/flags";
import { TRIAL_AGENT_REGISTRY } from "@/platform/agents/registry";

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
  const opps = loadOpportunities();
  const store = runtimeStore();
  const [staged, published, totals, safetyTriggers] = await Promise.all([
    allStagedSpecs(),
    publishedPageIds(),
    store.totals(),
    store.countEvents("safety.triggered"),
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
          hint={`${totals.packets} packets · ${totals.consents} consent events`}
        />
        <Stat label="Safety triggers" value={safetyTriggers} hint="deterministic gate, before analysis" />
        <Stat
          label="Needs vendor enrichment"
          value={opps.summary.needs_enrichment}
          hint="metrics unknown until DataForSEO runs"
        />
      </div>

      <div className="grid2" style={{ marginBottom: 30 }}>
        <div className="cell">
          <span className="tag">Door machine agents</span>
          {liveAgents.map((a) => (
            <p key={a.agent_id} style={{ marginBottom: 8 }}>
              <strong>
                {a.agent_id} {a.name}
              </strong>{" "}
              <span className="pill pill-green">{a.stage}</span>
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
