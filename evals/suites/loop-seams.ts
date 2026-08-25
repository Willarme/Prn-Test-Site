import { all, blocked, fail, pass, type Suite } from "../types";
import { describeHits, filesUnder, readCode, readSource, scan, stripComments } from "../source";

const AUDIT =
  'vault "Project/03 Build/Agent Architecture Prompts/Loop Spec Audit 2026-08-24.md" — Loop coherence report';
const GROUP = "Loop coherence — the 16 seams (does the loop actually close?)";

/**
 * THE SEAM LIST IS THE DEFINITION OF "THE LOOP CLOSES".
 *
 * The audit's verdict on 2026-08-24 was "No — as written, the loop is open in
 * three places and double-owned in two more." It then enumerated eighteen
 * numbered issues, sixteen of them testable, each with an explicit *Fix:* line.
 * That fix line IS the expectation: it is the record saying, in advance, what
 * "closed" would look like. Each row below quotes its own issue number so a
 * reader can go back to the source paragraph.
 */
export async function seamSuite(): Promise<Suite> {
  const [
    { EVENT_NAMES, LOOP_SEAM_EVENT_NAMES, SLICE_EVENT_NAMES },
    { currentEventDefinition, seedDictionary },
    { ApprovalKind },
    { PAGE_LIFECYCLE_STATUSES, canTransition },
    { LanguageMiningPolicy, MINING_COHORT_FLOOR, DEFAULT_LANGUAGE_MINING_POLICY },
    { SAMPLE_PAGE_SPEC },
    { PageSpec },
    { runDeterministicStage },
    { lintPageBeforeQa },
    { newPageEligibility },
    { SearchOpportunity },
    { flagEnabled, DEFAULT_FLAGS },
  ] = await Promise.all([
    import("@/platform/events/names"),
    import("@/platform/events/dictionary"),
    import("@/platform/approvals/kinds"),
    import("@/domain/search/lifecycle"),
    import("@/domain/search/language-mining"),
    import("@/domain/search/fixtures/sample-page-spec"),
    import("@/domain/search/pages"),
    import("@/domain/search/qa"),
    import("@/domain/search/page-lint"),
    import("@/domain/search/factory"),
    import("@/domain/search/contracts"),
    import("@/platform/flags"),
  ]);
  seedDictionary();

  const names = EVENT_NAMES as readonly string[];

  const expectations: Suite["expectations"] = [
    {
      id: "SEAM-01",
      group: GROUP,
      expectation:
        "ONE event family, not two: `seo.opportunity_accepted` / `_rejected` / `_deferred` are registered, and no `search.*` family exists beside them",
      source: `${AUDIT} issue 1 — "A04→A05 trigger event name does not exist on either side — BLOCKS-BUILD"; Fix: "Do not let a search.* family and a seo.* family both exist."`,
      how: "Reads the shipped dictionary for the three seo.* names, then scans src/ for any emission of a `search.*` name.",
      measure() {
        const wanted = ["seo.opportunity_accepted", "seo.opportunity_rejected", "seo.opportunity_deferred"];
        const missing = wanted.filter((n) => !names.includes(n));
        const searchFamily = names.filter((n) => n.startsWith("search."));
        const emittedSearch = scan(/event_name:\s*"search\./, { include: /^src\//, codeOnly: true });
        return all([
          ["all three acceptance names are registered", missing.length === 0, missing.join(", ")],
          ["each has an approved definition", wanted.every((n) => currentEventDefinition(n)?.status === "approved")],
          ["no search.* family exists in the dictionary", searchFamily.length === 0, searchFamily.join(", ")],
          ["nothing in src/ emits a search.* name", emittedSearch.length === 0, describeHits(emittedSearch, 3).join(" | ")],
        ]);
      },
    },
    {
      id: "SEAM-02",
      group: GROUP,
      expectation:
        "A05's trigger predicate is `status === \"approved\"`, NEVER `recommendation` — and an opportunity with recommendation NEW but status `candidate` produces ZERO PageSpecs",
      source: `${AUDIT} issue 2 — "A05 gates on the recommendation field, not the owner-approval field — BLOCKS-BUILD"; Fix names the exact test: "a recommendation: 'NEW' opportunity with status: 'candidate' produces zero PageSpecs."`,
      how: "Runs the audit's own named test through the real eligibility predicate, and checks the three owner-decision fields exist on the contract.",
      measure() {
        const contract = readSource("src/domain/search/contracts.ts");
        const opportunity = SearchOpportunity.parse({
          ...probeOpportunity(),
          recommendation: "NEW",
          status: "candidate",
        });
        const eligible = newPageEligibility(opportunity, []);
        const approved = SearchOpportunity.parse({
          ...probeOpportunity(),
          recommendation: "REJECT",
          status: "approved",
          approved_at: "2026-08-25T00:00:00Z",
          approved_by: "owner",
        });
        const approvedEligible = newPageEligibility(approved, []);
        return all([
          ["`status` carries the owner's decision", /OpportunityStatus/.test(contract)],
          ["`approved_at` exists", /approved_at/.test(contract)],
          ["`approved_by` exists", /approved_by/.test(contract)],
          [
            "recommendation NEW + status candidate ⇒ NOT eligible",
            eligible.eligible === false,
            eligible.eligible ? "IT WAS ELIGIBLE" : eligible.reason,
          ],
          [
            "the owner's approval is what makes it eligible, even against a REJECT recommendation",
            approvedEligible.eligible === true,
            approvedEligible.eligible ? "eligible on the owner's decision" : approvedEligible.reason,
          ],
        ]);
      },
    },
    {
      id: "SEAM-03",
      group: GROUP,
      expectation:
        "A08's dictionary carries the loop's events — including A06's four, PREFIXED (`page.qa_failed`, `page.qa_passed`, `page.defect_found`, `page.defect_repaired`) so they satisfy the shipped `^[a-z_]+\\.[a-z_]+$` convention — and every agent emits only what `names.ts` carries",
      source: `${AUDIT} issue 3 — "A08's dictionary does not contain the loop's events — BLOCKS-BUILD"`,
      how: "Checks the four names and the eleven slice names are registered, then scans every `event_name:` literal in src/ against the canonical list and against the naming regex.",
      measure() {
        const four = ["page.qa_failed", "page.qa_passed", "page.defect_found", "page.defect_repaired"];
        const missingFour = four.filter((n) => !names.includes(n));
        const missingSlice = (SLICE_EVENT_NAMES as readonly string[]).filter((n) => !names.includes(n));
        const emitted = [
          ...new Set(
            scan(/event_name:\s*"([a-z_]+\.[a-z_]+)"/, { include: /^src\//, codeOnly: true })
              .map((h) => /event_name:\s*"([a-z_.]+)"/.exec(h.text)?.[1])
              .filter((n): n is string => Boolean(n))
          ),
        ];
        const offConvention = names.filter((n) => !/^[a-z_]+\.[a-z_]+$/.test(n));
        const notCanonical = emitted.filter((n) => !names.includes(n));
        return all([
          ["A06's four names are registered, prefixed", missingFour.length === 0, missingFour.join(", ")],
          ["the eleven shipped slice names are registered", missingSlice.length === 0, missingSlice.join(", ")],
          ["every registered name satisfies the domain.action convention", offConvention.length === 0, offConvention.join(", ")],
          [`every name emitted in src/ is canonical (${emitted.length} distinct)`, notCanonical.length === 0, notCanonical.join(", ")],
        ]);
      },
    },
    {
      id: "SEAM-04",
      group: GROUP,
      expectation:
        "`page.material_change` has no producer and is not invented — A06 subscribes to `page.refreshed`, which the dictionary already carries",
      source: `${AUDIT} issue 4 — "page.material_change has no producer — FIX-DURING-BUILD"; Fix: "delete page.material_change from A06 §2/§3 or record it as an alias."`,
      how: "Asserts the phantom name appears nowhere in src/ and that its replacement is registered.",
      measure() {
        const phantom = scan(/material_change/, { include: /^src\//, codeOnly: true });
        return all([
          ["page.material_change is not in the dictionary", !names.includes("page.material_change")],
          ["it is not emitted anywhere in code", phantom.length === 0, describeHits(phantom, 3).join(" | ")],
          ["page.refreshed IS registered as the real trigger", names.includes("page.refreshed")],
          ["…and approved", currentEventDefinition("page.refreshed")?.status === "approved"],
        ]);
      },
    },
    {
      id: "SEAM-05",
      group: GROUP,
      expectation:
        "A06 is the SOLE writer of `PageSpec.qa.state` — NO MODULE OUTSIDE A06 WRITES `qa.state` TO `PASS`; A05 sets PENDING at creation and never writes it again",
      source: `${AUDIT} issue 5 — "Nobody owns the write to spec.qa.state — BLOCKS-BUILD"; Fix names the exact test: "add a test asserting no module outside A06 writes qa.state to PASS."`,
      how: "Runs the audit's own named test as a source scan: every assignment of a PASS verdict into a spec's qa field, anywhere in src/, must live in A06's modules.",
      measure() {
        // An ASSIGNMENT, never a comparison. `s.qa.state === "PASS"` in an admin
        // list is a READ — the pill an owner looks at — and counting it as a
        // write would make the check unable to tell a reader from a writer.
        const writers = scan(/state:\s*"PASS"|qa\.state\s*=[^=]|applyQaVerdict\(/, {
          include: /^src\//,
          codeOnly: true,
        });
        const a06Owned = /domain\/search\/qa(-|\.)|platform\/search\/page-qa/;
        const outsiders = writers.filter((h) => !a06Owned.test(h.path));
        const factory = readSource("src/domain/search/factory.ts");
        const pendingAtCreation = /state:\s*"PENDING"/.test(factory);
        return all([
          [
            "no module outside A06 writes a PASS verdict",
            outsiders.length === 0,
            describeHits(outsiders, 4).join(" | "),
          ],
          ["A05's factory sets PENDING at creation", pendingAtCreation],
          ["A05's factory never writes PASS", !/state:\s*"PASS"/.test(factory)],
        ]);
      },
    },
    {
      id: "SEAM-06",
      group: GROUP,
      expectation:
        "ONE server-side release condition. `qa.state === \"PASS\"` is DERIVED FROM `release_eligible`, not checked beside it — the weaker gate must not survive next to the new one",
      source: `${AUDIT} issue 6 — "Two publish gates and a third claimed one — BLOCKS-BUILD"; Fix: "the publish route must be rewired in the same commit … Never leave the weaker gate alive next to the new one."`,
      how: "Reads the publish route: it must test exactly one boolean and must not mention qa.state at all; then confirms the three conjuncts live inside `evaluateReleaseForPublish`, and that the Approval Center is a record rather than a second actuator.",
      measure() {
        const route = readCode("src/app/api/admin/pages/publish/route.ts");
        const qa = readSource("src/domain/search/qa.ts");
        const gate = readSource("src/platform/search/page-qa-gate.ts");
        const conditionCount = (route.match(/release_eligible/g) ?? []).length;
        return all([
          ["the route reads release_eligible", /decision\.release_eligible/.test(route)],
          ["the route never mentions qa.state", !/qa\.state/.test(route)],
          [
            "the recorded verdict is a CONJUNCT inside the evaluator",
            /spec\.qa\.state === "PASS"/.test(qa),
          ],
          ["the live re-verification is a conjunct too", /runPageQaSync\(spec, context\)/.test(qa)],
          ["the human gate is a conjunct too", /humanGateIntact\(/.test(qa)],
          [
            // The CALL SITE, not the import at the top of the file: the question
            // is whether the Approval Center is consulted before the gate, and an
            // import line is not a consultation.
            "the Approval Center is closed AFTER the release check, never consulted before it",
            route.lastIndexOf("resolvePagePublishApproval(") >
              route.indexOf("decision.release_eligible"),
            `check at ${route.indexOf("decision.release_eligible")}, approval closed at ${route.lastIndexOf("resolvePagePublishApproval(")}`,
          ],
          ["only one release condition appears in the route", conditionCount <= 2, `${conditionCount} mentions`],
          ["the gate module exists as the single answer", /export async function publishGate/.test(gate)],
        ]);
      },
    },
    {
      id: "SEAM-07",
      group: GROUP,
      expectation:
        "`provenance.present` is a REAL, PASSING check with a real source — the content bank is registered as a provenance source and every block cites a FactBundle, instead of the check blocking 100% of pages",
      source: `${AUDIT} issue 7 — "provenance.present blocks every page A05 can currently build — BLOCKS-BUILD"; Safe stub: "mint a FactBundle-shaped record per content-bank entry … and have factory.ts cite it."`,
      how: "Runs A06's deterministic stage over the entire committed portfolio and asserts no page raises a provenance blocker, and that the bundles cited are real content-bank bundles.",
      measure() {
        const specs = portfolio(PageSpec, SAMPLE_PAGE_SPEC);
        const provenanceFailures = specs.filter((spec) => {
          const stage = runDeterministicStage(spec, { existing: specs });
          return stage.findings.some((f) => f.check.startsWith("provenance.") && f.severity === "blocker");
        });
        const uncited = specs.filter((s) =>
          s.content_blocks.some((b) => b.source_fact_bundle_ids.length === 0)
        );
        return all([
          [
            "no committed page fails provenance.present",
            provenanceFailures.length === 0,
            provenanceFailures.map((s) => s.canonical_path).join(", "),
          ],
          ["every block on every page cites at least one bundle", uncited.length === 0, uncited.map((s) => s.canonical_path).join(", ")],
          [
            "the bundle ids are content-bank or handcrafted-door bundles, not placeholders",
            specs.every((s) =>
              s.content_blocks.every((b) =>
                b.source_fact_bundle_ids.every((id) => /^fb_(content_bank|handcrafted)/.test(id))
              )
            ),
            [...new Set(specs.flatMap((s) => s.content_blocks.flatMap((b) => b.source_fact_bundle_ids)))]
              .slice(0, 3)
              .join(", "),
          ],
        ]);
      },
    },
    {
      id: "SEAM-08",
      group: GROUP,
      expectation:
        "the urgency lint is written against the SHIPPED block shape — `kind === \"when_urgency_changes\"` requires non-empty `source_fact_bundle_ids` — with NO parallel `slot`/`source_id` pair forking the schema A06 reads",
      source: `${AUDIT} issue 8 — "The mandatory urgency source_id targets a field that does not exist — FIX-DURING-BUILD"`,
      how: "Strips the bundle citation off the urgency block of a real page and asserts the lint blocks it; then scans the block schema for a parallel slot/source_id pair.",
      measure() {
        const stripped = PageSpec.parse({
          ...SAMPLE_PAGE_SPEC,
          content_blocks: SAMPLE_PAGE_SPEC.content_blocks.map((b) =>
            b.kind === "when_urgency_changes" ? { ...b, source_fact_bundle_ids: [] } : b
          ),
        });
        const lint = lintPageBeforeQa(stripped);
        const pagesSchema = readSource("src/domain/search/pages.ts");
        const parallelPair = /\bslot:\s*z\./.test(pagesSchema) && /\bsource_id:\s*z\./.test(pagesSchema);
        return all([
          [
            "an urgency block with no cited bundle is BLOCKED",
            lint.passed === false,
            lint.findings.filter((f) => f.severity === "blocker").map((f) => f.check).join(", ") || "nothing blocked",
          ],
          ["the finding names the urgency check", lint.findings.some((f) => /urgency/i.test(f.check))],
          ["no parallel slot/source_id pair was introduced", !parallelPair],
          ["the shipped kind is the one the lint reads", /when_urgency_changes/.test(readSource("src/domain/search/page-lint.ts"))],
        ]);
      },
    },
    {
      id: "SEAM-09",
      group: GROUP,
      expectation:
        "`page.published` IS emitted — from the publish route, carrying `page_id`, `page_spec_id`, `canonical_path` and `search_opportunity_id` in context. Without it, defect-escape rate, time-to-publish and every A07 SEO gauge are uncomputable",
      source: `${AUDIT} issue 9 — "page.published is emitted by nothing — the join key for the entire return leg"`,
      how: "Reads the publish route for the emission and its four named context keys, and confirms the name is registered and approved.",
      measure() {
        const route = readSource("src/app/api/admin/pages/publish/route.ts");
        const keys = ["page_id", "page_spec_id", "canonical_path", "search_opportunity_id"];
        const present = keys.filter((k) => new RegExp(`\\b${k}:`).test(route));
        return all([
          ["the route emits page.published", /emitPagePublished\(/.test(route)],
          ["all four join keys travel with it", present.length === 4, present.join(", ")],
          ["the name is registered", names.includes("page.published")],
          ["…and approved", currentEventDefinition("page.published")?.status === "approved"],
          ["emission is fail-soft — a lost envelope never costs a publish", /fail-soft|Fail-soft/i.test(route)],
        ]);
      },
    },
    {
      id: "SEAM-10",
      group: GROUP,
      expectation:
        "A08 registers ONE metric-bearing return-leg event now, `seo.page_performance_recorded` (page_id, search_opportunity_id, window, impressions, clicks, avg_position, source), even with NO producer — and A04 states plainly that the KPI-decline trigger is NOT IMPLEMENTED",
      source: `${AUDIT} issue 10 — "The results→A04 return leg has no defined carrier at all — FIX-DURING-BUILD"`,
      how: "Reads the event definition's required context keys against the audit's own list, and checks whether anything actually produces it.",
      measure() {
        const def = currentEventDefinition("seo.page_performance_recorded");
        const required = def?.required_envelope_fields ?? [];
        const wanted = [
          "context.page_id",
          "context.search_opportunity_id",
          "context.window",
          "context.impressions",
          "context.clicks",
          "context.avg_position",
          "context.source",
        ];
        const missing = wanted.filter((w) => !required.includes(w));
        const producers = scan(/event_name:\s*"seo\.page_performance_recorded"/, {
          include: /^src\//,
          codeOnly: true,
        });
        const lineage = /search_opportunity_id/.test(readSource("src/domain/search/factory.ts"));
        const contractOk = missing.length === 0 && def?.status === "approved";
        if (!contractOk) {
          return fail(
            `the return-leg contract is incomplete: ${missing.join(", ") || `status ${def?.status ?? "unregistered"}`}`
          );
        }
        /**
         * The adapter's reach, measured rather than asserted. The prerequisite
         * used to say it "is imported by nothing", which was one word off — its
         * fixture is imported by tests/adapters.fixtures.test.ts. Under src/,
         * where a producer would have to live, the count really is zero, and
         * counting it here means this line cannot go stale the way the
         * migration blockers did.
         */
        const adapterUsers = scan(/from "@\/platform\/adapters\/search-console"/, {
          include: /^src\//,
          codeOnly: true,
        });
        return blocked(
          `the contract EXISTS and is approved with all seven context keys, and PageSpec.search_opportunity_id is populated so the lineage already works — but nothing produces the event (${producers.length} producers), so the return leg carries no data`,
          `Search Console ingestion wired to a real property — GSC OAuth credentials exist in .env.local, but src/platform/adapters/search-console.ts has ${adapterUsers.length} importer(s) under src/ (only its fixture is used, and only by a test), so no performance data reaches an opportunity`,
          [
            `lineage field present in the factory: ${lineage}`,
            "This is exactly the state the audit prescribed: register the carrier now so the loop closes later with no schema change.",
          ]
        );
      },
    },
    {
      id: "SEAM-11",
      group: GROUP,
      expectation:
        "internal-language mining ships OFF behind a policy flag defaulting false; mining may emit only patterns observed in ≥ N distinct ProblemRecords (owner-set, FLOOR 5); and NO customer-derived string may ever be written into `SearchOpportunity.keyword`",
      source: `${AUDIT} issue 11 — "A01→A04 customer-language edge is asserted on one side only"; Safe stub, verbatim: "Ship the internal-language mining path OFF, behind a policy flag defaulting false."`,
      how: "Parses the shipped policy, tries to parse a policy that violates the floor, and tries to parse one that relaxes the keyword rule.",
      measure() {
        const belowFloor = LanguageMiningPolicy.safeParse({
          enabled: false,
          min_distinct_problem_records: MINING_COHORT_FLOOR - 1,
          never_write_customer_text_to_keyword: true,
        });
        const relaxed = LanguageMiningPolicy.safeParse({
          enabled: true,
          min_distinct_problem_records: 10,
          never_write_customer_text_to_keyword: false,
        });
        // An IMPORT of the customer contract, not a mention of its name: the
        // policy file NAMES ProblemRecord in its own rule text, which is the
        // rule, not a miner.
        const miner = scan(/from "@\/domain\/problem\//, {
          include: /^src\/domain\/search\//,
          codeOnly: true,
        });
        return all([
          ["the shipped policy is OFF", DEFAULT_LANGUAGE_MINING_POLICY.enabled === false],
          ["the floor is 5", MINING_COHORT_FLOOR === 5, String(MINING_COHORT_FLOOR)],
          ["a policy below the floor does not parse", !belowFloor.success],
          [
            "a policy that relaxes the keyword rule does not parse — the guarantee is not a knob",
            !relaxed.success,
          ],
          [
            "no mining code exists: nothing in domain/search imports the customer problem contract",
            miner.length === 0,
            describeHits(miner, 3).join(" | "),
          ],
        ]);
      },
    },
    {
      id: "SEAM-12",
      group: GROUP,
      expectation:
        "A04 owns the `SeoFactoryPolicy` OBJECT; A05 and A06 own namespaced sub-blocks (`page_factory.*`, `page_qa.*`) they alone write; and A06's thresholds live in the RUNTIME-editable store, so changing QA behaviour needs no code deploy",
      source: `${AUDIT} issue 12 — "SeoFactoryPolicy is owned by A04 but governs A05 and A06 — FIX-DURING-BUILD"`,
      how: "Reads the policy schema for both namespaces, confirms the document is the file-backed runtime store rather than the code-resident platform Policy Store, and checks the platform store still refuses non-scalar values.",
      measure() {
        const policy = readSource("src/domain/search/policy.ts");
        const platformStore = readSource("src/platform/policy/store.ts");
        const adminData = readSource("src/platform/admin/data.ts");
        return all([
          ["page_factory.* exists as A05's sub-block", /page_factory/.test(policy)],
          ["page_qa.* exists as A06's sub-block", /page_qa/.test(policy)],
          [
            "the document is the runtime, file-backed store",
            /FilePolicyStore/.test(adminData) && /seo-factory-policy\.json/.test(adminData),
          ],
          [
            "the code-resident platform store is a different document, not this one",
            !/page_qa|page_factory/.test(platformStore),
          ],
        ]);
      },
    },
    {
      id: "SEAM-13",
      group: GROUP,
      expectation:
        "`lifecycle.ts` is the SINGLE state machine: A05 owns APPROVED→STAGED and REFRESH→STAGED, A06 owns STAGED→QA_PASS and STAGED→APPROVED, and the OWNER ALONE owns QA_PASS→PUBLISHED — `qa.state` and `release_eligible` are facts ABOUT a staged page, never a parallel lifecycle",
      source: `${AUDIT} issue 13 — "Three parallel page-state vocabularies, and the shipped one is named by no spec"`,
      how: "Exercises the shipped transition guard on each ownership edge and on the two illegal shortcuts that would let an agent publish.",
      measure() {
        return all([
          ["the seven-state machine is the one shipping", PAGE_LIFECYCLE_STATUSES.length === 7, PAGE_LIFECYCLE_STATUSES.join("→")],
          ["A05: APPROVED→STAGED is legal", canTransition("APPROVED", "STAGED")],
          ["A05: REFRESH→STAGED is legal", canTransition("REFRESH", "STAGED")],
          ["A06: STAGED→QA_PASS is legal", canTransition("STAGED", "QA_PASS")],
          ["A06: STAGED→APPROVED (rebuild) is legal", canTransition("STAGED", "APPROVED")],
          ["owner: QA_PASS→PUBLISHED is legal", canTransition("QA_PASS", "PUBLISHED")],
          ["STAGED→PUBLISHED is ILLEGAL — no page skips QA", !canTransition("STAGED", "PUBLISHED")],
          ["APPROVED→PUBLISHED is ILLEGAL — no page skips staging and QA", !canTransition("APPROVED", "PUBLISHED")],
          ["IDEA→PUBLISHED is ILLEGAL", !canTransition("IDEA", "PUBLISHED")],
          ["RETIRED is terminal", !canTransition("RETIRED", "STAGED")],
        ]);
      },
    },
    {
      id: "SEAM-14",
      group: GROUP,
      expectation:
        "an `approval_kind` enum is registered BEFORE the first producer ships (`seo.opportunity_decision`, `seo.page_publish`, `data.repair`, `data.identity_merge`), and each producer names its kind",
      source: `${AUDIT} issue 14 — "Four producers into one Approval Center with no item taxonomy"`,
      how: "Reads the enum for the audit's four named kinds, then scans every queueApproval call site in src/ for an approval_kind.",
      measure() {
        const kinds = ApprovalKind.options as readonly string[];
        const wanted = ["seo.opportunity_decision", "seo.page_publish", "data.repair", "data.identity_merge"];
        const missing = wanted.filter((k) => !kinds.includes(k));
        const callSites = scan(/queueApproval\(/, { include: /^src\//, codeOnly: true });
        const untyped = callSites.filter((h) => {
          const text = readSource(h.path);
          const idx = text.indexOf("queueApproval(", 0);
          void idx;
          return !/approval_kind:/.test(text);
        });
        return all([
          ["all four audit-named kinds are registered", missing.length === 0, missing.join(", ")],
          [`the enum is the taxonomy (${kinds.length} kinds)`, kinds.length >= 4, kinds.join(", ")],
          ["every producer file names a kind", untyped.length === 0, [...new Set(untyped.map((h) => h.path))].join(", ")],
        ]);
      },
    },
    {
      id: "SEAM-15",
      group: GROUP,
      expectation:
        "A04 and A05 MAY share `sameIntentFamily`; A06 MUST reimplement it independently — a test must assert A06's QA module imports nothing from `domain/search/factory` or `recommend`",
      source: `${AUDIT} issue 15 — "Cannibalization: three gates specified, one implementation shipped"; Master Todo T1-09: "an inspector that shares its subject's logic is not an inspector."`,
      how: "Runs the audit's own named test: reads A06's QA modules' import lines. Then confirms A06 uses its own threshold rather than the shared matcher's.",
      measure() {
        const qaModules = filesUnder("src/domain/search").filter((f) => /\/qa(-[a-z]+)?\.ts$/.test(f.path));
        const platformQa = filesUnder("src/platform/search").filter((f) => /page-qa/.test(f.path));
        const borrowed = [...qaModules, ...platformQa].filter((f) =>
          /from "@\/domain\/search\/(factory|recommend|intent-family)"/.test(f.text)
        );
        const policy = readSource("src/domain/search/qa-policy.ts");
        const ownThreshold = /intent_overlap_threshold/.test(policy);
        const sharedThreshold = readSource("src/domain/search/intent-family.ts");
        return all([
          [
            "no A06 QA module imports A05's factory, A04's recommender or the shared matcher",
            borrowed.length === 0,
            borrowed.map((f) => f.path).join(", "),
          ],
          [`${qaModules.length + platformQa.length} A06 modules were checked`, qaModules.length + platformQa.length >= 4],
          ["A06 carries its own overlap threshold", ownThreshold],
          [
            "…and it is deliberately not the shared matcher's number",
            !new RegExp(`intent_overlap_threshold.*${/0\.7\b/.source}`).test(policy),
            `shared matcher file present: ${sharedThreshold.length > 0}`,
          ],
        ]);
      },
    },
    {
      id: "SEAM-16",
      group: GROUP,
      expectation:
        "staged pages are NOT publicly reachable and NOT listed on the public homepage; and A06 renders no `reasons`, findings or evidence onto any unauthenticated route",
      source: `${AUDIT} issue 16 — "Staged pages are publicly reachable and listed on the public homepage"; Fix: "move the staged listing behind isAdminUnlocked(), or gate /staged/[slug] itself."`,
      how: "Reads the public homepage and the /staged/[slug] route for an admin gate, and separately asserts no QA detail reaches either.",
      measure() {
        // Read both surfaces as CODE. The homepage's own comment enumerates the
        // things that must never render there; that comment is the rule, not the
        // violation.
        const home = readCode("src/app/page.tsx");
        const stagedRoute = filesUnder("src/app/staged")
          .map((f) => stripComments(f.text))
          .join("\n");
        const listingGated = /isAdminUnlocked\(/.test(home);
        const routeGated = /isAdminUnlocked\(/.test(stagedRoute);
        const flagOn = flagEnabled("staged_listing_public");
        const detailLeak = /qa\.reasons|findings|repair_instructions|heuristic_score/.test(home + stagedRoute);
        const noindex = /index: false/.test(stagedRoute);
        if (detailLeak) {
          return fail(
            "QA detail (reasons / findings / scores) is rendered on an unauthenticated route — the half of the fix that was NOT optional"
          );
        }
        if (listingGated || routeGated || !flagOn) {
          return pass("staged pages are behind an admin gate, and no QA detail reaches a public route");
        }
        return blocked(
          `HALF MET. No QA detail leaks — no reasons, findings, scores or provenance render publicly (noindex present: ${noindex}) — but the staged listing IS still on the public, unauthenticated homepage with its QA-state pill, and /staged/[slug] has no admin gate. The build shipped the decision as a flag (staged_listing_public, default true) instead of taking it`,
          "an owner ruling on flag `staged_listing_public` (src/platform/flags.ts records it as TODO-ASK-OWNER, Joshua + Melissa: should the public homepage keep listing staged pages and their QA state?). Flipping it to false needs no code change",
          [
            "The audit's own words: A05 §7's promise that it 'must never make a page publicly reachable' is untrue as written.",
            "Indexing is separately blocked three ways (site-wide robots disallow, per-route noindex, seo_doors_enabled off), so this is a reachability gap, not an SEO leak.",
          ]
        );
      },
    },
    {
      id: "SEAM-18b",
      group: GROUP,
      expectation:
        "the pure-heuristic `fixtureCritic` no longer returns PASS with `critic_ran: true` — until it is reclassified as SKIPPED_NO_MODEL, the AI-critic half of the release gate is decorative",
      source: `${AUDIT} issue 18(b) — Residual`,
      how: "Scans for the old fixture critic and asserts the shipped no-model path reports SKIPPED_NO_MODEL rather than a pass.",
      measure() {
        const qa = readSource("src/domain/search/qa.ts");
        const critic = readSource("src/domain/search/qa-critic.ts");
        const fixtureCritic = scan(/fixtureCritic|critic_ran/, { include: /^src\//, codeOnly: true });
        return all([
          ["no fixtureCritic / critic_ran survives in code", fixtureCritic.length === 0, describeHits(fixtureCritic, 3).join(" | ")],
          ["the no-model critic is the default", /NO_MODEL_CRITIC/.test(qa)],
          ["it reports SKIPPED_NO_MODEL", /SKIPPED_NO_MODEL/.test(critic)],
          ["and says in words that this is not a pass", /NOT a pass/i.test(critic)],
        ]);
      },
    },
  ];

  void LOOP_SEAM_EVENT_NAMES;
  void DEFAULT_FLAGS;

  return {
    group: GROUP,
    preamble:
      "The audit's verdict on 2026-08-24 was that the loop does NOT close: open in three places, double-owned " +
      "in two more. Each numbered issue carried an explicit Fix line, and that fix line is the expectation here — " +
      "the record saying in advance what 'closed' would look like. Issue 17 (wave ordering) and 18(a)/(c) are " +
      "NOTEs about sequencing rather than testable states and are not rows; 18(b) is testable and is.",
    expectations,
  };
}

function probeOpportunity() {
  return {
    search_opportunity_id: "so_seam_probe",
    schema_version: "1.0.0",
    keyword: "sump pump running constantly",
    intent_cluster_id: null,
    cluster_label: null,
    problem_family_hint: "plumbing",
    source: "manual",
    geography: { mode: "national", country: "US" },
    geography_assumed: false,
    volume_monthly: 2_400,
    keyword_difficulty: 12,
    cpc_usd: null,
    intent_type: "problem",
    opportunity_score: 82,
    score_components: null,
    recommendation: null,
    status: "candidate",
    metric_snapshot_ids: [],
    serp_snapshot_ids: [],
    provenance: {
      source_type: "eval_harness",
      source_url: null,
      confidence_note: "harness probe",
    },
    vendor_cost_usd: null,
    researched_at: null,
    created_at: "2026-08-25T00:00:00Z",
    updated_at: "2026-08-25T00:00:00Z",
  };
}

/**
 * The committed portfolio, typed as whatever the schema parses to. It used to
 * declare a hand-written shape and then `as never` its way past the mismatch,
 * which meant every downstream call took a page the compiler could not check.
 */
function portfolio<T>(PageSpecSchema: { parse: (v: unknown) => T }, sample: unknown): T[] {
  const staged = JSON.parse(readSource("data/factory/staged-specs.json")) as { specs: unknown[] };
  return [sample, ...staged.specs].map((s) => PageSpecSchema.parse(s));
}
