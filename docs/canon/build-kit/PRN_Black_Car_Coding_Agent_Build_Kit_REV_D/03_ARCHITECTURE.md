# Architecture — Revision D

## One engine, many skins
Website, API, MCP and agents invoke the same typed domain capabilities. No important business rule lives only in a screen or prompt.

## Suggested stack
Next.js/TypeScript; Supabase Postgres/Auth/Storage/RLS; OpenAI API via AIAdapter; Google Places via PlaceResolverAdapter; Resend EmailAdapter; Telnyx MessagingAdapter; Vercel; GitHub; Web Share API.

## Domain boundaries
problem, property, packet, trust, providers, privacy, search, feature-lab, platform/ai, actions, auth, events, workflows, adapters, agents.

## Permanent rules
- PRN UUIDs canonical; vendor IDs secondary.
- User/raw input preserved separately from normalized/derived data.
- Vendor adapters replaceable.
- Public routes cannot read raw private evidence.
- Dev/preview/prod separated.
