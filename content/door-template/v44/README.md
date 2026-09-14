# Door v44 contracts, compiler and immutable candidate artifacts

T6-31 implements the current Page Creator Guide section 21 in order. The kit now has explicit input identities, canonical schemas, a controlled loader, source-backed constants, a separate mechanical wording derivative, deterministic semantic HTML compilation and immutable candidate artifact storage. It does not switch the existing generator or serve new pages.

| Identity | Value |
| --- | --- |
| Frozen content baseline | `ac-v43` |
| Template | `door-v44.0.0` |
| PageSpec schema | `doorspec/2.0.0` |
| Initial theme identity | `door-v44-t01@1.0.0` |
| Subject taxonomy | `subject-taxonomy/1.0.0` |

The approved v43 reference, source kit, binding and scoped amendments stay unchanged. A new v44 manifest is never a replacement approval or a new pin for generated v43 output.

## Use

From the repository root:

```text
npm run door:inputs
npm run door:schemas
npx vitest run tests/t6-31.v44-inputs.test.ts tests/t6-31.v44-contracts.test.ts tests/t6-31.v44-loader.test.ts --testTimeout=20000
npm run typecheck
```

`door:inputs` verifies the separately pinned source-input manifest and reports actual raw and LF identities. Only the independently recorded original, uniform LF or uniform CRLF representation is accepted; unrecorded mixed line endings still fail. Read its `scope`, `release_ready`, `clean_wording_available` and `limitations` fields as well as `ok`. The inherited wording snapshot contains quarantined control characters; independent wording/validator twins and second-machine acceptance remain unavailable. Identity verification does not declare that input clean or release-ready.

`door:schemas` compiles the root and every namespace using the directly pinned Ajv dependency. It reports a deterministic schema hash and object/property coverage. There is no remote schema fetch, custom executable keyword, coercion, default insertion or extra-property removal. Missing local references and permissive object definitions fail.

`loadDoorV44Spec(raw, context)` in `src/domain/search/door-v44/loader.ts` accepts JSON data and an explicitly supplied `DoorV44ValidationContext`. JSON Schema is the canonical runtime shape authority; `types.ts` is the TypeScript view. Context supplies reviewed registries, exact selected versions and prompt identities, source/claim hashes, page and eligibility records, family/protocol/hazard/evaluation records, disclosure identity, origin/index policy, approved-content date and an evaluation timestamp. **Context belongs to trusted orchestration, never to the writer/model or a public request.** This first unit does not implement the production context assembler or claim the supplied review records exist in production.

The result is either `{ ok: true, spec, input_hashes }` or `{ ok: false, errors: [{ code, pointer }] }`. Diagnostics expose codes and JSON Pointers, never raw payload text or unknown property names. The loader does not write files, discover sources, call models/vendors/databases, read the wall clock or publish anything. It leaves both inputs unchanged; object-key order is non-semantic and visible array order is retained.

The boundary checks shape, required values/counts, unsafe markup/URLs, rich-text nesting, governed IDs, controlled version and disclosure matches, canonical/attribution consistency, source/claim reference closure, family/protocol evidence, CTA/subject compatibility, conditional inputs, live-capability receipt currency and related-page eligibility. Inactive optional modules cannot be forced on by a model-supplied boolean.

## Evidence scope

`tests/fixtures/door-v44/contracts/` contains synthetic F04 appliance and F08 nameplate-free data. Fixed fixture sources, claims, module receipts and capability statuses are injected test data. The fixture mode and noindex policy do not prove real production capability, factual safety review or owner approval. Fixture receipt prefixes and fixture visuals cannot satisfy live-mode verification. F01 remains the separately pinned v43 evidence; it has not been rewritten to make a new-schema check pass.

## Compiler and candidate store

`compileDoorV44Page(raw, context)` composes the strict loader with subject-derived actions, conditional modules, derived heading counts, resolved source and fact records, source-ledger/JSON-LD closure, image role selection, safe HTML serialization and explicit visible-date provenance. The required intake capability must have a current receipt. HIDDEN/PREVIEW capability rows disappear, and the build fails if the remaining module no longer meets its required shape. Model-authored numeric prose and unsupported fact labels fail before generation can proceed to independent QA.

The compiler context additionally supplies the source URL verification records, numeric publisher/geography/window/denominator/sample/observed/methodology fields, approved fact display labels, actual raster bytes and corresponding reviewed image-source hashes, disclosure text bytes, an exact intent-review binding, site name/year and visible-component approvals. Synthetic records are explicitly test-only. These supplied records must originate from trusted orchestration; compiling them does not prove they were actually reviewed in production. The current implementation does not assemble live records from the production database.

