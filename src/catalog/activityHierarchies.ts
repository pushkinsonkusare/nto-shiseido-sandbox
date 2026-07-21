/* =============================================================
 * Activity-driven recommendation hierarchy (neutralised).
 *
 * The original prototype described "what does an X kit look like"
 * for a set of activity queries. The skincare storefront routes
 * shopper intent through the side-by-side `GOAL_LED_RECIPES`
 * (concern / skin-type led) instead, so there are no activity
 * hierarchies to register here.
 *
 * `ACTIVITY_HIERARCHIES` is intentionally empty:
 * `buildActivityRowTemplates` (broadRecipes.ts) returns `[]` for any
 * unknown activity and cleanly falls back to the skincare recipes.
 * The type + tier-inclusion exports below are retained because the
 * row generator in `broadRecipes.ts` still imports them.
 * ============================================================= */

import type {
  AccessoryRole,
  ProductSubtype,
  ProductTier,
  ProductType,
} from "./catalog";

/** Tier identifiers used by the kit-builder (`Combo.id` in
 *  `buildPlan.ts`) and accepted by the row generator. */
export type Tier = "budget" | "ideal" | "top";

/** Filter spec used at every level to narrow the live catalog down
 *  to the candidate pool for that level. Every field is optional
 *  except `categoryToken`; the catalog filter ANDs all provided
 *  fields together (subtypes ALL match, capabilities ALL match). */
export type CategoryFilter = {
  /** Substring matched (case-insensitive) against `product.category`. */
  categoryToken: string;
  /** All listed subtypes must be present on the product. */
  subtypes?: ProductSubtype[];
  /** All listed `useCaseTags` must be present on the product. */
  capabilities?: string[];
  /** Title substrings excluded (case-insensitive). */
  titleExcludeAny?: string[];
  /** At least one title substring must match. Use sparingly. */
  titleMatchAny?: string[];
  /** Whether the row should pull bundles (Set / Combo SKUs).
   *  Defaults false. */
  allowBundles?: boolean;
};

/** Level 2 enhancer: same shape as a `CategoryFilter` plus a tier
 *  allowlist. When `tiers` is omitted it defaults to
 *  `["ideal", "top"]` (skip in budget). */
export type SecondaryEnhancer = CategoryFilter & {
  tiers?: Tier[];
};

/** Level 3 accessory: `CategoryFilter` plus an optional explicit
 *  accessory role for the catalog filter. */
export type AccessoryHint = CategoryFilter & {
  accessoryRole?: AccessoryRole;
};

/** Hard exclusions applied to BOTH the core ranking and the
 *  accessory bundling pass. Forbidden items never appear in any
 *  tier of an activity's kit. */
export type ActivityExclusions = {
  subtypes?: ProductSubtype[];
  productTypes?: ProductType[];
  /** Title substring matches (case-insensitive). */
  titleTokens?: string[];
};

export type ActivityHierarchy = {
  /** L1: required flagship. The core SKU comes from this filter. */
  primary: CategoryFilter;
  /** L2: preferred enhancers, tier-aware. Order = priority. */
  secondary: SecondaryEnhancer[];
  /** L3: accessory candidates. Order = priority. */
  accessories: AccessoryHint[];
  /** Hard "never include" rules. */
  exclusions?: ActivityExclusions;
  /** Tier of the L1 core that the planner should prefer when the
   *  catalog has multiple matches. Defaults to undefined → standard
   *  ladder. */
  tierBias?: Partial<Record<Tier, ProductTier[]>>;
};

/* No activity hierarchies for the skincare catalog — intent is routed
 * through the side-by-side `GOAL_LED_RECIPES` instead. */
export const ACTIVITY_HIERARCHIES: Record<string, ActivityHierarchy> = {};

/** Lookup helper. Returns `null` for unknown activities so callers
 *  can cleanly fall back to the legacy templates. */
export function getActivityHierarchy(
  activity: string | null | undefined,
): ActivityHierarchy | null {
  if (!activity) return null;
  return ACTIVITY_HIERARCHIES[activity] ?? null;
}

/** Default tier inclusion rules. The row generator in
 *  `broadRecipes.ts` reads these to decide how many L2 / L3 entries
 *  to surface per tier. */
export const TIER_INCLUSION = {
  budget: { secondary: 0, accessories: 2 },
  ideal: { secondary: 1, accessories: 3 },
  top: { secondary: 3, accessories: 4 },
} as const satisfies Record<Tier, { secondary: number; accessories: number }>;

/** Default lead count for each tier's L1 row. Wider candidate pool
 *  for the top tier so the picker has more pro options. */
export const TIER_LEAD_COUNT: Record<Tier, number> = {
  budget: 4,
  ideal: 4,
  top: 6,
};
