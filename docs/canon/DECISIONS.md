# Owner Decision Log

## OD rulings — 2026-08-27 session (Josh; full rationale in the crew log)

- **D1 / model wiring** — the 2026-08-26 live-switch state is the STANDING trial
  decision, scope A01 capabilities; A06's critic (OD-15) stays off until separately
  turned on. Default model switched to `deepseek/deepseek-v4-flash-0731` (owner:
  "fast and cheap for large workloads"), was stealth/ox-alpha. Caps unchanged,
  TEST; `allows_customer_data` stays FALSE on every model — clearing one for
  homeowner text remains a Josh+Melissa call. Commit 7797bd2, 1578/1578 tests.
- **OD-8 / brand-domain** — DELEGATED to Melissa (her call, with T4-04). Working
  title "Property Response Network" stands until she rules; registration waits
  for the launch wave.
- **OD-3 / consent** — IMPLIED on continue: "By continuing, you agree to the
  Terms and Privacy Notice" (14A §9.2 draft verbatim), no checkbox. Consent
  ledger unchanged; counsel review still gates production wording.
- **OD-13 / prices** — owner-entered ranges WITH provenance. Dollar ranges appear
  in the decision frame only once Melissa enters real sourced ranges into the
  versioned price registry; placeholders stay until then; no vendor price API
  this trial.
- **OD-9 / city dataset** — US Census gazetteer adopted (plus DataForSEO
  location-code mapping). Import happens at the county-expansion wave.

Also this session: T0-18 hybrid approval cadence; T0-02 playbook exposure = fix
now (T1-15 before A01); T2-06 Josh's side = one-line disclosure, pending Melissa;
T4-04 delegated to Melissa; T7-01 Claim Ledger + Verification Standard built
(awaiting Melissa's three rulings).

## Autonomous-run decisions (2026-08-14, standing owner approval)
The owner authorized continuing without per-wave stops and asked for a list
of calls made in her absence. D-12 through D-19 are those calls — review and
overturn freely; each is built to be cheap to change.

## D-28 — Fix the contracts; stop test-guarding prose — 2026-08-28

Josh's ruling, made with D-27 after the same verification round. Two halves.

**A regex cannot judge whether copy is good.** Three rounds of prose tripwires
were written against the R3 no-technique rule and each was defeated by a two-word
rewrite: the permission-clause ban ("you can puncture…") missed the same
instruction in the imperative ("make a small hole…"), and broadening it to
clause-initial method verbs and instrument phrases moved the line without closing
it. **The control on copy quality is the named human in
`provenance.reviewed_by`** — A01 approval condition 3 — and `validatePlaybook`
refuses an authoritative playbook without one. The tripwires stay as a net, but
they are not escalated again, and every one that judges prose rather than
structure is renamed with a `HEURISTIC:` prefix so no future reader mistakes it
for a guarantee. The module docs say the same thing where the schema lives.

**Every header promise must be true.** An audit read twenty header claims in
`src/domain/growth` against the code; each is now ENFORCED or RETRACTED.

Enforced, load-bearing first: `service-playbook.ts` had promised since it was
written that "the gate that decides whether a page gets BUILT reads these; a page
whose claims outrun their evidence class does not ship" — and the gate read only
a `playbook_id`. `unsourcedSections()` now names every section declaring a
`sourced_reference` with no source, or resting on outcome data PRN does not hold,
and the gate **vetoes** on it. The graph's `evidence_needed` register is read too,
as `verdict.withheld_claims`, but deliberately as a BOUNDARY rather than a veto:
those are claims a page may not MAKE, not conditions it must MEET, and every node
carries an unmet one, so gating on them would refuse every page PRN could build.
They go in front of the human who decides. Also enforced: unknown urgency scores
0 instead of asserting "routine class" about an unidentified problem; R4 done
properly, with all eleven remaining hardcoded factor scores plus the confidence
cut-off moved to policy data and the policy refusing to set any "no data" branch
above zero; no dollar figure in ANY playbook field (the graph was checked, the
homeowner-facing copy was not, which is how "usually runs $1,200 to $3,500"
survived in signed Tree copy); `graph.edges` validated at both ends; every graph
schema `.strict()`; `"unmatched"` made a producible classification.

Retracted, because they were aspirational: A04 does not classify against this
graph and A05 does not read these playbooks — the growth domain's only consumer
is its own test file, and the headers now say so; adding a TRADE is a code edit,
not data, because `PROPERTY_SYSTEMS` is a hardcoded tuple no registry extends;
`node.geography` is stamped but inert, and the header names the check that would
enforce it.

**On the `sourced_reference` rows carrying `source: null`.** These are not a data
defect and no source was invented for them. Read the claims — "permit
requirements for a specific municipality" — and the field is a register of
REQUIREMENTS, where null means unmet. The doc comment was describing a satisfied
evidence record; the doc was corrected, and a `refine` now enforces that only a
`sourced_reference` may name a source at all.

## D-27 — Geography comes from the row's scope, not from the query string — 2026-08-28

Josh's ruling, superseding D-26 the same day. **The whole parse-the-query
approach is retired.**

**Why D-26 was not enough.** D-26 replaced a guessing heuristic with an index
lookup, which fixed the lowercase cost and the false "not a proper place name"
refusals. But it kept the premise underneath — that geography is something to
RECOVER FROM QUERY TEXT — and the premise was the defect. The lookup guessed
too, just with different words. Proven on live queries:

- `"columbus day sale on chainsaws"` → geography `columbus`
- `"Fort Wayne Cabinets installed my kitchen wrong"` → `fort wayne`
- `"roof leak in Columbus Georgia"` → the OHIO Columbus
- `"I named my dog Hilliard"` → `hilliard`

and each one wrote `verified against the known-places index` into its own audit
trail. Three mechanisms had now been built in that one spot — preposition-
follows, capitalisation-minus-denylist, index-lookup — and all three guessed
while asserting they had verified. The answer is not a fourth heuristic.

**The fact that settles it.** Geography was never missing. `GeographyScope` is
already a structured field on keyword and opportunity rows
(`src/domain/search/contracts.ts`: `SearchOpportunity`, `IntentCluster`,
`SeoMetricSnapshot`, `SerpSnapshot`), carried alongside `geography_assumed` —
"true when the source did not state geography and US-national was assumed (seed
import)". `src/platform/adapters/dataforseo.ts` maps that scope to the vendor's
`location_code` on every call. **Geography is an INPUT to the search that
produced the query, chosen before the query existed.** Recovering it from the
resulting text was reconstructing a known fact by guesswork.

