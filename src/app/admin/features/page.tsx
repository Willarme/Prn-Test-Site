import { adminGate } from "@/components/admin/AdminGate";
import { AdminPageHeader } from "@/components/admin/AdminUI";
import { FeatureControls } from "@/components/admin/FeatureControls";
import { featureAdminView } from "@/platform/features/admin";

export const dynamic = "force-dynamic";
export default async function FeaturesPage() {
  const gate = await adminGate();
  if (gate) return gate;
  return <div>
    <AdminPageHeader eyebrow="Operations / Launch scope" title="Features" description="Choose what customers can use, what they can read about, and what stays hidden. Saved changes take effect within 30 seconds." />
    <FeatureControls initial={await featureAdminView()} />
  </div>;
}
