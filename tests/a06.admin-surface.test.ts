import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QaVerdictPanel } from "@/components/admin/QaVerdict";
import type { PageQAResult } from "@/domain/search/qa";
import { publishQueueSnapshot } from "@/platform/search/page-qa-gate";
import { SAMPLE_PAGE_SPEC } from "@/domain/search/fixtures/sample-page-spec";
import { PageSpec } from "@/domain/search/pages";
import { TRIAL_DEFAULT_SEO_FACTORY_POLICY } from "@/domain/search/policy";
import { isRetiredLegacySpec } from "@/platform/pages/route-retirement";
import staged from "../data/factory/staged-specs.json";

const legacyPortfolio = [SAMPLE_PAGE_SPEC, ...staged.specs.map(spec => PageSpec.parse(spec))];
let portfolio = legacyPortfolio;
const getPolicy = vi.fn(async () => TRIAL_DEFAULT_SEO_FACTORY_POLICY);
vi.mock("@/platform/admin/data", () => ({
  allStagedSpecs: async () => portfolio,
  policyStore: () => ({ getActive: getPolicy }),
}));
beforeEach(() => { portfolio = legacyPortfolio; getPolicy.mockClear(); });

/**
 * A06 STEP 10 — THE ADMIN SURFACE.
 *
 * Two requirements from the build brief, and one inherited condition:
 *   - QA results are visible on the EXISTING admin Pages surfaces, with NO new
 *     top-level page. An inspector with its own dashboard is an inspector nobody
 *     opens.
 *   - the publish queue shows `release_eligible` HONESTLY — the same boolean the
 *     server reads, never a softer UI version of it.
 *   - condition C16 (A05's): no PageSpec or QA internal reaches a "use client"
 *     component, because that serializes it into the browser payload.
 */

const ROOT = process.cwd();

