# Seed Research Workbook → SearchOpportunity import map

Source: `tests/fixtures/seed-research/Trial_Run_Home_Tools_Keyword_SERP_Research.xlsx`
(owner research, dated 2026-08-10). Seed data for testing the Door Wave 1
importer before DataForSEO fills the pipeline autonomously. NOT authority.

## Sheets to import (~119 keyword rows before dedupe)

| Sheet | Header row | Rows | Notes |
|---|---|---|---|
| Researched Opportunities | 1 | 22 | fullest rubric + Opportunity Score |
| Validation Queue | 1 | 10 | all rows populated |
| Low-KD Hunt Queue | 1 | 31 | metric columns 100% empty = work orders, import with null metrics + needs-enrichment status |
| Trial - Calculators | 4 | 16 | rows 1–2 are merged banners |
| Trial - Problem Intent | 4 | 20 | primary D-3 build track |
| Trial - Ahrefs Queue | 4 | 20 | its "Capture From Ahrefs" cell doubles as the DataForSEO enrichment field spec |

Skip as narrative: Dashboard, How To Verify, Trial Summary (volumes embedded
in prose — do not parse).

## Field mapping

- **keyword** ← "Search Term" / "Long-Tail Search Term to Pull" / "Exact Keyword to Pull"
- **volume_monthly** ← "Monthly Volume (public est.)" / "Volume (public est.)" / "Public Volume" / "Ahrefs Volume" — nullable, always provisional
- **keyword_difficulty** ← "KD (public est.)" / "SEO KD (public est.)" / "Public SEO KD" / "Ahrefs KD" — **KD 0 is a real value; blank = null.** NEVER map "Difficulty / Competition Type" (Google Ads competition text — the workbook itself warns it is NOT SEO KD)
- **cpc_usd** ← CPC columns (float USD, nullable)
- **cluster_label** ← "Cluster" / "Service Cluster" / "Track" / "Parent Tool"
- **opportunity_score** ← "Opportunity Score" (0–100); rubric sub-scores → score_components
- **status hints** ← "Recommendation" / "Decision" / "SERP Status" enums (RESEARCH FIRST, VALIDATE, SKIP HEAD TERM, GREENLIGHT FOR AHREFS CHECK, …)
- **serp evidence** ← "SERP Example URLs" split on `" ; "` (1–3 URLs) + "SERP Gap 1–5" + gap-notes prose
- **provenance** ← "Metric Source Type" / "Metric Source URL" / "Metric Confidence / Caveat"
- **researched_at** ← "Research Date" (true Excel datetime, all 2026-08-10)
- **geography** ← ABSENT in workbook. Default US-national with `geography_assumed: true`

## Importer hazards (all confirmed present)

1. Header row varies (1 vs 4); rows 1–2 of Trial sheets are merged banners.
2. Headers contain literal newlines, en/em dashes, ≤ — normalize to snake_case.
3. Same concept, different column names per sheet — use per-sheet alias map.
4. Tier enum differs by sheet ("A - Research first" vs "A — Research/Build").
5. Missing values are prose sentinels ("Needs Ahrefs/Keyword Planner
   validation", "Unknown — must pull") — treat as null with provenance note.
6. Duplicate keywords across sheets — dedupe by keyword with per-sheet
   provenance retained.
7. "Rank" is neither unique nor sequential — priority ordering, not a key.
