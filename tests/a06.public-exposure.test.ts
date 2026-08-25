import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { SAMPLE_PAGE_SPEC } from "@/domain/search/fixtures/sample-page-spec";
import { PageSpec } from "@/domain/search/pages";
import { loadStaged } from "@/platform/admin/data";
import { flagEnabled } from "@/platform/flags";
import { runPageQaSync } from "@/domain/search/qa";

/**
 * A06 STEP 8 — PUBLIC EXPOSURE (condition C11, coherence report issue 16).
 *
 * THE RULE, from C11: "src/app/page.tsx (public, unauthenticated, force-dynamic)
 * already lists every staged page with its QA-state pill and links to
 * /staged/<slug>. A06 must not widen what that surface renders — `reasons`,
 * findings, evidence and repair_instructions are admin-only." And from
 * pre-answer 12: "Do not change the live site as a side effect of a QA build.
 * Constrain A06 so nothing beyond the existing PASS/FAIL pill can reach that
 * surface."
 *
 * A05's build wrote the first half of this guard, listing what A05 added.
 * A06's verdicts are richer than anything A05 produced — findings with matched
 * fragments, repair instructions, blocker lists, a critic status — so this
 * extends the same scan to everything A06 introduced, and widens it from the
 * homepage to EVERY unauthenticated route.
 *
 * WHAT REMAINS PUBLIC, unchanged: h1, canonical_path and the QA STATE pill.
 * Those were public before this build and this build did not move them. Whether
 * they belong there at all is Josh's separate call (pre-answer 12, adjacent to
 * T0-02) and is deliberately NOT decided here.
 */

const ROOT = process.cwd();

/** Every route that renders without an admin gate. */
const PUBLIC_ROUTES = [
  "src/app/page.tsx",
  "src/app/staged/[slug]/page.tsx",
  "src/app/problems/[slug]/page.tsx",
  "src/components/door/IntentPageView.tsx",
] as const;

/**
 * Everything A06 produces that is ADMIN-ONLY. A finding message can quote a
 * matched fragment of copy and a repair instruction is internal direction to
 * A05 — neither is customer-facing text, and the rule logic behind them is
 * exactly what §2 promises never to expose to a public route.
 */
const A06_INTERNALS = [
  /\brelease_eligible\b/,
  /\brelease_reasons\b/,
  /\bblockers\b/,
  /\bfindings\b/,
  /\brepair_instructions\b/,
  /\bai_critic\b/,
  /\bdeterministic\b/,
  /\brule_set_version\b/,
  /\bheuristic_score\b/,
  /\bchecks_skipped\b/,
  /\bchecks_run\b/,
  /\bqa\.reasons\b/,
  /\.reasons\b/,
  /runPageQa|runDeterministic|qaCandidatePages|evaluateReleaseForPublish/,
  /page-qa-run|page-qa-gate|page-qa-critic|qa-policy|qa-intent|qa-accessibility/,
  /\buser_value_score\b/,
] as const;

