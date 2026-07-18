#!/usr/bin/env python3
"""Scrape the "What's in the Box?" / "In The Box" section from every JB Hi-Fi
product PDP referenced in `data/dji_products_tagged_v6.csv` and write the
result back as a new `In_The_Box` column.

Items inside a single product are joined by ` | ` (vertical bar with surrounding
spaces) so the column round-trips cleanly through CSV parsers and is easy for
the catalog loader (`src/catalog/catalog.ts`) to split.

Usage
-----

    python3 scripts/scrape_in_the_box.py            # scrape + write CSV in place
    python3 scripts/scrape_in_the_box.py --dry-run  # report only, do not write
    python3 scripts/scrape_in_the_box.py --refresh  # ignore HTML cache

Caches every fetched PDP under `/tmp/jbhifi-scrape/cache/<slug>.html` so
re-runs only fetch missing or short pages.
"""

from __future__ import annotations

import argparse
import csv
import html as ihtml
import os
import re
import sys
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

REPO_ROOT = Path(__file__).resolve().parent.parent
CSV_PATH = REPO_ROOT / "data" / "dji_products_tagged_v6.csv"
CACHE_DIR = Path("/tmp/jbhifi-scrape/cache")
CACHE_DIR.mkdir(parents=True, exist_ok=True)

UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)

# Heading patterns: case-insensitive, optional question mark, both
# straight (') and curly (') apostrophes.
HEADING_PATTERN = (
    r"(?:What['\u2019]?s\s+in\s+the\s+[Bb]ox\??|In\s+[Tt]he\s+[Bb]ox)"
)

# JB Hi-Fi pages embed the rendered HTML inside a JS string in the bundled
# state, so the markup arrives JSON-string-escaped (`\\r\\n`, `\\u003c`, …)
# instead of as live DOM. Decoding those sequences first lets a single
# regex match every product's section regardless of which copy of the
# content we land on.
HTML_BLOCK_RE = re.compile(
    r"<strong>\s*"
    + HEADING_PATTERN
    + r"\s*(?:<br[^>]*>)?\s*</strong>"
    r"(?:\s*</p>\s*<p[^>]*>)?"
    r"(.*?)</p>",
    re.IGNORECASE | re.DOTALL,
)
TEXT_BLOCK_RE = re.compile(
    r"\b" + HEADING_PATTERN + r"\b\s*\n"
    r"([\s\S]*?)"
    r"\n\s*(?:Specifications|Disclaimers|Compatibility|Warning|Caution|\*\s|\Z)"
)
QUANTITY_LINE_RE = re.compile(r"\d+\s*[xX×]\s*")


def slug_from_url(url: str) -> str:
    return url.rstrip("/").split("/")[-1]


def cache_path(url: str) -> Path:
    return CACHE_DIR / f"{slug_from_url(url)}.html"


def fetch(url: str, refresh: bool = False, retries: int = 4) -> str:
    """Fetch the PDP HTML, using the on-disk cache when sized > 50 KB.

    JB Hi-Fi sits behind Cloudflare and rate-limits hot loops with HTTP 429.
    On a 429 we honour `Retry-After` (or fall back to 60-90s of exponential
    backoff) before retrying. Other transient errors get a shorter linear
    backoff. The cache file is only written on a 2xx so a botched response
    body never poisons future runs.
    """

    target = cache_path(url)
    if not refresh and target.exists() and target.stat().st_size > 50_000:
        return target.read_text(encoding="utf-8")
    last: Exception | None = None
    for attempt in range(retries + 1):
        try:
            req = Request(url, headers={"User-Agent": UA})
            with urlopen(req, timeout=20) as response:  # noqa: S310 — known host
                data = response.read().decode("utf-8", errors="replace")
            target.write_text(data, encoding="utf-8")
            return data
        except HTTPError as exc:
            last = exc
            if exc.code == 429:
                retry_after = exc.headers.get("Retry-After") if exc.headers else None
                try:
                    backoff = int(retry_after) if retry_after else 60 + 30 * attempt
                except ValueError:
                    backoff = 60 + 30 * attempt
                print(
                    f"    rate limited ({url.split('/')[-1]}); sleeping {backoff}s "
                    f"[attempt {attempt + 1}/{retries + 1}]",
                    flush=True,
                )
                time.sleep(backoff)
                continue
            time.sleep(1.0 * (attempt + 1))
        except URLError as exc:
            last = exc
            time.sleep(1.0 * (attempt + 1))
        except Exception as exc:  # noqa: BLE001 — log + retry on anything
            last = exc
            time.sleep(1.0 * (attempt + 1))
    raise RuntimeError(f"fetch failed for {url}: {last}")


def deep_decode(html_source: str) -> str:
    """Decode the JS-string and JSON-string escapes that JB Hi-Fi uses to
    embed rendered HTML inside the bundled page state, so the regex below
    can match the markup uniformly across product variants."""

    decoded = re.sub(
        r"\\u00([0-9a-fA-F]{2})",
        lambda m: chr(int(m.group(1), 16)),
        html_source,
    )
    return (
        decoded.replace("\\/", "/")
        .replace("\\r\\n", "\n")
        .replace("\\n", "\n")
        .replace("\\r", "\n")
        .replace("\\t", " ")
        .replace('\\"', '"')
        .replace("\\'", "'")
    )


def parse_html_block(body: str) -> list[str]:
    pieces = re.split(r"<br\s*/?>", body)
    items: list[str] = []
    for piece in pieces:
        text = re.sub(r"<[^>]+>", "", piece)
        text = ihtml.unescape(text).replace("\xa0", " ")
        text = text.strip(" \t\r\n;,.")
        if text:
            items.append(text)
    return items


