import shiseidoRaw from "./shiseidoProducts.json";
import {
  buildSearchIndex,
  search as runCatalogSearch,
  type SearchIndex,
  type SearchResult,
} from "./searchEngine";

const publicBaseUrl = import.meta.env.BASE_URL || "/";
const imageBase = publicBaseUrl.replace(/\/+$/, "");

const priceFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

/* Preferred display order for the storefront/PLP category rails. */
const CATEGORY_ORDER = [
  "Cleansers",
  "Softeners",
  "Serums & Treatments",
  "Moisturizers",
  "Eye & Lip Care",
  "Masks",
  "Sunscreen",
  "Sets & Bundles",
  "Skincare",
];

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
  /**
   * Deterministic "was" price used to render a strikethrough sale price.
   * Null when the product is not on promotion (a portion are skipped so the
   * sale reads as selective rather than site-wide).
   */
  compareAtPrice: number | null;
  comparePriceFormatted: string | null;
  rating: number | null;
  reviewCount: number | null;
  imageUrl: string;
  imageAlt: string;
  gallery: string[];
  shortDescription: string;
  /** Long-form marketing overview copy from the source dataset. */
  overview: string;
  featureBlocks: string[];
  /** Raw ingredient copy from the source dataset (key highlights + INCI list).
   * Empty string when the dataset has no meaningful ingredient data ("N/A"). */
  ingredients: string;
  specs: CatalogSpec[];
  inTheBox: string[];
  productUrl: string;
  badgeLabel: string;
  swatches: string[];
  /**
   * Coarse buyer tier inferred from price band. Retained so search /
   * assistant filters that key off `tier` keep working; for skincare
   * it maps roughly to entry / mid / prestige price points.
   */
  tier: ProductTier;
  isBundle: boolean;
  bundleBaseSlug: string | null;
  /**
   * Lowercased filter/search tokens fused from skin type, concern,
   * collection, and category. Powers the generic search index and the
   * PLP facet filters.
   */
  useCaseTags: string[];
  capabilities: string[];
  productType: ProductType;
  productTypeGroup: ProductTypeGroup;
  compatibleWithType: string[];
  accessoryRole: AccessoryRole | null;
  compatibleWithModels: string[];
  isAccessory: boolean;
  subtypes: string[];
  primaryActivities: string[];
  series: ProductSeries | null;
};

/* ---------------------------------------------------------------------------
 * Legacy taxonomy types + constants.
 *
 * These describe the previous (drone) catalog schema. They are retained
 * only because several assistant/search modules and the router import
 * them as types or vocab sets. The Shiseido dataset does not populate
 * them (all such fields are neutralized to "" / [] / null), but keeping
 * the declarations avoids a wide-reaching refactor of those consumers.
 * ------------------------------------------------------------------------- */

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
  | "fpv_component";

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

/* Repurposed for skincare: the `series` field/param now carries the
 * product Collection (Benefiance, Vital Perfection, …). The router
 * gates the `series` URL param against this set, so it must list the
 * collection slugs the PLP Collection facet can select. */
export const SERIES_VALUES: ReadonlySet<string> = new Set<string>([
  "benefiance",
  "vital-perfection",
  "future-solution-lx",
  "bio-performance",
  "essentials",
  "essential-energy",
  "ultimune",
  "eudermine",
  "urban-environment",
  "ultimate-sun",
  "shiseido-men",
]);

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

/* Repurposed for skincare: the `primaryActivities` field/param now
 * carries skin Concern tokens (Brightening, Anti-Aging, …). The router
 * gates the `activities` URL param against this set. */
export const PRIMARY_ACTIVITY_VALUES: ReadonlySet<string> = new Set<string>([
  "brightening",
  "anti-aging",
  "wrinkle-smoothing",
  "lifting-and-firming",
  "deeply-hydrating",
  "pore-minimizing",
  "texture-and-tone-refining",
  "retinol",
]);

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
  searchIndex: SearchIndex;
  searchProducts: (query: string) => SearchResult;
  getProductBySlug: (slug: string | null | undefined) => CatalogProduct | undefined;
  getRelatedProducts: (slug: string | null | undefined, limit?: number) => CatalogProduct[];
};

