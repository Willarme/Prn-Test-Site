import type { SearchOpportunity } from "@/domain/search/contracts";
import { isOwnerApproved, type OpportunityDecision } from "@/domain/search/decision";
import { newPageEligibility, pageEligibleIntent } from "@/domain/search/factory";
import { sameIntentFamily } from "@/domain/search/intent-family";
import {
  DEFAULT_PAGE_FACTORY_POLICY,
  type PageFactoryPolicy,
} from "@/domain/search/page-factory-policy";
import { lintPageBeforeQa, type LintFinding } from "@/domain/search/page-lint";
import {
  applyOwnerEdit,
  regeneratePage,
  stageNewPage,
  type OwnerEdit,
} from "@/domain/search/page-registry";
import type { IntentPage, PageSpec } from "@/domain/search/pages";
import {
  serviceClientProvider,
  type PlatformClientProvider,
} from "@/platform/db/client";
import { checkKillSwitch } from "@/platform/killswitch";
import { recordAgentRun } from "@/platform/runs/ledger";
import {
  emitPageDraftCreated,
  emitPageRefreshed,
  emitPageStaged,
} from "@/platform/search/page-events";
import { pageRegistryStore } from "@/platform/search/page-registry-store";

/**
 * THE A05 GENERATION RUN — condition C9 / pre-answer 6.
 *
 * RUN MODE, AND WHY NOT THE ORCHESTRATOR. A05 §2, §6 and §11 all present the
 * Durable Workflow Orchestrator as A05's default run mode without disclosing
 * that A00 shipped it as `WORKFLOW_ORCHESTRATOR_STATUS =
 * "DEFERRED_INTERFACE_ONLY"`, with a header stating "NOTHING implements or
 * calls it" and a standing test asserting nothing imports it. Choosing it would
 * silently make A05 the first implementer of an entire durable-execution
 * engine. So per C9 this runs two ways and no other:
 *
 *   1. an admin-triggered, owner-gated API route (/api/admin/pages/generate)
 *   2. a direct call from A04's approval flow (platform/search/opportunity-decisions)
 *
 * both IDEMPOTENT ON opportunity_id. TODO-ASK-OWNER (Joshua) — pre-answer 6 is
 * tagged josh-ratify-later: run mode is an architecture commitment and the
 * orchestrator deferral was a deliberate A00 decision he approved, so he should
 * ratify this rather than inherit it.
 *
 * THE KILL SWITCH IS A HARD STOP, SYNCHRONOUSLY, BEFORE ANY WORK (C11/C12b).
 * §7's "kill switch and budget are hard stops, not soft warnings" is
 * implemented as `checkKillSwitch("A05")` against the shipped in-memory cache,
 * NOT as a database read — the ref `agent:A05` has been registered in
 * agents/registry.ts since A00 and A05 never called it until now.
 *
 * NO BUDGET BRAKE HERE, AND THAT IS NOT AN OMISSION. A05 makes NO model call
 * and no vendor call: generation is 100% content-bank (pre-answer 3, "ship 100%
 * static"), so there is no spend to brake. `cost_usd: 0` on every ledger row is
 * a measurement, not a placeholder. A04 owns the vendor budget brake because
 * A04 is the one that spends.
 */

const A05 = "A05";

export type SkipReason =
  | "not_owner_approved"
  | "ineligible_intent"
  | "not_new_page_eligible"
  | "already_has_page"
  | "cannibalizes_existing"
  | "lint_blocked"
  | "compile_error";

export interface SkippedOpportunity {
  search_opportunity_id: string;
  keyword: string;
  reason: SkipReason;
  detail: string;
  findings?: LintFinding[];
}

export interface GenerationRunInput {
  opportunities: readonly SearchOpportunity[];
  decisions?: readonly OpportunityDecision[];
  /** Pages that already exist — the idempotency and cannibalization corpus. */
  existingPages: readonly IntentPage[];
  existingSpecs: readonly PageSpec[];
  policy?: PageFactoryPolicy;
  /**
   * `policy.page_eligible_intent_types` — WHICH INTENTS MAY BECOME DOORS
   * (inspection F3). It lives on the TOP-LEVEL SeoFactoryPolicy document (A04
   * owns it) rather than in A05's `page_factory.*` sub-block, which is why it
   * arrives as its own field instead of riding along on `policy` above.
   *
   * OMITTING IT IS FAIL-CLOSED, NOT OPEN: the shipped `["problem"]` ruling
   * applies. A caller that forgets this gets PRN's current behaviour, never an
   * unguarded factory — which is the failure this field exists to end.
   */
  eligible_intent_types?: readonly string[];
  maxPages: number;
  now?: () => string;
  tenant_id?: string;
  trigger: "admin_action" | "request";
}

