import Papa from "papaparse";
import csvRaw from "../../data/dji_products_tagged_v6.csv?raw";
import {
  buildSearchIndex,
  search as runCatalogSearch,
  type SearchIndex,
  type SearchResult,
} from "./searchEngine";

const publicBaseUrl = import.meta.env.BASE_URL || "/";
const localImageBaseUrl = `${publicBaseUrl}${publicBaseUrl.endsWith("/") ? "" : "/"}Dji_product_images`;

const priceFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

const imageSlots = [
  "Image_URL",
  "Image_URL1",
  "Image_URL2",
  "Image_URL3",
  "Image_URL4",
  "Image_URL5",
  "Image_URL6",
  "Image_URL7",
  "Image_URL8",
  "Image_URL9",
] as const;

const categorySwatches: Record<string, string[]> = {
  "4K drones": ["#0f172a", "#2563eb", "#93c5fd"],
  Drones: ["#111827", "#374151", "#9ca3af"],
  "Action cameras": ["#111827", "#f97316", "#fed7aa"],
  Gimbals: ["#0f172a", "#14b8a6", "#99f6e4"],
  Microphones: ["#111827", "#7c3aed", "#ddd6fe"],
  Accessories: ["#1f2937", "#f59e0b", "#fde68a"],
  Default: ["#111827", "#475569", "#d1d5db"],
};

type CsvRow = Record<string, string | undefined>;

export type CatalogSpec = {
  label: string;
  value: string;
};

export type ProductTier = "beginner" | "intermediate" | "pro";

export type CatalogProduct = {
  id: string;
  slug: string;
  title: string;
  brand: string;
  category: string;
  model: string | null;
  sku: string | null;
  price: number | null;
  priceFormatted: string;
  rating: number | null;
  reviewCount: number | null;
  imageUrl: string;
  imageAlt: string;
  gallery: string[];
  shortDescription: string;
  featureBlocks: string[];
  specs: CatalogSpec[];
  /**
   * Items shipped with the SKU as listed in the JB Hi-Fi PDP's
   * "What's in the Box?" / "In The Box" section. Sourced once at
   * catalog-load time from the `In_The_Box` CSV column populated by
   * `scripts/scrape_in_the_box.py`. Empty when the source PDP is a
   * stub listing or has been delisted (~34% of v6 SKUs as of the
   * initial scrape).
   */
  inTheBox: string[];
  productUrl: string;
  badgeLabel: string;
  swatches: string[];
  /**
   * Coarse buyer tier inferred from price band + title patterns
   * (e.g. "Pro", "Cine", "Inspire" -> pro).
   *
   * Used by `search_catalog` so an "expert filmmaker" query can
   * filter out entry-level gear like the DJI Neo.
   */
  tier: ProductTier;
  /**
   * True when the SKU is a multi-product bundle (Fly More Combo,
   * Creator Combo, etc.). The assistant excludes these from the
   * primary PLP and re-introduces them as upsell NBAs.
   */
  isBundle: boolean;
  /**
   * Best-effort base product slug this bundle is built around — e.g.
   * a "DJI Mavic 4 Pro 512GB Creator Combo" maps to a base "DJI Mavic
   * 4 Pro" if such a SKU exists. `null` when there's no clear core.
   */
  bundleBaseSlug: string | null;
  /**
   * Use-case tags consumed by search/filtering. Built from a fusion of:
   *  1. Curated `capabilities` column from the CSV (authoritative)
   *  2. Regex-derived gap tags for vocab the curated set doesn't cover
   *     (e.g. "360", "fpv", "racing", "gimbal", "enterprise")
   *
   * Canonical vocab: "waterproof", "underwater", "rugged", "vlogging",
   * "compact", "lowlight", "sports", "outdoor", "cinematic", "travel",
   * "wind_resistant", "stabilized", "360", "gimbal", "fpv", "racing",
   * "enterprise".
   */
  useCaseTags: string[];
  /**
   * Raw curated capability tokens straight from the CSV (lowercased,
   * de-quoted). Surfaced to the OpenAI agent so it can filter on the
   * exact vocabulary used by the data team.
   */
  capabilities: string[];
  /**
   * Specific product taxonomy from the CSV's `product_type` column.
   * v5 splits "gimbal" into `mobile_gimbal` (phone-mount) and
   * `camera_gimbal` (mirrorless-mount) — keep both for precise
   * compatibility matching.
   */
  productType: ProductType;
  /**
   * Coarse legacy taxonomy ("drone" | "action_camera" | "gimbal" |
   * "accessory" | ""). Lets existing filters keep using a single
   * "gimbal" bucket while `productType` retains the v5 precision.
   */
  productTypeGroup: ProductTypeGroup;
  /**
   * v5: which host product types this row is compatible with.
   * Examples: ["drone", "action_camera"], ["mirrorless_camera"],
   * ["mobile"], ["universal"]. Empty for items where the CSV omitted it.
   */
  compatibleWithType: string[];
  /**
   * v5: dominant role of this row in an accessory ecosystem —
   * `power` (batteries/chargers), `mounting` (cages/clamps),
   * `stabilization` (gimbal-style), `visual_enhancement` (filters/lenses),
   * `storage` (cases/bags), `general` (catch-all), or null.
   */
  accessoryRole: AccessoryRole | null;
  /**
   * v5: lowercased model tokens this accessory targets (e.g.
   * `["dji mini 2"]`, `["dji osmo action 5 pro"]`). Empty when the
   * accessory works with a whole product family rather than a specific
   * model.
   */
  compatibleWithModels: string[];
  /**
   * Derived flag — true when this SKU behaves as an accessory rather
   * than a flagship/core product. Computed from `accessoryRole` plus a
   * defensive title-pattern check (catches CSV mistags both ways).
   */
  isAccessory: boolean;
  /**
   * v6: structured per-category subtype taxonomy. Tokens drawn from
   * `ProductSubtype` (e.g. `cam_action`, `drone_compact`,
   * `mic_wireless`, `mount_helmet`). Lets recipes AND-filter cleanly
   * without falling back to title regex.
   */
  subtypes: string[];
  /**
   * v6: 0-3 activity tokens describing what the product is the right
   * tool for (e.g. `motorcycle`, `vlog`, `professional_filmmaker`).
   * Recipes OR-filter on this — any match counts.
   */
  primaryActivities: string[];
  /**
   * v6.1: marketing series this SKU belongs to (e.g. `mavic`, `air`,
   * `mini`, `avata`, `osmo_action`, `dji_mic`). Inferred from the
   * title at catalog-load time; `null` when no confident match.
   *
   * Useful for series-scoped browsing ("show me the Mavic line"),
   * series cross-sell ("Mavic accessories"), and FPV ecosystem
   * recommendations (pair Avata drones with `fpv_goggles` /
   * `fpv_controller` SKUs).
   */
  series: ProductSeries | null;
};

export type ProductType =
  | "drone"
  | "action_camera"
  | "mobile_gimbal"
  | "camera_gimbal"
  | "accessory"
  | "";

export type ProductTypeGroup =
  | "drone"
  | "action_camera"
  | "gimbal"
  | "accessory"
  | "";

