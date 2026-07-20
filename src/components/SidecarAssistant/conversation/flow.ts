import type {
  AccessoryRole,
  CatalogProduct,
  ProductSeries,
  ProductTier,
  ProductTypeGroup,
} from "../../../catalog/catalog";
import {
  buildActivityConstraints,
  detectActivitiesFromQuery,
  enforceAndRankActivityFit,
} from "../../../catalog/activityProfiles";
import type { ActivityId } from "../../../catalog/activityProfiles";
import {
  detectModelFamily,
  detectSymptom,
  hasOwnsOrHowtoSignal,
  type ModelFamily,
  type SymptomEntry,
} from "./symptomMap";

/* =============================================================
 * Conversation flow helpers for the SidecarAssistant.
 *
 * Keeps the intent classifier + product filtering pure and unit-test
 * friendly so the SidecarAssistant component itself can stay focused
 * on rendering + state management.
 * ============================================================= */

/**
 * NOTE on regex shape: every category noun ends with `s?\b` so plural
 * forms ("drones", "mics", "gimbals") match. `\bdrone\b` does NOT
 * match "drones" because `e`→`s` has no word boundary, which used to
 * silently drop the category filter and leak unrelated SKUs into the
 * tier-only search.
 */
const CATEGORY_PATTERNS: Array<{
  test: RegExp;
  categories: string[];
  label: string;
}> = [
  // Product categories are listed FIRST (most specific), then
  // concern-driven routing. This ordering means "hydrating cream"
  // resolves to Moisturizers (a product type) rather than the generic
  // "hydration" concern bucket below.
  {
    test: /\b(sunscreens?|sun\s*screens?|spf|sunblock|sun\s*block|sun\s*protect\w*|uv\s*protect\w*|uv\s*filter)\b/i,
    categories: ["Sunscreen"],
    label: "sunscreen",
  },
  {
    test: /\b(cleansers?|cleansing|cleanse|face\s*wash|facial\s*wash|makeup\s*removers?|micellar|cleansing\s*(oil|milk|foam|water)|foaming\s*wash)\b/i,
    categories: ["Cleansers"],
    label: "cleansers",
  },
  {
    test: /\b(softeners?|toners?|essences?|first\s*treatment|balancing\s*lotion)\b/i,
    categories: ["Softeners"],
    label: "softeners",
  },
  {
    test: /\b(eye\s*(creams?|care|masks?|contour)|dark\s*circles?|puffiness|puffy\s*eyes|under[-\s]?eye|lip\s*(care|balms?|treatments?|masks?)|crow'?s?\s*feet)\b/i,
    categories: ["Eye & Lip Care"],
    label: "eye & lip care",
  },
  {
    test: /\b(masks?|sheet\s*masks?|face\s*masks?|sleeping\s*masks?|overnight\s*masks?)\b/i,
    categories: ["Masks"],
    label: "masks",
  },
  {
    test: /\b(serums?|treatments?|concentrates?|ampoules?|boosters?|facial\s*oils?)\b/i,
    categories: ["Serums & Treatments"],
    label: "serums & treatments",
  },
  {
    test: /\b(moisturi[sz]ers?|moisturi[sz]ing|face\s*creams?|day\s*creams?|night\s*creams?|gel\s*creams?|emulsions?|hydrating\s*creams?|\bcreams?\b)\b/i,
    categories: ["Moisturizers"],
    label: "moisturizers",
  },
  {
    test: /\b(sets?|bundles?|kits?|routines?|regimens?|gift\s*sets?|collections?)\b/i,
    categories: ["Sets & Bundles"],
    label: "sets & bundles",
  },
  // ---- Concern-driven routing. Skin-concern words map to the product
  // categories that best address them, because the catalog's structured
  // concern tags are sparsely populated (relying on them alone would
  // return near-empty carousels). ----
  {
    test: /\b(anti[-\s]?aging|anti[-\s]?ageing|ageing|aging|wrinkl\w*|fine\s*lines?|mature\s*skin|crepe\w*)\b/i,
    categories: ["Serums & Treatments", "Moisturizers"],
    label: "anti-aging",
  },
  {
    test: /\b(bright\w*|dark\s*spots?|hyperpigment\w*|pigmentation|dull\w*|radiance|glow\w*|uneven\s*(skin\s*)?tone|even\s*tone|spots?)\b/i,
    categories: ["Serums & Treatments", "Moisturizers"],
    label: "brightening",
  },
  {
    test: /\b(firm\w*|lift\w*|sag\w*|saggy|elasticity|contour\w*|bounce)\b/i,
    categories: ["Serums & Treatments", "Moisturizers"],
    label: "firming",
  },
  {
    test: /\b(hydrat\w*|dry\s*skin|dryness|dehydrat\w*|moisture|plump\w*)\b/i,
    categories: ["Moisturizers", "Serums & Treatments"],
    label: "hydration",
  },
  {
    test: /\b(pores?|pore[-\s]?minimi\w*|oily\s*skin|oil\s*control|shine|shiny|blackheads?|breakouts?|acne|blemish\w*)\b/i,
    categories: ["Cleansers", "Softeners"],
    label: "pore & oil care",
  },
];

const BROAD_PATTERNS: RegExp[] = [
  /\b(return|refund|policy|warranty|shipping|delivery\s*time|track\s*order|order\s*status|customer\s*service)\b/i,
  /\b(help\s*me|not\s*sure|advice|where\s*do\s*i\s*start|how\s*do\s*i)\b/i,
  // Exploratory cues like "gear for moto vlogging" / "equipment for a film
  // shoot" / "kit for travel", multi-category curated requests that should
  // route to the broad result card instead of a single PLP carousel.
  /\b(gear|equipment|kit|setup|essentials|accessor(y|ies))\s+for\b/i,
];

/**
 * Use-case keyword detection. Each match adds a tag to the intent so
 * `filterProducts` can require it (e.g. "diving" -> require
 * `waterproof`).
 */
const USE_CASE_PATTERNS: Array<{ test: RegExp; tag: string }> = [
  // Only well-populated tags are used as HARD filters here (skin type,
  // SPF, best-seller). Skin-concern routing is handled through
  // CATEGORY_PATTERNS instead, because concern tags are sparse.
  { test: /\b(dry|dryness|dehydrated)\b/i, tag: "dry" },
  { test: /\b(oily|oil[-\s]?control|greasy)\b/i, tag: "oily" },
  { test: /\b(combination|combo\s*skin)\b/i, tag: "combination" },
  { test: /\b(normal\s*skin)\b/i, tag: "normal" },
  { test: /\b(spf|sunscreen|sun\s*protect\w*|\buv\b)\b/i, tag: "spf" },
  {
    test: /\b(best[-\s]?sell\w*|bestseller|most\s*popular|popular|top[-\s]?rated)\b/i,
    tag: "best-seller",
  },
];

function inferUseCaseTags(text: string): string[] {
  const tags = new Set<string>();
  for (const rule of USE_CASE_PATTERNS) {
    if (rule.test.test(text)) tags.add(rule.tag);
  }
  return [...tags];
}

/**
 * Vocabulary -> price tier. For skincare, `tier` is a price band
 * (prestige / mid / everyday) derived from price in catalog.ts, so
 * "prestige"/"advanced" language floors the results at the higher-end
 * SKUs and "everyday"/"affordable" language keeps them entry-level.
 */
const TIER_PATTERNS: Array<{ test: RegExp; tier: ProductTier }> = [
  {
    test: /\b(prestige|luxury|luxe|premium|high[-\s]?end|advanced|intensive|concentrated|clinical|expert|best\s*results|splurge|top[-\s]?tier|most\s*effective)\b/i,
    tier: "pro",
  },
  {
    test: /\b(affordable|budget|cheap|inexpensive|entry[-\s]?level|starter|everyday|basic|first[-\s]?time|new\s*to\s*skincare|gift)\b/i,
    tier: "beginner",
  },
  {
    test: /\b(mid[-\s]?range|midrange|daily|regular|core|staple)\b/i,
    tier: "intermediate",
  },
];

/**
 * Per-category price floor we apply when the shopper signals a `pro`
 * (prestige) tier, so entry-level products don't dominate the carousel.
 */
const PRO_PRICE_FLOOR_BY_CATEGORY: Record<string, number> = {
  "Serums & Treatments": 150,
  Moisturizers: 120,
  "Eye & Lip Care": 90,
  Masks: 60,
  Sunscreen: 45,
  Cleansers: 40,
  Softeners: 55,
  "Sets & Bundles": 150,
};

function inferTierFromText(text: string): ProductTier | undefined {
  const hit = TIER_PATTERNS.find((entry) => entry.test.test(text));
  return hit?.tier;
}

export type LandingNbaLane =
  | "productDiscovery"
  | "categoryGuidance"
  | "decisionSupport"
  | "supportIntent";

const LANDING_LANES: LandingNbaLane[] = [
  "productDiscovery",
  "categoryGuidance",
  "decisionSupport",
  "supportIntent",
];

const LANDING_NBA_BASE: Record<LandingNbaLane, string> = {
  productDiscovery: "skincare for oily skin",
  categoryGuidance: "Help me choose a serum",
  decisionSupport: "Find sunscreen under $60",
  supportIntent: "Track my recent order",
};

const LANDING_NBA_ALTERNATES: Record<LandingNbaLane, readonly string[]> = {
  productDiscovery: [
    "Best products for dry skin",
    "A routine for brightening",
  ],
  categoryGuidance: [
    "Help me choose a moisturizer",
    "Find the right cleanser",
  ],
  decisionSupport: [
    "Show best-selling skincare",
    "Serum vs treatment: which do I need?",
  ],
  supportIntent: ["Help with returns", "Where is my order"],
};

const LANDING_NBA_LANE_BY_LABEL = new Map<string, LandingNbaLane>(
  LANDING_LANES.flatMap((lane) => [
    [LANDING_NBA_BASE[lane], lane],
    ...LANDING_NBA_ALTERNATES[lane].map((label) => [label, lane] as const),
  ]),
);

/**
 * V1 quality targets used for telemetry dashboarding/tuning.
 * These are not enforcement gates in UI logic.
 */
export const LANDING_NBA_SUCCESS_THRESHOLDS = {
  firstUsefulCardRateMin: 0.85,
  zeroResultRateMax: 0.05,
  supportFlowStartRateMin: 0.2,
} as const;

export function getLandingNbaLane(label: string): LandingNbaLane | undefined {
  return LANDING_NBA_LANE_BY_LABEL.get(label);
}

/**
 * Keep 4 visible landing chips and rotate one lane at a time.
 * - refreshCount = 0 => base set
 * - each refresh swaps only one lane to its next alternate
 */
export function buildWelcomeNbas(refreshCount = 0): string[] {
  if (refreshCount <= 0) {
    return LANDING_LANES.map((lane) => LANDING_NBA_BASE[lane]);
  }

  const laneIndex = (refreshCount - 1) % LANDING_LANES.length;
  const laneToRotate = LANDING_LANES[laneIndex];
  const round = Math.floor((refreshCount - 1) / LANDING_LANES.length);

  return LANDING_LANES.map((lane) => {
    if (lane !== laneToRotate) {
      return LANDING_NBA_BASE[lane];
    }
    const alternates = LANDING_NBA_ALTERNATES[lane];
    if (alternates.length === 0) {
      return LANDING_NBA_BASE[lane];
    }
    return alternates[round % alternates.length];
  });
}

export type IntentKind = "broad" | "direct" | "empty";

export type Intent = {
  kind: IntentKind;
  /** Original normalized query used for activity-specific constraints. */
  rawQuery?: string;
  /** Wave-1 detected activities from the shopper query. */
  activities?: ActivityId[];
  /** Lowercased label of the matching category, if any. */
  categoryLabel?: string;
  /** Resolved category names (matched against `CatalogProduct.category`). */
  categories?: string[];
  /** Optional price ceiling extracted from phrases like "under $500". */
  priceMax?: number;
  /** Optional price floor (used when shopper signals 'pro'/'expert'). */
  priceMin?: number;
  /** Buyer expertise tier derived from query vocabulary. */
  tier?: ProductTier;
  /**
   * True when the shopper explicitly asked about bundles/combos/kits.
   * Default-off so the primary PLP shows core SKUs and bundles
   * resurface as upsell NBAs.
   */
  includeBundles?: boolean;
  /**
   * Use-case tags that must be present on each recommended product.
   * Examples: "waterproof" (diving/ocean), "rugged" (extreme),
   * "vlogging" (creator content), "360", "compact" (travel).
   */
  requiredTags?: string[];
  /**
   * Lowercased model token extracted from the query (e.g. "mavic 4
   * pro", "mini 5 pro", "osmo pocket 3"). When present, accessory
   * results are narrowed to SKUs whose `compatibleWithModels` or
   * `title` contain this token, so "ND filter for Mavic 4 Pro"
   * surfaces only Mavic 4 Pro filters, not the full lens-filter
   * catalog.
   */
  compatibleWith?: string;
  /**
   * v6 subtype hints from the query ("helmet mount" → mount_helmet,
   * "ND filter" → acc_filter_nd). When present, narrows products to
   * those carrying at least one of these subtypes, sharper than the
   * category-label allow-list which spans every variant in the bucket.
   */
  subtypeHints?: string[];
};

const BUNDLE_QUERY_PATTERN =
  /\b(bundle|bundles|combo|combos|kit|kits|fly\s*more|creator\s*combo|save\s*more)\b/i;

/**
 * Specific model-name patterns. When a query mentions a particular
 * SKU family (e.g. "for Mavic 4 Pro", "for Mini 5 Pro", "for Pocket
 * 3"), the matched lowercased token feeds `intent.compatibleWith` so
 * accessory results filter to that family. ORDER MATTERS: more
 * specific patterns must come BEFORE shorter ones (e.g. "Mavic 4 Pro"
 * before "Mavic 3", "Mini 5 Pro" before "Mini 5").
 */
// Skincare products are chosen by category / concern / skin type, not
// by a versioned model line, so there is no model-family detection.
// Kept as an empty list so `detectModel` / `stripModelPhrases` remain
// no-ops without a wider refactor of their callers.
const MODEL_PATTERNS: Array<{ test: RegExp; model: string }> = [];

function detectModel(text: string): string | undefined {
  for (const rule of MODEL_PATTERNS) {
    if (rule.test.test(text)) return rule.model;
  }
  return undefined;
}

/**
 * Strip every matching model phrase from the query so downstream
 * inference (tier, use-case tags, broad patterns) doesn't mistake
 * model-name words like "Pro" / "Mini" / "Air" for tier or
 * use-case signals. Leaves a placeholder space so word boundaries
 * still hold around adjacent tokens.
 *
 * Example: "Helmet mount for Action 5 Pro" → "Helmet mount for"
 * (without this, the bare `\bpro\b` in `inferTierFromText` would
 * fire on the model name and set tier='pro').
 */
function stripModelPhrases(text: string): string {
  let out = text;
  for (const rule of MODEL_PATTERNS) {
    out = out.replace(rule.test, " ");
  }
  return out.replace(/\s+/g, " ").trim();
}

/**
 * Specific subtype hints: when the shopper names a precise mount /
 * filter / mic / lens variant, narrow the result to that exact v6
 * subtype rather than the broader category-label allow-list. Without
 * this, "helmet mount for Action 5 Pro" surfaces all 12 mount types
 * instead of just helmet mounts.
 *
 * Each rule maps a query phrase to one or more v6 subtype tokens
 * (which align with `CatalogProduct.subtypes`). Filters apply via OR
 * semantics: a product passes if it carries ANY of the listed
 * subtypes.
 */
// No accessory-subtype narrowing for skincare (the `subtypes` field now
// carries skin-type tokens, which are matched via useCaseTags instead).
const SUBTYPE_HINT_PATTERNS: Array<{ test: RegExp; subtypes: string[] }> = [];

function detectSubtypeHints(text: string): string[] {
  const out: string[] = [];
  for (const rule of SUBTYPE_HINT_PATTERNS) {
    if (rule.test.test(text)) {
      for (const s of rule.subtypes) {
        if (!out.includes(s)) out.push(s);
      }
    }
  }
  return out;
}

/**
 * Per category-label, the v6 subtypes that genuinely belong to that
 * accessory class. Used as a soft narrowing filter inside
 * `filterProducts` so a query like "ND filter for Mini 5 Pro" can't
 * surface Mini 5 Pro batteries / propellers (which are in "Drone
 * accessories" and would otherwise pass the substring category match
 * + the title-based compatibility filter).
 */
// Skincare categories don't need accessory-subtype narrowing.
const SUBTYPES_BY_CATEGORY_LABEL: Record<string, string[]> = {};

/** Classify a free-text shopper query into a broad / direct intent. */
export function classifyIntent(query: string): Intent {
  const trimmed = query.trim();
  if (!trimmed) return { kind: "empty" };

  const categoryHit = CATEGORY_PATTERNS.find((entry) => entry.test.test(trimmed));
  const detectedActivities = detectActivitiesFromQuery(trimmed);
  const priceMatch = trimmed.match(
    /(?:under|less\s*than|below|<=?|cheaper\s*than)\s*\$?\s*(\d{2,5})/i,
  );
  const priceMax = priceMatch ? Number(priceMatch[1]) : undefined;
  const compatibleWith = detectModel(trimmed);
  // Strip model phrases BEFORE tier / use-case inference so model
  // tokens like "Pro" (in "Action 5 Pro") or "Mini" (in "Mini 5 Pro")
  // don't fire false-positive tier or compact-use-case tags.
  const queryWithoutModels = compatibleWith
    ? stripModelPhrases(trimmed)
    : trimmed;
  const tier = inferTierFromText(queryWithoutModels);
  const includeBundles = BUNDLE_QUERY_PATTERN.test(trimmed);
  const useCaseTags = inferUseCaseTags(queryWithoutModels);
  const requiredTags = useCaseTags.length > 0 ? useCaseTags : undefined;
  const subtypeHintsArr = detectSubtypeHints(trimmed);
  const subtypeHints = subtypeHintsArr.length > 0 ? subtypeHintsArr : undefined;

  // Prestige/advanced language implies a price floor unless the user
  // explicitly capped the budget. Use the first resolved category to
  // pick a sensible floor; default to serums when none matched.
  let priceMin: number | undefined;
  if (tier === "pro" && priceMax === undefined) {
    const primaryCategory =
      categoryHit?.categories?.[0] ?? "Serums & Treatments";
    priceMin = PRO_PRICE_FLOOR_BY_CATEGORY[primaryCategory];
  }

  if (categoryHit) {
    return {
      kind: "direct",
      rawQuery: trimmed,
      activities: detectedActivities,
      categoryLabel: categoryHit.label,
      categories: categoryHit.categories,
      priceMax,
      priceMin,
      tier,
      includeBundles,
      requiredTags,
      compatibleWith,
      subtypeHints,
    };
  }

  if (BROAD_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return {
      kind: "broad",
      rawQuery: trimmed,
      activities: detectedActivities,
      tier,
      includeBundles,
      requiredTags,
      compatibleWith,
      subtypeHints,
    };
  }

  if (
    priceMax !== undefined ||
    tier !== undefined ||
    includeBundles ||
    requiredTags
  ) {
    // The whole catalog is skincare, so a tier / budget / use-case
    // signal without an explicit category can safely search across
    // every category rather than anchoring to one.
    return {
      kind: "direct",
      rawQuery: trimmed,
      activities: detectedActivities,
      priceMax,
      priceMin,
      tier,
      includeBundles,
      requiredTags,
      compatibleWith,
      subtypeHints,
    };
  }

  // Default fallback when no positive signal matched: neither a
  // category (CATEGORY_PATTERNS), a shopping cue (BROAD_PATTERNS), a
  // tier/price/use-case/bundle hint, nor a model name. Returning
  // `empty` lets downstream callers tell "the shopper genuinely typed
  // a shopping query but it didn't match a vocab" apart from "the
  // shopper typed something that's not a shopping query at all" (e.g.
  // a PDP-scoped FAQ like 'is this waterproof?'). The rule-based
  // renderer treats `empty` and `broad` identically when synthesising
  // a curated card, so this doesn't change the broad-card output for
  // unsignalled inputs on non-PDP routes.
  return { kind: "empty", rawQuery: trimmed, activities: detectedActivities };
}

/* =============================================================
 * Broad-intent routine detection.
 *
 * When the shopper describes a skin type or a concern (or explicitly
 * asks for a "routine") but does NOT name a specific product category,
 * we synthesise a full multi-step routine card instead of a single
 * carousel. Naming a category (e.g. "brightening serum", "moisturizers
 * for dry skin") keeps the normal single-carousel flow.
 * ============================================================= */

/** Explicit product-type vocabulary. When any of these appear the shopper
 * named a category, so we stay on the single-carousel path. "routine" /
 * "regimen" are deliberately excluded so they trigger the routine card. */
const EXPLICIT_PRODUCT_CATEGORY_PATTERN =
  /\b(sunscreens?|sun\s*screens?|spf|sunblock|sun\s*block|cleansers?|cleansing|face\s*wash|facial\s*wash|micellar|softeners?|toners?|essences?|eye\s*(creams?|care|masks?|contour)|lip\s*(care|balms?|treatments?|masks?)|masks?|sheet\s*masks?|serums?|treatments?|concentrates?|ampoules?|boosters?|facial\s*oils?|moisturi[sz]ers?|face\s*creams?|day\s*creams?|night\s*creams?|gel\s*creams?|emulsions?|\bcreams?\b|bundles?|kits?|combos?|gift\s*sets?|\bsets?\b)\b/i;

const ROUTINE_SKIN_TYPE_PATTERNS: Array<{ test: RegExp; key: string }> = [
  { test: /\b(dry|dryness|dehydrated)\b/i, key: "dry" },
  { test: /\b(oily|oil[-\s]?control|greasy)\b/i, key: "oily" },
  { test: /\b(combination|combo\s*skin)\b/i, key: "combination" },
  { test: /\b(normal\s*skin)\b/i, key: "normal" },
];

const ROUTINE_CONCERN_PATTERNS: Array<{ test: RegExp; key: string }> = [
  {
    test: /\b(acne|breakouts?|blemish\w*|pimples?|blackheads?|pores?|pore[-\s]?minimi\w*|oil\s*control|shine|shiny)\b/i,
    key: "acne",
  },
  {
    test: /\b(bright\w*|dark\s*spots?|hyperpigment\w*|pigmentation|dull\w*|radiance|glow\w*|uneven\s*(skin\s*)?tone|even\s*tone)\b/i,
    key: "brightening",
  },
  {
    test: /\b(anti[-\s]?aging|anti[-\s]?ageing|ageing|aging|wrinkl\w*|fine\s*lines?|mature\s*skin|crepe\w*)\b/i,
    key: "anti-aging",
  },
  {
    test: /\b(firm\w*|lift\w*|sag\w*|saggy|elasticity|contour\w*|bounce)\b/i,
    key: "firming",
  },
  {
    test: /\b(hydrat\w*|dryness|dehydrat\w*|moisture|plump\w*)\b/i,
    key: "hydration",
  },
];

const ROUTINE_CUE_PATTERN =
  /\b(routines?|regimens?|regime|skin\s*care\s*for|skincare\s*for|products?\s*for|what\s*should\s*i\s*use|build\s*(me\s*)?a?\s*routine|help\s*me\s*with\s*my\s*skin|suggest\s*products?)\b/i;

export type RoutineIntent = {
  isRoutine: boolean;
  /** Detected skin type token (dry/oily/combination/normal), used as a
   * product filter tag and to tailor copy. */
  skinType?: string;
  /** Detected concern bucket (acne/brightening/anti-aging/firming/hydration),
   * used to tailor the acknowledgement + section descriptions. */
  concernKey?: string;
  rawQuery?: string;
};

/**
 * Decide whether a shopper query should render the multi-step routine
 * card. Fires when there's a skin type, a concern, or an explicit routine
 * cue AND no explicit product-category word.
 */
export function detectRoutineIntent(query: string): RoutineIntent {
  const trimmed = query.trim();
  if (!trimmed) return { isRoutine: false };
  if (EXPLICIT_PRODUCT_CATEGORY_PATTERN.test(trimmed)) {
    return { isRoutine: false };
  }
  const skinType = ROUTINE_SKIN_TYPE_PATTERNS.find((p) =>
    p.test.test(trimmed),
  )?.key;
  const concernKey = ROUTINE_CONCERN_PATTERNS.find((p) =>
    p.test.test(trimmed),
  )?.key;
  const hasCue = ROUTINE_CUE_PATTERN.test(trimmed);
  return {
    isRoutine: Boolean(skinType || concernKey || hasCue),
    skinType,
    concernKey,
    rawQuery: trimmed,
  };
}

/** Fixed 5-step routine (Cleanse -> Soften -> Treat -> Moisturize -> Protect),
 * each mapped to the catalog category that fulfils it. */
export const ROUTINE_STEPS: Array<{
  stepLabel: string;
  categoryTitle: string;
  categoryKey: string;
}> = [
  { stepLabel: "1. Cleanse", categoryTitle: "Cleansers", categoryKey: "Cleansers" },
  { stepLabel: "2. Soften", categoryTitle: "Softeners", categoryKey: "Softeners" },
  {
    stepLabel: "3. Treat",
    categoryTitle: "Serums & Treatments",
    categoryKey: "Serums & Treatments",
  },
  {
    stepLabel: "4. Moisturize",
    categoryTitle: "Moisturizers",
    categoryKey: "Moisturizers",
  },
  { stepLabel: "5. Protect", categoryTitle: "Sunscreen", categoryKey: "Sunscreen" },
];

/** Empathetic opener tailored to the detected concern / skin type. */
export function buildRoutineAcknowledgement(intent: RoutineIntent): string {
  const key = intent.concernKey ?? intent.skinType;
  switch (key) {
    case "acne":
      return "Breakouts can be frustrating — here's a simple, balancing routine to help keep pores clear and calm your skin.";
    case "oily":
      return "For oily skin, here's a balancing routine to manage shine and keep pores clear through the day.";
    case "dry":
    case "hydration":
      return "Dry skin needs gentle, hydrating care — here's a routine to restore moisture and comfort.";
    case "brightening":
      return "For a brighter, more even tone, here's a routine that targets dullness and dark spots.";
    case "anti-aging":
    case "firming":
      return "To help with firmness and fine lines, here's a targeted routine for visibly smoother skin.";
    case "combination":
      return "For combination skin, here's a balanced routine that hydrates dry areas without overloading oily ones.";
    default:
      return "Here's a complete daily routine tailored to your skin.";
  }
}

/** Per-step description, with an optional concern/skin-type clause. */
export function buildRoutineSectionDescription(
  categoryKey: string,
  intent: RoutineIntent,
): string {
  const concern = intent.concernKey ?? intent.skinType;
  const base: Record<string, string> = {
    Cleansers: "Start by washing away impurities and excess oil to prep your skin.",
    Softeners: "Balance and hydrate so the next steps absorb better.",
    "Serums & Treatments": "Target your main concern with a concentrated treatment.",
    Moisturizers: "Lock in hydration and strengthen your skin barrier.",
    Sunscreen: "Finish every morning with SPF to protect against UV damage.",
  };
  const clause: Record<string, Record<string, string>> = {
    Cleansers: {
      acne: " Look for formulas that help clear pore-clogging buildup.",
      oily: " Gel and foaming textures help control excess oil.",
    },
    "Serums & Treatments": {
      brightening: " Brightening actives help fade dark spots over time.",
      "anti-aging": " Look for firming, wrinkle-smoothing actives.",
      acne: " Soothing, clarifying actives help calm breakouts.",
    },
    Moisturizers: {
      dry: " Richer creams give dry skin lasting comfort.",
      hydration: " Richer creams give dry skin lasting comfort.",
      oily: " Lightweight, oil-free gels keep skin balanced.",
    },
  };
  const extra = concern ? clause[categoryKey]?.[concern] ?? "" : "";
  return (base[categoryKey] ?? "") + extra;
}

/* =============================================================
 * Symptom-driven accessory recommendation classifier.
 *
 * Recognises shopper turns shaped like "I have an X, how do I solve
 * Y" / "my Mavic shakes a lot" / "what filter helps with glare on
 * my Osmo Action". Returns a structured intent the SxS hook can
 * render into an accessory recommendation card.
 *
 * Gating rules (all must hold):
 *   - The query carries a SYMPTOM_PATTERNS token (glare, wind
 *     noise, shake, brightness, water, ...).
 *   - The query carries an OWNS_PATTERN ("i have", "my", ...) OR a
 *     HOWTO_PATTERN ("how do i", "what should i use", ...) signal.
 *     Either alone is enough. "how do i reduce glare" is a valid
 *     question even when the shopper doesn't explicitly name a
 *     camera.
 *
 * A model is OPTIONAL. When present we prefer the versioned
 * MODEL_PATTERNS detector ("osmo action 5 pro") and fall back to
 * the family-level detector ("osmo action") only when no version
 * was named. Missing both is fine. The recommendation card just
 * scopes by role/subtype/capability without a host filter.
 * ============================================================= */

export type SymptomAccessoryIntent = {
  kind: "symptom_accessory";
  symptom: SymptomEntry;
  /**
   * Versioned model token from `MODEL_PATTERNS` (e.g. "osmo action
   * 5 pro"). Present when the shopper named a specific SKU; takes
   * precedence over `modelFamily`.
   */
  modelToken?: string;
  /**
   * Family-level fallback when no version was named ("my osmo
   * action"). Carries the canonical `series` so downstream code
   * can pick the lead product by `core.series === family.series`.
   */
  modelFamily?: ModelFamily;
};

export function classifySymptomAccessory(
  query: string,
): SymptomAccessoryIntent | null {
  const trimmed = query.trim();
  if (!trimmed) return null;
  const symptom = detectSymptom(trimmed);
  if (!symptom) return null;
  if (!hasOwnsOrHowtoSignal(trimmed)) return null;
  const modelToken = detectModel(trimmed);
  const modelFamily = modelToken ? undefined : detectModelFamily(trimmed);
  return { kind: "symptom_accessory", symptom, modelToken, modelFamily };
}

/**
 * Resolve a non-accessory "host" product the recommendation card
 * should pivot around. Used by `findSymptomAccessories` and by the
 * disambiguation chip row.
 *
 * Resolution order:
 *   1. If `modelToken` matches a non-accessory product's title,
 *      return that exact SKU.
 *   2. If `modelFamily` is set, return the top-rated non-accessory
 *      product whose `series` matches the family. This becomes the
 *      "lead" for an Osmo Action / Mavic / etc. recommendation.
 *   3. Otherwise return `undefined`.
 */
export function resolveSymptomHost(
  intent: SymptomAccessoryIntent,
  catalog: CatalogProduct[],
): CatalogProduct | undefined {
  const { modelToken, modelFamily } = intent;
  if (modelToken) {
    const target = modelToken.toLowerCase();
    const exact = catalog.find(
      (p) => !p.isAccessory && p.title.toLowerCase().includes(target),
    );
    if (exact) return exact;
  }
  if (modelFamily) {
    const familyMatches = catalog
      .filter((p) => !p.isAccessory && p.series === modelFamily.series)
      .sort(
        (a, b) =>
          (b.rating ?? 0) - (a.rating ?? 0) ||
          (b.reviewCount ?? 0) - (a.reviewCount ?? 0),
      );
    if (familyMatches.length > 0) return familyMatches[0];
  }
  return undefined;
}

/**
 * Return the candidate non-accessory cores that share the resolved
 * model family. Powers the disambiguation chip row ("Osmo Action 6 |
 * Osmo Action 5 Pro | Osmo Action 4") so the shopper can narrow
 * a family-level question to a specific SKU in one click.
 *
 * Returns an empty array when the intent already names a versioned
 * model (no disambiguation needed) or when no family was detected.
 */
export function listSymptomHostCandidates(
  intent: SymptomAccessoryIntent,
  catalog: CatalogProduct[],
  limit = 4,
): CatalogProduct[] {
  if (intent.modelToken) return [];
  if (!intent.modelFamily) return [];
  const series: ProductSeries = intent.modelFamily.series;
  return catalog
    .filter((p) => !p.isAccessory && !p.isBundle && p.series === series)
    .sort(
      (a, b) =>
        (b.rating ?? 0) - (a.rating ?? 0) ||
        (b.reviewCount ?? 0) - (a.reviewCount ?? 0),
    )
    .slice(0, limit);
}

/**
 * Resolve the symptom intent into a list of catalog accessories to
 * surface. Filters the catalog directly by role + optional
 * subtype + optional capability tag, then narrows by host
 * compatibility when a versioned model OR a model family was
 * detected.
 *
 * We deliberately do NOT pivot on a single resolved host. When the
 * shopper says "my osmo action" without a version we want to surface
 * accessories compatible with ANY Osmo Action variant, not just the
 * top-rated one. The host-pivot path (`findAccessoriesFor`) is kept
 * for places that genuinely have a single core (PDP, cart-stage
 * NBAs).
 */
export function findSymptomAccessories(
  intent: SymptomAccessoryIntent,
  catalog: CatalogProduct[],
  limit = 6,
): CatalogProduct[] {
  const { role, subtypes, capabilities } = intent.symptom;
  const modelToken = intent.modelToken?.toLowerCase();
  const familyToken = intent.modelFamily?.titleFragment.toLowerCase();

  const candidates = catalog.filter((p) => {
    if (!p.isAccessory) return false;
    if (!p.imageUrl) return false;
    if (p.accessoryRole !== role) return false;
    if (subtypes && subtypes.length > 0) {
      if (!p.subtypes.some((s) => subtypes.includes(s))) return false;
    }
    if (capabilities && capabilities.length > 0) {
      if (!p.useCaseTags.some((t) => capabilities.includes(t))) return false;
    }
    // Compatibility narrowing: soft, but applied here rather than
    // as a pre-sort because for symptom queries the host filter is
    // the SECOND-most important signal after role/subtype.
    if (modelToken) {
      const matches =
        p.compatibleWithModels.some((m) =>
          normalizeModelToken(m).includes(modelToken),
        ) || p.title.toLowerCase().includes(modelToken);
      if (!matches) return false;
    } else if (familyToken) {
      const matches =
        p.compatibleWithModels.some((m) =>
          normalizeModelToken(m).includes(familyToken),
        ) || p.title.toLowerCase().includes(familyToken);
      if (!matches) return false;
    }
    return true;
  });

  return candidates
    .sort((a, b) => {
      // Prefer SKUs that explicitly tag a compatible model. These
      // are the curated cross-sells, less likely to be a tag-spray
      // false positive than a title-substring hit.
      const aHasModel = a.compatibleWithModels.length > 0 ? 1 : 0;
      const bHasModel = b.compatibleWithModels.length > 0 ? 1 : 0;
      if (aHasModel !== bHasModel) return bHasModel - aHasModel;
      return (b.rating ?? 0) - (a.rating ?? 0) ||
        (b.reviewCount ?? 0) - (a.reviewCount ?? 0);
    })
    .slice(0, limit);
}

/** Filter the catalog using a resolved {@link Intent}. */
export function filterProducts(
  intent: Intent,
  products: CatalogProduct[],
): CatalogProduct[] {
  let pool = products;

  // Detect accessory-flavoured intent BEFORE the bundle filter so we
  // can suppress the bundle exclusion for accessory queries, because many
  // legit accessory SKUs ("Diving Accessory Kit", "Bike Accessory
  // Kit", "Filter Kit", "Microphone Kit") match the catalog's
  // `BUNDLE_TITLE_PATTERN` (which flags `\bkit\b`) even though they
  // are standalone accessories, not multi-product bundles.
  const askedForAccessories = intent.categories?.some((c) =>
    // Match every v6 accessory-flavoured category name so an explicit
    // intent like {categories:["Microphones"]} or {categories:["Camera
    // grips & sticks"]} lifts the default isAccessory hide. v5 used
    // "Microphones"; v6 uses "Camera microphones". Both are accessory
    // buckets, so we match the substring family rather than enumerate.
    /accessor|mount|filter|batter|cable|case|microphone|microphones|charger|strap|tripod|monopod|adapter|propeller|landing\s*gear|remote|lens|grip|stick/i.test(
      c,
    ),
  );

  if (intent.includeBundles) {
    // Explicit bundle ask: show only bundle SKUs.
    pool = pool.filter((product) => product.isBundle);
  } else if (!askedForAccessories) {
    // Default flagship query: drop bundles so the core PLP shows
    // single-SKU products. Accessory queries skip this so Kit-named
    // accessory products survive.
    pool = pool.filter((product) => !product.isBundle);
  }
  if (!askedForAccessories) {
    // v5 tags many accessories under their host's product_type
    // (an ND filter for a drone is `product_type: "drone"`), so we
    // can't trust productType alone, so use the derived `isAccessory`
    // signal which combines product_type, accessory_role, and title.
    pool = pool.filter((product) => !product.isAccessory);
  }

  if (intent.categories && intent.categories.length > 0) {
    // Substring match: keeps the rule-based path aligned with the
    // PLP and recipe filter, so labels like "Microphones" still match
    // the v6 catalog category "Camera microphones", "Drones" matches
    // "4K drones", etc.
    pool = pool.filter((product) =>
      intent.categories!.some((c) =>
        product.category.toLowerCase().includes(c.toLowerCase()),
      ),
    );
  }

  // Accessory-class subtype narrowing.
  //
  // - `subtypeHints` (e.g. `mount_helmet` from "helmet mount") are
  //   the SHARPEST signal: when the shopper named a specific
  //   variant we narrow to those subtypes only.
  // - Otherwise fall back to the category-label allow-list (e.g.
  //   "mounts" → all mount_* subtypes) so the row stays clean of
  //   non-mount SKUs that share the category.
  //
  // Soft filter: if no SKU passes (data gap or stale catalog),
  // keep the broader pool so the card still renders something.
  const allowedSubtypes: Set<string> | null =
    intent.subtypeHints && intent.subtypeHints.length > 0
      ? new Set(intent.subtypeHints)
      : intent.categoryLabel && SUBTYPES_BY_CATEGORY_LABEL[intent.categoryLabel]
        ? new Set(SUBTYPES_BY_CATEGORY_LABEL[intent.categoryLabel])
        : null;
  if (allowedSubtypes) {
    const narrowed = pool.filter((product) =>
      product.subtypes.some((s) => allowedSubtypes.has(s)),
    );
    if (narrowed.length > 0) {
      pool = narrowed;
    }
  }

  // Compatibility filter: when the shopper named a specific model
  // (e.g. "ND filter for Mavic 4 Pro"), narrow accessory results to
  // SKUs that match. We check BOTH `compatibleWithModels` (curated v5
  // tags) AND the SKU title (catches accessories that simply name the
  // host product in their title, like "Freewell ND Filter for DJI
  // Mavic 4 Pro"). Soft filter: if no SKU matches we keep the
  // unfiltered pool rather than render an empty card.
  if (intent.compatibleWith) {
    const target = intent.compatibleWith.toLowerCase();
    const compatible = pool.filter((product) => {
      if (
        product.compatibleWithModels.some((model) =>
          model.toLowerCase().includes(target),
        )
      ) {
        return true;
      }
      if (product.title.toLowerCase().includes(target)) return true;
      return false;
    });
    if (compatible.length > 0) {
      pool = compatible;
    }
  }

  if (typeof intent.priceMax === "number") {
    pool = pool.filter(
      (product) => product.price != null && product.price <= intent.priceMax!,
    );
  }

  // Tier + priceMin are softer filters: try them, but fall back if
  // they zero out the carousel so we still surface *something*.
  if (intent.tier) {
    const tiered = pool.filter((product) => product.tier === intent.tier);
    if (tiered.length > 0) {
      pool = tiered;
    }
  }

  if (typeof intent.priceMin === "number") {
    const floored = pool.filter(
      (product) => product.price != null && product.price >= intent.priceMin!,
    );
    if (floored.length > 0) {
      pool = floored;
    }
  }

  // Use-case tags are HARD filters. If at least one product matches
  // every required tag we keep only those. If not, we fall back to
  // matching ANY one tag (useful for compound asks like "ocean
  // travel"). If even that returns nothing, we return an empty pool,
  // because the wrong recommendation is worse than a "no exact match" message.
  if (intent.requiredTags && intent.requiredTags.length > 0) {
    const tagged = pool.filter((product) =>
      intent.requiredTags!.every((tag) => product.useCaseTags.includes(tag)),
    );
    if (tagged.length > 0) {
      pool = tagged;
    } else if (intent.requiredTags.length > 1) {
      const looser = pool.filter((product) =>
        intent.requiredTags!.some((tag) => product.useCaseTags.includes(tag)),
      );
      pool = looser;
    } else {
      pool = [];
    }
  }

  if (intent.activities && intent.activities.length > 0 && intent.rawQuery) {
    const constraints = buildActivityConstraints(intent.activities);
    pool = enforceAndRankActivityFit(pool, intent.rawQuery, constraints);
  }

  return pool;
}

/**
 * Pick the first N products that have a usable image. Sort priorities:
 *  1. Required-tag match count (more matched tags first).
 *  2. Tier-aligned price ordering (pro = price desc, beginner = price asc).
 *  3. Catalog order (already rating/review-sorted upstream).
 */
export function pickRecommendations(
  products: CatalogProduct[],
  limit = 5,
  intent?: Intent,
): CatalogProduct[] {
  const usable = products.filter((product) => Boolean(product.imageUrl));
  const required = intent?.requiredTags ?? [];

  const tagScore = (product: CatalogProduct) =>
    required.length === 0
      ? 0
      : required.reduce(
          (count, tag) => count + (product.useCaseTags.includes(tag) ? 1 : 0),
          0,
        );

  return [...usable]
    .sort((a, b) => {
      const tagDelta = tagScore(b) - tagScore(a);
      if (tagDelta !== 0) return tagDelta;

      if (intent?.tier === "pro") {
        return (b.price ?? 0) - (a.price ?? 0);
      }
      if (intent?.tier === "beginner") {
        return (
          (a.price ?? Number.MAX_SAFE_INTEGER) -
          (b.price ?? Number.MAX_SAFE_INTEGER)
        );
      }
      return 0;
    })
    .slice(0, limit);
}

/* ---------- Pre-canned response copy ---------- */

export const WELCOME_TITLE = "Hello!";
export const WELCOME_BODY =
  "I'm your Shiseido personal beauty advisor. I can help you build a routine, find the right products for your skin, answer skincare questions, and track your orders. How can I help you today?";

export const WELCOME_NBAS = buildWelcomeNbas(0);

export const PROBING_FALLBACK_BODY =
  "Got it. Could you tell me a bit more so I can find the perfect match? Here are a few common things shoppers narrow down by:";

export const PROBING_NBAS = [
  "Products for dry skin",
  "Best serum for brightening",
  "Sunscreen under $60",
  "Show me what's new",
] as const;

/* ---------- Shiseido customer-care hygiene knowledge base ---------- */
// Source of truth for return / replacement / guarantee / shipping copy
// surfaced by the assistant. Keep this module in lockstep with
// Shiseido's published customer-care policy when it changes. Imported by
// `openaiAgent.ts` (the `lookup_policy` tool) and by both rule-based
// dispatchers (Sidecar + SideBySide), so policy answers stay
// consistent across every path the shopper can take.

/** Public customer-care URL we cite when shoppers ask about policy. */
export const HELP_CENTER_URL =
  "https://www.shiseido.com/us/en/customer-service.html";

/** Hygiene topics the assistant can answer with grounded policy text. */
export type HygieneTopic = "return" | "replacement" | "warranty" | "shipping";

/**
 * Map a free-text shopper query to a hygiene topic, or `null` if the
 * query is not policy-flavoured. Order is intentional: the more-specific
 * cues (`replace`, `warranty`, `ship`) are checked before the generic
 * `return | refund | policy` bucket so a question like "Is there a
 * warranty?" doesn't get summarised as a refund policy.
 */
export function classifyHygieneTopic(query: string): HygieneTopic | null {
  const q = query.toLowerCase();
  if (/\b(replace(?:ment)?|exchange|swap)\b/.test(q)) return "replacement";
  if (/\b(warranty|guarantee|repair|service|defect|broken|faulty|fix)\b/.test(q)) {
    return "warranty";
  }
  // Treat shipping/delivery questions as "shipping" UNLESS the shopper is
  // asking about a specific order ("track my order", "where is my order"),
  // which the order-tracking branch handles separately.
  if (
    /\b(ship(?:ping)?|deliver(?:y|ed)?|arrive|arriving|courier|freight)\b/.test(q) &&
    !/\border\b/.test(q)
  ) {
    return "shipping";
  }
  if (/\b(return|refund|policy|send\s*back|money\s*back)\b/.test(q)) {
    return "return";
  }
  return null;
}

/**
 * Grounded policy copy keyed by hygiene topic. Each body is a single
 * paragraph (renders cleanly inside `AgentSimpleUtterance` and
 * `AgentUtterance`), and ends with the canonical help-center URL so the
 * shopper always has a path to authoritative detail.
 */
export const POLICY_BODIES: Record<HygieneTopic, string> = {
  return:
    "Shiseido accepts returns within 30 days of delivery for a full " +
    "refund. Products should be gently used or unopened, and if a product " +
    "doesn't work for your skin, you can still return it within the " +
    "window. Include your order details, and refunds are issued back to " +
    "the original payment method and typically clear in 7–14 business " +
    "days. Free returns are provided for most orders. " +
    `Full policy: ${HELP_CENTER_URL}`,
  replacement:
    "If your order arrived damaged, leaking, or you received the wrong " +
    "item, we'll send a free replacement. Let us know within 30 days of " +
    "delivery and, where possible, share a photo of the issue so we can " +
    "resolve it quickly. There's no need to return a damaged item " +
    `first in most cases. Details: ${HELP_CENTER_URL}`,
  warranty:
    "Every Shiseido product is backed by our satisfaction guarantee. If " +
    "a product is defective or you experience a reaction, contact " +
    "customer care for a replacement or refund. Store products away from " +
    "direct heat and sunlight, and check the period-after-opening symbol " +
    "on the packaging for how long a product stays at its best once " +
    `opened. Guarantee info: ${HELP_CENTER_URL}`,
  shipping:
    "Shipping times and fees vary by region and ship-to address, and we " +
    "confirm both at checkout, and standard orders typically arrive in " +
    "2–4 business days. Complimentary shipping is available on qualifying " +
    "orders, and you can track your order from your Shiseido account once " +
    `it has shipped. Shipping FAQ: ${HELP_CENTER_URL}`,
};

/**
 * @deprecated Prefer `POLICY_BODIES.return`. Kept as an export so older
 * code paths continue to compile, but always resolves to the canonical
 * return-policy body sourced from Shiseido customer care.
 */
export const RETURN_POLICY_BODY = POLICY_BODIES.return;

export const TRACK_ORDER_BODY =
  "I can help track your latest Shiseido order. I pulled up your most recent purchase details below.";

export const PLP_FOLLOWUP_NBAS = [
  "Compare top picks",
  "Filter by budget",
  "Show different category",
  "Tell me more",
] as const;

export const PDP_FOLLOWUP_NBAS = [
  "Compare with similar",
  "Add to wishlist",
  "What do reviews say",
  "Show more like this",
] as const;

export const CART_FOLLOWUP_NBAS = [
  "Apply a coupon",
  "Continue shopping",
  "Edit cart",
] as const;

export const ORDER_FOLLOWUP_NBAS = [
  "Track this order",
  "Continue shopping",
  "Help with returns",
] as const;

/* =============================================================
 * Stage-aware NBA framework.
 *
 * Every stage has a fixed lane mix. Chip copy is computed
 * dynamically from current `Intent`, `CatalogProduct`, and cart
 * state so each NBA captures real intent and routes back into
 * existing flow handlers (PLP/PDP/cart/order/support).
 * ============================================================= */

export type NbaStage = "probing" | "plp" | "pdp" | "cart" | "order";

export type NbaLane =
  | "refinement"
  | "capture"
  | "conversion"
  | "crossSell"
  | "completeSet"
  | "newJourney"
  | "confidence"
  | "support"
  | "escape";

export type StageNbaItem = {
  label: string;
  lane: NbaLane;
};

export type StageNbaContext =
  | { stage: "probing"; intent?: Intent }
  | {
      stage: "plp";
      intent: Intent;
      matchCount: number;
      /** Optional bundle SKUs available for the displayed category. */
      bundleProducts?: CatalogProduct[];
    }
  | {
      stage: "pdp";
      product: CatalogProduct;
      /** Optional bundle that complements the displayed product. */
      matchingBundle?: CatalogProduct;
      /** Full catalog used to resolve compatible accessories. */
      catalog?: CatalogProduct[];
    }
  | {
      stage: "cart";
      cartProducts: CatalogProduct[];
      matchingBundle?: CatalogProduct;
      catalog?: CatalogProduct[];
    }
  | {
      stage: "order";
      orderProducts: CatalogProduct[];
      matchingBundle?: CatalogProduct;
      catalog?: CatalogProduct[];
    };

/**
 * Catalog-aware complementary suggestions used for cart / order
 * cross-sell chips.  Keys are `CatalogProduct.category` values
 * produced by `normalizeCategory` in catalog.ts.
 */
const COMPLEMENTS_BY_CATEGORY: Record<
  string,
  Array<{ label: string; targetCategory: string }>
> = {
  Cleansers: [
    { label: "Add a softener", targetCategory: "Softeners" },
    { label: "Add a serum", targetCategory: "Serums & Treatments" },
    { label: "Add a moisturizer", targetCategory: "Moisturizers" },
  ],
  Softeners: [
    { label: "Add a serum", targetCategory: "Serums & Treatments" },
    { label: "Add a moisturizer", targetCategory: "Moisturizers" },
    { label: "Add a cleanser", targetCategory: "Cleansers" },
  ],
  "Serums & Treatments": [
    { label: "Add a moisturizer", targetCategory: "Moisturizers" },
    { label: "Add an eye cream", targetCategory: "Eye & Lip Care" },
    { label: "Add daily sunscreen", targetCategory: "Sunscreen" },
  ],
  Moisturizers: [
    { label: "Add daily sunscreen", targetCategory: "Sunscreen" },
    { label: "Add a serum", targetCategory: "Serums & Treatments" },
    { label: "Add an eye cream", targetCategory: "Eye & Lip Care" },
  ],
  "Eye & Lip Care": [
    { label: "Add a moisturizer", targetCategory: "Moisturizers" },
    { label: "Add a serum", targetCategory: "Serums & Treatments" },
  ],
  Masks: [
    { label: "Add a serum", targetCategory: "Serums & Treatments" },
    { label: "Add a moisturizer", targetCategory: "Moisturizers" },
  ],
  Sunscreen: [
    { label: "Add a moisturizer", targetCategory: "Moisturizers" },
    { label: "Add a cleanser", targetCategory: "Cleansers" },
  ],
  "Sets & Bundles": [
    { label: "Add a serum", targetCategory: "Serums & Treatments" },
    { label: "Add daily sunscreen", targetCategory: "Sunscreen" },
  ],
};

const CATEGORY_HUMAN: Record<string, string> = {
  Cleansers: "cleansers",
  Softeners: "softeners",
  "Serums & Treatments": "serums",
  Moisturizers: "moisturizers",
  "Eye & Lip Care": "eye & lip care",
  Masks: "masks",
  Sunscreen: "sunscreen",
  "Sets & Bundles": "sets & bundles",
};

function humanCategory(category: string | undefined): string {
  if (!category) return "products";
  return CATEGORY_HUMAN[category] ?? category.toLowerCase();
}

function nextPriceLadder(currentMax: number | undefined): number {
  if (!currentMax) return 100;
  if (currentMax > 300) return 300;
  if (currentMax > 150) return 150;
  if (currentMax > 100) return 100;
  return 60;
}

function dedupeLabels(items: StageNbaItem[]): StageNbaItem[] {
  const seen = new Set<string>();
  const result: StageNbaItem[] = [];
  for (const item of items) {
    const key = item.label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function buildProbingNbas(intent: Intent | undefined): StageNbaItem[] {
  const category = intent?.categoryLabel;
  const items: StageNbaItem[] = [];

  if (category === "serums & treatments" || !category) {
    items.push(
      { label: "Serums for brightening", lane: "capture" },
      { label: "Best serum for fine lines", lane: "capture" },
      { label: "Hydrating treatments under $150", lane: "capture" },
    );
  } else if (category === "moisturizers") {
    items.push(
      { label: "Moisturizers for dry skin", lane: "capture" },
      { label: "Lightweight creams for oily skin", lane: "capture" },
      { label: "Anti-aging moisturizers", lane: "capture" },
    );
  } else if (category === "sunscreen") {
    items.push(
      { label: "Daily sunscreen for the face", lane: "capture" },
      { label: "Sunscreen under $60", lane: "capture" },
      { label: "Lightweight sunscreen for oily skin", lane: "capture" },
    );
  } else if (category === "cleansers") {
    items.push(
      { label: "Gentle cleansers for sensitive skin", lane: "capture" },
      { label: "Foaming cleansers for oily skin", lane: "capture" },
      { label: "Cleansing oils & makeup removers", lane: "capture" },
    );
  } else {
    items.push(
      { label: "Build a full routine", lane: "capture" },
      { label: "Best serum for brightening", lane: "capture" },
      { label: "Moisturizers for dry skin", lane: "capture" },
    );
  }

  items.push({ label: "Show different category", lane: "escape" });
  return dedupeLabels(items).slice(0, 4);
}

function buildPlpNbas(
  intent: Intent,
  matchCount: number,
  bundleProducts: CatalogProduct[] = [],
): StageNbaItem[] {
  const category = intent.categoryLabel ?? "products";
  const ladder = nextPriceLadder(intent.priceMax);
  const items: StageNbaItem[] = [];

  items.push({
    label: `Show ${humanCategory(intent.categories?.[0])} under $${ladder}`,
    lane: "refinement",
  });

  if (intent.categories?.includes("Sunscreen")) {
    items.push({ label: "Top rated sunscreen", lane: "refinement" });
    items.push({ label: "Lightweight for oily skin", lane: "capture" });
  } else if (intent.categories?.includes("Serums & Treatments")) {
    items.push({ label: "Best sellers only", lane: "refinement" });
    items.push({ label: "Serums for brightening", lane: "capture" });
  } else if (intent.categories?.includes("Moisturizers")) {
    items.push({ label: "Top rated moisturizers", lane: "refinement" });
    items.push({ label: "Best for dry skin", lane: "capture" });
  } else if (intent.categories?.includes("Cleansers")) {
    items.push({ label: "Gentle cleansers only", lane: "refinement" });
    items.push({ label: "Best for oily skin", lane: "capture" });
  } else {
    items.push({ label: `Top rated ${category}`, lane: "refinement" });
    items.push({ label: "Best for my skin type", lane: "capture" });
  }

  // Bundle upsell: only when the current PLP is showing core SKUs
  // (intent.includeBundles === false) and at least one bundle exists
  // in the same category.
  if (!intent.includeBundles && bundleProducts.length > 0) {
    items.push({
      label: `See ${humanCategory(intent.categories?.[0])} bundles & save`,
      lane: "crossSell",
    });
  }

  items.push({ label: "Show different category", lane: "escape" });

  if (matchCount === 0) {
    items.unshift({ label: "Tell me what's possible", lane: "capture" });
  }

  return dedupeLabels(items).slice(0, 4);
}

function buildPdpNbas(
  product: CatalogProduct,
  matchingBundle: CatalogProduct | undefined,
  catalog: CatalogProduct[] | undefined,
): StageNbaItem[] {
  const category = humanCategory(product.category);
  const items: StageNbaItem[] = [
    { label: `Add ${product.title} to cart`, lane: "conversion" },
  ];

  // Bundle upsell takes priority because it's the highest-AOV next move.
  if (matchingBundle && !product.isBundle) {
    items.push({
      label: `Save more with ${matchingBundle.title.split("(")[0].trim()}`,
      lane: "crossSell",
    });
  }

  items.push({ label: `Compare with similar ${category}`, lane: "conversion" });
  items.push({ label: "What do reviews say", lane: "confidence" });

  // Surface a concrete, model-specific accessory chip when we have a
  // catalog to query. Falls back to the static `COMPLEMENTS_BY_CATEGORY`
  // suggestion if no compatible accessory is found.
  if (items.length < 4) {
    const accessory = catalog
      ? findAccessoriesFor(product, catalog, { limit: 1 })[0]
      : undefined;
    if (accessory) {
      items.push({ label: accessoryChipLabel(accessory), lane: "crossSell" });
    } else {
      const complements = COMPLEMENTS_BY_CATEGORY[product.category] ?? [];
      const crossSell = complements.find(
        (entry) => entry.targetCategory !== product.category,
      );
      items.push({
        label: crossSell?.label ?? "Show more like this",
        lane: "crossSell",
      });
    }
  }

  return dedupeLabels(items).slice(0, 4);
}

function buildCartNbas(
  cartProducts: CatalogProduct[],
  matchingBundle: CatalogProduct | undefined,
  catalog: CatalogProduct[] | undefined,
): StageNbaItem[] {
  const primary = cartProducts[0];
  const items: StageNbaItem[] = [];

  // Bundle upgrade is the highest-AOV cross-sell, so seed it first.
  if (matchingBundle && primary && !primary.isBundle) {
    items.push({
      label: `Upgrade to ${matchingBundle.title.split("(")[0].trim()}`,
      lane: "crossSell",
    });
  }

  // Prefer real, compatible accessory chips from the catalog. We pull
  // up to two distinct roles (e.g. one battery + one ND filter) so the
  // shopper sees genuine ecosystem add-ons. Fall back to the static
  // category complements when nothing matches.
  if (primary && catalog) {
    const accessoryPicks = buildAccessoryBundle(primary, catalog, 2);
    for (const accessory of accessoryPicks) {
      items.push({ label: accessoryChipLabel(accessory), lane: "crossSell" });
    }
  }

  if (
    items.filter((item) => item.lane === "crossSell" && item.label.startsWith("Add ")).length === 0 &&
    primary
  ) {
    const complements = COMPLEMENTS_BY_CATEGORY[primary.category] ?? [];
    for (const complement of complements.slice(0, 2)) {
      items.push({ label: complement.label, lane: "crossSell" });
    }
  }

  items.push({ label: "Apply promo GLOW10", lane: "conversion" });
  items.push({ label: "Continue shopping", lane: "escape" });

  if (items.filter((item) => item.lane === "crossSell").length === 0) {
    items.unshift({ label: "Pay with Apple Pay", lane: "conversion" });
  }

  return dedupeLabels(items).slice(0, 4);
}

function buildOrderNbas(
  orderProducts: CatalogProduct[],
  matchingBundle: CatalogProduct | undefined,
  catalog: CatalogProduct[] | undefined,
): StageNbaItem[] {
  const purchased = orderProducts[0];
  const items: StageNbaItem[] = [];

  if (purchased) {
    // Post-purchase, the strongest "complete the set" chip is a
    // model-specific ND filter / battery, so surface that first when we
    // can resolve a real accessory from the catalog.
    if (catalog) {
      const accessory = findAccessoriesFor(purchased, catalog, { limit: 1 })[0];
      if (accessory) {
        items.push({ label: accessoryChipLabel(accessory), lane: "completeSet" });
      }
    }

    const complements = COMPLEMENTS_BY_CATEGORY[purchased.category] ?? [];
    const crossCategory = complements.find(
      (entry) => entry.targetCategory !== purchased.category,
    );
    if (items.length === 0) {
      const completeSet = complements.find(
        (entry) => entry.targetCategory === purchased.category,
      );
      if (completeSet) {
        items.push({ label: completeSet.label, lane: "completeSet" });
      }
    }
    if (crossCategory) {
      items.push({ label: crossCategory.label, lane: "crossSell" });
    } else if (complements[0]) {
      items.push({ label: complements[0].label, lane: "crossSell" });
    }
  }

  // Post-purchase bundle nudge: useful when shopper bought a base
  // SKU and the next-trip-up is the matching combo.
  if (matchingBundle && purchased && !purchased.isBundle) {
    items.push({
      label: `Explore ${matchingBundle.title.split("(")[0].trim()}`,
      lane: "crossSell",
    });
  }

  if (items.length < 2) {
    items.push({ label: "Discover best-selling serums", lane: "crossSell" });
  }

  items.push({ label: "Start a new search", lane: "newJourney" });
  items.push({ label: "Track this order", lane: "support" });

  return dedupeLabels(items).slice(0, 4);
}

/**
 * Build dynamic NBAs for a given conversation stage.
 * The host (`SidecarAssistant.tsx`) supplies stage-specific context;
 * the helper returns labelled chips with their semantic lane so
 * telemetry can attribute clicks back to lane intent.
 */
export function buildStageNbas(context: StageNbaContext): StageNbaItem[] {
  switch (context.stage) {
    case "probing":
      return buildProbingNbas(context.intent);
    case "plp":
      return buildPlpNbas(
        context.intent,
        context.matchCount,
        context.bundleProducts,
      );
    case "pdp":
      return buildPdpNbas(
        context.product,
        context.matchingBundle,
        context.catalog,
      );
    case "cart":
      return buildCartNbas(
        context.cartProducts,
        context.matchingBundle,
        context.catalog,
      );
    case "order":
      return buildOrderNbas(
        context.orderProducts,
        context.matchingBundle,
        context.catalog,
      );
  }
}

/* =============================================================
 * Accessory recommendations (v5 schema)
 *
 * The CSV ships `compatible_with_type`, `accessory_role`, and
 * `compatible_with_models` per row. These helpers translate those
 * tags into actionable cross-sell suggestions:
 *   findAccessoriesFor(core)   – list of compatible accessories
 *   buildAccessoryBundle(core) – picks 3 across different roles
 * ============================================================= */

const ACCESSORY_ROLE_LABELS: Record<AccessoryRole, string> = {
  power: "complementary product",
  mounting: "complementary product",
  stabilization: "complementary product",
  visual_enhancement: "complementary product",
  storage: "complementary product",
  general: "complementary product",
  fpv_component: "complementary product",
};

/**
 * Roles that we treat as "common ecosystem add-ons" worth surfacing
 * automatically. `general` and `stabilization` are too broad/niche
 * to seed by default but are still queryable. `fpv_component` is
 * intentionally NOT in the default list: it only applies to the
 * Avata family and would over-surface goggles for non-FPV cores.
 * `buildAccessoryBundle` picks it up explicitly via series matching
 * (see `buildFPVEcosystemBundle`).
 */
const DEFAULT_ACCESSORY_ROLES: AccessoryRole[] = [
  "power",
  "visual_enhancement",
  "storage",
  "mounting",
];

/**
 * Series considered "FPV hosts": when a shopper looks at one of
 * these cores we add `fpv_component` cross-sell on top of the normal
 * battery/filter/case/mount triad.
 */
const FPV_HOST_SERIES = new Set<string>([]);

/**
 * Normalize a model token from the CSV's `compatible_with_models`
 * column (e.g. `"dji mini 2"`, `"dji osmo action 6 5895"`) into a
 * lowercased substring we can fuzzy-match against a product title.
 */
function normalizeModelToken(token: string): string {
  return token
    .toLowerCase()
    .replace(/^dji\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Does an accessory list a specific model that matches `coreTitle`?
 * Empty `compatibleWithModels` = "compatible with the whole product
 * type", so this returns `true` (no model constraint).
 */
function accessoryMatchesModel(
  accessory: CatalogProduct,
  coreTitle: string,
): boolean {
  if (accessory.compatibleWithModels.length === 0) return true;
  const lowered = coreTitle.toLowerCase();
  return accessory.compatibleWithModels.some((rawToken) => {
    const token = normalizeModelToken(rawToken);
    if (!token) return false;
    return lowered.includes(token);
  });
}

/**
 * Does an accessory's `compatible_with_type` cover the host's
 * `productTypeGroup`? `universal` is treated as a free pass.
 */
function accessoryMatchesType(
  accessory: CatalogProduct,
  hostGroup: ProductTypeGroup,
): boolean {
  if (accessory.compatibleWithType.length === 0) return false;
  if (accessory.compatibleWithType.includes("universal")) return true;
  if (hostGroup === "gimbal") {
    return (
      accessory.compatibleWithType.includes("mobile_gimbal") ||
      accessory.compatibleWithType.includes("camera_gimbal") ||
      accessory.compatibleWithType.includes("mobile") ||
      accessory.compatibleWithType.includes("mirrorless_camera")
    );
  }
  return accessory.compatibleWithType.includes(hostGroup);
}

/**
 * Strict compatibility check for combo assembly surfaces.
 *
 * Rules:
 * - Accessory `compatible_with_type` must match the core's type (or be universal).
 * - If the accessory declares `compatible_with_models`, at least one model token
 *   must match the core title.
 * - If it does NOT declare models, it is allowed only when explicitly marked
 *   universal in `compatible_with_type`.
 */
export function isAccessoryCompatibleWithCoreStrict(
  accessory: CatalogProduct,
  core: CatalogProduct,
): boolean {
  if (!accessory.isAccessory) return false;
  if (core.isAccessory) return false;
  const hostGroup = core.productTypeGroup;
  if (!hostGroup) return false;
  if (!accessoryMatchesType(accessory, hostGroup)) return false;

  const hasExplicitModels = accessory.compatibleWithModels.length > 0;
  if (hasExplicitModels) {
    /* Phone-gimbal escape hatch. DJI's v6 tagging for the universal
     * phone-creator accessories (DJI Mic family, OM Magnetic Phone
     * Clamp, Magnetic Ball Joint Mount, Mini Tripod, Extension Rod,
     * OM Multifunctional Module) leaves `compatible_with_models`
     * pointing at the accessory's own SKU family rather than at the
     * host gimbal. Combined with the catalog-load enrichment that
     * adds `mobile_gimbal` to their compatible_with_type, this hook
     * trusts the type-tag for mobile_gimbal cores so the strict
     * model-string check below doesn't reject every plausible
     * accessory and leave the phone-photography kit core-only. */
    if (
      core.productType === "mobile_gimbal" &&
      accessory.compatibleWithType.includes("mobile_gimbal")
    ) {
      return true;
    }
    if (!accessoryMatchesModel(accessory, core.title)) return false;
    const coreLower = core.title.toLowerCase();
    const titleLower = accessory.title.toLowerCase();
    const modelFamilies = ["mini", "mavic", "air", "avata", "neo", "action", "pocket"];
    for (const family of modelFamilies) {
      const coreModel = coreLower.match(new RegExp(`\\b${family}\\s*(\\d+)\\b`, "i"));
      const accessoryModel = titleLower.match(
        new RegExp(`\\b${family}\\s*(\\d+)\\b`, "i"),
      );
      if (!coreModel || !accessoryModel) continue;
      if (coreModel[1] !== accessoryModel[1]) return false;
    }
    return true;
  }
  if (!accessory.compatibleWithType.includes("universal")) return false;
  if (hostGroup === "drone") {
    const likelyModelSpecificPart = accessory.subtypes.some((s) =>
      ["acc_battery", "acc_propeller", "acc_landing_gear"].includes(s),
    );
    if (likelyModelSpecificPart) return false;
  }
  return true;
}

export function isAccessoryCompatibleWithAnyCoreStrict(
  accessory: CatalogProduct,
  cores: CatalogProduct[],
): boolean {
  return cores.some((core) => isAccessoryCompatibleWithCoreStrict(accessory, core));
}

export type FindAccessoriesOptions = {
  /** Restrict to a specific role (e.g. only `power` accessories). */
  role?: AccessoryRole;
  /** Max number of results returned. Default 5. */
  limit?: number;
  /**
   * When true, require an explicit model match in
   * `compatible_with_models`. When false (default), type-only
   * compatibility is enough.
   */
  requireModelMatch?: boolean;
  /**
   * Optional v6 subtype filter that narrows the role bucket further.
   * e.g. `role: "visual_enhancement"` + `subtypes: ["acc_filter_cpl"]`
   * surfaces polarising filters specifically rather than every
   * visual-enhancement SKU. Soft filter: if no candidate carries any
   * listed subtype the unfiltered role bucket is kept so the card
   * still renders something rather than going empty.
   */
  subtypes?: string[];
  /**
   * Optional v6 capability filter that narrows by `useCaseTags` (the
   * canonical tag set already exposed on `CatalogProduct`). Used by
   * the symptom router for waterproof gear: role `general` is too
   * wide, so we additionally require `waterproof` / `underwater` to
   * suppress ordinary carrying cases. Soft filter, same fallback
   * semantics as `subtypes`.
   */
  capabilities?: string[];
};

/**
 * Find catalog accessories compatible with `core` (e.g. given a Mini 4
 * Pro, return ND filters / spare batteries / cases that target it).
 * Sorted with model-specific matches first, then by rating.
 */
export function findAccessoriesFor(
  core: CatalogProduct,
  catalog: CatalogProduct[],
  options: FindAccessoriesOptions = {},
): CatalogProduct[] {
  const { role, limit = 5, requireModelMatch = false, subtypes, capabilities } = options;
  if (core.isAccessory) return [];
  const hostGroup = core.productTypeGroup;
  if (!hostGroup) return [];

  const candidates = catalog.filter((candidate) => {
    if (candidate.slug === core.slug) return false;
    if (!candidate.isAccessory) return false;
    if (!candidate.imageUrl) return false;
    if (role && candidate.accessoryRole !== role) return false;
    if (!accessoryMatchesType(candidate, hostGroup)) return false;
    const modelMatch = accessoryMatchesModel(candidate, core.title);
    /* Phone-gimbal escape hatch that mirrors the rule in
     * isAccessoryCompatibleWithCoreStrict. The v6 catalog under-tags
     * the universal phone-creator SKUs (DJI Mic family, OM Magnetic
     * Phone Clamp, Magnetic Ball Joint Mount, Mini Tripod, Mini
     * Extension Rod, OM Multifunctional Module): `compatible_with_models`
     * lists the accessory's own SKU family (e.g. ['DJI Mic 2']) rather
     * than the host gimbal, so the model-string check below would
     * reject every plausible accessory and leave the phone kit
     * core-only. When the core is a mobile_gimbal AND the accessory
     * carries `mobile_gimbal` in its compatible_with_type (added at
     * catalog load via PHONE_FRIENDLY_ACCESSORY_PATTERN), we trust
     * the type tag and accept the candidate. */
    const phoneGimbalEscape =
      core.productType === "mobile_gimbal" &&
      candidate.compatibleWithType.includes("mobile_gimbal");
    if (requireModelMatch && candidate.compatibleWithModels.length === 0) {
      return false;
    }
    if (requireModelMatch && !modelMatch && !phoneGimbalEscape) return false;
    return modelMatch || phoneGimbalEscape;
  });

  // Soft subtype narrowing inside the role bucket. e.g. when the
  // symptom router asks for `acc_filter_cpl` we keep only kits that
  // carry that subtype, but if the data has no CPL-tagged kit for
  // this host (gap in tagging) we keep the broader bucket so the
  // shopper still gets a useful answer.
  let narrowed = candidates;
  if (subtypes && subtypes.length > 0) {
    const allow = new Set(subtypes);
    const passed = candidates.filter((c) => c.subtypes.some((s) => allow.has(s)));
    if (passed.length > 0) narrowed = passed;
  }
  if (capabilities && capabilities.length > 0) {
    const allow = new Set(capabilities);
    const passed = narrowed.filter((c) => c.useCaseTags.some((t) => allow.has(t)));
    if (passed.length > 0) narrowed = passed;
  }

  return narrowed
    .sort((a, b) => {
      const aModel = a.compatibleWithModels.length > 0 ? 1 : 0;
      const bModel = b.compatibleWithModels.length > 0 ? 1 : 0;
      if (aModel !== bModel) return bModel - aModel;
      return (b.rating ?? 0) - (a.rating ?? 0);
    })
    .slice(0, limit);
}

/**
 * Compose a small, role-diverse accessory bundle for `core`. Picks at
 * most one accessory per role from {@link DEFAULT_ACCESSORY_ROLES} so
 * the resulting bundle covers power, filters, storage, and mounting.
 *
 * For FPV hosts (Avata family) the bundle is prefixed with one
 * `fpv_component` pick (goggles or controller) so the cross-sell
 * leads with the experience-defining peripheral, not a battery.
 *
 * When `size > 4` (e.g. the Wingman Plan page's pro tier asking for 7
 * tiles), the role-uniqueness rule alone can't fill the request, because the
 * default role pool only has 4 entries. After the first one-per-role
 * pass, do a second pass that allows up to 2 picks per role, still
 * de-duped by slug, until we either reach `size` or run out of
 * compatible inventory. This keeps the bundle role-balanced for small
 * sizes while letting larger requests pull a second filter pack, a
 * second battery, etc.
 */
export function buildAccessoryBundle(
  core: CatalogProduct,
  catalog: CatalogProduct[],
  size = 3,
): CatalogProduct[] {
  const picks: CatalogProduct[] = [];

  if (core.series && FPV_HOST_SERIES.has(core.series)) {
    const [fpvPick] = findAccessoriesFor(core, catalog, {
      role: "fpv_component",
      limit: 1,
    });
    if (fpvPick) picks.push(fpvPick);
  }

  for (const role of DEFAULT_ACCESSORY_ROLES) {
    if (picks.length >= size) break;
    const [match] = findAccessoriesFor(core, catalog, { role, limit: 1 });
    if (match && !picks.some((p) => p.slug === match.slug)) {
      picks.push(match);
    }
  }

  if (picks.length < size) {
    for (const role of DEFAULT_ACCESSORY_ROLES) {
      if (picks.length >= size) break;
      const matches = findAccessoriesFor(core, catalog, { role, limit: 2 });
      for (const match of matches) {
        if (picks.length >= size) break;
        if (!picks.some((p) => p.slug === match.slug)) {
          picks.push(match);
        }
      }
    }
  }

  return picks;
}

/**
 * Find FPV peripherals (goggles + controllers) compatible with `core`.
 * Returns an empty array when `core` isn't an FPV host. Lets callers
 * surface a dedicated "Pair with goggles + controller" upsell rather
 * than blending FPV peripherals into the generic accessory bundle.
 */
export function findFPVEcosystemFor(
  core: CatalogProduct,
  catalog: CatalogProduct[],
  limit = 4,
): CatalogProduct[] {
  if (!core.series || !FPV_HOST_SERIES.has(core.series)) return [];
  return findAccessoriesFor(core, catalog, {
    role: "fpv_component",
    limit,
  });
}

/**
 * Build a chip label that points at a specific accessory. We stay in
 * the existing label-based NBA shape so click → "act on this label"
 * still works downstream (the agent reads the chip text and treats it
 * like a shopper utterance).
 */
function accessoryChipLabel(accessory: CatalogProduct): string {
  const role = accessory.accessoryRole;
  const friendlyRole =
    role && role !== "general" ? ACCESSORY_ROLE_LABELS[role] : "accessory";
  // Prefer a concise human label because the full SKU title can be long.
  // "Add Freewell ND filter (Mini 4 Pro)" reads better than the raw
  // marketing title.
  return `Add ${capitalize(friendlyRole)}: ${shortenTitle(accessory.title)}`;
}

function capitalize(value: string): string {
  if (!value) return value;
  return value[0].toUpperCase() + value.slice(1);
}

function shortenTitle(title: string): string {
  // Strip vendor prefixes and trailing SKU numbers so chips fit.
  return title
    .replace(/^(PGYTech|SmallRig|Freewell|DJI Osmo|DJI)\s+/i, "")
    .replace(/\s+\d{3,}\s*$/, "")
    .replace(/\s+\(.*?\)\s*$/, "")
    .trim();
}

/** Find bundles in the same categories as the current PLP intent. */
export function findBundlesForIntent(
  intent: Intent,
  products: CatalogProduct[],
  limit = 5,
): CatalogProduct[] {
  if (intent.includeBundles) return [];
  const cats = intent.categories;
  return products
    .filter(
      (product) =>
        product.isBundle &&
        Boolean(product.imageUrl) &&
        (!cats || cats.length === 0 || cats.includes(product.category)),
    )
    .slice(0, limit);
}

/**
 * Find a bundle that pairs with the given base product. First tries
 * the explicit `bundleBaseSlug` linkage, then falls back to the same
 * category.
 */
export function findMatchingBundle(
  product: CatalogProduct,
  products: CatalogProduct[],
): CatalogProduct | undefined {
  if (product.isBundle) return undefined;
  const linked = products.find(
    (candidate) => candidate.isBundle && candidate.bundleBaseSlug === product.slug,
  );
  if (linked) return linked;
  return products.find(
    (candidate) =>
      candidate.isBundle &&
      candidate.category === product.category &&
      Boolean(candidate.imageUrl),
  );
}

const USE_CASE_INTRO_FRAGMENT: Record<string, string> = {
  dry: "for dry skin",
  oily: "for oily skin",
  combination: "for combination skin",
  normal: "for normal skin",
  spf: "sun-protecting",
  "best-seller": "best-selling",
};

function useCaseIntro(tags: string[] | undefined): string {
  if (!tags || tags.length === 0) return "";
  const fragments = tags
    .map((tag) => USE_CASE_INTRO_FRAGMENT[tag])
    .filter(Boolean);
  if (fragments.length === 0) return "";
  return ` ${fragments.join(", ")}`;
}

/** Build the agent's intro line for a PLP response based on the query/intent. */
export function buildPlpIntro(query: string, intent: Intent, count: number): string {
  if (count === 0) {
    return "I couldn't find an exact match for that, but here's a curated selection that's close.";
  }

  if (intent.includeBundles) {
    const label = intent.categoryLabel ? ` ${intent.categoryLabel}` : "";
    return `Here are some bundle deals${label} that save you more:`;
  }

  const tierClause =
    intent.tier === "pro"
      ? " prestige"
      : intent.tier === "beginner"
      ? " everyday"
      : "";
  const useCaseClause = useCaseIntro(intent.requiredTags);
  const label = intent.categoryLabel ? ` ${intent.categoryLabel}` : "";
  const priceClause =
    typeof intent.priceMax === "number" ? ` under $${intent.priceMax}` : "";

  if (tierClause || useCaseClause || label || priceClause) {
    return `Here are some great${tierClause}${useCaseClause}${label}${priceClause} that match what you described:`;
  }

  return `Here are a few options that match "${query.trim()}":`;
}
