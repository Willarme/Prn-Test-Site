# Owner Decision Log

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

## D-7 — Existing owner accounts — 2026-08-14 (owner decision)
Use the owner's existing GitHub (Willarme), Vercel and Supabase accounts
rather than creating new ones. All credentials remain owner-held; the coding
agent interacts via authenticated CLIs/integrations only.
