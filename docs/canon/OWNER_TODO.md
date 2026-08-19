# Owner To-Do — things only you can do

Living list, refreshed at the end of every session.
**⛔ BLOCKING** = something already built cannot work until you do this.
Everything else = when convenient.

---

## ⛔ BLOCKING — 2 environment variables in Vercel (about 2 minutes)

The database is live and working **locally**, but the staging website still has
no database credentials, so anything you do at prn-trial-claude.vercel.app is
still temporary.

Go to **https://vercel.com/soul-tech-team/prn-trial-claude/settings/environment-variables**
and add these two (values are in your local `.env.local` — copy them from
there, or from Supabase → API Keys):

| Key | Value |
|---|---|
| `SUPABASE_URL` | `https://qupgsflrufpysxcyulro.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | the `sb_secret_…` key (mark it **Sensitive** if offered) |

Leave all environment checkboxes ticked. Then tell Claude — a redeploy picks
them up and staging starts keeping data like your local copy does.

*(`ADMIN_PASSWORD` is already set — thank you.)*

---

## ▶ Worth doing soon

1. **Verify the DataForSEO account** — the yellow banner on their dashboard.
   Credentials work and a live test already returned real data, but some
   endpoints stay rate-limited to zero until the account is verified.
2. **Add funds to DataForSEO only when you want volume.** The $1 credit is
   proven working (a live test cost $0.10). The monthly cap in your admin
   controls is set to **$1** so nothing can quietly drain it — raise it from
   the dashboard whenever you top up.
3. **GitHub workflow scope** — in a terminal: `gh auth refresh -s workflow`
   (approve in browser). Lets Claude push the CI automation file.

## Decisions when you have a minute

4. Skim `docs/canon/DECISIONS.md` D-12 → D-23 — calls Claude made under your
   standing approval. Flag anything to change.
5. Trial brand/domain name (OD-8) — needed before Search Console + launch.
6. Obsidian agent-memory vaults (OD-12) — decided direction, not yet built.

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

---

## Handy commands (you can run these any time)

```
cd C:\Users\melis\property-response-network
npm run db:migrate -- --status   what database changes are applied
npm run smoke:seo                live DataForSEO check (costs about $0.10)
npm run factory                  re-run research -> pages -> QA
npm run policy                   show the page-creator controls
```
Double-click `tools\set-keys.cmd` any time to fill in a missing key.
