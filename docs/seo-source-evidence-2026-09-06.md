# Frozen v43 source evidence and release checks

This patch adds dated source evidence to the existing release checks. It preserves the approved page and keeps public release blocked.

`content/source-evidence/ac-blowing-warm-air.json` contains the reviewed public-source capture metadata and exact claim assessments from September 6, 2026. All eleven frozen URLs returned actual article responses. Two full claims are now supported: the Carrier repair-range card and the frozen-system fan instruction, the latter through an additional reviewed Trane article. Five claims remain partial and three unbound. Three fixed supplemental captures are exposed separately from the eleven frozen ledger sources. Four mandatory findings concern continued operation, categorical room scope, the repair-cost/mechanism comparison, and conflicting breaker-reset guidance for unknown equipment.

The server reads that fixed repository-owned bundle on every collection. Its digest detects damaged data; it is not a signature. Identity, chronology, capture hashes and exact claim hashes are checked against the frozen binding. Changing a source capture invalidates its existing claim review. Old captures, expired reviews and excessive review lifetimes cannot provide a positive receipt. Cost evidence has a maximum90-day review lifetime; other current claims have at most180days. The whole imported bundle expires after90days, and actual capture age is checked separately. Scheduled fetching and automatic remote change discovery remain future work.

`GET /sources/pages/ac-blowing-warm-air.json` exposes an explicit public projection: source titles/URLs/classes, capture and review dates, hashes, exact displayed claim text and metric values, support status and gaps. The nine capability claims point to their separate pending manifest. It publishes no raw article body, local capture location or customer runtime data. It returns no-store/noindex; invalid source evidence returns503. Historical expired evidence stays labeled expired and does not pass release.

A06 consumes only positive exact support while retaining all four additional review findings as blockers. Runtime capability and launch receipts remain absent. The previous generated SEO draft remains rejected. Illustrated services and prepared demo results are concept/fixture evidence, not proof of live capability.

## Verification

- `npx vitest run tests/seo.source-review.test.ts tests/a06.v43-release.test.ts tests/a05.v43-template.test.ts tests/loop.v43-renderer.test.ts tests/tools.door-release-audit.test.ts`
- `npm run lint`, `npm run typecheck`, then `npm run build` sequentially after tests.
- `node tools/sync-door-template.mjs --check`
- `npx tsx tools/check-v43-integration.ts` uses a new synthetic local store and must retain FAIL/publication refusal with zero model calls.
- `node tools/audit-door-release.mjs --origin http://localhost:3317 --mode preview --out data/runtime/t6-evidence/local-http.json`
- `node tools/audit-door-browser.mjs --help` lists the explicit device/fallback matrix. Deployed runs exclude the two injected exceptions; those require a local origin. All requests are GET/HEAD; the harness never submits an intake.

The browser checks cover320–2560px, three landscape sizes, no-JS, reduced motion and deliberately caught initialization exceptions. Five actual FAQ answers exist in frozen v43; earlier notes counting six were incorrect. The specifically authorized narrow methodology-link wrapping repair is now applied through the metadata adapter at widths up to360px. All55 frozen inputs and the raw renderer hash remain unchanged. Final compiled browser checks pass56/56 and wrapping comparisons pass36/36 at320/360/375/1280; wider geometry and text/typography are preserved. The full form/image/packet action sequence, complete accessibility and Core Web Vitals, actual production capability outcomes and the second-machine fidelity result remain separate open requirements.

The exact capture review, capability acceptance matrix, browser receipts and source patch are retained in the private project vault audit. Raw third-party article bodies remain ignored local audit material and are not distributed in this repository.