export type AccessoryRole =
  | "power"
  | "mounting"
  | "stabilization"
  | "visual_enhancement"
  | "storage"
  | "general"
  /**
   * v6.1: hardware that completes the FPV flying experience —
   * goggles (Goggles 3, Goggles Integra), motion controllers, and
   * FPV remote controllers. These are sold as separate SKUs (or as
   * components of Avata combos) but are essential pairings for an
   * FPV drone host. Roles like `power`/`mounting` don't capture
   * this semantic; we mint a dedicated role so the assistant can
   * cross-sell Avata + goggles + controller as an ecosystem.
   *
   * Currently derived client-side from product titles
   * ("Goggles", "Motion Controller", "FPV Remote") because the
   * upstream CSV doesn't ship the role. The override is conservative
   * — we only promote when the title clearly names one of these
   * components AND the product isn't a flagship drone/camera.
   */
  | "fpv_component";

/**
 * v6.1: high-level product series taxonomy. Mirrors the marketing
 * lines DJI uses (Mavic, Air, Mini, Avata, Neo, Osmo Action, Osmo
 * Pocket, Osmo Mobile, Ronin / RS, DJI Mic, Goggles, FPV Controller).
 * Lets the assistant answer "show me the Mavic line", scope cross-
 * sell to a series ("accessories for the Mavic series"), and surface
 * series-level recipes ("Osmo creator setup", "FPV starter kit")
 * without falling back to title regex.
 *
 * Inferred at catalog-load time from `product.title` — the upstream
 * CSV doesn't ship a series column. Returns `null` for SKUs we can't
 * confidently bucket (generic batteries, third-party cases that work
 * across multiple host families, etc.).
 */
export type ProductSeries =
  | "mavic"
  | "air"
  | "mini"
  | "avata"
  | "neo"
  | "inspire"
  | "matrice"
  | "osmo_action"
  | "osmo_pocket"
  | "osmo_mobile"
  | "osmo_360"
  | "osmo_nano"
  | "ronin_rs"
  | "dji_mic"
  | "fpv_goggles"
  | "fpv_controller";

export const SERIES_VALUES: ReadonlySet<string> = new Set<ProductSeries>([
  "mavic", "air", "mini", "avata", "neo", "inspire", "matrice",
  "osmo_action", "osmo_pocket", "osmo_mobile", "osmo_360", "osmo_nano",
  "ronin_rs", "dji_mic", "fpv_goggles", "fpv_controller",
]);

/* ---------- v6 taxonomy ----------
 *
 * `ProductSubtype` mirrors the per-category subtype taxonomy in
 * `scripts/migrate_v5_to_v6.py`. Keep in lockstep with that script if
 * you add new tokens (TS will tell you nothing if a new token is
 * missing here — we'd just silently lose the extra signal).
 *
 * `PrimaryActivity` mirrors the activity vocab from the same script.
 */
export type ProductSubtype =
  | "cam_action"
  | "cam_pocket"
  | "cam_360"
  | "cam_dual_screen"
  | "cam_nano"
  | "drone_compact"
  | "drone_cinema"
  | "drone_fpv"
  | "drone_selfie"
  | "drone_racing"
  | "drone_enterprise"
  | "gimbal_phone"
  | "gimbal_camera"
  | "gimbal_compact"
  | "mic_wireless"
  | "mic_lavalier"
  | "mic_phone_adapter"
  | "mic_transmitter"
  | "mic_receiver"
  | "mic_windscreen"
  | "mic_charging_case"
  | "mic_kit"
  | "mount_helmet"
  | "mount_handlebar"
  | "mount_suction"
  | "mount_chest"
  | "mount_neck"
  | "mount_wrist"
  | "mount_tripod"
  | "mount_clamp"
  | "mount_magnetic"
  | "mount_extension"
  | "acc_battery"
  | "acc_charger"
  | "acc_filter_nd"
  | "acc_filter_cpl"
  | "acc_filter_uv"
  | "acc_lens_wide"
  | "acc_lens_macro"
  | "acc_propeller"
  | "acc_case"
  | "acc_strap"
  | "acc_remote"
  | "acc_landing_gear";

export type PrimaryActivity =
  | "motorcycle"
  | "cycling"
  | "skiing_snowboarding"
  | "surfing"
  | "watersports"
  | "hiking_outdoor"
  | "travel"
  | "vlog"
  | "podcast"
  | "interview"
  | "livestream"
  | "wedding"
  | "real_estate_aerial"
  | "news_journalism"
  | "concert_event"
  | "theatre"
  | "indoor_sports"
  | "family"
  | "beginner_creator"
  | "professional_filmmaker";

export const SUBTYPE_VALUES: ReadonlySet<string> = new Set<ProductSubtype>([
  "cam_action", "cam_pocket", "cam_360", "cam_dual_screen", "cam_nano",
  "drone_compact", "drone_cinema", "drone_fpv", "drone_selfie",
  "drone_racing", "drone_enterprise",
  "gimbal_phone", "gimbal_camera", "gimbal_compact",
  "mic_wireless", "mic_lavalier", "mic_phone_adapter", "mic_transmitter",
  "mic_receiver", "mic_windscreen", "mic_charging_case", "mic_kit",
  "mount_helmet", "mount_handlebar", "mount_suction", "mount_chest",
  "mount_neck", "mount_wrist", "mount_tripod", "mount_clamp",
  "mount_magnetic", "mount_extension",
  "acc_battery", "acc_charger", "acc_filter_nd", "acc_filter_cpl",
  "acc_filter_uv", "acc_lens_wide", "acc_lens_macro", "acc_propeller",
  "acc_case", "acc_strap", "acc_remote", "acc_landing_gear",
]);

export const PRIMARY_ACTIVITY_VALUES: ReadonlySet<string> = new Set<PrimaryActivity>([
  "motorcycle", "cycling", "skiing_snowboarding", "surfing",
  "watersports", "hiking_outdoor", "travel", "vlog", "podcast",
  "interview", "livestream", "wedding", "real_estate_aerial",
  "news_journalism", "concert_event", "theatre", "indoor_sports",
  "family", "beginner_creator", "professional_filmmaker",
]);

/**
 * Raw v6 `capabilities` vocab — the data team's authoritative tag set.
 * Distinct from the canonical `useCaseTags` (which collapses tokens
 * like `portable`+`lightweight` into `compact`). Used by the
 * `propose_broad_recipe` tool so the LLM can compose AND-intersections
 * with the same precision the rule-based recipes get.
 */
export const RAW_CAPABILITY_VALUES: ReadonlySet<string> = new Set([
  "vlogging", "rugged", "sports", "outdoor", "waterproof", "underwater",
  "cinematic", "professional", "beginner", "portable", "lightweight",
  "wind_resistant", "hands_free", "mounting", "navigation", "tracking",
  "low_light", "smooth_video", "light_control", "protection", "power",
  "storage", "battery_extension", "flight_support", "control", "travel",
  "intermediate",
]);

export type DemoCartLine = {
  id: string;
  productSlug: string;
  quantity: number;
  fulfillment: "pickup" | "delivery";
  label: string;
};

export type DemoOrder = {
  id: string;
  status: string;
  paymentMethod: string;
  total: string;
  productSlugs: string[];
  detailTitle?: string;
  detailLabel?: string;
  detailValue?: string;
  detailAddress?: string;
  detailWindow?: string;
};

