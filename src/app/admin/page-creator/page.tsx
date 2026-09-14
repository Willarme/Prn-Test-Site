import Link from "next/link";
import { adminGate } from "@/components/admin/AdminGate";
import { AdminEmptyState, AdminPageHeader, AdminStatus } from "@/components/admin/AdminUI";
import { DoorUnavailableActions } from "@/components/admin/DoorCreatorViews";
import { DoorPageRuns } from "@/components/admin/DoorPageRuns";
import { loadDoorCreatorOverview } from "@/platform/admin/door-creator";

export const dynamic = "force-dynamic";

export default async function DoorCreatorPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const gate = await adminGate();
  if (gate) return gate;
  const query = await searchParams;
  const runId = typeof query?.run === "string" ? query.run : query?.run ? "invalid-run-address" : null;
  const data = await loadDoorCreatorOverview().catch(() => null);
  return <div className="adm-door">
    <AdminPageHeader eyebrow="Growth / Page Creator" title="Page Creator" description="Review saved page identities, their immutable versions and the evidence attached to each one."
      actions={<Link className="btn btn-ghost" href="/admin/templates">Review templates →</Link>}
      meta={<AdminStatus>{data?.status === "ready" ? `${data.pages.length} saved page identities` : "Catalogue unavailable"}</AdminStatus>} />
    <p className="adm-door-intro">Run fixture checks and review saved records. A reserved version, a built candidate and a version currently being served are separate records.</p>
    <DoorPageRuns initialRunId={runId} />
    {data?.status !== "ready" ? <AdminEmptyState title="The page catalogue could not be read">Saved pages are unverified. This does not mean there are no pages. Reload after the store is available.</AdminEmptyState>
      : !data.pages.length ? <AdminEmptyState title="No saved page identities">No identities were returned by the current catalogue. Unsaved fixture dry runs do not appear in this list.</AdminEmptyState>
        : <div className="adm-door-table" role="region" aria-label="Saved page identities" tabIndex={0}><table><thead><tr><th scope="col">Page</th><th scope="col">Canonical path</th><th scope="col">Latest reserved version</th><th scope="col">Review</th></tr></thead><tbody>{data.pages.map(page => <tr key={page.page_id}>
          <th scope="row">{page.page_id}</th><td className="mono">{page.canonical_path}</td><td>Version {page.latest_version}</td>
          <td><Link href={`/admin/page-creator/${encodeURIComponent(page.page_id)}`} aria-label={`Review versions for ${page.page_id}`}>Review versions →</Link></td>
        </tr>)}</tbody></table></div>}
    <DoorUnavailableActions />
  </div>;
}
