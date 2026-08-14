# Wave 0 Gate Report — Canon + Contracts

**Verdict: PASS** · 2026-08-14 · Repo: github.com/Willarme/property-response-network (private)

## What was built
Everything in CHANGELOG.md "Wave 0". Summary: repo + tooling (Next.js/TS/
ESLint/Vitest/CI), canon docs (AUTHORITY/CHECKPOINT/DECISIONS/OPEN_DECISIONS),
Build Kit vendored unmodified, all Door Wave 0 contracts frozen as Zod +
TypeScript with fixtures, adapter interfaces with fixture implementations,
seed workbook + importer field map.

## Checks run
| Check | Result |
|---|---|
| ESLint | clean |
| TypeScript (`tsc --noEmit`, strict) | clean |
| Vitest contract tests | **76/76 pass** (11 files) |
| Adversarial verification (3 independent reviewers: canon compliance, architecture boundaries, test quality) | PASS, 0 blockers; all should-fix findings applied (DECISIONS.md D-8/D-9) |

## Key invariants now enforced by tests
- PUBLISHED is reachable only from QA_PASS; RETIRED is terminal; owner
  publish gate cannot be skipped by any lifecycle path.
- SeoFactoryPolicy rejects auto-publish / no-human-approval before T2
  graduation; hard page cap ≥ target; geography control is national/state/
  county with required selection lists (D-3).
- KD 0 ≠ KD unknown survives fixture → adapter → contract.
- ConsentEvent/CapabilityDefinition stay field/enum-compatible with the
  Build Kit JSON schemas (parity tests read the kit files directly).
- Every kit FUTURE_DISABLED runtime is registered FUTURE_DISABLED; nothing
  is LIVE at Wave 0; every feature flag ships OFF.
- IntakeContext carries attribution only (doors, not brains) — asserted
  against the schema shape itself.
- Agent registry ⊇ kit registry and fixes the kit's A12/A13 omission (D-6).
- Money amounts are finite and non-negative; budgets require a hard monthly
  cap and defined fallback.

## Explicitly out of scope this wave (not built)
UI features, database/migrations, AI calls, vendor API calls, pages, intake
form, results page, consent UI, admin UI, deployments.

## Known limitations / carried forward
- Preview deploy deferred to when there is something to see (Vercel access
  confirmed available; nothing customer-visible exists yet).
- min_user_value_score numeric bar TBD (OD-5); risk-scale wording awaiting
  owner confirm (OD-4); wording items in OPEN_DECISIONS.md per D-4.
- The seed workbook is not yet machine-imported (that is Door Wave 1's
  importer, per plan); its field map is documented and hand-derived fixtures
  cover the tricky semantics.

## Owner actions needed before Door Wave 1 (next wave)
1. DataForSEO: create account, fund $50 minimum, put login/password into
   `.env.local` under DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD (never in chat).
2. Supabase: confirm which existing project/org to use for this product.

**STOP.** Wave 0 complete. Door Wave 1 (A04 + importer + ScheduledJob/AgentRun
runtime + admin policy surface) begins only on owner approval.
