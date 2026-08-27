import { adminGate } from "@/components/admin/AdminGate";
import Link from "next/link";
import { loadStaged, publishedPageIds } from "@/platform/admin/data";
import { DEFAULT_FLAGS } from "@/platform/flags";
import { GeneratePagesButton } from "@/components/admin/GeneratePagesButton";
import { PublishButton } from "@/components/admin/PublishButton";
import { publishQueueSnapshot } from "@/platform/search/page-qa-gate";

export const dynamic = "force-dynamic";

export default async function AdminPages() {
  const gate = await adminGate();
  if (gate) return gate;

  /**
   * THE QUEUE SHOWS THE DECISION THE ROUTE WILL MAKE, from the same function
   * (condition C10). A row that offers a publish button the server would refuse
   * is a second, softer gate wearing a UI costume — and one the owner learns to
   * distrust the first time it lies.
   */
  const queue = await publishQueueSnapshot();
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

      {/*
        THE PAGE MAKER, IN THE PAGE. A05's only admin trigger. One press runs
        the factory over every opportunity approved in Search opportunities:
        drafts are staged at QA PENDING and land in the queue below — nothing
        is published by this action, and running it twice cannot double-build
        (the route skips opportunities that already have a page).
      */}
      <div className="cell" style={{ margin: "0 0 24px" }}>
        <strong>The page maker</strong> — one press builds a draft door for every opportunity you
        approved in <strong>Search opportunities</strong>. Drafts land below as QA-pending; they go
        public only through your own <strong>Approve &amp; publish</strong>. Safe to press again:
        opportunities that already have a page are skipped.
        <div style={{ marginTop: 10 }}>
          <GeneratePagesButton />
        </div>
      </div>

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
            {queue.map(({ spec: s, decision }) => {
              const isPublished = published.has(s.page_id);
              const slug = s.canonical_path.replace(/^\/problems\//, "");
              return (
                <tr key={s.page_spec_id} style={{ borderTop: "1px solid var(--line-d)", verticalAlign: "top" }}>
                  <td style={{ padding: "8px 10px" }}>
                    <span className={`pill ${s.qa.state === "PASS" ? "pill-green" : s.qa.state === "FAIL" ? "pill-pink" : "pill-amber"}`}>{s.qa.state}</span>
                    {/*
                      HONEST, NOT FLATTERING. A deterministic PASS with no AI
                      critic is BLOCKED_PENDING_AI, and the queue says so rather
                      than showing a bare green tick over a page nothing has
                      read for meaning (Loop Spec Audit pre-answer 1).
                    */}
                    <div style={{ marginTop: 6 }}>
                      <span
                        className={`pill ${decision.qa.overall === "PASS" ? "pill-green" : decision.qa.overall === "FAIL" ? "pill-pink" : "pill-amber"}`}
                      >
                        {decision.qa.overall}
                      </span>
                    </div>
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
                    {/*
                      THE BUTTON MATCHES THE SERVER. `decision.release_eligible`
                      is the same boolean the publish route reads, so the queue
                      can never offer an action the server refuses. The reason
                      shown is a COUNT, never the finding text: findings can
                      quote a fragment of page copy, and this crosses into a
                      client component (condition C16).
                    */}
                    {decision.release_eligible ? (
                      <PublishButton pageSpecId={s.page_spec_id} published={isPublished} canPublish={canPublish} disabledReason={disabledReason} />
                    ) : (
                      <span className="hint" style={{ color: "var(--on-dark-mute)" }}>
                        {decision.qa.blockers.length > 0
                          ? `${decision.qa.blockers.length} blocker(s) — no override exists`
                          : "QA must pass first"}
                      </span>
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
