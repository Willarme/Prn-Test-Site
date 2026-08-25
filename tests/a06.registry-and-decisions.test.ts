import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SAMPLE_PAGE_SPEC } from "@/domain/search/fixtures/sample-page-spec";
import { AgentDefinition } from "@/platform/agents/contracts";
import { TRIAL_AGENT_REGISTRY } from "@/platform/agents/registry";
import { CapabilityDefinition } from "@/platform/capabilities/contracts";
import { resolveCapability } from "@/platform/capabilities/registry";
import { PageSpec } from "@/domain/search/pages";
import { TRIAL_DEFAULT_SEO_FACTORY_POLICY } from "@/domain/search/policy";
import { loadStaged } from "@/platform/admin/data";
import {
  A06_RULE_SET_VERSION,
  A06_WAIVER_PATH,
  evaluateReleaseForPublish,
  runPageQaSync,
} from "@/domain/search/qa";

/**
 * A06 STEP 9 — THE REGISTRY ENTRY, THE MIGRATION THAT ISN'T, AND THE GAP A06
 * REFUSES TO FILL.
 *
 * Plus the census the build brief asks for by name: re-run the FULL new
 * deterministic suite over the committed portfolio and report, rather than
 * silently flipping anything.
 */

const ROOT = process.cwd();
const COMMITTED = loadStaged().specs as PageSpec[];
const PORTFOLIO = [SAMPLE_PAGE_SPEC, ...COMMITTED];

describe("registry entries — one governed system, not two lists", () => {
  const a06 = TRIAL_AGENT_REGISTRY.find((a) => a.agent_id === "A06")!;

  it("A06's agent entry still parses and still declares no autonomy level", () => {
    expect(AgentDefinition.safeParse(a06).success).toBe(true);
    // Condition 12 / OD-10: canon carries two non-identical autonomy scales and
    // the owners have not picked one. A06 follows the BEHAVIOUR, not a number.
    expect(a06.autonomy_level).toBe("TBD");
    expect(a06.status).toBe("LIVE");
  });

  it("A06 cannot publish, and write_access says so structurally", () => {
    expect(a06.write_access).not.toContain("published_page");
    expect(a06.data_access).toContain("published_page"); // it may READ publish state
    expect(a06.write_access).toEqual([
      "staged_page_spec",
      "intent_page",
      "agent_run_ledger",
      "approval_item",
    ]);
  });

  it("it writes nothing customer-owned", () => {
    for (const forbidden of [
      "problem_record",
      "evidence_object",
      "intake_answer",
      "consent_event",
      "job_packet",
    ]) {
      expect(a06.write_access, forbidden).not.toContain(forbidden);
      expect(a06.data_access, forbidden).not.toContain(forbidden);
    }
  });

  it("its capability entry parses, is owned by A06, and names the grown contract", () => {
    const capability = resolveCapability("seo.qa_candidate_pages")!;
    expect(CapabilityDefinition.safeParse(capability).success).toBe(true);
    expect(capability.owning_agent_ids).toEqual(["A06"]);
    expect(capability.output_schema_ref).toBe("contracts://search/PageQAResult[]");
    // NOT a second parallel QA result type (condition C2).
    expect(capability.output_schema_ref).not.toBe("contracts://search/QaResult[]");
  });

  it("the two registries agree with each other", () => {
    expect(a06.allowed_capabilities).toContain("seo.qa_candidate_pages");
    expect(resolveCapability("seo.qa_candidate_pages")!.owning_agent_ids).toContain("A06");
  });

  it("no critic capability is registered — A06 makes no model call", () => {
    expect(resolveCapability("seo.critique_page")).toBeNull();
    expect(a06.allowed_capabilities).toEqual(["seo.qa_candidate_pages"]);
  });
});

