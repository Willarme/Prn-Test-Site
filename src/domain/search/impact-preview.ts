import type { IntentPage, PageSpec } from "@/domain/search/pages";
import type { TemplateSpec } from "@/domain/search/template";

/**
 * THE IMPACT PREVIEW — condition C12(a), the first of the three §7 guardrails
 * that §11 dropped.
 *
 * WHY IT MATTERS THAT §11 DROPPED IT. §11 declares itself "fully
 * self-contained", so anything absent from it does not exist for the build
 * session. What went missing here is canon's own guardrail row, quoted in A05
 * §7: "any approved template edit that would regenerate or otherwise affect
 * existing staged/live pages must surface an Impact Preview to the owner before
 * it executes — never a silent mass-regeneration."
 *
 * A template change is the single highest-blast-radius action A05 can take. One
 * edit rewrites EVERY page built from that template, including published ones,
 * and the owner is the only person who can weigh that. Without this, "improve
 * the safe-checks heading" and "rewrite the entire public portfolio" are the
 * same click.
 *
 * THIS MODULE IS PURE. It computes what WOULD change and says so; it executes
 * nothing. The gate that refuses to cascade lives in
 * platform/search/template-change.ts and FAILS CLOSED.
 */

export interface AffectedPage {
  page_id: string;
  canonical_path: string;
  lifecycle_status: string;
  current_version: number;
  /** Published pages are the part of the blast radius the public can see. */
  is_published: boolean;
}

export interface TemplateDiff {
  added_slots: string[];
  removed_slots: string[];
  reordered: boolean;
  heading_changes: Array<{ slot_id: string; from: string | null; to: string | null }>;
  intake_moved: boolean;
}

export interface ImpactPreview {
  template_id: string;
  from_version: string;
  to_version: string;
  diff: TemplateDiff;
  affected: AffectedPage[];
  counts: {
    total: number;
    published: number;
    staged: number;
    qa_pass: number;
    other: number;
  };
  /** Plain-language summary for the owner. IDs and counts only, never page copy. */
  summary: string;
  /** ALWAYS true. There is no size of template change that skips the owner. */
  requires_owner_approval: true;
}

export function diffTemplates(from: TemplateSpec, to: TemplateSpec): TemplateDiff {
  const fromIds = from.blocks.map((b) => b.slot_id);
  const toIds = to.blocks.map((b) => b.slot_id);
  const added = toIds.filter((id) => !fromIds.includes(id));
  const removed = fromIds.filter((id) => !toIds.includes(id));
  const survivingFrom = fromIds.filter((id) => toIds.includes(id));
  const survivingTo = toIds.filter((id) => fromIds.includes(id));

  const headingChanges: TemplateDiff["heading_changes"] = [];
  for (const slotId of survivingFrom) {
    const a = from.blocks.find((b) => b.slot_id === slotId)!;
    const b = to.blocks.find((x) => x.slot_id === slotId)!;
    if (a.default_heading !== b.default_heading) {
      headingChanges.push({ slot_id: slotId, from: a.default_heading, to: b.default_heading });
    }
  }

  return {
    added_slots: added,
    removed_slots: removed,
    reordered: survivingFrom.join("|") !== survivingTo.join("|"),
    heading_changes: headingChanges,
    intake_moved:
      from.intake_placement.mode !== to.intake_placement.mode ||
      from.intake_placement.after_slot_id !== to.intake_placement.after_slot_id,
  };
}

/**
 * What a template change would touch. `pages` and `specs` are the live registry
 * and the live specs; a page is affected when its CURRENT spec was built from
 * the template being changed.
 */
export function buildImpactPreview(
  from: TemplateSpec,
  to: TemplateSpec,
  pages: readonly IntentPage[],
  specs: readonly PageSpec[],
  publishedPageIds: ReadonlySet<string> = new Set()
): ImpactPreview {
  const affected: AffectedPage[] = [];
  for (const page of pages) {
    const spec = specs.find((s) => s.page_spec_id === page.current_page_spec_id);
    if (!spec) continue;
    if (spec.template_id !== from.template_id) continue;
    if (spec.template_version !== from.version) continue;
    affected.push({
      page_id: page.page_id,
      canonical_path: page.canonical_path,
      lifecycle_status: page.lifecycle_status,
      current_version: spec.version,
      is_published: page.lifecycle_status === "PUBLISHED" || publishedPageIds.has(page.page_id),
    });
  }

  const counts = {
    total: affected.length,
    published: affected.filter((a) => a.is_published).length,
    staged: affected.filter((a) => a.lifecycle_status === "STAGED").length,
    qa_pass: affected.filter((a) => a.lifecycle_status === "QA_PASS").length,
    other: 0,
  };
  counts.other = counts.total - counts.published - counts.staged - counts.qa_pass;

  const diff = diffTemplates(from, to);
  const changeParts: string[] = [];
  if (diff.added_slots.length) changeParts.push(`adds ${diff.added_slots.join(", ")}`);
  if (diff.removed_slots.length) changeParts.push(`REMOVES ${diff.removed_slots.join(", ")}`);
  if (diff.reordered) changeParts.push("reorders the remaining sections");
  if (diff.heading_changes.length)
    changeParts.push(`changes ${diff.heading_changes.length} heading(s)`);
  if (diff.intake_moved) changeParts.push("MOVES the intake box");
  if (changeParts.length === 0) changeParts.push("changes the version only");

  const summary =
    `Template ${from.template_id} ${from.version} -> ${to.version} ${changeParts.join("; ")}. ` +
    `${counts.total} page(s) would be regenerated: ${counts.published} PUBLISHED, ` +
    `${counts.staged} STAGED, ${counts.qa_pass} QA_PASS, ${counts.other} other. ` +
    (counts.published > 0
      ? `${counts.published} of these are live to the public and their content would change.`
      : "None of these are live to the public.") +
    " Every regenerated page returns to STAGED with qa.state PENDING and must pass QA and your publish action again.";

  return {
    template_id: from.template_id,
    from_version: from.version,
    to_version: to.version,
    diff,
    affected,
    counts,
    summary,
    requires_owner_approval: true,
  };
}
