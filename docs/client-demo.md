# Client demonstration and full directory

T8-31, requested by Joshua on 2026-09-05. The working local preview is:

- `http://localhost:3188/demo` — client entrance, AC walkthrough and prepared sample.
- `http://localhost:3188/demo/all` — all 21 public demo destinations, request-scoped actions and eight local operator destinations.

These localhost addresses work only on the computer running the demo. They are not client-shareable links.

## What changed

The existing Archivo/Public Sans/JetBrains roles now have a restrained v43-inspired paper header, teal action and ink surround. The new entrance uses the existing AC equipment drawing. Workflow stages keep their own composition. Original AC v43, six concept HTML assets, existing card CSS and packet printing remain unchanged. A serving adapter adds concept navigation and a truthful capability notice; its mobile navigation repair only affects navigation and the decorative founder ribbon.

Sample buttons POST to `/demo/start`, creating a fresh synthetic Carrier AC request through the actual governed A01/A02 and RuntimeStore interfaces. They deliberately do not call a model, send email or fabricate homeowner consent. The sample has its own generated owner cookie and address-ready packet. The normal AC intake can still use the existing DeepSeek Flash policy and narrow equipment-label reader within the shared budget.

Concept previews are `/pages/overview`, `/pages/dashboard`, `/pages/trust-network`, `/pages/home-memory`, `/pages/smartquote` and `/pages/provider-os`. Their feedback controls save responses; illustrated schedules, provider operations, quote analysis and historical home records remain concepts. `/demo/all` also includes the four earlier `/future/` explorations. Keep, ask, send, email preview, media and revocation are reached from a fresh request, never from hardcoded private links.

## Prepared sharing boundary

The client preview uses a separate production Next instance on loopback3189, behind an invite gateway on loopback3190. It excludes the unrelated Vercel account and does not activate production or search indexing.

`node scripts/client-demo.mjs build` creates `.next-client-demo`. `node scripts/client-demo.mjs start` starts that built instance. The launcher selects `data/runtime/client-demo-v1/dev-db.json`, private media, link secret/ledger, question plans, labels and outbox; Supabase and live mail credentials are blanked for this runtime. AI policy and the atomic spend ledger deliberately remain shared with the local demo so starting another server cannot create another spending allowance.

Before starting, set `PRN_DEMO_PUBLIC_ORIGIN` to the actual HTTPS tunnel origin. It is trusted configuration, validated as one origin, and supplies embedded packet/PDF/email links without trusting visitor-supplied forwarding headers. Gateway launch uses the same setting:

```powershell
$env:PRN_DEMO_PUBLIC_ORIGIN = 'https://actual-demo-host.example'
node scripts/client-demo.mjs start
```

In a separate authorized process, `node scripts/demo-gateway.mjs` listens only on127.0.0.1:3190. Each launch creates fresh invitation/session state under `data/runtime/client-demo-v1/gateway-access.json`. Never copy that file or its secret values to the shared vault. The state file's `invite_url` is the client entrance; append `?to=all` for the directory invitation. Uninvited visitors cannot enter, and invitation holders still cannot reach admin/staging/source/internal APIs. Existing per-request ownership remains enforced. The gateway caps request bodies, concurrent requests, timeouts and mutations, and strips untrusted forwarding headers.

For an authorized external demonstration, install `cloudflared` from its official release and verify the download against the published release digest. A quick tunnel can target `http://127.0.0.1:3190`. It creates a temporary random hostname, depends on the computer and processes remaining online, and has no uptime guarantee. This is a supervised demonstration link, not permanent hosting. [Official Quick Tunnel documentation](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/).

After permitted startup, verify the external invitation, all directory routes, a fresh real sample/PDF and a live example intake. Confirm unauthenticated/internal access is refused, packet links contain the external origin and recipient access still needs both the demo invitation and its request capability. Never hand out an unverified hostname as a working demo.

## Current verification and remaining step

The full suite passed 161 files / 2205 tests; the later gateway/origin/sample/email set passed 64 tests; lint and typecheck passed. The final mobile navigation repair passed another 52 focused tests. Local route proof covers 21 HTTP 200 destinations, fresh 303 sample creation, results 200, packet 200, actual application/pdf of 663488 bytes with 3 pages, and stranger packet 404. Desktop and 375px entrance/results/directory were inspected. Final rendered mobile feature navigation has 44px targets and no overlap with the notice or hero.

The client-preview implementation was built successfully with `node scripts/client-demo.mjs build`, including all 42 static generations. From a fresh checkout, install dependencies with `npm ci` and run that build command from the repository root. The launcher selects the separate `client-demo-v1` record, media and access state. Supply any authorized model credential only through the ignored local environment file; never include it in source, documentation or demo links. Starting another preview must not create a second AI spending allowance.

**External preview remains pending.** This source snapshot does not include a verified external invitation. A local build or passing isolated tests does not establish client availability. After authorized startup, complete the external checks above before sharing an invitation or claiming that the client demonstration is available. Keep all invitation/session state and live runtime links outside Git.

The source is replaceable: keep adapters outside `content/doors/ac-blowing-warm-air.html` and `public/feature/`, then rerun source-fidelity and live-flow checks when the upcoming template revision arrives.
