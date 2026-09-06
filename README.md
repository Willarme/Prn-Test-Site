# Property Response Network

The Black Car trial: a homeowner describes a home problem in plain language, the
system asks only the questions that matter, and returns a technician-ready
**Job-Ready Packet** — plus three continuation paths (I already have someone /
Ask My People / Find someone for me).

## The one architecture rule

> Search-intent pages are **doors**, not **brains**. A generated IntentPage may
> render the one shared intake entry component or route users into `/start`, but
> A01/A02 analysis, clarification, record mutation, packet generation, Trust
> logic and provider ranking live only in canonical server/domain capabilities.
> A generated door page must be deletable tomorrow without affecting a single
> customer's ProblemRecord or the intake engine.

## Authority

All build authority lives in [docs/canon/](docs/canon/AUTHORITY.md). Read it
before changing anything. Current project decisions and work orders are maintained
in the shared PRN vault. Its September 5 delegation allows routine implementation
decisions within approved scope; substantive release, consent and activation gates remain.

## Structure

- `docs/canon/` — authority documents, decisions, build kit, gate reports
- `src/domain/` — canonical business contracts and (later) capabilities
- `src/platform/` — events, capabilities registry, agents, adapters, economics
- `src/app/` — UI only; no business logic ever lives here
- `tests/` — contract tests and fixtures

## Commands

```
npm run check     # lint + typecheck + tests (the wave gate command)
npm run dev       # local dev server
```

## Status

The [hosted test preview](https://prn-test-site.vercel.app/demo) was deployed on
September 6. [Deployment evidence and runtime limits](docs/test-site-deployment-2026-09-06.md)
distinguish the verified page preview from the remaining hosted workflow setup.

The September 6, 2026 source checkpoint contains the local AC demo, intake and
results flow, portable packet/PDF, request-scoped sharing controls, concept-preview
directory, and frozen v43 SEO-template integration. Start with
[the delivery status and setup notes](docs/repository-status-2026-09-06.md) and
[the demo guide](docs/client-demo.md).

The illustrated feature services remain concept previews. The generated SEO draft
remains rejected, and production release is still blocked. Repository updates do
not establish a working external demo or a live production deployment.

Automatic Vercel Git deployments are paused in `vercel.json`; deployment remains
an explicit step through the project's authorized hosting setup. Preserve noindex.
