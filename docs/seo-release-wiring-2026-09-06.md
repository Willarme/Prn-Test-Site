# SEO release wiring — September 6, 2026

The test site remains a noindex concept/demo preview. The v43 page is still frozen, generated SEO drafts remain subject to A06, and this change grants no capability or production release approval.

The public capability endpoint, `/capabilities/home-problem-analyzer.json`, projects the nine reviewed table rows without internal provenance notes. Every row retains `CLAIMED_ON_PAGE_PENDING_RUNTIME_VERIFICATION`. Its four input fields describe homeowner controls; submitting the real form also requires the current disclosure context. A changed capability row or tool contract makes the endpoint unavailable instead of advertising a different action.

`/sitemap.xml` and `/image-sitemap.xml` return HTTP 204 with `X-PRN-Publication-State: held-noindex` while indexing is held. No staged, rejected, private, or noindex page belongs in a publication sitemap. An empty XML urlset would violate the sitemap schema's required entry, so these held endpoints do not pretend to be production sitemaps. The pure selector and XML builder prepare exact-version publication membership; connecting the real publication store and indexable renderer remains required before launch.

The former proposed `/repair-records/methodology` spelling redirects directly to the established `/local-records/methodology` route. Its preview noindex policy remains.

The GET-only release audit accepts a 204 hold only in preview mode, with the explicit hold header, noindex header, and an empty body. Production mode continues to require HTTP 200 sitemaps containing the canonical page and its images, plus all other production checks. A passing preview audit cannot approve release.

Validation: 115 targeted tests pass, plus lint, type checking and the Next 15.5.25 production build (43 generated static pages). All 68 compiled-site preview HTTP checks pass. The fresh synthetic A05 → A06 → publication run retains 36 blockers, release eligibility false, and zero model calls. The 55 reviewed source inputs retain their exact normalized hashes.

Four read-only checks on the existing deployed page cover JavaScript disabled and reduced motion at desktop and mobile sizes. All 15 sections remain present, all four inputs have labels, native keyboard disclosure exposes the sources and FAQ, and no horizontal overflow or page errors were found. Desktop hover/focus tooltips were checked through actual interaction and remain intentional. This is not a full accessibility, device, performance, runtime-exception or form-submission certification.

Local compiled-route checks and the deployed snapshot are separate receipts. A source update alone does not update the hosted alias; automatic Vercel deployment remains paused.