export interface GenerationRunResult {
  run_id: string | null;
  /** Non-null when the kill switch stopped the run before any work. */
  halted: { scope: string; reason: string | null } | null;
  staged: Array<{ spec: PageSpec; page: IntentPage; regenerated: boolean }>;
  skipped: SkippedOpportunity[];
  events: string[];
}

function nowIso(): string {
  return new Date().toISOString().replace(/\.\d+Z$/, "Z");
}

/**
 * THE CANNIBALIZATION PRE-GATE (C13, coherence issue 15).
 *
 * REUSE, DO NOT REIMPLEMENT — and the split is deliberate on both sides. A04
 * and A05 MAY share `sameIntentFamily` (extracted into domain/search/
 * intent-family.ts by A04's build): they are two stages of one pipeline, and
 * disagreeing about what "the same search need" means would produce pages that
 * contradict the queue that authorized them.
 *
 * A06 MUST REIMPLEMENT IT INDEPENDENTLY (Master Todo T1-09: "an inspector that
 * shares its subject's logic is not an inspector"). A05 REUSES; A06
 * REIMPLEMENTS. This build does not wire A06 and does not touch qa.ts.
 *
 * This is a PRE-gate: it stops a duplicate door from ever being built, which is
 * strictly cheaper than building it and having A06 reject it. It does not
 * replace A06's independent check — that is the point of having two.
 */
export function cannibalizationConflict(
  keyword: string,
  canonicalPath: string,
  existingSpecs: readonly PageSpec[],
  existingPages: readonly IntentPage[]
): string | null {
  const pathClash = existingPages.find(
    (p) => p.canonical_path === canonicalPath && p.lifecycle_status !== "RETIRED"
  );
  if (pathClash) return `an existing page already occupies ${canonicalPath}`;
  // Also against SPECS, not just registry rows: the six committed staged doors
  // and the handcrafted sample predate the registry table entirely, so a
  // registry-only check would happily build a second page on top of one of
  // them.
  const specPathClash = existingSpecs.find(
    (s) => s.canonical_path === canonicalPath && s.status !== "RETIRED"
  );
  if (specPathClash) return `an existing page already occupies ${canonicalPath}`;

  const overlap = existingSpecs.find((s) => sameIntentFamily(s.primary_query, keyword));
  if (overlap) {
    return `intent overlaps the existing page "${overlap.primary_query}" — expand or merge it, never a second door (doorway rule)`;
  }
  return null;
}

/**
 * Run the factory over a batch of opportunities.
 *
 * IDEMPOTENT ON opportunity_id: an opportunity that already has a page in the
 * registry is skipped as `already_has_page`, so calling this twice with the
 * same input produces the same registry and no duplicate rows. Regeneration is
 * a separate, explicit call (`regenerateExistingPage`), never a side effect of
 * running generation again.
 */
