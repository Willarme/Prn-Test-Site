import Link from "next/link";
import { notFound } from "next/navigation";
import { adminGate } from "@/components/admin/AdminGate";
import { AdminEmptyState, AdminPageHeader, AdminStatus } from "@/components/admin/AdminUI";
import { requestStatusLabel } from "@/domain/admin/request-view";
import { journeySafetyRule } from "@/domain/problem/journey-safety";
import { readAdminRequestDetail } from "@/platform/admin/request-inspection";
import { runtimeStore } from "@/platform/stores/runtime";
import styles from "./inspection.module.css";

export const dynamic = "force-dynamic";

function Lines({ values, empty = "None recorded." }: { values: string[]; empty?: string }) {
  return values.length ? <ul>{values.map((value, index) => <li key={index}>{value}</li>)}</ul> : <p className="adm-small">{empty}</p>;
}

export default async function RequestInspection({ params }: { params: Promise<{ request_id: string }> }) {
  const gate = await adminGate();
  if (gate) return gate;
  const { request_id } = await params;
  if (!/^[A-Za-z0-9_-]{1,180}$/.test(request_id)) notFound();
  let record: Awaited<ReturnType<typeof readAdminRequestDetail>>;
  try {
    record = await readAdminRequestDetail(runtimeStore(), request_id);
  } catch {
    return <><AdminPageHeader eyebrow="Operate / Request inspection" title="This record needs a fresh reading" actions={<Link href="/admin/requests" className="btn btn-ghost">All requests</Link>} />
      <AdminEmptyState title="Record or safety evidence unavailable">The current record could not be verified. Its packet is withheld until a complete reading succeeds. Reload to retry.</AdminEmptyState></>;
  }
  if (!record) notFound();
  const { journey, evidence, answers, diagnosis, claims, derivations } = record;
  const { problem, session, packet } = journey;
  const safety = journeySafetyRule(problem);
  const halted = safety && !safety.intake_may_continue;
  const milestones = [
    { at: session.entered_at, label: "Request entered", detail: session.attribution.landing_path },
    ...evidence.map(item => ({ at: item.captured_at, label: `Evidence · ${item.kind.replaceAll("_", " ")}`, detail: item.evidence_id })),
    ...answers.map(item => ({ at: item.answered_at, label: `Detail recorded · ${item.label}`, detail: item.source })),
    ...diagnosis.map(item => ({ at: item.answered_at, label: `Walkthrough · ${item.label}`, detail: item.answer })),
    ...derivations.map(item => ({ at: item.created_at, label: `Derivation · ${item.method}`, detail: item.derivation_id })),
    { at: packet.generated_at, label: `Packet v${packet.packet_version} generated`, detail: packet.job_packet_id },
  ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  return <div className={styles.inspection}>
    <AdminPageHeader eyebrow="Operate / Request inspection" title="The story behind this request"
      description="Private source, recorded answers and the latest safety-adjusted packet. This view reads the record without changing the homeowner’s access."
      actions={<Link href="/admin/requests" className="btn btn-ghost">← All requests</Link>}
      meta={<><AdminStatus>Private admin inspection</AdminStatus><AdminStatus>{requestStatusLabel(problem.status)}</AdminStatus>{session.attribution.variant === "synthetic_demo" && <AdminStatus>Synthetic demo</AdminStatus>}<span className="mono">{request_id}</span></>} />
    {record.unavailable.length > 0 && <div className={styles.warning} role="status">Some readings are unavailable: {record.unavailable.join(", ")}. Empty sections below do not establish that those records never existed.</div>}
    {safety && <section className={styles.warning} aria-label="Current safety guidance"><AdminStatus tone={halted ? "danger" : "warning"}>{halted ? "Safety stop · normal packet guidance withheld" : "Safety review"}</AdminStatus><p>{safety.approved_response}</p><span className="mono">{problem.safety_rule_id}</span></section>}
    {record.conflicts.length > 0 && <section className={styles.warning} aria-label="Conflicting supplied facts"><h2>Details need confirmation</h2><Lines values={record.conflicts} /><p className="adm-small">The earlier held value remains in the record until the homeowner explicitly confirms or edits that field.</p></section>}

    <div className={styles.columns}>
      <section className="adm-card"><div className="adm-card-head"><h2>01 / Source record</h2></div>
        <dl className={styles.facts}>
          <dt>Request</dt><dd className="mono">{request_id}</dd>
          <dt>Problem</dt><dd className="mono">{problem.problem_id}</dd>
          <dt>Entry page</dt><dd>{session.attribution.landing_path}</dd>
          <dt>Received</dt><dd><time dateTime={session.entered_at}>{session.entered_at}</time></dd>
          <dt>Category · inferred</dt><dd>{problem.service_category ?? "Not recorded"}{problem.service_category_confidence ? ` · ${problem.service_category_confidence} confidence` : ""}</dd>
          <dt>Playbook</dt><dd>{record.playbookLabel}</dd>
          <dt>Safety</dt><dd>{safety ? problem.safety_state : "No flag found in the recorded evidence"}</dd>
          <dt>Consent references</dt><dd>{session.consent_event_ids.length ? session.consent_event_ids.join(", ") : "None linked"}<p className="adm-small">References only; this inspector does not verify grant scope or disclosure wording.{session.attribution.variant === "synthetic_demo" ? " The demo fixture is not homeowner consent." : ""}</p></dd>
        </dl>
        <h3>Recorded problem summary</h3><p className={styles.preserve}>{problem.problem_summary ?? "No summary recorded."}</p>
      </section>
      <section className="adm-card"><div className="adm-card-head"><h2>02 / Details & walkthrough</h2></div>
        <h3>Intake details</h3>
        {answers.length ? <dl className={styles.answers}>{answers.map((item, index) => <div key={`${item.field_key}-${index}`}><dt>{item.label}</dt><dd>{item.value_text}<span className="adm-small">{item.source.replaceAll("_", " ")} · {item.answered_at}{item.evidence_id ? ` · ${item.evidence_id}` : ""}</span></dd></div>)}</dl> : <p className="adm-small">No intake answer rows returned.</p>}
        <h3>Walkthrough responses</h3>
        {diagnosis.length ? <dl className={styles.answers}>{diagnosis.map((item, index) => <div key={`${item.step_id}-${index}`}><dt>{item.label}</dt><dd>{item.answer}<span className="adm-small">{item.answered_at}{item.evidence_id ? ` · ${item.evidence_id}` : ""}</span></dd></div>)}</dl> : <p className="adm-small">No walkthrough answer rows returned.</p>}
      </section>
    </div>

    <section className="adm-card"><div className="adm-card-head"><h2>03 / Current packet</h2><AdminStatus tone={halted ? "warning" : "neutral"}>Version {packet.packet_version}{halted ? " · safety projection" : ""}</AdminStatus></div>
      <p className={styles.packetLead}>{packet.summary_plain}</p>
      <p className="adm-small">{packet.job_packet_id} · generated {packet.generated_at} · {packet.engine} engine{packet.model_id ? ` · ${packet.model_id}` : " · no model ID recorded"}</p>
      <div className={styles.columns}>
        <div><h3>Observed / supplied statements</h3><Lines values={packet.observed_statements} /><h3>Still unknown</h3><Lines values={packet.what_remains_unknown} /><h3>Uncertainty notes</h3><Lines values={packet.uncertainty_notes ?? []} /></div>
        <div><h3>Collected details</h3>{packet.collected_details.length ? <dl className={styles.answers}>{packet.collected_details.map((detail, index) => <div key={index}><dt>{detail.label}</dt><dd>{detail.value}<span className="adm-small">{detail.source}</span></dd></div>)}</dl> : <p className="adm-small">None in this packet version.</p>}<h3>Safety notes</h3><Lines values={packet.safety_notes ?? []} /></div>
      </div>
      {!halted && <><h3>Service inference</h3><p>{packet.likely_service_category.value ?? "Not classified"} · {packet.likely_service_category.confidence} confidence. {packet.likely_service_category.note}</p>{packet.diagnosis && <><h3>Walkthrough finding · inferred</h3><p>{packet.diagnosis.outcome_title}: {packet.diagnosis.likely_cause}</p><p>{packet.diagnosis.provider_note}</p></>}<div className={styles.columns}><div><h3>Safe preparation</h3><Lines values={packet.safe_prep_notes} /></div><div><h3>Questions for a provider</h3><Lines values={packet.questions_for_provider} /></div></div><h3>Saved call script</h3><p className={styles.preserve}>{packet.call_script}</p></>}
      <p className="adm-small">Inspection does not create a public packet or a share link. Saved packet counts and media counts do not establish that a homeowner completed intake or that media was analyzed.</p>
    </section>

    <section className="adm-card"><div className="adm-card-head"><h2>04 / Evidence & provenance</h2><AdminStatus>{evidence.length} evidence records</AdminStatus></div>
      <div className={styles.evidenceGrid}>{evidence.map(item => <details key={item.evidence_id}><summary>{item.kind.replaceAll("_", " ")} · {item.field_key ?? "original input"}<span className="adm-small">{item.captured_at}</span></summary><p className="mono">{item.evidence_id}</p>{item.text !== null ? <p className={styles.preserve}>{item.text}</p> : <p>Private media metadata only. {item.mime ?? "MIME not recorded"}{item.bytes !== null ? ` · ${item.bytes.toLocaleString("en-US")} bytes` : " · size not recorded"}.{item.kind === "voice_note" ? " Recording stored; no transcript is implied." : " Storage does not prove an AI read or a verified finding."}</p>}</details>)}</div>
      <h3>Fact claims</h3>
      {claims.length ? <div className={styles.tableScroll}><table className="adm-table"><thead><tr><th scope="col">Claim</th><th scope="col">Class / provenance</th><th scope="col">Basis / verification</th></tr></thead><tbody>{claims.map(claim => <tr key={claim.claim_id}><td>{claim.predicate}: {claim.object}<div className="adm-small">{claim.claim_id}</div></td><td>{claim.claim_class} · {claim.provenance}{claim.confidence ? ` · ${claim.confidence} confidence` : ""}<div className="adm-small">{claim.privacy_class}</div></td><td>{claim.evidence_ids.join(", ")}<div className="adm-small">Verification: {claim.verification_status ?? "not recorded"}</div></td></tr>)}</tbody></table></div> : <p className="adm-small">No fact claim rows returned.</p>}
      <h3>Derivations</h3>{derivations.length ? <ul>{derivations.map(item => <li key={item.derivation_id}>{item.method} · {item.capability_key}{item.model_id ? ` · ${item.model_id}` : " · no model"}<div className="adm-small">{item.derivation_id} · run {item.agent_run_id ?? "not recorded"} · prompt {item.prompt_version ?? "not recorded"} · policy {item.policy_version ?? "not recorded"}</div></li>)}</ul> : <p className="adm-small">No derivation rows returned.</p>}
    </section>

    <section className="adm-card"><div className="adm-card-head"><h2>05 / Record milestones</h2></div><p className="adm-small">Up to 100 milestones reconstructed from these saved records. This is not a complete delivery, provider or external-event ledger.</p><ol className={styles.timeline}>{milestones.slice(0, 100).map((item, index) => <li key={index}><time dateTime={item.at}>{item.at}</time><div><strong>{item.label}</strong><p>{item.detail}</p></div></li>)}</ol></section>
  </div>;
}