export type CatalogStore = {
  products: CatalogProduct[];
  productBySlug: Map<string, CatalogProduct>;
  categories: string[];
  featuredProducts: CatalogProduct[];
  heroProduct: CatalogProduct;
  promoProducts: CatalogProduct[];
  spotlightProducts: CatalogProduct[];
  recommendedProducts: CatalogProduct[];
  cartLines: DemoCartLine[];
  orderHistory: DemoOrder[];
  /**
   * In-memory search index built once at module load. Powers the
   * search overlay's live suggestions and the PLP's `?q=` results.
   */
  searchIndex: SearchIndex;
  /**
   * Convenience wrapper around `searchEngine.search` that uses the
   * pre-built index. Safe to call on every keystroke — see
   * `searchEngine.ts` for the perf budget.
   */
  searchProducts: (query: string) => SearchResult;
  getProductBySlug: (slug: string | null | undefined) => CatalogProduct | undefined;
  getRelatedProducts: (slug: string | null | undefined, limit?: number) => CatalogProduct[];
};

function normalizeWhitespace(value: string | undefined) {
  return (value ?? "").replace(/\u00a0/g, " ").trim();
}

function splitBlocks(value: string | undefined) {
  return normalizeWhitespace(value)
    .split(/\n\s*\n/g)
    .map((block) => block.replace(/\s*\n\s*/g, " ").trim())
    .filter(Boolean);
}

