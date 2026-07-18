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
  // Accessory categories come FIRST so "ND filter for Mavic 4 Pro"
  // routes to filters (not drones). The drone pattern below would
  // otherwise capture the "Mavic" mention and wrongly assign a
  // drone-pro intent to an accessory query.
  {
    test: /\b(nd\s*filter\w*|cpl|polariz\w*|uv\s*filter|filter\s*set|filter\s*kit|lens\s*filter\w*|magnetic\s*filter)\b/i,
    categories: ["Lens filters", "Drone accessories"],
    label: "filters",
  },
  {
    test: /\b(helmet\s*mount|handlebar\s*mount|suction\s*mount|chest\s*strap|wrist\s*strap|head\s*band|magnetic\s*mount|tripod\s*mount|adapter\s*mount|mounting\s*accessor\w*)\b/i,
    categories: ["Action camera mounts", "Drone accessories", "Accessory kits"],
    label: "mounts",
  },
  {
    test: /\b(intelligent\s*flight\s*battery|extra\s*batter\w*|spare\s*batter\w*|batter(y|ies)\b)\b/i,
    categories: ["Camera batteries", "Drone accessories"],
    label: "batteries",
  },
  {
    test: /\b(charging\s*hub|charger\w*|charging\s*case)\b/i,
    categories: ["Camera Chargers", "Drone accessories"],
    label: "chargers",
  },
  {
    test: /\b(carrying\s*case|hard\s*case|protective\s*case|safety\s*case|backpack\w*|shoulder\s*bag|action\s*camera\s*case)\b/i,
    categories: ["Camera cases, bags and backpacks", "Drone accessories", "Accessory kits"],
    label: "cases",
  },
  {
    test: /\b(propeller\w*|prop\s*guard|landing\s*gear)\b/i,
    categories: ["Drone accessories"],
    label: "propellers",
  },
  {
    test: /\b(remote\s*control\w*|controller\w*|gps\s*remote)\b/i,
    categories: ["Camera Remote Controls"],
    label: "remotes",
  },
  {
    test: /\b(tripod\w*|monopod\w*|selfie\s*stick\w*|extension\s*rod\w*)\b/i,
    categories: ["Tripods and monopods", "Camera grips & sticks"],
    label: "tripods",
  },
  {
    test: /\b(wide[- ]?angle\s*lens\w*|lens\s*cover\w*|lens\s*protector\w*)\b/i,
    categories: ["Wide-angle lenses", "Lens filters"],
    label: "lenses",
  },
  // Generic "accessories" — catches queries like "accessories for
  // flip drone" / "accessory kit for Mini 5 Pro" that explicitly ask
  // for the accessory ecosystem of a host product. Placed BEFORE the
  // drones / cameras patterns so "drone" in "accessories for flip
  // drone" doesn't capture the query as a flagship-drone listing.
  // Categories list spans every v6 accessory bucket; the model-compat
  // filter narrows to the named host product.
  {
    test: /\b(accessor(y|ies)|add[- ]ons?)\b/i,
    categories: [
      "Drone accessories",
      "Action camera mounts",
      "Accessory kits",
      "Camera grips & sticks",
      "Camera cases, bags and backpacks",
      "Lens filters",
      "Camera batteries",
      "Camera Chargers",
      "Camera Adaptors",
      "Straps",
      "Camera microphones",
      "Tripods and monopods",
      "Wide-angle lenses",
      "Camera Remote Controls",
    ],
    label: "accessories",
  },
  {
    test: /\b(microphones?|mics?|wireless\s*mics?|lavs?|lavaliers?)\b/i,
    categories: ["Microphones"],
    label: "microphones",
  },
  {
    test: /\b(gimbals?|stabilizers?|osmo\s*mobile|ronin)\b/i,
    categories: ["Gimbals"],
    label: "gimbals",
  },
  {
    test: /\b(action\s*cams?|action\s*cameras?|gopro|osmo\s*action)\b/i,
    categories: ["Action cameras"],
    label: "action cameras",
  },
  {
    test: /\b(drones?|mavic|avata|mini|air|neo|fpv|quadcopters?|aerial)\b/i,
    categories: ["Drones", "4K drones"],
    label: "drones",
  },
  // Plain "camera/cameras" maps to action + handheld cameras only.
  // Drones live under their own pattern above. Phrases like
  // "filmmaking drone" / "cinematic 4K aerial" still hit the drones
  // pattern earlier in the list.
  {
    test: /\b(cameras?|videos?|footage|handheld\s*cameras?)\b/i,
    categories: ["Action cameras"],
    label: "cameras",
  },
];

