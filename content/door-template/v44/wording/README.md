# Clean mechanical WORDING derivative

This S2 unit supplies a separate, traceable mechanical derivative of the quarantined WORDING evidence. It does not replace the frozen source, change the original v44 input manifest, establish an independent workspace twin, approve copy, or pass a complete H01-H18 gate.

## Exact transformation

The preserved source is `content/door-template/v44/inputs/sources/vault-WORDING.md`, raw SHA-256 `9ada20852ad5cc7756e96d2cef39d1164dfc9b51f54175141589e0f97ebe7491`. At zero-based raw byte offsets **267675, 267839, 271662 and 271702**, replace byte `08` with bytes `5c 62` (literal backslash followed by `b`). These are the two word boundaries in rule 50's candidate finder at source line 2034 and the two boundaries in rule 51's money-token finder at line 2094. Every other raw byte, including CRLF, is retained. The derivative is exactly four bytes longer.

The result is `sources/WORDING.mechanical.md`, raw SHA-256 `26715ab7b88496d97bf084a2400f222d468aa514f9ff6645493d8fbdd5a4305e`, LF semantic SHA-256 `b1f30f646bbc605bbd9422675fd2d4e6a51b37f8eb491c697e478f6851e28372`. `manifest.json` pins the source, derivative, transformation and small compiled rule registry. Its independent code pin is `23e67b16dcc0772d459d0dfbcc40953b4abc5a8ad47161696f3cfbff5b31515e`.

`verifyDoorV44WordingDerivative({source, derivative, manifest, rules})` accepts supplied bytes only. It verifies original/derivative raw identities against their exact recorded LF/CRLF representations, the four-character transformation, UTF-8 and clean derivative controls. It rejects changed words, deleted backspaces, unrecorded mixed newlines and re-pinning the supplied manifest. Nothing is rewritten during verification.

Manifest and rule-registry metadata accept only their independently pinned canonical LF bytes or the exact uniform CRLF encoding derived from those bytes. Both representations are verified using strict UTF-8 and the existing LF identities; mixed line endings, bare carriage returns, BOMs, extra whitespace/newlines and semantic changes fail. This checks the known Windows checkout representation locally; it is not evidence of a run on a second host.

## Mechanical validator

`validateDoorV44Wording(blocks, {surface})` accepts extracted visible text blocks with `text`, a compiler-owned `role`, and optional compiler-owned `money_evidence` and `permitted_intent_terms`. `surface` is `door` or `job_packet`. Roles are `prose`, `hero`, `cta`, `reassurance`, `stat_value`, `time_claim`, `legal`, `quotation`, `accessible` and `derived_count`. The compiler supplies these annotations after its own trusted extraction and citation closure; a writer/model must never supply its own exemption, role or evidence approval.

`permitted_intent_terms` protects exact reviewed symptom/query phrases such as "Dishwasher not draining" from rule 1 only. Terms come from the compiler's bound intent review, contain at least two words, and match case-insensitively at Unicode token boundaries. A whole heading equal to the reviewed query is valid. Terms cannot contain markup, controls, regex operators or wildcard syntax, and cannot erase a separate denial: "Dishwasher not draining: not another pitch" still fails. Original text remains subject to every other rule. This annotation grants no semantic approval to a supplied query or alias.

The result has `ok`, `review_required`, `findings`, `scope`, `semantic_approval:false` and the derivative's LF hash. `ok` means no mechanical blocker. Review findings remain unresolved review work even when `ok` is true. Findings contain only fixed codes, array-index pointers and severities; no matched text, customer content, unknown key or supplied identifier is echoed.

| Source rule | Implemented boundary |
| --- | --- |
| 1, lines 104-145 | Negation in hero/CTA/reassurance blocks fails after exact compiler-reviewed symptom/query spans are excluded from this rule only. Other matches require review because safety, scope and recognized-alternative exceptions depend on meaning. |
| 16, lines 675-724 | Explicit backstage vocabulary fails on public door copy. Broader vocabulary candidates require review; household/trade-word and provider-packet exceptions are retained. |
| 17, lines 725-758 | Meta-copy regex matches are review candidates; genuine work estimates cannot be rejected solely by a word count. |
| 18, lines 759-792 | Virtue-claim regex matches require review; teaching a third-party criterion is an explicit exception. |
| 25, lines 1014-1066 | Unhedged outcomes and statements speaking for a third party produce review findings exactly as the source specifies. They are not automatic factual verdicts. |
| 36, lines 1448-1481 | Declared numeric stat values/time claims must start with a digit, `$` or `#`. Number words otherwise require review after the explicit idiom exemptions. Compiler-created count spans bypass only this number-word review. |
| 39, lines 1571-1625 | Approved-name case drift and missing CHI trademark fail; accessible labels retain their stated case exception. Paraphrase and page-level LIVE density candidates require review. |
| 50, lines 2006-2061 | The repaired word-boundary regex finds effort-praise candidates, including the known rejected headline. The relational judgment remains a review finding: praise for buying a house is not praise for completing our flow. |
| 51, line 2062 onward | The repaired money-token regex requires a trusted source or illustrative annotation on door blocks. Every money token fails on a Job Packet, even when sourced, quoted or legal. It is not a blanket ban on sourced page prices. |

Control/BOM characters and malformed inputs fail for every role. Quotes and legal text retain their words under the source exceptions, while control and packet-price checks still run. The matching view normalizes CRLF and curly apostrophes; original text and caller objects are unchanged. The small `rules.json` is trusted compiled data and is independently hash-checked; submitted text is never executed. Validated compiler-owned intent terms are escaped as literal phrases when constructing their bounded matcher.

## Checks and remaining scope

Run `node --import tsx tools/door-v44/wording.ts` for source/derivative verification plus real positive/negative mechanical smoke cases. It reads only fixed relative inputs beneath the supplied `--root` and writes no files. Exit 0 verifies that limited scope; exit 1 is a failed verification/check, exit 2 is a CLI/input error. No package script was added because the original input contract pins package.json and the lockfile.

The 47 focused tests cover exact byte preservation, admitted encodings across all four inputs, malformed metadata encodings, tamper rejection, source-backed violations, review-only cases, exact reviewed symptom phrases, malformed exemption context, exceptions, packet-versus-door prices, private diagnostics and deterministic behavior. All 69 original pinned files plus the original input manifest are checked before and after the suite. Focused ESLint passes. The receipt records the current combined nonincremental typecheck outcome, including any concurrent-file errors outside this unit.

The original quarantined input receipt still truthfully reports no clean source/twin. This separate derivative supplies clean mechanical escape syntax only. Sentence meaning, actual price provenance, correct placement/roles, per-section LIVE density, quoted/legal approval, visual/copy quality, the remaining WORDING mechanisms and independent A06/human review are not established by these regexes. The corrected derivative is not an independent twin and never supplies semantic approval.