**The ruling.** `compileIntent` accepts the row's geography as an argument — the
existing `GeographyScope` type from `@/domain/shared/primitives`, not a second
geography type — and copies it through. `geography_assumed` survives into the
compiled output, because the honest distinction between a scope the source
STATED and one PRN assumed is the good idea already upstream and must not be
flattened. The evidence line says which, in those words, and never says
"verified" or "query states location". A row with no scope yields null, and the
line says the row carried none. `known-places.ts` and `known-places-v1.ts` are
deleted; nothing else read them.

**What guards it.** The five historical fabrications are permanent test cases,
plus a structural guard on the deleted machinery's names — there is no code path
from `query` to `fields.geography`, so the bug class cannot return by tuning,
only by a deliberate rebuild that the guard fails.

OD-20 is corrected (the cost it recorded no longer applies in either version)
and OD-9's scope is clarified: it is about TARGETING — which counties and cities
PRN searches, and their vendor location codes — never about resolving place
names out of query text.

## D-26 — Geography: verify against a known-places index; never guess — 2026-08-28

**SUPERSEDED SAME DAY BY D-27.** Kept in full because the failures it documents
are the reason the next ruling went further. Its mechanism (a known-places index
lookup) was deleted: it removed the guessing described below and then guessed in
a new way, resolving "columbus day sale on chainsaws" to a location. Read D-27
for what replaced it.


Josh's ruling, made after an adversarial pass re-verified D-25/R6's geography
fix and found it wrong in BOTH directions. It applies his OD-9 ruling of
2026-08-27 (the US Census gazetteer is the adopted city dataset, imported at the
county-expansion wave) to the search-intent compiler.

