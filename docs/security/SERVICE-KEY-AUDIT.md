# Service-key audit — T1-33 (request-scoped RLS seam)

**Historical scope, reviewed for source delivery on 2026-09-06.** This note
records T1-33's isolated implementation checks. Its environment observations
describe that audit session, not current hosted configuration. The delivery
does not verify live Supabase authentication, applied migrations or production
authorization; those require evidence from the authorized target environment.

Condition 1 of the 2026-08-28 A01/A02 approval, carrying forward A00's own
approval condition (d). Every Supabase client construction and every
service-key call site in the repo, enumerated, classified, and — for the
customer-facing paths — moved to a request-scoped client so Postgres RLS
enforces the boundary instead of application code. This file travels with
the code (not the vault) per the approval's own requirement.

Request records still require isolation without homeowner account login.
Anonymous requests and capability links can belong to different people, so
absence of an account system cannot establish zero exposure risk. This item
builds the request-scoped seam and default path; the checks below state what
was actually tested and what remains unverified.

**Reads and writes are both in scope.** The item's done-when reads "is the
default path for customer-facing reads and writes" — an earlier pass of
this item moved reads only (orchestrator-relayed "reads first" scoping that
was never recorded in the item text itself); a later pass closed the write
half so the document matches what the item actually requires.

