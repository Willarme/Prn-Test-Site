import { adminGate } from "@/components/admin/AdminGate";
import { AdminEmptyState, AdminPageHeader, AdminStatus } from "@/components/admin/AdminUI";
import { AdminRequestTable } from "@/components/admin/AdminRequestTable";
import { readAdminRequestRows } from "@/platform/admin/request-inspection";
import { runtimeStore } from "@/platform/stores/runtime";

export const dynamic = "force-dynamic";

export default async function RequestsPage() {
  const gate = await adminGate();
  if (gate) return gate;
  const store = runtimeStore();
  const result = await readAdminRequestRows(store).then(rows => ({ rows, available: true }), () => ({ rows: [], available: false }));
  return <div>
    <AdminPageHeader eyebrow="Operate / Requests" title="Every request. One record."
      description="Follow the homeowner’s supplied details, recorded facts and current packet in one private inspection. Search covers the latest 100 requests."
      meta={<><AdminStatus>{store.kind === "supabase" ? "Database storage" : "Local file storage"}</AdminStatus><AdminStatus>Private admin view</AdminStatus></>} />
    {!result.available ? <AdminEmptyState title="Requests could not be loaded">The store did not return a usable list. This is an unavailable reading, not zero requests. Reload to retry.</AdminEmptyState>
      : !result.rows.length ? <AdminEmptyState title="The first record starts the story">No requests were returned from this store. A request created through the homeowner flow will appear here.</AdminEmptyState>
        : <AdminRequestTable rows={result.rows} />}
    <p className="hint" style={{ marginTop: 20 }}>Stored status records the workflow state; a packet can exist while the homeowner is still adding details. Safety is replayed from saved evidence. Synthetic demo records carry their own label.</p>
  </div>;
}
