import type { SearchOpportunity } from "@/domain/search/contracts";
import { buildImpactPreview, type ImpactPreview } from "@/domain/search/impact-preview";
import type { PageFactoryPolicy } from "@/domain/search/page-factory-policy";
import type { IntentPage, PageSpec } from "@/domain/search/pages";
import type { TemplateSpec } from "@/domain/search/template";
import { queueApproval, type ApprovalItem } from "@/platform/approvals/center";
import {
  serviceClientProvider,
  type PlatformClientProvider,
} from "@/platform/db/client";
import { regenerateExistingPage } from "@/platform/search/page-factory-run";

/**
 * THE GATE IN FRONT OF MASS REGENERATION — condition C12(a), fail closed.
 *
 * An approved template change cascading into a rewrite of every page built from
 * that template is the highest-blast-radius action A05 has. Canon's guardrail
 * row, quoted in A05 §7: an Impact Preview must reach the owner "before it
 * executes — never a silent mass-regeneration."
 *
 * FAIL-CLOSED IS THE DEFAULT AND THERE IS NO WAY AROUND IT. `cascade...` will
 * not run without an ApprovalItem that (a) exists, (b) is the item filed for
 * THIS preview, and (c) has been resolved APPROVED by a human. A missing,
 * PENDING, REJECTED or mismatched approval throws before a single page is
 * touched. There is deliberately no "force" parameter and no size threshold
 * below which the owner is skipped: `requires_owner_approval` is the literal
 * `true`, not a boolean.
 *
 * APPROVAL KIND — PROPOSED TO A08, NOT MINTED. The Approval Center's item
 * taxonomy (platform/approvals/kinds.ts) is A08's dictionary, registered by A08
 * as steward, and it carries no kind for a template change. A05 does not add
 * one for the same reason it does not add event names: an agent minting into a
 * contract its steward is then asked to ratify after the fact is exactly the
 * drift the coherence report exists to stop. `approval_kind` is OPTIONAL, so
 * the item is filed without one and the class is stated in `what_happened`,
 * and `A05_PROPOSED_APPROVAL_KINDS` below carries the proposal.
 */

export const A05_PROPOSED_APPROVAL_KINDS = [
  {
    proposed_kind: "seo.page_template_change",
    why:
      "An approved template edit cascades into regenerating every page built from it, including published ones. It is a different class of owner decision from seo.page_publish (one page) and from seo.opportunity_decision (one keyword), and issue 14's whole argument is that the owner should not face them in one undifferentiated list.",
  },
] as const;

export interface TemplateChangeRequest {
  from: TemplateSpec;
  to: TemplateSpec;
  pages: readonly IntentPage[];
  specs: readonly PageSpec[];
  publishedPageIds?: ReadonlySet<string>;
  requested_by: string;
  tenant_id?: string;
}

export interface PendingTemplateChange {
  preview: ImpactPreview;
  approval: ApprovalItem;
}

/**
 * Step one, always: compute the preview and put it in front of the owner.
 * Executes nothing.
 */
export async function proposeTemplateChange(
  request: TemplateChangeRequest,
  clientProvider: PlatformClientProvider = serviceClientProvider
): Promise<PendingTemplateChange> {
  const preview = buildImpactPreview(
    request.from,
    request.to,
    request.pages,
    request.specs,
    request.publishedPageIds ?? new Set()
  );

  const approval = await queueApproval(
    {
      agent_id: "A05",
      tenant_id: request.tenant_id ?? "prn",
      run_id: `tplchg_${request.from.template_id}_${request.from.version}_to_${request.to.version}`,
      // No approval_kind: the taxonomy is A08's and carries no template-change
      // member yet. See A05_PROPOSED_APPROVAL_KINDS above.
      what_happened: `TEMPLATE CHANGE — impact preview. ${preview.summary}`,
      // IDs, counts and enum values only. No page copy, no customer data.
      evidence: {
        template_id: preview.template_id,
        from_version: preview.from_version,
        to_version: preview.to_version,
        counts: preview.counts,
        affected_page_ids: preview.affected.map((a) => a.page_id),
        added_slots: preview.diff.added_slots,
        removed_slots: preview.diff.removed_slots,
        reordered: preview.diff.reordered,
        intake_moved: preview.diff.intake_moved,
      },
      impact: preview.summary,
      risk:
        preview.counts.published > 0
          ? `${preview.counts.published} live public page(s) would have their content rewritten. Each returns to STAGED and must pass QA and your publish action again before it is public in its new form.`
          : "No live public page is affected. Every regenerated page stays staged and noindexed.",
      reversibility: "reversible",
      proposed_change: {
        template_id: preview.template_id,
        from_version: preview.from_version,
        to_version: preview.to_version,
        pages_to_regenerate: preview.counts.total,
      },
    },
    clientProvider
  );

  return { preview, approval };
}

