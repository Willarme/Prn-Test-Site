import Link from "next/link";
import { notFound } from "next/navigation";
import { adminGate } from "@/components/admin/AdminGate";
import { EditorPreviewPane } from "@/components/admin/EditorPreviewPane";
import { QaVerdictPanel } from "@/components/admin/QaVerdict";
import { lintPageBeforeQa } from "@/domain/search/page-lint";
import { OWNER_EDITABLE_FIELDS } from "@/domain/search/page-registry";
import { allStagedSpecs, policyStore } from "@/platform/admin/data";
import { publishGate } from "@/platform/search/page-qa-gate";

export const dynamic = "force-dynamic";

/**
 * VIEW AND EDIT ONE STAGED PAGE — the A05 done-when.
 *
 * Two halves, one rule about what crosses into the browser:
 *
 *   LEFT — the edit form. A SERVER component posting plain form-encoded data
 *   to /api/admin/pages/edit (works with JavaScript disabled). Saving creates
 *   a NEW VERSION of the page and sends it back to QA; it never mutates an
 *   existing version and never publishes anything.
 *
 *   RIGHT — the live preview. <EditorPreviewPane> is the only client code,
 *   and by condition C16 it knows NOTHING about pages: it reads the form's
 *   current values out of the DOM and re-requests the preview route with
 *   them. The preview route re-validates the draft and renders the same
 *   IntentPageView the staged route serves, so the owner is never looking at
 *   a re-implementation of the door — they are looking at the door.
 *
 * BELOW — the version history with rollback (canon 14A §17, Pages:
 * "publish/rollback"). Every edit and every factory regeneration leaves its
 * predecessor here, each with the QA verdict it earned; rolling back goes
 * through the same owner-edit path, so history only ever grows forward.
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

  // EVERY VERSION of this page, newest first. Specs persist across edits and
  // regenerations (an edit is a new spec, never a rewrite), so the page's own
  // history is a filter, not a second store.
  const versions = specs
    .filter((s) => s.page_id === spec.page_id)
    .sort((a, b) => b.version - a.version);

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
        Edit your page with the live preview, then save. Saving creates a <strong>new version</strong>{" "}
        of this page and sends it back to QA. It does not publish anything, and it never changes a
        version that already exists.
      </p>
      <p className="hint" style={{ color: "var(--on-dark-mute)", marginBottom: 20 }}>
        <Link href={`/staged/${slug}`} className="mono" style={{ color: "var(--pink)" }}>
          staged page {spec.canonical_path}
        </Link>{" "}
        · template {spec.template_id}@{spec.template_version} · written by{" "}
        {spec.generation.model ?? spec.generation.prompt_id ?? "hand"} · QA {spec.qa.state}
      </p>

      {saved && (
        <div className="cell" style={{ marginBottom: 18 }}>
          <span className="tag">Saved</span>
          <p style={{ margin: 0 }}>{saved}. This page is back at QA PENDING.</p>
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

      <div className="page-editor-grid">
        <form method="post" action="/api/admin/pages/edit" id="page-edit-form" className="cell">
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
          <p className="hint" style={{ color: "var(--on-dark-mute)", marginTop: 14 }}>
            Editable here: {OWNER_EDITABLE_FIELDS.join(", ")}. Section text comes from the shared
            content bank and the template — changing it for one page would fork the bank, so those
            live in Page-creator controls instead.
          </p>
        </form>

        <EditorPreviewPane
          previewPath={`/admin/pages/${encodeURIComponent(spec.page_spec_id)}/preview`}
        />
      </div>

      {versions.length > 1 && (
        <div className="cell" style={{ marginTop: 26 }}>
          <span className="tag">Version history — {versions.length} versions</span>
          <p className="hint" style={{ color: "var(--on-dark-mute)", margin: "8px 0 4px" }}>
            Every edit and every regeneration leaves its predecessor here, with the QA verdict it
            earned. Rolling back restores an older version&apos;s wording as a NEW version — history
            is never rewritten.
          </p>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".88rem" }}>
              <thead>
                <tr className="mono" style={{ textAlign: "left", color: "var(--on-dark-mute)" }}>
                  <th style={{ padding: "8px 10px" }}>Version</th>
                  <th style={{ padding: "8px 10px" }}>Written by</th>
                  <th style={{ padding: "8px 10px" }}>Updated</th>
                  <th style={{ padding: "8px 10px" }}>QA</th>
                  <th style={{ padding: "8px 10px" }}>Title</th>
                  <th style={{ padding: "8px 10px" }}></th>
                </tr>
              </thead>
              <tbody>
                {versions.map((v) => {
                  const isViewed = v.page_spec_id === spec.page_spec_id;
                  return (
                    <tr key={v.page_spec_id} style={{ borderTop: "1px solid var(--line-d)" }}>
                      <td style={{ padding: "8px 10px" }} className="mono">
                        v{v.version}
                        {isViewed && (
                          <span className="pill pill-green" style={{ marginLeft: 8 }}>
                            viewing
                          </span>
                        )}
                      </td>
                      <td style={{ padding: "8px 10px", color: "var(--on-dark-mute)" }}>
                        {v.generation.model ?? v.generation.prompt_id ?? "hand"}
                      </td>
                      <td style={{ padding: "8px 10px", color: "var(--on-dark-mute)" }}>
                        {(v.updated_at ?? v.created_at ?? "").slice(0, 10)}
                      </td>
                      <td style={{ padding: "8px 10px" }}>
                        <span
                          className={`pill ${v.qa.state === "PASS" ? "pill-green" : v.qa.state === "FAIL" ? "pill-pink" : "pill-amber"}`}
                        >
                          {v.qa.state}
                        </span>
                      </td>
                      <td style={{ padding: "8px 10px" }}>{v.title}</td>
                      <td style={{ padding: "8px 10px" }}>
                        {!isViewed && (
                          <form method="post" action="/api/admin/pages/rollback">
                            <input type="hidden" name="page_spec_id" value={v.page_spec_id} />
                            <button type="submit" className="btn btn-ghost btn-sm">
                              Roll back to v{v.version}
                            </button>
                          </form>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
