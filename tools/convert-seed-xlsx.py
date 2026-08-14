"""
One-time converter: seed research workbook -> seed-rows.json

Reads tests/fixtures/seed-research/Trial_Run_Home_Tools_Keyword_SERP_Research.xlsx
and emits tests/fixtures/seed-research/seed-rows.json with one record per
keyword row, normalized per docs/canon/seed-import-map.md:
  - per-sheet header rows (1 vs 4) and column-alias mapping
  - KD 0 preserved as 0; blanks preserved as null (never coerced)
  - "Difficulty / Competition Type" (Google Ads competition text) is NEVER
    mapped into keyword difficulty
  - prose sentinels ("Needs Ahrefs...", "Unknown - must pull") -> null
  - "SERP Example URLs" split on " ; "
  - geography absent in workbook -> geography_assumed flag set downstream

The TypeScript importer consumes the JSON; this script is the only xlsx
reader and is re-run only if the workbook changes.
"""
from __future__ import annotations

import json
import re
import sys
from datetime import date, datetime
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parent.parent
XLSX = ROOT / "tests" / "fixtures" / "seed-research" / "Trial_Run_Home_Tools_Keyword_SERP_Research.xlsx"
OUT = ROOT / "tests" / "fixtures" / "seed-research" / "seed-rows.json"

# sheet -> (header_row, {normalized_header_prefix: field})
# Prefixes are matched against normalized headers (lowercased, newlines/dashes
# collapsed) so cosmetic differences between sheets do not matter.
SHEETS: dict[str, int] = {
    "Researched Opportunities": 1,
    "Validation Queue": 1,
    "Low-KD Hunt Queue": 1,
    "Trial - Calculators": 4,
    "Trial - Problem Intent": 4,
    "Trial - Ahrefs Queue": 4,
}

KEYWORD_HEADERS = ("search term", "long tail search term to pull", "exact keyword to pull")
VOLUME_HEADERS = ("monthly volume", "volume (public est.)", "public volume", "ahrefs volume")
KD_HEADERS = ("kd (public est.)", "seo kd", "public seo kd", "ahrefs kd")
KD_FORBIDDEN = ("difficulty / competition type",)  # Google Ads competition text, NOT SEO KD
CPC_HEADERS = ("cpc",)
CLUSTER_HEADERS = ("cluster", "service cluster", "track", "parent tool")
SCORE_HEADERS = ("opportunity score",)
TIER_HEADERS = ("tier",)
RECOMMENDATION_HEADERS = ("recommendation", "decision", "serp status", "next validation")
SERP_URL_HEADERS = ("serp example urls",)
SOURCE_TYPE_HEADERS = ("metric source type", "metric confidence / caveat")
SOURCE_URL_HEADERS = ("metric source url",)
DATE_HEADERS = ("research date",)

SENTINEL_RE = re.compile(
    r"needs |unknown|must pull|not yet|not exposed|not found|verify|n/a|tbd|—|^-$",
    re.IGNORECASE,
)


def norm_header(value: object) -> str:
    if value is None:
        return ""
    text = str(value).replace("\n", " ").replace("–", "-").replace("—", "-")
    return re.sub(r"\s+", " ", text).strip().lower()


def match(header: str, prefixes: tuple[str, ...]) -> bool:
    return any(header.startswith(p) or p in header for p in prefixes)


def as_number(value: object) -> float | None:
    """Numeric cell -> number; blank -> None; prose sentinel -> None. 0 survives."""
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip()
    if not text or SENTINEL_RE.search(text):
        return None
    cleaned = text.replace(",", "").replace("$", "")
    try:
        return float(cleaned)
    except ValueError:
        return None


def as_text(value: object) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def as_iso(value: object) -> str | None:
    if isinstance(value, (datetime, date)):
        return value.strftime("%Y-%m-%d")
    return None


def main() -> None:
    wb = openpyxl.load_workbook(XLSX, data_only=True)
    records: list[dict] = []
    per_sheet: dict[str, int] = {}

    for sheet_name, header_row in SHEETS.items():
        ws = wb[sheet_name]
        headers = {col: norm_header(ws.cell(row=header_row, column=col).value)
                   for col in range(1, ws.max_column + 1)}

        def col_for(prefixes: tuple[str, ...], forbidden: tuple[str, ...] = ()) -> list[int]:
            cols = []
            for col, header in headers.items():
                if not header or match(header, forbidden):
                    continue
                if match(header, prefixes):
                    cols.append(col)
            return cols

        kw_cols = col_for(KEYWORD_HEADERS)
        if not kw_cols:
            print(f"WARN: no keyword column in {sheet_name}", file=sys.stderr)
            continue
        kw_col = kw_cols[0]
        vol_cols = col_for(VOLUME_HEADERS)
        kd_cols = col_for(KD_HEADERS, forbidden=KD_FORBIDDEN)
        cpc_cols = col_for(CPC_HEADERS)
        cluster_cols = col_for(CLUSTER_HEADERS)
        score_cols = col_for(SCORE_HEADERS)
        tier_cols = col_for(TIER_HEADERS)
        rec_cols = col_for(RECOMMENDATION_HEADERS)
        serp_cols = col_for(SERP_URL_HEADERS)
        stype_cols = col_for(SOURCE_TYPE_HEADERS)
        surl_cols = col_for(SOURCE_URL_HEADERS)
        date_cols = col_for(DATE_HEADERS)

        count = 0
        for row in range(header_row + 1, ws.max_row + 1):
            keyword = as_text(ws.cell(row=row, column=kw_col).value)
            if not keyword or SENTINEL_RE.search(keyword):
                continue

            def first(cols: list[int], fn):
                for col in cols:
                    value = fn(ws.cell(row=row, column=col).value)
                    if value is not None:
                        return value
                return None

            serp_raw = first(serp_cols, as_text)
            serp_urls = [u.strip() for u in serp_raw.split(";") if u.strip()] if serp_raw else []

            volume = first(vol_cols, as_number)
            kd = first(kd_cols, as_number)
            records.append({
                "sheet": sheet_name,
                "row": row,
                "keyword": keyword.lower(),
                "keyword_raw": keyword,
                "cluster": first(cluster_cols, as_text),
                "volume_monthly": int(volume) if volume is not None else None,
                "keyword_difficulty": kd,
                "cpc_usd": first(cpc_cols, as_number),
                "opportunity_score": first(score_cols, as_number),
                "tier": first(tier_cols, as_text),
                "recommendation_note": first(rec_cols, as_text),
                "serp_example_urls": serp_urls,
                "metric_source_type": first(stype_cols, as_text),
                "metric_source_url": first(surl_cols, as_text),
                "research_date": first(date_cols, as_iso),
            })
            count += 1
        per_sheet[sheet_name] = count

    OUT.write_text(json.dumps({
        "source_workbook": XLSX.name,
        "converted_by": "tools/convert-seed-xlsx.py",
        "per_sheet_counts": per_sheet,
        "rows": records,
    }, indent=2), encoding="utf-8")
    print(f"wrote {len(records)} rows -> {OUT}")
    print(json.dumps(per_sheet, indent=2))


if __name__ == "__main__":
    main()