**What the ruling replaces.** R6 (D2) had made a place name "a capitalised
phrase that is not on a denylist". Live queries proved that rule guesses:

- It INVENTED. A capital letter is evidence of a proper noun, not of a place.
  "roof leak in November" produced the location `november`. So did `march`,
  `spring`, `autumn`, `christmas`, `hurricane helene`, `comcast`, `aep` and
  `lowes` — a month, three seasons, a holiday, a storm, two utilities and a
  hardware chain, each recorded as where a homeowner lives.
- It OVER-REFUSED, and wrote a false reason into the audit trail. The denylist
  held "town" and "city" and rejected any multi-word candidate containing
  either, so **Columbia City** and **Michigan City** — real Indiana towns inside
  PRN's own Fort Wayne market — came back null with an evidence line asserting
  they are "not a proper place name". That sentence was simply untrue.
- It never LOOKED at a sentence-initial place: "In Fort Wayne my tree fell on
  the garage" was never examined and got the same false refusal.

**The ruling.** A phrase is a place if, and only if, it is in a known-places
index. The index is DATA in the same shape as the rest of this layer — a
zod-validated schema (`src/domain/growth/known-places.ts`) plus an authored
record (`known-places-v1.ts`), exactly as the graph and the eligibility policy
are built. Matching is case-insensitive and normalised on both sides. Anything
not in the index yields null geography and an audit line that says the true
thing: the place was not found in the index, so geography is being withheld
rather than guessed. It never claims a phrase is not a place name — the index's
coverage is a fact about the index, not about the world.

**The seed is not invented.** It is the two counties the trial's own fixture
city index already carries — Allen County IN and Franklin County OH — with
their county names and county seats, and a test asserts parity with that
fixture in both directions so the two cannot drift apart.

**What this ruling gives back.** OD-20's recorded cost is gone: `in fort wayne`
resolves, and so does `In Fort Wayne my tree fell`. A lookup does not need
capitalisation as a signal, and most people type lowercase. A place whose last
word is "City" or "Town" resolves when the index carries it — `Grove City` does
today.

**The new cost, accepted deliberately.** During the trial, geography resolves
ONLY for places in the seeded index, so Columbia City is null today. That is a
null with a true reason attached, and the fix is already decided rather than
improvised: OD-9's gazetteer import at the county-expansion wave. Nothing was
vendored early — the seam it plugs into (`KnownPlacesSource`, and the
`census_gazetteer` value on every record's `source`) is documented and
deliberately unwired, because an unreviewed 30,000-row dataset landing ahead of
its wave is exactly the kind of thing that gets trusted before anyone checks it.

Recorded alongside the ruling, because it is the reason the ruling was needed:
the same pass repaired five guards that counted or grepped instead of checking
(the published section prose, the anti-filler invariant, the geography tests
themselves, the technique ban, and the own-trade question rule). Each was
falsified before it was trusted. The evidence is in `docs/T6-01-NOTES.md`.

## D-25 — T6-01 growth knowledge layer: six rulings — 2026-08-28

Josh ruled the six business judgements the T6-01 build parked (plan step S4).
All six are implemented on `t6-01-growth-knowledge-graph`; each is guarded by a
test that was falsified — broken, watched fail, restored — before it was
trusted, because the defect this session repaired was itself a test that passed
for the wrong reason.

- **R1 — Tree is the authoritative playbook.** It was the trade authored in
  full, so it becomes the trade's voice of record. Plumbing/Drain and Roofing
  STAY shadow, in that literal word — the schema's one-authoritative-voice rule
  and the eligibility gate both key off the string `"shadow"`, so renaming it
  ("parked", "draft") would break them silently.
- **R2 — The eligibility threshold is NULL**, following OD-5's precedent (a
  threshold whose recorded default is null until real scores exist). **Null does
  not admit everything.** The three unoutvotable vetoes still refuse; anything
  surviving them returns `HUMAN_DECISION_REQUIRED` with its score attached, for
  a person to decide. The score is still computed, weighted and reported. The
  reason: the gate's reachable range on today's inputs is roughly 34–83.5, not
  0–100, so any number between about 48 and 76 would change nothing about a real
  candidate while reading like a decision. A decorative number that looks real is
  worse than an honest null. A number goes in when A04 supplies real demand data
  (see OD-19).
