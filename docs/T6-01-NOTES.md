# T6-01 — Growth Knowledge Graph & Service Playbook Compiler: build evidence

Date: 2026-08-27 · Branch: `t6-01-growth-knowledge-graph` (from `a01-a02-trial-completion` @ 007ce0d)

## What was built

- `src/domain/growth/property-problem-graph.ts` — the typed graph: property system, observed problem, intent, urgency/safety, constraints, geography, service types, evidence requirements, price DRIVERS (never prices), provider capability. Zod-validated; duplicate-id and bad-join validation built in.
- `src/domain/growth/graph-v1.ts` — seeded graph data: 7 problem nodes (3 tree, 2 plumbing/drain, 2 roofing) + 6 intent nodes + 9 edges. Parse + uniqueness validated at module load: bad data fails at import, not at runtime three months later.
- `src/domain/growth/service-playbook.ts` — the ServicePlaybook content schema. One-authoritative-voice-per-trade is enforced in the registry; an authoritative playbook with `reviewed_by: null` is structurally refused, as is a half-signature (a name with no date, or a date with no name), so the human-ruling step cannot be skipped silently. Carries the R3 no-technique content rule.
- `src/domain/growth/playbooks/tree.ts` — Tree, authored in full (4 sections, 2 distinguishing questions with answer branch tables, safety notes, DIY boundary). **AUTHORITATIVE since 2026-08-28 (R1), signed by Joshua (R3).**
- `src/domain/growth/playbooks/plumbing-drain.ts`, `roofing.ts` — **shadow** playbooks at full schema depth, proving the schema generalizes to a third trade with zero schema edits. They stay shadow and unsigned (R1).
- `src/domain/growth/playbooks/index.ts` — the registry (the ONLY sanctioned import path; enforces one-authoritative-per-trade at load).
- `src/domain/growth/search-intent-compiler.ts` — deterministic query→graph classifier with computed confidence and audit-trail evidence strings. Model seam (`ModelIntentClassifier`) documented and UNWIRED: no AI adapter import exists in the domain (test-enforced).
- `src/domain/growth/page-eligibility-gate.ts` — 7-factor weighted gate (distinct intent, demand, answer uniqueness, safety importance, conversion value, local uniqueness, evidence depth). Unknown data scores 0, and three VETOES that cannot be outvoted: duplicate intent, no authoritative playbook covering the matched node, unmatched query. The default is NO. **Threshold is null (R2)** — no score auto-approves; survivors of the vetoes return `HUMAN_DECISION_REQUIRED`.
- `src/domain/growth/eligibility-policy.ts` + `eligibility-policy-v1.ts` — the gate's tuning knobs as validated DATA (R4): factor weights, demand bands, threshold. Retuning is a data edit, not a code change.
- `tests/t6-01-growth-knowledge.test.ts` — 52 tests.

## The required note: zero references to the intake playbooks

The canon-08 name collision (this graph/playbook layer vs A01's guided-diagnosis
intake playbooks) is guarded by two committed tests that scan every file under
`src/domain/growth/`: one asserts zero references to `domain/intake/playbooks`,
the other asserts no imports from `@/domain/problem` or `@/domain/intake` at all.
Both pass. **The build added and modified zero references to
`src/domain/intake/playbooks/`.** The growth domain is deliberately
dependency-free below the shared primitives.

## Gauntlet (all green on this branch before commit)

- lint + typecheck: clean
- tests: **1578 passed (110 files)** — 1554 baseline + 24 new
- `next build`: clean (exit 0)

## Defects caught and fixed during the build (falsification-proven)

1. Word-overlap measured query→alias instead of alias→query coverage; long real queries diluted matches to zero. Fixed to alias-coverage semantics (the direction that matches intent).
2. Gate scores summed to a max of 10 against a threshold of 55 — scale bug. Fixed (×10 onto the promised [0,100]).
3. High-scoring factors could outvote fatal failures (duplicate intent scoring 65 = eligible). Fixed with three explicit vetoes — cannibalization, filler, unanchored query are refusals at any score.
4. Windows portability: guard tests originally shelled out to `/bin/bash` grep; rewritten as portable Node file-walks.

## What waits on Josh (plan step S4) — NOTHING. All of it is ruled.

Josh ruled every parked question on **2026-08-28**. The rulings are recorded in
the repo's canon as **D-25 in `docs/canon/DECISIONS.md`**, which is the source of
record; this section is the pointer, not the register. (The register lesson,
recorded in `OPEN_DECISIONS.md` rather than quietly fixed: these questions were
parked here and never listed in `OPEN_DECISIONS.md`, so for a day they were
invisible to the one file that tracks open decisions. Parked questions belong
there on the day they are parked.)

