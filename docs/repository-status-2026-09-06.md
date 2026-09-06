# Repository delivery — September 6, 2026

This repository contains the completed local demo and verified v43 integration
checkpoint. It is a source delivery with automatic hosting paused.

## Included source

- `/demo` introduces the AC walkthrough; `/demo/all` lists the demonstration routes.
- A fresh synthetic sample runs through shared intake and runtime interfaces, with
  request ownership, results, packet/PDF, sharing, revocation and email-preview paths.
- Normal intake has governed AI and equipment-label adapters. A fresh checkout has
  no credentials or enabled live AI policy; tests and synthetic samples need no model call.
- The six original illustrated feature HTML files remain byte-for-byte equivalent
  after Git line-ending normalization. The serving adapter labels them as concept
  previews. Their illustrated schedules, provider operations, quote analysis and
  historical home records are not evidence of active services.
- The frozen AC v43 SEO template is bound to a separate template-specific PageSpec,
  with 15 sections, 11 source bindings and 9 capability questions. The renderer,
  A05/A06 integration, release checks, staged preview and audit tools are included.

## Provenance and verification boundary

The completed product checkpoint was `a0fbb9f6920da72cbc2fa29df964e4710eec736d`.
The v43 integration adds the exact 97-file patch verified in the private shared
audit on September 6. Public delivery adds portable fixture paths, sanitized setup
notes, this status document and the explicit hosting hold. It preserves the
existing public repository's ancestry instead of importing private Git history.

The v43 integration previously passed 2,310 tests, followed by 37 focused checks,
production build, lint, typecheck and desktop/mobile inspection after final runtime
repairs. The delivery receipt in the shared vault records fresh checks against this
isolated public snapshot. Historical gate reports describe their dated checkpoints;
they do not supersede this current-state note.

The isolated checkout's complete 167-suite / 2,310-test run passed after removing
private machine dependencies from the tests. The package-only security follow-up
pins Next.js 15.5.25 and Sharp 0.35.4, with a scoped Next PostCSS 8.5.26 override.
The subsequent 57 image/media/PDF/HTTP/v43 checks passed, as did the production
build with lint and type validation and all 42 static generations. The fresh
dependency audit reports zero known vulnerabilities. These checks do not replace
hosted environment verification or the remaining product acceptance work.

## Open boundaries

The generated SEO draft remains rejected. The frozen v43 audit reports release
blockers involving claim/source verification, capability runtime evidence and
production readiness. The template's inherited source links are not new source
verification. Legacy sample drafts that pass deterministic checks are not the
v43 release and do not establish completed AI review or production readiness.

The separate completeness audit found intake/packet field coverage, equipment
propagation, onset-date, unsupported packet statements and feature-feedback receipt
defects. Those repairs remain tracked work. The concurrent admin-console rebuild
is excluded from this checkpoint until it has its own verified delivery.

The local demo is verified in its recorded environment. External invitation/server
startup remains pending, so there is no verified client-shareable demo URL in this
delivery. Production origin, sitemap, capability evidence, provider/privacy and
cross-machine requirements remain open. Keep noindex and all deferred activation
boundaries intact.

## Fresh checkout

Verification uses Node.js 24.14.1 and npm 11.11.0. Use Node.js 24 for the
native ESM test loader and npm lockfile workflow, then run:

```sh
npm ci
npm run check
npm run build
npm run demo
```

See `.env.example` for configuration names and the [demo guide](client-demo.md)
for runtime details. Do not commit local env files, credentials, private media,
request records, policy activation files or invitation links. Runtime files under
`data/runtime/` are intentionally ignored.

## Hosting hold

`vercel.json` sets `git.deploymentEnabled` to `false`. Vercel documents this as
disabling automatic Git deployments for all branches. The existing `/feature/`
noindex headers are retained. [Official configuration reference](https://vercel.com/docs/project-configuration/git-configuration).

This repository update is not a deployment request. Use the established authorized
hosting workflow for a future release; only restore automatic deployments as a
deliberate part of that release, after its required checks. A later Git push must
not silently lift the hold, noindex or deferred feature activation.
