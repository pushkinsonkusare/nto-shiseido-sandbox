# `public/` — runtime static assets

Anything in this folder is served verbatim from the site root by Vite.
A request for `/Dji_product_images/foo.jpg` resolves to
`public/Dji_product_images/foo.jpg`.

## What's tracked here

Small, intentional UI assets only:

| File                     | Used by                                     |
| ------------------------ | ------------------------------------------- |
| `Welcome_cover.jpeg`     | Storefront welcome card background          |
| `assistant-promo-bg.png` | Sidecar / side-by-side assistant promo card |

These are committed because they're tiny (<100 KB each) and bespoke to
the prototype.

## What's intentionally NOT tracked: `public/Dji_product_images/`

The product imagery (~200 MB across ~1,300 files) is git-ignored — see
the `public/Dji_product_images/` rule in `.gitignore`. The app needs
the files at runtime, but they're scraped/downloaded data, not source
code, so we keep them out of git to avoid bloating the repo.

Expected layout when populated locally:

```
public/Dji_product_images/
├── Image_URL/    ← primary product image, one per SKU       (~26 MB)
├── Image_URL1/   ← gallery image #2, where available        (~24 MB)
├── Image_URL2/   ← gallery image #3                         (~25 MB)
├── Image_URL3/   ← gallery image #4                         (~18 MB)
├── Image_URL4/   ← ...                                      (~17 MB)
├── Image_URL5/                                              (~14 MB)
├── Image_URL6/                                              (~14 MB)
├── Image_URL7/                                              (~12 MB)
├── Image_URL8/                                              (~12 MB)
├── Image_URL9/   ← gallery image #10 (most SKUs end earlier) (~9 MB)
└── marketing-assets/
    ├── Product type/      ← curated hero shots, one per product family
    ├── activity-type/     ← lifestyle imagery keyed to detected activities
    └── activity-banner/   ← landscape banners used by WingmanPlanHero
```

Filenames inside `Image_URL{,1..9}/` are content hashes (e.g.
`7bc6abc0a2ca95deb397607983d10a9d.jpeg`); the mapping from SKU to
filename lives in the `Image_URL`...`Image_URL9` columns of
`data/dji_products_tagged_v6.csv`.

## How to repopulate from scratch

If `public/Dji_product_images/` is missing or partial:

1. **Product gallery (`Image_URL{,1..9}/`)** — re-run the catalog
   scraper. Image URLs come straight from the JB Hi-Fi PDPs referenced
   in `data/dji_products_tagged_v6.csv`. The download step is not
   currently in `scripts/` (only the metadata scraper is) — fetch each
   URL into the matching `Image_URL{N}/` folder using the hashed
   filename from the CSV.
2. **Marketing assets** — manually curated. Restore from your team's
   shared drive / Figma export folder. There's no regeneration script
   for these; treat them as deliberate creative choices.

The app degrades gracefully when an image is missing (you'll see broken
image placeholders in product cards), but the visual prototype really
needs at least `Image_URL/` populated to look right.