export async function runPageFactory(
  input: GenerationRunInput,
  clientProvider: PlatformClientProvider = serviceClientProvider
): Promise<GenerationRunResult> {
  const now = input.now ?? nowIso;
  const policy = input.policy ?? DEFAULT_PAGE_FACTORY_POLICY;
  const decisions = input.decisions ?? [];

  // 1. HARD STOP, synchronous, before any work at all.
  const kill = checkKillSwitch(A05, clientProvider);
  if (kill.engaged) {
    return {
      run_id: null,
      halted: { scope: kill.scope ?? "GLOBAL", reason: kill.reason ?? null },
      staged: [],
      skipped: [],
      events: [],
    };
  }

  const staged: GenerationRunResult["staged"] = [];
  const skipped: SkippedOpportunity[] = [];
  const events: string[] = [];

  // The corpus grows as the run proceeds, so two candidates in the SAME batch
  // cannot both claim one intent family.
  const pages = [...input.existingPages];
  const specs = [...input.existingSpecs];

  for (const opportunity of input.opportunities) {
    if (staged.length >= input.maxPages) break;

    // 2. THE OWNER'S DECISION — the one gate (seam 2).
    if (!isOwnerApproved(opportunity, decisions)) {
      skipped.push({
        search_opportunity_id: opportunity.search_opportunity_id,
        keyword: opportunity.keyword,
        reason: "not_owner_approved",
        detail: "no owner approval — A04's recommendation is an opinion, not a decision",
      });
      continue;
    }
    /**
     * 2b. WHICH INTENTS MAY BECOME DOORS (inspection F3) — the owner's
     *     `page_eligible_intent_types`, enforced HERE because here is the one
     *     place every entry point passes through. It used to be enforced only in
     *     tools/run-factory.ts, so both shipped run modes walked straight past
     *     it and an accepted "uuid generator" became a door page with
     *     home-repair safety advice on it.
     *
     *     REPORTED BY NAME, NEVER DROPPED — its own `ineligible_intent` bucket,
     *     for the same reason `not_new_page` exists: an owner decision that
     *     produces no page must say so out loud. The owner said yes; policy says
     *     this kind of topic is not a door. Both facts survive.
     */
    const intentVerdict = pageEligibleIntent(opportunity, input.eligible_intent_types);
    if (!intentVerdict.eligible) {
      skipped.push({
        search_opportunity_id: opportunity.search_opportunity_id,
        keyword: opportunity.keyword,
        reason: "ineligible_intent",
        detail: intentVerdict.reason,
      });
      continue;
    }

    const eligibility = newPageEligibility(opportunity, decisions);
    if (!eligibility.eligible) {
      skipped.push({
        search_opportunity_id: opportunity.search_opportunity_id,
        keyword: opportunity.keyword,
        reason: "not_new_page_eligible",
        detail: eligibility.reason,
      });
      continue;
    }

    // 3. IDEMPOTENCY on opportunity_id.
    const already = specs.find(
      (s) => s.search_opportunity_id === opportunity.search_opportunity_id
    );
    if (already) {
      skipped.push({
        search_opportunity_id: opportunity.search_opportunity_id,
        keyword: opportunity.keyword,
        reason: "already_has_page",
        detail: `page ${already.page_id} already exists for this opportunity`,
      });
      continue;
    }

    // 4. COMPILE.
    let built: { spec: PageSpec; page: IntentPage };
    try {
      const result = stageNewPage(
        opportunity,
        { now, policy, tenant_id: input.tenant_id },
        { tenant_id: input.tenant_id }
      );
      built = { spec: result.spec, page: result.page };
    } catch (err) {
      skipped.push({
        search_opportunity_id: opportunity.search_opportunity_id,
        keyword: opportunity.keyword,
        reason: "compile_error",
        detail: err instanceof Error ? err.message : String(err),
      });
      continue;
    }

    // 5. CANNIBALIZATION PRE-GATE.
    const conflict = cannibalizationConflict(
      opportunity.keyword,
      built.spec.canonical_path,
      specs,
      pages
    );
    if (conflict) {
      skipped.push({
        search_opportunity_id: opportunity.search_opportunity_id,
        keyword: opportunity.keyword,
        reason: "cannibalizes_existing",
        detail: conflict,
      });
      continue;
    }

    // 6. LINT PRE-FILTER — manufactured urgency / directory framing / markup.
    const lint = lintPageBeforeQa(built.spec, policy);
    if (!lint.passed) {
      skipped.push({
        search_opportunity_id: opportunity.search_opportunity_id,
        keyword: opportunity.keyword,
        reason: "lint_blocked",
        detail: lint.findings.map((f) => `${f.check}@${f.where}`).join("; "),
        findings: lint.findings,
      });
      continue;
    }

    // 7. PERSIST. Fail-LOUD: a page the admin was told about must exist.
    await pageRegistryStore(clientProvider).saveStagedPage(built.spec, built.page);
    specs.push(built.spec);
    pages.push(built.page);
    staged.push({ ...built, regenerated: false });

    events.push(
      await emitPageDraftCreated(
        {
          page_id: built.spec.page_id,
          page_spec_id: built.spec.page_spec_id,
          search_opportunity_id: opportunity.search_opportunity_id,
          template_id: built.spec.template_id,
          template_version: built.spec.template_version,
        },
        clientProvider
      )
    );
    events.push(
      await emitPageStaged(
        {
          page_id: built.spec.page_id,
          page_spec_id: built.spec.page_spec_id,
          canonical_path: built.spec.canonical_path,
          search_opportunity_id: opportunity.search_opportunity_id,
        },
        clientProvider
      )
    );
  }

  // 8. ONE LEDGER ROW PER RUN (C9), fail-soft per C11 — the ledger is
  //    provenance, never the gate, and its table is written-but-not-applied.
  let runId: string | null = null;
  try {
    const record = await recordAgentRun(
      {
        agent_id: A05,
        tenant_id: input.tenant_id ?? "prn",
        trigger: input.trigger,
        input_ids: input.opportunities.map((o) => o.search_opportunity_id),
        capabilities_used: ["seo.build_candidate_pages"],
        tool_provider: "deterministic-stand-in",
        tool_model_version: "content-bank-v1",
        outputs_summary: {
          template_id: policy.template_id,
          template_version: policy.template_version,
          pages_staged: staged.length,
          page_ids: staged.map((s) => s.spec.page_id),
          skipped: skipped.length,
          skipped_by_reason: skipped.reduce<Record<string, number>>((acc, s) => {
            acc[s.reason] = (acc[s.reason] ?? 0) + 1;
            return acc;
          }, {}),
        },
        decisions: staged.map((s) => `stage:${s.spec.page_id}`),
        // A05 makes no model call and no vendor call. Zero is measured.
        cost_usd: 0,
        actions_taken: staged.map((s) => `page.staged:${s.spec.page_id}`),
      },
      clientProvider
    );
    runId = record.run_id;
  } catch {
    /* ledger is provenance, never the gate */
  }

  return { run_id: runId, halted: null, staged, skipped, events };
}

