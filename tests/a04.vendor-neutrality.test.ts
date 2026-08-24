import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { OpportunitySource } from "@/domain/search/contracts";

/**
 * A04 VENDOR NEUTRALITY (C2) and SEPARABILITY (C3) — the two DoD checks the
 * spec specified in a form that could not work, rewritten so they actually
 * check something.
 *
 * WHAT WAS WRONG WITH THE ORIGINALS.
 *
 * §9 step 2 required "a grep for DataForSEO-specific identifiers outside the
 * adapter file returns nothing." That grep returns eight hits today and every
 * one is benign: the `"dataforseo"` value of the OpportunitySource enum (which
 * is PROVENANCE — deleting it would destroy the record of where 96
 * opportunities came from), the vendor→source map, agent-registry mandate copy,
 * admin UI copy, and doc comments. Pursued literally, the check demands the
 * deletion of the provenance trail. §4 states the correct rule and §9 degraded
 * it, so §4's wording is what is enforced here: no vendor FIELD NAME, ENDPOINT,
 * RESPONSE TYPE or CREDENTIAL outside the adapter.
 *
 * §11 item 14's separability grep tested for the identifiers "data-moat" and
 * "provider-network-gap", which exist NOWHERE in the repo — so it passed
 * vacuously on an empty codebase while the real PRN coupling sat untested
 * inside the generic pipeline. Replaced below with the actual coupling list.
 *
 * THE SHAPE OF BOTH CHECKS: a BASELINE, not a prohibition. Benign vendor
 * mentions are enumerated by file; a mention in any other file fails. That
 * catches the thing worth catching — a NEW vendor-specific identifier leaking
 * out of the adapter — without demanding the deletion of provenance.
 */

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

const srcFiles = walk(join(process.cwd(), "src")).map((f) => ({
  path: f.replace(/\\/g, "/"),
  content: readFileSync(f, "utf-8"),
}));

const ADAPTER = "platform/adapters/dataforseo.ts";

/**
 * Files permitted to say the vendor's NAME, each with the reason. A name is
 * not a coupling: provenance, a price attribution and a sentence of owner-facing
 * copy all legitimately identify which vendor was used.
 */
const NAME_MENTION_BASELINE: Record<string, string> = {
  "src/domain/search/contracts.ts":
    "OpportunitySource enum value — PROVENANCE. 96 committed records carry source: 'dataforseo'; deleting it destroys the record of where they came from.",
  "src/domain/search/discovery.ts":
    "vendorToSource() — maps an adapter's self-reported vendor string onto the provenance enum. Reads adapter.vendor; knows no vendor field names.",
  "src/domain/search/policy.ts":
    "Doc comments explaining that the $1 cap is the vendor's trial credit and that the batch size matches the vendor's task size.",
  "src/platform/economics/rates.ts":
    "The cost-rate registry. A price is ATTRIBUTED to its vendor by name or it is not sourced.",
  "src/platform/agents/registry.ts": "A04's mandate copy and a doc comment.",
  "src/platform/capabilities/contracts.ts": "Doc comment naming the adapter as the seam example.",
  "src/platform/capabilities/registry.ts":
    "implementation_ref on the seo.refresh_metrics capability — this IS the vendor-neutral indirection working. Code asks for the capability; the registry records which vendor implements it today, and swapping vendors is a registry edit. (Found by this test, not by a hand grep — which is the argument for the test.)",
  "src/platform/gateway/index.ts": "Doc comment naming the adapter as the seam example.",
  "src/app/admin/page.tsx": "Owner-facing copy: which vendor the owner is being asked to fund.",
};

/**
 * VENDOR-SPECIFIC IDENTIFIERS — the things §4 actually forbids outside the
 * adapter. Endpoints, request/response field names, and credential env vars.
 * None of these may appear anywhere else, with no baseline and no exceptions.
 */
