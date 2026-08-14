import { notFound } from "next/navigation";
import { IntentPageView } from "@/components/door/IntentPageView";
import { findPublishedByPath } from "@/domain/search/page-store";
import { DEFAULT_FLAGS } from "@/platform/flags";

/**
 * Production door route: serves ONLY owner-published IntentPages, and only
 * when the seo_doors_enabled flag is on. Deleting any door page can never
 * affect the intake engine or a customer record (canon).
 */
export default async function PublishedDoorPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const flag = DEFAULT_FLAGS.find((f) => f.flag_key === "seo_doors_enabled");
  if (!flag?.enabled) notFound();
  const { slug } = await params;
  const spec = findPublishedByPath(`/problems/${slug}`);
  if (!spec) notFound();
  return <IntentPageView spec={spec} staged={false} />;
}
