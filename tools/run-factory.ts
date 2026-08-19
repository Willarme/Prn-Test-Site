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
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { importSeedRows, type SeedFile } from "../src/domain/search/importer";
import { evaluatePortfolio } from "../src/domain/search/portfolio";
import { buildCandidatePages } from "../src/domain/search/factory";
import { qaCandidatePages } from "../src/domain/search/qa";
import { SAMPLE_PAGE_SPEC } from "../src/domain/search/fixtures/sample-page-spec";
import { FilePolicyStore } from "../src/platform/stores/policy-file";

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

  // Doors are PROBLEM-intent pages (D-3). Tool/calculator opportunities stay
  // in the portfolio for a later product line but never become doors here.
  // Skip opportunities that already have a handcrafted/staged page — the
  // factory builds NEW doors, it never re-builds an existing one.
  const alreadyStaged = new Set([SAMPLE_PAGE_SPEC.search_opportunity_id, SAMPLE_PAGE_SPEC.primary_query]);
  const problemNew = opportunities.filter(
    (o) => o.intent_type === "problem" && !alreadyStaged.has(o.search_opportunity_id) && !alreadyStaged.has(o.keyword)
  );
  const { specs, skipped } = buildCandidatePages(problemNew, policy.max_new_pages_per_period, {
    now: () => NOW,
  });

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

  mkdirSync(OUT, { recursive: true });
  writeFileSync(path.join(OUT, "opportunities.json"), JSON.stringify({ generated_at: NOW, summary, opportunities }, null, 2));
  writeFileSync(path.join(OUT, "staged-specs.json"), JSON.stringify({ generated_at: NOW, specs: stagedSpecs, skipped }, null, 2));
  writeFileSync(path.join(OUT, "qa-results.json"), JSON.stringify({ generated_at: NOW, results: qa }, null, 2));

  console.log(`opportunities: ${summary.total}`, summary.by_recommendation);
  console.log(`problem-intent NEW -> pages built: ${specs.length}, skipped: ${skipped.length}`);
  console.log(`QA: ${qa.filter((r) => r.state === "PASS").length} PASS / ${qa.filter((r) => r.state === "FAIL").length} FAIL`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
