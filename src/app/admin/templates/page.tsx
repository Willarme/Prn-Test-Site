import Link from "next/link";
import { adminGate } from "@/components/admin/AdminGate";
import { AdminEmptyState, AdminPageHeader, AdminStatus } from "@/components/admin/AdminUI";
import { DoorReviewSection, DoorTechnicalDetails, DoorUnavailableActions } from "@/components/admin/DoorCreatorViews";
import { loadDoorTemplateKitView } from "@/platform/admin/door-creator";

export const dynamic = "force-dynamic";

export default async function DoorTemplatesPage() {
  const gate = await adminGate();
  if (gate) return gate;
  const kit = await loadDoorTemplateKitView().catch(() => null);
  const groups = new Map<string, Array<{ key: string; value: string }>>();
  for (const entry of kit?.constants ?? []) { const group = entry.key.split("_")[0]; groups.set(group, [...groups.get(group) ?? [], entry]); }
  return <div className="adm-door">
    <AdminPageHeader eyebrow="Growth / Templates" title="Templates" description="Inspect the current versioned kit, its source documents and the rules available to page builds."
      actions={<Link className="btn btn-ghost" href="/admin/page-creator">Review saved pages →</Link>} />
    {!kit ? <AdminEmptyState title="The template kit could not be verified">The source contracts could not be read. No substitute template or approval status is shown.</AdminEmptyState> : <>
      <DoorReviewSection id="template-identity" title="Current kit">
        <dl className="adm-door-facts"><div><dt>Frozen content baseline</dt><dd>{kit.baseline}</dd></div><div><dt>Template version</dt><dd>{kit.template_version}</dd></div><div><dt>Schema version</dt><dd>{kit.schema_version}</dd></div><div><dt>Order profile</dt><dd>{kit.order_profile}</dd></div></dl>
        <p className="adm-small">This is the current source kit. Saved page versions keep their own assignments. A kit identity is not a completed corpus test or an approved theme.</p>
      </DoorReviewSection>
      <div className="adm-door-summary"><DoorReviewSection id="template-order" title="Section order"><ol className="adm-door-order">{kit.order.map((section, i) => <li key={`${section}-${i}`}>{section}</li>)}</ol></DoorReviewSection>
        <DoorReviewSection id="template-mutability" title="What can change"><dl className="adm-door-facts">{kit.mutability.map(row => <div key={row.class}><dt>{row.class} · {row.count} entries</dt><dd>{row.description}</dd></div>)}</dl><p className="adm-small">These counts describe source rules. Editing controls are not connected here.</p></DoorReviewSection></div>
      <DoorReviewSection id="template-documents" title="Source documents"><ul className="adm-door-documents">{kit.documents.map(document => <li key={document.id}><a href={document.href} download>{document.label} ↓</a><DoorTechnicalDetails title="Document identity"><p>{document.id}</p><p className="mono">SHA-256: {document.sha256}</p></DoorTechnicalDetails></li>)}</ul></DoorReviewSection>
      <DoorReviewSection id="template-constants" title="Reusable wording"><p className="adm-small">This inventory includes conditional and source-only strings. A phrase appearing here does not mean its claim or feature is active on a page.</p>
        {[...groups].map(([group, constants]) => <DoorTechnicalDetails key={group} title={`${group.replace(/_/g, " ")} · ${constants.length} strings`}><dl className="adm-door-facts">{constants.map(entry => <div key={entry.key}><dt className="mono">{entry.key}</dt><dd>{entry.value}</dd></div>)}</dl></DoorTechnicalDetails>)}
      </DoorReviewSection>
      <DoorReviewSection id="template-themes" title="Required theme slots"><p className="adm-small">These required slots are not registered themes. No theme or ten-theme acceptance is implied.</p><ul className="adm-door-slots">{kit.theme_slots.map(slot => <li key={slot.id}><strong>{slot.id}</strong><AdminStatus tone="warning">Not registered</AdminStatus></li>)}</ul></DoorReviewSection>
    </>}
    <DoorUnavailableActions template />
  </div>;
}
