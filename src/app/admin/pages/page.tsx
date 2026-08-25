import { adminGate } from "@/components/admin/AdminGate";
import Link from "next/link";
import { allStagedSpecs, loadStaged, publishedPageIds } from "@/platform/admin/data";
import { DEFAULT_FLAGS } from "@/platform/flags";
import { PublishButton } from "@/components/admin/PublishButton";

export const dynamic = "force-dynamic";

export default async function AdminPages() {
  const gate = await adminGate();
  if (gate) return gate;

  const specs = await allStagedSpecs();
  const published = await publishedPageIds();
  const { skipped } = loadStaged();
  const doorsFlag = DEFAULT_FLAGS.find((f) => f.flag_key === "seo_doors_enabled")?.enabled ?? false;
  // Past the gate the owner is signed in, so publishing is available.
  const canPublish = true;
  const disabledReason = null;

  return (
    <div>
      <div className="eyebrow">A05 factory → A06 QA → your approval</div>
      <h1 className="d2">Pages</h1>
      <p className="lede" style={{ margin: "12px 0 10px" }}>
        Every page here was built by the factory from an opportunity{" "}
        <strong>you approved</strong> in Opportunities — never from the agent&apos;s own
        recommendation — and checked by QA.{" "}
        <strong>Nothing goes public without your Approve &amp; publish.</strong> Publishing puts a
        page in the published set; actual public serving stays behind the master switch (
        <span className={`pill ${doorsFlag ? "pill-green" : "pill-amber"}`}>
          public serving {doorsFlag ? "ON" : "OFF until launch"}
        </span>
        ) so nothing leaks before the launch gate.
      </p>
      <p className="hint" style={{ color: "var(--on-dark-mute)", marginBottom: 24 }}>
        Publish state lives in the runtime store — persistent locally, temporary on staging until the
        database is connected.
      </p>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".9rem" }}>
          <thead>
            <tr className="mono" style={{ textAlign: "left", color: "var(--on-dark-mute)" }}>
              <th style={{ padding: "8px 10px" }}>QA</th>
              <th style={{ padding: "8px 10px" }}>Page</th>
              <th style={{ padding: "8px 10px" }}>Family</th>
              <th style={{ padding: "8px 10px" }}>Value</th>
              <th style={{ padding: "8px 10px" }}>Writer</th>
              <th style={{ padding: "8px 10px" }}>State</th>
              <th style={{ padding: "8px 10px" }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {specs.map((s) => {
              const isPublished = published.has(s.page_id);
              const slug = s.canonical_path.replace(/^\/problems\//, "");
              return (
                <tr key={s.page_spec_id} style={{ borderTop: "1px solid var(--line-d)", verticalAlign: "top" }}>
                  <td style={{ padding: "8px 10px" }}>
                    <span className={`pill ${s.qa.state === "PASS" ? "pill-green" : s.qa.state === "FAIL" ? "pill-pink" : "pill-amber"}`}>{s.qa.state}</span>
                    {s.qa.reasons.length > 0 && (
                      <ul style={{ paddingLeft: 16, marginTop: 6, color: "var(--on-dark-mute)", fontSize: ".82rem" }}>
                        {s.qa.reasons.map((r, i) => (
                          <li key={i}>{r}</li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td style={{ padding: "8px 10px" }}>
                    <strong>{s.h1}</strong>
                    <br />
                    <Link href={`/staged/${slug}`} className="mono" style={{ color: "var(--pink)" }}>
                      preview {s.canonical_path}
                    </Link>
                    <br />
                    {/* Server-rendered edit surface (A05 done-when). No client
                        component receives a PageSpec — condition C16. */}
                    <Link
                      href={`/admin/pages/${encodeURIComponent(s.page_spec_id)}`}
                      className="mono"
                      style={{ color: "var(--on-dark-mute)" }}
                    >
                      view / edit unique fields
                    </Link>
                  </td>
                  <td style={{ padding: "8px 10px" }}>{s.problem_family ?? "—"}</td>
                  <td style={{ padding: "8px 10px" }}>{s.user_value_score ?? "—"}</td>
                  <td style={{ padding: "8px 10px", color: "var(--on-dark-mute)" }}>{s.generation.model ?? "handcrafted"}</td>
                  <td style={{ padding: "8px 10px" }}>
                    {isPublished ? <span className="pill pill-green">PUBLISHED</span> : <span className="pill">{s.status}</span>}
                  </td>
                  <td style={{ padding: "8px 10px" }}>
                    {s.qa.state === "PASS" ? (
                      <PublishButton pageSpecId={s.page_spec_id} published={isPublished} canPublish={canPublish} disabledReason={disabledReason} />
                    ) : (
                      <span className="hint" style={{ color: "var(--on-dark-mute)" }}>QA must pass first</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {skipped.length > 0 && (
        <div className="cell" style={{ marginTop: 26 }}>
          <span className="tag">Skipped by the factory</span>
          <ul style={{ paddingLeft: 18, color: "var(--on-dark-mute)" }}>
            {skipped.map((s) => (
              <li key={s.keyword}>
                {s.keyword} — {s.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
