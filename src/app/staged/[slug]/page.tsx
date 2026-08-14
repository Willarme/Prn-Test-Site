import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { IntentPageView } from "@/components/door/IntentPageView";
import { findStagedByPath } from "@/domain/search/page-store";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const spec = findStagedByPath(`/problems/${slug}`);
  if (!spec) return { title: "Not found" };
  return {
    title: spec.title,
    description: spec.meta_description,
    robots: { index: false, follow: false }, // staged is NEVER indexable
  };
}

export default async function StagedDoorPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const spec = findStagedByPath(`/problems/${slug}`);
  if (!spec) notFound();
  return <IntentPageView spec={spec} staged />;
}
