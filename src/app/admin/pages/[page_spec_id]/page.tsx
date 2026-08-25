import Link from "next/link";
import { notFound } from "next/navigation";
import { adminGate } from "@/components/admin/AdminGate";
import { QaVerdictPanel } from "@/components/admin/QaVerdict";
import { lintPageBeforeQa } from "@/domain/search/page-lint";
import { OWNER_EDITABLE_FIELDS } from "@/domain/search/page-registry";
import { allStagedSpecs, policyStore } from "@/platform/admin/data";
import { publishGate } from "@/platform/search/page-qa-gate";

export const dynamic = "force-dynamic";

/**
 * VIEW AND EDIT ONE STAGED PAGE'S UNIQUE FIELDS — the A05 done-when, and a
 * SERVER component from top to bottom.
 *
 * Condition C16 forbids any PageSpec internal reaching a "use client"
 * component, so there is no client component here at all: the form is plain
 * HTML posting form-encoded data to /api/admin/pages/edit, which redirects
 * back. The whole flow works with JavaScript disabled, and nothing about the
 * page — not the provenance ids, not the QA reasons, not the generation
 * metadata — is ever serialized into a browser bundle as props.
 *
 * "Unique fields" means the ones that are about THIS page and no other. Block
 * bodies come from the content bank and the template; changing those for one
 * page would silently fork the content bank, which is what
 * `policy.page_factory.content_families` is for.
 */
export default async function AdminEditPage({
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

  const policy = await policyStore().getActive();
  const lint = lintPageBeforeQa(spec, policy.page_factory);
  /**
   * A06's verdict, from the SAME function the publish route calls — the admin
   * screen saying "ready" while the route returns 409 is exactly the drift the
   * one-gate discipline exists to prevent, so this surface gets no shortcut.
   */
  const release = await publishGate({ page_spec_id: spec.page_spec_id });
  const blocked = typeof query.blocked === "string" ? query.blocked : null;
  const saved = typeof query.saved === "string" ? query.saved : null;
  const slug = spec.canonical_path.replace(/^\/[a-z0-9-]+\//, "");

  return (
    <div>
      <div className="eyebrow">
        <Link href="/admin/pages" style={{ color: "var(--pink)" }}>
          ← Pages
        </Link>{" "}
        · A05 page factory · spec v{spec.version}
      </div>
      <h1 className="d2">{spec.h1}</h1>
      <p className="lede" style={{ margin: "12px 0 8px" }}>
        Editing these fields creates a <strong>new version</strong> of this page and sends it back
        to QA. It does not publish anything, and it never changes a version that already exists.
      </p>
      <p className="hint" style={{ color: "var(--on-dark-mute)", marginBottom: 20 }}>
        <Link href={`/staged/${slug}`} className="mono" style={{ color: "var(--pink)" }}>
          preview {spec.canonical_path}
        </Link>{" "}
        · template {spec.template_id}@{spec.template_version} · written by{" "}
        {spec.generation.model ?? spec.generation.prompt_id ?? "hand"} · QA {spec.qa.state}
      </p>

      {saved && (
        <div className="cell" style={{ marginBottom: 18 }}>
          <span className="tag">Saved</span>
          <p style={{ margin: 0 }}>Updated: {saved}. This page is back at QA PENDING.</p>
        </div>
      )}
      {blocked && (
        <div className="cell" style={{ marginBottom: 18, borderColor: "var(--pink)" }}>
          <span className="tag">Not saved — the wording rules blocked it</span>
          <p style={{ margin: 0 }}>{blocked}</p>
        </div>
      )}
      {release && (
        <QaVerdictPanel
          qa={release.decision.qa}
          eligible={release.decision.release_eligible}
          reasons={release.decision.reasons}
        />
      )}

      {lint.findings.length > 0 && (
        <div className="cell" style={{ marginBottom: 18 }}>
          <span className="tag">This page currently fails {lint.findings.length} wording check(s)</span>
          <ul style={{ paddingLeft: 18, color: "var(--on-dark-mute)", margin: 0 }}>
            {lint.findings.map((f, i) => (
              <li key={i}>
                <span className="mono">{f.check}</span> @ {f.where} — {f.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      <form method="post" action="/api/admin/pages/edit" className="cell">
        <input type="hidden" name="page_spec_id" value={spec.page_spec_id} />
        <label style={{ display: "block", marginBottom: 14 }}>
          <span className="tag">Title (max 70)</span>
          <input name="title" defaultValue={spec.title} maxLength={70} required style={{ width: "100%" }} />
        </label>
        <label style={{ display: "block", marginBottom: 14 }}>
          <span className="tag">Meta description (max 170)</span>
          <textarea
            name="meta_description"
            defaultValue={spec.meta_description}
            maxLength={170}
            rows={3}
            required
            style={{ width: "100%" }}
          />
        </label>
        <label style={{ display: "block", marginBottom: 14 }}>
          <span className="tag">H1</span>
          <input name="h1" defaultValue={spec.h1} required style={{ width: "100%" }} />
        </label>
        <label style={{ display: "block", marginBottom: 14 }}>
          <span className="tag">Hero headline</span>
          <input name="hero_headline" defaultValue={spec.hero.headline} required style={{ width: "100%" }} />
        </label>
        <label style={{ display: "block", marginBottom: 18 }}>
          <span className="tag">Hero subheadline (blank to remove)</span>
          <input
            name="hero_subheadline"
            defaultValue={spec.hero.subheadline ?? ""}
            style={{ width: "100%" }}
          />
        </label>
        <button type="submit" className="btn btn-pink btn-sm">
          Save as a new version
        </button>
      </form>

      <p className="hint" style={{ color: "var(--on-dark-mute)", marginTop: 18 }}>
        Editable here: {OWNER_EDITABLE_FIELDS.join(", ")}. Section text comes from the shared
        content bank and the template — changing it for one page would fork the bank, so those live
        in Page-creator controls instead.
      </p>
    </div>
  );
}