**Revision history, honestly.** This is the third pass at this document.
An adversarial inspection of the second pass REFUTED it as done on two
grounds, both addressed in this revision: (1) the isolation test suite
never exercised `SupabaseRuntimeStore`'s own code — it re-simulated RLS
scoping with raw SQL and would not have caught a regression in
`scopedClient()` itself (proven: the inspector mutated it to unconditionally
`return this.db` and the entire 230-test gauntlet stayed green) — closed by
`tests/rls-wire-level.test.ts` (§7); (2) the enumeration in §3 missed
`listJourneys` and `listAudit` — closed by a fresh, literal grep sweep
(§3's count note explains exactly what was re-checked and how).

## 1. Every Supabase client construction (before this item)

Before this item, three files each called `createClient(...)` directly with
`SUPABASE_SERVICE_ROLE_KEY`, independently:

| File | Purpose |
|---|---|
| `src/platform/stores/runtime.ts` (`function client()`) | Customer journeys, events, publish state, admin audit |
| `src/platform/stores/policy-supabase.ts` | SEO-factory policy config |
| `src/platform/adapters/media-storage.ts` | Private evidence photo/video bucket |

All three now construct their client through the ONE new seam,
`src/platform/db/client.ts` (`serviceClient()` / `requireServiceClient()` for
the elevated client, `requestScopedClient(requestId)` for the new
request-scoped one) — see §4. There is one client-construction module, not
several independent ones.

## 2. Every table's RLS state (from the migrations, before this item)

Every table in every migration ships `enable row level security` with **no
policy** and **no grant to `anon`/`authenticated`** — deny-all by design
(00001 header comment: *"RLS: enabled on every table with NO policies ->
anon/authenticated roles get nothing, only the server-side service role
reads/writes."*; 00002 header: *"Customer-scoped policies arrive with the
Customer Lite wave."* — this item is that wave). `00003` is defense-in-depth
on top of that: it explicitly revokes all table/sequence privileges from
`anon`/`authenticated` project-wide, so even a stray `GRANT` elsewhere would
need a matching explicit re-grant to do anything.

So: RLS enabled + no policy + no grant, on every one of the 25 tables, with
zero exceptions, prior to migration 00006 (this item).

## 3. Call-site enumeration

**S = customer-facing (serves a request a homeowner made, reads/writes rows
that belong to one). I = internal (admin surface, background job, shared/
global content, no per-homeowner ownership question).**

`✓ moved (read)` / `✓ moved (write)` = now defaults to
`requestScopedClient()`, falling back to the service client only when
`SUPABASE_ANON_KEY`/`SUPABASE_JWT_SECRET` are not yet configured (today's
deploy). `service key (justified)` = stays on the service role, with the
one-line reason in the last column.

| # | File:line | Table(s) | Class | Status | Justification |
|---|---|---|---|---|---|
| 1 | `runtime.ts:125` `recordJourney` insert | `evidence_object` | S | **✓ moved (write)** | `scopedClient(session.request_id)` — WITH CHECK (migration 00006 §4) blocks creating a row under any other request_id |
| 2 | `runtime.ts:138` `recordJourney` insert | `problem_record` | S | **✓ moved (write)** | Same `scopedClient(session.request_id)` |
| 3 | `runtime.ts:161` `recordJourney` insert | `job_packet` | S | **✓ moved (write)** | Same |
| 4 | `runtime.ts:176` `recordJourney` insert | `consent_event` | S | **✓ moved (write)** | Same. `consent_event` gets an INSERT-only policy — 00004 already revokes UPDATE/DELETE from every role including service_role (append-only ledger), and this item does not add a READ policy for it (see §5) |
| 5 | `runtime.ts:194` `recordJourney` insert | `intake_session` | S | **✓ moved (write)** | Same. This is the FIRST write of a brand-new journey — the row doesn't exist yet anywhere, so WITH CHECK (which only inspects the row being written) works even at creation time, no chicken-and-egg problem |
| 6 | `runtime.ts:222` `ensureDisclosure` upsert | `disclosure_version` | I | service key (justified) | **Previously omitted from this audit — added now.** The disclosure TEXT itself: one shared, versioned document shown to every customer, not owned by any one homeowner. No per-subject ownership question |
| 7 | `runtime.ts:231` `recordEvents` insert | `event_envelope` | S (write, telemetry) | service key (justified) | Telemetry insert only; the table is never read back on any customer-facing path (only the admin dashboard's `countEvents` reads it, which is I — an aggregate across all subjects by definition, cannot be request-scoped). Operational instrumentation about the customer's actions, not the customer's own data the way a job packet is |
| 8 | `runtime.ts:254` `getJourney` select ×3 | `intake_session`, `problem_record`, `job_packet` | S | **✓ moved (read)** | `scopedClient(requestId)`. The crown-jewel read — the whole Job Packet served at `/results/[request_id]` |
| 9 | `runtime.ts:289`/`297`/`306` `listJourneys` select ×3 | `intake_session`, `problem_record`, `job_packet` | I | service key (justified) | **Missed in the prior two passes — added now (adversarial-inspection finding #2).** Admin "Requests" list (`src/app/admin/requests/page.tsx:12`, behind `adminGate()`) — lists EVERY journey across every subject by design (`.order("entered_at").limit(limit)`, no per-request filter at all); this is inherently a cross-subject aggregate, the same shape as `totals`/`listAudit`, and cannot be request-scoped without contradicting its own purpose |
| 10 | `runtime.ts:324` `countEvents` select | `event_envelope` | I | service key (justified) | Admin dashboard's safety-trigger count (`src/app/admin/page.tsx:36`, behind `adminGate()`) — an aggregate count across ALL subjects for one `event_name`, not a per-homeowner row |
| 11 | `runtime.ts:332` `totals` count | `intake_session`/`job_packet`/`consent_event` | I | service key (justified) | Admin dashboard aggregate count across ALL subjects — gated behind `adminGate()` |
| 12 | `runtime.ts:343` `getPublishedPageIds` select | `published_page` | I | service key (justified) | Owner-published page routing table; no homeowner-owned rows |
| 13 | `runtime.ts:352`/`363` `setPublished` | `published_page` | I | service key (justified) | Owner publish action, gated behind `adminGate()` (`/api/admin/pages/publish`) |
| 14 | `runtime.ts:370` `listStagedSpecs` select | `staged_page_spec` | I | service key (justified) | SEO factory staging content, not homeowner data |
| 15 | `runtime.ts:376` `appendAudit` insert | `admin_audit` | I | service key (justified) | Owner audit trail write |
| 16 | `runtime.ts:380` `listAudit` select | `admin_audit` | I | service key (justified) | **Missed in the prior two passes — added now.** Admin "Requests" page's audit trail panel (`src/app/admin/requests/page.tsx:12`, behind `adminGate()`) — the owner's own action log across the whole product, not a per-homeowner row |
| 17 | `runtime.ts:389` `attachEvidence` insert + update | `evidence_object`, `problem_record` | S | **✓ moved (write)** | `scopedClient(requestId)` for both the evidence insert AND the `problem_record.evidence_ids` update (migration 00006's UPDATE policy: USING + WITH CHECK, both scoped to the caller's own request_id) |
| 18 | `runtime.ts:425`/`431` `saveIntakeAnswers` insert | `intake_answer` | S | **✓ moved (write)** | `scopedClient(answers[0].request_id)` — every answer in one call always belongs to one request (verified both call sites) |
| 19 | `runtime.ts:444` `saveDiagnosisAnswer` insert | `diagnosis_answer` | S | **✓ moved (write)** | `scopedClient(answer.request_id)` |
| 20 | `runtime.ts:434` `listIntakeAnswers` select | `intake_answer` | S | **✓ moved (read)** | `scopedClient(requestId)`; backs the "have" checkmarks on `/complete/[request_id]` |
| 21 | `runtime.ts:451` `listDiagnosisAnswers` select | `diagnosis_answer` | S | **✓ moved (read)** | `scopedClient(requestId)`; backs the walkthrough resume state on `/complete/[request_id]` |
| 22 | `runtime.ts:461`/`470` `listEvidence` selects ×2 | `problem_record` (evidence_ids), `evidence_object` | S | **✓ moved (read)** | `scopedClient(requestId)` when a `requestId` is supplied (it always is — the one caller, `loadJourneyContext`, has it) |
| 23 | `runtime.ts:475` `savePacket` insert | `job_packet` | S | **✓ moved (write)** | `scopedClient(requestId)`, threaded from the caller (`regeneratePacket`) |
| 24 | `policy-supabase.ts:24`/`37` `getActive`/`save` | `seo_factory_policy` | I | service key (justified) | Owner's SEO-factory config, not a per-homeowner row — there is no "which subject owns this row" question |
| 25 | `media-storage.ts:52/54/68/78` bucket ops | Supabase Storage (`private-evidence` bucket) | S (write path only; `signedUrl` unused) | service key (justified) | Distinct RLS surface (`storage.objects` policies, not this migration's public-schema tables); `signedUrl()` has zero callers in the app today (grepped) — no live customer-facing read exists here to move. Flagged as an open follow-up, not silently dropped (see §5) |

**Count: 26 service-key call sites found. This is the third pass over this
enumeration: the first found 22, the second added 1 previously-omitted row
(`ensureDisclosure`/row 6), and an adversarial inspector's finding #2 caught
2 more missed clusters (`listJourneys`/row 9, `listAudit`/row 16) that a
fresh, literal-multiline-aware grep of every `this.db` usage in
`runtime.ts` (`grep -n "this\.db\b"`, catching chained calls like
`await this.db\n.from(...)` that a same-line-only pattern misses) plus a
fresh repo-wide sweep for `createClient`/`SUPABASE_SERVICE_ROLE_KEY`/
`@supabase/supabase-js` (confirming no file outside the 4 already known —
`client.ts`, `runtime.ts`, `policy-supabase.ts`, `media-storage.ts` —
constructs a client) now confirms is exhaustive. 9 read call sites moved to
the request-scoped client by default (rows 8, 20, 21, 22 — covering all 6
read-scoped tables). 9 write call sites moved (rows 1–5, 17, 18, 19, 23 —
covering all 7 write-scoped tables: `intake_session`, `problem_record`,
`job_packet`, `evidence_object`, `intake_answer`, `diagnosis_answer`,
`consent_event`). 11 remain on the service key, each justified above — all
internal/shared-content/telemetry/admin-aggregate (rows 6, 7, 9–16, 24) plus
the Storage bucket surface (row 25). Every customer-facing table and every
customer-facing call site this enumeration found is now on the
request-scoped client for BOTH reads and writes; no customer-facing write
remains deferred.**

## 4. What moved (S2)

`src/platform/db/client.ts` (new) is the one seam:

- `serviceClient()` / `requireServiceClient()` — the pre-existing elevated
  client, now constructed in one place instead of three.
- `requestScopedClient(requestId)` — NEW. Mints a short-lived HS256 JWT
  (`{ role: "authenticated", aud: "authenticated", request_id, exp }`)
  signed with `SUPABASE_JWT_SECRET`, and returns a Supabase client
  authenticated with `SUPABASE_ANON_KEY` carrying that JWT. Returns `null`
  (callers fall back to the service client) until both env vars are set —
  so a deploy that hasn't added them yet keeps working exactly as today.
  The SAME function backs both reads and writes — there is one
  request-scoped client type, not a separate one per operation.

There is no homeowner login, so "request-scoped" is scoped to the identity
that already exists: the crypto-random `request_id` itself (#14A / D-23:
*"unguessable capability URL by design"*). The server mints the JWT only
after the caller already presented that exact `request_id` (it's the same
value the route handler is already processing) — the JWT does not grant
anything the URL didn't already gate. What it changes: enforcement moves
from "every query remembers its WHERE clause" (app-level; the service role
bypasses RLS entirely, so one missed filter is a full cross-subject leak, or
a missing ownership check on a write is a full forgery) to "the database
refuses the row regardless of what query the application code issues." A
real homeowner login later reuses this exact seam — add an owner-id
claim/column alongside `request_id` — not a second client type.

`src/platform/stores/runtime.ts`'s `scopedClient(requestId)` (renamed from
`readClient` in this revision, since it now backs writes too) is what every
customer-facing method calls instead of the elevated `this.db`.

`supabase/migrations/00019_request_scoped_read_seam.sql` (new, **NOT
applied** — see §6):

1. Denormalizes `request_id` onto `problem_record`, `job_packet`,
   `evidence_object`, and (this revision) `consent_event` (backfilled via
   their existing join paths; `intake_session`, `intake_answer`,
   `diagnosis_answer` already had it). `evidence_object` previously had **no
   column at all** linking it to a request or a problem — only
   `problem_record.evidence_ids` (a `text[]`, not a foreign key) — so this
   is a real, if minor, schema gap closed here.
2. Grants `SELECT`+`INSERT` to `authenticated` on the six read/write tables,
   `INSERT`-only on `consent_event` (append-only), and `UPDATE`
   additionally on `problem_record` (the one place an existing write path —
   `attachEvidence`'s evidence_ids merge — updates a row in place). Never
   `DELETE` anywhere.
3. Adds a `SELECT` policy (USING) on each of the six read tables, an
   `INSERT` policy (WITH CHECK) on each of the seven write tables, and an
   `UPDATE` policy (USING + WITH CHECK) on `problem_record` — all scoped to
   `request_id = (auth.jwt() ->> 'request_id')`, the same `auth.jwt()` idiom
   Supabase's own RLS docs use. WITH CHECK is the write-forgery guarantee:
   it inspects the ROW BEING WRITTEN, so a caller authenticated as one
   request_id cannot create (or, via UPDATE, leave behind) a row stamped
   with a different one — regardless of what the application code's insert
   payload says.

## 5. Open items

- **Evidence Storage bucket reads** (`media-storage.ts` `signedUrl()`) —
  unused by any live route today (no caller found by grep across `src/`).
  When a route starts serving photos back to a customer, it needs its own
  `storage.objects` RLS policy (a separate Supabase surface from the public
  schema tables this migration covers) before that route ships, not after.
- **`consent_event` read policy** — still not added (row 4 in §3). It is
  the append-only legal/consent ledger, never read back per-request today;
  revisit if a future feature needs a homeowner-facing consent history view.
  (Its WRITE is now request-scoped, closing the forgery risk; the read side
  was never customer-facing to begin with, so this is unchanged from the
  original pass.)
- **`event_envelope` / telemetry** — intentionally stays fully on the
  service key (row 7). It's operational instrumentation, not the
  homeowner's own data, and the admin-only read that touches it
  (`countEvents`) is inherently a cross-subject aggregate.

## 6. Migration status and activation checklist — READ BEFORE ASSUMING THIS IS LIVE

**This item builds the seam. It does not turn it on.** As of this commit,
today's actual deploy has NEITHER of the two env vars the seam needs —
`SUPABASE_ANON_KEY` and `SUPABASE_JWT_SECRET` are unset in production — so
`requestScopedClient()` returns `null` on every call and `scopedClient()`
falls back to the service client for every single read and write, exactly
as before this item. **Production runs entirely on the service role today,
unconditionally, until someone deliberately completes the steps below.**
This is a real, load-bearing deployment precondition, not a footnote — that
is why it is broken out as a checklist here rather than folded into prose.

1. [ ] Apply `supabase/migrations/00019_request_scoped_read_seam.sql` —
   `npm run db:migrate`, requires `SUPABASE_DB_PASSWORD` in `.env.local`.
   Written and verified against a real Postgres engine (§7) but **NOT
   applied to the live database** by this commit — this repo's own
   convention (`tools/db-migrate.ts`, and A00's identical note for its own
   unapplied migrations 00006–00008 on that branch).
2. [ ] Set `SUPABASE_ANON_KEY` in the deploy environment (Supabase Project
   Settings > API > anon/public key — already documented as a name-only
   placeholder in `.env.example`, never committed with a real value).
3. [ ] Set `SUPABASE_JWT_SECRET` in the deploy environment (Supabase
   Project Settings > API > JWT Secret — same rule, name only in
   `.env.example`).
4. [ ] Only once ALL THREE of the above are true does
   `requestScopedConfigured()` / `requestScopedClient()` start returning a
   real client instead of `null`, and only then do the moved reads/writes
   in §3 actually run through Postgres RLS instead of the service role.
   Verify post-deploy by checking that `/results/[request_id]` still
   resolves correctly for a live request (functional smoke test) — there is
   no user-visible signal that the seam engaged versus fell back, by
   design (fail-soft), so this must be checked deliberately, not assumed.

Step 1 alone is inert without steps 2–3 (no code path is reachable through
it yet). Steps 2–3 alone are inert without step 1 (the tables/policies the
client would query don't exist yet). All three matter together.

## 7. What the isolation test does and does not prove

`tests/rls-isolation.test.ts` runs the actual migration SQL (00002, 00005,
00006 — unmodified) against `@electric-sql/pglite`, a real Postgres engine
compiled to WASM (not a JS reimplementation — RLS is enforced by the
genuine Postgres planner). Two halves:

**Read isolation** (unchanged from the first pass):
- A request-scoped session for one subject reads only that subject's rows,
  across all 6 read-scoped tables, with **no WHERE clause in the test's own
  queries** — isolation comes entirely from the policy, not from the test
  re-filtering.
- Falsified: stripping the real `CREATE POLICY` (read) statements from the
  real migration file took the read-isolation checks RED; restoring them
  brought the suite back to GREEN (both runs quoted in the T1-33 report).
- A permanent regression pair stays in the suite: one test disables RLS at
  the table level and asserts the leak DOES happen.
- A session with no valid claim sees zero rows (fails closed). The `anon`
  role (no GRANT at all) is refused outright, independent of RLS.

**Write isolation** (new in this revision):
- A request-scoped session CAN insert/update a row stamped with its OWN
  request_id, across all 7 write-scoped tables (positive control — proves
  the grants/policies don't just block everything).
- A request-scoped session CANNOT insert a row claiming another subject's
  request_id — Postgres raises `new row violates row-level security policy`
  — across all 7 write-scoped tables (the write-forgery guarantee).
- A request-scoped session cannot UPDATE another subject's `problem_record`
  row at all (0 rows affected, not an error — USING excludes it from the
  update's candidate set), and cannot reassign its OWN row to another
  subject's request_id (WITH CHECK rejects that specific attempt).
- Falsified: stripping the real `CREATE POLICY` (write) statements from the
  real migration file took 9 of 30 tests RED — both the positive-control
  inserts (deny-all without a policy, same failure mode as the read side)
  and the "cannot reassign to another subject" check (which expects a THROW
  but instead silently affects 0 rows without any policy at all, since
  USING defaults to deny-all too) — restoring them brought the suite back
  to 30/30 GREEN (both runs quoted in the T1-33 report).
- A permanent regression pair stays in the suite: with RLS disabled at the
  table level, a forged insert (mismatched request_id) succeeds and is
  observed landing under the wrong subject's request_id; re-enabling RLS
  blocks it again.

**Wire-level guard, `tests/rls-wire-level.test.ts`** (new — closes
adversarial-inspection finding #1): everything above proves the POLICY SQL
is correct by driving pglite directly; it never calls
`SupabaseRuntimeStore` or `scopedClient()`, so it could not catch (and did
not catch) a regression in the application code itself. This file mocks
ONLY the seam module (`@/platform/db/client`) — not the whole
`@supabase/supabase-js` SDK, and not `runtime.ts` — so `SupabaseRuntimeStore`'s
real, unmodified methods run for real, including `scopedClient()`'s own
dispatch logic. The mock hands back a fake `SupabaseClient` whose
`.from(table)` chain translates to SQL run against the same pglite engine,
inside a transaction with the role/claims the real
`requestScopedClient()`/`requireServiceClient()` would produce.
- Seeds two subjects THROUGH the real `store.recordJourney()` (not raw
  SQL), then asserts `store.getJourney()` and `store.listEvidence()` return
  correct data for their own subject (sanity — the wire-up genuinely works
  end to end, not just "doesn't throw").
- The money tests: `store.listEvidence(bobsProblemId, alicesRequestId)` and
  `store.attachEvidence(bobsProblemId, alicesRequestId, evidence)` — a
  caller with the RIGHT request_id (authenticates as itself) but the WRONG
  problem_id (an app bug, a stale reference, an IDOR attempt). These are
  the only two customer-facing store methods whose signature can even
  produce that mismatch; every other method takes one identifier and always
  authenticates-as and queries-for the same subject, so it cannot expose
  this class of regression through legitimate arguments alone.
- Falsified with the EXACT mutation the adversarial inspector used:
  `scopedClient()` edited to unconditionally `return this.db;`. RED: the
  two sanity tests still passed (service-role can see its own data too,
  same as before), but both money tests failed for real —
  `listEvidence(bobsProblemId, aliceRequestId)` returned bob's actual
  evidence row (`content: "bob's private description"`), and
  `attachEvidence(bobsProblemId, aliceRequestId, ...)` genuinely wrote
  `'ev_forged_by_alice'` into bob's `problem_record.evidence_ids` (quoted
  in full in the T1-33 report). Restoring `scopedClient()` brought all 4
  tests back to GREEN.
- What this does NOT prove: it mocks `@supabase/supabase-js`'s transport
  layer entirely (a hand-built `.from()` chain translator), so it does not
  exercise the real SDK's HTTP/query-building code, only `runtime.ts`'s own
  logic on top of it. Combined with `rls-isolation.test.ts` (which proves
  the POLICY SQL itself, using the real SDK's absence as the reason it must
  go directly to Postgres), the two files together cover "the policies are
  correct" and "the application code reaches them" — the gap that remains
  is the same one §7's closing list already names: the real Supabase
  project's PostgREST/JWT-validation layer, untested from this machine.

What it does **not** prove, for lack of live infrastructure on this
machine/session:

- That the actual hosted Supabase project's PostgREST layer validates this
  repo's self-signed JWT the same way (no live `SUPABASE_URL` /
  `SUPABASE_JWT_SECRET` / network access to the real project from this
  session — and this item does not have or need those secrets to build the
  seam).
- Docker (available on this machine per its toolchain notes) could not be
  used for a real local-Supabase-CLI stack: Docker Desktop's daemon would
  not come up in this sandboxed session (`docker ps` failed to reach the
  named pipe after starting the app and waiting; the `docker-desktop` WSL
  backend distro stayed `Stopped`). pglite was used instead — genuine
  Postgres RLS enforcement, just not through Supabase's own PostgREST/auth
  stack.
- The migration has not been applied to any real database (§6) — this is
  SQL correctness verified in isolation, not a production smoke test.
