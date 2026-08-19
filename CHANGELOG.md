# Changelog

## Owner Admin dashboard + committed factory portfolio (2026-08-14)

- /admin (Company OS Lite, door-machine slice pulled forward — D-21):
  Overview cockpit, Search opportunities (all 96 scored/recommended), Pages
  (QA state/reasons, preview links, owner Approve & publish / Unpublish),
  Page-creator controls (national vs local with per-type quotas; county →
  all-cities coverage; thresholds; cadence; budgets; categories — validated
  by the same policy contract, refused with reasons), Requests (journeys +
  owner audit trail). Access: read-only preview until ADMIN_PASSWORD; owner
  sign-in cookie unlocks mutations. Public serving stays behind master switch.
- `npm run factory` — deterministic A04→A05→A06 over seed research, committed
  to data/factory/*.json (staging + Admin need no database) — D-22.
- Home page trial navigator (staging is private): admin, /start, concepts,
  every staged door with QA badge.
- Staging stopgaps (labeled, removed with Supabase): results page reads the
  journey from the tester's own httpOnly cookie; policy edits persist to /tmp.
- Owner publish is the only path to PUBLISHED; audited.

## Door Waves 2-7 — vertical slice complete, fixture-backed (2026-08-14)

- Design system ported from the approved visual reference (asphalt/concrete/
  pink dispatch-console language) as globals.css tokens + components; fonts
  self-hosted via next/font (D-17).
- Door Wave 2: one shared IntentPageView template rendering any PageSpec via
  a constrained markdown-lite renderer (no raw HTML path), plus the ONE
  handcrafted excellent sample page (/staged/ac-not-turning-on).
- Door Wave 3 (A05): compilePageSpec/buildCandidatePages — approved NEW
  opportunities -> typed PageSpecs via deterministic family content banks
  (model writer swaps in behind the same contract, D-15).
- Door Wave 4 (A06): deterministic checks first (duplicates, intent overlap/
  doorway rule, thin content, placeholders, unsupported claims, attribution
  mismatch, safety-block presence) then heuristic critic; deterministic FAIL
  never reaches the critic; PASS -> owner publish queue (no publish runtime
  exists — nothing can go public).
- Wave 5: shared StartRequestForm + /start + central intake API — versioned
  consent (verbatim §9.2 draft, D-12), deterministic pre-analysis safety gate
  (gas halts intake with approved copy), IntakeSession attribution
  (prior-not-truth), EventEnvelopes for the full funnel.
- Wave 6: results page — JobPacket hero with approved value framing (no
  guarantees), print-to-PDF (D-13), copy-summary, three continuation paths
  (two honestly marked in-build, D-14), Future Feature Lab (4 concept pages
  with honest not-live status + measured interest).
- Wave 7 (fixture): FixtureProblemAnalyzer + FixtureJobPacketBuilder behind
  the production capability contracts — customer words beat door hints,
  inference labeled, unknowns listed, deterministic.
- Verified live in-browser: door -> form -> consent -> ProblemRecord ->
  JobPacket -> results, end to end.
- Vercel project prn-trial-claude created (SoulTech Team), git-linked;
  staging deploys on push (D-19). Suite: 164 tests / 22 files + production
  next build clean.

## Door Wave 1 — A04 Search Opportunity engine (2026-08-14)

- Seed importer: workbook -> 119 rows -> 96 deduped SearchOpportunity records
  with per-sheet provenance, KD-0-vs-null semantics, seed rubric preserved as
  prior (tools/convert-seed-xlsx.py + src/domain/search/importer.ts).
- A04 discovery pipeline (deterministic, zero LLM calls): discover -> merge
  with portfolio -> PRN-side intent classification -> score (versioned
  components) -> score-ordered recommendation NEW/EXPAND/MERGE/WATCH/REJECT
  with anti-doorway family matching. A04 cannot publish; owner approves.
- DataForSEO adapter: real v3 implementation behind SeoDataAdapter (Basic auth
  from env secrets, task-level error detection, per-call cost capture, unique
  snapshot ids, trend alignment). Live smoke test pending owner credentials.
- Budget engine: monthly + mid-run brakes; every vendor call records a
  UsageCostEvent; budget-stopped runs are retryable after a budget raise.
- Cadence-derived idempotency (daily/weekly/monthly/quarterly periods);
  identical completed runs never re-paid.
- Geography plan (Owner Decision D-10): national on/off + multiple local
  entries (state / state+county) with per-type quotas; county selection
  auto-expands to every city in the county as candidates sharing the entry's
  quota pool; policy rejects plans exceeding the hard cap. Local execution
  deferred until vendor geo mapping (OD-9).
- Owner policy configuration without deploys: data/seo-factory-policy.json +
  `npm run policy` CLI (validates every change; trial invariants unoverridable).
- Snapshot persistence (provenance chain), stores (in-memory + file policy),
  Supabase migration 00001 authored (applied when project selected).
- Adversarial verification round: 2 blockers + 12 should-fixes found and
  fixed (DECISIONS.md D-11). Suite: 137 tests / 19 files, all green.

## Wave 0 — Canon + contracts (2026-08-14)

- Repository initialized: Next.js + TypeScript + ESLint + Vitest; CI skeleton.
- Canon committed: AUTHORITY.md (precedence + doors-vs-engine rule),
  DECISIONS.md (D-000..D-7), OPEN_DECISIONS.md (ongoing owner list),
  Revision D Build Kit vendored unmodified under docs/canon/build-kit/.
- Frozen Door Wave 0 contracts (Zod + TypeScript):
  - search: SearchOpportunity, IntentCluster, SeoMetricSnapshot, SerpSnapshot,
    PagePerformanceDaily, FactBundle, PageSpec (+#23 monetization/user-value
    patches), IntentPage, page lifecycle (IDEA→…→RETIRED) with transition
    guard, opportunity recommendations (NEW/EXPAND/MERGE/WATCH/REJECT).
  - policy: SeoFactoryPolicy with every #23 §1.3 admin knob, D-3
    national/state/county geography control, trial defaults (owner approval
    enforced until T2 graduation).
  - intake: ROUTES (/start, /results/[request_id]), DoorAttribution
    (prior-not-truth), IntakeSession (D-2).
  - privacy: DisclosureVersion, ConsentEvent (kit-parity enforced by test).
  - economics: VendorCostRate, UsageCostEvent, RevenueEvent, BudgetPolicy.
  - platform: EventEnvelope + canonical event names (#14A §18.2 + slice
    additions), CapabilityDefinition + registry (core/#23/FUTURE_DISABLED),
    agent contracts + canonical 18-agent registry (fixes kit A12/A13 gap),
    feature flags (all OFF).
  - adapters: SeoDataAdapter + SearchConsoleAdapter interfaces with
    deterministic fixture implementations; no credentials anywhere.
- Seed research workbook vendored to tests/fixtures/seed-research/ with
  importer field map (docs/canon/seed-import-map.md).
- No customer-facing features. No database. No AI calls. No vendor calls.
- Adversarial verification pass (3 independent reviewers): PASS, 0 blockers;
  should-fix findings applied same day (see DECISIONS.md D-8/D-9).