export class MassRegenerationBlocked extends Error {
  constructor(reason: string) {
    super(`Mass regeneration blocked: ${reason}`);
    this.name = "MassRegenerationBlocked";
  }
}

/**
 * THE FAILING-CLOSED CHECK. Called before any page is touched. Throws rather
 * than returning false, so a caller cannot ignore it by forgetting an `if`.
 */
export function assertTemplateChangeApproved(
  pending: PendingTemplateChange,
  approval: ApprovalItem | null
): void {
  if (!approval) {
    throw new MassRegenerationBlocked(
      "no Approval Center item — an Impact Preview must reach the owner before a template change cascades (A05 §7 guardrail, condition C12a)"
    );
  }
  if (approval.approval_id !== pending.approval.approval_id) {
    throw new MassRegenerationBlocked(
      `approval ${approval.approval_id} is not the item filed for this preview (${pending.approval.approval_id})`
    );
  }
  if (approval.status !== "APPROVED") {
    throw new MassRegenerationBlocked(
      `approval ${approval.approval_id} is ${approval.status}, not APPROVED — the owner has not said yes`
    );
  }
  if (!approval.resolved_by) {
    throw new MassRegenerationBlocked(
      `approval ${approval.approval_id} is APPROVED but records no resolver — a decision with no human attached is not a decision`
    );
  }
}

export interface CascadeInput {
  pending: PendingTemplateChange;
  approval: ApprovalItem | null;
  /** Resolver from page_id to the opportunity and spec the rebuild needs. */
  resolve: (pageId: string) => { page: IntentPage; spec: PageSpec; opportunity: SearchOpportunity } | null;
  policy?: PageFactoryPolicy;
  now?: () => string;
}

export interface CascadeResult {
  regenerated: string[];
  failed: Array<{ page_id: string; reason: string }>;
}

/**
 * Execute the cascade — ONLY after the gate above passes. Each page goes
 * through the ordinary single-page regeneration path, so every one of them gets
 * the lifecycle guards, the lint pre-filter, the kill-switch check and its own
 * event. There is no bulk path that skips those.
 */
export async function cascadeTemplateChange(
  input: CascadeInput,
  clientProvider: PlatformClientProvider = serviceClientProvider
): Promise<CascadeResult> {
  assertTemplateChangeApproved(input.pending, input.approval);

  const regenerated: string[] = [];
  const failed: CascadeResult["failed"] = [];

  for (const affected of input.pending.preview.affected) {
    const resolved = input.resolve(affected.page_id);
    if (!resolved) {
      failed.push({ page_id: affected.page_id, reason: "could not resolve the page's opportunity" });
      continue;
    }
    const result = await regenerateExistingPage(
      {
        page: resolved.page,
        previousSpec: resolved.spec,
        opportunity: resolved.opportunity,
        reason: `template ${input.pending.preview.template_id} ${input.pending.preview.from_version} -> ${input.pending.preview.to_version}, approved by ${input.approval?.resolved_by}`,
        policy: input.policy,
        now: input.now,
        trigger: "admin_action",
      },
      clientProvider
    );
    if (result.halted) {
      failed.push({ page_id: affected.page_id, reason: `kill switch engaged (${result.halted.scope})` });
      continue;
    }
    if (result.staged.length === 0) {
      failed.push({
        page_id: affected.page_id,
        reason: result.skipped[0]?.detail ?? "regeneration produced no page",
      });
      continue;
    }
    regenerated.push(affected.page_id);
  }

  return { regenerated, failed };
}
