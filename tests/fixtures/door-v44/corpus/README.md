# F02–F11 synthetic portability corpus

This test-only corpus implements the F02–F11 cases and the bounded coverage checks in the Page Creator Guide §18–21. It reuses the existing `compilerFixture` factory without changing that factory or its F04/F08 loader fixtures. F01's frozen AC control conversion is recorded in `f01/`; the manifest marks it `BLOCKED_CONTROL_DERIVATIVE` because its preserved source does not yet satisfy the new contract.

Every case contains invented evidence, sources, protocol/check/hazard/evaluation records, taxonomy and capability status fields. `reviewed:true`, the bound intent hash, and simulated LIVE receipts are fixture data; they are not actual expert review, production capability evidence or approval to publish household advice. All results are unstyled, nonpublic/noindex compiler artifacts with `release_ready:false`. The tiny raster bytes come from the synthetic factory and do not establish illustration quality or source-to-raster drawing fidelity.

`corpusFixture("F02")` asynchronously returns `{spec, context, definition}`. `preflightCorpusFixture(input)` calls the production pure loader. `compileCorpusFixture(input, compile?)` is test-only orchestration that invokes the compiler only after that loader succeeds; its optional compiler argument allows a test to count invocations. There is no model, vendor, server or publishing adapter in this helper. This is not a production A05 preflight implementation.

| Case | Distinct evidence boundary | Observations / causes / checks / FAQ / visuals | Nameplate/equipment | Media | RELATED |
| --- | --- | --- | --- | --- | --- |
| F02 furnace blowing cold air | Heating demand versus supply report; combustion and carbon monoxide | 3 / 3 / 3 / 5 / 3 | Present | Photo | Present |
| F03 heater will not turn on | Ambiguous heater category and unknown energy arrangement | 4 / 2 / 2 / 6 / 2 | Present | Absent | Absent |
| F04 dishwasher not draining | Cycle timing and separate water/electrical boundaries | 3 / 4 / 2 / 4 / 3 | Absent | Photo | Present |
| F05 refrigerator not cooling | Temperature report, elapsed time and unresolved food exposure | 5 / 3 / 3 / 6 / 4 | Present | Absent | Absent |
| F06 water heater leaking | Urgent water spread, energy and temperature exposure | 4 / 4 / 1 / 5 / 3 | Present | Photo | Absent |
| F07 toilet keeps running | Continuous versus intermittent sound; overflow boundary | 2 / 1 / 2 / 4 / 2 | Absent | Absent | Absent |
| F08 ceiling stain after rain | Material, extent and rainfall timeline | 3 / 2 / 2 / 5 / 4 | Absent | Photo | Present |
| F09 sewage smell in basement | Odor identity remains unknown; biohazard/air-quality stop list | 4 / 3 / 1 / 6 / 3 | Absent | Absent | Absent |
| F10 outlet feels hot | Existing heat report; electrical stop boundary and no new touch test | 2 / 2 / 1 / 4 / 2 | Absent | Absent | Absent |
| F11 branch on roof after storm | Existing ground-level account; weather/structural/downed-line limits | 5 / 4 / 1 / 5 / 3 | Absent | Absent | Present |

The current compiler exposes the approved `order-b` structure. F10 records its stop boundary in the synthetic content and verifies that an unsupported `stop-first` order proposal fails preflight. This does not approve or claim implementation of a new order profile.

The five missing-module pairs are F02 hazard, F03 protocol, F09 source, F11 hazard and F06 evaluation. Each starts from a successful case, removes the corresponding authority, asserts the named loader refusal and zero compiler/vendor invocations, restores the complete synthetic module context, then requires real compilation to pass. Schema and compiler guards are unchanged.

The tests inspect actual HTML for form controls, equipment/location-material packet fields, RELATED links, action grammar, derived count spans and noindex. They compare constant values across all ten cases and the complete observation/cause/check/FAQ/visual count plus rendered section-class profile. All ten count vectors are distinct; each of the five count dimensions has at least three values. This mechanical diversity check is not a copy-similarity, anti-doorway or design acceptance verdict.

Run `npx vitest run tests/t6-31.v44-corpus.test.ts --testTimeout=20000 --hookTimeout=20000`. The suite compiles LF and CRLF JSON representations locally and requires identical full results. It also hashes the original input manifest, all its protected files, and the inherited fixture sources before and after. No originals are rewritten. A second-machine run and the t01–t10 theme matrix remain unperformed. No H01–H18 PASS is claimed.
