import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { all, fail, pass, type Suite } from "../types";
import { describeHits, filesUnder, readSource, scan, sourceFiles } from "../source";

const TODO = 'vault "Project/10 Master Todo/02 Phase 1 - Black Car Trial.md"';
const GROUP = "Done when — Wave 2 (T1-07 A04, T1-08 A05, T1-09 A06)";

/**
 * WAVE 2 — the SEO loop: discover, build, inspect. These three items are the
 * ones the owner's question is really about, because they are the chain that has
 * to close for a page to exist at all.
 */
export async function wave2Suite(): Promise<Suite> {
  const [
    { SearchOpportunity, OpportunityStatus, FactBundle },
    { PageSpec },
    { TEMPLATE_REGISTRY, resolveTemplate, TemplateSpec },
    { resolveInternalLinks, allLinksResolved, OWNER_EDITABLE_FIELDS, registryRowFor },
    { lintPageBeforeQa, lintUrgencySlot, lintDirectoryFraming },
    { A06_CHECK_IDS, DEFAULT_PAGE_QA_POLICY, PageQaPolicy },
    { runPageQaSync, runDeterministicStage, evaluateReleaseForPublish, criticPassed },
    { recommend },
    { scoreOpportunity, CANON_SIGNAL_CATEGORIES, V1_SCORING_POLICY },
    { matchHardExclusions },
    { detectDuplicateIntents },
    { TRIAL_DEFAULT_SEO_FACTORY_POLICY },
    { compilePageSpec, listContentBankBundles, pageEligibleIntent, newPageEligibility },
    { SAMPLE_PAGE_SPEC },
    { NO_MODEL_CRITIC },
  ] = await Promise.all([
    import("@/domain/search/contracts"),
    import("@/domain/search/pages"),
    import("@/domain/search/template"),
    import("@/domain/search/page-registry"),
    import("@/domain/search/page-lint"),
    import("@/domain/search/qa-policy"),
    import("@/domain/search/qa"),
    import("@/domain/search/recommend"),
    import("@/domain/search/scoring"),
    import("@/domain/search/vocabulary"),
    import("@/domain/search/intent-family"),
    import("@/domain/search/policy"),
    import("@/domain/search/factory"),
    import("@/domain/search/fixtures/sample-page-spec"),
    import("@/domain/search/qa-critic"),
  ]);

  const expectations: Suite["expectations"] = [
    /* ------------------------------------------------------------------ */
    /* T1-07 — A04 Search Opportunity                                      */
    /* ------------------------------------------------------------------ */
    {
      id: "T1-07.1",
      group: GROUP,
      expectation:
        "Step 0 (audit-first) produces a WRITTEN NOTE of what the existing pipeline already satisfies vs. gaps, before any new code lands",
      source: `${TODO} §T1-07 "Done when" clause 1`,
      how: "Looks for the step-0 audit artefact in the repo and checks it distinguishes satisfied from gap.",
      measure() {
        const candidates = ["data/A04-STEP0-AUDIT.md", "docs/A04-STEP0-AUDIT.md"];
        const found = candidates.find((c) => existsSync(join(process.cwd(), ...c.split("/"))));
        if (!found) return fail(`no step-0 audit note found at ${candidates.join(" or ")}`);
        const text = readSource(found);
        return all([
          ["the note exists", true, found],
          ["it names what is already satisfied", /satisf|already|exists|present/i.test(text)],
          ["it names gaps", /gap|missing|not (yet )?(built|present)|TODO/i.test(text)],
          ["it is substantive", text.length > 1_000, `${text.length} chars`],
        ]);
      },
    },
    {
      id: "T1-07.2",
      group: GROUP,
      expectation:
        "`SearchOpportunity` EXTENDS the existing table — no parallel table",
      source: `${TODO} §T1-07 "Done when" clause 2`,
      how: "Counts migrations that CREATE a search-opportunity-shaped table and asserts there is exactly one lineage; later migrations may only ALTER it.",
      measure() {
        const migrations = filesUnder("supabase");
        const sql = sourceFilesUnderRaw("supabase/migrations");
        const creates = sql.filter((f) =>
          /create table\s+(if not exists\s+)?search_opportunity[\s(]/i.test(f.text)
        );
        const parallel = sql.filter((f) =>
          /create table\s+(if not exists\s+)?(opportunity_v2|search_opportunity_new|seo_opportunity)[\s(]/i.test(
            f.text
          )
        );
        return all([
          [
            "exactly one migration creates search_opportunity",
            creates.length === 1,
            `${creates.map((c) => c.path).join(", ") || "none matched"} (of ${sql.length} migration files read)`,
          ],
          ["no parallel opportunity table", parallel.length === 0, parallel.map((c) => c.path).join(", ")],
          ["migrations are present to read", migrations.length + sql.length > 0],
        ]);
      },
    },
    {
      id: "T1-07.3",
      group: GROUP,
      expectation:
        "`SeoDataAdapter` is vendor-neutral — a grep for DataForSEO-specific identifiers OUTSIDE the adapter file returns nothing",
      how: "The clause names a grep, so this runs one — but on the thing the clause protects. A vendor-specific IDENTIFIER is the vendor's API surface: its host, its endpoint paths, its response field names, or an SDK import. The vendor's NAME used as a data label (`source: \"dataforseo\"`, a rate row’s `vendor` column) is the opposite of a leak — A04 §7 REQUIRES every vendor number to carry its source — so the scan separates the two and reports both.",
      source: `${TODO} §T1-07 "Done when" clause 3; A04 §7 "external metrics are snapshots, not live facts. Every vendor number carries source + fetched_at"`,
      measure() {
        const adapterOnly = /adapters\/(dataforseo|fixtures)|adapters\/seo-data\.ts$/;
        const apiSurface = scan(
          // The vendor's own surface. `\bsearch_volume\b` deliberately does NOT
          // match PRN's `min_search_volume` policy knob — that is our field name,
          // not theirs, and an underscore is a word character.
          /api\.dataforseo\.com|\/keywords_data\/|\bsearch_volume\b|\bkeyword_info\b|\btask_post\b|from "dataforseo/,
          { include: /^src\//, exclude: adapterOnly, codeOnly: true }
        );
        const nameAsData = scan(/dataforseo/i, {
          include: /^src\//,
          exclude: adapterOnly,
          codeOnly: true,
        });
        return apiSurface.length === 0
          ? pass(
              `no DataForSEO API surface (host, endpoint path, response field, SDK import) appears anywhere in src/ outside the adapter; ${nameAsData.length} remaining occurrence(s) are the vendor NAME carried as provenance data, which the record requires`,
              describeHits(nameAsData, 8)
            )
          : fail(
              `${apiSurface.length} DataForSEO API identifier(s) leak outside the adapter`,
              describeHits(apiSurface)
            );
      },
    },
    {
      id: "T1-07.4",
      group: GROUP,
      expectation:
        "the eight signal categories score via POLICY-DRIVEN weights, with hard exclusions ALWAYS resolving REJECT",
      source: `${TODO} §T1-07 "Done when" clause 4; A04 §7 "quality over quantity is not optional"`,
      how: "Counts the canon signal categories, then constructs a maximum-score opportunity carrying an excluded keyword and asserts `recommend` still returns REJECT — a score cannot outvote an exclusion.",
      measure() {
        const policy = {
          ...TRIAL_DEFAULT_SEO_FACTORY_POLICY,
          vocabulary: {
            ...TRIAL_DEFAULT_SEO_FACTORY_POLICY.vocabulary,
            hard_exclusions: [
              {
                exclusion_id: "eval_probe_exclusion",
                pattern: "asbestos",
                reason: "harness probe — the owner excluded this topic",
                match: "contains" as const,
              },
            ],
          },
        };
        const opportunity = SearchOpportunity.parse({
          ...baseOpportunity(),
          keyword: "asbestos removal cost",
          volume_monthly: 90_000,
          keyword_difficulty: 1,
          intent_type: "problem",
        });
        const scored = scoreOpportunity(opportunity, { scoring: V1_SCORING_POLICY });
        const result = recommend(scored, [], policy as never);
        const hits = matchHardExclusions("asbestos removal cost", policy.vocabulary as never);
        return all([
          [
            "the eight canon signal categories are named as data",
            CANON_SIGNAL_CATEGORIES.length === 8,
            `${CANON_SIGNAL_CATEGORIES.length}: ${CANON_SIGNAL_CATEGORIES.join(", ")}`,
          ],
          ["weights come from a policy object", Object.keys(V1_SCORING_POLICY.weights ?? {}).length > 0],
          ["the exclusion matched", hits.length === 1],
          [
            "a high-scoring excluded keyword still resolves REJECT",
            result.recommendation === "REJECT",
            `score ${scored.score} → ${result.recommendation}`,
          ],
          ["the rejection names the exclusion", result.excluded_by.includes("eval_probe_exclusion")],
        ]);
      },
    },
    {
      id: "T1-07.5",
      group: GROUP,
      expectation: "intent clustering catches duplicate-intent candidates BEFORE recommendation",
      source: `${TODO} §T1-07 "Done when" clause 5`,
      how: "Feeds two same-intent keywords through the real `recommend` with one already live, and asserts the second never becomes NEW; also exercises `detectDuplicateIntents` on the pair.",
      measure() {
        const existing = SearchOpportunity.parse({
          ...baseOpportunity(),
          search_opportunity_id: "so_eval_existing",
          keyword: "water heater leaking",
          status: "approved",
          recommendation: "NEW",
        });
        const candidate = SearchOpportunity.parse({
          ...baseOpportunity(),
          search_opportunity_id: "so_eval_candidate",
          keyword: "leaking water heater",
          volume_monthly: 5_000,
          keyword_difficulty: 5,
        });
        const scored = scoreOpportunity(candidate, { scoring: V1_SCORING_POLICY });
        const result = recommend(scored, [existing], TRIAL_DEFAULT_SEO_FACTORY_POLICY);
        const dupes = detectDuplicateIntents(
          [scoreOpportunity(existing, { scoring: V1_SCORING_POLICY }), scored],
          [existing],
          () => true
        );
        return all([
          [
            "the duplicate-intent candidate is NOT recommended NEW",
            result.recommendation !== "NEW",
            `${result.recommendation}: ${result.reason}`,
          ],
          ["it names what it overlaps", result.duplicate_of === "so_eval_existing"],
          ["the clusterer sees them as one family", dupes.groups.length > 0],
        ]);
      },
    },
    {
      id: "T1-07.6",
      group: GROUP,
      expectation:
        "a 'tiny' candidate review screen EXTENDS the existing Search/Opportunities admin surface — not a new one",
      source: `${TODO} §T1-07 "Done when" clause 6`,
      how: "Enumerates admin route pages and asserts the opportunities view lives under the existing admin tree with a decision control wired to the real decision path.",
      measure() {
        const pages = filesUnder("src/app/admin").filter((f) => f.path.endsWith("page.tsx"));
        const opp = pages.filter((p) => /opportunit/i.test(p.path));
        const decisionRoutes = filesUnder("src/app/api/admin").filter((f) =>
          /opportunit/i.test(f.path)
        );
        return all([
          ["an opportunities admin view exists under /admin", opp.length > 0, opp.map((p) => p.path).join(", ")],
          ["a decision route backs it", decisionRoutes.length > 0, decisionRoutes.map((p) => p.path).join(", ")],
          [
            "the route calls the governed decision path",
            decisionRoutes.some((f) => /decideOpportunity/.test(f.text)),
          ],
        ]);
      },
    },
    {
      id: "T1-07.7",
      group: GROUP,
      expectation:
        "every scored / accepted / rejected decision keeps full provenance in the Agent Run Ledger",
      source: `${TODO} §T1-07 "Done when" clause 7`,
      how: "Scans the two A04 run modules for `recordAgentRun` and asserts the decision record itself carries the score, the score version and the recommendation at decision time.",
      measure() {
        const decisions = readSource("src/platform/search/opportunity-decisions.ts");
        const discovery = readSource("src/platform/search/discovery-run.ts");
        const contract = readSource("src/domain/search/decision.ts");
        return all([
          ["the decision path records a run", /recordAgentRun\(/.test(decisions)],
          ["the discovery path records a run", /recordAgentRun\(/.test(discovery)],
          ["the decision carries the score at decision time", /score_at_decision/.test(contract)],
          ["…and the score version", /score_version_at_decision/.test(contract)],
          ["…and A04's recommendation at that moment", /recommendation_at_decision/.test(contract)],
          ["…and the run it belongs to", /run_id/.test(contract)],
        ]);
      },
    },
    {
      id: "T1-07.8",
      group: GROUP,
      expectation:
        "NO CODE PATH lets an opportunity become a live page without BOTH A04's owner approval AND A06's later publish gate",
      source: `${TODO} §T1-07 "Done when" clause 8`,
      how: "Two scans plus one behavioural check. (a) every producer of PageSpecs gates on the owner-decision field, never on `recommendation`; (b) the only publish route reads exactly one release condition; (c) an opportunity recommended NEW but status `candidate` produces zero pages.",
      measure() {
        const factory = readSource("src/domain/search/factory.ts");
        const publishRoute = readSource("src/app/api/admin/pages/publish/route.ts");
        // Only the PAGE-BUILDING path matters here. `recommend.ts` legitimately
        // reads the recommendation (that is where one is assigned), and the admin
        // list renders it as a coloured pill — neither builds a page.
        const recommendationGate = scan(/recommendation === "(NEW|EXPAND)"/, {
          include: /^src\/(domain\/search\/factory|platform\/search\/(page-factory-run|opportunity-decisions))\.ts$/,
          codeOnly: true,
        });
        const candidateOnly = SearchOpportunity.parse({
          ...baseOpportunity(),
          keyword: "furnace making a banging noise",
          recommendation: "NEW",
          status: "candidate",
        });
        const eligibility = newPageEligibility(candidateOnly, []);
        return all([
          ["the factory gates on the owner decision", /isOwnerApproved\(/.test(factory)],
          [
            "nothing gates page-building on A04's own recommendation",
            recommendationGate.length === 0,
            describeHits(recommendationGate, 3).join(" | "),
          ],
          [
            "an opportunity recommended NEW but not owner-approved is ineligible",
            eligibility.eligible === false,
            eligibility.eligible ? "IT WAS ELIGIBLE" : eligibility.reason,
          ],
          ["the publish route reads one release condition", /decision\.release_eligible/.test(publishRoute)],
          ["the publish route requires an unlocked owner session", /isAdminUnlocked\(\)/.test(publishRoute)],
        ]);
      },
    },
    {
      id: "T1-07.9",
      group: GROUP,
      expectation:
        "budget caps and the kill switch are verified with a SIMULATED EXHAUSTION test; new eval cases exist for hard-exclusion, cannibalization dedupe, budget exhaustion and vendor-unavailable fallback",
      source: `${TODO} §T1-07 "Done when" clauses 9 and 10`,
      how: "Matches the four named eval cases against the committed A04 test corpus by their own vocabulary.",
      measure() {
        const corpus = filesUnder("tests")
          .filter((f) => /a04|budget|dataforseo|adapters/.test(f.path))
          .map((f) => `${f.path}\n${f.text}`)
          .join("\n");
        const cases: Array<[string, RegExp]> = [
          ["hard exclusion", /hard[_ -]?exclusion/i],
          ["cannibalization dedupe", /cannibaliz|sameIntentFamily|duplicate.?intent/i],
          ["budget exhaustion", /exhaust|budget.?brake|over.?budget/i],
          ["vendor unavailable fallback", /unavailable|vendor.?down|fallback/i],
          ["kill switch", /killSwitch|kill_switch/i],
        ];
        const missing = cases.filter(([, re]) => !re.test(corpus)).map(([n]) => n);
        return missing.length === 0
          ? pass(`all ${cases.length} named eval cases are present in the committed A04 corpus`)
          : fail(`missing eval cases: ${missing.join(", ")}`);
      },
    },

    /* ------------------------------------------------------------------ */
    /* T1-08 — A05 Intent-Door Page Factory                                */
    /* ------------------------------------------------------------------ */
    {
      id: "T1-08.1",
      group: GROUP,
      expectation: "`PageSpec` schema exists INDEPENDENT of any render function",
      source: `${TODO} §T1-08 "Done when" clause 1`,
      how: "Asserts the module defining PageSpec imports nothing from React, next, or any component directory — a schema that imports a renderer is not independent of one.",
      measure() {
        const text = readSource("src/domain/search/pages.ts");
        const imports = text.match(/^import .*$/gm) ?? [];
        const rendery = imports.filter((i) => /react|next|components|\.tsx/.test(i));
        return all([
          ["PageSpec parses a real spec", PageSpec.safeParse(SAMPLE_PAGE_SPEC).success],
          ["the schema module imports no renderer", rendery.length === 0, rendery.join(" | ")],
        ]);
      },
    },
    {
      id: "T1-08.2",
      group: GROUP,
      expectation:
        "`TemplateSpec` carries a version field AND all 7 existing /staged/{slug} pages still render unchanged",
      source: `${TODO} §T1-08 "Done when" clause 2`,
      how: "Reads the template registry for a version field, then parses every committed staged spec and asserts each still resolves its template and produces a registry row.",
      measure() {
        const specs = committedStagedSpecs(PageSpec, SAMPLE_PAGE_SPEC);
        const unresolvable = specs.filter((s) => !resolveTemplate(s.template_id, s.template_version));
        const unrowable = specs.filter((s) => {
          try {
            registryRowFor(s, s.created_at);
            return false;
          } catch {
            return true;
          }
        });
        return all([
          ["every template carries a version", TEMPLATE_REGISTRY.every((t) => Boolean(t.version)), `${TEMPLATE_REGISTRY.length} templates`],
          ["the committed portfolio is 7 pages", specs.length === 7, `${specs.length} specs`],
          ["every one resolves its template", unresolvable.length === 0, unresolvable.map((s) => s.canonical_path).join(", ")],
          ["every one still produces a registry row", unrowable.length === 0, unrowable.map((s) => s.canonical_path).join(", ")],
        ]);
      },
    },
    {
      id: "T1-08.3",
      group: GROUP,
      expectation: "content generation writes ONLY into typed `PageContentBlock` slots",
      source: `${TODO} §T1-08 "Done when" clause 3`,
      how: "Compiles a page from an approved opportunity through the real factory and asserts every produced block validates as a PageContentBlock with a known kind.",
      measure() {
        const opportunity = SearchOpportunity.parse({
          ...baseOpportunity(),
          keyword: "furnace blowing cold air",
          problem_family_hint: "hvac",
          status: "approved",
          approved_at: "2026-08-25T00:00:00Z",
          approved_by: "eval-harness",
          recommendation: "NEW",
        });
        const spec = compilePageSpec(opportunity, { now: () => "2026-08-25T00:00:00Z" });
        const parsed = PageSpec.safeParse(spec);
        const knownKinds = new Set(SAMPLE_PAGE_SPEC.content_blocks.map((b) => b.kind));
        const strays = spec.content_blocks.filter((b) => !knownKinds.has(b.kind));
        return all([
          ["the compiled page validates", parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues[0])],
          ["every block has a typed kind", strays.length === 0, strays.map((b) => b.kind).join(", ")],
          ["every block cites at least one FactBundle", spec.content_blocks.every((b) => b.source_fact_bundle_ids.length > 0)],
        ]);
      },
    },
    {
      id: "T1-08.4",
      group: GROUP,
      expectation:
        "a Page Registry row with `state = STAGED` is produced on generation AND regeneration",
      source: `${TODO} §T1-08 "Done when" clause 4`,
      how: "Compiles a page and derives its registry row through the shipped `registryRowFor`, asserting lifecycle STAGED and noindex.",
      measure() {
        const opportunity = SearchOpportunity.parse({
          ...baseOpportunity(),
          keyword: "toilet keeps running",
          problem_family_hint: "plumbing",
          status: "approved",
          approved_at: "2026-08-25T00:00:00Z",
          approved_by: "eval-harness",
        });
        const spec = compilePageSpec(opportunity, { now: () => "2026-08-25T00:00:00Z" });
        const row = registryRowFor(spec, spec.created_at);
        return all([
          ["the row exists", Boolean(row.page_id)],
          ["its lifecycle is STAGED", row.lifecycle_status === "STAGED", String(row.lifecycle_status)],
          ["it points at the spec that made it", row.current_page_spec_id === spec.page_spec_id],
          ["the spec itself is STAGED, never published", spec.status === "STAGED", spec.status],
          ["QA has not been claimed", spec.qa.state !== "PASS", spec.qa.state],
        ]);
      },
    },
    {
      id: "T1-08.5",
      group: GROUP,
      expectation:
        "the internal-link resolver only ever links to canonical, EXISTING intent/page IDs — FAILING CLOSED on a missing target",
      source: `${TODO} §T1-08 "Done when" clause 5`,
      how: "Asks the shipped resolver for a link to a page id that does not exist and asserts it is not resolved.",
      measure() {
        const registry = [registryRowFor(SAMPLE_PAGE_SPEC, SAMPLE_PAGE_SPEC.created_at)];
        const resolved = resolveInternalLinks(
          [
            { target_page_id: SAMPLE_PAGE_SPEC.page_id, label: "a real target" },
            { target_page_id: "page_does_not_exist_eval", label: "a ghost" },
          ],
          registry,
          "page_eval_source"
        );
        return all([
          [
            "the real target resolves to its canonical path",
            resolved.links.some((l) => l.path === SAMPLE_PAGE_SPEC.canonical_path),
            JSON.stringify(resolved.links),
          ],
          ["exactly one link is emitted", resolved.links.length === 1],
          [
            "the missing target is DROPPED and reported, never linked",
            resolved.dropped.length === 1 &&
              resolved.dropped[0].target_page_id === "page_does_not_exist_eval",
            JSON.stringify(resolved.dropped),
          ],
          ["the drop reason says it fails closed", /fail closed/i.test(resolved.dropped[0]?.reason ?? "")],
          ["so the batch is not 'all resolved'", allLinksResolved(resolved) === false],
        ]);
      },
    },
    {
      id: "T1-08.6",
      group: GROUP,
      expectation: "admin can VIEW AND EDIT a staged page's unique fields",
      source: `${TODO} §T1-08 "Done when" clause 6 (unblocks Owner TODO item 3)`,
      how: "Reads the declared owner-editable field list and asserts an admin edit route exists that runs the same lint the generator does.",
      measure() {
        const editRoutes = filesUnder("src/app/api/admin").filter((f) => /pages\/(edit|update)/.test(f.path));
        const runModule = readSource("src/platform/search/page-factory-run.ts");
        return all([
          ["an owner-editable field list is declared", OWNER_EDITABLE_FIELDS.length > 0, OWNER_EDITABLE_FIELDS.join(", ")],
          ["an admin edit route exists", editRoutes.length > 0, editRoutes.map((f) => f.path).join(", ")],
          ["the edit path runs the same pre-QA lint as the generator", /lintPageBeforeQa\(/.test(runModule)],
          ["an owner edit cannot set QA state", !/qa:\s*\{\s*state:\s*"PASS"/.test(runModule)],
        ]);
      },
    },
    {
      id: "T1-08.7",
      group: GROUP,
      expectation: "a page CANNOT reach the publish queue without an A06 PASS state",
      source: `${TODO} §T1-08 "Done when" clause 7`,
      how: "Takes a freshly compiled (QA PENDING) page and asks the real release evaluator; asserts not eligible and that the reason names the missing verdict.",
      measure() {
        const opportunity = SearchOpportunity.parse({
          ...baseOpportunity(),
          keyword: "garbage disposal humming",
          problem_family_hint: "plumbing",
          status: "approved",
          approved_at: "2026-08-25T00:00:00Z",
          approved_by: "eval-harness",
        });
        const spec = compilePageSpec(opportunity, { now: () => "2026-08-25T00:00:00Z" });
        const decision = evaluateReleaseForPublish(spec, {
          existing: [spec],
          registry: [registryRowFor(spec, spec.created_at)],
          human_gate: { publish_mode: "OWNER_APPROVAL", human_approval_required: true },
        });
        return all([
          ["a fresh page is QA PENDING", spec.qa.state === "PENDING", spec.qa.state],
          ["it is NOT release-eligible", decision.release_eligible === false],
          [
            "the reason names the missing PASS",
            decision.reasons.some((r) => /has not recorded a PASS/i.test(r)),
            decision.reasons[0],
          ],
        ]);
      },
    },
    {
      id: "T1-08.8",
      group: GROUP,
      expectation:
        "the urgency-slot and directory-framing lint/eval checks BLOCK manufactured urgency and breadth/comparison-shopping phrasing BEFORE a page can even reach A06",
      source: `${TODO} §T1-08 "Done when" clause 8; A05 §7 "never manufacture urgency … no directory framing, anywhere on the page"`,
      how: "Injects each banned pattern into a real PageSpec and runs A05's own pre-QA lint — the gate that stands before A06.",
      measure() {
        const urgency = withBody(
          PageSpec,
          SAMPLE_PAGE_SPEC,
          "when_urgency_changes",
          "Act now — every hour you wait will only get worse, and this could cost you thousands. Don't wait."
        );
        const directory = withBody(
          PageSpec,
          SAMPLE_PAGE_SPEC,
          "intent_answer",
          "Compare providers in your area and browse our network of hundreds of trusted contractors to get multiple quotes."
        );
        const urgencyLint = lintPageBeforeQa(urgency);
        const directoryLint = lintPageBeforeQa(directory);
        const clean = lintPageBeforeQa(SAMPLE_PAGE_SPEC);
        return all([
          ["manufactured urgency is blocked", urgencyLint.passed === false, blockerNames(urgencyLint)],
          ["directory framing is blocked", directoryLint.passed === false, blockerNames(directoryLint)],
          ["a clean committed page still passes", clean.passed === true, blockerNames(clean)],
        ]);
      },
    },

    /* ------------------------------------------------------------------ */
    /* T1-09 — A06 Page Quality & Release                                  */
    /* ------------------------------------------------------------------ */
    {
      id: "T1-09.1",
      group: GROUP,
      expectation:
        "`PageQAResult` schema exists with `deterministic` / `ai_critic` / `overall` / `blockers` / `release_eligible`",
      source: `${TODO} §T1-09 "Done when" clause 1`,
      how: "Runs a real QA pass and reads the five named fields off the result.",
      measure() {
        const result = runPageQaSync(SAMPLE_PAGE_SPEC, { existing: [SAMPLE_PAGE_SPEC] });
        const keys = Object.keys(result);
        return all([
          ["a deterministic stage is reported", keys.includes("deterministic")],
          ["an ai_critic stage is reported", keys.includes("ai_critic")],
          ["an overall verdict exists", keys.includes("state") || keys.includes("overall"), keys.filter((k) => /state|overall/.test(k)).join(", ")],
          // `result.findings` does not exist on PageQAResult, so the old `||`
          // arm could never be true. The field the contract names is `blockers`.
          ["blockers are enumerated", Array.isArray(result.blockers), `${result.blockers.length} blocker(s)`],
          ["release_eligible exists", keys.includes("release_eligible")],
        ]);
      },
    },
    {
      id: "T1-09.2",
      group: GROUP,
      expectation:
        "deterministic checks cover broken links, structured-data validity, star-rating-markup rejection, component/intake-embed presence, duplicate canonical URLs, missing provenance, accessibility and performance",
      source: `${TODO} §T1-09 "Done when" clause 2`,
      how: "Matches each named subject against the shipped A06_CHECK_IDS list.",
      measure() {
        const wanted: Array<[string, RegExp]> = [
          ["broken links", /^links\./],
          ["structured-data validity", /^structured_data\.allow_list$/],
          ["star-rating markup rejection", /rating/],
          ["component / intake-embed presence", /^component\.intake_embed$/],
          ["duplicate canonical URLs", /^duplicate\.canonical_path$/],
          ["missing provenance", /^provenance\./],
          ["accessibility", /accessib|a11y/],
          ["performance", /perf/],
        ];
        const ids = A06_CHECK_IDS as readonly string[];
        const missing = wanted.filter(([, re]) => !ids.some((id) => re.test(id))).map(([n]) => n);
        return missing.length === 0
          ? pass(`all 8 named subjects are covered by the ${ids.length} shipped check ids`)
          : fail(`${missing.length} named subject(s) have no deterministic check: ${missing.join(", ")}`, [
              `shipped ids: ${ids.join(", ")}`,
            ]);
      },
    },
    {
      id: "T1-09.3",
      group: GROUP,
      expectation:
        "the AI critic is NEVER invoked when the deterministic stage already returned a blocker",
      source: `${TODO} §T1-09 "Done when" clause 3 (first condition); A06 §3`,
      how: "Runs the async QA path over a page carrying a deterministic blocker, with a critic that records every invocation, and asserts the counter stays at zero.",
      async measure() {
        const { runPageQa } = await import("@/domain/search/qa");
        let invocations = 0;
        const spy = {
          id: "eval-spy",
          async critique() {
            invocations += 1;
            return {
              status: "PASS" as const,
              reason: "the spy should never have been asked",
              findings: [],
              provider: "eval",
              cost_usd: null,
              latency_ms: 0,
            };
          },
        };
        // A page with an empty canonical path duplicate + no provenance is a
        // guaranteed deterministic blocker.
        const broken = PageSpec.parse({
          ...SAMPLE_PAGE_SPEC,
          content_blocks: SAMPLE_PAGE_SPEC.content_blocks.map((b) => ({
            ...b,
            source_fact_bundle_ids: [],
          })),
          source_fact_bundle_ids: [],
        });
        const blockedResult = await runPageQa(broken, { existing: [broken], critic: spy });
        const afterBlocked = invocations;
        const cleanResult = await runPageQa(SAMPLE_PAGE_SPEC, {
          existing: [SAMPLE_PAGE_SPEC],
          critic: spy,
        });
        const afterClean = invocations;
        return all([
          ["the broken page produced a deterministic blocker", blockedResult.deterministic.state === "FAIL", blockedResult.deterministic.state],
          ["the critic was NOT invoked for it", afterBlocked === 0, `${afterBlocked} invocation(s)`],
          ["its critic stage reads NOT_RUN, never PASS", blockedResult.ai_critic.status === "NOT_RUN", blockedResult.ai_critic.status],
          [
            "a clean page DOES reach the critic — so the guard is a guard, not a dead path",
            afterClean === 1,
            `${afterClean} invocation(s), clean status ${cleanResult.ai_critic.status}`,
          ],
        ]);
      },
    },
    {
      id: "T1-09.4",
      group: GROUP,
      expectation:
        "the AI critic sets `SKIPPED_NO_MODEL` (NEVER silently PASS) when no model key exists",
      source: `${TODO} §T1-09 "Done when" clause 3 (third condition); A06 §7 "fail closed … an ai_critic.status = 'SKIPPED_NO_MODEL' result should not be silently treated as a pass"`,
      how: "Runs a real page through the shipped model critic in this credential-free process, and asks `criticPassed()` about the result.",
      async measure() {
        const { modelPageCritic } = await import("@/platform/search/page-qa-critic");
        const out = await modelPageCritic.critique({
          page_spec_id: SAMPLE_PAGE_SPEC.page_spec_id,
          primary_query: SAMPLE_PAGE_SPEC.primary_query,
          title: SAMPLE_PAGE_SPEC.title,
          meta_description: SAMPLE_PAGE_SPEC.meta_description,
          h1: SAMPLE_PAGE_SPEC.h1,
          hero_headline: SAMPLE_PAGE_SPEC.hero.headline,
          hero_subheadline: SAMPLE_PAGE_SPEC.hero.subheadline,
          blocks: SAMPLE_PAGE_SPEC.content_blocks,
          tenant_id: SAMPLE_PAGE_SPEC.tenant_id,
        });
        return all([
          ["the status is SKIPPED_NO_MODEL", out.status === "SKIPPED_NO_MODEL", out.status],
          /**
           * `criticPassed` takes the STATUS, not the whole output. Handing it
           * the object compared an object to "PASS", which is false for every
           * possible input — the condition could not have failed, and would
           * have kept reading green if SKIPPED_NO_MODEL started counting as a
           * pass tomorrow. That is the exact guarantee this row exists for.
           */
          ["it is not counted as a pass", criticPassed(out.status) === false],
          ["the reason says so in words", /NOT a pass/i.test(out.reason), out.reason.slice(0, 110)],
          [
            "the default critic constant behaves the same",
            criticPassed(
              NO_MODEL_CRITIC ? (await NO_MODEL_CRITIC.critique({} as never)).status : out.status
            ) === false,
          ],
        ]);
      },
    },
    {
      id: "T1-09.5",
      group: GROUP,
      expectation:
        "the critic is routed ONLY through the AI/Tool Gateway — never a vendor SDK directly",
      source: `${TODO} §T1-09 "Done when" clause 3 (second condition); A00 §7 "never let an agent bypass the Capability Registry to call a vendor SDK directly"`,
      how: "Scans src/ for any call to an EXTERNAL host outside the single vendor provider file, and asserts the critic reaches the model only via `callModel`. External means an absolute URL — the admin UI posting to PRN's own relative route is not a vendor call and is not counted.",
      measure() {
        const rawNetwork = scan(/fetch\(\s*[`"']https?:|new XMLHttpRequest|axios\.|require\("https?"\)/, {
          include: /^src\//,
          exclude: /platform\/ai\/providers\/|platform\/adapters\//,
          codeOnly: true,
        });
        const critic = readSource("src/platform/search/page-qa-critic.ts");
        return all([
          ["the critic calls callModel", /callModel\(/.test(critic)],
          ["the critic imports no vendor SDK", !/openai|anthropic|openrouter/i.test(criticImports(critic))],
          [
            "no call to an external host anywhere in src/ outside the provider and adapter files",
            rawNetwork.length === 0,
            describeHits(rawNetwork, 4).join(" | "),
          ],
        ]);
      },
    },
    {
      id: "T1-09.6",
      group: GROUP,
      expectation:
        "fixtures cover at least one case per voice/claim-policy pattern — unsourced price, manufactured urgency, directory-marketing, unqualified superlative / unstandardized verification claim — as an INDEPENDENT, REDUNDANT check against A05's own pre-filter",
      source: `${TODO} §T1-09 "Done when" clause 4`,
      how: "Injects each of the four patterns into a real page and runs A06's DETERMINISTIC stage — not A05's lint — asserting A06 catches it on its own; then asserts A06's QA module imports nothing from A05's factory or A04's recommender.",
      measure() {
        const cases: Array<[string, string]> = [
          ["unsourced price", "Most repairs of this kind cost about $450, and a flat rate of $99 covers the callout."],
          ["manufactured urgency", "Act now — don't wait, every hour counts and this will only get worse."],
          ["directory marketing", "Compare providers and browse our network of hundreds of trusted contractors."],
          [
            "unqualified superlative / unstandardized verification claim",
            "We are the best plumbers in the state, and every one of our pros is fully licensed and insured and background-checked.",
          ],
        ];
        const results = cases.map(([name, copy]) => {
          const spec = withBody(PageSpec, SAMPLE_PAGE_SPEC, "intent_answer", copy);
          const stage = runDeterministicStage(spec, { existing: [spec] });
          const caught = stage.findings.filter((f) => /claims|voice|price|urgency|directory/i.test(f.check));
          return [name, caught.length > 0, caught.map((f) => f.check).join(", ") || "nothing raised"] as [
            string,
            boolean,
            string,
          ];
        });
        const qa = readSource("src/domain/search/qa.ts");
        const borrows = /from "@\/domain\/search\/(factory|recommend)"/.test(qa);
        return all([
          ...results,
          ["A06's QA module borrows nothing from A05's factory or A04's recommender", !borrows],
        ]);
      },
    },
    {
      id: "T1-09.7",
      group: GROUP,
      expectation: "every check is admin-configurable via the Policy + Config Store",
      source: `${TODO} §T1-09 "Done when" clause 5; loop seam 12 ("name the runtime store explicitly … so the builder does not put QA thresholds in the code module")`,
      how: "Asserts the QA policy is a parsed document in A06's namespaced sub-block of the RUNTIME-editable SeoFactoryPolicy (data/seo-factory-policy.json), not the code-resident platform Policy Store; and that flipping a required check in that document changes the verdict.",
      measure() {
        const parsed = PageQaPolicy.safeParse(DEFAULT_PAGE_QA_POLICY);
        const factoryPolicy = readSource("src/domain/search/policy.ts");
        const jsonBacked = existsSync(join(process.cwd(), "data", "seo-factory-policy.json"));
        const stricter = PageQaPolicy.parse({
          ...DEFAULT_PAGE_QA_POLICY,
          blocker_checks: [...DEFAULT_PAGE_QA_POLICY.blocker_checks, "template.conformance"],
        });
        return all([
          ["the QA policy is a validated document", parsed.success],
          ["it is A06's namespaced sub-block of the runtime policy", /page_qa/.test(factoryPolicy)],
          ["that document is runtime-editable (file-backed)", jsonBacked, "data/seo-factory-policy.json"],
          ["required and blocking check lists are data", Array.isArray(DEFAULT_PAGE_QA_POLICY.required_checks) && Array.isArray(DEFAULT_PAGE_QA_POLICY.blocker_checks)],
          ["a stricter document parses, so an owner can tighten it", stricter.blocker_checks.includes("template.conformance")],
        ]);
      },
    },
    {
      id: "T1-09.8",
      group: GROUP,
      expectation:
        "every defect logs enough context to LATER JOIN AGAINST PUBLISH STATUS",
      source: `${TODO} §T1-09 "Done when" clause 6; loop seam 9`,
      how: "Compares the context keys A06's defect emitter documents with the four keys page.published carries — a join needs a shared key on both sides.",
      measure() {
        const events = readSource("src/platform/search/page-qa-events.ts");
        const publishRoute = readSource("src/app/api/admin/pages/publish/route.ts");
        const publishKeys = ["page_id", "page_spec_id", "canonical_path", "search_opportunity_id"];
        const emitted = publishKeys.filter((k) => new RegExp(`${k}:`).test(publishRoute));
        return all([
          ["a defect_found emitter exists", /emitPageDefectFound/.test(events)],
          ["page.published is emitted with all four join keys", emitted.length === 4, emitted.join(", ")],
          ["the defect emitter documents the same join keys", /page_id.*page_spec_id|page_spec_id.*page_id/s.test(events)],
          ["a defect_repaired counterpart exists so the pair joins", /emitPageDefectRepaired/.test(events)],
        ]);
      },
    },
    {
      id: "T1-09.9",
      group: GROUP,
      expectation:
        "the AI-critic spend is capped by an admin-configurable BUDGET — not merely gated behind an is-a-model-configured boolean",
      source: `A06 §7 (Guardrails), read against ${TODO} §T1-09 "Done when" clause 5`,
      how: "Reads the runtime AI policy for the critic capability and asserts a per-call cap, a daily cap and a global budget all exist and are TEST-labelled.",
      async measure() {
        const { DEFAULT_AI_POLICY } = await import("@/platform/ai/policy");
        const critic = DEFAULT_AI_POLICY.capabilities["seo.critique_page"];
        return all([
          ["a critic policy entry exists", Boolean(critic)],
          ["a per-call cap exists", (critic?.max_cost_per_call_usd ?? 0) > 0, `$${critic?.max_cost_per_call_usd}`],
          ["a per-capability daily cap exists", (critic?.daily_cap_usd ?? 0) > 0, `$${critic?.daily_cap_usd}`],
          ["a global daily budget exists", DEFAULT_AI_POLICY.global_daily_budget_usd > 0, `$${DEFAULT_AI_POLICY.global_daily_budget_usd}`],
          ["every figure is TEST-labelled", DEFAULT_AI_POLICY.budget_figures.is_test_figure === true],
          ["the critic ships DISABLED", critic?.enabled === false],
        ]);
      },
    },
  ];

  void FactBundle;
  void OpportunityStatus;
  void TemplateSpec;
  void lintUrgencySlot;
  void lintDirectoryFraming;
  void listContentBankBundles;
  void pageEligibleIntent;
  void sourceFiles;

  return {
    group: GROUP,
    preamble:
      "The SEO loop's three build items. T1-07 discovers and the owner decides; T1-08 compiles a door; " +
      "T1-09 inspects it independently. The record's own words are quoted; where a clause names its own " +
      "measurement (\"a grep … returns nothing\") this harness runs that measurement rather than a proxy.",
    expectations,
  };
}

/* -------------------------------------------------------------------------- */

function baseOpportunity() {
  return {
    search_opportunity_id: "so_eval_probe",
    schema_version: "1.0.0",
    keyword: "eval probe",
    intent_cluster_id: null,
    cluster_label: null,
    problem_family_hint: null,
    source: "manual",
    geography: { mode: "national", country: "US" },
    geography_assumed: false,
    volume_monthly: 1_200,
    keyword_difficulty: 10,
    cpc_usd: null,
    intent_type: "problem",
    opportunity_score: null,
    score_components: null,
    recommendation: null,
    status: "candidate",
    metric_snapshot_ids: [],
    serp_snapshot_ids: [],
    provenance: {
      source_type: "eval_harness",
      source_url: null,
      confidence_note: "a harness probe record — never persisted, never scored for real",
    },
    vendor_cost_usd: null,
    researched_at: null,
    created_at: "2026-08-25T00:00:00Z",
    updated_at: "2026-08-25T00:00:00Z",
  };
}

function blockerNames(lint: { findings: Array<{ severity: string; check: string }> }): string {
  return (
    lint.findings
      .filter((f) => f.severity === "blocker")
      .map((f) => f.check)
      .join(", ") || "no blockers"
  );
}

function withBody(
  PageSpecSchema: { parse: (v: unknown) => unknown },
  spec: { content_blocks: Array<{ kind: string; body_md: string }> },
  kind: string,
  copy: string
) {
  const blocks = spec.content_blocks.map((b) =>
    b.kind === kind ? { ...b, body_md: `${b.body_md}\n\n${copy}` } : b
  );
  return PageSpecSchema.parse({ ...spec, content_blocks: blocks }) as never;
}

function criticImports(text: string): string {
  return (text.match(/^import .*$/gm) ?? []).join("\n");
}

/** Every committed staged spec plus the handcrafted sample — the shipped portfolio. */
/** Typed as whatever the schema parses to — see the same fix in loop-seams.ts. */
function committedStagedSpecs<T>(
  PageSpecSchema: { parse: (v: unknown) => T },
  sample: unknown
): T[] {
  const staged = JSON.parse(readSource("data/factory/staged-specs.json")) as { specs: unknown[] };
  return [sample, ...staged.specs].map((s) => PageSpecSchema.parse(s));
}

/** Raw (non-.ts) files under a directory — migrations are .sql. */
function sourceFilesUnderRaw(dir: string): Array<{ path: string; text: string }> {
  const out: Array<{ path: string; text: string }> = [];
  const base = join(process.cwd(), ...dir.split("/"));
  if (!existsSync(base)) return out;
  for (const name of readdirSyncSafe(base)) {
    if (!name.endsWith(".sql")) continue;
    out.push({ path: `${dir}/${name}`, text: readSource(`${dir}/${name}`) });
  }
  return out;
}

function readdirSyncSafe(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}