export interface OwnerEditInput {
  page: IntentPage;
  previousSpec: PageSpec;
  edit: OwnerEdit;
  edited_by: string;
  policy?: PageFactoryPolicy;
  now?: () => string;
}

export interface OwnerEditResult {
  spec: PageSpec | null;
  page: IntentPage | null;
  edited_fields: string[];
  blocked: LintFinding[];
}

/**
 * THE OWNER'S EDIT of a staged page's unique fields (done-when: "Admin can
 * view/edit a staged page's unique fields").
 *
 * THE LINT STILL RUNS. An owner typing "compare providers and choose from
 * hundreds of contractors" into a meta description is the same canon violation
 * as the content bank producing it, and the guardrail that only applies to the
 * machine is not a guardrail. A blocked edit changes nothing and returns the
 * findings.
 *
 * NO KILL-SWITCH GATE HERE, ON PURPOSE — the same reasoning A04's decision path
 * records. `checkKillSwitch("A05")` pauses THE AGENT: its generation runs. A
 * human correcting a page the agent already produced is not agent activity, and
 * a paused agent that also froze the owner's ability to fix its output would be
 * exactly backwards.
 *
 * The edit is a NEW VERSION, never an in-place rewrite — see applyOwnerEdit for
 * why that is a safety property rather than tidiness.
 */
