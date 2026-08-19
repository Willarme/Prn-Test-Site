# Owner To-Do — things only you can do

Living list, refreshed at the end of every session.
**⛔ BLOCKING** = the next build steps cannot proceed until you do this.
**🧪 TEST & REVIEW** = things only you can judge (look, try, give edits).
Everything else = when convenient.

---

## ⛔ BLOCKING — nothing right now

The live site keeps data, the admin is locked behind your password, the
engine research works, photos store privately. You are unblocked to test.

---

## 🧪 TEST & REVIEW (your eyes needed — not blocking the engine work)

1. **Try the full intake on the live site** — go to
   https://prn-trial-claude.vercel.app/start, type a problem the way a
   customer would (e.g. *"my Carrier AC is 8 years old and blowing warm air
   since yesterday"*), then:
   - check the green checks it awards from your sentence,
   - try the photo button on your phone (model label, thermostat),
   - walk the guided diagnosis to an outcome,
   - open "View my Job Packet" and **review the packet itself** — is this
     what a technician wants? What's missing, what's noise, what reads
     wrong? Write notes; we'll iterate on the packet template.
   *(blocks: high-quality PDF packets — the core product. Not blocking the
   page engine.)*
2. **Print / Save as PDF** from the packet page and review the printed
   layout — this is the artifact customers will forward to providers.
3. **Template + skin review** — open each staged door page from the home
   page (7 so far) and the sample
   https://prn-trial-claude.vercel.app/staged/ac-not-turning-on. Give edits
   on layout, wording, colors, what the "one excellent page" should feel like.
   *(⛔ blocks: generating pages at volume. NOT blocking testing with a few
   pages or the engine/packet work.)*
4. **Sign in to Admin** at https://prn-trial-claude.vercel.app/admin with
   your owner password — try Pages → preview → Approve & publish, and the
   Page-creator controls (national vs local, county → all cities). Tell me
   what's confusing.

## ▶ Worth doing soon

5. **Verify the DataForSEO account** (yellow banner on their dashboard) —
   some endpoints stay rate-limited to zero until verified.
6. **Add DataForSEO funds only when you want volume.** Live test on the $1
   credit works (cost $0.10). Monthly cap in admin controls is $1; raise it
   when you top up.
7. **GitHub workflow scope** — in a terminal: `gh auth refresh -s workflow`
   (approve in browser). Lets Claude push the CI automation file.

## Decisions when you have a minute

8. Skim `docs/canon/DECISIONS.md` D-12 → D-24 — calls Claude made under your
   standing approval. Flag anything to change.
9. **OD-13 pricing in the guided diagnosis** — the walkthrough ends in a
   decision frame (rent a tester vs. diagnostic visit vs. gamble on a cheap
   part) but with NO dollar amounts, because canon forbids invented prices.
   Decide: accept "typical range" wording with a source note, or wait for a
   sourced price registry.
10. Trial brand/domain name (OD-8) — needed before Search Console + launch.
11. Obsidian agent-memory vaults (OD-12) — direction agreed, build later.

## LAUNCH-GATE (before any public traffic — not needed yet)

12. Legal counsel review: Terms, Privacy Notice, the intake consent wording
    (currently the #14A §9.2 draft), and the safety response copy
    (`src/domain/problem/safety.ts` and the playbook safety notes).
13. Buy the domain; verify it in Google Search Console.
14. OpenAI API key (real A01/A02 + A05 writer + A06 critic + photo reading)
    with spend limits, into `.env.local` as `OPENAI_API_KEY`.

## Optional

15. Paste to the planning GPT (verifies decision D-1): "From #20 PRN Canonical
    Agent Registry: paste A16's full registry entry (ID, canonical name,
    mandate, boundaries, build stage). Confirm A16 is 'Trust Network
    Intelligence / coverage' and that the rejected post-job outcome follow-up
    is not assigned to A16 or any other active trial agent."
16. Reattach the original **#15** document before the Trust copy wave.

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