- **R3 — No technique instructions in playbook copy.** Safety and DIY copy say
  stay clear and call someone; they never teach a method for acting on the
  problem. The line that forced it: a roofing playbook telling a homeowner to
  relieve a water-loaded ceiling by puncturing it over a bucket. Applied to ALL
  THREE playbooks — it is a content rule, and copy left in a shadow playbook goes
  live later by accident. Tree's `provenance.reviewed_by` was set to "Joshua"
  (with `reviewed_at`) only AFTER that strip: nobody signs copy that teaches a
  method. The two shadow playbooks stay unsigned.
- **R4 — Factor weights and demand bands move out of code**, into the same data
  layer the playbooks live in (`src/domain/growth/eligibility-policy-v1.ts`,
  schema in `eligibility-policy.ts`). No value changed: same seven weights, same
  100/mo and 20/mo bands. Retuning before A04 produces real demand numbers would
  be guessing twice — but it should never have needed a code edit.
- **R5 — "Authored content exists" is read from the registry**, not supplied by
  the caller, and means: an AUTHORITATIVE playbook covers the matched node. A
  shadow playbook does not count. The consequence is intended, not a bug:
  plumbing and roofing candidates are now vetoed, because PRN has no signed voice
  for those trades. Any future override may only make the answer stricter than
  the registry's.
- **R6 — Two defects repaired.** (D1) The "fully authored" Tree playbook's second
  distinguishing question was plumbing content copied from the drain playbook;
  it shipped because the only guard counted to two, and a verifier later proved
  the emptiness by replacing the question with the literal filler "AAAAA BBBBB
  CCCCC DDDDD" with all 24 tests still green. Tree now carries a real tree
  question, and the guard checks trade vocabulary, question ids, and whether the
  text reads as English. (D2) The compiler's geography regex invented locations
  from ordinary phrasing — five of eighteen sample queries produced "a house",
  "me for", "my house", "basement after", "the attic" — contradicting the
  module's own "never invents geography" contract. A place name must now be a
  proper noun; the accepted cost is that an all-lowercase "in fort wayne" yields
  null, which is the honest answer.

