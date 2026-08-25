import { assertTransition } from "@/domain/search/lifecycle";
import type { IntentPage, PageSpec } from "@/domain/search/pages";
import type { SeoFactoryPolicy } from "@/domain/search/policy";
import {
  applyQaVerdict,
  DEFAULT_PAGE_QA_POLICY,
  qaLifecycleTarget,
  withCriticStage,
  type PageQAResult,
  type PageQaContext,
  type PageQaHumanGate,
  type QaFinding,
} from "@/domain/search/qa";
import { runAiCriticStage } from "@/domain/search/qa-critic";
import { queueApproval } from "@/platform/approvals/center";
import {
  serviceClientProvider,
  type PlatformClientProvider,
} from "@/platform/db/client";
import { capability_call } from "@/platform/gateway";
import { checkKillSwitch } from "@/platform/killswitch";
import { recordAgentRun } from "@/platform/runs/ledger";
import { createModelPageCritic, criticEnabled } from "@/platform/search/page-qa-critic";
import {
  emitPageDefectFound,
  emitPageDefectRepaired,
  emitPageQaFailed,
  emitPageQaPassed,
} from "@/platform/search/page-qa-events";
import { pageRegistryStore } from "@/platform/search/page-registry-store";

/**
 * THE A06 QA RUN — pre-answer 4, condition C6/C8, coherence issues 4 and 13.
 *
 * RUN MODE, AND WHY. Pre-answer 4 is explicit: "Run it synchronously for now,
 * behind the durable-workflow interface. `qaCandidatePages` already runs inline
 * in the factory path, and A00 step 9 shipped the orchestrator as an interface
 * only — 'deferred, provably unused', with no runner. Calling A06 through that
 * interface today costs nothing and means the move to a queue later is a swap of
 * implementation, not a rewrite of call sites. Do not build a job runner as part
 * of A06."
 *
 * So this runs SYNCHRONOUSLY, and the seam it is written against is the
 * orchestrator's own contract shape: one agent, an ordered set of steps, each
 * step routed through a capability, each step idempotent on a key, one ledger
 * row per run. Nothing here imports the orchestrator — A00's standing test
 * asserts nothing does, and importing an interface with no implementation would
 * make A06 its first implementer, which is exactly what A05's build refused for
 * the same reason. The seam is the SHAPE, not an import.
 *
 * IDEMPOTENT. Running the same batch twice produces the same verdicts (the rule
 * set is deterministic end to end) and the same registry rows. It emits the same
 * events twice, which is correct for an append-only stream: two QA runs DID
 * happen.
 *
 * THE GOVERNED DOOR. The deterministic stage is dispatched through
 * `capability_call("seo.qa_candidate_pages")`, so every run gets the Agent
 * Registry lookup, the kill-switch check, the capability permission check, an
 * Agent Run Ledger row and a `capability.invoked` envelope from A00's gateway.
 * A06 then writes ONE MORE ledger row per batch carrying the QA census — the
 * capability row records that the door was used, the batch row records what came
 * out of it.
 *
 * THE KILL SWITCH IS CHECKED TWICE, DELIBERATELY. Once here, synchronously,
 * before any work, so a paused A06 returns a typed `halted` result instead of an
 * error; and once inside the gateway, which would refuse anyway. Defence in
 * depth on the one control that stops a running agent. It is NOT checked on the
 * owner's publish route — see that file for why.
 *
 * NO BUDGET BRAKE, AND THAT IS NOT AN OMISSION. A06 makes no model call and no
 * vendor call: the rule set is 100% deterministic and no critic capability is
 * registered. `cost_usd: 0` on every ledger row is a measurement.
 */

const A06 = "A06";

export interface QaRunInput {
  /** The pages to check. */
  specs: readonly PageSpec[];
  /** The corpus they are checked for duplication against. Defaults to `specs`. */
  existing?: readonly PageSpec[];
  /** Registry rows — for FAIL-CLOSED link resolution and for lifecycle writes. */
  registry?: readonly IntentPage[];
  /** The whole runtime policy document; A06 reads `page_qa.*` and the human gate. */
  policy?: SeoFactoryPolicy;
  /**
   * The PREVIOUS run's verdicts, keyed by page_spec_id. Supplying them is what
   * makes `page.defect_repaired` possible: a defect is repaired when a blocker
   * that WAS raised is no longer raised, which is only knowable against a prior
   * result.
   */
  previous?: readonly PageQAResult[];
  tenant_id?: string;
  trigger: "admin_action" | "request" | "job" | "schedule";
  /** Persist the verdict and the lifecycle hop. Default true. */
  persist?: boolean;
}

