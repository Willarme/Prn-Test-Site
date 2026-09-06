# Missy demo preview — 2026-09-05

Run `npm run demo` from this repository. The dedicated launcher uses localhost port **3188**, the **`.next-codex-demo`** build directory, the file store at **`data/runtime/missy-demo-20260905`**, and email preview mode. Open `http://127.0.0.1:3188/ac-blowing-warm-air`. This is a local preview; running it does not publish the site or send external email. Keep synthetic demo records and runtime files out of the shared vault and Git.

## Fresh-machine AI setup

Run `npm ci`, place the machine's authorized OpenRouter key in the gitignored `.env.local`, and initialize the local demo AI policy below. The checked-in `config/demo-ai-policy.json` contains model names and existing test budgets only, never a key. It selects DeepSeek Flash for text and Gemini Flash Lite for equipment-label photos. Preserve any existing machine policy. A missing key or disabled policy uses the governed deterministic fallback.

```powershell
if (-not (Test-Path -LiteralPath data/ai-policy.json)) {
  Copy-Item -LiteralPath config/demo-ai-policy.json -Destination data/ai-policy.json
}
```

This opt-in configuration is for the local demo. It does not clear a production deployment or change the shipped all-off defaults. `tools/demo-live-check.ts` is an explicit live HTTP check against the running local demo and requires a synthetic label JPEG; it is not part of the offline test suite.

## Current template and replacement seam

The approved reference is committed at `content/door-template/v43/reference/approved-v43.html`. The runnable demo asset is `content/doors/ac-blowing-warm-air.html`. Both `/ac-blowing-warm-air` and `/problems/ac-blowing-warm-air` serve that one asset through `src/app/problems/ac-blowing-warm-air/route.ts`; the canonical route re-exports its GET handler. There is no second React reconstruction of the door.

All 15 sections remain in approved Order B, including RELATED directly before CLOSER. Its original `/no-hot-water` destination is a working scope page: it says the guided trial currently covers AC and offers the general description entry. It does not pretend a hot-water guided playbook is available.

The reviewed reusable kit is committed at `content/door-template/v43/`. From the repository root, run `node tools/sync-door-template.mjs --check` to verify its pinned source, binding and rendered output. The standalone demo's earlier template preparation used these source conventions:

- `template/scripts.html`: normal-flow anchors use `scrollIntoView`; the removed `snapEnabled` branch referenced an undefined variable. The separate deck-mode handler remains intact.
- `spec/ac-blowing-warm-air-wired/`: trial intake attribution and the original RELATED link.
- `tools/order-B-no-related.json`: despite its legacy filename, now explicitly contains all 15 sections. The filename is retained for existing build-command compatibility.

When the next approved template arrives, retain it as the new reference and replace the runnable HTML asset without rewriting approved copy or illustrations. Preserve the intake form contract (`home-problem-intake`, `problem_description`, multipart controls, and the POST `/api/intake/start` action). Reapply/check the small normal-flow anchor fix if the replacement still contains the undefined branch. Keep runtime integration in the serving adapter: brand-token substitution, the active disclosure text/hash, bounded submission errors, and session-only description recovery. Do not paste a fixed disclosure hash into the asset. Run the contract tests below and inspect the actual replacement in a browser; matching an older v41 byte hash is not an acceptance condition.

## Feature previews and backend boundaries

The six approved Claude Design assets stay in `public/feature/`, with `support.js` and the vendored runtime alongside them. `src/app/pages/[...path]/route.ts` maps them to `/pages/overview`, `/pages/dashboard`, `/pages/trust-network`, `/pages/smartquote`, `/pages/home-memory`, and `/pages/provider-os`. It rewrites inter-page links and applies `src/platform/pages/preview-feedback.ts` at serve time. Use these `/pages/` URLs for the demo; the raw `/feature/` files are source assets and bypass the functional adapter.

That adapter preserves frozen artwork and marketing words while wiring all six vote blocks, including Provider OS, to `/api/signup`. Recorded/thanks states appear only after the runtime store confirms the write. Failures preserve entries and offer retry. Replacing a feature asset means replacing its source HTML, then rerunning the behavior tests to verify its component slots still match the adapter.

Each served concept page also has a separate scope notice outside the frozen artwork: illustrated product states, including embedded “REAL NOW” labels, are examples. Those frozen labels are not evidence that provider call handling, scheduling, quotes, or customer dashboards have been implemented. Link rewriting lives in `src/platform/pages/inter-page-links.ts`; the Next route exports only its supported GET handler.

SmartQuote, dashboard, Trust Network, Home Memory, and Provider OS are interactive concept previews. Their vote/signup collector is real. Their illustrated quote comparisons, dashboard records, provider operations, and concept interactions do not establish complete production services, provider matching, customer accounts, or automatic commercial actions.

The actual local backend loop is description/media intake → persisted details and guided checks → results → Job Packet/PDF → scoped keep/share/ask links and stored email previews. Results, completion, email, feedback, and packet-owner actions require a signed request owner cookie or the matching keep capability `k`. Owner links preserve that capability across pages; public recipient shares use their narrower packet capability. An arbitrary request ID does not grant owner access. Capability-bearing pages suppress referrers.

Attachments that fail on the first door submission are reported on completion and can be retried on the existing request. Literal supplied facts and the persisted question plan are consumed without intentionally asking the same fact twice. The new question-plan persistence currently supports the local file-store demo; production database migration is separate work. “Start a new walkthrough” creates a new request instead of claiming to reset existing saved checks. “Find someone for me” states that the matched shortlist is still being built and links to the existing packet/call script.

