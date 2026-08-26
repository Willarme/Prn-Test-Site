import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { publishQueueSnapshot } from "@/platform/search/page-qa-gate";

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

describe("no new top-level admin page", () => {
  it("the admin route set is the owned set — A06 added none; the 2026-08-26 owner directive added exactly two (agents + system), registry mirrors with no customer data", () => {
    const routes = readdirSync(join(ROOT, "src/app/admin")).filter((entry) =>
      statSync(join(ROOT, "src/app/admin", entry)).isDirectory()
    );
    expect(routes.sort()).toEqual([
      "agents",
      "approvals",
      "controls",
      "login",
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

  it("the snapshot computes one decision per staged page, policy read once", async () => {
    const queue = await publishQueueSnapshot(() => null);
    expect(queue.length).toBeGreaterThan(4);
    for (const row of queue) {
      expect(row.decision.qa.page_spec_id).toBe(row.spec.page_spec_id);
      expect(row.decision.reasons.length).toBeGreaterThan(0);
    }
    // The committed four are eligible; the PENDING handcrafted door is not.
    expect(queue.filter((r) => r.decision.release_eligible)).toHaveLength(4);
  });
});

describe("the verdict panel is honest about the parts that are not green", () => {
  const panel = readFileSync(join(ROOT, "src/components/admin/QaVerdict.tsx"), "utf-8");

  it("it renders the critic status, and says plainly what a skipped critic means", () => {
    expect(panel).toMatch(/AI critic/);
    expect(panel).toMatch(/Nothing has read this page for meaning/);
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