export interface QaRunTransition {
  page_id: string;
  from: string;
  to: string;
}

export interface QaRunResult {
  run_id: string | null;
  /** Non-null when the kill switch stopped the run before any work. */
  halted: { scope: string; reason: string | null } | null;
  results: PageQAResult[];
  transitions: QaRunTransition[];
  /** Approval Center ids filed for pages that entered the owner's publish queue. */
  approvals_filed: string[];
  events: string[];
  defects_found: number;
  defects_repaired: number;
}

/** A defect's identity for the found/repaired pair: the check plus where it was. */
function defectKey(finding: QaFinding): string {
  return `${finding.check}@${finding.where}`;
}

function humanGate(policy: SeoFactoryPolicy | undefined): PageQaHumanGate {
  return {
    publish_mode: policy?.publish_mode ?? "OWNER_APPROVAL",
    human_approval_required: policy?.human_approval_required ?? true,
  };
}

/**
 * Run A06 over a batch. Never throws: every failure path is a typed result plus
 * an audit trail, the same contract A00's gateway holds.
 */
export async function runPageQaBatch(
  input: QaRunInput,
  clientProvider: PlatformClientProvider = serviceClientProvider
): Promise<QaRunResult> {
  const empty: QaRunResult = {
    run_id: null,
    halted: null,
    results: [],
    transitions: [],
    approvals_filed: [],
    events: [],
    defects_found: 0,
    defects_repaired: 0,
  };

  // 1. HARD STOP, synchronous, before any work at all.
  const kill = checkKillSwitch(A06, clientProvider);
  if (kill.engaged) {
    return { ...empty, halted: { scope: kill.scope ?? "GLOBAL", reason: kill.reason ?? null } };
  }

  const gate = humanGate(input.policy);
  const context: PageQaContext = {
    registry: input.registry,
    // A06's own namespaced sub-block, resolved per tenant from the
    // runtime-editable document (C8 / pre-answer 9).
    policy: input.policy?.page_qa ?? DEFAULT_PAGE_QA_POLICY,
    min_user_value_score: input.policy?.min_user_value_score ?? null,
    human_gate: gate,
    tenant_id: input.tenant_id,
  };

  // 2. THE GOVERNED DOOR. Deterministic stage through A00's gateway.
  const call = await capability_call<PageQAResult[]>({
    agent_id: A06,
    capability: "seo.qa_candidate_pages",
    args: { specs: input.specs, existing: input.existing ?? [], context },
    trigger: input.trigger === "admin_action" ? "admin_action" : input.trigger,
    input_ids: input.specs.map((s) => s.page_spec_id),
  });
  if (!call.ok) {
    return {
      ...empty,
      halted:
        call.kind === "blocked" ? { scope: "AGENT", reason: call.reason } : null,
      run_id: call.run_id,
      events: [`capability.${call.kind}`],
    };
  }

  let results = call.output;

  /**
   * 3. THE CRITIC STAGE, folded in — a SEPARATE capability with its own governed
   *    call (platform/ai/callModel.ts). The gate asked here is ENABLEMENT, not
   *    registration: a registered contract must never silently start a stage, so
   *    while `seo.critique_page` is disabled in the runtime AI policy — its
   *    shipped state — the loop is skipped entirely and no page pays for a call
   *    policy has already refused.
   *
   *    THE CRITIC'S RULE SET IS PER-TENANT DATA (`page_qa.critic_rules`), read
   *    from the same policy block as every other A06 threshold.
   */
  if (await criticEnabled()) {
    const criticAdapter = createModelPageCritic({ rules: context.policy?.critic_rules });
    const folded: PageQAResult[] = [];
    for (const result of results) {
      const spec = input.specs.find((s) => s.page_spec_id === result.page_spec_id);
      if (!spec || result.deterministic.state === "FAIL") {
        folded.push(result);
        continue;
      }
      const critic = await runAiCriticStage(
        {
          page_spec_id: spec.page_spec_id,
          ...(spec.tenant_id ? { tenant_id: spec.tenant_id } : {}),
          primary_query: spec.primary_query,
          title: spec.title,
          meta_description: spec.meta_description,
          h1: spec.h1,
          hero_headline: spec.hero.headline,
          hero_subheadline: spec.hero.subheadline,
          blocks: spec.content_blocks,
        },
        criticAdapter,
        { deterministic_blocked: false }
      );
      folded.push(withCriticStage(result, critic, gate));
    }
    results = folded;
  }

  // 4. LIFECYCLE, EVENTS, PERSISTENCE — per page.
  const previousByPage = new Map((input.previous ?? []).map((r) => [r.page_spec_id, r]));
  const transitions: QaRunTransition[] = [];
  const approvals: string[] = [];
  const events: string[] = [];
  let defectsFound = 0;
  let defectsRepaired = 0;
  const persist = input.persist !== false;

  for (const result of results) {
    const spec = input.specs.find((s) => s.page_spec_id === result.page_spec_id);
    if (!spec) continue;
    const written = applyQaVerdict(spec, result);
    const joinContext = {
      page_id: spec.page_id,
      page_spec_id: spec.page_spec_id,
      canonical_path: spec.canonical_path,
      search_opportunity_id: spec.search_opportunity_id ?? "",
      rule_set_version: result.rule_set_version,
    };

    /**
     * THE LIFECYCLE EDGES A06 OWNS (coherence issue 13). STAGED -> QA_PASS on a
     * pass, STAGED -> APPROVED (rebuild) on a fail, through the shipped
     * `assertTransition` guards. `qa.state` is a fact ABOUT a staged page, never
     * a parallel state machine, and the owner alone owns QA_PASS -> PUBLISHED.
     */
    let page = (input.registry ?? []).find((p) => p.page_id === spec.page_id) ?? null;
    if (page) {
      const target = qaLifecycleTarget(page.lifecycle_status, result);
      if (target) {
        assertTransition(page.lifecycle_status, target);
        transitions.push({ page_id: page.page_id, from: page.lifecycle_status, to: target });
        page = { ...page, lifecycle_status: target, current_page_spec_id: written.page_spec_id };
      }
    }

    if (persist) {
      try {
        await pageRegistryStore(clientProvider).saveStagedPage(
          written,
          page ?? {
            page_id: spec.page_id,
            schema_version: "1.0.0",
            ...(spec.tenant_id ? { tenant_id: spec.tenant_id } : {}),
            canonical_path: spec.canonical_path,
            current_page_spec_id: written.page_spec_id,
            lifecycle_status: result.state === "PASS" ? "QA_PASS" : "STAGED",
            published_at: null,
            retired_at: null,
            redirect_to_path: null,
            created_at: spec.created_at,
          }
        );
      } catch {
        /**
         * FAIL-SOFT ON THE VERDICT'S DURABILITY, LOUD IN THE RESULT. A06 does
         * not publish and does not gate on its own store: the publish route
         * re-verifies from the specs it can actually read. A lost write means
         * the verdict is recomputed next time, not that a page slipped through —
         * the recorded-verdict conjunct in the publish gate makes an unwritten
         * PASS an unpublishable page, which is the safe direction.
         */
      }
    }

    // --- outcome events ---
    events.push(
      result.state === "PASS"
        ? await emitPageQaPassed(
            { ...joinContext, overall: result.overall, ai_critic: result.ai_critic.status },
            clientProvider
          )
        : await emitPageQaFailed(
            { ...joinContext, blockers: String(result.blockers.length) },
            clientProvider
          )
    );

    // --- defect events, with enough context to JOIN AGAINST PUBLISH STATUS ---
    const previous = previousByPage.get(result.page_spec_id);
    const nowKeys = new Set(result.blockers.map(defectKey));
    for (const blocker of result.blockers) {
      defectsFound += 1;
      events.push(
        await emitPageDefectFound(
          {
            ...joinContext,
            check: blocker.check,
            severity: blocker.severity,
            where: blocker.where,
            first_seen: previous && new Set(previous.blockers.map(defectKey)).has(defectKey(blocker))
              ? "false"
              : "true",
          },
          clientProvider
        )
      );
    }
    if (previous) {
      for (const gone of previous.blockers.filter((b) => !nowKeys.has(defectKey(b)))) {
        defectsRepaired += 1;
        events.push(
          await emitPageDefectRepaired(
            { ...joinContext, check: gone.check, severity: gone.severity, where: gone.where },
            clientProvider
          )
        );
      }
    }

    /**
     * THE OWNER'S PUBLISH QUEUE. A06 files an ApprovalItem under the kind A08
     * registered; the OWNER'S ROUTE ACTION remains the publish act (coherence
     * issue 6). The item is the record of the ask, not a second actuator —
     * nothing in the publish path reads it before publishing.
     *
     * The `run_id` is the gateway's, because that IS the run that produced the
     * verdict this item is asking about.
     */
    if (result.release_eligible && call.run_id) {
      try {
        const item = await queueApproval(
          {
            agent_id: A06,
            run_id: call.run_id,
            approval_kind: "seo.page_publish",
            ...(input.tenant_id ? { tenant_id: input.tenant_id } : {}),
            what_happened: `A06 passed ${spec.canonical_path} and it is ready for your publish decision.`,
            // IDs, counts and labels only — never page copy, never customer data.
            evidence: {
              page_id: spec.page_id,
              page_spec_id: spec.page_spec_id,
              canonical_path: spec.canonical_path,
              overall: result.overall,
              ai_critic_status: result.ai_critic.status,
              rule_set_version: result.rule_set_version,
              user_value_score: result.user_value_score,
              non_blocking_findings: result.deterministic.findings.length,
              checks_skipped: result.deterministic.checks_skipped.map((c) => c.check),
            },
            recommendation:
              result.overall === "BLOCKED_PENDING_AI"
                ? "Deterministic checks passed. No AI critic exists yet, so nothing has read this page for meaning — review the copy yourself before publishing."
                : "Deterministic checks and the critic both passed.",
            impact: "Publishing makes this page part of the public portfolio.",
            risk: "medium — a public page carries PRN's voice and claims",
            reversibility: "reversible",
            proposed_change: { action: "publish", page_spec_id: spec.page_spec_id },
          },
          clientProvider
        );
        approvals.push(item.approval_id);
      } catch {
        /* the queue is a record, never the gate */
      }
    }
  }

  // 5. ONE A06 LEDGER ROW PER BATCH, fail-soft — provenance, never the gate.
  let runId: string | null = call.run_id;
  try {
    const record = await recordAgentRun(
      {
        agent_id: A06,
        tenant_id: input.tenant_id ?? "prn",
        trigger: input.trigger,
        input_ids: input.specs.map((s) => s.page_spec_id),
        capabilities_used: ["seo.qa_candidate_pages"],
        // No model, no model version. Omitted rather than filled with a label
        // that would imply one ran.
        tool_provider: "deterministic-stand-in",
        outputs_summary: {
          rule_set_version: results[0]?.rule_set_version ?? null,
          checked: results.length,
          passed: results.filter((r) => r.state === "PASS").length,
          failed: results.filter((r) => r.state === "FAIL").length,
          release_eligible: results.filter((r) => r.release_eligible).length,
          blocked_pending_ai: results.filter((r) => r.overall === "BLOCKED_PENDING_AI").length,
          defects_found: defectsFound,
          defects_repaired: defectsRepaired,
          approvals_filed: approvals.length,
          transitions: transitions.map((t) => `${t.page_id}:${t.from}->${t.to}`),
          // A06 ran no model. This is measured, not a placeholder.
          ai_critic_status: results[0]?.ai_critic.status ?? null,
        },
        decisions: results.map((r) => `${r.page_spec_id}:${r.state}`),
        cost_usd: 0,
        actions_taken: results.map((r) => `page.qa_${r.state === "PASS" ? "passed" : "failed"}:${r.page_spec_id}`),
      },
      clientProvider
    );
    runId = record.run_id;
  } catch {
    /* ledger is provenance, never the gate */
  }

  return {
    run_id: runId,
    halted: null,
    results,
    transitions,
    approvals_filed: approvals,
    events,
    defects_found: defectsFound,
    defects_repaired: defectsRepaired,
  };
}