/* ---------------------------------------------------------------------------
 * Shiseido dataset → CatalogProduct mapping
 * ------------------------------------------------------------------------- */

type ShiseidoVariant = { label: string; price: number | null };

type ShiseidoRecord = {
  id: string;
  slug: string;
  name: string;
  brand: string;
  collection: string;
  category: string;
  productType: string;
  routineCompleteness: string;
  price: number | null;
  priceFrom: boolean;
  variants: ShiseidoVariant[];
  skinTypes: string[];
  concerns: string[];
  badges: string[];
  outOfStock: boolean;
  shortDescription: string;
  overview: string;
  keyBenefits: string[];
  howToUse: string[];
  ingredients: string;
  primaryImage: string;
  gallery: string[];
  pdpUrl: string;
};

function resolveImage(path: string): string {
  const p = (path || "").trim();
  if (!p) return "";
  if (/^https?:\/\//.test(p)) return p;
  return `${imageBase}/${p.replace(/^\/+/, "")}`;
}

function slugToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/* Deterministic pseudo rating/review count so the demo storefront shows
 * populated star ratings. Shiseido's site doesn't expose a clean numeric
 * rating in the scrape, so we derive a stable value from the product id
 * (never random: the same product always shows the same number). */
function hash(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function pseudoRating(id: string, isBestSeller: boolean): number {
  const base = 4.2 + (hash(id) % 6) / 10; // 4.2 – 4.7
  const boosted = isBestSeller ? Math.min(4.9, base + 0.2) : base;
  return Math.round(boosted * 10) / 10;
}

function pseudoReviewCount(id: string): number {
  return 24 + (hash(`${id}-reviews`) % 620);
}

function tierFromPrice(price: number | null): ProductTier {
  if (price == null) return "beginner";
  if (price >= 200) return "pro";
  if (price >= 90) return "intermediate";
  return "beginner";
}

function buildTags(record: ShiseidoRecord): string[] {
  const tokens = new Set<string>();
  for (const t of record.skinTypes) tokens.add(slugToken(t));
  for (const c of record.concerns) tokens.add(slugToken(c));
  tokens.add(slugToken(record.collection));
  tokens.add(slugToken(record.category));
  if (record.productType) tokens.add(slugToken(record.productType));
  if (record.badges.some((b) => /best seller/i.test(b))) tokens.add("best-seller");
  if (record.category === "Sunscreen") tokens.add("spf");
  return [...tokens].filter(Boolean);
}

function buildSpecs(record: ShiseidoRecord): CatalogSpec[] {
  const specs: CatalogSpec[] = [];
  specs.push({ label: "Collection", value: record.collection });
  if (record.productType) specs.push({ label: "Type", value: record.productType });
  if (record.skinTypes.length > 0) {
    specs.push({ label: "Skin type", value: record.skinTypes.join(", ") });
  }
  if (record.concerns.length > 0) {
    specs.push({ label: "Targets", value: record.concerns.join(", ") });
  }
  const sizes = [...new Set(record.variants.map((v) => v.label).filter(Boolean))];
  if (sizes.length > 0) specs.push({ label: "Sizes", value: sizes.join(", ") });
  if (record.routineCompleteness) {
    specs.push({ label: "Routine", value: record.routineCompleteness });
  }
  return specs;
}

function badgeFor(record: ShiseidoRecord, rating: number): string {
  if (record.outOfStock) return "Out of stock";
  if (record.badges.length > 0) return record.badges[0];
  if (rating >= 4.7) return "Top rated";
  return "";
}

function formatCatalogPrice(price: number | null): string {
  if (price == null) return "Price on request";
  return priceFormatter.format(price);
}

/* Deterministic "was" / compare-at price for a demo sale. Seeded by the
 * product id so a given product always shows the same original price and the
 * same on/off-sale state (never random per render). Roughly 65% of products
 * are put on sale; the rest return null so the strikethrough is selective. */
function pseudoComparePrice(id: string, price: number | null): number | null {
  if (price == null || price <= 0) return null;
  if (hash(`${id}-sale`) % 100 >= 65) return null;
  // Proportional markup between 1.15x and 1.40x the current price.
  const markup = 1.15 + (hash(`${id}-markup`) % 26) / 100;
  const original = Math.round(price * markup);
  // Guard against rounding collapsing the markup on very cheap items.
  return original > price ? original : price + 1;
}

function normalizeProduct(record: ShiseidoRecord): CatalogProduct {
  const isBestSeller = record.badges.some((b) => /best seller/i.test(b));
  const rating = pseudoRating(record.id, isBestSeller);
  const reviewCount = pseudoReviewCount(record.id);
  const gallery = record.gallery.map(resolveImage).filter(Boolean);
  const primaryImage = resolveImage(record.primaryImage) || gallery[0] || "";
  const tags = buildTags(record);
  const compareAtPrice = pseudoComparePrice(record.id, record.price);
  const featureBlocks =
    record.keyBenefits.length > 0
      ? record.keyBenefits
      : record.overview
        ? record.overview.split(/\n+/).map((s) => s.trim()).filter(Boolean)
        : [];

  return {
    id: record.id,
    slug: record.slug,
    title: record.name,
    brand: record.brand || "Shiseido",
    category: record.category,
    model: record.collection || null,
    sku: record.id || null,
    price: record.price,
    priceFormatted: formatCatalogPrice(record.price),
    compareAtPrice,
    comparePriceFormatted:
      compareAtPrice != null ? priceFormatter.format(compareAtPrice) : null,
    rating,
    reviewCount,
    imageUrl: primaryImage,
    imageAlt: record.name,
    gallery: gallery.length > 0 ? gallery : primaryImage ? [primaryImage] : [],
    shortDescription: record.shortDescription,
    overview: record.overview,
    featureBlocks,
    ingredients: /^\s*n\/?a\s*$/i.test(record.ingredients) ? "" : record.ingredients,
    specs: buildSpecs(record),
    inTheBox: [],
    productUrl: record.pdpUrl,
    badgeLabel: badgeFor(record, rating),
    // Skincare products aren't sold by color, so the old DJI "color
    // options" swatch row is intentionally left empty so ProductCard
    // doesn't render it.
    swatches: [],
    tier: tierFromPrice(record.price),
    isBundle: record.category === "Sets & Bundles",
    bundleBaseSlug: null,
    useCaseTags: tags,
    capabilities: tags,
    // Neutralized legacy (drone) fields. See type declarations above.
    productType: "",
    productTypeGroup: "",
    compatibleWithType: [],
    accessoryRole: null,
    compatibleWithModels: [],
    isAccessory: false,
    // Repurposed for skincare PLP facets:
    //   subtypes          -> Skin Type tokens
    //   primaryActivities -> Concern tokens
    //   series            -> Collection slug
    subtypes: record.skinTypes.map(slugToken).filter(Boolean),
    primaryActivities: record.concerns.map(slugToken).filter(Boolean),
    series: (slugToken(record.collection) || null) as ProductSeries | null,
  };
}

function orderCategories(categories: Set<string>): string[] {
  const ordered = CATEGORY_ORDER.filter((c) => categories.has(c));
  const extras = [...categories].filter((c) => !CATEGORY_ORDER.includes(c));
  return [...ordered, ...extras];
}

function buildCatalogStore(): CatalogStore {
  const records = shiseidoRaw as ShiseidoRecord[];

  const products = records
    .map(normalizeProduct)
    .filter((product) => Boolean(product.imageUrl))
    .sort((left, right) => {
      const bestSellerDelta =
        Number(/best seller/i.test(right.badgeLabel)) -
        Number(/best seller/i.test(left.badgeLabel));
      if (bestSellerDelta !== 0) return bestSellerDelta;
      const ratingDelta = (right.rating ?? 0) - (left.rating ?? 0);
      if (ratingDelta !== 0) return ratingDelta;
      return (right.reviewCount ?? 0) - (left.reviewCount ?? 0);
    });

  const productBySlug = new Map(products.map((product) => [product.slug, product]));
  const categorySet = new Set(products.map((product) => product.category));
  const categories = orderCategories(categorySet).slice(0, 8);

  // Featured: prefer best sellers, spread across categories, cap at 6.
  const bestSellers = products.filter((product) =>
    /best seller/i.test(product.badgeLabel),
  );
  const seenCategories = new Set<string>();
  const featuredProducts: CatalogProduct[] = [];
  for (const product of [...bestSellers, ...products]) {
    if (featuredProducts.includes(product)) continue;
    if (seenCategories.has(product.category) && featuredProducts.length < 6) {
      continue;
    }
    featuredProducts.push(product);
    seenCategories.add(product.category);
    if (featuredProducts.length >= 6) break;
  }
  while (featuredProducts.length < 6 && featuredProducts.length < products.length) {
    const next = products.find((p) => !featuredProducts.includes(p));
    if (!next) break;
    featuredProducts.push(next);
  }

  const heroProduct = featuredProducts[0] ?? products[0];
  const pool = products.filter((p) => !featuredProducts.slice(0, 1).includes(p));
  const promoProducts = pool.slice(0, 2);
  const spotlightProducts = pool.slice(2, 6);
  const recommendedProducts = pool.slice(6, 10);

  const cartLines: DemoCartLine[] = products.slice(0, 3).map((product, index) => ({
    id: `cart-${product.slug}`,
    productSlug: product.slug,
    quantity: 1,
    fulfillment: index < 2 ? "pickup" : "delivery",
    label: index === 0 ? "Daily routine" : index === 1 ? "Refill" : "Gift set",
  }));

  const orderHistory: DemoOrder[] = [
    {
      id: "SHI-41021",
      status: "Ready for delivery",
      paymentMethod: "Card",
      total:
        featuredProducts.slice(0, 2).reduce((sum, product) => sum + (product.price ?? 0), 0)
          ? priceFormatter.format(
              featuredProducts.slice(0, 2).reduce((sum, product) => sum + (product.price ?? 0), 0),
            )
          : "TBD",
      productSlugs: featuredProducts.slice(0, 2).map((product) => product.slug),
      detailTitle: "Shipment",
      detailLabel: "Carrier",
      detailValue: "Shiseido Priority Delivery",
      detailAddress: "415 Mission Street, San Francisco, CA 94105",
      detailWindow: "Arrives in 2-4 business days",
    },
    {
      id: "SHI-41004",
      status: "Picked up",
      paymentMethod: "Card",
      total: spotlightProducts[0]?.priceFormatted ?? "TBD",
      productSlugs: spotlightProducts.slice(0, 1).map((product) => product.slug),
    },
    {
      id: "SHI-40982",
      status: "Completed",
      paymentMethod: "Card",
      total: spotlightProducts[1]?.priceFormatted ?? "TBD",
      productSlugs: spotlightProducts.slice(1, 3).map((product) => product.slug),
    },
    {
      id: "SHI-40971",
      status: "Delivered",
      paymentMethod: "Card",
      total: promoProducts[0]?.priceFormatted ?? "TBD",
      productSlugs: promoProducts.slice(0, 1).map((product) => product.slug),
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
        ? products.filter(
            (product) =>
              product.slug !== current.slug &&
              (product.category === current.category ||
                product.model === current.model),
          )
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
