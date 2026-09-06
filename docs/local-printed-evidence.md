# Local printed evidence OCR

Verified 2026-09-06 on Windows, Node 24. Tesseract.js 7.0.0 plus @tesseract.js-data/eng 1.0.0 are pinned in this repository. Sharp 0.35.4 is a runtime dependency. Upstream package metadata declares Apache-2.0 for Tesseract.js and MIT for the language package; retain upstream package metadata when distributing.

Use for narrow printed thermostat settings/temperatures and explicit nominal filter dimensions. It does not recognize dirt, ice, fan motion, sound, installed filter compatibility, or diagnose equipment. Use existing capability adapters when they already suffice. No new MCP or account is needed.

Install (review current versions before changing): npm install --save-exact --ignore-scripts tesseract.js@7.0.0 @tesseract.js-data/eng@1.0.0. This tested installation suppressed optional lifecycle scripts; bundled WASM ran successfully.

The source adapter is src/platform/problem/printed-evidence.ts: readPrintedEvidence({evidence_id, image: Uint8Array}). The trusted intake supplies evidence identity after consent and storage. The output retains original-image hash, versioned reader identity, per-field confidence, prepared-image boxes and null/gap outcomes. Readable means at least one field was read, not that all requested fields were obtained or confirmed. Preserve image-purpose context and a confirmation step.

The fixed tools/ocr-printed-evidence.mjs child uses tools/ocr-worker.mjs and ocr-offline-guard.mjs. Image bytes travel only over stdin. Both child and worker disable networking; weights use an explicit local langPath and no cache writes. Limits: 6MB input, 8MP decoded, 1800px preparation, 100 lines/240 chars each, 128KB output, 20sec wall deadline, one live child per host. Over-limit output fails rather than truncating contradictions. Worker errors/timeouts return unavailable and keep occupancy until actual child close.

Verify: npx vitest run tests/seo.printed-evidence.test.ts tests/seo.printed-evidence-process.test.ts. Actual synthetic images tested all five fields; a tighter image left uncertain values null; a blank image returned unreadable; malformed inputs failed. Guard test blocks fetch/HTTP/HTTPS/sockets. Process mocks verify error, deadline, busy-until-close and bounded-output behavior. No provider call, secret, remote upload or production activation occurred.

Language file: node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz, SHA256 45b4cb346724ac1774f1c36f42f182b887bcdb28ebe63e6fff90ac41f3fcff91. Parser checks the actual child-computed version/hash. Unknown versions cannot produce accepted fields.

The shared intake now invokes this adapter for thermostat_photo and the authorized step:filter upload. Typed local completions feed saved answers, per-field gaps, confirmation/correction and Directions. Explicit printed cooling capacity follows the existing governed label path and preserves the request/tenant two-attempt limit. Actual synthetic-image route tests cover these joins; no public OCR endpoint or remote fallback was added.

Next traces both upload routes with helpers, language data, WASM and native/transitive dependencies. tools/check-ocr-runtime-bundle.mjs verified an isolated actual Windows trace bundle with real synthetic pixels, offline probes and missing-weight failure. Hosted Linux execution and shared durable completion storage remain unverified. The existing hosted intake500 must be resolved before a real hosted reading-to-packet claim; all nine production capability rows remain pending.

Official sources: https://github.com/naptha/tesseract.js and its docs/api.md and docs/local-installation.md; language package https://github.com/naptha/tessdata. Read current documentation before a version update.
