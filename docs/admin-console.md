# Company OS admin console

The local demo starts with `npm run demo` and opens at `http://localhost:3188/admin`.
It binds to loopback, uses the existing named demo file store and keeps email in
preview mode. The owner console is private; the customer demo collection is at
`/demo/all`.

## Access configuration

Keep values in ignored local environment configuration or the deployment's
server environment. No credential belongs in source or a shared vault.

- `ADMIN_PASSWORD`: the independent owner credential, at least eight characters.
- `PRN_ADMIN_ORIGIN`: the exact HTTPS origin for hosted admin mutations. Do not
  include a trailing slash, path, query or fragment. Configure this on the actual
  intended host before testing hosted owner actions.
- `PRN_LOCAL_ADMIN_PASSWORD`: optional convenience access for the isolated local
  demo. It is accepted only in development, on direct loopback HTTP, with forced
  file storage and a named subdirectory under `data/runtime`.
- `PRN_LOCAL_ADMIN_SESSION_SECRET`: independent random signing secret, at least
  32 random bytes encoded as base64url. Rotating this or the local password
  invalidates local sessions. It is not derived from a short demo password.

Public forwarding, client-preview mode, production and hosted admin-origin
configuration disable local-demo authentication. The normal owner credential
remains independent. Sessions expire after twelve hours. The process-local
admission limit is a local defense; multi-instance hosting still requires a
shared ingress throttle.

## Operating views

The overview shows bounded request, release, quality, spend and activity readings.
The request explorer opens private dossiers without changing homeowner access.
Approvals show the recorded proposal/evidence and preserve the action's existing
execution boundary. The growth queue uses the same current release decision as
the publish endpoint. Legacy deterministic eligibility does not establish a
successful AI review or v43 production readiness.

The agent roster separates configured declarations from saved run receipts.
The Activity view projects only action names, reference IDs, times and safe run
metadata. Arbitrary agent output, errors and private input payloads are excluded.
System controls distinguish flags and policies from observations and label the
process-local/cached kill-switch limitations. Local approvals remain process-only.

Connections exposes presence/mode information without exposing keys or addresses.
Its explicit check reads the active store only, retrieves no database record
bodies, checks five core admin/runtime tables, eight full-loop tables and both
durable link-ledger tables, limits
each database probe to eight seconds and makes no paid model call or email send.
A database HEAD read does not establish successful writes or cross-customer row
isolation. Missing loop tables must remain visible even when core tables respond.

Supabase is the requested database integration (Joshua clarified the original
Firebase wording on 2026-09-06). The console uses the existing shared client
seam and database schema. The isolated local demo deliberately keeps its file
runtime even when Supabase credentials are present. A successful check in the
demo verifies local storage; a database-mode check verifies Supabase access in
that environment. Neither result stands in for hosted configuration or an RLS
isolation test.

## Supabase loop migration

The full loop requires migration `00020_loop_surfaces.sql` and the operation
allow-list in `00021_loop_grant_hardening.sql`. The latter removes inherited
service-role UPDATE/TRUNCATE privileges from append-only loop records, keeps
magic-link consume and email send stamps writable, and preserves signup upsert.
It changes grants on eight tables and their two identity sequences; it does not
rewrite customer records or replace request-scoped RLS policies.

The preserved public migration `00024_request_link_ledger.sql` is also required
for `issued_request_links`, `request_keep_state` and their service-only atomic
registration/confirmation RPCs. Diagnostics includes both tables; readable HEAD
responses still do not prove RPC grants or writes. The private unused
`00023_issued_links.sql` is excluded from this lineage because its competing
`issued_links` / `link_keep_state` backend is superseded by public 00024. Do not
confuse it with the preserved public `00023_label_extraction_completion.sql`.
Never edit or replay an applied migration; inspect the target ledger first.

Inspect the actual migration ledger and schema before applying either file.
For a first loop installation, apply both files and their ledger entries in one
controlled transaction, verify RLS/grants, then commit; roll back the complete
transaction if verification fails. The general migration CLI commits each file
separately, so it does not provide that combined transaction. Migration 00020
contains CREATE POLICY statements and must be skipped when already applied;
the grant hardening itself is rerunnable. The local PostgreSQL regression proves
these behaviors, not the current hosted migration state. Run fresh database
diagnostics and customer isolation checks after any actual schema change.

## Scope and rollback

This rebuild changes internal administration, not the frozen AC v43 customer
template. No hosting activation, provider dispatch, production data movement or
new customer service follows from adding a console panel. Revert the scoped
console change to restore its prior behavior; remove the two local environment
settings to disable convenience access immediately. Retain the independent
owner credential and existing data files.
