import { adminGate } from "@/components/admin/AdminGate";
import { TRIAL_AGENT_REGISTRY } from "@/platform/agents/registry";
import type { AgentDefinition } from "@/platform/agents/contracts";

export const dynamic = "force-dynamic";

/**
 * THE AGENT ROSTER — every registered agent in the trial platform, from the
 * same registry the gateway enforces at call time. This is a mirror, not a
 * second source: nothing here can say an agent is live when the registry
 * says otherwise, because it renders the registry's own records.
 *
 * IDS AND KNOBS ONLY. Mandates, budgets, capability keys, schedule strings —
 * no customer data exists in the registry, so none can appear here.
 */

const PHASE_BANDS = ["FOUNDATION", "TRIAL", "PHASE2", "LATER", "TBD"] as const;

const BAND_BLURB: Record<string, string> = {
  FOUNDATION: "Shared platform — every other agent stands on these",
  TRIAL: "The Black Car trial's working agents",
  PHASE2: "Built for the trial, activated in a later phase",
  LATER: "Specified in canon, not yet built",
  TBD: "Canon has not assigned a phase band yet — never a guess",
};

function statusTone(status: string): "green" | "amber" | "neutral" {
  if (["LIVE", "LITE_LIVE", "MINIMAL_LIVE"].includes(status)) return "green";
  if (["TEST_ONLY", "SKELETON_LIVE", "HARNESS_NOW"].includes(status)) return "amber";
  return "neutral";
}

function healthClass(health?: "green" | "amber" | "red"): string {
  if (health === "green") return "hd-green";
  if (health === "amber") return "hd-amber";
  if (health === "red") return "hd-red";
  return "hd-none";
}

function AgentCard({ a }: { a: AgentDefinition }) {
  const tone = statusTone(a.status);
  const budgets: string[] = [];
  if (a.budgets.ai_api_dollars_per_day !== undefined)
    budgets.push(`AI $${a.budgets.ai_api_dollars_per_day}/day (TEST)`);
  if (a.budgets.contacts_per_day !== undefined) budgets.push(`${a.budgets.contacts_per_day} contacts/day`);
  if (a.budgets.page_publishes_per_day !== undefined)
    budgets.push(`${a.budgets.page_publishes_per_day} publishes/day`);
  if (a.budgets.db_writes_per_run !== undefined) budgets.push(`${a.budgets.db_writes_per_run} DB writes/run`);
  if (a.budgets.max_retries !== undefined) budgets.push(`max ${a.budgets.max_retries} retries`);

  return (
    <div className="agent-card">
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span className={`health-dot ${healthClass(a.health)}`} aria-hidden />
        <span className="agent-id">{a.agent_id}</span>
        <strong style={{ color: "var(--on-dark)" }}>{a.name}</strong>
        <span
          className={`pill ${tone === "green" ? "pill-green" : tone === "amber" ? "pill-amber" : ""}`}
          style={tone === "neutral" ? { background: "rgba(255,46,126,.12)", color: "var(--pink)" } : undefined}
        >
          {a.status}
        </span>
      </div>

      <p style={{ fontSize: ".88rem", color: "var(--on-dark)", margin: 0 }}>{a.mandate}</p>

      <div className="agent-meta">
        <span>
          Autonomy <b>{a.autonomy_level}</b>
        </span>
        <span>
          Layer <b>{a.owner_layer}</b>
        </span>
        <span>
          Data reads <b>{a.data_access.length}</b>
        </span>
        <span>
          Writes <b>{a.write_access.length}</b>
        </span>
        {a.schedule ? (
          <span>
            Schedule <b>{a.schedule}</b>
          </span>
        ) : (
          <span>
            Schedule <b>none — owner-triggered</b>
          </span>
        )}
        <span>
          Policy <b>v{a.policy_version}</b>
        </span>
      </div>

      {budgets.length > 0 ? (
        <div>
          {budgets.map((b) => (
            <span key={b} className="adm-chip">
              {b}
            </span>
          ))}
        </div>
      ) : null}

      {a.allowed_capabilities.length > 0 ? (
        <div>
          {a.allowed_capabilities.map((c) => (
            <span key={c} className="adm-chip">
              {c}
            </span>
          ))}
        </div>
      ) : null}

      <p className="stat-hint" style={{ margin: 0 }}>
        Kill switch ref <span className="mono">{a.kill_switch_ref}</span>
        {a.eval_suite_ref ? (
          <>
            {" · "}evals <span className="mono">{a.eval_suite_ref}</span>
          </>
        ) : null}
      </p>
    </div>
  );
}

export default async function AdminAgents() {
  const gate = await adminGate();
  if (gate) return gate;

  const byBand = new Map<string, AgentDefinition[]>();
  for (const band of PHASE_BANDS) byBand.set(band, []);
  for (const a of TRIAL_AGENT_REGISTRY) {
    byBand.get(a.phase_band)?.push(a);
  }
  for (const list of byBand.values()) {
    list.sort((x, y) => x.agent_id.localeCompare(y.agent_id));
  }

  const live = TRIAL_AGENT_REGISTRY.filter((a) => statusTone(a.status) === "green").length;
  const building = TRIAL_AGENT_REGISTRY.filter((a) => statusTone(a.status) === "amber").length;

  return (
    <div>
      <div className="adm-topline">
        <div>
          <div className="eyebrow">Machine · agent registry</div>
          <h1 className="d2" style={{ marginBottom: 6 }}>
            The roster
          </h1>
          <p className="hint" style={{ color: "var(--on-dark-mute)" }}>
            {TRIAL_AGENT_REGISTRY.length} registered agents · {live} live · {building} in test/skeleton ·
            rendered from the same registry the gateway enforces — never a second copy.
          </p>
        </div>
      </div>

      {PHASE_BANDS.map((band) => {
        const list = byBand.get(band) ?? [];
        if (list.length === 0) return null;
        return (
          <section key={band} style={{ marginBottom: 30 }}>
            <div className="adm-card-head" style={{ marginBottom: 10 }}>
              <span className="stat-label">
                {band} · {list.length}
              </span>
              <span className="stat-hint">{BAND_BLURB[band]}</span>
            </div>
            <div className="agent-grid">
              {list.map((a) => (
                <AgentCard key={a.agent_id} a={a} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
