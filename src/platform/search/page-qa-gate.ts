import { registryRowFor } from "@/domain/search/page-registry";
import type { IntentPage, PageSpec } from "@/domain/search/pages";
import type { SeoFactoryPolicy } from "@/domain/search/policy";
import { evaluateReleaseForPublish, type ReleaseDecision } from "@/domain/search/qa";
import { allStagedSpecs, policyStore } from "@/platform/admin/data";
import { listApprovals, resolveApproval } from "@/platform/approvals/center";
import {
  serviceClientProvider,
  type PlatformClientProvider,
} from "@/platform/db/client";
import { pageRegistryStore } from "@/platform/search/page-registry-store";

/**
 * THE PUBLISH GATE'S ONE INPUT — condition C10, coherence report issue 6.
 *
 * WHAT WAS WRONG. The audit found three candidate gates: `qa.state === "PASS"`
 * (live, enforcing, in the route), `release_eligible` (A06's new field) and the
 * Approval Center (which the publish route never touches). Its instruction is
 * exact: "one server-side condition. If `release_eligible` ships, the publish
 * route must be rewired in the same commit so `qa.state === 'PASS'` is DERIVED
 * FROM it, not checked beside it ... Never leave the weaker gate alive next to
 * the new one."
 *
 * SO THE ROUTE ASKS THIS MODULE ONE QUESTION AND READS ONE BOOLEAN. Everything
 * the old route used to test itself now lives inside
 * `evaluateReleaseForPublish` as a conjunct — see that function for the three
 * conjuncts and why each is load-bearing. The route no longer mentions
 * `qa.state` at all.
 *
 * 409 PARITY IS PROVABLE, not asserted. The recorded-verdict conjunct
 * (`spec.qa.state === "PASS"`) IS the old gate, so the new condition is
 * `old_gate AND live_reverification AND human_gate_intact` — strictly no weaker
 * than what shipped. Every page that returned 409 before returns 409 now, and
 * tests/a06.one-publish-gate.test.ts walks the whole committed portfolio to show
 * the new gate's answer equals the old gate's answer on every one of them.
 *
 * THE APPROVAL CENTER IS THE RECORD, NOT A SECOND ACTUATOR. Issue 6 again:
 * "A06 §6's claim that the Approval Center is the publish gate is false today —
 * restate as 'A06 files an Approval Center item; the publish action remains the
 * owner-gated route.'" `resolvePagePublishApproval` below closes the item the QA
 * run filed; it is never consulted before publishing and it can never authorize
 * one.
 */

export interface PublishGateInput {
  page_spec_id: string;
  clientProvider?: PlatformClientProvider;
}

export interface PublishGateResult {
  spec: PageSpec;
  decision: ReleaseDecision;
  policy: SeoFactoryPolicy;
}

/**
 * The corpus A06 checks a page against, as a registry snapshot.
 *
 * The committed portfolio predates the `intent_page` table entirely, so a
 * registry read alone would return nothing and every internal link on a
 * committed page would fail to resolve — a fail-closed check firing on the
 * absence of a table rather than on a real defect. Derived rows fill that in
 * from the specs themselves; real store rows WIN where both exist, because a
 * store row carries live lifecycle state a spec cannot.
 */
export async function pageRegistrySnapshot(
  specs: readonly PageSpec[],
  clientProvider: PlatformClientProvider = serviceClientProvider
): Promise<IntentPage[]> {
  let stored: IntentPage[] = [];
  try {
    stored = await pageRegistryStore(clientProvider).listPages();
  } catch {
    /* the registry table is written-but-not-applied; derive and carry on */
  }
  const byId = new Map<string, IntentPage>();
  for (const spec of specs) {
    try {
      byId.set(spec.page_id, registryRowFor(spec, spec.created_at));
    } catch {
      /* a spec that cannot produce a row simply contributes none */
    }
  }
  for (const row of stored) byId.set(row.page_id, row);
  return [...byId.values()];
}

/**
 * Resolve the ONE release condition for one page. Returns null when no such
 * page exists, which the route turns into its existing 404.
 */
export async function publishGate(input: PublishGateInput): Promise<PublishGateResult | null> {
  const clientProvider = input.clientProvider ?? serviceClientProvider;
  const specs = await allStagedSpecs();
  const spec = specs.find((s) => s.page_spec_id === input.page_spec_id);
  if (!spec) return null;

  const policy = await policyStore().getActive();
  const registry = await pageRegistrySnapshot(specs, clientProvider);

  const decision = evaluateReleaseForPublish(spec, {
    existing: specs,
    registry,
    // A06's own namespaced sub-block — per tenant, runtime-editable (C8/C9).
    policy: policy.page_qa,
    min_user_value_score: policy.min_user_value_score,
    // The human gate, read live. release_eligible fails closed the moment this
    // stops being intact (pre-answer 1 point 2).
    human_gate: {
      publish_mode: policy.publish_mode,
      human_approval_required: policy.human_approval_required,
    },
    tenant_id: spec.tenant_id,
  });

  return { spec, decision, policy };
}

/**
 * THE OWNER'S PUBLISH QUEUE, as the admin surface reads it — every staged page
 * with the SAME decision the publish route will make.
 *
 * ONE COMPUTATION FOR THE WHOLE LIST, not one per row: the policy and the
 * registry are read once. That matters for more than speed — a per-row read
 * could show one page judged under a policy another page was not, and a queue
 * whose rows disagree about the rules is worse than no queue.
 *
 * IT IS THE SAME FUNCTION THE ROUTE CALLS. The admin list showing "ready" while
 * the route returns 409 (or the reverse) is exactly the class of drift the
 * one-gate discipline exists to prevent, so the surface does not get its own
 * shortcut.
 */
export async function publishQueueSnapshot(
  clientProvider: PlatformClientProvider = serviceClientProvider
): Promise<Array<{ spec: PageSpec; decision: ReleaseDecision }>> {
  const specs = await allStagedSpecs();
  const policy = await policyStore().getActive();
  const registry = await pageRegistrySnapshot(specs, clientProvider);

  return specs.map((spec) => ({
    spec,
    decision: evaluateReleaseForPublish(spec, {
      existing: specs,
      registry,
      policy: policy.page_qa,
      min_user_value_score: policy.min_user_value_score,
      human_gate: {
        publish_mode: policy.publish_mode,
        human_approval_required: policy.human_approval_required,
      },
      tenant_id: spec.tenant_id,
    }),
  }));
}

/**
 * Close the Approval Center item A06's QA run filed for this page, recording
 * that the owner acted.
 *
 * FAIL-SOFT AND NEVER LOAD-BEARING. Migration 00007's `approval_item` table is
 * written but NOT applied, so the queue is in-process only today and there is
 * frequently nothing to close. That is fine: the item is the RECORD of the ask,
 * the route is the ACT, and the act does not wait on the record. Returns the id
 * it resolved, or null.
 */
export async function resolvePagePublishApproval(
  pageSpecId: string,
  resolvedBy: string,
  clientProvider: PlatformClientProvider = serviceClientProvider
): Promise<string | null> {
  try {
    const items = await listApprovals(clientProvider);
    const match = items.find(
      (item) =>
        item.status === "PENDING" &&
        item.approval_kind === "seo.page_publish" &&
        JSON.stringify(item.proposed_change ?? {}).includes(pageSpecId)
    );
    if (!match) return null;
    const resolved = await resolveApproval(
      match.approval_id,
      { status: "APPROVED", resolved_by: resolvedBy },
      clientProvider
    );
    return resolved?.approval_id ?? null;
  } catch {
    return null;
  }
}