describe("owned top-level admin pages", () => {
  it("A06 stays on Pages; the owner-authorized Company OS rebuild adds private activity, connections and system map", () => {
    const routes = readdirSync(join(ROOT, "src/app/admin")).filter((entry) =>
      statSync(join(ROOT, "src/app/admin", entry)).isDirectory()
    );
    expect(routes.sort()).toEqual([
      "agents",
      "approvals",
      "audit",
      "connections",
      "controls",
      "features",
      "login",
      "map",
      "opportunities",
      "pages",
      "requests",
      "system",
    ]);
  });

  it("the verdict renders inside the existing Pages surfaces", () => {
    const detail = readFileSync(join(ROOT, "src/app/admin/pages/[page_spec_id]/page.tsx"), "utf-8");
    expect(detail).toMatch(/QaVerdictPanel/);
    expect(detail).toMatch(/publishGate\(/);
    expect(detail).toMatch(/adminGate\(\)/);
  });
});

describe("the queue shows the decision the server will make", () => {
  it("the list and the route call the SAME function", () => {
    const list = readFileSync(join(ROOT, "src/app/admin/pages/page.tsx"), "utf-8");
    const route = readFileSync(join(ROOT, "src/app/api/admin/pages/publish/route.ts"), "utf-8");
    expect(list).toMatch(/publishQueueSnapshot\(\)/);
    expect(route).toMatch(/publishGate\(/);
    // Both resolve through evaluateReleaseForPublish — one gate, one answer.
    const gateModule = readFileSync(join(ROOT, "src/platform/search/page-qa-gate.ts"), "utf-8");
    expect(gateModule.match(/evaluateReleaseForPublish\(/g) ?? []).toHaveLength(2);
  });

  it("the publish button is offered only when release_eligible — never on qa.state alone", () => {
    const list = readFileSync(join(ROOT, "src/app/admin/pages/page.tsx"), "utf-8");
    expect(list).toMatch(/decision\.release_eligible \? \(/);
    expect(list).not.toMatch(/s\.qa\.state === "PASS" \? \(/);
  });

  it("a blocked row says there is no override, rather than implying one exists", () => {
    const list = readFileSync(join(ROOT, "src/app/admin/pages/page.tsx"), "utf-8");
    expect(list).toMatch(/no override exists/);
  });

  it("the queue is honest about the missing critic — BLOCKED_PENDING_AI is rendered", () => {
    const list = readFileSync(join(ROOT, "src/app/admin/pages/page.tsx"), "utf-8");
    expect(list).toMatch(/decision\.qa\.overall/);
  });

  it("retired history remains in the queue but cannot be published", async () => {
    const queue = await publishQueueSnapshot(() => null);
    expect(queue).toHaveLength(legacyPortfolio.length);
    expect(queue.length).toBeGreaterThan(4);
    expect(getPolicy).toHaveBeenCalledOnce();
    for (const row of queue) {
      expect(isRetiredLegacySpec(row.spec)).toBe(true);
      expect(row.decision.qa.page_spec_id).toBe(row.spec.page_spec_id);
      expect(row.decision.release_eligible).toBe(false);
      expect(row.decision.reasons[0]).toContain("T6-29:R3:c6ff9a");
    }
  });

  it("computes real QA eligibility for nonretired fixtures with one policy read", async () => {
    const replacements = new Map(legacyPortfolio.map(spec => [spec.canonical_path, spec.canonical_path.replace("/problems/", "/problems/qa-fixture-")]));
    portfolio = legacyPortfolio.map(spec => PageSpec.parse(JSON.parse(
      [...replacements].reduce((json, [from, to]) => json.replaceAll(from, to), JSON.stringify(spec))
    )));
    expect(portfolio.every(spec => !isRetiredLegacySpec(spec))).toBe(true);
    const queue = await publishQueueSnapshot(() => null);
    expect(queue).toHaveLength(portfolio.length);
    expect(getPolicy).toHaveBeenCalledOnce();
    for (const row of queue) expect(row.decision.qa.page_spec_id).toBe(row.spec.page_spec_id);
    // The copied PASS fixtures still pass real QA; the PENDING fixture cannot.
    expect(queue.filter((r) => r.decision.release_eligible)).toHaveLength(4);
  });
});

describe("the verdict panel is honest about the parts that are not green", () => {
  const panel = readFileSync(join(ROOT, "src/components/admin/QaVerdict.tsx"), "utf-8");

  it("distinguishes a real failed review from a review that was not completed", () => {
    // Only the fields consumed by this presentation are relevant to the fixture.
    const render = (status: "FAIL" | "SKIPPED") => renderToStaticMarkup(createElement(QaVerdictPanel, {
      qa: {
        overall: "FAIL", rule_set_version: "test", user_value_score: null,
        heuristic_score: null, blockers: [],
        ai_critic: { status, reason: "test receipt" },
        deterministic: { state: "PASS", findings: [], checks_skipped: [], unknown_required_checks: [], checks_run: [] },
      } as unknown as PageQAResult,
      eligible: false, reasons: [],
    }));
    expect(render("FAIL")).toContain("The AI critic reviewed this page and rejected it.");
    expect(render("FAIL")).not.toContain("A completed AI review is not available.");
    expect(render("SKIPPED")).toContain("A completed AI review is not available.");
    expect(render("SKIPPED")).not.toContain("reviewed this page and rejected it");
  });

  it("it renders the NOT-MEASURABLE checks as not-run, not as passes", () => {
    expect(panel).toMatch(/checks_skipped/);
    expect(panel).toMatch(/NOT run, and\s*\n?\s*therefore NOT passed/);
  });

  it("it says the value score is a heuristic, not a critic judgment", () => {
    expect(panel).toMatch(/not a\s*\n?\s*\{?critic judgment|deterministic heuristic/);
  });

  it("it surfaces a required check A06 does not implement, rather than hiding it", () => {
    expect(panel).toMatch(/unknown_required_checks/);
    expect(panel).toMatch(/did NOT run/);
  });

  it("it states that a blocker has no override", () => {
    expect(panel).toMatch(/there is no override/);
  });
});

describe("condition C16 — no QA internal reaches a client component", () => {
  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full, out);
      else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
    }
    return out;
  }

  it("the verdict panel is a SERVER component", () => {
    const panel = readFileSync(join(ROOT, "src/components/admin/QaVerdict.tsx"), "utf-8");
    expect(panel).not.toMatch(/^\s*["']use client["']/m);
  });

  it("PublishButton still receives only scalars — no findings, no reasons, no spec", () => {
    const list = readFileSync(join(ROOT, "src/app/admin/pages/page.tsx"), "utf-8");
    const usage = list.slice(list.indexOf("<PublishButton"), list.indexOf("/>", list.indexOf("<PublishButton")));
    expect(usage).toMatch(/pageSpecId=/);
    expect(usage).not.toMatch(/findings|reasons|blockers|decision\.qa|spec=/);
  });

  it("no client component anywhere imports A06", () => {
    const clientFiles = walk(join(ROOT, "src")).filter((f) =>
      /^\s*["']use client["']/m.test(readFileSync(f, "utf-8"))
    );
    for (const file of clientFiles) {
      const source = readFileSync(file, "utf-8");
      expect(source, file).not.toMatch(/@\/domain\/search\/qa/);
      expect(source, file).not.toMatch(/@\/platform\/search\/page-qa-/);
    }
  });
});