/**
 * THE MIGRATION THAT ISN'T. The build brief says a migration is written "ONLY if
 * a real table is needed". A06 needs none, and the reasoning belongs in a test
 * rather than a commit message nobody re-reads:
 *
 *   the VERDICT           lives on the PageSpec (`qa.state` / `qa.reasons` /
 *                         `user_value_score`) in the existing
 *                         `staged_page_spec` table — the exact fields the admin
 *                         queue and the publish route already read;
 *   the LIFECYCLE hop     lives on `intent_page` (migration 00012, A05's);
 *   the FINDINGS          are recomputed deterministically on read. The rule set
 *                         has no model, no network and no clock in it, so a
 *                         stored copy could only ever go stale against the rules
 *                         that produced it;
 *   the HISTORY           is the append-only event stream — page.qa_passed /
 *                         qa_failed / defect_found / defect_repaired, all
 *                         carrying the join key;
 *   the QUEUE             is `approval_item` (migration 00007, A00's);
 *   the RUN RECORD        is `agent_run_ledger` (migration 00006, A00's).
 *
 * Inventing a `page_qa_result` table would add a second place a verdict lives,
 * which is the same failure mode as a second QA type and a second publish gate.
 */
describe("no migration — A06 needs no table of its own", () => {
  it("the migration head is unchanged: A05's 00012 is still the last one", () => {
    const migrations = readdirSync(join(ROOT, "supabase", "migrations")).sort();
    expect(migrations[migrations.length - 1]).toBe("00012_page_registry.sql");
    expect(migrations.some((m) => m.startsWith("00013"))).toBe(false);
  });

  it("A06's durable state is entirely in tables that already exist", () => {
    const a06 = TRIAL_AGENT_REGISTRY.find((a) => a.agent_id === "A06")!;
    for (const table of a06.write_access) {
      expect(
        ["staged_page_spec", "intent_page", "agent_run_ledger", "approval_item"],
        table
      ).toContain(table);
    }
  });

  it("the verdict lands on fields the shipped PageSpec already carries", () => {
    const result = runPageQaSync(SAMPLE_PAGE_SPEC);
    const written = PageSpec.parse({
      ...SAMPLE_PAGE_SPEC,
      qa: { state: result.state, reasons: result.reasons },
      user_value_score: result.user_value_score,
    });
    expect(written.qa.state).toBe("PASS");
    expect(written.user_value_score).toBe(result.user_value_score);
  });
});

