import type { CatalogProduct } from "../../catalog/catalog";
import {
  formatActivityLabel,
  formatSeriesLabel,
} from "../../pages/ProductListingPage/categoryFacets";

/* =============================================================
 * Search-with-assistant suggestion generator (rule-based).
 *
 * Mines metadata of the matched products (series/collection,
 * subtypes, primaryActivities/concerns, capabilities, title) and
 * templates 3-4 conversational prompts a shopper might want to
 * ask the assistant: `Essentials for brightening`, `Setup for a
 * hydration routine`, `Brightening serums`, etc.
 *
 * Sync, free, deterministic, offline-friendly. Used as the
 * instant-render path in the search overlay; an LLM upgrade
 * (see `assistantSuggestionsLLM.ts`) can later replace these
 * once the user pauses long enough for a network round-trip.
 *
 * Vocabulary stays in lockstep with `categoryFacets` and
 * `broadRecipes` so a click that fires `agentic:ask-assistant`
 * with the phrase routes cleanly into existing recipe logic.
 * ============================================================= */

export type AssistantSuggestion = {
  label: string;
  source: "rule" | "llm";
};

const MAX_SUGGESTIONS = 4;

/**
 * Patterns mirrored from `flow.ts` so we can pre-classify a phrase
 * the same way the side-by-side intent classifier will. Kept in
 * lockstep with the source-of-truth regexes:
 *
 *   - BUNDLE_QUERY_PATTERN in flow.ts
 *   - BROAD_PATTERNS in flow.ts (specifically the
 *     `gear|equipment|kit|setup|essentials|accessor(y|ies)` rule)
 *
 * If you change either of those, mirror the change here.
 */
const BUNDLE_QUERY_PATTERN =
  /\b(bundle|bundles|combo|combos|kit|kits|set|sets|save\s*more)\b/i;
const BROAD_VERB_FOR_PATTERN =
  /\b(gear|equipment|kit|setup|essentials|accessor(?:y|ies))\s+for\b/i;

/**
 * True when a phrase would land on the side-by-side's bundle-deals
 * branch (CompactResultCard with "Here are some bundle deals... save
 * you more:" copy). A phrase is bundle-tripping when it matches the
 * bundle pattern AND does NOT also match the broad pattern. The
 * broad classifier wins when both fire and routes the intent to a
 * BroadResultCard recipe instead.
 *
 * Used by `buildAssistantSuggestionsRuleBased` and (via the LLM
 * post-filter) `fetchAssistantSuggestionsLLM` so neither path can
 * surface a phrase that surprises the shopper with a bundles card.
 */
export function isBundleTrippingPhrase(phrase: string): boolean {
  if (!phrase) return false;
  if (BROAD_VERB_FOR_PATTERN.test(phrase)) return false;
  return BUNDLE_QUERY_PATTERN.test(phrase);
}

/**
 * Concerns we treat as "generic": fine signals on their own but
 * outranked by more specific ones when both are present. e.g. a query
 * that matches both `hydration` and `brightening` should produce
 * brightening-flavoured phrases, not hydration ones.
 */
const GENERIC_ACTIVITIES: ReadonlySet<string> = new Set(["hydration"]);

/** Concern/benefit tokens that read naturally as adjectives in front of
 *  a category ("Brightening serums", "Hydrating moisturizers"). Matched
 *  against a product's `useCaseTags`-derived `capabilities`. */
const ADJECTIVAL_CAPABILITIES: ReadonlyArray<string> = [
  "brightening",
  "hydrating",
  "firming",
  "smoothing",
  "mattifying",
  "soothing",
  "exfoliating",
  "anti-aging",
];

const CAPABILITY_LABEL_OVERRIDES: Record<string, string> = {
  "anti-aging": "Anti-aging",
};