The image boundary checks decoded raster bytes, dimensions, MIME, orientation and full-image decoding as well as recorded hashes. It does not substitute for reviewing illustration meaning, proving inline/raster visual equivalence or checking served URLs. Page text has no ambient build/mtime/deployment date. A dated artifact needs matching approvals for its rendered content, present constants, disclosure, claims and images; a new version number alone cannot refresh the date.

`wording/` preserves the original evidence and records exactly four U+0008-to-literal-`\b` mechanical corrections. The validator distinguishes hard mechanical failures from review findings. Reviewed intent phrases such as “dishwasher not draining” are protected only from the negation rule; the rest of the sentence and all other rules remain checked. Original input pins remain unchanged; the old input report still describes its quarantined original, not this new derivative. Independent twins and actual second-host verification remain open.

`writeDoorV44Artifact(root, compiled)` stores exact HTML, semantic document, receipt and raster bytes under a content hash. It atomically installs a completed bundle and a tenant/page/version binding; retries are idempotent and an existing version cannot be overwritten with another artifact. `readDoorV44Artifact` verifies stored file hashes and recomputes the rendered and artifact identities before returning it. Interrupted staging or an unbound bundle never becomes a selected version. This local artifact binding is not the production publication registry or a cryptographic attestation of human approval.

Explicit nonpublic compiler examples can be built from the repository root without a server, model or vendor call:

```text
node --import tsx tools/door-v44/wording.ts
node --import tsx tools/door-v44/build.ts --fixture f04 --root artifacts/door-v44/compiled-examples
node --import tsx tools/door-v44/build.ts --fixture f08 --root artifacts/door-v44/compiled-examples
```

For controlled real candidate inputs, replace `--fixture` with `--spec <json>` and `--context <json>`. The builder always writes a candidate; it has no publish/deploy action. Package scripts are unchanged to preserve the original toolchain-input pins.

The compiler fixtures are explicitly derived from the F04/F08 loader contracts. They replace numbered placeholder prose with stable letter labels, provide affirmative fixture-only hero text and real generated test raster bytes, and inject synthetic provenance. The original loader fixtures and frozen AC control remain intact. Their eight-pixel test plates establish byte/metadata behavior, not the requested intent illustrations or visual quality.

## Remaining acceptance

### Offline source conversion, corpus and build provenance

`tests/fixtures/door-v44/corpus/f01/` now maps the frozen AC source into a candidate with exact source hashes and a difference ledger. It intentionally remains `BLOCKED_CONTROL_DERIVATIVE`: preserved metadata, unreviewed evidence/capabilities, disclosure and inline fidelity do not pass the new contract. Nothing in this conversion supplies production approval or silently changes v43.

The versioned corpus factory supplies F02–F11 with differing observation/cause/check/FAQ/visual counts, equipment/media omission, RELATED presence and missing-module preflight failures. Its invented context and small test rasters exercise software grammar only. They are not homeowner instructions or reviewed illustrations. The batch analyzer excludes universal furniture/citation labels, compares substantive dynamic content, flags similarity and blocks exact normalized subject swaps. Context and source changes invalidate analysis hashes. A clean heuristic result is not independent A06 approval.

The build CLI now observes actual source/input/runtime/dependency bytes before and after compilation, reserves its derived hash keys, and stores a hash-bound provenance sidecar. Readback verifies that sidecar. `provenance_status:observed_local` describes local file observations, not execution attestation, protection against transient source replacement, second-host reproduction or release approval. Direct pure-compiler/store calls without a sidecar remain explicitly `unattested`.

```text
node --import tsx tools/door-v44/corpus.ts --root artifacts/door-v44/corpus-review
```

This command builds and reads back the ten synthetic positives, records all eleven fixture rows and batch similarity findings in `corpus-report.json`, and exits 1 because F01/full acceptance remain incomplete. Use a fresh owned output root for each evidence run; it never overwrites an existing report or publishes. Outputs remain unstyled and noindex. Canonical CLI invocation is `node --import tsx`; ambient loader overrides are rejected.

Full frozen-control fidelity, F01–F11, actual t01 styling and all ten themes, independent A06 review, illustration meaning/inline-raster parity, portable browser and second-host rendering, production context assembly, PageVersion selection/publishing/rollback integration, creator controls and actual hosted acceptance remain open. Stored candidates explicitly report `release_ready:false` and their pending checks. H01–H18 remain open until their complete checks pass on the same final source and corpus.
