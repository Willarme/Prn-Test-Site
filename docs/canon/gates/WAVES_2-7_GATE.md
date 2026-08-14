# Door Waves 2–7 Gate Report — Vertical Slice (fixture-backed)

**Verdict: PASS** · 2026-08-14 · built under the owner's standing approval
(no per-wave stops; decisions logged as D-12..D-20, owner actions in
OWNER_TODO.md)

## What was built
See CHANGELOG.md "Door Waves 2-7". The full customer journey now exists:
door page → shared StartRequestForm → server-side safety gate → versioned
consent → ProblemRecord → Job Packet → results page with three continuation
paths and the Future Feature Lab — all fixture-backed behind the exact
contracts the production A01/A02 will implement. Plus A05 (PageSpec factory)
and A06 (QA gate) with the anti-doorway rules enforced.

## Checks run
| Check | Result |
|---|---|
| ESLint / TypeScript strict | clean |
| Vitest | **171/171 pass** (22 files) |
| Production `next build` | clean, all routes emitted |
| Live browser walkthrough | home → staged door → form → results verified end to end |
| Live safety re-test | wrong consent hash → 409; "smells like gas" → server halt, zero records; normal problem → packet |
| Adversarial verification (3 reviewers) | 2 blockers + 12 findings — ALL fixed same day and re-verified (D-20) |

## The two blockers the reviewers caught (and fixes)
1. **Safety halt was client-side only** — the server still analyzed and
   persisted a packet for a gas emergency. Now the deterministic gate runs in
   the intake API BEFORE analysis; halt-class hazards create no record.
2. **Gas regex missed "smells like gas" / "smelled gas"** — the most common
   real phrasings. Patterns broadened (incl. rotten-egg odor, propane, CO)
   with tests pinning each phrasing; spark-plug false positive excluded.

## Standing guarantees (tested)
- Nothing can publish: no publish runtime exists, /problems is flag-gated
  OFF, findPublishedByPath returns null, robots disallows all, everything is
  noindex. Owner publish approval remains the only path to public pages.
- Doors own zero logic; deleting a door touches no customer record.
- Consent: one versioned disclosure (counsel-draft, verbatim §9.2), owned by
  the shared component, hash-verified server-side at submission.
- Packet honesty: inference labeled, unknowns listed, no guarantees.
- Risky flags (doors/trust/monetization/mcp/sms) pinned OFF by tests.

## Known deferrals (logged)
Real A01/A02/A05-writer/A06-critic model calls await OPENAI_API_KEY;
Supabase swap awaits the "PRN Trial Claude" project; Trust card copy awaits
#15 (OD-11); staging storage is ephemeral on Vercel (honest fallback shown).

**Next waves:** Supabase wiring + DataForSEO live smoke (owner credentials),
then Trust wave (needs #15), provider resolver, Customer Lite.