- **R1 · Authoritative voice — RULED.** Tree is the authoritative playbook.
  Plumbing/Drain and Roofing stay `"shadow"` in that literal word (the schema and
  the gate both key off the string). Follow-up: OD-21.
- **R2 · Eligibility threshold — RULED: null**, on OD-5's precedent. Null does
  NOT admit everything: the three vetoes still refuse, and anything surviving
  them returns `HUMAN_DECISION_REQUIRED` with its score. A number goes in when
  A04 produces real demand data. Follow-up: OD-19.
- **R3 · Reviewer / safety copy — RULED.** Technique instructions are out of all
  three playbooks (stay clear / call someone only); Tree's `reviewed_by` is
  "Joshua" with `reviewed_at` 2026-08-28, set only after the strip. The two
  shadow playbooks stay unsigned.
- **R4 · Factor weights — RULED.** Weights and demand bands moved to
  `src/domain/growth/eligibility-policy-v1.ts` (schema in
  `eligibility-policy.ts`), values unchanged.
- **R5 · "Authored content exists" — RULED.** Read from the registry, defined as
  "an authoritative playbook covers the matched node". The caller boolean is
  gone. Plumbing and roofing candidates are vetoed as a result; that is intended.
- **R6 · Both defects — FIXED.** D1: Tree's plumbing question replaced with a
  real tree question, and the count-to-two guard replaced with checks on trade
  vocabulary, question ids and English structure (the filler "AAAAA BBBBB CCCCC
  DDDDD" now fails). D2: the geography regex no longer invents locations from
  ordinary phrasing; a place name must be a proper noun. Follow-up: OD-20.

Every guard test above was FALSIFIED before it was trusted — the thing it guards
was broken, the test watched go red, then restored and watched go green. The
defect this session repaired was a test that passed for the wrong reason, so
nothing here is trusted on the strength of a green run alone.

## Ruling-session gauntlet (2026-08-28)

- lint + typecheck: clean (exit 0)
- tests: **1606 passed (110 files)** — the T6-01 file went 24 → 52 tests
- `next build`: clean (exit 0)
- Scope held: zero reads or references to `src/domain/intake/playbooks/`, no
  dollar figure added anywhere, A04/A05 not wired to this layer.

## Second verification pass, 2026-08-28 — geography rewritten, five guards repaired

Two adversarial lenses re-verified the ruling session's work and both came back
PARTIALLY_REFUTED, with mutation proof: the code was broken deliberately and the
suite watched to see whether it noticed. It did not, five times. Everything
below is a repair to a guard that counted or grepped instead of checking.

### The geography ruling (Josh, 2026-08-28) — see D-26 in `docs/canon/DECISIONS.md`

**Verify against a known-places index; never guess.** The proper-noun rule this
notes file recorded as R6/D2 was wrong in both directions, proven live:

- INVENTED: `november`, `march`, `spring`, `autumn`, `christmas`,
  `hurricane helene`, `comcast`, `aep`, `lowes` — every one returned as the
  searcher's location.
- OVER-REFUSED: "tree removal in Columbia City" and "roof repair in Michigan
  City" returned null because the denylist held "city", and the audit trail
  asserted they are "not a proper place name" — false about two real Indiana
  towns in PRN's own market.
- NEVER EXAMINED: "In Fort Wayne my tree fell on the garage", because the
  candidate regex could not reach a sentence-initial place.

Built: `src/domain/growth/known-places.ts` (zod schema, normalisation,
leftmost-longest scan, structural validation) and `known-places-v1.ts` (the
authored seed), in the same data-layer shape as
`property-problem-graph.ts` + `graph-v1.ts` and
`eligibility-policy.ts` + `eligibility-policy-v1.ts`. The seed is the two
counties the trial's own `FixtureCityIndexAdapter` already carries — Allen
County IN, Franklin County OH — plus both county names and both county seats,
with a test asserting parity with that fixture in both directions.

The compiler now resolves geography only through that lookup, case-insensitively
and normalised. `compileIntent(query, graph, places)` takes the index, which is
what makes the guards below possible.

**OD-20 is obsolete and has been corrected in `OPEN_DECISIONS.md`** rather than
deleted: `in fort wayne` resolves, `In Fort Wayne my tree fell` resolves, and
`Grove City` resolves. **The new cost, accepted:** during the trial, geography
resolves only for places in the seeded index, so Columbia City is null — with a
TRUE audit line ("names no place in the known-places index … withholding
geography rather than guessing"), never the old false claim. OD-9 (ruled
2026-08-27) already decides the fix and its timing: the US Census gazetteer,
imported at the county-expansion wave. The seam it plugs into
(`KnownPlacesSource`, and the `census_gazetteer` value on every record's
`source`) is documented and deliberately unwired. No gazetteer was vendored.

### The five guard holes, each mutation-proven and each repaired

| # | What was unguarded | The mutation that stayed green | The repair |
|---|---|---|---|
| G1 | `sections[].body` — the homeowner-facing copy of the ONE signed playbook. Only `sections.length >= 4` touched it. | All four Tree section bodies replaced with `"AAAAA BBBBB CCCCC DDDDD."` — **1606/1606 still passed** | Per-paragraph length, shouted-token and English-prose checks; per-section own-trade vocabulary against a disjoint set; registry-wide duplicate-sentence check |
| G2 | R5's "the gate takes no caller boolean" was a grep for one identifier | The same override renamed `content_is_authored` — green AND type-clean | A behavioural invariant: the gate's answer must equal the registry's, proved with an input that answers `true` to every property it does not declare |
| G3 | The `GEO_NON_PLACE_WORDS` denylist had ZERO coverage — deleting it left 1606 green | Every D2 test was lowercase, so the capitalisation gate alone caught them | The mechanism is replaced entirely; the new tests fail if the lookup is bypassed and fail if the index is emptied |
| G4 | R3's technique ban matched only permission clauses plus four literal tokens | The same instruction in the imperative ("Relieve the trapped water… make a small hole… with a screwdriver") | Clause-initial method verbs and instrument phrases, with negation exempt from the first rule only, so warnings still stay |
| G5 | "every distinguishing question belongs to its OWN trade" was positive-only | Plumbing's question verbatim + "out by the tree", id renamed `dq_tree_one_or_many` | Another trade's vocabulary must be ABSENT, not merely outweighed |

### Falsification record

Every guard above was broken, watched go red, restored, and watched go green —
and each of the five original mutations was re-run against the fixed code:

- **G1 filler** (4 Tree bodies → `"AAAAA BBBBB CCCCC DDDDD."`): 4 failed / 78
  passed. Lorem ipsum: 4 failed. Section 2's body replaced by section 1's
  verbatim: 1 failed (the registry-wide duplicate check — every paragraph is
  individually fine, which is exactly why that check exists). Roofing's bodies
  under Tree's ids: 4 failed. Restored: 82 passed.
- **G2 rename** (`content_is_authored` honoured permissively): both old greps
  return 0 hits, `tsc --noEmit` exits 0 — and the new test fails, 1 / 83.
  Restored: 84 passed.
- **G3 bypass** (a hard-coded `fort wayne` branch ahead of the lookup): 2 failed
  / 76 passed. **G3 empty** (the seeded index emptied): 11 failed / 67 passed.
  Restored: 78 passed.
- **G4 imperative** (the proof sentence added to `roofing.ts` safety notes): the
  banned-token grep returns 0 and both original R3 tests stay GREEN — the old
  guard genuinely does not see it — while the new test fails, 1 / 98. Restored:
  99 passed.
- **G5 smuggled question** (plumbing's question under `dq_tree_one_or_many`,
  question mark intact so nothing else could catch it): 2 failed / 98 passed.
  With the new third check temporarily reverted to the old positive-only
  behaviour and the mutation still in place, it passes green — the finding,
  reproduced. Restored: 100 passed.

Four of the five guards also carry their falsification **permanently**, as tests
that run the checker against deliberately faked playbooks and fail if any fake
comes back clean. A guard that has never been shown to fail is not evidence.

### Second-pass gauntlet

- lint + typecheck: clean (exit 0)
- tests: **1654 passed (110 files)** — the T6-01 file went 52 → 100 tests
- `next build`: clean (exit 0)
- Scope held: zero reads or references to `src/domain/intake/playbooks/`, no
  dollar figure added anywhere, no gazetteer imported, A04/A05 still not wired.

---

## Third pass — 2026-08-28: the two owner rulings (D-27, D-28)

The second pass shipped guards that were defeated on re-verification, and header
prose that asserted behaviour the code did not have. Josh ruled on both.

### D-27 — geography comes from the row, not the query string

**Deleted, not tuned.** `known-places.ts` and `known-places-v1.ts` are gone,
along with `resolveGeography`, `findKnownPlace` and the locative-preposition
regex. Nothing else read them.

The second pass's index lookup had been verified green and was still wrong. It
resolved `"columbus day sale on chainsaws"` to `columbus`, `"Fort Wayne Cabinets
installed my kitchen wrong"` to `fort wayne`, `"roof leak in Columbus Georgia"`
to the **Ohio** Columbus, and `"I named my dog Hilliard"` to `hilliard` — each
time writing `verified against the known-places index` into the audit trail.
Three mechanisms had now been built in that spot and all three guessed.

**What supplies geography now.** The row does. `GeographyScope` is already
stamped on `SearchOpportunity`, `IntentCluster`, `SeoMetricSnapshot` and
`SerpSnapshot` in `src/domain/search/contracts.ts`, next to `geography_assumed`;
`src/platform/adapters/dataforseo.ts` maps it to `location_code` on every API
call. Geography is an input to the search, chosen before the query existed.
`compileIntent(query, rowGeography)` copies it through — reusing the existing
`GeographyScope` from `@/domain/shared/primitives`, so there is no second
geography type in the codebase. The import-boundary test forbids only
`@/domain/problem` and `@/domain/intake`, so this crosses nothing.

`geography_assumed` survives into `fields.geography_assumed`. The evidence line
distinguishes STATED from ASSUMED in those words and never says "verified".

**The probe proving the old fabrications are structurally impossible:** there is
no code path from `query` to `fields.geography`. All five historical
fabrications are permanent test cases (they return null with no row scope, and
the row's scope with one), plus a structural guard that fails if
`findKnownPlace`, `KNOWN_PLACES`, `KnownPlacesIndex`, `resolveGeography`,
`normalizePlaceName`, `GEO_PREPOSITION`, `gazetteer` or the alternation
`in|near|around` reappears in growth-domain code (comments stripped first, so
the history stays written down).

### D-28 — every header promise enforced or retracted

Twenty audited claims. **Enforced:** the claim-safety contract
(`unsourcedSections()` + a fourth gate veto — a section declaring
`sourced_reference` with no source, or resting on `outcome_record`, refuses the
page); `evidence_needed` read as `verdict.withheld_claims` (a boundary, not a
veto — every node has an unmet requirement, so gating on them would refuse every
page PRN could build); unknown urgency scores 0 instead of asserting "routine
class" about an unidentified problem; R4 completed (eleven hardcoded factor
scores + the 0.4 confidence cut-off moved to policy data, and the policy now
refuses to set any "no data" branch above zero); no dollar figure in ANY playbook
field; `graph.edges` validated; graph schemas `.strict()`; `"unmatched"` made
producible; the model seam's return type made to carry a NEW node proposal.

**Retracted:** A04 does not classify against this graph and A05 does not read
these playbooks — the growth domain's only consumer is its own test file; adding
a TRADE is a code edit because `PROPERTY_SYSTEMS` is a hardcoded tuple no
registry extends; `node.geography` is stamped but inert.

**On `sourced_reference` + `source: null`:** not a data defect, and no source was
invented. `evidence_needed` is a register of REQUIREMENTS, where null means
unmet — the doc was describing a satisfied evidence record. Doc corrected; a
`refine` now enforces that only a `sourced_reference` may name a source at all.

### The tripwires, honestly

Ten prose checks renamed with a `HEURISTIC:` prefix; the structural ones labelled
`STRUCTURAL:`. Nothing deleted, no token list escalated — Josh's rule is that the
R3 vocabulary does not get a fourth round. Copy quality is enforced by the named
human in `provenance.reviewed_by` (A01 approval condition 3), which
`validatePlaybook` requires for any authoritative playbook. Both the test file
and `service-playbook.ts` now say so in as many words.

### Falsification

Fifteen mutations, each removing the mechanism a guard protects: guard RED,
mutation reverted, GREEN restored. Four on geography (drop the scope, flatten
`assumed`, reintroduce a place index, make the evidence line say "verified") and
eleven on the contracts (strict off, edges unchecked, both refines off, money
check blinded, unsourced-sections blinded, safety null fall-through, withheld
claims emptied, `"unmatched"` killed, zero-invariant off). A **control** mutation
that changes a factor's shape without hardcoding a score correctly did NOT trip
the R4 guard, so that guard is not simply failing on everything.

The new R4 guard earned its keep immediately: it found a twelfth hardcoded score
the audit had missed (`scoreDemand`'s null branch), which is now
`policy.factor_scores.demand.unknown`.

### Third-pass gauntlet

- lint + typecheck: clean (exit 0)
- tests: **1663 passed (110 files)** — the T6-01 file went 100 → 109 tests
- `next build`: clean (exit 0)
- Scope held: zero reads or references to `src/domain/intake/playbooks/`, no
  dollar figure added anywhere, no gazetteer imported, A04/A05 still not wired.