describe("NO WAIVER PATH, and the honest consequence (pre-answer 8)", () => {
  it("A06 builds no override mechanism, and says so in code", () => {
    expect(A06_WAIVER_PATH.exists).toBe(false);
    expect(A06_WAIVER_PATH.false_block_rate_computable).toBe(false);
    expect(A06_WAIVER_PATH.note).toMatch(/uncomputable, not zero/);
  });

  /**
   * The scan looks for a MECHANISM, not the word. `A06_WAIVER_PATH` is the
   * record that no mechanism exists and must obviously survive; what must not
   * exist is anything that takes a blocker back out — a function, a flag, or a
   * policy field.
   */
  it("nothing anywhere in A06 can lift a blocker", () => {
    for (const module of [
      "src/domain/search/qa.ts",
      "src/domain/search/qa-policy.ts",
      "src/platform/search/page-qa-run.ts",
      "src/platform/search/page-qa-gate.ts",
      "src/app/api/admin/pages/publish/route.ts",
    ]) {
      const code = readFileSync(join(ROOT, module), "utf-8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      expect(code, module).not.toMatch(
        /waive\w*\(|override\w*\(|force_publish|bypass|skip_blocker|ignore_blocker|allow_override|publish_anyway/i
      );
    }
  });

  it("policy can re-severity a check class, but nothing can exempt a single page", () => {
    const policy = readFileSync(join(ROOT, "src/domain/search/qa-policy.ts"), "utf-8");
    // Severity is a per-tenant CLASS decision, applied to every page equally.
    expect(policy).toMatch(/blocker_checks/);
    // There is no per-page escape hatch of any kind.
    expect(policy).not.toMatch(/exempt|page_spec_id|allowlist_pages|skip_pages/i);
  });

  it("a blocked page stays blocked — there is no argument that gets it through", () => {
    const broken = PageSpec.parse({
      ...COMMITTED[0],
      source_fact_bundle_ids: [],
      qa: { state: "PASS", reasons: [] },
    });
    expect(evaluateReleaseForPublish(broken, { existing: [] }).release_eligible).toBe(false);
  });

  it("the open decision is recorded where the owner will find it", () => {
    const open = readFileSync(join(ROOT, "docs/canon/OPEN_DECISIONS.md"), "utf-8");
    expect(open).toMatch(/OD-14 — Who may waive an A06 hard blocker/);
    expect(open).toMatch(/false-block-rate KPI is UNCOMPUTABLE, not zero/);
    expect(open).toMatch(/OD-15 — Turning A06's AI critic on/);
  });
});

/**
 * THE COMMITTED-PORTFOLIO CENSUS — the build brief's explicit instruction:
 * "re-run the new full deterministic suite over them — if any now FAILS a NEW
 * check, do NOT silently flip their state; report it and mark release_eligible
 * false with the reason (honest queue, no stealth demotion of qa.state)."
 *
 * THE RESULT, 2026-08-24: all seven shipped doors pass the full new suite with
 * ZERO findings at any severity — not one blocker, not one major. So nothing had
 * to be demoted, and 409 parity is byte-for-byte rather than "parity except for
 * these three". The machinery to demote honestly exists and is tested above;
 * it simply had nothing to act on.
 */
describe("census — the committed portfolio under A06's full new rule set", () => {
  it("all seven shipped doors raise ZERO findings at any severity", () => {
    for (const spec of PORTFOLIO) {
      const result = runPageQaSync(spec, {
        existing: PORTFOLIO.filter((s) => s !== spec),
        policy: TRIAL_DEFAULT_SEO_FACTORY_POLICY.page_qa,
        min_user_value_score: TRIAL_DEFAULT_SEO_FACTORY_POLICY.min_user_value_score,
      });
      expect(result.deterministic.findings, spec.page_spec_id).toEqual([]);
      expect(result.blockers, spec.page_spec_id).toEqual([]);
      expect(result.state, spec.page_spec_id).toBe("PASS");
      expect(result.overall, spec.page_spec_id).toBe("BLOCKED_PENDING_AI");
    }
  });

  it("no committed qa.state was flipped by this build — the artifact is untouched", () => {
    for (const spec of COMMITTED) {
      expect(spec.qa.state, spec.page_spec_id).toBe("PASS");
      expect(spec.qa.reasons, spec.page_spec_id).toEqual([]);
      expect(spec.status, spec.page_spec_id).toBe("STAGED");
      expect(spec.user_value_score, spec.page_spec_id).not.toBeNull();
    }
    expect(SAMPLE_PAGE_SPEC.qa.state).toBe("PENDING");
  });

  it("their user_value_score is unchanged — the heuristic's arithmetic did not move", () => {
    for (const spec of COMMITTED) {
      const result = runPageQaSync(spec, { existing: PORTFOLIO.filter((s) => s !== spec) });
      expect(result.user_value_score, spec.page_spec_id).toBe(spec.user_value_score);
    }
  });

  it("every one of them carries the rule-set version that judged it", () => {
    for (const spec of PORTFOLIO) {
      expect(runPageQaSync(spec).rule_set_version).toBe(A06_RULE_SET_VERSION);
    }
  });

  /**
   * The demotion path, proved on a synthetic page rather than by breaking a real
   * one: a stored PASS that no longer verifies is refused at the gate and its
   * stored state is NOT rewritten. That is what "honest queue, no stealth
   * demotion" means in code.
   */
  it("if one HAD failed a new check, it would be refused with a reason and NOT rewritten", () => {
    const wouldFail = PageSpec.parse({
      ...COMMITTED[0],
      internal_links: [{ label: "Nowhere", path: "/problems/does-not-exist" }],
    });
    const decision = evaluateReleaseForPublish(wouldFail, {
      existing: [],
      registry: [],
    });
    expect(decision.release_eligible).toBe(false);
    expect(decision.reasons.join(" ")).toMatch(/links\.internal_resolvable/);
    expect(decision.reasons.join(" ")).toMatch(/NOT being rewritten/);
    expect(wouldFail.qa.state).toBe("PASS");
  });
});
