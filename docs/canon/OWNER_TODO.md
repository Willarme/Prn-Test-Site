# Owner To-Do — things only you can do

Living list, updated at the end of every session. **⛔ BLOCKING** = the next
build steps cannot proceed without it. **▶ UNBLOCKS** = enables something
already built. Everything else = when convenient.

## ⛔ BLOCKING — real persistence (nothing else in the pipeline is blocked, but
##    the staging site cannot keep data or admin changes without this)

1. **Supabase — create a NEW project named "PRN Trial Claude"** in your existing
   Supabase account (dashboard → New project; any region; save the DB password
   in your password manager). Then paste into
   `C:\Users\melis\property-response-network\.env.local`:
   ```
   SUPABASE_URL=...
   SUPABASE_ANON_KEY=...
   SUPABASE_SERVICE_ROLE_KEY=...
   ```
   Also add the same three in Vercel → prn-trial-claude → Settings → Environment
   Variables (Production + Preview). Then tell Claude **"wire Supabase"** — the
   migration is already written; the file/cookie stopgaps get removed.
   *Why blocking:* until then, staging journeys live in the tester's browser
   only, admin publish/policy changes on staging reset on redeploy, and the
   Requests view is empty on staging.

## ▶ UNBLOCKS features already built

2. **Owner password for Admin** — in Vercel → prn-trial-claude → Settings →
   Environment Variables add `ADMIN_PASSWORD` = a password of 8+ characters
   (Production + Preview), then Redeploy. This turns the Admin dashboard from
   read-only preview into a working owner console (publish pages, change
   page-creator controls). Locally: add the same line to `.env.local`.
3. **DataForSEO** — create account, fund the $50 minimum, put credentials in
   `.env.local` (and Vercel env) as `DATAFORSEO_LOGIN` / `DATAFORSEO_PASSWORD`.
   Then tell Claude **"run the DataForSEO smoke test."** Unblocks live
   autonomous research (today's opportunities are your seed workbook, scored).
4. **GitHub workflow scope** — in a terminal: `gh auth refresh -s workflow`
   (approve in browser). Lets Claude push the CI automation file.

## Decisions when you have a minute

5. Skim `docs/canon/DECISIONS.md` D-12 → D-22 — the calls Claude made under
   your standing approval; flag anything to change.
6. Trial brand/domain name (OD-8) — needed before Search Console + launch.

## LAUNCH-GATE (before any public traffic — not needed yet)

7. Legal counsel review: Terms, Privacy Notice, the intake consent wording
   (currently the #14A §9.2 draft, marked draft in code), and the safety
   response copy (`src/domain/problem/safety.ts`).
8. Buy the domain; verify it in Google Search Console.
9. OpenAI API key (real A01/A02 + A05 writer + A06 critic) with spend limits,
   into `.env.local` as `OPENAI_API_KEY`.

## Optional

10. Paste to the planning GPT (verifies decision D-1): "From #20 PRN Canonical
    Agent Registry: paste A16's full registry entry (ID, canonical name,
    mandate, boundaries, build stage). Confirm A16 is 'Trust Network
    Intelligence / coverage' and that the rejected post-job outcome follow-up
    is not assigned to A16 or any other active trial agent."
11. Reattach the original **#15** document before the Trust copy wave.
