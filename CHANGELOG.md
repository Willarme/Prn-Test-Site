# Changelog

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
