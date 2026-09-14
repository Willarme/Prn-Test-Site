# v44 raw serving adapter — source checkpoint

The release foundation consists of migrations `00030` and `00031`, following the
immutable version/input migrations `00028` and `00029`. Apply them only through the
project's existing migration process on the correct deployment account. No remote
migration or deployment was performed by this source unit.

`doorPageEvidenceStore` persists immutable, subject-bound receipts and revocations.
`evaluateDoorRelease` requires explicit active receipt hashes plus complete page
history, trusted producer identities, all H01-H18 and named acceptance checks,
current dependencies, and the writer identities derived from captured model runs.
A digest or a compiler success never substitutes for those observations. Technical
assessment, content approval, release evaluation and explicit publish action are
separate records. Synthetic test receipts grant no operational authority.

`doorPageSelectionStore` publishes a full exact version set with a compare-and-swap
revision and atomic audit. A fresh authority callback is required; its default
refuses publication. Rollback restores historical selected artifact identities and
still requires fresh release/action evidence. Withdrawal removes incoming RELATED
dependencies. Clearing a hold does not restore a withdrawn selection.

`runDoorPageCritic` loads verified stored artifacts and captured inputs before using
the existing `callModel` permission, privacy, spend and kill-switch gates. It changes
no enablement. The critic must differ from every captured writer model. Actual run,
generation, prompt, policy/catalogue, input projection, cost and usage are retained.
Schema-response repair and content-version repair are different counters.
`recordDoorPageCritic` saves the complete reply as private immutable JSON before
appending its receipt. Concurrent identical JSON writes converge through atomic
publication of completed bytes; corrupted canonical evidence is refused.
`recordDoorPageArtifactIntegrity` issues only actual byte/semantic/input-association
claims. Neither producer issues a broad check matrix or publication approval.

Producer identities and implementation hashes must come from verified server
configuration. These internal functions must never accept browser-supplied receipt
verdicts or authority descriptors. A durable job orchestrator must reserve and
reconcile attempts before making model calls. The complete creator job lifecycle,
owner UI, styled renderer acceptance and all operational QA are still separate work.

This adapter is source implementation and offline evidence. No server, browser,
hosted deployment, rendered fidelity, publication approval or full-stage PASS was
performed or inferred. Frozen AC still uses its existing handler. Sitemaps remain
held. The adapter returns exact stored HTML and raster bytes without inserting
Next layouts, CSS, menu controls or private evidence JSON.

## Runtime configuration contract

Server-only configuration (no values were installed by this unit):

- `PRN_DOOR_V44_ARTIFACT_ROOT`: absolute existing owned artifact directory.
- `PRN_DOOR_V44_ORIGIN`: exact canonical HTTPS origin, without trailing slash.
- `PRN_DOOR_V44_AUTHORITY_PATH`: absolute existing current authority JSON file.
- `VERCEL_GIT_COMMIT_SHA`, or `PRN_DOOR_V44_COMMIT` when absent: full 40-character
  lowercase deployment commit. Neither request headers nor request bodies supply
  these values or the tenant. Runtime tenant remains `DEFAULT_TENANT_ID`.

The strict `doorRuntimeAuthoritySchema` in
`src/platform/pages/door-v44-runtime-authority.ts` is the versioned DTO authority.
It requires format `door-v44-runtime-authority/1.0.0`, tenant, three revision
counters, `public_publish_hold`, a complete `DoorReleasePolicy`, and exactly one
typed locator for each of these 13 dependency kinds:

| Locator type | Required kinds | Actual observation |
|---|---|---|
| repository | compiler, schema, template, taxonomy, wording, prompt, fixture_corpus, theme, disclosure | SHA-256 of sorted relative paths and actual byte SHA-256s below fixed repository roots |
| runtime | feature_state | Full registry and freshly loaded persisted tenant feature rows, excluding observation timestamp |
| runtime | ai_policy | Effective validated AI policy, override first; absent files use the actual shipped OFF default; corruption refuses |
| current_records | source, capability | Actual parsed current authority inventory, including active/revoked status |

Every locator has a governed `id` and `version`; current-record locators also have
an absolute `path`. All computed rows must match the declared policy dependency
rows exactly, including hashes and sorted identity/version. Unknown fields, kinds,
missing inputs, malformed JSON, foreign tenants and symlink/junction paths refuse.
The prompt inventory includes the current `door-page-critic.ts` implementation.
Repository locations are fixed by `DOOR_AUTHORITY_REPOSITORY_INPUTS`; a manifest
cannot relabel an arbitrary file as the compiler. These files must be present in
the deployed filesystem: a Next build/trace may omit source and test trees. No
hosted packaging availability was demonstrated; omission correctly closes serving.

Current records have strict format `door-v44-current-records/1.0.0`, tenant, kind
(`source` or `capability`), version and nonempty unique records. Each record has
`id`, `version`, `status` (`active` or `revoked`) and plain-JSON `value`. This file
is an operational current inventory, not a source review or approval receipt.
An operator must maintain its current source/capability revocations. There is no
general external source revocation feed in the repository, and this unit did not
invent one. A file's digest does not attest the truth of its payload. Selection's
independent evidence/review/approval checks remain required.

Environment hash covers tenant, configured origin, artifact root, configured
deployment commit and actual Node version. Holds are recomputed from the explicit
authority public hold and actual door-page feature state. The actual policy hash
must also equal the persisted guard's policy hash and full policy content. A
persisted fence alone never establishes current authority.

## API and membership

`loadDoorV44PublicSelection(features?)` loads actual managed catalog identities,
even when authority is missing. A supplied directory snapshot is reused exactly;
HTTP dispatch reads a fresh snapshot. `readDoorV44FreshFence(tenant, guard)` is the
independent server observation provider for store mutations; it does not publish.

`verifyDoorV44ServingSnapshot` verifies selected receipt identity, bytes, expiry,
origin and emitted functional references against the same feature snapshot. It
removes invalid entries and incoming RELATED dependencies. Directory/family links
and raw page/media serving consume this membership. Legacy rows at any managed
path are excluded even if selection is empty, revoked, stale or corrupt. Storage
failure is an unavailable response, never a latest-version fallback.

`doorV44SelectionResponse` returns `null` only for definitively unmanaged legacy
paths and the explicit frozen AC exception. Selected HTML and referenced PNG/WebP
assets support GET and HEAD; other methods return 405. All adapter outcomes use
no-store, nosniff and noindex headers. Unknown/private asset paths are refused.

Tests exercise real compiled and re-read artifact bytes, synthetic selection
consumer DTOs, real temporary authority files, a Windows junction, fresh-reader
contracts, directory tombstones and direct middleware calls. Synthetic consumer
fixtures are not a claim that any page passed the independent release gates.
