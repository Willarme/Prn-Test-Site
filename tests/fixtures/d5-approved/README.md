# D5 saved design evidence

These unedited UTF-8 source copies were captured from the pre-D5 HEAD, and independently compared with `git show HEAD:<path>` before implementation. They are evidence, not runtime templates. Do not regenerate them from edited source or update hashes to make tests pass.

- `ResultsTemplate.tsx.txt`: `src/components/results/ResultsTemplate.tsx`, normalized-LF SHA-256 `af4bb3d2ec0bd3cf1c8249990133b7c3d9e0da5f635f7b4ca6fb35d050e593f1`.
- `render.ts.txt`: `src/domain/packet/render.ts`, normalized-LF SHA-256 `b55ef8d892c3ee3f78ba0177afa0d6242c07aa3b358a9d5ce35cc42f1e066ca1`.

The approved HTML mockups already live at `tests/fixtures/loop/MOCKUP-1-job-packet-pdf.html` and `MOCKUP-2-results-page.html`. On 2026-09-13 both were independently compared byte-for-byte after LF normalization with the corresponding sources under the shared vault's `Project/03 Build/Intake Results Packet 2026-09-03/`.

The PDF mockup SHA-256 is `d1544692b8103c25351cc8df984e48dd1eb41832ea1f2bf6fca3203d8ffef16e`; results mockup SHA-256 is `c3c7697a8030bf474a617bd6dedca3f492884979fa76ff2721cb29a4bc2547bf`.

`tests/t8-44.results-packet-hidden.test.ts` pins these hashes, compares the two actual QR article bodies with the saved renderer, proves that restored PDF output equals the original output, and proves pages 2 and 3 do not change. `tests/loop.p2.results-template.test.ts` continues comparing restored results wording with the approved HTML mockup. Runtime visibility comes from feature states; no source editing is needed to restore the preserved bands/cards.
