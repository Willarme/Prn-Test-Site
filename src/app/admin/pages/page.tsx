import Link from "next/link";
import { adminGate } from "@/components/admin/AdminGate";
import { AdminEmptyState, AdminPageHeader, AdminStatus } from "@/components/admin/AdminUI";
import { loadStaged, publishedPageIds } from "@/platform/admin/data";
import { runtimeStore } from "@/platform/stores/runtime";
import { getFeatureFlags } from "@/platform/flags";
import { SAMPLE_PAGE_SPEC } from "@/domain/search/fixtures/sample-page-spec";
import { GeneratePagesButton } from "@/components/admin/GeneratePagesButton";
import { PublishButton } from "@/components/admin/PublishButton";
import { isRetiredLegacySpec, LEGACY_DOOR_RETIREMENT } from "@/platform/pages/route-retirement";
import { publishQueueSnapshot } from "@/platform/search/page-qa-gate";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 20;
const FILTERS = ["eligible", "blocked", "published", "unpublished", "publication-unverified", "v43", "legacy", "retired"];
type Search = Record<string, string | string[] | undefined>;
const scalar = (value: Search[string]) => (Array.isArray(value) ? value[0] : value) ?? "";

export default async function AdminPages({ searchParams }: { searchParams?: Promise<Search> }) {
  const gate = await adminGate();
  if (gate) return gate;
  const params = await searchParams ?? {};
  const query = scalar(params.q).trim().slice(0, 160);
  const filter = FILTERS.includes(scalar(params.filter)) ? scalar(params.filter) : "";
  // Keep the queue on the same release decision as the publish route. A
  // presentation filter never creates a second, weaker release condition.
  const [queueRead, publishedRead] = await Promise.allSettled([
    Promise.resolve().then(() => publishQueueSnapshot()),
    Promise.resolve().then(() => publishedPageIds()),
  ]);
  const queue = queueRead.status === "fulfilled" ? queueRead.value : null;
  const published = publishedRead.status === "fulfilled" ? publishedRead.value : null;
  const { specs: committed, skipped } = loadStaged();
  const committedIds = new Set(committed.map(spec => spec.page_spec_id));
  let storeKind: "file" | "supabase" | null = null;
  try { storeKind = runtimeStore().kind; } catch { /* Failed configuration is shown as unknown. */ }
  const doorsFlag = (await getFeatureFlags()).find(flag => flag.flag_key === "seo_doors_enabled")?.enabled ?? false;
  const canPublish = published !== null;
  const disabledReason = canPublish ? null : "Publication state is unverified. Refresh after the store recovers.";
  const duplicateIds = new Set((queue ?? []).filter((row, index, all) => all.findIndex(candidate => candidate.spec.page_spec_id === row.spec.page_spec_id) !== index).map(row => row.spec.page_spec_id));
  const filtered = (queue ?? []).filter(({ spec, decision }) => {
    if (query && ![spec.h1, spec.page_spec_id, spec.page_id, spec.canonical_path, spec.problem_family, spec.template_id].some(value => value?.toLowerCase().includes(query.toLowerCase()))) return false;
    switch (filter) {
      case "eligible": return decision.release_eligible;
      case "blocked": return !decision.release_eligible;
      case "published": return published?.has(spec.page_id) === true;
      case "unpublished": return published !== null && !published.has(spec.page_id);
      case "publication-unverified": return published === null;
      case "v43": return !!spec.door_template;
      case "legacy": return !spec.door_template;
      case "retired": return isRetiredLegacySpec(spec);
      default: return true;
    }
  });
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const requestedPage = Number(scalar(params.page));
  const page = Math.min(pageCount, Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1);
  const offset = (page - 1) * PAGE_SIZE;
  const shown = filtered.slice(offset, offset + PAGE_SIZE);
  const pageHref = (target: number) => {
    const next = new URLSearchParams();
    if (query) next.set("q", query);
    if (filter) next.set("filter", filter);
    next.set("page", String(target));
    return `/admin/pages?${next.toString()}`;
  };

  return <div>
    <AdminPageHeader eyebrow="Growth / A05 factory · A06 quality review" title="Page queue"
      description="Inspect each staged specification, its current release decision and the separate publication record."
      meta={<><AdminStatus tone={queue ? "neutral" : "warning"}>{queue ? `${queue.length} staged specifications` : "Queue unavailable"}</AdminStatus><AdminStatus>{storeKind === "supabase" ? "Database runtime store" : storeKind === "file" ? "Local file runtime store" : "Runtime store unknown"}</AdminStatus><AdminStatus>Door serving flag {doorsFlag ? "ON" : "OFF"}</AdminStatus></>}
      actions={<Link className="btn btn-ghost" href="/admin/opportunities">Review research →</Link>} />
    <div className="cell" style={{ marginBottom: 24, borderLeft: "3px solid #2d5c68" }}>
      <strong>Queue eligibility is separate from AI review and production readiness.</strong>
      <p className="adm-small">This queue combines a handcrafted sample, committed factory fixtures and specifications returned by the current runtime store. Rows are specifications, not a count of unique live pages. The five retired legacy doors remain in this ledger for history. They cannot be served or published. Other rows do not establish frozen v43 readiness.</p>
      <p className="adm-small" style={{ marginBottom: 0 }}>Publishing records a page ID in this environment’s published set. Public routes also apply the door-serving flag and their own serving checks. The stored publication flag does not identify which specification version is serving, or prove indexing. Current backend configuration alone does not establish persistence across a hosting restart.</p>
    </div>
    <section className="cell" aria-labelledby="page-maker-title" style={{ marginBottom: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 18, flexWrap: "wrap", alignItems: "center" }}><div style={{ flex: "1 1 320px" }}><p className="adm-kicker">Draft preparation</p><h2 id="page-maker-title" style={{ fontSize: "1.1rem", margin: "8px 0" }}>Build from approved opportunities</h2><p className="adm-small" style={{ margin: 0 }}>The factory applies its current gates and skips opportunities that already have a page. The action stages drafts and can run QA; inspect each resulting verdict here. It does not publish anything.</p></div>{queue ? <GeneratePagesButton /> : <AdminStatus tone="warning">Verify the queue before building</AdminStatus>}</div>
    </section>
    {!published && <p role="status" className="cell" style={{ borderLeft: "3px solid #b78742" }}><strong>Publication state is unverified.</strong> The store reading failed; no row is presented as published or unpublished, and publication controls are unavailable.</p>}
    {duplicateIds.size > 0 && <p role="status" className="cell" style={{ borderLeft: "3px solid #b78742" }}><strong>Repeated specification IDs are present.</strong> The sample or committed set and runtime set overlap. Their rows are shown separately; the shared release gate decides eligibility. An ID-based editor resolves its existing store lookup, so review the version and template it opens.</p>}
    <form method="get" action="/admin/pages" aria-label="Filter staged specifications" style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "end", margin: "24px 0 22px" }}>
      <label className="field" style={{ flex: "2 1 220px", minWidth: 0 }}><span className="field-label">Search specifications</span><input type="search" name="q" defaultValue={query} maxLength={160} placeholder="Title, path, family or ID" style={{ width: "100%" }} /></label>
      <label className="field" style={{ flex: "1 1 230px", minWidth: 0 }}><span className="field-label">Queue / template filter</span><select name="filter" defaultValue={filter} style={{ width: "100%" }}><option value="">All specifications</option><option value="eligible">Queue eligible</option><option value="blocked">Queue blocked</option><option value="published">Page ID in published set</option><option value="unpublished">Page ID outside published set</option><option value="publication-unverified">Publication unverified</option><option value="v43">Frozen v43 binding present</option><option value="retired">Retired</option><option value="legacy">Legacy / no v43 binding</option></select></label>
      <button type="submit" className="btn">Apply filters</button><Link className="btn btn-ghost" href="/admin/pages">Reset</Link>
    </form>
    {queue && <p className="adm-small">{filtered.length ? `Showing ${offset + 1}–${offset + shown.length} of ${filtered.length}` : "0 matching specifications"} · {queue.length} staged rows · {queue.filter(row => row.decision.release_eligible).length} queue eligible under their current template policy</p>}
    {!queue ? <AdminEmptyState title="The release queue could not be read">A current policy and staged-specification reading are required. This does not mean there are zero pages. Reload after the source recovers.</AdminEmptyState>
      : !shown.length ? <AdminEmptyState title={queue.length ? "No specifications match these filters" : "No staged specifications returned"} action={<Link className="btn btn-ghost" href="/admin/pages">Reset filters</Link>}>Review another part of the queue or prepare a draft from an approved opportunity.</AdminEmptyState>
        : <div role="region" aria-label="Staged specification ledger" tabIndex={0} style={{ overflowX: "auto", maxWidth: "100%", border: "1px solid var(--admin-line)", background: "#fff" }}><table style={{ width: "100%", minWidth: 1030, borderCollapse: "collapse", textAlign: "left" }}><thead><tr><th scope="col">Specification / source</th><th scope="col">Template & writer</th><th scope="col">QA / release decision</th><th scope="col">Publication record</th><th scope="col">Action</th></tr></thead><tbody>{shown.map(({ spec: s, decision }, index) => {
          const isPublished = published?.has(s.page_id) ?? false;
          const source = duplicateIds.has(s.page_spec_id) ? "Overlapping ID · inspect source/version" : s.page_spec_id === SAMPLE_PAGE_SPEC.page_spec_id ? "Handcrafted sample" : committedIds.has(s.page_spec_id) ? "Committed factory fixture" : "Runtime staged specification";
          return <tr key={`${s.page_spec_id}:${offset + index}`}>
            <td style={{ minWidth: 240 }}><strong>{s.h1}</strong>{isRetiredLegacySpec(s) && <><br /><AdminStatus tone="warning">Retired</AdminStatus><p className="adm-small">{LEGACY_DOOR_RETIREMENT.decision_ref} · history retained; not served or publishable</p></>}<div className="adm-small">{s.problem_family ?? "Family not recorded"} · specification v{s.version}</div><div className="mono" style={{ marginTop: 8 }}>{s.page_spec_id}</div><div className="adm-small">{source}</div><div className="mono" style={{ margin: "8px 0" }}>{s.canonical_path}</div><Link href={`/admin/pages/${encodeURIComponent(s.page_spec_id)}`} style={{ color: "#2d5c68" }}>Inspect / edit specification →</Link><br /><Link href={`/admin/pages/${encodeURIComponent(s.page_spec_id)}/preview`} className="adm-small">Preview by specification ID</Link></td>
            <td style={{ minWidth: 170 }}><AdminStatus tone={s.door_template ? "neutral" : "warning"}>{s.door_template ? "Frozen v43 binding" : "Legacy · no v43 binding"}</AdminStatus><div className="mono" style={{ marginTop: 8 }}>{s.template_id} · {s.template_version}</div><div className="adm-small" style={{ marginTop: 8 }}>Writer: {s.generation.model ?? "No model recorded"}</div><div className="adm-small">Value score: {s.user_value_score ?? "Unknown"} · deterministic heuristic</div><div className="adm-small">Spec status: {s.status}</div>{s.noindex_reason && <details style={{ marginTop: 8 }}><summary>Noindex reason</summary><p className="adm-small">{s.noindex_reason}</p></details>}</td>
            <td style={{ minWidth: 200 }}><AdminStatus tone={decision.release_eligible ? "neutral" : "warning"}>{decision.release_eligible ? "Queue eligible" : "Queue blocked"}</AdminStatus><div className="adm-small" style={{ marginTop: 8 }}>Recorded QA: {s.qa.state}<br />Current overall: {decision.qa.overall}<br />AI critic: {decision.qa.ai_critic?.status ?? "Not recorded"}</div><details style={{ marginTop: 8 }}><summary>Gate details</summary><ul className="adm-small" style={{ paddingLeft: 18 }}>{decision.reasons.map((reason, i) => <li key={i}>{reason}</li>)}</ul>{s.qa.reasons.length > 0 && <><strong className="adm-small">Recorded QA notes</strong><ul className="adm-small" style={{ paddingLeft: 18 }}>{s.qa.reasons.map((reason, i) => <li key={i}>{reason}</li>)}</ul></>}</details></td>
            <td style={{ minWidth: 160 }}><AdminStatus tone={!published ? "warning" : "neutral"}>{!published ? "Unverified" : isPublished ? "Page ID in published set" : "Page ID outside published set"}</AdminStatus><div className="mono" style={{ marginTop: 8 }}>{s.page_id}</div><p className="adm-small">Page-level record, not proof that this version is serving.</p></td>
            <td style={{ minWidth: 190 }}>{decision.release_eligible ? (
              <PublishButton pageSpecId={s.page_spec_id} published={isPublished} canPublish={canPublish} disabledReason={disabledReason} />
            ) : <span className="adm-small">{decision.qa.blockers.length > 0 ? `${decision.qa.blockers.length} blocker(s) — no override exists` : "Current release gate has not passed"}</span>}</td>
          </tr>;
        })}</tbody></table></div>}
    {queue && <nav aria-label="Specification result pages" style={{ display: "flex", gap: 12, justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", marginTop: 22 }}>{page > 1 ? <Link className="btn btn-ghost" href={pageHref(page - 1)}>← Previous</Link> : <span className="adm-small">Start of results</span>}<span className="adm-small">Page {page} of {pageCount} · up to {PAGE_SIZE} specifications</span>{page < pageCount ? <Link className="btn btn-ghost" href={pageHref(page + 1)}>Next →</Link> : <span className="adm-small">End of results</span>}</nav>}
    {skipped.length > 0 && <details className="cell" style={{ marginTop: 28 }}><summary>Committed factory skips · {skipped.length} records</summary><p className="adm-small">Reasons from the committed factory artifact; this is not the result of the most recent runtime build.</p><ul className="adm-small" style={{ paddingLeft: 18 }}>{skipped.map((item, index) => <li key={`${item.keyword}:${index}`}>{item.keyword} — {item.reason}</li>)}</ul></details>}
  </div>;
}