const BROAD_PATTERNS: RegExp[] = [
  /\b(return|refund|policy|warranty|shipping|delivery\s*time|track\s*order|order\s*status|customer\s*service)\b/i,
  /\b(help\s*me|not\s*sure|advice|where\s*do\s*i\s*start|how\s*do\s*i)\b/i,
  // Exploratory cues like "gear for moto vlogging" / "equipment for a film
  // shoot" / "kit for travel" — multi-category curated requests that should
  // route to the broad result card instead of a single PLP carousel.
  /\b(gear|equipment|kit|setup|essentials|accessor(y|ies))\s+for\b/i,
];

/**
 * Use-case keyword detection. Each match adds a tag to the intent so
 * `filterProducts` can require it (e.g. "diving" -> require
 * `waterproof`).
 */
const USE_CASE_PATTERNS: Array<{ test: RegExp; tag: string }> = [
  {
    test: /\b(dive|diving|scuba|snorkel\w*|underwater|submer\w*|swim\w*|ocean|sea|surf\w*|beach|kayak|raft\w*|pool|wet|rain|wash)\b/i,
    tag: "waterproof",
  },
  {
    test: /\b(rugged|extreme|cold|harsh|adventure|outdoor|hiking|skiing|biking|mountain)\b/i,
    tag: "rugged",
  },
  { test: /\b(vlog\w*|content\s*creat\w*|selfie|creator)\b/i, tag: "vlogging" },
  { test: /\b(360|panoramic|all-?around)\b/i, tag: "360" },
  { test: /\b(travel|trip|backpack\w*|portable|compact|lightweight)\b/i, tag: "compact" },
  { test: /\b(low[-\s]?light|night\s*shoot\w*|dim|sunset|sunrise|astro)\b/i, tag: "lowlight" },
  { test: /\b(fpv|first[-\s]?person|race|racing)\b/i, tag: "fpv" },
];

function inferUseCaseTags(text: string): string[] {
  const tags = new Set<string>();
  for (const rule of USE_CASE_PATTERNS) {
    if (rule.test.test(text)) tags.add(rule.tag);
  }
  return [...tags];
}

/**
 * Vocabulary -> shopper expertise tier.
 * Used by both `classifyIntent` (rule-based fallback) and the OpenAI
 * agent's prompt so we never recommend the DJI Neo to someone who said
 * "expert" or "cinematic".
 */
const TIER_PATTERNS: Array<{ test: RegExp; tier: ProductTier }> = [
  {
    test: /\b(pro|professional|expert|cinematic|cinema|filmmak\w*|serious|commercial|enterprise|broadcast|production)\b/i,
    tier: "pro",
  },
  {
    test: /\b(beginner|first\s*drone|starter|easy|kid|gift|casual|just\s*trying|new\s*to|entry\s*level)\b/i,
    tier: "beginner",
  },
  {
    test: /\b(hobbyist|weekend|enthusiast|mid\s*range|midrange|intermediate|prosumer)\b/i,
    tier: "intermediate",
  },
];

/**
 * Per-category price floor we apply when the shopper signals a `pro`
 * tier, so entry-level gear doesn't dominate the carousel.
 */
const PRO_PRICE_FLOOR_BY_CATEGORY: Record<string, number> = {
  Drones: 1000,
  "4K drones": 1000,
  "Action cameras": 400,
  Microphones: 250,
  Gimbals: 400,
};

