import Link from "next/link";
import { adminGate } from "@/components/admin/AdminGate";
import { AdminEmptyState, AdminPageHeader, AdminStatus } from "@/components/admin/AdminUI";
import { DoorEvidence, DoorReviewSection, DoorTechnicalDetails, DoorUnavailableActions, DoorVersionHistory } from "@/components/admin/DoorCreatorViews";
import { loadDoorCreatorDetail } from "@/platform/admin/door-creator";

export const dynamic = "force-dynamic";
type Search = Record<string, string | string[] | undefined>;

export default async function DoorCreatorDetailPage({ params, searchParams }: { params: Promise<{ page_id: string }>; searchParams?: Promise<Search> }) {
  const gate = await adminGate();
  if (gate) return gate;
  const { page_id } = await params;
  const query = await searchParams ?? {};
  const version = Array.isArray(query.version) ? "invalid-repeated-version" : query.version;
  const data = await loadDoorCreatorDetail(page_id, version).catch(() => null);
  const actions = <Link className="btn btn-ghost" href="/admin/page-creator">← Saved pages</Link>;
  if (!data || data.status === "unavailable") return <div className="adm-door"><AdminPageHeader eyebrow="Page Creator / Review" title="Page records unavailable" actions={actions} /><AdminEmptyState title="This page could not be verified">The catalogue or saved version could not be read. No replacement version has been selected.</AdminEmptyState></div>;
  if (data.status === "not_found" || !data.page) return <div className="adm-door"><AdminPageHeader eyebrow="Page Creator / Review" title="Page or version not found" actions={actions} /><AdminEmptyState title="No matching saved record">Check the page identity and requested version. An unavailable version is not replaced with a newer one.</AdminEmptyState></div>;
  const { page, selected, input, serving } = data;
  return <div className="adm-door">
    <AdminPageHeader eyebrow="Page Creator / Version review" title={page.page_id} description={page.canonical_path} actions={actions}
      meta={<><AdminStatus>{selected ? `Reviewing version ${selected.page_version}` : "No built version selected"}</AdminStatus> <AdminStatus>{version === undefined ? "Default view: latest built version" : "Exact requested version"}</AdminStatus></>} />
    <p className="adm-door-intro">Version details come from the saved catalogue. Opening the private preview verifies the stored artifact bytes.</p>
    <div className="adm-door-summary">
      <DoorReviewSection id="reviewed-version" title="Version under review">
        {selected ? <><p className="adm-door-value">Version {selected.page_version}</p><p>{selected.mode === "fixture" ? "Synthetic fixture · not a production page" : "Live-mode candidate · not proof of publication"}</p>
          {selected.preview_href ? <a className="btn btn-ghost" href={selected.preview_href} target="_blank" rel="noopener noreferrer">Private draft preview ↗</a> : <p className="adm-small">A verified draft preview is unavailable for this version.</p>}
          <p className="adm-small">Content review only; styling and interactive walkthrough acceptance are still pending.</p></> : <p>This identity has a reservation but no built version is available to review.</p>}
      </DoorReviewSection>
      <DoorReviewSection id="current-serving" title="Current serving selection">
        {serving.status === "unavailable" ? <p role="status">Serving state could not be read. The current served version is unverified.</p> : <>
          <p className="adm-door-value">{serving.page_version === null ? "No version currently eligible to serve" : `Version ${serving.page_version}`}</p>
          <p className="adm-small">Serving guard: {serving.guard_status ?? "Not recorded"}. {serving.as_of && <>Read at <time dateTime={serving.as_of}>{serving.as_of}</time>.</>}</p>
          <p className="adm-small">This selection is separate from the version under review. It does not establish search indexing.</p></>}
      </DoorReviewSection>
    </div>
    <DoorVersionHistory data={data} />
    <DoorReviewSection id="saved-input" title="Saved input and assignments">
      {input.status !== "saved" ? <p role="status">{input.status === "missing" ? "No saved input record was found for this version." : "Saved input could not be read. Its assignments and model provenance are unverified."}</p>
        : <><dl className="adm-door-facts">{input.assignments.map((assignment, i) => <div key={`${assignment.label}-${i}`}><dt>{assignment.label}</dt><dd>{assignment.value}</dd></div>)}</dl><p><Link href="/admin/templates">Compare with the current template kit →</Link></p></>}
      <h3>Model provenance</h3>
      {input.model_status === "fixture_no_model_calls" ? <p>Synthetic fixture record: no model calls.</p>
        : input.model_status === "not_recorded" ? <p>Model provenance was not recorded. No writer or cost is inferred.</p>
          : input.model_status === "unavailable" ? <p>Model provenance is unavailable.</p>
            : <ul className="adm-door-models">{input.models.map((model, i) => <li key={`${model.run_id}-${i}`}><strong>{model.capability}</strong><span>{model.provider} · {model.model_id}</span><DoorTechnicalDetails title="Model run"><span className="mono">{model.run_id}</span></DoorTechnicalDetails></li>)}</ul>}
    </DoorReviewSection>
    {selected && <DoorReviewSection id="candidate-checks" title="Compiler follow-up checks">
      <p className="adm-small">These are checks left pending by the compiler. Evidence recorded later is shown separately; this list is not a fresh QA run.</p>
      {selected.pending_checks.length ? <ul>{selected.pending_checks.map(check => <li key={check}>{check}</li>)}</ul> : <p>No pending checks are listed in this compiler receipt. That alone is not a release approval.</p>}
      <DoorTechnicalDetails><dl className="adm-door-facts">
        <div><dt>Intent</dt><dd>{page.canonical_intent_id}</dd></div><div><dt>Latest reservation</dt><dd>Version {page.latest_version}</dd></div>
        <div><dt>Artifact hash</dt><dd className="mono">{selected.artifact_hash}</dd></div><div><dt>Compile receipt hash</dt><dd className="mono">{selected.receipt_sha256}</dd></div>
        <div><dt>Reservation</dt><dd className="mono">{selected.reservation_id}</dd></div><div><dt>Build provenance</dt><dd>{selected.provenance_status}</dd></div>
        <div><dt>Input hash</dt><dd className="mono">{input.input_sha256 ?? "Not available"}</dd></div>
        <div><dt>Source identifiers</dt><dd>{selected.source_ids.length ? selected.source_ids.join(", ") : "None listed"}</dd></div>
        <div><dt>Claim identifiers</dt><dd>{selected.claim_ids.length ? selected.claim_ids.join(", ") : "None listed"}</dd></div>
      </dl></DoorTechnicalDetails>
    </DoorReviewSection>}
    <DoorEvidence evidence={data.evidence} />
    <DoorUnavailableActions />
  </div>;
}