/** Convert a concern/benefit token to a friendly adjective ("Brightening"). */
function formatCapabilityLabel(value: string): string {
  if (CAPABILITY_LABEL_OVERRIDES[value]) return CAPABILITY_LABEL_OVERRIDES[value];
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * Lowercase a category string for use as a noun in a suggestion
 * ("Moisturizers" -> "moisturizers") so it composes with a leading
 * adjective ("Brightening serums & treatments").
 */
function categoryNoun(category: string): string {
  return category.trim().toLowerCase();
}

/** Most-frequent token in an array of token arrays (preserving first-seen order on ties). */
function topToken(
  arrays: ReadonlyArray<ReadonlyArray<string>>,
  exclude: ReadonlySet<string> = new Set(),
): string | null {
  const counts = new Map<string, number>();
  const order: string[] = [];
  for (const arr of arrays) {
    for (const tok of arr) {
      if (exclude.has(tok)) continue;
      if (!counts.has(tok)) order.push(tok);
      counts.set(tok, (counts.get(tok) ?? 0) + 1);
    }
  }
  if (order.length === 0) return null;
  let best = order[0];
  let bestCount = counts.get(best)!;
  for (const tok of order) {
    const c = counts.get(tok)!;
    if (c > bestCount) {
      best = tok;
      bestCount = c;
    }
  }
  return best;
}

/**
 * Build rule-based assistant suggestions for the current query.
 *
 * Returns up to `MAX_SUGGESTIONS` phrases derived from the top matched
 * products' metadata. Phrases are deduped case-insensitively against
 * each other and against the literal query so we don't suggest a
 * phrase the shopper already typed.
 */
export function buildAssistantSuggestionsRuleBased(
  query: string,
  matchedProducts: ReadonlyArray<CatalogProduct>,
): AssistantSuggestion[] {
  const trimmed = query.trim();
  if (!trimmed) return [];
  if (matchedProducts.length === 0) return [];

  const top = matchedProducts.slice(0, 5);
  const topProduct = top[0];

  const phrases: string[] = [];
  const push = (phrase: string) => {
    const norm = phrase.trim();
    if (!norm) return;
    const cmp = norm.toLowerCase();
    if (cmp === trimmed.toLowerCase()) return;
    if (phrases.some((p) => p.toLowerCase() === cmp)) return;
    // Defensive guard: drop any phrase that would route to the
    // side-by-side's bundles branch. Templates below already avoid
    // bare "{X} kit"/"{X} combo" forms but this catches anything a
    // future template author might emit by accident.
    if (isBundleTrippingPhrase(norm)) return;
    phrases.push(norm);
  };

  // 1. Concern-driven: pick the most-common specific concern across the
  //    top results (brightening / anti-aging / firming win over generic
  //    hydration when both are present). Phrased with the `{verb} for
  //    {target}` form so the broad classifier catches it.
  const activitySpecific = topToken(
    top.map((p) => p.primaryActivities),
    GENERIC_ACTIVITIES,
  );
  const activityFallback = topToken(top.map((p) => p.primaryActivities));
  const activity = activitySpecific ?? activityFallback;
  if (activity) {
    const activityLower = formatActivityLabel(activity).toLowerCase();
    push(`Essentials for ${activityLower}`);
    if (phrases.length < MAX_SUGGESTIONS) {
      // `Setup for X` (rather than `X kit`) so the broad classifier
      // catches it. Bare `X kit` would trip the bundle pattern in
      // flow.ts and route to a "Here are some bundle deals..." card.
      push(`Setup for a ${activityLower} routine`);
    }
  }

  // 2. Collection ecosystem: when 2+ top products share a collection,
  //    the range is a meaningful axis of exploration. Phrased as
  //    `Essentials for the {Collection} collection` so it matches the
  //    broad classifier and routes to a collection-scoped recipe.
  const seriesCounts = new Map<string, number>();
  for (const p of top) {
    if (!p.series) continue;
    seriesCounts.set(p.series, (seriesCounts.get(p.series) ?? 0) + 1);
  }
  let dominantSeries: string | null = null;
  for (const [s, count] of seriesCounts) {
    if (count >= 2) {
      if (dominantSeries == null || count > (seriesCounts.get(dominantSeries) ?? 0)) {
        dominantSeries = s;
      }
    }
  }
  if (dominantSeries) {
    push(`Essentials for the ${formatSeriesLabel(dominantSeries)} collection`);
  }

  // 3. Concern-flavoured category: "Brightening serums & treatments",
  //    "Hydrating moisturizers". Picks the first concern from the top
  //    product's `capabilities` array that's in our adjectival list.
  const cap = ADJECTIVAL_CAPABILITIES.find((c) =>
    topProduct.capabilities.includes(c),
  );
  if (cap) {
    push(`${formatCapabilityLabel(cap)} ${categoryNoun(topProduct.category)}`);
  }

  // 4. Comparison fallback: when the top 2 results belong to different
  //    collections, a "X vs Y" comparison is a natural assistant prompt.
  if (top.length >= 2 && phrases.length < MAX_SUGGESTIONS) {
    const a = top[0].series;
    const b = top.find((p) => p.series && p.series !== a)?.series;
    if (a && b) {
      push(`${formatSeriesLabel(a)} vs ${formatSeriesLabel(b)}`);
    }
  }

  return phrases.slice(0, MAX_SUGGESTIONS).map((label) => ({
    label,
    source: "rule" as const,
  }));
}
