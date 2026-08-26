import { adminGate } from "@/components/admin/AdminGate";
import { DEFAULT_FLAGS } from "@/platform/flags";
import { aiPolicyStore } from "@/platform/ai/policy-store";
import { AI_CAPABILITY_KEYS } from "@/platform/ai/policy";
import { listKillSwitches } from "@/platform/killswitch";
import { CAPABILITY_REGISTRY } from "@/platform/capabilities/registry";
import { spendLedger } from "@/platform/ai/spend";
import { KillSwitchControl } from "@/components/admin/KillSwitchControl";

export const dynamic = "force-dynamic";

/**
 * SYSTEM & SAFETY — the switches that govern the machine, on ONE page:
 *
 *   1. feature flags            (what the site serves at all)
 *   2. the AI engine            (master + per-capability policy, spend today)
 *   3. kill switches            (the platform's own list, with real controls)
 *   4. the capability registry  (what the agents may call, and its fallbacks)
 *
 * Everything here renders the LIVE store — the same objects the gateway and
 * the routes read — so the page cannot drift from what actually governs
 * behaviour. Nothing is invented: a store that reads empty renders empty.
 */
export default async function AdminSystem() {
  const gate = await adminGate();
  if (gate) return gate;

  const policy = await aiPolicyStore().getActive();
  const spend = spendLedger();
  const today = await spend.read(new Date().toISOString().slice(0, 10));
  // Only GLOBAL and AGENT are operative in Wave 0; the other scope values are
  // reserved by the schema, so a future scope renders but offers no control.
  const switches = Array.from(listKillSwitches().entries())
    .map(([key, s]) => ({ key, ...s, scope: s.scope as "GLOBAL" | "AGENT" }))
    .filter((s) => s.scope === "GLOBAL" || s.scope === "AGENT");

  return (
    <div>
      <div className="adm-topline">
        <div>
          <div className="eyebrow">Machine · system &amp; safety</div>
          <h1 className="d2" style={{ marginBottom: 6 }}>
            Every switch in one room
          </h1>
          <p className="hint" style={{ color: "var(--on-dark-mute)" }}>
            Feature flags, the AI engine, kill switches and the capability registry — the live
            stores, not copies of them.
          </p>
        </div>
      </div>

      {/* 1 — FEATURE FLAGS */}
      <section className="adm-card" style={{ marginBottom: 26 }}>
        <div className="adm-card-head">
          <span className="stat-label">Feature flags · what the site serves</span>
          <span className="stat-hint">shipped defaults; each flips only at its wave gate</span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="adm-table">
            <thead>
              <tr>
                <th>Flag</th>
                <th>State</th>
                <th>What it gates</th>
                <th>Decision</th>
              </tr>
            </thead>
            <tbody>
              {DEFAULT_FLAGS.map((f) => (
                <tr key={f.flag_key}>
                  <td className="mono">{f.flag_key}</td>
                  <td>
                    <span className={`pill ${f.enabled ? "pill-green" : "pill-off"}`}>
                      {f.enabled ? "ON" : "OFF"}
                    </span>
                  </td>
                  <td style={{ color: "var(--on-dark-mute)" }}>{f.description}</td>
                  <td className="mono" style={{ color: "var(--on-dark-faint)" }}>
                    {f.decision_ref ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* 2 — THE AI ENGINE */}
      <section className="adm-card" style={{ marginBottom: 26 }}>
        <div className="adm-card-head">
          <span className="stat-label">AI engine · master + per-capability policy</span>
          <span className={`pill ${policy.enabled ? "pill-green" : "pill-off"}`}>
            MASTER {policy.enabled ? "ON" : "OFF"}
          </span>
        </div>
        <p className="stat-hint" style={{ marginBottom: 12 }}>
          A model call happens only when the master AND the capability flag are both on — the same
          two-key rule the gateway enforces. Every figure below is a TEST figure, not a vendor quote.
        </p>
        <div style={{ overflowX: "auto" }}>
          <table className="adm-table">
            <thead>
              <tr>
                <th>Capability</th>
                <th>Enabled</th>
                <th>Model</th>
                <th>Max $/call</th>
                <th>Daily cap</th>
              </tr>
            </thead>
            <tbody>
              {AI_CAPABILITY_KEYS.map((key) => {
                const cap = policy.capabilities[key];
                if (!cap) return null;
                return (
                  <tr key={key}>
                    <td className="mono">{key}</td>
                    <td>
                      <span className={`pill ${cap.enabled ? "pill-green" : "pill-off"}`}>
                        {cap.enabled ? "ON" : "OFF"}
                      </span>
                    </td>
                    <td className="mono" style={{ color: "var(--on-dark-mute)" }}>
                      {cap.model_id}
                    </td>
                    <td className="mono">${cap.max_cost_per_call_usd}</td>
                    <td className="mono">${cap.daily_cap_usd}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="stat-hint" style={{ marginTop: 12 }}>
          Spend today:{" "}
          {today ? (
            <>
              <strong style={{ color: "var(--on-dark)" }}>${today.total_usd}</strong> across{" "}
              {today.calls} call{today.calls === 1 ? "" : "s"}
              {Object.keys(today.by_capability).length > 0 ? (
                <> · {Object.entries(today.by_capability).map(([k, v]) => `${k} $${v}`).join(", ")}</>
              ) : null}
            </>
          ) : (
            <>$0.00 — no model calls recorded today</>
          )}{" "}
          <span className="mono">(TEST)</span>
        </p>
      </section>

      {/* 3 — KILL SWITCHES */}
      <section className="adm-card" style={{ marginBottom: 26 }}>
        <div className="adm-card-head">
          <span className="stat-label">Kill switches · the stop-everything control</span>
          <span className="stat-hint">engaging takes effect on the very next gateway check</span>
        </div>
        {switches.length === 0 ? (
          <p className="stat-hint">
            No switch has ever been thrown — the platform is running with every circuit closed. Use
            the GLOBAL switch below to stop all agent action at the gateway, or an AGENT switch to
            stop one agent.
          </p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="adm-table">
              <thead>
                <tr>
                  <th>Switch</th>
                  <th>Scope</th>
                  <th>State</th>
                  <th>By</th>
                  <th>Reason</th>
                  <th>Control</th>
                </tr>
              </thead>
              <tbody>
                {switches.map((s) => (
                  <tr key={s.key}>
                    <td className="mono">{s.key}</td>
                    <td className="mono">{s.scope}</td>
                    <td>
                      <span className={`pill ${s.engaged ? "pill-red" : "pill-green"}`}>
                        {s.engaged ? "ENGAGED" : "closed"}
                      </span>
                    </td>
                    <td className="mono" style={{ color: "var(--on-dark-mute)" }}>
                      {s.engaged_by ?? "—"}
                    </td>
                    <td style={{ color: "var(--on-dark-mute)" }}>{s.reason ?? "—"}</td>
                    <td>
                      <KillSwitchControl
                        scope={s.scope}
                        scopeRef={s.scope_ref}
                        engaged={s.engaged}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div
          style={{
            marginTop: 14,
            paddingTop: 14,
            borderTop: "1px solid var(--line-d)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <span>
            <strong style={{ color: "var(--on-dark)" }}>GLOBAL</strong>{" "}
            <span style={{ color: "var(--on-dark-mute)", fontSize: ".85rem" }}>
              — stops every agent, capability and publish at the gateway
            </span>
          </span>
          <KillSwitchControl scope="GLOBAL" engaged={false} />
        </div>
      </section>

      {/* 4 — CAPABILITY REGISTRY */}
      <section className="adm-card">
        <div className="adm-card-head">
          <span className="stat-label">Capability registry · what agents may call</span>
          <span className="stat-hint">
            {CAPABILITY_REGISTRY.length} registered capabilities · vendor-neutral seams
          </span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="adm-table">
            <thead>
              <tr>
                <th>Capability</th>
                <th>Risk</th>
                <th>Status</th>
                <th>Current implementation</th>
                <th>Owners</th>
              </tr>
            </thead>
            <tbody>
              {CAPABILITY_REGISTRY.map((c) => (
                <tr key={c.capability_key}>
                  <td className="mono">{c.capability_key}</td>
                  <td className="mono">{c.risk_class}</td>
                  <td>
                    <span className={`pill ${c.status === "LIVE" ? "pill-green" : "pill-off"}`}>
                      {c.status}
                    </span>
                  </td>
                  <td style={{ color: "var(--on-dark-mute)", fontSize: ".82rem" }}>
                    {c.current_implementation ? (
                      <>
                        <span className="mono">{c.current_implementation}</span>
                        {c.alternate_implementations?.length ? (
                          <span style={{ color: "var(--on-dark-faint)" }}>
                            {" "}
                            · model path behind{" "}
                            <span className="mono">{c.alternate_implementations[0].enabled_policy_key}</span>
                          </span>
                        ) : null}
                      </>
                    ) : (
                      <span style={{ color: "var(--on-dark-faint)" }}>scaffolded — schema only</span>
                    )}
                  </td>
                  <td className="mono" style={{ color: "var(--on-dark-mute)" }}>
                    {(c.owning_agent_ids ?? []).join(", ") || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
