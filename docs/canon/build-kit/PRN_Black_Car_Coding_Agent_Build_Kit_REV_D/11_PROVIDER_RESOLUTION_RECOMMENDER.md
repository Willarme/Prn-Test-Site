# Provider Entity Resolution + Recommendation Lite — Revision D

## Autocomplete
Use PlaceResolverAdapter -> Google Places Autocomplete New, biased by geography/category. Tap suggestion -> PRN canonical ProviderEntity. Manual fallback only.

## Canonical identity
provider_id UUID. Support organization/branch/individual + parent_provider_id. Preserve raw user entry + aliases. External IDs are secondary.

## Dedupe
external ID -> phone -> domain -> official license later -> strong fuzzy candidate -> human review. Never irreversible fuzzy auto-merge.

## Recommendation
Eligibility first; then versioned score using trust/fit/geography/freshness/qualified evidence. Return ONE + 2-4 reasons; Show Another; explicit insufficient-evidence fallback. Never invent current availability or credentials.
