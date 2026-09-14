import Link from "next/link";
import { adminGate } from "@/components/admin/AdminGate";
import { AdminPageHeader, AdminStatus } from "@/components/admin/AdminUI";
import { KillSwitchControl } from "@/components/admin/KillSwitchControl";
import { getFeatureFlags } from "@/platform/flags";
import { aiPolicyStore } from "@/platform/ai/policy-store";
import { AI_CAPABILITY_KEYS, DEFAULT_AI_POLICY } from "@/platform/ai/policy";
import { readKillSwitchSnapshot } from "@/platform/killswitch";
import { CAPABILITY_REGISTRY } from "@/platform/capabilities/registry";
import { spendLedger, utcDay } from "@/platform/ai/spend";

export const dynamic = "force-dynamic";

function money(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 6 }).format(value);
}
function timestamp(value: string | undefined): string {
  if (!value || !Number.isFinite(Date.parse(value))) return "Not recorded";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" }).format(new Date(value)) + " UTC";
}

export default async function AdminSystem() {
  const gate = await adminGate();
  if (gate) return gate;
  const flags = await getFeatureFlags();
  const day = utcDay();
  const [policyRead, spendRead, switchRead] = await Promise.allSettled([
    Promise.resolve().then(() => aiPolicyStore().getActive()),
    Promise.resolve().then(() => spendLedger().read(day)),
    Promise.resolve().then(() => readKillSwitchSnapshot()),
  ]);
  // The current file store returns this shared default object on a missing or
  // unreadable document. That fallback is not proof of a saved policy reading.
  const policy = policyRead.status === "fulfilled" && policyRead.value !== DEFAULT_AI_POLICY ? policyRead.value : null;
  const defaultFallback = policyRead.status === "fulfilled" && policyRead.value === DEFAULT_AI_POLICY;
  const spend = spendRead.status === "fulfilled" ? spendRead.value : null;
  const switches = switchRead.status === "fulfilled" ? switchRead.value : null;
  const verified = switches?.verified === true;
  const globalState = switches?.states.find(state => state.key === "global" && state.scope === "GLOBAL");
  const agentStates = switches?.states.filter(state => state.scope === "AGENT") ?? [];
  const otherStates = switches?.states.filter(state => state.scope !== "GLOBAL" && state.scope !== "AGENT") ?? [];
  const enabledCapabilities = policy ? Object.values(policy.capabilities).filter(cap => cap.enabled).length : null;
  const policyKeys = Array.from(new Set([...AI_CAPABILITY_KEYS, ...Object.keys(policy?.capabilities ?? {})]));
  const observedAt = new Date().toISOString();

  return <div className="adm-system">
    <AdminPageHeader eyebrow="Operations / Controls and safeguards" title="System & safety" description="Read the operating policy, inspect the evidence and control the agent stop switches." meta={<>Observed {timestamp(observedAt)} · <Link href="/admin/connections">Connection details</Link></>} />
    <nav className="adm-system-index" aria-label="System sections"><a href="#kill-switches">01 Stops</a><a href="#ai-policy">02 AI policy & spend</a><a href="#feature-flags">03 Feature flags</a><a href="#capability-registry">04 Capabilities</a></nav>

    <section id="kill-switches" className={`adm-system-stop${verified && globalState?.engaged ? " adm-system-stop--engaged" : ""}`} aria-labelledby="system-stop-title">
      <div className="adm-system-stop-copy">
        <p className="adm-kicker">01 / Agent stop controls</p>
        <div className="adm-system-title-row"><h2 id="system-stop-title">Global agent stop</h2><AdminStatus tone={!verified ? "warning" : globalState?.engaged ? "danger" : "neutral"}>{!verified ? "State unverified" : globalState?.engaged ? "Engaged" : "Not engaged"}</AdminStatus></div>
        <p>Blocks new calls through the capability and model gateways. A05 generation and A06 QA also check the stop before a run.</p>
        <p className="adm-small">It does not cancel work already running, shut down the website, or block the separate owner edit and publish actions.</p>
        <div className="adm-system-evidence"><span>State source</span><strong>{switches?.source ?? "Unavailable"}</strong><span>{verified ? switches?.source === "database" ? "Fresh database reading" : "This process only · resets on restart" : "Controls are unavailable until the state can be verified."}</span></div>
        {verified && globalState?.reason && <p className="adm-system-reason"><strong>Recorded reason:</strong> {globalState.reason}<br /><span className="adm-small">{globalState.engaged_by ?? "Actor not recorded"} · {timestamp(globalState.engaged_at)}</span></p>}
      </div>
      <div className="adm-system-stop-action"><span className="adm-kicker">GLOBAL</span><KillSwitchControl scope="GLOBAL" engaged={globalState?.engaged ?? false} disabled={!verified} disabledReason="The current stop state could not be verified. Refresh this view after the connection recovers." /><p className="adm-small">A release only removes this stop. Other policy, permission and budget gates still apply.</p></div>
    </section>
    <details className="adm-system-method"><summary>How stop state reaches the gateways</summary><p>Same-process toggles update the gateway cache immediately. With a database, a gateway check starts a background refresh when the cache is older than 30 seconds; other processes see changes after a successful refresh. A failed refresh retains the earlier cache. This page waits for its own database observation.</p><p>Local file mode keeps stop state in process memory. An empty local list means no stop is currently recorded in this process, not an all-time history.</p></details>
    {agentStates.length > 0 && <section className="adm-system-section" aria-labelledby="agent-stops-title"><div className="adm-system-section-head"><h2 id="agent-stops-title">Individual agent stops</h2><span className="adm-small">{verified ? "Current observed states" : "Cached observations · unverified"}</span></div><div className="adm-table-scroll" role="region" aria-label="Individual agent stop states" tabIndex={0}><table><thead><tr><th scope="col">Agent</th><th scope="col">Observed state</th><th scope="col">Recorded reason</th><th scope="col">Control</th></tr></thead><tbody>{agentStates.map(state => <tr key={state.key}><td className="mono">{state.scope_ref ?? state.key}</td><td><AdminStatus tone={!verified ? "warning" : state.engaged ? "danger" : "neutral"}>{!verified ? "Unverified" : state.engaged ? "Engaged" : "Not engaged"}</AdminStatus></td><td>{verified ? state.reason ?? "No reason recorded" : "Verify the source before relying on cached details."}{verified && <div className="adm-small">{state.engaged_by ?? "Actor not recorded"} · {timestamp(state.engaged_at)}</div>}</td><td><KillSwitchControl scope="AGENT" scopeRef={state.scope_ref} engaged={state.engaged} disabled={!verified || !state.scope_ref} disabledReason="A verified agent identity and stop state are required." /></td></tr>)}</tbody></table></div></section>}
    {otherStates.length > 0 && <p className="adm-small">{otherStates.length} recorded switch scope(s) have no implemented control in this console.</p>}

    <section id="ai-policy" className="adm-system-section" aria-labelledby="ai-policy-title">
      <div className="adm-system-section-head"><div><p className="adm-kicker">02 / AI operating envelope</p><h2 id="ai-policy-title">Policy and recorded spend</h2></div><AdminStatus tone={policy ? "neutral" : "warning"}>{policy ? `Policy v${policy.version}` : "Saved policy unverified"}</AdminStatus></div>
      <p className="adm-system-intro">Master and capability flags must both be enabled before a model call is eligible. Permissions, customer-data rules, stop switches and budget admission still apply. An enabled policy is not evidence of a successful model call.</p>
      <div className="adm-system-readings">
        <div><span className="adm-kicker">Master policy</span><strong className="adm-system-reading">{policy ? policy.enabled ? "Enabled" : "Disabled" : "Unknown"}</strong><p>{policy ? `${enabledCapabilities} capability flag(s) enabled · effective ${timestamp(policy.effective_from)}` : defaultFallback ? "The gateway returned disabled defaults; the saved policy was not verified." : "The active policy could not be read."}</p></div>
        <div><span className="adm-kicker">Recorded spend / {day} UTC</span><strong className="adm-system-reading">{spend ? money(spend.total_usd) : "Unknown"}</strong><p>{spend ? `${spend.calls} recorded billed call(s) · TEST accounting figure` : "No spending reading is available. This does not establish zero spend."}</p></div>
        <div><span className="adm-kicker">Configured daily limit</span><strong className="adm-system-reading">{policy ? money(policy.global_daily_budget_usd) : "Unknown"}</strong><p>{policy ? `TEST budget · ${policy.request_timeout_ms / 1000}s request timeout · up to ${policy.max_repair_retries} schema repair retries` : "A configured limit could not be verified."}</p></div>
      </div>
      <p className="adm-small">Spend is the settled amount recorded by this environment’s ledger, not a vendor invoice or a remaining-budget calculation. Pending and uncertain call reservations also affect admission. A serverless file ledger is per instance.</p>
      <div className="adm-table-scroll" role="region" aria-label="AI capability policy" tabIndex={0}><table><thead><tr><th scope="col">Capability</th><th scope="col">Policy state</th><th scope="col">Model</th><th scope="col">Per-call limit</th><th scope="col">Daily limit</th><th scope="col">Output tokens</th><th scope="col">Recorded today</th></tr></thead><tbody>{policyKeys.map(key => {
        const cap = policy?.capabilities[key];
        return <tr key={key}><td className="mono">{key}</td><td><AdminStatus tone={!policy ? "warning" : "neutral"}>{!policy ? "Unknown" : !cap ? "Not configured" : !cap.enabled ? "Disabled" : policy.enabled ? "Enabled by policy" : "Master disabled"}</AdminStatus></td><td className="mono">{cap?.model_id ?? "Unknown"}</td><td>{cap ? money(cap.max_cost_per_call_usd) : "—"}</td><td>{cap ? money(cap.daily_cap_usd) : "—"}</td><td className="mono">{cap?.max_output_tokens ?? "—"}</td><td>{spend ? money(spend.by_capability[key] ?? 0) : "Unknown"}</td></tr>;
      })}</tbody></table></div>
      <p className="adm-small">Budget and PRN-derived cost figures are TEST-labeled. Model IDs are configured routes. <Link href="/admin/audit">Inspect actual run receipts</Link> for recorded outcomes and cost provenance.</p>
    </section>

    <section id="feature-flags" className="adm-system-section" aria-labelledby="feature-flags-title"><div className="adm-system-section-head"><div><p className="adm-kicker">03 / Serving configuration</p><h2 id="feature-flags-title">Feature flags</h2></div><AdminStatus>Current feature state and integration gates</AdminStatus></div><p className="adm-system-intro">Surface flags reflect the persisted feature registry. Unavailable state is off. Integration and spending switches retain their separate gates; no flag alone proves a complete or healthy product flow.</p><div className="adm-table-scroll" role="region" aria-label="Feature flag configuration" tabIndex={0}><table><thead><tr><th scope="col">Flag</th><th scope="col">State</th><th scope="col">Recorded purpose</th><th scope="col">Decision reference</th></tr></thead><tbody>{flags.map(flag => <tr key={flag.flag_key}><td className="mono">{flag.flag_key}</td><td><AdminStatus>{flag.enabled ? "On" : "Off"}</AdminStatus></td><td>{flag.description}</td><td className="mono">{flag.decision_ref ?? "Not recorded"}</td></tr>)}</tbody></table></div></section>

    <section id="capability-registry" className="adm-system-section" aria-labelledby="capability-registry-title"><div className="adm-system-section-head"><div><p className="adm-kicker">04 / Registered operations</p><h2 id="capability-registry-title">Capability registry</h2></div><AdminStatus>{CAPABILITY_REGISTRY.length} declarations</AdminStatus></div><p className="adm-system-intro">Declared contracts, bindings and permissions. Registry status is configuration; successful execution requires a run receipt. A reserved contract can exist without an executable implementation.</p><div className="adm-system-capabilities">{CAPABILITY_REGISTRY.map(capability => <details key={capability.capability_key} className="adm-system-capability"><summary><span><strong>{capability.capability_key}</strong><small>{capability.current_implementation ?? "No implementation binding recorded"}</small></span><span className="adm-system-capability-tags"><AdminStatus>{capability.risk_class}</AdminStatus><AdminStatus>{capability.status}</AdminStatus><span aria-hidden>+</span></span></summary><div className="adm-system-capability-body"><dl><div><dt>Version</dt><dd>{capability.version}</dd></div><div><dt>Owning agents</dt><dd>{capability.owning_agent_ids?.join(", ") || "Not declared"}</dd></div><div><dt>Required scopes</dt><dd>{capability.required_scopes.join(", ") || "None declared"}</dd></div><div><dt>Aliases</dt><dd>{capability.aliases?.join(", ") || "None declared"}</dd></div><div><dt>Input contract</dt><dd>{capability.input_schema_ref}</dd></div><div><dt>Output contract</dt><dd>{capability.output_schema_ref}</dd></div><div><dt>Implementation reference</dt><dd>{capability.implementation_ref ?? "Not declared"}</dd></div></dl>{capability.alternate_implementations?.map((alternate, index) => <div className="adm-system-alternate" key={index}><strong>Alternate {alternate.kind} path</strong><p>{alternate.ref}</p><dl><div><dt>Policy key</dt><dd>{alternate.enabled_policy_key}</dd></div><div><dt>Handles customer data</dt><dd>{alternate.handles_customer_data ? "Yes · customer-data policy applies" : "No, as declared"}</dd></div><div><dt>Fallback</dt><dd>{alternate.falls_back_to}</dd></div></dl></div>)}</div></details>)}</div></section>
  </div>;
}