def parse_text_block(body: str) -> list[str]:
    items: list[str] = []
    for raw in body.split("\n"):
        line = raw.strip(" \t;,")
        if not line:
            continue
        if QUANTITY_LINE_RE.search(line):
            items.append(line)
        elif items and len(line) < 80 and not re.match(r"^[A-Z][a-z]+:", line):
            # A continuation/wrap line; glue onto the previous item.
            items[-1] = f"{items[-1]} {line}"
    return items


def extract_items(html_source: str) -> tuple[list[str] | None, str | None]:
    decoded = deep_decode(html_source)
    for body in HTML_BLOCK_RE.findall(decoded):
        items = parse_html_block(body)
        if items:
            return items, "html"
    text_match = TEXT_BLOCK_RE.search(decoded)
    if text_match:
        items = parse_text_block(text_match.group(1))
        if items:
            return items, "text"
    return None, None


def join_items(items: list[str]) -> str:
    """Encode items for CSV storage. Avoids commas / newlines / semicolons that
    would interfere with downstream CSV parsing or be mistaken for sentence
    boundaries by the catalog loader."""

    return " | ".join(item.replace(" | ", " / ") for item in items)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="Do not write the CSV.")
    parser.add_argument("--refresh", action="store_true", help="Ignore the cache and re-fetch.")
    parser.add_argument(
        "--delay",
        type=float,
        default=0.8,
        help="Seconds to sleep between PDP fetches (default 0.8). "
        "JB Hi-Fi's Cloudflare aggressively 429s burst traffic.",
    )
    parser.add_argument("--limit", type=int, help="Optional cap on rows for quick testing.")
    args = parser.parse_args()

    with CSV_PATH.open(encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        fieldnames = list(reader.fieldnames or [])
        rows = list(reader)

    if "In_The_Box" not in fieldnames:
        # Insert next to the other description-y columns so the CSV stays
        # navigable when opened in a spreadsheet.
        anchor = "Specs"
        if anchor in fieldnames:
            fieldnames.insert(fieldnames.index(anchor) + 1, "In_The_Box")
        else:
            fieldnames.append("In_The_Box")

    if args.limit:
        rows = rows[: args.limit]

    # Dedupe by Product_URL: there are far more rows than unique URLs (the
    # CSV has multiple SKU variants pointing at the same JB Hi-Fi PDP), so
    # we fetch each unique URL once and fan the result back to every row
    # that shares it. Saves ~45% of the network round-trips for v6.
    unique_urls: list[str] = []
    seen: set[str] = set()
    for row in rows:
        url = row.get("Product_URL", "").strip()
        if url and url not in seen:
            seen.add(url)
            unique_urls.append(url)

    print(
        f"Scraping In_The_Box for {len(rows)} products "
        f"({len(unique_urls)} unique URLs) at {args.delay}s/request …",
        flush=True,
    )

    items_by_url: dict[str, list[str]] = {}
    miss_status: dict[str, str] = {}

    for index, url in enumerate(unique_urls, start=1):
        try:
            html_source = fetch(url, refresh=args.refresh)
        except Exception as exc:  # noqa: BLE001
            miss_status[url] = f"fetch-error: {type(exc).__name__}"
            if index % 20 == 0 or index == len(unique_urls):
                print(
                    f"  {index}/{len(unique_urls)}  ok={len(items_by_url)} "
                    f"miss={len(miss_status)}",
                    flush=True,
                )
            continue
        items, _source = extract_items(html_source)
        if items:
            items_by_url[url] = items
        else:
            miss_status[url] = "no-section"
        if index % 20 == 0 or index == len(unique_urls):
            print(
                f"  {index}/{len(unique_urls)}  ok={len(items_by_url)} "
                f"miss={len(miss_status)}",
                flush=True,
            )
        # Be polite — Cloudflare 429s a hot loop within seconds.
        time.sleep(args.delay)

    # Fan results back to all rows.
    for row in rows:
        url = row.get("Product_URL", "").strip()
        items = items_by_url.get(url)
        row["In_The_Box"] = join_items(items) if items else ""

    rows_with_items = sum(1 for r in rows if r.get("In_The_Box"))
    print(
        f"\nExtraction summary: {len(items_by_url)}/{len(unique_urls)} unique URLs "
        f"-> {rows_with_items}/{len(rows)} CSV rows populated"
    )

    if miss_status:
        # Bucket misses by reason for a useful summary.
        buckets: dict[str, int] = {}
        for status in miss_status.values():
            key = status.split(":", 1)[0]
            buckets[key] = buckets.get(key, 0) + 1
        print("\nMiss breakdown:")
        for key, count in sorted(buckets.items(), key=lambda kv: -kv[1]):
            print(f"  {key}: {count}")
        # Show a few examples of each.
        print("\nFirst 8 misses:")
        for url, status in list(miss_status.items())[:8]:
            print(f"  - {url.split('/')[-1]:60s}  ({status})")

    if args.dry_run:
        print("\n[dry-run] CSV not written.")
        return 0

    tmp_path = CSV_PATH.with_suffix(".csv.tmp")
    with tmp_path.open("w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            for col in fieldnames:
                row.setdefault(col, "")
            writer.writerow({col: row.get(col, "") for col in fieldnames})
    tmp_path.replace(CSV_PATH)
    print(f"\nCSV written: {CSV_PATH}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
