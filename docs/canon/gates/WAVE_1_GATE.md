# Door Wave 1 Gate Report — A04 Search Opportunity Engine

**Verdict: PASS** (with two live-wiring items pending owner hands) · 2026-08-14

## What was built
See CHANGELOG.md "Door Wave 1". In short: the autonomous research engine —
seed importer (96 records from the owner's workbook), deterministic
discover→merge→score→recommend pipeline, real DataForSEO adapter, budget +
idempotency runtime, snapshot provenance, owner policy file + CLI, and the
D-10 geography plan (national/local mix, county → all-cities expansion,
quality-gated).

## Checks run
| Check | Result |
|---|---|
| ESLint / TypeScript strict | clean |
| Vitest | **137/137 pass** (19 files) |
| Policy CLI smoke test | shows policy; REJECTS forbidden auto-publish with canon reason; valid edits version-bump |
| Seed conversion cross-check | 119 rows, per-sheet counts match independent digest exactly; KD-trap column excluded |
| Adversarial verification (3 reviewers) | canon PASS · correctness FAIL→fixed (2 blockers) · tests PASS; all findings applied (D-11) |

## Key invariants now enforced by tests
- Quota honesty: target 25 with 2 qualifying → exactly 2 NEW + 23 unfilled
  slots; thresholds never lowered; hard cap demotes overflow to WATCH.
- Budget: brake fires BEFORE any vendor call (spy-adapter proven) and again
  mid-run; every paid call ledgered; budget-stop is retryable.
- Idempotency: completed runs never re-paid; failed/budget-stopped runs do
  not consume the slot; periods follow the cadence (weekly ≠ monthly).
- Merge-before-score: seed metrics + owner rubric prior survive enrichment;
  ids stable; no duplicate records (pre-populated portfolio test).
- Anti-doorway: near-duplicates MERGE into page-worthy records only;
  vendor list order cannot starve a family; negated opposites stay distinct.
- D-10: county entry auto-expands to all 8 fixture cities sharing one quota
  pool; plans exceeding the hard cap are rejected; golden values pinned.
- A04 cannot publish: every record it writes stays status=candidate.

## Pending owner hands (blocking live operation, not the gate)
1. **DataForSEO**: create account, fund $50 minimum, put DATAFORSEO_LOGIN /
   DATAFORSEO_PASSWORD into `.env.local`. Then I run the live smoke test to
   confirm endpoint shapes (they are best-effort until proven).
2. **Supabase**: name the existing project/org to use; I apply migration
   00001 and swap file/in-memory stores for DB-backed ones.

## Explicitly out of scope this wave
Page template (Door Wave 2), A05/A06, intake shell, results page, admin UI
(policy is CLI/file until the Admin wave), local-target vendor execution
(OD-9), Search Console live OAuth (needs verified domain).

**STOP.** Door Wave 2 (one excellent intent-page template, visual language
from the approved skin) begins only on owner approval.
