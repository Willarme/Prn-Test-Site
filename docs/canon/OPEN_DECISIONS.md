# Please Edit or Decide — ongoing list

Owner rule (D-4): items here NEVER block a build. Review whenever convenient;
say the item number and your choice. New items get added each session as they
come up, newest first. When decided, entries move to DECISIONS.md.

## Open

- **OD-18 — Does the Job Packet show a homeowner a CONFIDENCE LEVEL at all, and
  in what words?** (Melissa.) The packet today renders `inference · medium
  confidence` next to the likely service category, because the frozen contract
  has always carried a three-level enum and the page has always drawn it. That
  was never a decision — it is what the fixture engine happened to produce in
  Wave 0. Whether "MEDIUM CONFIDENCE" about a problem in someone's own house
  reassures them or alarms them is homeowner psychology, and it rides with the
  packet review already on your list (Owner To-Do item 1 / Master Todo T0-01).
  A02's build changed NOTHING here on purpose: same enum, same rendering, same
  words. Recorded because the Compendium lists it open (17.13/17.14) and the A02
  spec does not carry it at all.
- **OD-17 — What is the relationship between [[Work Compiler]] / [[Canonical
  Work Object]] and the Job Packet?** Two canon documents describe objects that
  sound like the packet under different names, and the Compendium records
  (lines 197/199) that their relationship to A02 is stated nowhere, and that
  neither may ever become a public synonym for "Job Packet". Nothing in the
  trial is blocked: A02 builds `JobPacket`, the customer-facing name is Job
  Packet, and no other name appears on any surface. But the collision needs a
  ruling before any later agent starts producing a second work object beside the
  packet — the cost of finding out afterwards is two vocabularies for one thing.
- **OD-16 — The approval cadence for agent specs after A00.** (Master Todo
  T0-18, Josh's queue.) A01 and A02 were both built "approved with conditions"
  off audit documents rather than a signed-off spec, and that has worked — but
  it is a process nobody has actually ratified, and it governs whether the
  remaining agents may be approved the same way. Raised here because the A02
  audit named it as a governing open decision rather than a build detail.
- **OD-15 — Turning A06's AI critic on.** A06 ships with the critic INTERFACE
  and no critic: `seo.critique_page` is deliberately not in the capability
  registry, so `ai_critic.status` reads `SKIPPED_NO_MODEL` on every page and
  nothing has read any page for meaning. That is honest, and it is also why the
  owner's publish queue shows `BLOCKED_PENDING_AI` rather than a green PASS.
  Turning it on takes three deliberate things, in order: (1) which model, and
  what it may cost per page — every PRN dollar is a TEST figure; (2) a
  capability entry for `seo.critique_page` with a risk class and required
  scopes; (3) an executor behind it. The gateway is the only permitted route, so
  none of this can happen by accident. Not urgent: `release_eligible` does not
  depend on the critic, because a human publishes every page.
- **OD-14 — Who may waive an A06 hard blocker, and on what evidence.** Canon
  says A06 cannot waive its own blockers, and A06's build deliberately built NO
  waiver mechanism (Loop Spec Audit pre-answer 8: "Build no waiver mechanism").
  So today a hard blocker has no lift anywhere in the codebase: the page is
  refused until the defect is repaired. The Approval Center is the obvious
  future home for an override, but nothing has specced who may grant one or what
  evidence it needs, and an invented override is a hole in the one gate
  protecting the public site. **The honest consequence, recorded rather than
  papered over: A06's false-block-rate KPI is UNCOMPUTABLE, not zero** — with no
  override event there is no way to count the blocks a human would have lifted.
  Related: OD-10 said to revisit autonomy graduation "at the A06/publish wave";
  A06's build did not move it — `publish_mode` stays `OWNER_APPROVAL`,
  `human_approval_required` stays true, and `release_eligible` now fails closed
  automatically if either changes.
- **OD-13 — Guided-diagnosis economics need sourced prices.** The owner wants
  the walkthrough to end in a decision frame (rent a tester vs. paid diagnostic
  visit vs. buy the cheap part on a gamble) with dollar figures. Canon forbids
  invented prices/local claims, so v1 frames the decision with placeholders
  ("[local estimate]") and a FactBundle hook; real figures arrive when a sourced
  price registry exists (vendor/retailer APIs or owner-entered ranges with
  provenance). Owner may accept "typical range" language with a source note.
- **OD-12 — Obsidian agent-memory vaults.** Direction agreed (one vault rooted
  at docs/canon, one folder per agent, wiki-linked; Supabase stays system of
  record). Build at the Admin/agents wave.

- **OD-11 — Trust-adjacent card copy pending #15.** The results page's "Ask
  My People" / "Find someone for me" card bodies use deliberately
  descriptive-neutral wording. When #15 is reattached, replace with the
  approved Trust wording (buttons: OD-2).
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
