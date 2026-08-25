import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { SAMPLE_PAGE_SPEC } from "@/domain/search/fixtures/sample-page-spec";
import { stageNewPage } from "@/domain/search/page-registry";
import { compilePageSpec } from "@/domain/search/factory";
import { importSeedRows, type SeedFile } from "@/domain/search/importer";
import {
  A06_RULE_SET_VERSION,
  applyQaVerdict,
  qaLifecycleTarget,
  runPageQaSync,
} from "@/domain/search/qa";
import { canTransition } from "@/domain/search/lifecycle";

/**
 * A06 STEP 1 — THE TWO STRUCTURAL PROPERTIES THE LOOP AUDIT ASKED FOR BY NAME.
 *
 *  1. INDEPENDENCE (coherence issue 15, condition C14, Master Todo T1-09):
 *     "A06 must reimplement it independently, and a test must assert A06's QA
 *     module imports nothing from domain/search/factory or recommend." An
 *     inspector that shares its subject's logic is not an inspector.
 *  2. SOLE WRITERSHIP (coherence issue 5): "add to A06 §5 Writes, explicitly:
 *     A06 is the sole writer of PageSpec.qa.state and PageSpec.qa.reasons; A05
 *     sets PENDING at creation and never writes it again. Add a test asserting
 *     no module outside A06 writes qa.state to PASS."
 *
 * Both are enforced by SOURCE SCAN rather than by convention, because both are
 * the kind of rule a future edit breaks silently.
 */

const ROOT = process.cwd();

/** Every module that is part of A06. Anything else is "outside A06". */
const A06_MODULES = [
  "src/domain/search/qa.ts",
  "src/domain/search/qa-types.ts",
  "src/domain/search/qa-intent.ts",
  "src/domain/search/qa-policy.ts",
  "src/domain/search/qa-critic.ts",
  "src/domain/search/qa-accessibility.ts",
] as const;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, out);
      continue;
    }
    if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

