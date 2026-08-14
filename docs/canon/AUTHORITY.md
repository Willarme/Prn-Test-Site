# Document Authority & Precedence

Read before changing any code. Conflicts are NEVER resolved silently — they
become Owner Decision items in [DECISIONS.md](DECISIONS.md) or
[OPEN_DECISIONS.md](OPEN_DECISIONS.md).

## Precedence order

1. **#14A Revision D** — Black Car Trial Build-Ready Guide. Controls what is
   LIVE, TEST-ONLY and DEFERRED. Wins on trial scope.
2. **#23 Rev A** — Autonomous SEO + Costs + Self-Funding Economics. Patches
   #14A **§15.1 Step 1 only** (SEO vendor adapter is BUILD NOW, not CSV-first).
   Its economics/autonomy material is additive; it never weakens #14A's
   quality, privacy, staging, approval or anti-cannibalization gates.
3. **#22A** — AI-Native Trial Foundation. Controls HOW the approved scope is
   built (typed capabilities, provenance, rights, ActionRequest/idempotency,
   API/MCP compatibility).
4. **#15** — Trust Network & Referral-First Fulfillment. Controls Trust copy,
   psychology and behavior unless #14A explicitly changes a mechanic.
   **Reattach the original document before the Trust copy wave.**
5. **#20** — Canonical Agent Registry. Controls agent IDs, names, boundaries.
6. **#17 and #22** — permanent architecture/context. Never activate future
   features.
7. **`property-response-v2 (2).html`** — VISUAL REFERENCE ONLY. Reproduce the
   design language; never its demo logic, status machine, ratings, claims,
   pricing/fee model or guarantees.
8. **Revision D Build Kit** (`docs/canon/build-kit/`) — machine-readable
   implementation contracts. Newer #14A/#23 decisions win over the kit.

Source bundle on the owner's machine:
`C:\Users\melis\Desktop\PRN Biz Files\8_14_26 Version for Initial Trial Coding\Startup trial bundle\`
Originals of #22A/#15/#20/#22/#17 live in the owner's ChatGPT File Library;
their binding extracts are in that bundle's `CANONICAL_AUTHORITY_NOTES.md`.

## The one architecture rule (canon, owner-approved)

> Never put A01/A02 business logic inside an IntentPage, PageSpec, React page
> component, or SEO-generation prompt. Intent pages may render the shared
> intake UI, but all problem analysis, clarification, record mutation and
> packet generation must occur through canonical server/domain capabilities.
> A generated SEO page must be deletable tomorrow without affecting a single
> customer's ProblemRecord or the intake engine.

## Build method

One repository. One canonical database. One shared capability layer called
identically by UI, API, MCP and agents. Whole-project context first; then ONE
gated wave at a time — lint/typecheck/tests, migration safety, preview deploy
where applicable, CHANGELOG + gate report, PASS/FAIL, STOP.

## Secrets

Names only in `.env.example`. Real values in `.env.local` (gitignored) and
provider dashboards. Never in chat, code, logs, PageSpecs or admin UI. Rotate
any key that leaks. Every account is company/founder-owned (sale-readiness).
