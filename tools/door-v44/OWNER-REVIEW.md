# Owner review of saved v44 pages

The Growth navigation now opens `/admin/page-creator` and `/admin/templates`.
These are authenticated read and review screens. They do not implement Create N,
dry runs, regeneration, QA execution, approval, publishing, rollback, Impact
Preview or theme registration. Each unavailable action states what is missing.
The full eleven-page creator journey remains incomplete.

## What the screens read

- Page Creator lists persisted identities, then the registered versions for one
  identity. A later reservation without a build is shown separately. An explicit
  missing version is never replaced with the newest version.
- Version review shows immutable compile-receipt identities, saved assignments,
  recorded model provenance and evidence summaries. Raw compiler context, asset
  bodies and private source-record payloads are not returned in the read model.
  A receipt's PASS and time window do not establish current release eligibility.
- Current serving eligibility is read separately through the same current-authority
  reader used by public serving. A failed read is unavailable; it does not imply
  that no selection exists. This observation is not a hosted acceptance test.
- Templates reads the checked-in compatibility, constants, field mutability and
  source-input manifest. The ten displayed slots are requirements, not registered
  or approved themes. Downloads contain only four named documents; their displayed
  hashes identify the exact JSON response bytes.

Private preview URLs are
`/admin/page-creator/<page_id>/versions/<version>/preview`. Every HTML and image
request authenticates before resolving parameters, configuration or storage, then
verifies the exact registered version and its complete artifact bundle. It never
regenerates a page or falls back to a different version. `PRN_DOOR_V44_ARTIFACT_ROOT`
must identify the configured private artifact directory; no value is installed by
this change. Current catalog migrations and shared artifact availability remain
deployment prerequisites.

The response remaps only verified image URLs to the same version's authenticated
asset route. Stored artifact bytes stay unchanged. The response declares
`X-PRN-Preview-Remapping: version-bound-assets` and the original artifact hash.
Private/no-store/noindex headers apply to successes and refusals. CSP disables
scripts, forms, connections and styling. This is an unstyled content preview; it
is not full template fidelity, interactive walkthrough or release evidence.

The older `/staged-template/<page_spec_id>` route still serves the frozen v43
template. The earlier `door-v44.preview-auth.test.ts` protected that existing route;
its filename never established a v44 draft renderer.

## Verification and limits

Focused tests cover owner gates, exact version selection, missing-versus-failed
reads, cross-tenant refusal, counted database reads, receipt projection, source
downloads and real offline artifact/image readback. These tests use synthetic
fixtures, never model/vendor calls or fabricated operational approvals.

The new views reuse the existing PRN ink navigation and paper workspace, with
responsive tables and expandable technical records. This follows the scoped PRN
owner-console direction in Bodnar Design Memory's `05 Feedback/Decisions.md`
(2026-09-06) and `01 Style/Style DNA.md`. No new aesthetic approval is attributed
to either owner. Actual browser and hosted acceptance remain unverified: automatic
approval review previously rejected local preview-server startup with only
`blocked by policy`. No equivalent startup workaround was attempted.

Next implementation is the persisted fixture-to-creator workflow: idempotent
create/read/resume, ordered item outcomes and immutable version/attempt bindings.
Live execution additionally needs governed input assembly, shared spending
authority, independent QA and the existing release gates. Trial deployment remains
on Melissa's PRN machine/account; this unit performs no deployment.