function inferTierFromText(text: string): ProductTier | undefined {
  const hit = TIER_PATTERNS.find((entry) => entry.test.test(text));
  return hit?.tier;
}

export type LandingNbaLane =
  | "droneDiscovery"
  | "categoryGuidance"
  | "decisionSupport"
  | "supportIntent";

const LANDING_LANES: LandingNbaLane[] = [
  "droneDiscovery",
  "categoryGuidance",
  "decisionSupport",
  "supportIntent",
];

const LANDING_NBA_BASE: Record<LandingNbaLane, string> = {
  droneDiscovery: "Find the right drone for me",
  categoryGuidance: "Help me choose a vlogging mic",
  decisionSupport: "Compare drones under $500",
  supportIntent: "Track my recent order",
};

const LANDING_NBA_ALTERNATES: Record<LandingNbaLane, readonly string[]> = {
  droneDiscovery: ["Best drone for beginners", "Travel-friendly drones"],
  categoryGuidance: [
    "Help me choose an action camera",
    "Find the right gimbal",
  ],
  decisionSupport: [
    "Show top rated drones",
    "Drone vs action camera for travel",
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
   * `title` contain this token — so "ND filter for Mavic 4 Pro"
   * surfaces only Mavic 4 Pro filters, not the full lens-filter
   * catalog.
   */
  compatibleWith?: string;
  /**
   * v6 subtype hints from the query ("helmet mount" → mount_helmet,
   * "ND filter" → acc_filter_nd). When present, narrows products to
   * those carrying at least one of these subtypes — sharper than the
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
 * accessory results filter to that family. ORDER MATTERS — more
 * specific patterns must come BEFORE shorter ones (e.g. "Mavic 4 Pro"
 * before "Mavic 3", "Mini 5 Pro" before "Mini 5").
 */
const MODEL_PATTERNS: Array<{ test: RegExp; model: string }> = [
  // Drones — Mavic family
  { test: /\bmavic\s*4\s*pro\b/i, model: "mavic 4 pro" },
  { test: /\bmavic\s*3\s*pro\b/i, model: "mavic 3 pro" },
  { test: /\bmavic\s*3\b/i, model: "mavic 3" },
  // Drones — Mini family
  { test: /\bmini\s*5\s*pro\b/i, model: "mini 5 pro" },
  { test: /\bmini\s*4\s*pro\b/i, model: "mini 4 pro" },
  { test: /\bmini\s*4k\b/i, model: "mini 4k" },
  { test: /\bmini\s*3\b/i, model: "mini 3" },
  { test: /\bmini\s*2\b/i, model: "mini 2" },
  // Drones — others
  { test: /\bavata\s*360\b/i, model: "avata 360" },
  { test: /\bavata\s*2\b/i, model: "avata 2" },
  { test: /\bavata\b/i, model: "avata" },
  { test: /\bair\s*3s\b/i, model: "air 3s" },
  { test: /\bair\s*2s\b/i, model: "air 2s" },
  { test: /\bneo\s*2\b/i, model: "neo 2" },
  { test: /\bneo\b/i, model: "neo" },
  { test: /\bflip\b/i, model: "flip" },
  { test: /\blito\s*x?\s*1\b/i, model: "lito" },
  // Action cameras
  { test: /\bosmo\s*action\s*6\b/i, model: "osmo action 6" },
  { test: /\bosmo\s*action\s*5\s*pro\b/i, model: "osmo action 5 pro" },
  { test: /\baction\s*5\s*pro\b/i, model: "osmo action 5 pro" },
  { test: /\bosmo\s*action\s*4\b/i, model: "osmo action 4" },
  { test: /\baction\s*4\b/i, model: "osmo action 4" },
  { test: /\bosmo\s*action\s*3\b/i, model: "osmo action 3" },
  { test: /\baction\s*3\b/i, model: "osmo action 3" },
  { test: /\bosmo\s*nano\b/i, model: "osmo nano" },
  { test: /\bosmo\s*360\b/i, model: "osmo 360" },
  { test: /\baction\s*2\b/i, model: "action 2" },
  // Pockets
  { test: /\bosmo\s*pocket\s*4\b/i, model: "osmo pocket 4" },
  { test: /\bpocket\s*4\b/i, model: "osmo pocket 4" },
  { test: /\bosmo\s*pocket\s*3\b/i, model: "osmo pocket 3" },
  { test: /\bpocket\s*3\b/i, model: "osmo pocket 3" },
  // Gimbals
  { test: /\brs\s*5\b/i, model: "rs 5" },
  { test: /\brs\s*4\s*pro\b/i, model: "rs 4 pro" },
  { test: /\brs\s*4\s*mini\b/i, model: "rs 4 mini" },
  { test: /\brs\s*4\b/i, model: "rs 4" },
  { test: /\bosmo\s*mobile\s*8\b/i, model: "osmo mobile 8" },
  { test: /\bosmo\s*mobile\s*7p\b/i, model: "osmo mobile 7p" },
  { test: /\bosmo\s*mobile\s*7\b/i, model: "osmo mobile 7" },
  { test: /\bosmo\s*mobile\s*se\b/i, model: "osmo mobile se" },
  // Mics
  { test: /\bmic\s*3\b/i, model: "mic 3" },
  { test: /\bmic\s*2\b/i, model: "mic 2" },
  { test: /\bmic\s*mini\b/i, model: "mic mini" },
];

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
 * Specific subtype hints — when the shopper names a precise mount /
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
const SUBTYPE_HINT_PATTERNS: Array<{ test: RegExp; subtypes: string[] }> = [
  // Mount-type variants
  { test: /\bhelmet\s*(mount|chin)\b|\bchin\s*mount\b/i, subtypes: ["mount_helmet"] },
  { test: /\bhandlebar\b/i, subtypes: ["mount_handlebar"] },
  { test: /\bsuction\s*(cup|mount)\b/i, subtypes: ["mount_suction"] },
  { test: /\bchest\s*(strap|mount)\b/i, subtypes: ["mount_chest"] },
  { test: /\b(hanging\s*)?neck\s*mount\b|\bhanging\s*neck\b/i, subtypes: ["mount_neck"] },
  { test: /\bwrist\s*(strap|mount|band)\b/i, subtypes: ["mount_wrist"] },
  { test: /\bmagnetic\s*(ball[- ]?joint|mount)\b|\bball\s*joint\b/i, subtypes: ["mount_magnetic"] },
  { test: /\btripod\s*mount\b|\bmini\s*tripod\b/i, subtypes: ["mount_tripod"] },
  { test: /\bclamp\b|\bnato\s*clamp\b/i, subtypes: ["mount_clamp"] },
  { test: /\bextension\s*rod\b|\bselfie\s*stick\b/i, subtypes: ["mount_extension"] },
  // Filter-type variants
  { test: /\bnd\s*\d|\bnd\s*filter\b|\bsplit\s*nd\b/i, subtypes: ["acc_filter_nd"] },
  { test: /\b(cpl|polariz\w*|circular\s*polarizer)\b/i, subtypes: ["acc_filter_cpl"] },
  { test: /\buv\s*filter\b/i, subtypes: ["acc_filter_uv"] },
  // Mic-type variants
  { test: /\blavalier|lav\s*mic\b/i, subtypes: ["mic_lavalier"] },
  { test: /\bwireless\s*mic\w*|\bmic\s*\d|\bmic\s*mini\b/i, subtypes: ["mic_wireless"] },
  // Lens variants
  { test: /\bwide[- ]?angle\s*lens\b/i, subtypes: ["acc_lens_wide"] },
  { test: /\blens\s*(cover|protector)\b/i, subtypes: ["acc_lens_macro"] },
  // Power/storage variants
  { test: /\b(intelligent\s*flight\s*)?batter(y|ies)\b|\bspare\s*batter\w*\b/i, subtypes: ["acc_battery"] },
  { test: /\bcharger\w*|charging\s*hub|charging\s*case\b/i, subtypes: ["acc_charger"] },
  { test: /\b(carrying|protective|safety|hard)\s*case\b|\bbackpack\b/i, subtypes: ["acc_case"] },
  { test: /\bpropeller\w*|prop\s*guard\b/i, subtypes: ["acc_propeller"] },
  { test: /\blanding\s*gear\b/i, subtypes: ["acc_landing_gear"] },
];

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
const SUBTYPES_BY_CATEGORY_LABEL: Record<string, string[]> = {
  filters: ["acc_filter_nd", "acc_filter_cpl", "acc_filter_uv"],
  mounts: [
    "mount_helmet",
    "mount_handlebar",
    "mount_suction",
    "mount_chest",
    "mount_neck",
    "mount_wrist",
    "mount_tripod",
    "mount_clamp",
    "mount_magnetic",
    "mount_extension",
  ],
  batteries: ["acc_battery"],
  chargers: ["acc_charger"],
  cases: ["acc_case"],
  propellers: ["acc_propeller", "acc_landing_gear"],
  remotes: ["acc_remote"],
  tripods: ["mount_tripod", "mount_extension"],
  lenses: ["acc_lens_wide", "acc_lens_macro"],
  microphones: [
    "mic_wireless",
    "mic_lavalier",
    "mic_phone_adapter",
    "mic_transmitter",
    "mic_receiver",
    "mic_windscreen",
    "mic_charging_case",
    "mic_kit",
  ],
};

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

  // Pro/expert language implies a price floor unless the user
  // explicitly capped the budget. Use the first resolved category to
  // pick a sensible floor; default to drones since the assistant is
  // drone-first.
  let priceMin: number | undefined;
  if (tier === "pro" && priceMax === undefined) {
    const primaryCategory = categoryHit?.categories?.[0] ?? "Drones";
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
    // Defensive fallback: if the shopper signalled a tier or budget but
    // no category was resolved, anchor to drones (the assistant's
    // primary domain) so a "pro-tier" filter doesn't leak unrelated
    // SKUs like robotic vacuums into the carousel.
    if (tier !== undefined && priceMax === undefined && !includeBundles) {
      return {
        kind: "direct",
        rawQuery: trimmed,
        activities: detectedActivities,
        categoryLabel: "drones",
        categories: ["Drones", "4K drones"],
        priceMax,
        priceMin: priceMin ?? PRO_PRICE_FLOOR_BY_CATEGORY.Drones,
        tier,
        includeBundles,
        requiredTags,
        compatibleWith,
        subtypeHints,
      };
    }
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

  // Default fallback when no positive signal matched — neither a
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
 *     Either alone is enough — "how do i reduce glare" is a valid
 *     question even when the shopper doesn't explicitly name a
 *     camera.
 *
 * A model is OPTIONAL. When present we prefer the versioned
 * MODEL_PATTERNS detector ("osmo action 5 pro") and fall back to
 * the family-level detector ("osmo action") only when no version
 * was named. Missing both is fine — the recommendation card just
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
 *      product whose `series` matches the family — this becomes the
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
 * We deliberately do NOT pivot on a single resolved host — when the
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
    // Compatibility narrowing — soft, but applied here rather than
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
      // Prefer SKUs that explicitly tag a compatible model — these
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
  // can suppress the bundle exclusion for accessory queries — many
  // legit accessory SKUs ("Diving Accessory Kit", "Bike Accessory
  // Kit", "Filter Kit", "Microphone Kit") match the catalog's
  // `BUNDLE_TITLE_PATTERN` (which flags `\bkit\b`) even though they
  // are standalone accessories, not multi-product bundles.
  const askedForAccessories = intent.categories?.some((c) =>
    // Match every v6 accessory-flavoured category name so an explicit
    // intent like {categories:["Microphones"]} or {categories:["Camera
    // grips & sticks"]} lifts the default isAccessory hide. v5 used
    // "Microphones"; v6 uses "Camera microphones" — both are accessory
    // buckets, so we match the substring family rather than enumerate.
    /accessor|mount|filter|batter|cable|case|microphone|microphones|charger|strap|tripod|monopod|adapter|propeller|landing\s*gear|remote|lens|grip|stick/i.test(
      c,
    ),
  );

  if (intent.includeBundles) {
    // Explicit bundle ask — show only bundle SKUs.
    pool = pool.filter((product) => product.isBundle);
  } else if (!askedForAccessories) {
    // Default flagship query — drop bundles so the core PLP shows
    // single-SKU products. Accessory queries skip this so Kit-named
    // accessory products survive.
    pool = pool.filter((product) => !product.isBundle);
  }
  if (!askedForAccessories) {
    // v5 tags many accessories under their host's product_type
    // (an ND filter for a drone is `product_type: "drone"`), so we
    // can't trust productType alone — use the derived `isAccessory`
    // signal which combines product_type, accessory_role, and title.
    pool = pool.filter((product) => !product.isAccessory);
  }

  if (intent.categories && intent.categories.length > 0) {
    // Substring match — keeps the rule-based path aligned with the
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
  //   the SHARPEST signal — when the shopper named a specific
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

  // Compatibility filter — when the shopper named a specific model
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
  // travel"). If even that returns nothing, we return an empty pool —
  // the wrong recommendation is worse than a "no exact match" message.
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
  "I'm your DJI personal assistant. I can help you find the right gear, answer questions about products, and track your orders. How can I help you today?";

export const WELCOME_NBAS = buildWelcomeNbas(0);

export const PROBING_FALLBACK_BODY =
  "Got it — could you tell me a bit more so I can find the perfect match? Here are a few common things shoppers narrow down by:";

export const PROBING_NBAS = [
  "Drones for travel",
  "Action cameras under $400",
  "Best mic for vlogging",
  "Show me what's new",
] as const;

/* ---------- DJI Help-Center hygiene knowledge base ---------- */
// Source of truth for return / replacement / warranty / shipping copy
// surfaced by the assistant. Grounded against DJI's published policy at
// https://store.dji.com/au/pages/help-center-aftersales — keep this
// module in lockstep with that page when policy changes. Imported by
// `openaiAgent.ts` (the `lookup_policy` tool) and by both rule-based
// dispatchers (Sidecar + SideBySide), so policy answers stay
// consistent across every path the shopper can take.

/** Public help-center URL we cite when shoppers ask about policy. */
export const DJI_HELP_CENTER_URL =
  "https://store.dji.com/au/pages/help-center-aftersales";

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
    "DJI's Return & Refund window is 30 days from the day after you " +
    "receive the product, for camera drones, enterprise products, " +
    "handheld imaging devices, and power stations. The item must be " +
    "unactivated, unused, and include all original packaging, " +
    "accessories, gifts, and manuals — or have a manufacturing defect. " +
    "Refunds are issued back to the original payment method and " +
    "typically clear in 7–14 business days. For bundles, refunds are " +
    "processed for the entire order only, and customers cover return " +
    "shipping unless the issue is a performance fault. " +
    `Full policy: ${DJI_HELP_CENTER_URL}`,
  replacement:
    "Replacement Service is available within 30 days of receiving the " +
    "product if it arrived damaged in transit (with carrier proof of " +
    "damage), doesn't match its original description in a significant " +
    "way, or has a manufacturing defect. DJI covers the two-way " +
    "replacement freight when the issue is a performance fault. The " +
    "product must be sent back within 7 calendar days of replacement " +
    `confirmation. Details: ${DJI_HELP_CENTER_URL}`,
  warranty:
    "DJI products are covered by a limited warranty against performance " +
    "failures for the effective warranty period — you can apply for " +
    "warranty service or self-service repair from the DJI support site. " +
    "Before sending in your product, back up your SD card, remove " +
    "personal data, detach any non-warranty parts, and have your " +
    "passwords ready. DJI Care Refresh is a separate paid plan that " +
    "extends coverage and adds accidental-damage replacements. " +
    `Warranty info: ${DJI_HELP_CENTER_URL}`,
  shipping:
    "Shipping times and fees vary by region and ship-to address — DJI " +
    "confirms both at checkout. You can track your order from the DJI " +
    "Store account once it has shipped. Inspect the parcel before " +
    "signing, and keep carrier proof of any transit damage so you can " +
    "request a replacement if needed. " +
    `Shipping & logistics FAQ: ${DJI_HELP_CENTER_URL}`,
};

/**
 * @deprecated Prefer `POLICY_BODIES.return`. Kept as an export so older
 * code paths continue to compile, but always resolves to the canonical
 * return-policy body sourced from the DJI Help Center.
 */
export const RETURN_POLICY_BODY = POLICY_BODIES.return;

export const TRACK_ORDER_BODY =
  "I can help track your latest DJI order. I pulled up your most recent purchase details below.";

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
  Drones: [
    { label: "Add ND filter set", targetCategory: "Accessories" },
    { label: "Add an extra battery", targetCategory: "Accessories" },
    { label: "Add a vlogging mic", targetCategory: "Microphones" },
  ],
  "4K drones": [
    { label: "Add ND filter set", targetCategory: "Accessories" },
    { label: "Add an extra battery", targetCategory: "Accessories" },
    { label: "Add a vlogging mic", targetCategory: "Microphones" },
  ],
  "Action cameras": [
    { label: "Add a mounting kit", targetCategory: "Accessories" },
    { label: "Add a wireless mic", targetCategory: "Microphones" },
    { label: "Add a gimbal", targetCategory: "Gimbals" },
  ],
  Microphones: [
    { label: "Add a wind muff", targetCategory: "Accessories" },
    { label: "Find an action camera", targetCategory: "Action cameras" },
    { label: "Find a vlogging drone", targetCategory: "Drones" },
  ],
  Gimbals: [
    { label: "Find an action camera", targetCategory: "Action cameras" },
    { label: "Add a vlogging mic", targetCategory: "Microphones" },
  ],
  Accessories: [
    { label: "Find a drone", targetCategory: "Drones" },
    { label: "Find an action camera", targetCategory: "Action cameras" },
  ],
};

const CATEGORY_HUMAN: Record<string, string> = {
  Drones: "drones",
  "4K drones": "4K drones",
  "Action cameras": "action cameras",
  Microphones: "mics",
  Gimbals: "gimbals",
  Accessories: "accessories",
};

function humanCategory(category: string | undefined): string {
  if (!category) return "products";
  return CATEGORY_HUMAN[category] ?? category.toLowerCase();
}

function nextPriceLadder(currentMax: number | undefined): number {
  if (!currentMax) return 500;
  if (currentMax > 1000) return 1000;
  if (currentMax > 500) return 500;
  if (currentMax > 250) return 250;
  return 200;
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

  if (category === "drones" || !category) {
    items.push(
      { label: "Drones for travel & vlogging", lane: "capture" },
      { label: "Best drone for beginners", lane: "capture" },
      { label: "Drones under $500", lane: "capture" },
    );
  } else if (category === "microphones") {
    items.push(
      { label: "Best mic for vlogging", lane: "capture" },
      { label: "Wireless mics under $200", lane: "capture" },
      { label: "Help me choose a mic for interviews", lane: "capture" },
    );
  } else if (category === "action cameras") {
    items.push(
      { label: "Action cameras for travel", lane: "capture" },
      { label: "4K action cameras under $400", lane: "capture" },
      { label: "Best action cam for vlogging", lane: "capture" },
    );
  } else if (category === "gimbals") {
    items.push(
      { label: "Gimbals for smartphones", lane: "capture" },
      { label: "Gimbals for mirrorless cameras", lane: "capture" },
      { label: "Gimbals under $200", lane: "capture" },
    );
  } else {
    items.push(
      { label: "Drones for travel & vlogging", lane: "capture" },
      { label: "Best mic for vlogging", lane: "capture" },
      { label: "Action cameras under $400", lane: "capture" },
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

  if (intent.categories?.includes("Drones") || intent.categories?.includes("4K drones")) {
    items.push({ label: "4K drones only", lane: "refinement" });
    items.push({ label: "Drones for travel", lane: "capture" });
  } else if (intent.categories?.includes("Microphones")) {
    items.push({ label: "Wireless mics only", lane: "refinement" });
    items.push({ label: "Best mic for vlogging", lane: "capture" });
  } else if (intent.categories?.includes("Action cameras")) {
    items.push({ label: "Top rated action cameras", lane: "refinement" });
    items.push({ label: "Action cameras for travel", lane: "capture" });
  } else if (intent.categories?.includes("Gimbals")) {
    items.push({ label: "Gimbals for smartphones", lane: "refinement" });
    items.push({ label: "Gimbals for mirrorless cameras", lane: "capture" });
  } else {
    items.push({ label: `Top rated ${category}`, lane: "refinement" });
    items.push({ label: "Best for travel & vlogging", lane: "capture" });
  }

  // Bundle upsell — only when the current PLP is showing core SKUs
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

  // Bundle upsell takes priority — it's the highest-AOV next move.
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

  items.push({ label: "Apply promo FLY10", lane: "conversion" });
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
    // model-specific ND filter / battery — surface that first when we
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

  // Post-purchase bundle nudge — useful when shopper bought a base
  // SKU and the next-trip-up is the matching combo.
  if (matchingBundle && purchased && !purchased.isBundle) {
    items.push({
      label: `Explore ${matchingBundle.title.split("(")[0].trim()}`,
      lane: "crossSell",
    });
  }

  if (items.length < 2) {
    items.push({ label: "Discover top vlogging mics", lane: "crossSell" });
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
  power: "extra battery",
  mounting: "mounting kit",
  stabilization: "gimbal kit",
  visual_enhancement: "ND filter set",
  storage: "carrying case",
  general: "accessory",
  fpv_component: "FPV gear",
};

/**
 * Roles that we treat as "common ecosystem add-ons" worth surfacing
 * automatically. `general` and `stabilization` are too broad/niche
 * to seed by default but are still queryable. `fpv_component` is
 * intentionally NOT in the default list — it only applies to the
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
 * Series considered "FPV hosts" — when a shopper looks at one of
 * these cores we add `fpv_component` cross-sell on top of the normal
 * battery/filter/case/mount triad.
 */
const FPV_HOST_SERIES = new Set(["avata"]);

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
   * Optional v6 subtype filter — narrows the role bucket further.
   * e.g. `role: "visual_enhancement"` + `subtypes: ["acc_filter_cpl"]`
   * surfaces polarising filters specifically rather than every
   * visual-enhancement SKU. Soft filter: if no candidate carries any
   * listed subtype the unfiltered role bucket is kept so the card
   * still renders something rather than going empty.
   */
  subtypes?: string[];
  /**
   * Optional v6 capability filter — narrows by `useCaseTags` (the
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
    /* Phone-gimbal escape hatch — mirrors the rule in
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
  // carry that subtype — but if the data has no CPL-tagged kit for
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
 * tiles), the role-uniqueness rule alone can't fill the request — the
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
  // Prefer a concise human label — the full SKU title can be long.
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
  waterproof: "waterproof",
  rugged: "rugged",
  vlogging: "vlogging-ready",
  "360": "360°",
  compact: "travel-friendly",
  lowlight: "low-light",
  fpv: "FPV",
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
    return "I couldn't find an exact match for that — here's a curated selection that's close.";
  }

  if (intent.includeBundles) {
    const label = intent.categoryLabel ? ` ${intent.categoryLabel}` : "";
    return `Here are some bundle deals${label} that save you more:`;
  }

  const tierClause =
    intent.tier === "pro"
      ? " pro-grade"
      : intent.tier === "beginner"
      ? " beginner-friendly"
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