Saved voice evidence receives an explicit “Voice note received, not transcribed” receipt. After a Home Memory claim, a separate accessible “Saved to Home Memory” receipt appears only when the current claim matches the actual confirmed ledger; adding `?kept=1` alone cannot produce it. Provider sharing offers a recipient preview of the actual packet-scoped link, and generated provider/keep/ask links are recorded for later management. Text/email buttons prepare the homeowner's own application; they are not proof of delivery.

The frozen results card also mentions saving a provider to “your people.” The send page makes the present boundary visible: “This demo prepares your message. A saved Your People address book is not available yet.” Entered provider contact details address the message; this flow does not persist a contact book.

## Checks

### Resumed demo, September 5 evening

The live AC v43 asset remains unchanged. Its serving adapter now keeps all three attachment controls within a measured 375px viewport. The three standalone diagram SVGs and opaque PNG derivatives are in `public/images/`; `config/ac-door-assets.json` records their dimensions and source version. Metadata uses real image files and the reviewed source date. Regenerate derivatives with `node tools/build-door-images.mjs`. The reusable vault kit verifies the independently pinned v43 reference, allowing only the derived date and the already-reviewed anchor fix. Standard external `<img>` replacement is still pending font/render parity; the approved inline diagrams remain.

The door POST returns relative redirects so opening the demo at `127.0.0.1` does not switch to `localhost` and lose its owner cookie. Later literal observations fill only missing fields. Conflicting brand/age reports stay visible beside the retained value and in the packet until the homeowner chooses the correct value; questions or historical remarks do not become current facts. Skipped checks remain not checked, and terminal guidance does not invent completed repairs or observations. A later safety report persists as private evidence and halts completion, results, ordinary sharing/email, and packet/PDF access. Unknown recorded safety rules fail closed. Supabase evidence reads include request-owned rows, so a concurrent attachment cannot hide a hazard by overwriting the denormalized evidence-ID list.

The packet's narrow-screen header, urgency badge and counters now fit at 375px. The repair is attached with `media="screen"`; the approved print stylesheet is unchanged. Actual rich/thin/halted PDF fixtures remained 3/3/1 pages, with all seven raster pages pixel-identical when that screen stylesheet was removed.

AI admission now reserves the existing allowance atomically before a provider call; retries and JSON repair share it. Unknown billing remains held across restarts and UTC midnight. Missing or inconsistent token counters cannot become a zero-dollar charge. This protects processes sharing the local ledger; it is not a global serverless budget or a guarantee that provider billing cannot exceed an estimate.

A05's existing governed writer is now connected to eligible new-page staging after approval, duplicate and input gates. Only its answer/provider blocks are writable; approved safety blocks remain fixed, rejected output falls back, and bounded hazardous-action checks apply to all generated bodies. Source-ID membership is not proof of factual support. A06 stores its actual critic verdict and refuses release after `FAIL`, including when findings are major rather than blocker.

`npx tsx tools/demo-seo-check.ts --live` explicitly spends under the existing local policy in an isolated synthetic store. It does not publish. On this session's real run the writer completed and the critic rejected the generic draft, so the command correctly remains a failing content-acceptance check. Its receipt and a no-network replay prove that rejection is retained by the publication gate. `npx tsx tools/replay-seo-critic-receipt.ts <local-receipt.json>` reapplies the retained verdict only to its unpublished isolated demo store. This is the typed PageSpec pipeline; it does not establish completion of the v43 SEO-template migration or a publication-ready new page.

These September 5 checks describe the local demo checkpoint. The frozen v43 staging integration is included in this source snapshot; a rejected draft remains unpublished, and source, capability and production-release evidence gates remain separate from local render verification. A verified external client invitation is still pending.

Final resumed suite: **158 files / 2175 tests passed**, starting September 5 at 22:57:36 local time, in 163.52 seconds. Full lint and the standard production build passed. Run `npm test` and `npm run build` sequentially: overlapping runs in this session produced missing-page build errors; the standard build passed after the test server ended. Temporary `.next-*` type includes added by Next should not be committed as project configuration.

Focused UX check (65 tests passed together on 2026-09-05 at 19:28 UTC):

```powershell
npx vitest run tests/loop.ux.preview-feedback.test.ts tests/loop.f1.door-and-pages.test.ts tests/loop.f1.signup.test.ts tests/loop.f1.door-adapter.test.ts tests/loop.p2.results-template.test.ts tests/loop.p2.email-route.test.ts tests/loop.p2.feedback-api.test.ts tests/loop.p2.send.test.ts
```

The preview behavior tests execute the transformed logic of all six real assets, hold collector responses pending, reject writes, and retry with the same vote ID. Door tests verify all 15 sections, known error rendering, preserved wording, and mixed accepted/rejected attachment receipts. Results tests compare the frozen visible strings. Email tests use the local outbox and forbid network delivery.

Also run `tests/loop.p4.pages.test.ts`, `tests/loop.p4.walkthrough.test.ts`, and the playbook exposure/position/walkthrough suites after changing completion. Their HTTP fixtures carry the signed owner cookie actually returned by intake. Run the full repository tests, lint, and typecheck after all concurrent changes settle. Build-generated `.next-*` type files must not be deleted or rewritten during that typecheck.

Browser review remains necessary for the actual served asset: source-disclosure and intake anchors, all 15 sections, first-description flow, media recovery, held facts/question order, packet/PDF, keep/claim/share, email preview, and all six vote blocks. Passing code tests alone is not a claim that every browser interaction has been checked or that the demonstration is available externally.
