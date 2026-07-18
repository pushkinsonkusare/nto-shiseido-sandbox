/**
 * Deterministic mock text reviews for the product reviews panel's
 * "Product reviews" tab.
 *
 * The catalog only carries aggregate `rating` / `reviewCount` numbers
 * (no review bodies), so this synthesises a small, plausible set of
 * written reviews from the product's own metadata. It's fully
 * deterministic — seeded from the product slug — so a given product
 * always renders the same reviews across reloads, and the generated
 * star ratings cluster around the product's real aggregate rating.
 */

import type { CatalogProduct } from "../../catalog/catalog";

export type MockReview = {
  id: string;
  author: string;
  date: string;
  rating: number;
  title: string;
  body: string;
};

export type ReviewSummary = {
  average: number;
  count: number;
  /** Counts per star, index 0 = 1 star … index 4 = 5 stars. */
  distribution: number[];
};

/* Small deterministic PRNG (mulberry32) so the mock set is stable per
 * product without pulling in a dependency. */
function hashString(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const AUTHORS = [
  "Marcus T.",
  "Priya S.",
  "Jordan L.",
  "Emily R.",
  "Diego M.",
  "Hannah K.",
  "Wei C.",
  "Sofia B.",
  "Liam O.",
  "Nadia F.",
];

const TITLE_TEMPLATES = [
  "Exactly what I needed",
  "Impressed so far",
  "Great value for the money",
  "A solid upgrade",
  "Does the job well",
  "Better than I expected",
  "Would buy again",
  "Nearly perfect",
];

function pick<T>(rng: () => number, arr: T[]): T {
  return arr[Math.floor(rng() * arr.length) % arr.length];
}

/* Round to the nearest 0.5 the way the catalog rating reads. */
function clampRating(value: number): number {
  return Math.max(1, Math.min(5, Math.round(value)));
}

function formatDate(monthsAgo: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - monthsAgo);
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

function buildBody(
  rng: () => number,
  product: CatalogProduct,
  rating: number,
): string {
  const category = product.category || "product";
  const tag = product.useCaseTags[0]?.replace(/_/g, " ");
  const tierPhrase =
    product.tier === "beginner"
      ? "easy to get started with"
      : product.tier === "pro"
        ? "clearly aimed at serious users"
        : "a nice middle-ground pick";

  const openers = [
    `Picked up the ${product.title} a few weeks ago and it's ${tierPhrase}.`,
    `I've been using the ${product.title} for a while now.`,
    `The ${product.title} arrived quickly and setup was painless.`,
    `Coming from an older model, the ${product.title} is a real step up.`,
  ];
  const middles = tag
    ? [
        `It really shines for ${tag} — exactly what I bought it for.`,
        `Handled my ${tag} use case better than I hoped.`,
        `If you care about ${tag}, this ${category.toLowerCase()} delivers.`,
      ]
    : [
        `Build quality feels premium for this ${category.toLowerCase()}.`,
        `Performance has been consistent across everything I've thrown at it.`,
        `It does what it promises without any fuss.`,
      ];
  const closers =
    rating >= 4
      ? [
          "No regrets — highly recommend.",
          "Would happily buy it again.",
          "Five stars from me.",
        ]
      : [
          "A couple of rough edges, but overall happy.",
          "Good, though not without minor niggles.",
          "Solid, with a bit of room to improve.",
        ];

  return `${pick(rng, openers)} ${pick(rng, middles)} ${pick(rng, closers)}`;
}

/**
 * Build a deterministic set of ~5-6 mock reviews for `product`, with
 * star ratings clustered around its aggregate rating.
 */
export function buildMockReviews(product: CatalogProduct): MockReview[] {
  const rng = mulberry32(hashString(product.slug));
  const base = product.rating ?? 4.6;
  const count = 5 + Math.floor(rng() * 2); // 5 or 6

  const reviews: MockReview[] = [];
  const usedAuthors = new Set<string>();
  for (let i = 0; i < count; i += 1) {
    /* Jitter around the aggregate rating: mostly at/above it, with the
     * occasional lower score so the distribution looks organic. */
    const jitter = rng();
    let raw = base;
    if (jitter < 0.15) raw = base - 1.5;
    else if (jitter < 0.35) raw = base - 0.5;
    else raw = base + (rng() < 0.5 ? 0 : 0.4);
    const rating = clampRating(raw);

    let author = pick(rng, AUTHORS);
    let guard = 0;
    while (usedAuthors.has(author) && guard < AUTHORS.length) {
      author = pick(rng, AUTHORS);
      guard += 1;
    }
    usedAuthors.add(author);

    reviews.push({
      id: `${product.slug}-review-${i}`,
      author,
      date: formatDate(1 + Math.floor(rng() * 11)),
      rating,
      title: pick(rng, TITLE_TEMPLATES),
      body: buildBody(rng, product, rating),
    });
  }

  return reviews;
}

/**
 * Build a short natural-language digest of the review set — a
 * "customers say" style paragraph shown above the score/bars. Fully
 * deterministic (seeded from the slug) and derived from the product's
 * own tags/tier plus the generated ratings, so it stays consistent
 * with the individual reviews listed below it.
 */
export function summarizeReviewsText(
  reviews: MockReview[],
  product: CatalogProduct,
): string {
  if (reviews.length === 0) {
    return `No written reviews yet for the ${product.title}.`;
  }

  const rng = mulberry32(hashString(`${product.slug}-summary`));
  const avg =
    reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length;
  const positiveShare =
    reviews.filter((r) => r.rating >= 4).length / reviews.length;

  const tags = product.useCaseTags
    .slice(0, 2)
    .map((t) => t.replace(/_/g, " "));
  const praise =
    tags.length > 0
      ? tags.join(" and ")
      : product.tier === "pro"
        ? "image quality and control"
        : "ease of use and value";

  const tierPhrase =
    product.tier === "beginner"
      ? "an approachable first pick"
      : product.tier === "pro"
        ? "a serious, capable tool"
        : "a well-rounded all-rounder";

  const opener =
    positiveShare >= 0.8
      ? `Reviewers are overwhelmingly positive about the ${product.title}`
      : positiveShare >= 0.5
        ? `Reviewers are broadly happy with the ${product.title}`
        : `Reviewers are mixed on the ${product.title}`;

  const praiseLine = `Most highlight its ${praise}, calling it ${tierPhrase}.`;
  const caveat =
    positiveShare < 1
      ? pick(rng, [
          " A few wanted more from the battery.",
          " A handful noted a learning curve at first.",
          " Some felt the price sits at the premium end.",
        ])
      : "";

  return `${opener} (${avg.toFixed(1)} out of 5 across ${reviews.length} written reviews). ${praiseLine}${caveat}`;
}

/**
 * Summarise reviews for the tab header. Average + count prefer the
 * catalog's real aggregates (so the headline number matches the tile),
 * falling back to the mock set. Distribution is derived from the mock
 * reviews since the catalog carries no per-star breakdown.
 */
export function summarizeReviews(
  reviews: MockReview[],
  product: CatalogProduct,
): ReviewSummary {
  const distribution = [0, 0, 0, 0, 0];
  for (const r of reviews) {
    const idx = Math.max(0, Math.min(4, r.rating - 1));
    distribution[idx] += 1;
  }
  const mockAvg =
    reviews.length > 0
      ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length
      : 0;
  return {
    average: product.rating ?? Number(mockAvg.toFixed(1)),
    count: product.reviewCount ?? reviews.length,
    distribution,
  };
}
