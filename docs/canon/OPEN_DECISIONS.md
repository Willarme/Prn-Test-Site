# Please Edit or Decide — ongoing list

Owner rule (D-4): items here NEVER block a build. Review whenever convenient;
say the item number and your choice. New items get added each session as they
come up, newest first. When decided, entries move to DECISIONS.md.

## Open

- **OD-10 — Autonomy graduation is a process gate, not a machine gate.**
  `autonomy_stage` can be set to T2 by one CLI command; #23 §1.5's "measured
  promotion gate" evidence (20-50 clean QA candidates, defect rates) is not
  yet machine-checked. Acceptable while no publish runtime exists; revisit at
  the A06/publish wave.
- **OD-9 — City dataset for county expansion (D-10).** The fixture city index
  covers Allen County IN + Franklin County OH for tests. Before local pages
  activate, vendor a real places-by-county dataset (recommendation: US Census
  gazetteer) and map DataForSEO location codes for state/county/city targets.
- **OD-8 — Trial brand/domain name.** No production domain is owned yet. The
  repo is `property-response-network`. Needed before Search Console
  verification and launch waves — not before.
- **OD-7 — Founder story on the new site.** The old HTML's About page carries
  a personal founder narrative. Whether (and how much of) that story carries
  into the new build is a brand/content decision. Not needed until public
  pages exist.
- **OD-6 — Results-page card set timing.** Vertical slice shows 4 Future
  Feature Lab cards (DIY, SmartQuote, Tracking, Dashboard); the full Feature
  Lab wave adds Tool Cloud + Big Company Pricing pages. Confirm that timing
  stands when we reach the results shell.
- **OD-5 — min_user_value_score numeric threshold.** #23 requires a PASS but
  gives no number. A06 will compute PASS/FAIL; pick a numeric bar (e.g. 60)
  once we see real A06 scores. Default: null (deterministic + AI QA still
  gate).
- **OD-4 — Risk-class scale confirmation.** Kit defines R0–R6 but never
  states meanings. Proposed mapping is documented in
  `src/platform/capabilities/contracts.ts` (R0 read-public … R6
  irreversible/legal). Confirm or correct whenever.
- **OD-3 — Consent affirmative action.** "By continuing you agree…" (implied
  on continue) vs an explicit checkbox at intake. Old HTML used a checkbox
  (its wording is dead — it promised inspections/pricing we don't offer).
  Decide at the intake-shell wave; counsel review gates final wording either
  way.
- **OD-2 — "Show Me Another" vs "Show Another"** button label, and the exact
  continuation-choice labels ("I already have someone" variants). Resolve
  with #15 reattached at the Trust/results waves.
- **OD-1 — Optional #20 verification of D-1 (A16).** Paste to the GPT that
  holds the File Library: "From #20 PRN Canonical Agent Registry: paste A16's
  full registry entry (ID, canonical name, mandate, boundaries, build stage).
  Confirm A16 is 'Trust Network Intelligence / coverage' and that the rejected
  post-job outcome follow-up is not assigned to A16 or any other active trial
  agent."

## To do when reached (standing reminders, not decisions)

- Reattach original **#15** before the Trust copy wave (approved wording must
  come from the source doc, never reconstructed).
- Legal counsel review of Terms/Privacy/consent/safety copy before production
  traffic (#14A §9.2) — production stays gated otherwise.
- Verify #23's model IDs and every vendor price against live vendor docs when
  each integration lands (D-5).