const VENDOR_INTERNALS: Array<[string, RegExp]> = [
  ["endpoint host", /api\.dataforseo\.com/],
  ["labs endpoint path", /dataforseo_labs\//],
  ["keywords_data endpoint path", /keywords_data\//],
  ["vendor request field location_code", /\blocation_code\b/],
  ["vendor request field language_code", /\blanguage_code\b/],
  ["vendor response field search_volume", /\bsearch_volume\b/],
  ["vendor response field monthly_searches", /\bmonthly_searches\b/],
  ["vendor response envelope tasks[]", /\.tasks\s*\?\?\s*\[\]/],
  ["credential env var", /DATAFORSEO_[A-Z_]+/],
];

describe("vendor neutrality (C2) — the rule §4 states, not the one §9 degraded", () => {
  it("the provenance enum value survives — deleting it was never the goal", () => {
    expect(OpportunitySource.options).toContain("dataforseo");
  });

  it("only the adapter knows vendor endpoints, field names or credentials", () => {
    for (const { path, content } of srcFiles) {
      if (path.endsWith(ADAPTER)) continue;
      for (const [label, pattern] of VENDOR_INTERNALS) {
        expect(pattern.test(content), `${path} contains a ${label}`).toBe(false);
      }
    }
  });

  it("no NEW file mentions the vendor by name — the baseline is the whole list", () => {
    const offenders = srcFiles
      .filter(({ path, content }) => !path.endsWith(ADAPTER) && /dataforseo/i.test(content))
      .map(({ path }) => path)
      .filter((path) => !Object.keys(NAME_MENTION_BASELINE).some((b) => path.endsWith(b)));
    expect(
      offenders,
      `new vendor-name mentions outside the adapter. If the mention is legitimate provenance or attribution, add it to NAME_MENTION_BASELINE with a reason; if it is a coupling, move it behind SeoDataAdapter.`
    ).toEqual([]);
  });

  it("the baseline itself is real — every entry still exists and still mentions the vendor", () => {
    // A baseline that outlives its reason is worse than none: it grants a
    // standing exemption to a file that no longer needs one.
    for (const baseline of Object.keys(NAME_MENTION_BASELINE)) {
      const file = srcFiles.find((f) => f.path.endsWith(baseline));
      expect(file, `${baseline} is in the baseline but does not exist`).toBeDefined();
      expect(/dataforseo/i.test(file!.content), `${baseline} no longer mentions the vendor — drop it from the baseline`).toBe(true);
    }
  });

  it("the domain layer never imports the vendor adapter — only the interface", () => {
    for (const { path, content } of srcFiles) {
      if (!path.includes("/domain/")) continue;
      expect(content, path).not.toMatch(/adapters\/dataforseo/);
    }
  });
});

/**
 * SEPARABILITY (C3, hard canon rule 6). The Auto SEO Page Engine — A04's
 * generic layer — is named in the vault's own project statement as the
 * white-label per-client product. So "could this module be lifted out and sold
 * standalone" is a running design constraint, not a someday-refactor.
 *
 * These tests pin the POSITION taken in docs/A04-STEP0-AUDIT.md §4: the market
 * vocabulary is data, and the machinery that reads it is generic. Two couplings
 * are knowingly left in place and are recorded here rather than hidden.
 */
describe("separability (C3) — the real coupling, not two identifiers that never existed", () => {
  const file = (suffix: string) => srcFiles.find((f) => f.path.endsWith(suffix))!;

  it("the vocabulary is DATA: no PRN word list survives as a constant in the scorer", () => {
    const scoring = file("domain/search/scoring.ts").content;
    expect(scoring).not.toMatch(/"general_home_problem"/);
    expect(scoring).not.toMatch(/PROBLEM_SIGNALS/);
    expect(scoring).not.toMatch(/TOOL_HINTS/);
  });

  it("the classifier holds no inline regexes or word arrays any more", () => {
    const classifier = file("domain/search/intent-classifier.ts").content;
    // The six US home-trade regexes and both word lists moved to vocabulary.ts.
    expect(classifier).not.toMatch(/\bhvac\|/);
    expect(classifier).not.toMatch(/const PROBLEM_SIGNALS/);
    expect(classifier).not.toMatch(/const TOOL_HINTS/);
  });

  it("the generic machinery imports no PRN vocabulary except as a default", () => {
    // recommend.ts, intent-family.ts and portfolio.ts are the lift-out core.
    for (const suffix of [
      "domain/search/recommend.ts",
      "domain/search/intent-family.ts",
      "domain/search/portfolio.ts",
    ]) {
      expect(file(suffix).content, suffix).not.toMatch(/PRN_TRIAL_VOCABULARY/);
    }
  });

  /**
   * KNOWINGLY LEFT COUPLED — recorded, not hidden. Both are real PRN couplings
   * inside the generic layer, both were judged out of scope for this build, and
   * both are stated in docs/A04-STEP0-AUDIT.md §4 with the reason.
   */
  it("STILL COUPLED: intentFitScore encodes the PRN thesis in code", () => {
    // problem 100 / tool 70 / informational 50 IS the acquisition thesis.
    // Parameterizing it is a larger call than a build session should make.
    expect(file("domain/search/scoring.ts").content).toMatch(/case "problem":/);
  });

  it("STILL COUPLED: discovery imports the PRN classifier directly", () => {
    // Making the classifier injectable is the right extraction seam but it
    // changes DiscoveryDeps — an A04 follow-up, not a Wave-2 change.
    expect(file("domain/search/discovery.ts").content).toMatch(
      /from "@\/domain\/search\/intent-classifier"/
    );
  });
});
