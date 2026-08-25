/**
 * Factory runner — the deterministic A04 -> A05 -> A06 pass over the seed
 * research, producing the committed staged portfolio the staging site and
 * admin dashboard read (no database required):
 *
 *   npm run factory
 *
 * Writes data/factory/{opportunities,staged-specs,qa-results}.json.
 * Nothing here publishes anything: PASS pages enter the owner publish queue.
 * Re-run whenever the seed data, policy, scoring, or content bank changes.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { importSeedRows, type SeedFile } from "../src/domain/search/importer";
import { evaluatePortfolio } from "../src/domain/search/portfolio";
import { buildCandidatePages, pageEligibleIntent } from "../src/domain/search/factory";
import { qaCandidatePages } from "../src/domain/search/qa";
import { SAMPLE_PAGE_SPEC } from "../src/domain/search/fixtures/sample-page-spec";
import { FilePolicyStore } from "../src/platform/stores/policy-file";
import { opportunityDecisionStore } from "../src/platform/search/decision-store";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "data", "factory");
const NOW = "2026-08-14T18:00:00Z"; // deterministic stamp; committed output must be reproducible

async function main() {
  const seedFile = JSON.parse(
    readFileSync(path.join(ROOT, "tests", "fixtures", "seed-research", "seed-rows.json"), "utf-8")
  ) as SeedFile;
  const policy = await new FilePolicyStore(path.join(ROOT, "data", "seo-factory-policy.json")).getActive();

  const imported = importSeedRows(seedFile, NOW);
  const { opportunities, summary } = evaluatePortfolio(imported, policy);

  // WHICH INTENTS MAY BECOME DOORS IS POLICY NOW, NOT A LINE IN THIS SCRIPT
  // (C6 / pre-answer 8). This used to be a hardcoded `intent_type === "problem"`
  // filter with a comment above it — the only guard standing between 59
  // tool-intent opportunities and the page factory, living in a CLI script
  // where no owner would ever find it. `page_eligible_intent_types` defaults to
  // ["problem"], so the behaviour is identical and the rule is now visible and
  // changeable in policy. The STEERING RULING itself (do tool topics belong in
  // the queue at all?) is TODO-ASK-OWNER — Melissa's, parked, see policy.ts.
  //
  // ONE PREDICATE, NOT A SECOND COPY OF THE RULE (inspection F3). Moving the
  // value into policy was only half the fix: for one build this script was the
  // only thing that READ it, so both shipped run modes — the admin route and
  // A04's approval hook — built tool-intent doors anyway. Enforcement now lives
  // in the shared generation path, and this script calls the same
  // `pageEligibleIntent` predicate rather than reimplementing it as a Set.
  //
  // Skip opportunities that already have a handcrafted/staged page — the
  // factory builds NEW doors, it never re-builds an existing one.
  const alreadyStaged = new Set([SAMPLE_PAGE_SPEC.search_opportunity_id, SAMPLE_PAGE_SPEC.primary_query]);
  const notDoors: Array<{ keyword: string; intent_type: string }> = [];
  const problemNew = opportunities.filter((o) => {
    if (alreadyStaged.has(o.search_opportunity_id) || alreadyStaged.has(o.keyword)) return false;
    if (!pageEligibleIntent(o, policy.page_eligible_intent_types).eligible) {
      notDoors.push({ keyword: o.keyword, intent_type: o.intent_type });
      return false;
    }
    return true;
  });
  /**
   * THE OWNER'S DECISIONS, JOINED AT READ TIME (coherence seam 2, A05 build).
   *
   * `buildCandidatePages` no longer filters on A04's recommendation — it asks
   * `isOwnerApproved()`, which folds the append-only decision history. That
   * history is an OVERLAY (decisions live in their own store precisely so this
   * script can regenerate the committed artifact without eating them), so it
   * has to be loaded and handed in.
   */
  const decisions = await opportunityDecisionStore(() => null).list();
  const { specs, skipped, not_new_page } = buildCandidatePages(
    problemNew,
    policy.max_new_pages_per_period,
    // A05's namespaced policy sub-block (C2/C3): template identity, the
    // canonical-path prefix and any data-supplied content families.
    { now: () => NOW, policy: policy.page_factory },
    decisions
  );

  // The handcrafted sample page is already staged; QA new candidates against it.
  const qa = qaCandidatePages(specs, [SAMPLE_PAGE_SPEC]);
  const stagedSpecs = specs.map((spec) => {
    const result = qa.find((r) => r.page_spec_id === spec.page_spec_id)!;
    return {
      ...spec,
      qa: { state: result.state, reasons: result.reasons },
      user_value_score: result.user_value_score,
    };
  });

  /**
   * FAIL CLOSED BEFORE OVERWRITING A NON-EMPTY PORTFOLIO WITH AN EMPTY ONE.
   *
   * The gate above is now the owner's decision, and today ZERO of the 96
   * committed opportunities carries one — they are all at status "candidate".
   * So a plain re-run of this script would compute an empty page set and write
   * it straight over data/factory/staged-specs.json, silently deleting the six
   * committed staged doors (and, with them, six of the seven pages the trial
   * site serves). That is not a build failure anyone would notice until the
   * site went blank.
   *
   * The refusal is the honest outcome: the gate got stricter, the committed
   * artifact predates the gate, and re-deriving it requires the owner to
   * actually accept the opportunities in /admin/opportunities first. Deleting
   * the file is the deliberate way through, which is exactly the amount of
   * friction a wipe of the public portfolio deserves.
   */
  const stagedPath = path.join(OUT, "staged-specs.json");
  if (stagedSpecs.length === 0 && existsSync(stagedPath)) {
    const committed = JSON.parse(readFileSync(stagedPath, "utf-8")) as { specs: unknown[] };
    if (committed.specs.length > 0) {
      console.error(
        `REFUSING TO WRITE. This run produced 0 pages but ${committed.specs.length} are already committed in data/factory/staged-specs.json.\n\n` +
          `A05's trigger is now the OWNER'S DECISION (status === "approved"), not A04's recommendation — coherence report seam 2.\n` +
          `${summary.total} opportunities were scored; ${opportunities.filter((o) => o.status === "approved").length} carry an owner approval; ${decisions.length} decisions are on record.\n\n` +
          `Accept opportunities in /admin/opportunities and re-run, or delete data/factory/staged-specs.json to deliberately clear the portfolio.`
      );
      process.exit(2);
    }
  }

  mkdirSync(OUT, { recursive: true });
  writeFileSync(path.join(OUT, "opportunities.json"), JSON.stringify({ generated_at: NOW, summary, opportunities }, null, 2));
  writeFileSync(stagedPath, JSON.stringify({ generated_at: NOW, specs: stagedSpecs, skipped }, null, 2));
  writeFileSync(path.join(OUT, "qa-results.json"), JSON.stringify({ generated_at: NOW, results: qa }, null, 2));

  console.log(`opportunities: ${summary.total}`, summary.by_recommendation);
  // Never silent: an opportunity policy refuses to make a door is REPORTED,
  // the same way the run's `ineligible_intent` bucket reports it (F3).
  if (notDoors.length > 0) {
    const byIntent = notDoors.reduce<Record<string, number>>((acc, r) => {
      acc[r.intent_type] = (acc[r.intent_type] ?? 0) + 1;
      return acc;
    }, {});
    console.log(
      `ineligible intent -> never a door (${notDoors.length}):`,
      byIntent,
      `— policy.page_eligible_intent_types = [${policy.page_eligible_intent_types.join(", ")}]`
    );
  }
  console.log(`owner-approved -> pages built: ${specs.length}, skipped: ${skipped.length}`);
  if (not_new_page.length > 0) {
    console.log(`approved but NOT a new page (${not_new_page.length}):`);
    for (const row of not_new_page) console.log(`  - ${row.keyword}: ${row.reason}`);
  }
  console.log(`QA: ${qa.filter((r) => r.state === "PASS").length} PASS / ${qa.filter((r) => r.state === "FAIL").length} FAIL`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
