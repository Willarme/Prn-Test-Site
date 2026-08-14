# Owner To-Do — things only you can do

Living list (per your instruction). Nothing here blocks local building; items
marked LAUNCH-GATE block public launch only.

## Accounts / credentials

1. **DataForSEO** — create account, fund the $50 minimum, then put the
   credentials into `C:\Users\melis\property-response-network\.env.local` as:
   `DATAFORSEO_LOGIN=...` and `DATAFORSEO_PASSWORD=...` (never in chat).
   Then tell Claude "run the DataForSEO smoke test."
2. **Supabase** — create a NEW project named **PRN Trial Claude** in your
   existing Supabase account (dashboard → New project). Copy the Project URL,
   anon key, and service-role key into `.env.local` as `SUPABASE_URL`,
   `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`. Then tell Claude "wire
   Supabase" — the migration is already written.
3. **GitHub workflow scope** — run in a terminal, approve in browser:
   `gh auth refresh -s workflow`
   (lets Claude push the CI automation file that's ready and waiting).

## Decisions when you have a minute (see OPEN_DECISIONS.md for details)

4. Trial brand/domain name (OD-8) — needed before Search Console + launch.
5. Skim DECISIONS.md D-12 through D-19 — the calls Claude made autonomously
   under your standing approval; flag anything to change.

## LAUNCH-GATE (before any public traffic — not needed yet)

6. Legal counsel review: Terms, Privacy Notice, the intake consent wording
   (currently the #14A §9.2 draft, marked draft in code), and the safety
   response copy (docs: src/domain/problem/safety.ts).
7. Buy the domain; verify it in Google Search Console.
8. OpenAI API key (for real A01/A02 + A05 writer + A06 critic) with spend
   limits, into `.env.local` as `OPENAI_API_KEY`.

## Optional

9. Paste to the planning GPT (verifies decision D-1): "From #20 PRN Canonical
   Agent Registry: paste A16's full registry entry (ID, canonical name,
   mandate, boundaries, build stage). Confirm A16 is 'Trust Network
   Intelligence / coverage' and that the rejected post-job outcome follow-up
   is not assigned to A16 or any other active trial agent."
10. Reattach the original **#15** document before the Trust copy wave.