Scope held: nothing under `src/domain/intake/playbooks/` was read, referenced or
modified (A01's territory, guarded by a committed test), no dollar figure was
added anywhere, and A04/A05 were not wired to this layer.

## D-24 — Post-description intake: playbooks, photos, guided diagnosis — 2026-08-19
Owner direction: after the first description, show TWO boxes — (1) every
detail a technician wants, green-checked where already known, photo-first
with typed fallback, nothing required; (2) an optional guided diagnosis that
eliminates causes step by step (photo / yes-no / 0-10 rating / choice), can
end in a safe DIY fix, and always sharpens the packet. Efficiency rule: all
of it is GENERATED ONCE per problem family as an IntakePlaybook (fields +
full branching script), cached, and replayed statically — zero per-customer
AI calls. Built: playbook contract + validator (no dead ends), content-bank
playbooks for AC-not-cold (the owner's worked example), HVAC no-power,
plumbing leak, electrical, generic; deterministic auto-detection of brand /
model / age / timing from the customer's words; private photo/video storage
(Supabase bucket, type+size allowlist, never public); answers and step
photos feed a re-assembled packet version every time (newest wins); a step
photo can satisfy required fields ("two checks in one"); packet gains
collected details, media count, walkthrough findings, provider note, and
drops questions already answered. Harvest-to-property-memory flag set on
equipment fields for Customer Lite. Verified live end to end on Supabase.
Decision frames use NO invented prices (OD-13).

## D-23 — Database live; admin surface gated; ledger append-only — 2026-08-19
Supabase project "PRN Trial Claude" wired and verified end to end. Security
posture, after an adversarial review found the admin pages readable without
authentication (they gated the BUTTONS, not the DATA):
- Every /admin page now calls adminGate() BEFORE loading anything; with no
  owner session it renders sign-in only. No ADMIN_PASSWORD configured means
  the dashboard shows a setup notice and never touches customer data.
- Session cookie is scrypt-derived HMAC over an issued-at stamp, expires
  server-side, dies when the password is rotated, and is not password
  equivalent. Sign-in is throttled.
- Tables: RLS enabled with no policies; privileges granted to the server-side
  service role only and revoked from anon/authenticated (the project was
  created with auto-expose OFF, the secure choice).
- consent_event and event_envelope: UPDATE/DELETE revoked even from the
  application role, so the consent ledger is append-only structurally.
- disclosure_version table added; the exact wording shown is persisted, and
  the disclosure id now carries the content hash so revising the text mints a
  new id instead of silently re-pointing historical consent.
- Migration tool verifies TLS against Supabase pinned CA (certs/) rather than
  disabling verification while carrying the database password.
- /results/[request_id] remains an unguessable capability URL by design
  (#14A: the guest gets a packet with a private share link, no account). That
  is safe only because the ids are crypto-random and are no longer listed by
  an open admin page.
Also fixed from the same review: event recording is best-effort so telemetry
cannot invalidate a committed journey (which would have duplicated a customer
consent row on retry); both store backends now select the newest packet and
the earliest problem consistently; the client-boundary guard test had gone
vacuous after the refactor and now matches the real mutators.

## D-21 — Owner Admin dashboard now, not at Wave 8; staging stopgaps
The owner could not test anything without visibility, so Admin/Company OS
Lite's door-machine slice (#14A §17: Search/Opportunities, Pages incl.
publish/rollback, Controls, Requests, Audit) was pulled forward. Access model:
no ADMIN_PASSWORD → read-only preview (fixture data, noindex); ADMIN_PASSWORD
set → owner sign-in cookie unlocks publish + policy edits (audited). Owner
publish is the ONLY path to PUBLISHED; public serving remains behind the
seo_doors master switch until launch. Two staging stopgaps until Supabase:
(a) the results page can read the journey from the tester's own httpOnly
cookie so the flow completes on Vercel (not shareable, only that browser);
(b) policy edits on Vercel persist to /tmp (ephemeral). Both are labeled in
the UI and removed when the database lands.

## D-22 — Committed factory portfolio
`npm run factory` runs A04 scoring → A05 build → A06 QA over the seed
research and commits the result (data/factory/*.json) so staging + Admin show
a real page portfolio with no database. Doors are built ONLY for
problem-intent keywords (D-3); tool/calculator opportunities stay listed
for a later product line. A test pins the committed output to a fresh
evaluation so it can't drift silently.

## D-20 — Shell flags flipped ON at the slice gate; all flags now enforced
intake_shell/results_shell/feature_lab flipped to enabled (their surfaces
shipped fixture-backed at this gate); every route now actually consults its
flag (verification found three decorative flags — fixed). Risky flags
(seo_doors, trust, monetization, mcp, sms) remain OFF with tests pinning
them. Also from the same verification round: server-side safety halt before
analysis (gas = no record, no packet), broadened gas/burning phrasing
coverage, crypto-random request/session ids, consent disclosure hash
verified server-side, QA self-identity by reference, factory long-keyword
titles, corrupt dev-db preserved not wiped, print stylesheet fixes, trust
card copy neutralized pending #15 (OD-11).

## D-12 — Consent mechanics (resolves OD-3 provisionally)
The shared intake form shows the #14A §9.2 counsel-review draft VERBATIM as a
highlighted disclosure line; tapping Continue is the affirmative act; the
versioned ConsentEvent records at submission with disclosure dv_intake_0_1.
No separate checkbox for now — counsel can require one later and it's a
one-component change (that being one component is the whole point).

## D-13 — Packet PDF = print-to-PDF for the trial
"Print / Save as PDF" uses the browser's print pipeline with a print
stylesheet. A server-side PDF renderer is deferred until the packet format
stabilizes (avoids a heavy dependency on a moving format).

## D-14 — Results-page continuation paths shown honestly as in-build
"Ask My People" and "Find someone for me" appear as real paths marked
"Arriving in this trial — being wired now" (amber pill). They are NOT fake
doors (they're approved later-wave features), and no interaction pretends to
work. Copy is descriptive-neutral pending #15 reattachment.

## D-15 — A05 writer + A06 critic are deterministic v1 behind final contracts
Page content generation uses a family-based content bank
(generation.model="content-bank-v1"); the QA critic is a heuristic scorer.
Both sit behind the exact signatures the model-backed versions will implement
once OPENAI_API_KEY exists. Every generated page still requires A06 PASS +
owner publish — thin content cannot leak out.

## D-16 — Route scheme
Doors: /problems/[kebab-slug] (flag-gated OFF, serves only owner-published
pages — currently none can exist). Staged previews: /staged/[slug] with amber
banner, always noindex. Results: /results/[request_id] (private, noindex).
Concepts: /future/[slug]. Site-wide robots disallow-all until launch.

## D-17 — Fonts self-hosted; nothing indexable
Archivo/Public Sans/JetBrains Mono via next/font (downloaded at build,
self-hosted — no Google CDN at runtime, unlike the reference HTML). Global
noindex metadata + robots disallow until the launch wave.

## D-18 — Dev persistence = local JSON store until Supabase
Journeys persist to data/runtime/dev-db.json locally (gitignored) and /tmp on
Vercel (ephemeral; results page says so honestly if a record expires). The
Supabase-backed stores replace this behind the same shapes once the owner
creates the "PRN Trial Claude" project (migration already written).

## D-19 — "PRN Trial Claude" naming + Vercel project
Interpreted the owner's "PRN Trail Claude" as "PRN Trial Claude". Created
Vercel project **prn-trial-claude** (id prj_CKXVrUfArfAvwbFUraLLcHljOwyO) in
the existing SoulTech Team, git-linked to Willarme/property-response-network;
pushes to main auto-deploy a staging preview at a *.vercel.app URL. Vercel
Authentication is disabled by default on new projects — acceptable because
everything is noindex/robots-blocked and fixture-only; owner may enable
protection in Vercel settings. This vercel.app staging is NOT "publishing"
in the canon sense: no real pages exist, /problems is flag-gated OFF.

Closed decisions with their resolutions. Open items live in
[OPEN_DECISIONS.md](OPEN_DECISIONS.md). Every entry here was approved by the
owner (Melissa) or resolved under explicitly delegated judgment.

## D-000 — Doors vs engine (canon rule) — 2026-08-14
Owner-supplied canon sentence adopted verbatim; see AUTHORITY.md. Intent pages
are doors; the analyzer brain is centralized. #23 §0.2's "embed the same
Problem Analyzer" is read as "render the shared intake entry component," never
as per-page analyzer logic.

## D-001 — #23 patch scope — 2026-08-14
#23 supersedes #14A Rev D §15.1 Step 1 only. Everything else in #23 is
additive and subordinate to #14A's gates. Vertical slice order approved:
contracts → A04 → template → A05 → A06 → intake shell → results shell →
Feature Lab pages → A01/A02 → Trust → recommendation → Customer Lite →
integration/hardening.

## D-1 — A16 identity — 2026-08-14 (delegated judgment)
A16 = Trust Network Intelligence / Coverage, stage LATER (#14A §12). The
rejected post-job outcome follow-up is a deferred FEATURE, not an agent, and
binds to no active trial agent. Optional verification question against #20 is
logged in OPEN_DECISIONS (non-blocking).

## D-2 — IntakeSession — 2026-08-14 (delegated judgment)
IntakeSession is an ADDITIVE attribution record (door → guest_session_id +
request_id + attribution context). Not a parallel session system.
guest_session_id / request_id remain the canonical #14A identifiers.
Implemented in `src/domain/intake/contracts.ts`.

## D-3 — Geography: national first — 2026-08-14 (owner decision)
A04's first research policy targets NATIONAL problem-intent pages; local
comes later. Admin control panel exposes `geography_scope` as a first-class
control: **national | state | county**, where state and county modes take a
selection list. Implemented in `GeographyScope` (shared primitives) and
`SeoFactoryPolicy.geography_scope`; trial default is national/US.

## D-4 — Wording-class items never block builds — 2026-08-14 (owner decision)
Small copy/wording decisions go to OPEN_DECISIONS.md ("Please edit or decide"
list), are added to each session as applicable, and never stop a wave. Only
scope, privacy, legal and money conflicts hard-stop per canon.

## D-5 — Vendor prices & model names are data — 2026-08-14 (delegated judgment)
Model names (#23 cites "GPT-5.6 Luna/Terra/Sol") and all vendor prices are
never hard-coded; they live in the versioned Cost Rate Registry
(`VendorCostRate`) and are verified against real vendor APIs at integration.

## D-6 — Build Kit agent registry defect — 2026-08-14 (resolved by precedence)
`build-kit/reference/agent_registry_trial.json` omits A12 and A13, which #14A
§12 and the kit's own 07_TRIAL_AGENTS.md require. The kit copy is preserved
UNMODIFIED for provenance; `src/platform/agents/registry.ts` is canonical and
tests assert it is a superset of the kit JSON.

## D-8 — Search Console adapter is read-only — 2026-08-14 (delegated judgment)
Per #23 §8.2/§8.4 (read-only import, read-only OAuth), SearchConsoleAdapter
has no write methods. Sitemaps publish by being served at /sitemap.xml;
any Search Console sitemap submission is an owner/publish-wave action outside
the adapter. Found by Wave 0 adversarial verification.

## D-9 — Wave 0 verification additions — 2026-08-14 (delegated judgment)
Adversarial review (3 reviewers, PASS) surfaced canon gaps, fixed same day:
PageSpec gained `intent_id` and `experiment` {experiment_id, variant} per
#14A §15.2; `SeoDataProvider` registry contract added per #23 §8.1 (credential
env-var NAMES only); SeoMetricSnapshot/SerpSnapshot gained schema_version;
money amounts must be finite; tests added for the PUBLISHED-only-from-QA_PASS
property, IntakeContext schema shape (doors-not-brains), all-flags-off, kit
name parity, and T1 non-graduation.

## D-10 — Geography plan: nationwide vs local with per-type quotas — 2026-08-14 (owner decision)
The admin page-creator control is a GeographyPlan: national on/off with a
pages-per-period quota, plus multiple local entries (state, optional county),
each with its own quota. Selecting a county AUTOMATICALLY expands coverage to
EVERY city in that county (cities share the entry's quota pool) — full local
SEO candidate coverage with zero manual city entry. DOORWAY GUARD: expansion
creates candidates, not pages; scoring, distinctness, A06 QA and the owner
publish gate still decide what exists (#23 §0.2, #14A §15.3). Implemented in
`src/domain/search/geography-plan.ts` + `SeoFactoryPolicy.geography_plan`
(replaces the single geography_scope field of D-3). Local target EXECUTION
(vendor geo mapping + real city index) lands at the local-pages wave; until
then local targets are counted and reported as deferred.

## D-11 — Wave 1 adversarial verification fixes — 2026-08-14 (delegated judgment)
Three-reviewer pass (canon PASS / correctness FAIL with 2 blockers / tests
PASS) — all findings fixed same day: candidates now MERGE with existing
records BEFORE scoring (seed metrics and the owner's rubric prior survive
enrichment); batch processing is score-ordered and only page-worthy records
absorb MERGEs (vendor list order can no longer starve an intent family);
every vendor call records a UsageCostEvent and the budget brake also fires
mid-run; DataForSEO task-level errors raise instead of silently emptying;
metric snapshots persist (provenance chain intact); idempotency periods
derive from the policy cadence; budget-stopped runs do not consume the
idempotency slot; negation-aware keyword matching ("won't turn on" merges
with "not turning on" but stays distinct from "won't turn off"); golden
policy-value tests prevent silent threshold edits.

## D-7 — Existing owner accounts — 2026-08-14 (owner decision)
Use the owner's existing GitHub (Willarme), Vercel and Supabase accounts
rather than creating new ones. All credentials remain owner-held; the coding
agent interacts via authenticated CLIs/integrations only.
