# A04 Search Opportunity — Step 0 audit

**Date:** 2026-08-24 · **Branch:** `a04-search-opportunity` (from `a09-data-quality`, HEAD `cdbdc39`)
**Baseline gauntlet at branch point:** `npm run check` green — 46 test files, **586/586 tests**.

A04 is the one agent in the kit whose code is **already real and already spends vendor money**.
This build formalizes and extends what exists behind the platform contracts. It does not build a
parallel pipeline. Everything below was read, not assumed; every claim carries a path.

---

## 1. What already exists (the live pipeline)

### The domain pipeline — `src/domain/search/`

| File | What it really does |
|---|---|
| `importer.ts` | `importSeedRows()` — the seed research workbook → `SearchOpportunity[]`. Rules in `docs/canon/seed-import-map.md`. Handles the literal `Trial - Calculators` sheet. |
| `discovery.ts` | `runDiscovery()` — **the paid path**. Idempotency key `a04:<policy>:v<n>:<period>`, budget brake, `discoverIdeas` → `getKeywordMetrics` → `getSearchIntent`, merge-before-score, score, recommend, upsert, `AgentRun` bookkeeping, `UsageCostEvent` per paid call. 352 lines. |
| `scoring.ts` | `scoreOpportunity()` — deterministic v1. `SCORING_VERSION = "1.0.0"`. Four **hardcoded** weights at line 21: `{demand .3, winnability .3, intent_fit .25, seed_prior .15}`. `qualifiesForNewPage()` carries the literal `"general_home_problem"` catch-all (line 105). |
| `recommend.ts` | `sameIntentFamily()` (line 38) — the ONE cannibalization implementation in the repo, token-set Jaccard ≥ 0.7 / containment ≥ 0.99. `isMergeTarget()`, `recommend()` → NEW/EXPAND/MERGE/WATCH/REJECT. |
| `portfolio.ts` | `evaluatePortfolio()` — score+recommend a whole portfolio with **no vendor calls**. Used by the factory runner and the admin read model. |
| `intent-classifier.ts` | `classifyIntentPrnSide()` + `inferProblemFamily()`. **PRN-coupled**: `PROBLEM_SIGNALS` (28 English phrases), `TOOL_HINTS` (7), six hardcoded US home-trade regexes. |
| `policy.ts` | `SeoFactoryPolicy` zod object + `superRefine` invariants + `TRIAL_DEFAULT_SEO_FACTORY_POLICY`. The `superRefine` is what makes A06's publish gate fail closed at the schema level (LOW_RISK_AUTO / `human_approval_required:false` rejected below T2). |
| `contracts.ts` | `SearchOpportunity`, `OpportunityStatus` (line 22 — **the owner's decision**), `OpportunitySource` (line 13, includes the `"dataforseo"` provenance value), `IntentCluster`, `SeoMetricSnapshot`, `SerpSnapshot`, `SeoDataProvider`, `FactBundle`. |
| `lifecycle.ts` | `OpportunityRecommendation` (line ~45 — **the agent's opinion**) + the frozen 7-state page lifecycle. |
| `geography-plan.ts` | `expandGeographyPlan()` — non-national targets counted and **deferred** (OD-9). |
| `factory.ts` | **A05's**, not A04's. `buildCandidatePages()` filters `recommendation === "NEW"` (line 176). |
| `qa.ts` | **A06's**. Imports `sameIntentFamily` from `recommend.ts` today. |

### The vendor-neutral adapter — this exists and the A04 spec never mentions it

`src/platform/adapters/seo-data.ts` **is** the vendor-neutral interface (pre-answer 3):
`SeoDataAdapter` with `readonly vendor: string`, plus `FixtureSeoDataAdapter` for the
vendor-unavailable path. `src/platform/adapters/dataforseo.ts` implements it and is the ONLY
file that knows vendor endpoints/field names. **No refactor is needed and none is done here.**
The shipped signatures are load-bearing and differ from the spec's §4 sketch —
`discoverIdeas` returns `DiscoverIdeasResult {ideas, vendor_cost_usd}`, `getKeywordMetrics`
returns `SeoMetricSnapshot[]`, `getSearchIntent` returns one `SearchIntentResult`. The
`vendor_cost_usd` fields are what the budget brake reads; adopting §4's sketch would regress
cost accounting.

### Budget + idempotency runtime

- Budget brake: `discovery.ts:162-171` — `costs.monthlySpend(vendor, month)` vs
  `policy.max_external_seo_spend_usd_month`, checked **before** any spend.
- Cost recording: `recordCost()` at `discovery.ts:173-186` writes a `UsageCostEvent`
  (`src/platform/economics/contracts.ts:27`) and decrements `remainingBudget`.
- Idempotency: `periodFor(cadence)` + `runs.findByIdempotencyKey`. Budget-stopped runs save
  status `skipped` so they never consume the slot.
- Rate registry: `VendorCostRate` exists (`economics/contracts.ts:9`) but **nothing populates
  it** — `rate_version` is `null` everywhere in the DataForSEO adapter.

### Policy CLI + policy stores

`tools/policy.ts` (`npm run policy -- set <field> <json>`): re-validates the whole policy,
bumps `version`, stamps `effective_from`, refuses invariant violations. Backed by
`FilePolicyStore` (`data/seo-factory-policy.json`) or `SupabasePolicyStore`, selected in
`src/platform/admin/data.ts:policyStore()`.

### Artifact pipeline + admin surface

`tools/run-factory.ts` (`npm run factory`) runs import → `evaluatePortfolio` → **a
comment-level tool filter** (`o.intent_type === "problem"`, lines 33-40) → `buildCandidatePages`
→ `qaCandidatePages`, writing `data/factory/{opportunities,staged-specs,qa-results}.json` in one
pass. **96 committed opportunity records** (NEW 11 / WATCH 78 / MERGE 4 / REJECT 3; by intent:
problem 20 / tool 59 / unknown 17). `src/app/admin/opportunities/page.tsx` is a **server
component behind `adminGate()`** rendering a read-only table from `loadOpportunities()`.

### Persistence reality (C14)

The only `OpportunityStore` implementation is `InMemoryOpportunityStore`
(`src/platform/stores/memory.ts:17`). `stores/interfaces.ts:12` says the Supabase
implementation "lands when the owner selects the project and migrations are applied". The
durable artifact is the committed JSON. `search_opportunity` **does** exist as DDL
(`supabase/migrations/00001_door_slice.sql:17`) and nothing writes to it.

---

## 2. What already satisfies the spec

| Spec/condition | Already satisfied by |
|---|---|
| Vendor neutrality (C2, pre-answer 3) | `platform/adapters/seo-data.ts` + `tests/client-boundary.test.ts` ("only the DataForSEO adapter file knows DataForSEO endpoints"). |
| A06 publish gate never collapses into A04's (pre-answer 6) | `policy.ts` `superRefine` — fails closed at the schema level. |
| Review screen server-side (C10) | `admin/opportunities/page.tsx` is already a server component behind `adminGate`. |
| Table names (pre-answer 1) | `supabase/migrations/00001_door_slice.sql`. Do NOT create a table. |
| Scheduler (pre-answer 2) | CLI-only. No `vercel.json`, no cron route. **Do not add one.** |
| Event names (C1, seam 1) | **A08 already registered them**: `seo.opportunity_accepted/_rejected/_deferred` in `LOOP_SEAM_EVENT_NAMES` (`platform/events/names.ts:147`), with `EventDefinition` rows owned by `"A04"` (`platform/events/dictionary.ts:271-283`). No new names needed or permitted. |
| Approval taxonomy (seam 14) | `ApprovalKind` enum already carries `"seo.opportunity_decision"` (`platform/approvals/kinds.ts`). |
| Resolve control | Built by A09: `src/app/api/admin/approvals/resolve/route.ts` + `components/admin/ApprovalDecision`. |
| Ledger / kill switch / RLS seam | `platform/runs/ledger.ts`, `platform/killswitch/index.ts` (`agent:A04`), `platform/db/client.ts` `PlatformClientProvider`. |
| Quota honesty, merge-before-score, doorway rule | Already implemented and tested (`tests/discovery.test.ts`, `tests/scoring.recommend.test.ts`). |

---

## 3. What is MISSING (this build's scope)

1. **The owner-decision path does not exist** (seams 1+2). `OpportunityStatus` is read in
   exactly one place — `recommend.ts:69` (`isMergeTarget`). There is no accept/reject/defer
   control, no `approved_at`/`approved_by`, no write path, no event emitted, no ledger row.
   **A04 emits zero events today.**
2. **Scoring weights are hardcoded** (`scoring.ts:21`) — not policy-driven, not versioned
   against a `score_version` that can coexist with v1.
3. **Market vocabulary is code-resident** — `PROBLEM_SIGNALS`, `TOOL_HINTS`, the six trade
   regexes, `allowed_categories`'s catch-all key. A client in another vertical forks source.
4. **No hard-exclusion mechanism** — nothing can be declared always-REJECT with a reasons trail.
5. **`sameIntentFamily` is not extracted** — it lives inside `recommend.ts` and A06's `qa.ts`
   imports it (seam 15 requires A06 to reimplement independently; not this build's job).
   No duplicate-intent pre-gate runs before recommendation.
6. **The budget brake has a single-call overshoot** (C8). `getKeywordMetrics(keywords, scope)`
   is unbounded in keyword count; cost is recorded only after it returns. One call can blow the
   cap while the run still reports `budget_limited` cleanly. **No kill-switch check anywhere in
   `runDiscovery`.**
7. **`tenant_id` is on no A04 record** (C4) while every A00 record carries it.
8. **The dollar figures in `data/seo-factory-policy.json` are unlabeled** — bare
   `max_external_seo_spend_usd_month: 1`, `max_page_ai_spend_usd_month: 25`.
9. **The vendor-neutrality and separability greps are vacuous** (C2, C3) — the spec's
   §11 item 14 checks identifiers that exist nowhere.
10. **Progressive enrichment does not exist** (C17) — see §5.
11. **Internal-language mining has no mechanism** (C11) — the rule exists only as prose.

---

## 4. Separability position (hard canon rule 6, condition 3)

The white-label direction (`Auto SEO Page Engine Package 2026-08-24`, Master Todo T7-10) makes
A04's pipeline the generic layer of a sellable product. Stated position on every PRN coupling
found inside that generic layer:

**Generic — belongs in `auto-seo-core` unchanged:**
`discovery.ts` orchestration (idempotency, budget brake, merge-before-score, cost recording),
`scoring.ts` math (`demandScore`, `winnabilityScore`, the weighted sum), `recommend.ts`
(`sameIntentFamily`, `isMergeTarget`, the doorway rule), `geography-plan.ts`, `policy.ts`
structure, `platform/adapters/seo-data.ts`, the store interfaces.

**PRN-coupled — must become policy data or a client-supplied module before extraction:**

| Coupling | File | Position taken in this build |
|---|---|---|
| `PROBLEM_SIGNALS`, `TOOL_HINTS` | `intent-classifier.ts:8,40` | **Moved to policy vocabulary** (step 3). Code keeps them only as the v1 default. |
| Six US home-trade regexes (`inferProblemFamily`) | `intent-classifier.ts:57-64` | **Moved to policy `family_patterns`** (step 3), source-of-record becomes data. |
| `"general_home_problem"` catch-all literal | `scoring.ts:105` | **Moved to policy `catch_all_category`** (step 3). |
| Trade list in `allowed_categories` | `policy.ts:107` | Already policy data — no change needed, it is the client's list. |
| `intentFitScore` PRN thesis (problem 100 / tool 70) | `scoring.ts:34` | **Left in code, flagged.** The intent→fit mapping is the thesis itself; parameterizing it is a larger call than this build should make. Recorded as a TBD. |
| `classifyIntentPrnSide` / `inferProblemFamily` imported directly into `discovery.ts` | `discovery.ts:7` | **Left as a direct import.** Making the classifier injectable is the right extraction seam but changes `DiscoveryDeps` — an A04 follow-up, not a Wave-2 change. Recorded as a TBD. |

The real enforcement replaces the vacuous grep: a standing test asserts that no NEW
DataForSEO-specific identifier appears outside the adapter, while explicitly allowing the
`"dataforseo"` provenance enum value, the `vendorToSource` map, registry/UI copy and doc
comments — deleting those would destroy provenance (C2).

---

## 5. Progressive enrichment (C17) — the call

**Finding, verified:** `runDiscovery` never calls `getSerpSnapshot` or `getTrend`. The only
callers are the adapter files and their tests. `serp_snapshot_ids` is never appended to;
`SerpSnapshot.weakness_note` is never produced. `platform/adapters/search-console.ts` is
imported by nothing. The SERP-gap signal has **no data path today**.

**Decision: wire the minimal finalist-enrichment stage, behind the budget brake, DEFAULT OFF.**
A new policy field `enrich_finalists_top_n` defaults to **0**, which reproduces today's
behavior byte for byte. When an owner sets it > 0, the stage runs after scoring, on the top-N
scored finalists only, each call pre-estimated against remaining budget and each snapshot
persisted through `SnapshotStore.saveSerp` with its id appended to `serp_snapshot_ids`. It is
tested both off (nothing changes) and on (bounded, brake-respecting).

It is therefore **built and provably exercisable, but inert until an owner turns it on**. The
SERP *scoring* signal is NOT built — enrichment persists evidence; nothing scores on it yet.

---

## 6. Handoff to A05 (recorded here, not acted on)

`src/domain/search/factory.ts:176` filters `recommendation === "NEW"` — **A04's opinion, not
the owner's decision**. Coherence seam 2 says A05's trigger predicate must become
`status === "approved"`. **That change belongs to A05's build and is not made here.** It is
safe to leave for now because `factory.ts` is CLI-only (`tools/run-factory.ts`); no scheduled
or automated path invokes it, so nothing bypasses the new gate at runtime. A test in this build
pins the invariant from A04's side: a `recommendation:"NEW"` / `status:"candidate"` record is
not treated as approved anywhere in A04's own surface.

---

## 7. Out of scope / untouched

`src/domain/problem/fixture-engine.ts` (A01/A02), `src/domain/search/factory.ts` and the
content bank (A05), `src/domain/search/qa.ts` and the publish gate (A06),
`src/app/complete/[request_id]/page.tsx` (DiagnoseWalkthrough — separately tracked), the
provider side, any real production/pricing/customer data. Per C13, any A04 scoring change
silently regenerates A05's staged portfolio and A06's QA results through the single-pass
`tools/run-factory.ts` — so this build changes **no committed factory artifact**; the 96
records stay byte-identical and readable.