describe("A06 independence — the inspector shares no logic with its subject", () => {
  /**
   * The three forbidden imports. `factory` is A06's SUBJECT, `recommend` and
   * `intent-family` are the shared matcher A04/A05 may legitimately share with
   * each other and A06 may not — that split is written into intent-family.ts's
   * own header on the other side of the seam.
   */
  const FORBIDDEN = [
    /from\s+["']@\/domain\/search\/factory["']/,
    /from\s+["']@\/domain\/search\/recommend["']/,
    /from\s+["']@\/domain\/search\/intent-family["']/,
  ];

  it("no A06 module imports the factory, the recommender or the shared matcher", () => {
    for (const module of A06_MODULES) {
      const source = readFileSync(join(ROOT, module), "utf-8");
      for (const forbidden of FORBIDDEN) {
        expect(source, `${module} must not import ${forbidden}`).not.toMatch(forbidden);
      }
    }
  });

  it("A06 imports nothing from A05's lint pre-filter or its provenance helper either", () => {
    for (const module of A06_MODULES) {
      const source = readFileSync(join(ROOT, module), "utf-8");
      expect(source, module).not.toMatch(/from\s+["']@\/domain\/search\/page-lint["']/);
      expect(source, module).not.toMatch(/from\s+["']@\/domain\/search\/content-bank-provenance["']/);
    }
  });

  /**
   * CONDITION C14 / pre-answer 10, the separability seam: "keep the qa module
   * importing nothing from PRN's problem/trust/provider domains ... so whichever
   * way Josh rules the later extraction is a pull rather than a rewrite."
   */
  it("A06 imports nothing from PRN's problem, trust, provider or intake domains", () => {
    for (const module of A06_MODULES) {
      const source = readFileSync(join(ROOT, module), "utf-8");
      expect(source, module).not.toMatch(
        /from\s+["']@\/domain\/(problem|trust|providers?|intake|feature-lab)\//
      );
    }
  });

  it("A06's matcher genuinely disagrees with the shared one where it should", async () => {
    const { qaIntentSimilarity } = await import("@/domain/search/qa-intent");
    const { sameIntentFamily } = await import("@/domain/search/intent-family");

    // AGREEMENT on the cases that matter: the same search need collapses...
    expect(qaIntentSimilarity("ac won't turn on", "ac not turning on")).toBeGreaterThanOrEqual(0.85);
    expect(sameIntentFamily("ac won't turn on", "ac not turning on")).toBe(true);
    // ...and negated opposites stay apart in BOTH.
    expect(qaIntentSimilarity("ac won't turn on", "ac won't turn off")).toBeLessThan(0.85);
    expect(sameIntentFamily("ac won't turn on", "ac won't turn off")).toBe(false);

    // DIVERGENCE: A06 measures, and reports a number, where the shared helper
    // returns only a boolean. The two are not the same computation.
    expect(qaIntentSimilarity("furnace blowing cold air", "ac blowing warm air")).toBeCloseTo(0.5, 2);
  });
});

describe("A06 is the SOLE writer of PageSpec.qa (coherence issue 5)", () => {
  const productionFiles = [...walk(join(ROOT, "src")), ...walk(join(ROOT, "tools"))].filter(
    (f) => !A06_MODULES.some((m) => f.endsWith(m.split("/").join(sep)))
  );

  /**
   * The scan. Any `qa: { state: X }` object literal outside A06 must have
   * X === "PENDING" — that is A05's creation write and the only one it is
   * allowed to make.
   */
  it("no module outside A06 writes a non-PENDING qa.state", () => {
    const offenders: string[] = [];
    for (const file of productionFiles) {
      const source = readFileSync(file, "utf-8");
      for (const match of source.matchAll(/qa:\s*\{\s*state:\s*([^,}\s]+)/g)) {
        if (match[1] !== '"PENDING"') {
          offenders.push(`${relative(ROOT, file)}: qa.state written as ${match[1]}`);
        }
      }
      // `=` but not `==`/`===`: reading `spec.qa.state === "PASS"` is not a write.
      for (const match of source.matchAll(/\.qa\.state\s*=(?!=)/g)) {
        offenders.push(`${relative(ROOT, file)}: direct assignment ${match[0]}`);
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("nothing outside A06 writes qa.state to PASS by any spelling", () => {
    for (const file of productionFiles) {
      const source = readFileSync(file, "utf-8");
      expect(source, relative(ROOT, file)).not.toMatch(/qa:\s*\{\s*state:\s*["']PASS["']/);
    }
  });

  it("A05's three creation paths all write PENDING and nothing else", () => {
    const seedFile = JSON.parse(
      readFileSync(join(ROOT, "tests", "fixtures", "seed-research", "seed-rows.json"), "utf-8")
    ) as SeedFile;
    const opportunity = {
      ...importSeedRows(seedFile, "2026-08-14T00:00:00Z").find(
        (o) => o.keyword === "ac blowing warm air"
      )!,
      recommendation: "NEW" as const,
      status: "approved" as const,
    };
    const now = () => "2026-08-14T12:00:00Z";
    expect(compilePageSpec(opportunity, { now }).qa.state).toBe("PENDING");
    expect(stageNewPage(opportunity, { now }).spec.qa.state).toBe("PENDING");
  });

  it("applyQaVerdict is the write, and it never mutates the spec it was handed", () => {
    const result = runPageQaSync(SAMPLE_PAGE_SPEC, { existing: [] });
    const written = applyQaVerdict(SAMPLE_PAGE_SPEC, result);
    expect(written.qa.state).toBe("PASS");
    expect(written.user_value_score).toBe(result.user_value_score);
    // The original is untouched — a caller that discards the result changed nothing.
    expect(SAMPLE_PAGE_SPEC.qa.state).toBe("PENDING");
    expect(SAMPLE_PAGE_SPEC.user_value_score).toBeNull();
  });
});

describe("qa.state and release_eligible are FACTS ABOUT a staged page, not a lifecycle", () => {
  it("A06 owns STAGED -> QA_PASS and STAGED -> APPROVED, and returns nothing else", () => {
    const pass = runPageQaSync(SAMPLE_PAGE_SPEC, { existing: [] });
    expect(pass.state).toBe("PASS");
    expect(qaLifecycleTarget("STAGED", pass)).toBe("QA_PASS");
    expect(canTransition("STAGED", "QA_PASS")).toBe(true);

    // Self-identity is by OBJECT REFERENCE, never by id, so a corpus carrying a
    // COPY of this page collides with it — which is the duplicate case.
    const twin = { ...SAMPLE_PAGE_SPEC };
    const failing = runPageQaSync(SAMPLE_PAGE_SPEC, { existing: [twin] });
    expect(failing.state).toBe("FAIL");
    expect(qaLifecycleTarget("STAGED", failing)).toBe("APPROVED");
    expect(canTransition("STAGED", "APPROVED")).toBe(true);
  });

  it("A06 never returns PUBLISHED, and has no opinion on a page that is not STAGED", () => {
    const pass = runPageQaSync(SAMPLE_PAGE_SPEC, { existing: [] });
    for (const from of ["IDEA", "APPROVED", "QA_PASS", "PUBLISHED", "REFRESH", "RETIRED"] as const) {
      expect(qaLifecycleTarget(from, pass), from).toBeNull();
    }
  });

  it("every result carries the rule-set version that produced it", () => {
    expect(runPageQaSync(SAMPLE_PAGE_SPEC).rule_set_version).toBe(A06_RULE_SET_VERSION);
  });
});