function code(path: string): string {
  // Comments stripped: a route's comment may NAME a field in order to forbid it,
  // and naming a thing to forbid it is not rendering it (A05's own convention).
  return readFileSync(join(ROOT, path), "utf-8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("nothing A06 produces reaches an unauthenticated route", () => {
  for (const route of PUBLIC_ROUTES) {
    it(`${route} renders no A06 internal`, () => {
      const source = code(route);
      for (const internal of A06_INTERNALS) {
        expect(source, `${route} renders ${internal}`).not.toMatch(internal);
      }
    });
  }

  it("the public homepage still shows exactly h1, path and the QA STATE pill — no more, no less", () => {
    const homepage = readFileSync(join(ROOT, "src/app/page.tsx"), "utf-8");
    expect(homepage).toMatch(/\{s\.h1\}/);
    expect(homepage).toMatch(/s\.canonical_path\.replace/);
    expect(homepage).toMatch(/\{s\.qa\.state\}/);
    // The pill reads the STATE and nothing adjacent to it.
    expect(code("src/app/page.tsx")).not.toMatch(/s\.qa\.(?!state)/);
  });

  it("the door template renders the page's own copy and the intake, never a verdict", () => {
    const view = code("src/components/door/IntentPageView.tsx");
    expect(view).toMatch(/spec\.content_blocks\.map/);
    expect(view).toMatch(/StartRequestForm/);
    expect(view).not.toMatch(/spec\.qa/);
  });

  it("the staged listing flag still DEFAULTS TO TODAY'S BEHAVIOUR — A06 changed no live surface", () => {
    expect(flagEnabled("staged_listing_public")).toBe(true);
    expect(flagEnabled("seo_doors_enabled")).toBe(false);
  });

  it("both noindex layers are untouched by this build", () => {
    expect(readFileSync(join(ROOT, "src/app/staged/[slug]/page.tsx"), "utf-8")).toMatch(
      /robots:\s*\{\s*index:\s*false,\s*follow:\s*false\s*\}/
    );
    expect(readFileSync(join(ROOT, "src/app/problems/[slug]/page.tsx"), "utf-8")).toMatch(
      /seo_doors_enabled/
    );
  });
});

describe("A06's rule logic never reaches a client bundle", () => {
  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full, out);
      else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
    }
    return out;
  }

  /**
   * §2's promise — "never exposes its rule logic to a public route" — is
   * currently enforced by nothing, per C11. This is the enforcement: a
   * "use client" file importing any A06 module would ship the whole rule set,
   * every pattern and every threshold into the browser payload. Same leak class
   * as the playbook-graph exposure (Trial Build State lines 104-125, T0-02).
   */
  it("no 'use client' file imports any A06 module", () => {
    const clientFiles = walk(join(ROOT, "src")).filter((f) =>
      /^\s*["']use client["']/m.test(readFileSync(f, "utf-8"))
    );
    expect(clientFiles.length, "the scan found no client components at all").toBeGreaterThan(0);
    for (const file of clientFiles) {
      const source = readFileSync(file, "utf-8");
      expect(source, relative(ROOT, file)).not.toMatch(
        /from\s+["']@\/domain\/search\/qa(-[a-z]+)?["']/
      );
      expect(source, relative(ROOT, file)).not.toMatch(
        /from\s+["']@\/platform\/search\/page-qa-[a-z]+["']/
      );
    }
  });
});

describe("the verdicts themselves stay behind the admin gate", () => {
  it("the admin QA surfaces are gated, and the public ones carry no verdict", () => {
    for (const admin of ["src/app/admin/pages/page.tsx", "src/app/admin/pages/[page_spec_id]/page.tsx"]) {
      expect(readFileSync(join(ROOT, admin), "utf-8"), admin).toMatch(/adminGate\(\)/);
    }
  });

  it("a real verdict carries plenty that must never be public — proof the rule has teeth", () => {
    const spec = PageSpec.parse({
      ...SAMPLE_PAGE_SPEC,
      page_spec_id: "ps_public_leak_probe",
      page_id: "page_public_leak_probe",
      canonical_path: "/problems/public-leak-probe",
      title: "Public Leak Probe Page",
      primary_query: "roof drip in the attic after rain",
      intake_context: { ...SAMPLE_PAGE_SPEC.intake_context, page_id: "page_public_leak_probe" },
      source_fact_bundle_ids: [],
    });
    const result = runPageQaSync(spec);
    expect(result.blockers.length).toBeGreaterThan(0);
    expect(result.blockers[0].repair_instructions).toBeTruthy();
    expect(result.deterministic.checks_skipped.length).toBeGreaterThan(0);
    // None of which appears on any public surface, per the scans above.
  });

  it("the committed portfolio's public pill values are unchanged by this build", () => {
    for (const spec of loadStaged().specs as PageSpec[]) {
      expect(spec.qa.state).toBe("PASS");
    }
    expect(SAMPLE_PAGE_SPEC.qa.state).toBe("PENDING");
  });
});
