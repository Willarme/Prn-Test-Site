import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { adminGate } from "@/components/admin/AdminGate";
import { IntentPageView } from "@/components/door/IntentPageView";
import { PageSpec } from "@/domain/search/pages";
import { allStagedSpecs } from "@/platform/admin/data";

export const dynamic = "force-dynamic";

/**
 * THE LIVE DRAFT PREVIEW behind the page editor.
 *
 * The editor on /admin/pages/[page_spec_id] renders this page in an iframe
 * and re-requests it (debounced) as the owner types, so what they see is THE
 * REAL DOOR TEMPLATE rendering THEIR DRAFT — the same IntentPageView the
 * staged route serves, inside the same layout and stylesheet. Nothing here
 * persists: the draft exists only as query parameters on this request, and
 * the saved page does not change until the edit form posts to
 * /api/admin/pages/edit.
 *
 * SERVER COMPONENT (C16): the draft fields arrive as search params and are
 * re-validated through PageSpec.parse before render — an impossible draft
 * shows its reason instead of crashing or silently pretending.
 */
export default async function AdminPagePreview({
  params,
  searchParams,
}: {
  params: Promise<{ page_spec_id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const gate = await adminGate();
  if (gate) return gate;

  const { page_spec_id } = await params;
  const query = await searchParams;
  const specs = await allStagedSpecs();
  const spec = specs.find((s) => s.page_spec_id === decodeURIComponent(page_spec_id));
  if (!spec) notFound();

  const pick = (key: string): string | undefined => {
    const v = query[key];
    return typeof v === "string" ? v : undefined;
  };

  const draft = {
    title: pick("title") ?? spec.title,
    meta_description: pick("meta_description") ?? spec.meta_description,
    h1: pick("h1") ?? spec.h1,
    hero: {
      ...spec.hero,
      headline: pick("hero_headline") ?? spec.hero.headline,
      subheadline:
        pick("hero_subheadline") !== undefined
          ? pick("hero_subheadline") === ""
            ? null
            : (pick("hero_subheadline") as string)
          : (spec.hero.subheadline ?? null),
    },
  };

  let draftSpec: PageSpec | null = null;
  let parseError: string | null = null;
  try {
    draftSpec = PageSpec.parse({ ...spec, ...draft });
  } catch (err) {
    parseError =
      err instanceof Error
        ? err.message.slice(0, 300)
        : "the draft values are not a valid page";
  }

  // Valid frozen specs use the complete raw HTML template. Unsaved edits that
  // violate the reviewed binding retain the explicit validation error below.
  if (draftSpec?.door_template) redirect(`/staged-template/${encodeURIComponent(draftSpec.page_spec_id)}`);

  return (
    <div style={{ background: "var(--bg-dark, #17171c)", minHeight: "100vh" }}>
      <div
        className="mono"
        style={{
          background: "var(--amber)",
          color: "#1a1408",
          padding: "8px 16px",
          display: "flex",
          gap: 14,
          alignItems: "center",
          flexWrap: "wrap",
          position: "sticky",
          top: 0,
          zIndex: 10,
        }}
      >
        <strong>DRAFT PREVIEW</strong>
        <span>your unsaved edits — nothing is saved until you press Save in the editor</span>
        <Link
          href={`/admin/pages/${encodeURIComponent(page_spec_id)}`}
          style={{ color: "#1a1408", marginLeft: "auto", textDecoration: "underline" }}
        >
          ← back to editor
        </Link>
      </div>
      {parseError ? (
        <div style={{ maxWidth: 720, margin: "40px auto", padding: 20 }}>
          <div className="cell">
            <span className="tag">This draft does not parse yet</span>
            <p className="mono" style={{ margin: "8px 0 0", fontSize: ".85rem" }}>
              {parseError}
            </p>
          </div>
        </div>
      ) : (
        <IntentPageView spec={draftSpec as PageSpec} staged={false} />
      )}
    </div>
  );
}
