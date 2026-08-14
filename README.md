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
before changing anything. Conflicts between documents are never resolved
silently — they become Owner Decision items.

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

Wave 0 (canon + frozen contracts). No customer-facing features exist yet.
See docs/canon/gates/ for the current gate report.
