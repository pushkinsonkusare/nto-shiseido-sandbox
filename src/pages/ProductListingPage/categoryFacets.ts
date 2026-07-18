/* =============================================================
 * PLP drill-down facet config (skincare)
 *
 * When the shopper narrows to a single skincare category (e.g.
 * "Serums & Treatments"), the sidebar swaps the cross-category
 * "Shop by Category" multi-select for skincare-specific facets:
 * Skin Type, Concern, Collection, and Price tier.
 *
 * The facet param keys map onto (repurposed) CatalogProduct fields:
 *   subtypes          -> Skin Type tokens
 *   primaryActivities -> Concern tokens
 *   series            -> Collection slug
 *   tier              -> price band
 * so the existing per-product filter pipeline picks them up with no
 * extra plumbing.
 * ============================================================= */

export type FacetParamKey =
  | "series"
  | "subtypes"
  | "tier"
  | "primaryActivities";

export type FacetSpec = {
  /** Display title for the sidebar group (e.g. "Skin type"). */
  title: string;
  /** Sidebar interaction kind. */
  kind: "single-select" | "multi-select";
  /**
   * Which active-state list and URL param this facet drives. Maps
   * directly onto the `NavigateOptions` field of the same name.
   */
  paramKey: FacetParamKey;
  /**
   * Selectable rows. `value` is the raw token stored on the product
   * (e.g. `dry`, `brightening`, `benefiance`). `label` is the friendly
   * display string.
   */
  options: { label: string; value: string }[];
};

const SKINCARE_FACETS: FacetSpec[] = [
  {
    title: "Skin type",
    kind: "multi-select",
    paramKey: "subtypes",
    options: [
      { label: "All skin types", value: "all" },
      { label: "Combination", value: "combination" },
      { label: "Dry", value: "dry" },
      { label: "Oily", value: "oily" },
      { label: "Normal", value: "normal" },
      { label: "Sensitive", value: "sensitive" },
    ],
  },
  {
    title: "Concern",
    kind: "multi-select",
    paramKey: "primaryActivities",
    options: [
      { label: "Brightening", value: "brightening" },
      { label: "Anti-aging", value: "anti-aging" },
      { label: "Wrinkle smoothing", value: "wrinkle-smoothing" },
      { label: "Lifting & firming", value: "lifting-and-firming" },
      { label: "Deeply hydrating", value: "deeply-hydrating" },
      { label: "Pore minimizing", value: "pore-minimizing" },
      { label: "Texture & tone", value: "texture-and-tone-refining" },
      { label: "Retinol", value: "retinol" },
    ],
  },
  {
    title: "Collection",
    kind: "multi-select",
    paramKey: "series",
    options: [
      { label: "Benefiance", value: "benefiance" },
      { label: "Vital Perfection", value: "vital-perfection" },
      { label: "Future Solution LX", value: "future-solution-lx" },
      { label: "Bio-Performance", value: "bio-performance" },
      { label: "Ultimune", value: "ultimune" },
      { label: "Essential Energy", value: "essential-energy" },
      { label: "Essentials", value: "essentials" },
      { label: "Eudermine", value: "eudermine" },
      { label: "Urban Environment", value: "urban-environment" },
      { label: "Ultimate Sun", value: "ultimate-sun" },
      { label: "Shiseido Men", value: "shiseido-men" },
    ],
  },
  {
    title: "Price",
    kind: "single-select",
    paramKey: "tier",
    options: [
      { label: "Everyday (under $90)", value: "beginner" },
      { label: "Advanced ($90–$200)", value: "intermediate" },
      { label: "Prestige ($200+)", value: "pro" },
    ],
  },
];

/* Category names (lowercased substrings) that should surface the
 * skincare drill-down facets. Covers every bucket the build script
 * emits. */
const SKINCARE_CATEGORY_KEYS: readonly string[] = [
  "cleanser",
  "softener",
  "serum",
  "treatment",
  "moisturizer",
  "eye",
  "lip",
  "mask",
  "sunscreen",
  "set",
  "skincare",
];

/**
 * Resolve the drill-down facet config for a category name. Returns the
 * shared skincare facet set for any recognized skincare category, or
 * null so the caller falls back to the cross-category sidebar.
 */
export function getCategoryFacets(category: string | null | undefined): FacetSpec[] | null {
  if (!category) return null;
  const needle = category.trim().toLowerCase();
  if (!needle) return null;
  if (SKINCARE_CATEGORY_KEYS.some((key) => needle.includes(key))) {
    return SKINCARE_FACETS;
  }
  return null;
}

/** Friendly label for a Collection token (`series` param). */
export function formatSeriesLabel(value: string): string {
  for (const facet of SKINCARE_FACETS) {
    if (facet.paramKey !== "series") continue;
    const hit = facet.options.find((o) => o.value === value);
    if (hit) return hit.label;
  }
  return value
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/** Friendly label for a Concern token (`primaryActivities` param). */
export function formatActivityLabel(value: string): string {
  for (const facet of SKINCARE_FACETS) {
    if (facet.paramKey !== "primaryActivities") continue;
    const hit = facet.options.find((o) => o.value === value);
    if (hit) return hit.label;
  }
  return value
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