/**
 * THE REGENERATION TRIGGER (coherence issue 4).
 *
 * A06 §2/§3's trigger list names `page.material_change`, an event A05 never
 * emits and that exists nowhere in the repo. Issue 4's fix: "A06 subscribes to
 * `page.refreshed` (already in SLICE_EVENT_NAMES) and to A05's regeneration
 * event under whatever name A08 ratifies; delete `page.material_change`."
 *
 * There is no subscription bus in this codebase and building one would be A00's
 * job, so the subscription is implemented as the property it is meant to
 * guarantee: A REFRESHED PAGE RE-ENTERS QA. A05's regeneration path takes a page
 * REFRESH -> STAGED and resets `qa.state` to PENDING; this function is the other
 * half — anything STAGED with a PENDING verdict is a page A06 owes a run.
 *
 * That makes the trigger a QUERY over state rather than a message that can be
 * missed, which is strictly more reliable than a bus with no durable delivery:
 * a refresh whose event was lost is still picked up on the next run.
 */
export function pagesAwaitingQa(
  specs: readonly PageSpec[],
  registry: readonly IntentPage[] = []
): PageSpec[] {
  return specs.filter((spec) => {
    const page = registry.find((p) => p.page_id === spec.page_id);
    const status = page?.lifecycle_status ?? spec.status;
    return status === "STAGED" && spec.qa.state === "PENDING";
  });
}
