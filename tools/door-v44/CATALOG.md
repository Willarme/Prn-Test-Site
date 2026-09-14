# Candidate page versions

`catalog.ts` records immutable candidate versions in an explicitly selected local
file database. The runtime store also has a Supabase adapter backed by additive
migrations `00028_door_page_versions.sql` and `00029_door_page_version_inputs.sql`; applying those migrations is a separate
deployment step. This tool does not connect to Supabase, publish, approve QA, or
change the public registry.

Run from the repository root. Every command accepts `--db <absolute JSON database
path>` and `--input <JSON command file>`. Keep this database and the artifact root
outside `public/` and out of release files. Command files are bounded to 64 KiB,
except the private governed input capture (8 MiB).

1. `node --import tsx tools/door-v44/catalog.ts reserve --db <database> --input <reservation.json>`
   accepts `tenant_id`, `page_id`, `canonical_intent_id`, `canonical_url`,
   `operation_id`, `expected_latest_version`, `actor`, `reason`, and `at` (UTC ISO).
   Use expected version zero for a new page. Keep the exact command for retries.
   The result supplies the reserved `page_version`. An unsuccessful build retains
   its reservation; another operation must use the next version.
2. `node --import tsx tools/door-v44/catalog.ts capture-input --db <database> --input <governed-input.json>`
   accepts `tenant_id`, `page_id`, `reservation_id`, complete `spec` and `context`,
   `model_provenance`, `actor`, `reason`, and `at`. Trusted authoring supplies this
   private file; it is not an HTTP request or writer-controlled context. The spec
   must already carry the reserved version and matching review evidence. The
   context must be pristine, before build-provenance injection. The store derives
   and hashes the template/schema/theme/taxonomy/prompt/source assignments. Model
   provenance is explicitly `not_recorded`, `fixture_no_model_calls` with a
   fixture id, or `recorded` with exact capability/provider/model/policy/run/receipt
   identities. Recorded identities are not independent vendor attestations.
   Capture is immutable, retry-safe, and must precede first artifact registration.
   Output contains identities and hashes, not full content or raster data.
3. `node --import tsx tools/door-v44/catalog.ts build-saved --db <database> --root <artifact root> --input <saved-build.json>`
   accepts only `tenant_id`, `page_id`, `operation_id`, `expected_input_sha256`,
   `actor`, `reason`, and `at`. It loads the saved input, compiles it, verifies its
   stored artifact and input association, and registers the candidate. No spec,
   context, receipt, path or approval can be supplied in this JSON command. Keep
   the exact command for retry. Registered retries re-verify existing bytes;
   interrupted writes recover the exact version binding before compilation.
   Corrupt/missing registered artifacts refuse instead of rebuilding. This command
   produces `unattested` build provenance and never calls a model. Structural
   compilation leaves independent QA and release checks pending.
4. `node --import tsx tools/door-v44/catalog.ts list --db <database> --input <page.json>`
   accepts `tenant_id` and `page_id` and returns registered candidates in version order.
5. `node --import tsx tools/door-v44/catalog.ts verify --db <database> --root <artifact root> --input <version.json>`
   additionally takes `page_version`. It re-verifies that exact artifact; missing
   or changed files fail instead of selecting a different candidate.

The current catalogue supports the compiler's en-US/national canonical pages.
One tenant cannot reserve two page identities for the same canonical path or
intent. Reservations, versions and their audit entries commit atomically. An exact
retry returns the existing record; changed retry data or a stale expected version
returns a conflict. Metadata contains the complete compiler receipt and hashes,
with observed build provenance when available, and never stores a machine-local
artifact directory. Compilation still reports `release_ready:false`.

For separately collected observed local provenance, capture the pristine governed
inputs first, then use the existing `build.ts` provenance collector on those exact
inputs. The lower-level `register` command accepts `tenant_id`, `page_id`,
`operation_id`, `artifact_hash`, `actor`, `reason`, and `at`; it reads the artifact
and derives metadata rather than accepting caller-supplied receipts. Registration
must match any captured input. Older metadata-only candidates remain readable;
they cannot be retroactively described as having captured pre-build inputs.

Remaining integration includes independent release evidence, a production artifact backend,
the selected public version, exact rollback, and the Page Creator/Templates console
journey. Local file proof does not establish a hosted migration or a second-host
reproduction.
