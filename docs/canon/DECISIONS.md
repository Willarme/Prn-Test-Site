# Owner Decision Log

## Autonomous-run decisions (2026-08-14, standing owner approval)
The owner authorized continuing without per-wave stops and asked for a list
of calls made in her absence. D-12 through D-19 are those calls — review and
overturn freely; each is built to be cheap to change.

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
