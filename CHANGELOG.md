# Changelog

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