function parsePrice(value: string | undefined) {
  const normalized = normalizeWhitespace(value).replace(/[^0-9.]/g, "");
  if (!normalized) {
    return null;
  }

  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseRating(value: string | undefined) {
  const normalized = normalizeWhitespace(value);
  if (!normalized) {
    return null;
  }

  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseReviewCount(value: string | undefined) {
  const digits = normalizeWhitespace(value).replace(/[^\d]/g, "");
  if (!digits) {
    return null;
  }

  const parsed = Number.parseInt(digits, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function toSlug(row: CsvRow, fallbackIndex: number) {
  const productUrl = normalizeWhitespace(row.Product_URL);
  if (productUrl) {
    const slug = productUrl.split("/products/")[1]?.split(/[?#]/)[0]?.trim();
    if (slug) {
      return slug;
    }
  }

  const titleSlug = normalizeWhitespace(row.Product_title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return titleSlug || `dji-product-${fallbackIndex + 1}`;
}

function scoreField(value: string | undefined) {
  const normalized = normalizeWhitespace(value);
  return normalized ? normalized.length : 0;
}

function mergeRows(current: CsvRow, incoming: CsvRow) {
  const merged: CsvRow = { ...current };

  Object.keys(incoming).forEach((key) => {
    const currentValue = current[key];
    const incomingValue = incoming[key];
    if (scoreField(incomingValue) > scoreField(currentValue)) {
      merged[key] = incomingValue;
    }
  });

  return merged;
}

function dedupeRows(rows: CsvRow[]) {
  const deduped = new Map<string, CsvRow>();

  rows.forEach((row, index) => {
    const key =
      normalizeWhitespace(row.Product_URL) ||
      normalizeWhitespace(row.SKU) ||
      normalizeWhitespace(row.Model) ||
      `${normalizeWhitespace(row.Product_title)}-${index}`;

    if (!normalizeWhitespace(row.Product_title)) {
      return;
    }

    const existing = deduped.get(key);
    deduped.set(key, existing ? mergeRows(existing, row) : row);
  });

  return [...deduped.values()];
}

function normalizeCategory(rawCategory: string | undefined, title: string) {
  const category = normalizeWhitespace(rawCategory);
  if (!category || category.length > 40) {
    if (/microphone/i.test(title)) {
      return "Microphones";
    }
    if (/gimbal|stabilizer/i.test(title)) {
      return "Gimbals";
    }
    if (/action|osmo/i.test(title)) {
      return "Action cameras";
    }
    if (/drone|mavic|mini|air|neo|avic/i.test(title)) {
      return "Drones";
    }
    return "Accessories";
  }

  return category;
}

function resolveSavedImage(slot: string, savedPath: string | undefined, fallbackUrl: string | undefined) {
  const saved = normalizeWhitespace(savedPath);
  if (saved) {
    const fileName = saved.split("/").pop();
    if (fileName) {
      return `${localImageBaseUrl}/${slot}/${encodeURIComponent(fileName)}`;
    }
  }

  return normalizeWhitespace(fallbackUrl);
}

function parseSpecs(value: string | undefined) {
  const lines = normalizeWhitespace(value)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const specs: CatalogSpec[] = [];

  for (let index = 0; index < lines.length; index += 2) {
    const label = lines[index];
    const valueLine = lines[index + 1];

    if (!label || !valueLine) {
      continue;
    }

    specs.push({
      label,
      value: valueLine,
    });
  }

  return specs.slice(0, 8);
}

/**
 * Parse the `In_The_Box` CSV column written by
 * `scripts/scrape_in_the_box.py`. The scraper joins items with ` | `
 * (vertical bar with surrounding spaces) precisely so this loader
 * can split on a token that doesn't appear inside any DJI item label.
 * Empty / whitespace-only cells produce an empty list.
 */
function parseInTheBox(value: string | undefined): string[] {
  const trimmed = normalizeWhitespace(value);
  if (!trimmed) return [];
  return trimmed
    .split(" | ")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseDescription(value: string | undefined) {
  const blocks = splitBlocks(value).filter((block) => !/^(overview|key features)$/i.test(block));
  const shortDescription = blocks[0] ?? "Explore precision imaging gear built for creators.";
  // `featureBlocks` is what the PDP/PLP renders (kept short for UI).
  // `allBlocks` is the full description corpus we use for use-case
  // tag derivation — DJI buries waterproof / dive / IP68 claims deep
  // in their marketing copy, well past the first 4 blocks.
  const featureBlocks = blocks.slice(1, 5);
  const allBlocks = blocks.slice(1);

  return {
    shortDescription,
    featureBlocks,
    allBlocks,
  };
}

function getBadgeLabel(rating: number | null, reviewCount: number | null, title: string) {
  if ((rating ?? 0) >= 4.8 && (reviewCount ?? 0) >= 20) {
    return "Top Rated";
  }
  if (/combo/i.test(title)) {
    return "Bundle";
  }
  if (/new|neo/i.test(title)) {
    return "New";
  }
  return "Featured";
}

function getSwatches(category: string) {
  return categorySwatches[category] ?? categorySwatches.Default;
}

const PRO_TITLE_PATTERN = /\b(pro|cine|inspire|ronin\s*4d|ronin\s*4|x9|raw)\b/i;
const BEGINNER_TITLE_PATTERN = /\b(neo|mini|action\s*2|osmo\s*pocket\s*1)\b/i;
const BUNDLE_TITLE_PATTERN = /\b(combo|bundle|kit\b|fly\s*more)\b/i;

/**
 * "Standard Combo" is how DJI markets the base retail box for action
 * cameras (e.g. "DJI Osmo Action 6 Standard Combo" is just the
 * camera). It is NOT a bundle and must remain in core PLP results.
 * "Adventure Combo", "Power Combo", "Creator Combo", etc. ARE bundles.
 */
const STANDARD_RETAIL_PATTERN = /\bstandard\s*combo\b/i;

function isBundleTitle(title: string) {
  if (STANDARD_RETAIL_PATTERN.test(title)) return false;
  return BUNDLE_TITLE_PATTERN.test(title);
}

const USE_CASE_TAG_RULES: Array<{ tag: string; test: RegExp }> = [
  {
    tag: "waterproof",
    // Be strict: only flag genuine waterproof claims. We deliberately
    // exclude bare "dive"/"diving" because DJI drone copy uses the
    // phrase "dive into the action / thrill of flight" metaphorically.
    // Real waterproof copy almost always cites "ip68", a depth in
    // meters, or one of the explicit terms below.
    test: /\b(waterproof|water-?resistant|ip\s*68|submersib\w*|underwater|scuba\s*dive\w*|scuba|snorkel\w*|depth\s*of\s*\d+\s*m|\d+\s*m\s*waterproof)\b/i,
  },
  {
    tag: "rugged",
    test: /\b(rugged|durable|shock-?proof|cold\s*resistance|extreme|adventure)\b/i,
  },
  {
    tag: "vlogging",
    test: /\b(vlog\w*|creator|selfie|content\s*creator|pocket-?sized|handheld\s*camera)\b/i,
  },
  { tag: "360", test: /\b(360|panoramic)\b/i },
  { tag: "gimbal", test: /\bgimbal\b/i },
  {
    tag: "compact",
    test: /\b(compact|portable|pocket\b|mini\b|travel-?friendly|lightweight)\b/i,
  },
  {
    tag: "lowlight",
    test: /\b(low[-\s]?light|night\s*mode|supernight|hdr|d-?log)\b/i,
  },
  { tag: "fpv", test: /\b(fpv|first[-\s]?person)\b/i },
  { tag: "racing", test: /\b(racing|race|avata)\b/i },
  { tag: "enterprise", test: /\b(enterprise|matrice|industrial|inspection)\b/i },
];

/**
 * Hard exclusions when a tag clearly does not apply despite signal
 * elsewhere in the text (e.g. the Pocket 3 isn't waterproof even
 * though "depth of field" appears in its copy).
 */
const USE_CASE_TAG_HARD_EXCLUSIONS: Array<{
  tag: string;
  test: RegExp;
}> = [
  // Pocket / gimbal cameras are NOT waterproof even when their
  // marketing copy uses "depth"/"dive into".
  { tag: "waterproof", test: /\b(pocket\s*\d+|gimbal\s*camera)\b/i },
];

/**
 * Tags we keep deriving via regex even after the curated capabilities
 * column lands — the data team's vocab doesn't (yet) cover these and
 * they're useful for shopper queries.
 */
const REGEX_GAP_TAGS = new Set(["360", "gimbal", "fpv", "racing", "enterprise"]);

/**
 * Map a curated `capabilities` token to one or more canonical
 * `useCaseTags`. Lets us reuse the existing filter pipeline while
 * giving the data team a richer vocabulary in the CSV.
 */
const CAPABILITY_TO_USE_CASE_TAGS: Record<string, string[]> = {
  waterproof: ["waterproof"],
  underwater: ["waterproof", "underwater"],
  rugged: ["rugged"],
  vlogging: ["vlogging"],
  portable: ["compact"],
  lightweight: ["compact"],
  low_light: ["lowlight"],
  sports: ["sports", "rugged"],
  outdoor: ["outdoor"],
  cinematic: ["cinematic"],
  travel: ["travel", "compact"],
  wind_resistant: ["wind_resistant"],
  stabilized: ["stabilized", "gimbal"],
  smooth_video: ["stabilized"],
  // v5 vocab — accessory- and feature-flavoured tokens. Most don't
  // expand into use-case tags directly, but `tracking` and `hands_free`
  // are useful enough to surface for "follow me" / "selfie" queries.
  tracking: ["sports"],
  hands_free: ["vlogging"],
  flight_support: [],
  navigation: [],
  control: [],
  light_control: [],
  protection: [],
  power: [],
  battery_extension: [],
  storage: [],
  mounting: [],
  // Tier capabilities don't expand into use-case tags; they feed the
  // tier resolver instead.
  beginner: [],
  intermediate: [],
  professional: [],
};

/**
 * Parse the `capabilities` column. The data is stored as a Python-list
 * literal (e.g. `['vlogging', 'underwater', 'waterproof']`), so we
 * strip brackets/quotes and split on commas.
 */
function parseCapabilities(raw: string | undefined): string[] {
  const cleaned = normalizeWhitespace(raw)
    .replace(/^\[\s*|\s*\]$/g, "")
    .replace(/['"`]/g, "");
  if (!cleaned) return [];
  const seen = new Set<string>();
  for (const part of cleaned.split(",")) {
    const token = part.trim().toLowerCase();
    if (token) seen.add(token);
  }
  return [...seen];
}

/**
 * v6 parsers — same Python-list-literal format as `capabilities`,
 * but each token is validated against a known vocab so a typo in the
 * CSV becomes a no-op rather than silently leaking through.
 */
function parseSubtypes(raw: string | undefined): string[] {
  const tokens = parseCapabilities(raw);
  return tokens.filter((t) => SUBTYPE_VALUES.has(t));
}

function parsePrimaryActivities(raw: string | undefined): string[] {
  const tokens = parseCapabilities(raw);
  return tokens.filter((t) => PRIMARY_ACTIVITY_VALUES.has(t));
}

const PRODUCT_TYPE_VALUES: ReadonlySet<ProductType> = new Set([
  "drone",
  "action_camera",
  "mobile_gimbal",
  "camera_gimbal",
  "accessory",
]);

function parseProductType(raw: string | undefined): ProductType {
  const value = normalizeWhitespace(raw).toLowerCase();
  // v5 dropped plain "gimbal" in favour of mobile/camera variants, but
  // accept it for backward-compat in case the data team reverts.
  if (value === "gimbal") return "camera_gimbal";
  return PRODUCT_TYPE_VALUES.has(value as ProductType)
    ? (value as ProductType)
    : "";
}

/**
 * Coarse legacy bucket — collapse the v5 mobile/camera gimbal split
 * into a single "gimbal" so existing filters and intent routing keep
 * working unchanged.
 */
function productTypeToGroup(type: ProductType): ProductTypeGroup {
  if (type === "mobile_gimbal" || type === "camera_gimbal") return "gimbal";
  return type;
}

const ACCESSORY_ROLE_VALUES: ReadonlySet<AccessoryRole> = new Set([
  "power",
  "mounting",
  "stabilization",
  "visual_enhancement",
  "storage",
  "general",
  "fpv_component",
]);

/**
 * v6.1 series inference. Ordered most-specific-first so e.g.
 * "Osmo Action" wins over the bare "Action" check, and "RS" wins
 * over the broader "Ronin" pattern. Patterns are anchored on
 * recognisable family tokens with word boundaries to avoid false
 * positives ("DJI Mic" must not match "DJI Microphone Mount").
 */
const SERIES_RULES: Array<{ series: ProductSeries; test: RegExp }> = [
  // FPV peripherals — must come BEFORE the broad Avata pattern so
  // "Avata 2 Goggles 3 Combo" tags as `fpv_goggles` (the goggles are
  // the salient SKU) rather than `avata`. NOTE: today the CSV has
  // none of these as standalone rows — kept for forward compat.
  { series: "fpv_goggles", test: /\b(goggles\s*(integra|n3|2|3|v2)|dji\s+goggles)\b/i },
  { series: "fpv_controller", test: /\b(motion\s*controller|fpv\s*remote\s*controller|rc\s*motion)\b/i },

  // Drone families
  { series: "avata", test: /\bavata\b/i },
  { series: "neo", test: /\bneo\b/i },
  { series: "mavic", test: /\bmavic\b/i },
  { series: "air", test: /\bair\s*(\d|\d+s)\b/i },
  { series: "mini", test: /\bmini\s*(\d|\d+\s*pro|se|4k)\b/i },
  { series: "inspire", test: /\binspire\b/i },
  { series: "matrice", test: /\bmatrice\b/i },

  // Camera families
  { series: "osmo_360", test: /\bosmo\s*360\b/i },
  { series: "osmo_nano", test: /\bosmo\s*nano\b/i },
  { series: "osmo_pocket", test: /\b(osmo\s*pocket|pocket\s*[123])\b/i },
  { series: "osmo_action", test: /\bosmo\s*action\b/i },

  // Gimbal families
  { series: "osmo_mobile", test: /\b(osmo\s*mobile|\bom\s*\d|\bom\s*se|magnetic\s*phone\s*gimbal)\b/i },
  { series: "ronin_rs", test: /\b(ronin|rsc?\s*\d|rs\s*\d)\b/i },

  // Audio
  { series: "dji_mic", test: /\bdji\s*mic|\bmic\s*(2|3|mini|pro)\b/i },
];

function inferSeries(title: string): ProductSeries | null {
  for (const rule of SERIES_RULES) {
    if (rule.test.test(title)) return rule.series;
  }
  return null;
}

/**
 * Title patterns that promote a row to `accessoryRole = fpv_component`.
 * Conservative — we only override when the row is clearly an FPV
 * peripheral (goggles, motion controller, FPV remote). Bundle SKUs
 * that mention these in parentheses (e.g. "Avata 360 ... (DJI Goggles
 * N3)") are NOT promoted because the lead SKU is the drone, not the
 * goggles.
 */
const FPV_COMPONENT_TITLE_PATTERN =
  /^[^()]*\b(goggles\s*(integra|n3|2|3|v2)|dji\s+goggles\b|motion\s+controller|fpv\s+remote\s+controller|rc\s+motion)\b/i;

/**
 * Categories whose SKUs are functionally outside the drone /
 * action-camera / gimbal / mic shopping flows even when the upstream
 * CSV mistags them with `compatible_with_type` or `accessory_role`.
 *
 * The v6 CSV stamps DJI's Robot Vacuum line (Romo A/P/S) with
 * `compatible_with_type=['drone','action_camera']` and
 * `accessory_role=power`, which makes
 * {@link findAccessoriesFor `findAccessoriesFor`} treat them as drone
 * power accessories — they slip into the Wingman planner's accessory
 * bundles for unrelated queries like "beginner drone photography".
 *
 * These SKUs remain browsable through their own category surfaces;
 * we just refuse to wire them up as accessories to imaging cores.
 */
const NON_PAIRING_CATEGORY_PATTERN = /^\s*robot\s*vacuum/i;

function parseAccessoryRole(raw: string | undefined): AccessoryRole | null {
  const value = normalizeWhitespace(raw).toLowerCase();
  return ACCESSORY_ROLE_VALUES.has(value as AccessoryRole)
    ? (value as AccessoryRole)
    : null;
}

/**
 * Generic parser for the Python-list-literal columns the CSV ships
 * (e.g. `['drone', 'action_camera']`, `['Dji Mini 2']`). Returns an
 * array of lowercased, trimmed tokens.
 */
function parsePythonListLike(raw: string | undefined): string[] {
  const cleaned = normalizeWhitespace(raw)
    .replace(/^\[\s*|\s*\]$/g, "")
    .replace(/['"`]/g, "");
  if (!cleaned) return [];
  const seen = new Set<string>();
  for (const part of cleaned.split(",")) {
    const token = part.trim().toLowerCase();
    if (token) seen.add(token);
  }
  return [...seen];
}

/**
 * Title-only signals that a SKU is an accessory (battery, filter,
 * mount, case, etc.) — used to *override* an incorrect "drone" or
 * "action_camera" `product_type` from the CSV.
 */
const ACCESSORY_TITLE_PATTERN =
  /\b(batter\w*|charger\w*|cables?\b|cords?\b|adapters?\b|mounts?\b|tripods?\b|filters?\b|nd\s*filters?\b|lens\s*covers?\b|lens\s*hoods?\b|carrying\s*cases?\b|hard\s*cases?\b|protective\s*cases?\b|bags?\b|backpacks?\b|straps?\b|headbands?\b|wrist\s*bands?\b|propellers?\b|props?\b|landing\s*gears?\b|memory\s*cards?\b|sd\s*cards?\b|tethers?\b|lens\s*caps?\b|antennas?\b|cages?\b|gimbal\s*kits?\b)/i;

/**
 * Category-column signals from the CSV that mark a SKU as an
 * accessory regardless of what its title says. The data team's
 * category curation is authoritative for these — without honouring
 * it, third-party accessories whose titles mention a host model
 * ("PGYTech Safety Case for DJI Air 2S & Mavic Air 2") get caught by
 * `CORE_DRONE_TITLE_PATTERN` and incorrectly classified as core.
 *
 * Includes "accessor*" (catches "Drone accessories", "Camera
 * accessories", "Accessory kits", "Car phone accessories") plus the
 * specific product-type buckets the JB Hi-Fi feed uses for
 * peripherals. "Camera microphones" is deliberately excluded — DJI
 * Mic SKUs are standalone products even though they're labelled as
 * accessories elsewhere in the CSV.
 */
const ACCESSORY_CATEGORY_PATTERN =
  /\b(accessor\w*|mounts?|filters?|grips?|cases\b|tripods?|monopods?|adapt(?:o|e)rs?|chargers?|batteries?|straps?|lenses?|wide-?angle\s+lenses?|remote\s+controls?)\b/i;

/**
 * Title patterns for the universal-fit accessories that DJI sells
 * alongside the Osmo Mobile lineup but that the v6 CSV tagger only
 * marks compatible with `action_camera`. Without this enrichment the
 * strict matcher in `findAccessoriesFor` rejects every plausible
 * phone-creator accessory (Mic 2 / Mic Mini, OM Magnetic Phone Clamp,
 * Magnetic Ball Joint Mount, Grip Tripod, Mini Tripod, Mini Extension
 * Rod, OM Multifunctional Module, Power / USB-C cables), leaving the
 * phone-photography kit core-only.
 *
 * These are real DJI SKUs that physically fit phone gimbals via 1/4"
 * threads, magnetic mounts, or USB-C ports — the tag fix is a
 * data-layer correction, not a semantic stretch. We add
 * `mobile_gimbal` to their `compatible_with_type` at load time so the
 * existing strict matcher accepts them via the gimbal hostGroup
 * branch (see `accessoryMatchesType` in flow.ts).
 */
const PHONE_FRIENDLY_ACCESSORY_PATTERN =
  /\b(dji\s+mic(?:\s|$|\s+mini|\s+2|\s+\(transmitter)|magnetic\s+ball\s+joint\s+mount|magnetic\s+phone\s+clamp|om\s+magnetic|om\s+multifunctional\s+module|om\s+\d|osmo\s+mobile\s+\d+\s+series\s+tracking\s+kit|grip\s+tripod|mini\s+tripod|(?:mini\s+)?extension\s+rod|usb-?c\s+(?:to|charging)\s+cable|power\s+cable)/i;

/**
 * Title signals that point to a CORE product type. Used to override a
 * "accessory" `product_type` when the row is clearly a flagship SKU
 * mistagged by the upstream script (e.g. "DJI Neo Drone" → drone).
 */
const CORE_DRONE_TITLE_PATTERN =
  /\b(mavic|air\s*\d|mini\s*\d|neo\s*drone|neo\s*fly\s*more|avata|inspire|matrice|fpv\s*drone|drone\b)/i;
const CORE_ACTION_CAMERA_TITLE_PATTERN =
  /\b(osmo\s*action|action\s*\d|osmo\s*360|osmo\s*nano|osmo\s*pocket|pocket\s*\d)/i;
const CORE_GIMBAL_TITLE_PATTERN =
  /\b(ronin\s*\w*|osmo\s*mobile|rsc\b|rs\s*\d|gimbal\b)/i;

/**
 * Pick the best gimbal sub-type from a title/category when the CSV
 * doesn't already give us one. Defaults to `camera_gimbal` because the
 * majority of v5 gimbal rows are camera-mount.
 */
function inferGimbalSubtype(title: string): ProductType {
  if (/\b(osmo\s*mobile|mobile\s*gimbal)\b/i.test(title)) return "mobile_gimbal";
  return "camera_gimbal";
}

/**
 * Apply guard rails on top of the CSV's `product_type`. Catches both
 * directions of mistagging:
 *   accessory-marked-as-core (e.g. a battery flagged "drone")
 *   core-marked-as-accessory (e.g. "DJI Neo Drone" flagged "accessory")
 */
function reconcileProductType(
  csvType: ProductType,
  title: string,
  category: string,
): ProductType {
  // Strong accessory signal in the title always wins — batteries
  // shouldn't show up in the core PLP regardless of CSV tagging.
  if (ACCESSORY_TITLE_PATTERN.test(title)) {
    return "accessory";
  }

  // CSV said accessory, but the title clearly names a flagship
  // hardware family. Trust the title.
  if (csvType === "accessory" || csvType === "") {
    if (CORE_DRONE_TITLE_PATTERN.test(title)) return "drone";
    if (CORE_ACTION_CAMERA_TITLE_PATTERN.test(title)) return "action_camera";
    if (CORE_GIMBAL_TITLE_PATTERN.test(title)) return inferGimbalSubtype(title);
    // Final fallback: derive from category for core SKUs.
    if (/^drones?$|^4k drones$/i.test(category)) return "drone";
    if (/^action cameras$/i.test(category)) return "action_camera";
    if (/^gimbals$/i.test(category)) return inferGimbalSubtype(title);
  }

  return csvType;
}

/**
 * Decide whether a row should be treated as an accessory in shopping
 * flows. The v5 CSV tags many accessories under their host's
 * `product_type` (an ND filter for a Mini 4 Pro is `product_type=drone`)
 * so we can't rely on `productType === "accessory"` alone. Instead:
 *   1. Title clearly names an accessory (battery, ND filter, mount, …)
 *      → always accessory.
 *   2. Category column clearly names an accessory bucket ("Drone
 *      accessories", "Lens filters", "Action camera mounts", …)
 *      → always accessory. Honours the data team's category curation
 *      so third-party SKUs with host-model names in the title
 *      ("PGYTech Safety Case for DJI Air 2S & Mavic Air 2") aren't
 *      reclassified as core by the title regex below.
 *   3. Title clearly names a flagship core (Mavic, Action 6, …)
 *      → never an accessory, even if the CSV says otherwise.
 *   4. Otherwise, defer to `productType === "accessory"` and
 *      `accessory_role` ∈ recognised accessory roles.
 */
function deriveIsAccessory(
  productType: ProductType,
  title: string,
  role: AccessoryRole | null,
  category: string,
): boolean {
  if (ACCESSORY_TITLE_PATTERN.test(title)) return true;
  if (ACCESSORY_CATEGORY_PATTERN.test(category)) return true;
  if (
    CORE_DRONE_TITLE_PATTERN.test(title) ||
    CORE_ACTION_CAMERA_TITLE_PATTERN.test(title) ||
    CORE_GIMBAL_TITLE_PATTERN.test(title)
  ) {
    return false;
  }
  if (productType === "accessory") return true;
  // Roles that flag the row as accessory even when product_type is a
  // host bucket (e.g. an ND filter tagged product_type="drone").
  if (
    role === "power" ||
    role === "mounting" ||
    role === "visual_enhancement" ||
    role === "storage" ||
    role === "fpv_component"
  ) {
    return true;
  }
  return false;
}

function tierFromCapabilities(capabilities: string[]): ProductTier | null {
  const hasBeginner = capabilities.includes("beginner");
  const hasIntermediate = capabilities.includes("intermediate");

  // The v5 CSV stamps 'professional' on ~85% of SKUs — including
  // entry-level drones, propellers, and beginner-tagged rows. Treating
  // it as a tier signal made the Neo Drone ($299) bubble up as a "pro"
  // recommendation for landscape/cinematic asks. We now ignore the
  // 'professional' capability entirely for tier resolution and let
  // inferTier() (price + title heuristic) classify pro gear instead.
  if (hasBeginner && !hasIntermediate) return "beginner";
  if (hasIntermediate) return "intermediate";
  return null;
}

/**
 * v6 subtypes that map cleanly onto the canonical useCaseTags vocab.
 * Lets the legacy canonical pipeline (e.g. the OpenAI agent's
 * `useCases` filter) stay accurate even after we tightened the raw
 * `capabilities` column. If a subtype isn't listed here we just don't
 * project anything onto useCaseTags — that's fine.
 */
const SUBTYPE_TO_USE_CASE_TAGS: Record<string, string[]> = {
  cam_360: ["360"],
  drone_fpv: ["fpv"],
  drone_racing: ["racing", "fpv"],
  drone_enterprise: ["enterprise"],
  gimbal_phone: ["gimbal"],
  gimbal_camera: ["gimbal"],
  gimbal_compact: ["gimbal", "compact"],
  drone_compact: ["compact"],
};

function deriveUseCaseTags(
  title: string,
  shortDescription: string,
  descriptionBlocks: string[],
  category: string,
  capabilities: string[],
  subtypes: string[] = [],
): string[] {
  const tags = new Set<string>();
  const haystack = [title, shortDescription, ...descriptionBlocks].join(" ");
  const hasCuratedCapabilities = capabilities.length > 0;

  // 1. Curated capabilities (authoritative when present).
  for (const cap of capabilities) {
    const mapped = CAPABILITY_TO_USE_CASE_TAGS[cap];
    if (mapped) {
      for (const tag of mapped) tags.add(tag);
    }
  }

  // 1b. v6 subtypes -> canonical useCaseTags (kept narrow on purpose).
  for (const subtype of subtypes) {
    const mapped = SUBTYPE_TO_USE_CASE_TAGS[subtype];
    if (mapped) {
      for (const tag of mapped) tags.add(tag);
    }
  }

  // 2. Regex-derived tags. When curated capabilities exist, only
  // backfill the *gap* tags the data team's vocab doesn't cover (360,
  // gimbal, fpv, racing, enterprise). When capabilities are empty
  // (untagged row), fall back to the FULL regex pipeline so the row
  // still gets reasonable tags instead of vanishing from search.
  for (const rule of USE_CASE_TAG_RULES) {
    if (hasCuratedCapabilities && !REGEX_GAP_TAGS.has(rule.tag)) continue;
    if (rule.test.test(haystack)) tags.add(rule.tag);
  }

  // 3. Hard exclusions remain as belt-and-braces — they only fire
  // when the curated data also slips up.
  for (const exclusion of USE_CASE_TAG_HARD_EXCLUSIONS) {
    if (exclusion.test.test(title) || exclusion.test.test(shortDescription)) {
      tags.delete(exclusion.tag);
    }
  }
  if (/drones?|4k drones/i.test(category)) {
    tags.delete("waterproof");
    tags.delete("underwater");
  }

  return [...tags];
}

/**
 * Strip everything from "(", "—" or bundle keywords onward and
 * collapse whitespace so a bundle title can be matched back to a
 * base product title — e.g.
 *   "DJI Mavic 4 Pro 512GB Creator Combo (DJI RC Pro 2)" -> "dji mavic 4 pro"
 */
function bundleBaseKey(title: string): string {
  return title
    .replace(/\(.*?\)/g, " ")
    .replace(/\b(\d+\s*(?:gb|tb))\b/gi, " ")
    .replace(BUNDLE_TITLE_PATTERN, " ")
    .replace(/\b(creator|cinema|fly\s*more|standard|premium)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function inferTier(
  category: string,
  price: number | null,
  title: string,
  subtypes: string[] = [],
): ProductTier {
  if (PRO_TITLE_PATTERN.test(title)) {
    return "pro";
  }

  if (price != null) {
    switch (category) {
      case "Drones":
      case "4K drones":
        if (price >= 1500) return "pro";
        if (price >= 600) return "intermediate";
        return "beginner";
      case "Action cameras":
        if (price >= 600) return "pro";
        if (price >= 300) return "intermediate";
        return "beginner";
      case "Gimbals":
        /* Phone gimbals (Osmo Mobile lineup) live in the same CSV
         * `Gimbals` category as the camera gimbals (Ronin / RS), but
         * the phone-gimbal price ladder is dramatically lower: Osmo
         * Mobile SE sits at $83, the 7/7P at ~$140, and the flagship
         * Mobile 8 at $219. Reusing the camera-gimbal $500 / $200
         * thresholds would collapse the entire Osmo Mobile lineup
         * into `beginner` and leave the phone-photography kit with
         * no distinct ideal/pro core to pick. So when the row
         * carries the `gimbal_phone` subtype we re-band by the
         * Osmo Mobile price points; camera gimbals keep the
         * higher thresholds below. */
        if (subtypes.includes("gimbal_phone")) {
          if (price >= 200) return "pro";
          if (price >= 120) return "intermediate";
          return "beginner";
        }
        if (price >= 500) return "pro";
        if (price >= 200) return "intermediate";
        return "beginner";
      case "Microphones":
        if (price >= 400) return "pro";
        if (price >= 200) return "intermediate";
        return "beginner";
      default:
        if (price >= 500) return "pro";
        if (price >= 150) return "intermediate";
        return "beginner";
    }
  }

  if (BEGINNER_TITLE_PATTERN.test(title)) {
    return "beginner";
  }

  return "intermediate";
}

function normalizeProduct(row: CsvRow, index: number): CatalogProduct | null {
  const title = normalizeWhitespace(row.Product_title);
  if (!title) {
    return null;
  }

  const slug = toSlug(row, index);
  const category = normalizeCategory(row.Category, title);
  const price = parsePrice(row.Price);
  const rating = parseRating(row.Star_rating);
  const reviewCount = parseReviewCount(row.Review_count);
  const gallery = imageSlots
    .map((slot) => resolveSavedImage(slot, row[`${slot}_Saved_To`], row[slot]))
    .filter(Boolean) as string[];
  const primaryImage = gallery[0] || normalizeWhitespace(row.PDP_Image);
  const description = parseDescription(row.Description_Key_features);
  const capabilities = parseCapabilities(row.capabilities);
  const subtypes = parseSubtypes(row.subtypes);
  const primaryActivities = parsePrimaryActivities(row.primary_activities);
  const productType = reconcileProductType(
    parseProductType(row.product_type),
    title,
    category,
  );
  const curatedTier = tierFromCapabilities(capabilities);
  const csvAccessoryRole = parseAccessoryRole(row.accessory_role);
  // Title-driven promotion to `fpv_component` for goggles / motion
  // controller / FPV remote SKUs the upstream CSV mistags as `general`
  // or leaves untagged. Only fires when the lead SKU itself is the
  // peripheral — bundle drones whose titles mention "(DJI Goggles N3)"
  // in parentheses are NOT promoted (the lead is the drone).
  let accessoryRole: AccessoryRole | null =
    productType !== "drone" &&
    productType !== "action_camera" &&
    productType !== "mobile_gimbal" &&
    productType !== "camera_gimbal" &&
    FPV_COMPONENT_TITLE_PATTERN.test(title)
      ? "fpv_component"
      : csvAccessoryRole;
  const compatibleWithType = parsePythonListLike(row.compatible_with_type);
  // FPV peripherals are conceptually compatible with FPV drones —
  // backfill the type so `findAccessoriesFor(avata)` will surface them
  // when the CSV ships them as standalone SKUs.
  if (
    accessoryRole === "fpv_component" &&
    !compatibleWithType.includes("drone")
  ) {
    compatibleWithType.push("drone");
  }
  /* Phone-creator backfill — see PHONE_FRIENDLY_ACCESSORY_PATTERN
   * above. Without this, the v6 catalog has zero accessories tagged
   * `mobile_gimbal` (beyond the gimbal cores themselves), and the
   * strict matcher in `findAccessoriesFor` returns an empty bundle
   * for every Osmo Mobile core, rendering the phone-photography
   * kit as core-only. */
  if (
    PHONE_FRIENDLY_ACCESSORY_PATTERN.test(title) &&
    !compatibleWithType.includes("mobile_gimbal")
  ) {
    compatibleWithType.push("mobile_gimbal");
  }
  const compatibleWithModels = parsePythonListLike(row.compatible_with_models);
  // FPV peripherals only pair with the FPV drone family. Without an
  // explicit model list, `findAccessoriesFor(mavic 4 pro)` would also
  // surface goggles which is wrong — narrow them to Avata hosts.
  if (
    accessoryRole === "fpv_component" &&
    compatibleWithModels.length === 0
  ) {
    compatibleWithModels.push("dji avata", "dji avata 2", "dji avata 360");
  }
  // Scrub bogus host-pairing tags for non-imaging categories. The v6
  // CSV stamps DJI Robot Vacuums as drone/action-cam power accessories,
  // which leaks them into Wingman's accessory bundles for unrelated
  // queries (a vacuum surfacing in a "beginner drone photography" kit).
  // Clearing these signals forces `findAccessoriesFor` to skip them
  // (empty `compatibleWithType` short-circuits `accessoryMatchesType`)
  // while leaving every other field intact so the SKU stays browsable
  // in its own category surfaces.
  if (NON_PAIRING_CATEGORY_PATTERN.test(category)) {
    compatibleWithType.length = 0;
    compatibleWithModels.length = 0;
    accessoryRole = null;
  }
  const isAccessory = deriveIsAccessory(productType, title, accessoryRole, category);
  const series = inferSeries(title);

  return {
    id: normalizeWhitespace(row.SKU) || slug,
    slug,
    title,
    brand: "DJI",
    category,
    model: normalizeWhitespace(row.Model) || null,
    sku: normalizeWhitespace(row.SKU) || null,
    price,
    priceFormatted: price != null ? priceFormatter.format(price) : "Price on request",
    rating,
    reviewCount,
    imageUrl: primaryImage,
    imageAlt: title,
    gallery: gallery.length > 0 ? gallery : primaryImage ? [primaryImage] : [],
    shortDescription: description.shortDescription,
    featureBlocks: description.featureBlocks,
    specs: parseSpecs(row.Specs),
    inTheBox: parseInTheBox(row.In_The_Box),
    productUrl: normalizeWhitespace(row.Product_URL),
    badgeLabel: getBadgeLabel(rating, reviewCount, title),
    swatches: getSwatches(category),
    // Curated tier from CSV wins; fall back to price+title heuristic
    // when the data team hasn't tagged the row yet. `subtypes` is
    // threaded through so the Gimbals price band can split phone
    // gimbals (gimbal_phone) from camera gimbals.
    tier: curatedTier ?? inferTier(category, price, title, subtypes),
    isBundle: isBundleTitle(title),
    bundleBaseSlug: null,
    useCaseTags: deriveUseCaseTags(
      title,
      description.shortDescription,
      description.allBlocks,
      category,
      capabilities,
      subtypes,
    ),
    capabilities,
    productType,
    productTypeGroup: productTypeToGroup(productType),
    compatibleWithType,
    accessoryRole,
    compatibleWithModels,
    isAccessory,
    subtypes,
    primaryActivities,
    series,
  };
}

/**
 * Second pass: for every bundle, try to find the closest base SKU in
 * the same category and stash its slug on `bundleBaseSlug`. Used by
 * the assistant to surface a bundle as an upsell next to the matching
 * core product.
 */
function attachBundleBaseSlugs(products: CatalogProduct[]): void {
  const baseByCategory = new Map<string, CatalogProduct[]>();
  for (const product of products) {
    if (product.isBundle) continue;
    const list = baseByCategory.get(product.category) ?? [];
    list.push(product);
    baseByCategory.set(product.category, list);
  }

  for (const product of products) {
    if (!product.isBundle) continue;
    const candidates = baseByCategory.get(product.category) ?? [];
    if (candidates.length === 0) continue;
    const key = bundleBaseKey(product.title);
    if (!key) continue;

    const exact = candidates.find(
      (candidate) => candidate.title.toLowerCase() === key,
    );
    if (exact) {
      product.bundleBaseSlug = exact.slug;
      continue;
    }

    const partial = candidates.find((candidate) =>
      candidate.title.toLowerCase().includes(key),
    );
    if (partial) {
      product.bundleBaseSlug = partial.slug;
      continue;
    }

    const reverse = candidates.find((candidate) =>
      key.includes(candidate.title.toLowerCase()),
    );
    if (reverse) {
      product.bundleBaseSlug = reverse.slug;
    }
  }
}

function buildCatalogStore(): CatalogStore {
  const parsed = Papa.parse<CsvRow>(csvRaw, {
    header: true,
    skipEmptyLines: "greedy",
  });

  const products = dedupeRows(parsed.data)
    .map(normalizeProduct)
    .filter((product): product is CatalogProduct => Boolean(product && product.imageUrl))
    .sort((left, right) => {
      const ratingDelta = (right.rating ?? 0) - (left.rating ?? 0);
      if (ratingDelta !== 0) {
        return ratingDelta;
      }

      const reviewDelta = (right.reviewCount ?? 0) - (left.reviewCount ?? 0);
      if (reviewDelta !== 0) {
        return reviewDelta;
      }

      return (right.price ?? 0) - (left.price ?? 0);
    });

  attachBundleBaseSlugs(products);

  const productBySlug = new Map(products.map((product) => [product.slug, product]));
  const categories = [...new Set(products.map((product) => product.category))].slice(0, 8);

  const isCombo = (product: CatalogProduct) => /\bcombo\b/i.test(product.title);
  const pickTopFromCategories = (categories: string[], limit: number) =>
    products
      .filter((product) => categories.includes(product.category) && !isCombo(product))
      .slice(0, limit);
  const featuredProducts = [
    ...pickTopFromCategories(["4K drones", "Drones"], 3),
    ...pickTopFromCategories(["Gimbals"], 2),
    ...pickTopFromCategories(["Action cameras"], 1),
  ].slice(0, 6);
  const heroProduct = featuredProducts[0] ?? products[0];
  const fallbackPromoProducts = products.slice(6, 8);
  const avata2Product = products.find(
    (product) =>
      /\bavata\s*2\b/i.test(product.title) &&
      /drone/i.test(product.category),
  );
  const promoProducts = [
    fallbackPromoProducts[0],
    avata2Product ?? fallbackPromoProducts[1],
  ].filter((product): product is CatalogProduct => Boolean(product));
  const spotlightProducts = products.slice(8, 12);
  const recommendedProducts = products.slice(12, 16);
  const cartLines: DemoCartLine[] = products.slice(0, 3).map((product, index) => ({
    id: `cart-${product.slug}`,
    productSlug: product.slug,
    quantity: index === 0 ? 1 : 1,
    fulfillment: index < 2 ? "pickup" : "delivery",
    label: index === 0 ? "Creator kit" : index === 1 ? "Travel bundle" : "Fast delivery",
  }));

  const orderHistory: DemoOrder[] = [
    {
      id: "DJI-41021",
      status: "Ready for delivery",
      paymentMethod: "Card",
      total: featuredProducts.slice(0, 2).reduce((sum, product) => sum + (product.price ?? 0), 0)
        ? priceFormatter.format(featuredProducts.slice(0, 2).reduce((sum, product) => sum + (product.price ?? 0), 0))
        : "TBD",
      productSlugs: featuredProducts.slice(0, 2).map((product) => product.slug),
      detailTitle: "Shipment",
      detailLabel: "Carrier",
      detailValue: "DJI Priority Delivery",
      detailAddress: "415 Mission Street, San Francisco, CA 94105",
      detailWindow: "Arrives in 2-4 business days",
    },
    {
      id: "DJI-41004",
      status: "Picked up",
      paymentMethod: "Card",
      total: spotlightProducts[0]?.priceFormatted ?? "TBD",
      productSlugs: spotlightProducts.slice(0, 1).map((product) => product.slug),
    },
    {
      id: "DJI-40982",
      status: "Completed",
      paymentMethod: "Card",
      total: spotlightProducts[1]?.priceFormatted ?? "TBD",
      productSlugs: spotlightProducts.slice(1, 3).map((product) => product.slug),
    },
    {
      id: "DJI-40971",
      status: "Delivered",
      paymentMethod: "Card",
      total: promoProducts[0]?.priceFormatted ?? "TBD",
      productSlugs: promoProducts.slice(0, 1).map((product) => product.slug),
    },
    {
      id: "DJI-40935",
      status: "Delivered",
      paymentMethod: "Card",
      total: promoProducts[1]?.priceFormatted ?? "TBD",
      productSlugs: promoProducts.slice(1, 2).map((product) => product.slug),
    },
  ];

  const searchIndex = buildSearchIndex(products);

  return {
    products,
    productBySlug,
    categories,
    featuredProducts,
    heroProduct,
    promoProducts,
    spotlightProducts,
    recommendedProducts,
    cartLines,
    orderHistory,
    searchIndex,
    searchProducts: (query: string) => runCatalogSearch(searchIndex, query),
    getProductBySlug: (slug) => (slug ? productBySlug.get(slug) : undefined),
    getRelatedProducts: (slug, limit = 5) => {
      const current = slug ? productBySlug.get(slug) : undefined;
      const pool = current
        ? products.filter((product) => product.slug !== current.slug && product.category === current.category)
        : products;

      return pool.slice(0, limit);
    },
  };
}

export const catalogStore = buildCatalogStore();

export function buildProductDetailPath(slug: string) {
  return `/products/${slug}`;
}

export function formatPrice(value: number) {
  return priceFormatter.format(value);
}

export function toProductCardProps(product: CatalogProduct) {
  return {
    imageUrl: product.imageUrl,
    imageAlt: product.imageAlt,
    brand: product.brand,
    category: product.category,
    title: product.title,
    price: product.priceFormatted,
    description: product.shortDescription,
    badgeLabel: product.badgeLabel,
    rating: product.rating,
    reviewCount: product.reviewCount,
    swatches: product.swatches,
  };
}
