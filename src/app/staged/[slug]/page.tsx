import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { IntentPageView } from "@/components/door/IntentPageView";
import { findStagedByPath } from "@/domain/search/page-store";
import { isAdminUnlocked } from "@/platform/admin/auth";

export const dynamic = "force-dynamic";

export async function generateMetadata(context: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  if (!(await isAdminUnlocked().catch(() => false))) notFound();
  const { slug } = await context.params;
  const spec = await findStagedByPath(`/problems/${slug}`);
  if (!spec) return { title: "Not found" };
  return {
    title: spec.title,
    description: spec.meta_description,
    robots: { index: false, follow: false }, // staged is NEVER indexable
  };
}

export default async function StagedDoorPage(context: {
  params: Promise<{ slug: string }>;
}) {
  if (!(await isAdminUnlocked().catch(() => false))) notFound();
  const { slug } = await context.params;
  const spec = await findStagedByPath(`/problems/${slug}`);
  if (!spec) notFound();
  if (spec.door_template) redirect(`/staged-template/${encodeURIComponent(spec.page_spec_id)}`);
  return <IntentPageView spec={spec} staged />;
}