export async function editStagedPage(
  input: OwnerEditInput,
  clientProvider: PlatformClientProvider = serviceClientProvider
): Promise<OwnerEditResult> {
  const now = input.now ?? nowIso;
  const policy = input.policy ?? DEFAULT_PAGE_FACTORY_POLICY;

  const result = applyOwnerEdit(
    input.page,
    input.previousSpec,
    input.edit,
    { now },
    input.edited_by
  );

  const lint = lintPageBeforeQa(result.spec, policy);
  if (!lint.passed) {
    return { spec: null, page: null, edited_fields: [], blocked: lint.findings };
  }

  await pageRegistryStore(clientProvider).saveStagedPage(result.spec, result.page);

  try {
    await recordAgentRun(
      {
        agent_id: A05,
        tenant_id: input.page.tenant_id ?? "prn",
        trigger: "admin_action",
        input_ids: [input.page.page_id],
        capabilities_used: ["seo.build_candidate_pages"],
        outputs_summary: {
          page_id: result.spec.page_id,
          page_spec_id: result.spec.page_spec_id,
          version: result.spec.version,
          edited_fields: result.edited_fields,
          edited_by: input.edited_by,
        },
        cost_usd: 0,
        actions_taken: [`page.owner_edited:${result.spec.page_id}`],
      },
      clientProvider
    );
  } catch {
    /* provenance, never the gate */
  }

  await emitPageRefreshed(
    {
      page_id: result.spec.page_id,
      page_spec_id: result.spec.page_spec_id,
      version: String(result.spec.version),
      reason: `owner edit: ${result.edited_fields.join(", ") || "no change"}`,
    },
    clientProvider
  );

  return {
    spec: result.spec,
    page: result.page,
    edited_fields: result.edited_fields,
    blocked: [],
  };
}

export interface RegenerateInput {
  page: IntentPage;
  previousSpec: PageSpec;
  opportunity: SearchOpportunity;
  reason: string;
  policy?: PageFactoryPolicy;
  now?: () => string;
  trigger: "admin_action" | "request";
}

/**
 * Regenerate ONE existing page. Explicit and separate from generation so a
 * re-run of the factory can never quietly rewrite pages that already exist.
 * Maps REFRESH -> STAGED through the shipped lifecycle guards and emits
 * `page.refreshed` — the shipped name for the moment A05 §5 calls
 * `page.regenerated`.
 */
export async function regenerateExistingPage(
  input: RegenerateInput,
  clientProvider: PlatformClientProvider = serviceClientProvider
): Promise<GenerationRunResult> {
  const now = input.now ?? nowIso;
  const policy = input.policy ?? DEFAULT_PAGE_FACTORY_POLICY;

  const kill = checkKillSwitch(A05, clientProvider);
  if (kill.engaged) {
    return {
      run_id: null,
      halted: { scope: kill.scope ?? "GLOBAL", reason: kill.reason ?? null },
      staged: [],
      skipped: [],
      events: [],
    };
  }

  const result = regeneratePage(
    input.page,
    input.previousSpec,
    input.opportunity,
    { now, policy, tenant_id: input.page.tenant_id },
    input.reason
  );

  const lint = lintPageBeforeQa(result.spec, policy);
  if (!lint.passed) {
    return {
      run_id: null,
      halted: null,
      staged: [],
      skipped: [
        {
          search_opportunity_id: input.opportunity.search_opportunity_id,
          keyword: input.opportunity.keyword,
          reason: "lint_blocked",
          detail: lint.findings.map((f) => `${f.check}@${f.where}`).join("; "),
          findings: lint.findings,
        },
      ],
      events: [],
    };
  }

  await pageRegistryStore(clientProvider).saveStagedPage(result.spec, result.page);

  const events = [
    await emitPageRefreshed(
      {
        page_id: result.spec.page_id,
        page_spec_id: result.spec.page_spec_id,
        version: String(result.spec.version),
        reason: input.reason,
        transitions: result.transitions.map((t) => `${t.from}->${t.to}`).join(","),
      },
      clientProvider
    ),
  ];

  let runId: string | null = null;
  try {
    const record = await recordAgentRun(
      {
        agent_id: A05,
        tenant_id: input.page.tenant_id ?? "prn",
        trigger: input.trigger,
        input_ids: [input.opportunity.search_opportunity_id, input.page.page_id],
        capabilities_used: ["seo.build_candidate_pages"],
        tool_provider: "deterministic-stand-in",
        tool_model_version: "content-bank-v1",
        outputs_summary: {
          page_id: result.spec.page_id,
          page_spec_id: result.spec.page_spec_id,
          version: result.spec.version,
          reason: input.reason,
          transitions: result.transitions,
        },
        cost_usd: 0,
        actions_taken: [`page.refreshed:${result.spec.page_id}`],
      },
      clientProvider
    );
    runId = record.run_id;
  } catch {
    /* provenance, never the gate */
  }

  return {
    run_id: runId,
    halted: null,
    staged: [{ spec: result.spec, page: result.page, regenerated: true }],
    skipped: [],
    events,
  };
}
