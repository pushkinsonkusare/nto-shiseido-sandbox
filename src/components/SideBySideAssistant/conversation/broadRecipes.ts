import type { CatalogProduct } from "../../../catalog/catalog";
import {
  ACTIVITY_HIERARCHIES,
  TIER_INCLUSION,
  TIER_LEAD_COUNT,
  type ActivityHierarchy,
  type CategoryFilter,
  type AccessoryHint,
  type Tier,
} from "../../../catalog/activityHierarchies";
import type { Intent } from "../../SidecarAssistant/conversation/flow";

/* =============================================================
 * Broad sub-topic recipes
 *
 * For exploratory shopper queries (e.g. "A routine for anti-aging",
 * "Help me build a regimen for dry, sensitive skin") the assistant
 * renders a BroadResultCard whose rows correspond to a narrow slice of
 * the catalog, usually one step of a skincare routine. Each slice is
 * described by a {@link BroadSubTopicSpec} combining:
 *   - `categoryToken`: substring match against `product.category`
 *                       (matches vocab like "Cleansers", "Serums &
 *                       Treatments", "Sunscreen")
 *   - `capabilities`: AND-filter on the fused catalog tags
 *   - `titleMatchAny`: at-least-one substring match on the title,
 *                       used when tag/category filters can't
 *                       disambiguate a row on their own
 *   - `titleExcludeAny`: hard exclusion list (e.g. drop bundle SKUs
 *                       whose title reads like a set even when not
 *                       flagged `isBundle`)
 *   - `leadCount`: hard cap on products surfaced for this row
 *
 * Each spec carries a stable `id` so the See Results handoff can put
 * `?recipe=<id>` on the URL and the PLP can re-resolve the SAME filter
 * (incl. title patterns), keeping card and PLP in lockstep.
 *
 * A skincare routine flows in this order:
 *   Cleanser → Softener (toner) → Serum/Treatment → Eye & Lip Care →
 *   Moisturizer → Sunscreen (AM) / Mask (weekly)
 * ============================================================= */

export type AccessoryRoleKey =
  | "power"
  | "mounting"
  | "stabilization"
  | "visual_enhancement"
  | "storage"
  | "general"
  | "fpv_component";

export type BroadSubTopicSpec = {
  /** Stable URL-safe id so the PLP can look the spec up. */
  id: string;
  /** Display label for the row (e.g. "Brightening serums"). */
  title: string;
  /**
   * Substring matched (case-insensitive) against `product.category`.
   * Aligns with `getProductsForProductListingPage`'s substring
   * semantics so card and PLP filter the same product set. e.g.
   * "serum" matches "Serums & Treatments", "eye" matches "Eye & Lip
   * Care".
   */
  categoryToken: string;
  /** Fused catalog tags AND-applied against `useCaseTags`. */
  capabilities?: string[];
  /** Optional accessory role filter. Unused by skincare rows. */
  accessoryRole?: AccessoryRoleKey;
  /** At least one of these substrings (case-insensitive) must hit `title`. */
  titleMatchAny?: string[];
  /** Drop product if `title` contains any of these substrings. */
  titleExcludeAny?: string[];
  /** Hard cap on products surfaced for this row. Defaults to 6. */
  leadCount?: number;
  /**
   * Skip the catalog's `isBundle` guard. Set when a row intentionally
   * wants to surface Sets & Bundles alongside single products (e.g. a
   * "Complete regimen sets" row).
   */
  allowBundles?: boolean;
  /**
   * AND-filter on `product.subtypes` (repurposed to Skin Type tokens:
   * `dry`, `oily`, `combination`, `normal`, `all`). Every requested
   * skin type must be present on the product.
   */
  subtypes?: string[];
  /**
   * OR-filter on `product.primaryActivities` (repurposed to skin
   * Concern tokens: `brightening`, `anti-aging`, `wrinkle-smoothing`,
   * `lifting-and-firming`, `deeply-hydrating`, `pore-minimizing`). Any
   * single match counts.
   */
  primaryActivities?: string[];
  /**
   * OR-filter on `product.series` (repurposed to the product
   * Collection slug: `benefiance`, `vital-perfection`,
   * `future-solution-lx`, `shiseido-men`, `ultimune`, …). Any single
   * match surfaces the product, letting a row scope to one Collection.
   */
  series?: string[];
  /**
   * Free-text token matched (lowercased substring) against the product
   * `title`. Surfaces a specific line or ingredient when `series` is
   * too coarse (e.g. `compatibleWith: "retinol"`).
   */
  compatibleWith?: string;
};

/* ---------- Recipe data ---------- */

const ANTI_AGING_RECIPE: BroadSubTopicSpec[] = [
  {
    id: "anti-aging-serums",
    title: "Anti-aging serums",
    categoryToken: "serum",
    primaryActivities: ["anti-aging", "wrinkle-smoothing", "lifting-and-firming"],
    leadCount: 5,
  },
  {
    id: "anti-aging-moisturizers",
    title: "Firming moisturizers",
    categoryToken: "moisturizer",
    primaryActivities: ["anti-aging", "wrinkle-smoothing", "lifting-and-firming"],
    leadCount: 5,
  },
  {
    id: "anti-aging-eye-care",
    title: "Eye & lip care",
    categoryToken: "eye",
    leadCount: 4,
  },
  {
    id: "anti-aging-softeners",
    title: "Replenishing softeners",
    categoryToken: "softener",
    leadCount: 3,
  },
];

const BRIGHTENING_RECIPE: BroadSubTopicSpec[] = [
  {
    id: "brightening-serums",
    title: "Brightening serums",
    categoryToken: "serum",
    primaryActivities: ["brightening", "texture-and-tone-refining"],
    leadCount: 5,
  },
  {
    id: "brightening-moisturizers",
    title: "Radiance moisturizers",
    categoryToken: "moisturizer",
    primaryActivities: ["brightening"],
    leadCount: 4,
  },
  {
    id: "brightening-sunscreen",
    title: "Daily sunscreen",
    categoryToken: "sunscreen",
    capabilities: ["spf"],
    leadCount: 4,
  },
];

const HYDRATION_RECIPE: BroadSubTopicSpec[] = [
  {
    id: "hydration-softeners",
    title: "Hydrating softeners",
    categoryToken: "softener",
    leadCount: 4,
  },
  {
    id: "hydration-serums",
    title: "Hydrating serums",
    categoryToken: "serum",
    primaryActivities: ["deeply-hydrating"],
    leadCount: 5,
  },
  {
    id: "hydration-moisturizers",
    title: "Nourishing moisturizers",
    categoryToken: "moisturizer",
    primaryActivities: ["deeply-hydrating"],
    leadCount: 5,
  },
  {
    id: "hydration-masks",
    title: "Hydrating masks",
    categoryToken: "mask",
    leadCount: 3,
  },
];

const PORE_CONTROL_RECIPE: BroadSubTopicSpec[] = [
  {
    id: "pore-control-cleansers",
    title: "Purifying cleansers",
    categoryToken: "cleanser",
    leadCount: 4,
  },
  {
    id: "pore-control-softeners",
    title: "Balancing softeners",
    categoryToken: "softener",
    leadCount: 4,
  },
  {
    id: "pore-control-treatments",
    title: "Pore-refining treatments",
    categoryToken: "serum",
    primaryActivities: ["pore-minimizing", "texture-and-tone-refining"],
    leadCount: 4,
  },
  {
    id: "pore-control-moisturizers",
    title: "Lightweight moisturizers",
    categoryToken: "moisturizer",
    leadCount: 4,
  },
];

const MENS_RECIPE: BroadSubTopicSpec[] = [
  {
    id: "mens-cleansers",
    title: "Men's cleansers",
    categoryToken: "cleanser",
    series: ["shiseido-men"],
    leadCount: 3,
  },
  {
    id: "mens-softeners",
    title: "Men's softeners",
    categoryToken: "softener",
    series: ["shiseido-men"],
    leadCount: 3,
  },
  {
    id: "mens-treatments",
    title: "Men's treatments",
    categoryToken: "serum",
    series: ["shiseido-men"],
    leadCount: 3,
  },
  {
    id: "mens-moisturizers",
    title: "Men's moisturizers",
    categoryToken: "moisturizer",
    series: ["shiseido-men"],
    leadCount: 3,
  },
];

const SUN_PROTECTION_RECIPE: BroadSubTopicSpec[] = [
  {
    id: "sun-protection-sunscreen",
    title: "Daily sunscreen",
    categoryToken: "sunscreen",
    capabilities: ["spf"],
    leadCount: 6,
  },
  {
    id: "sun-protection-day-moisturizers",
    title: "Day moisturizers",
    categoryToken: "moisturizer",
    leadCount: 3,
  },
  {
    id: "sun-protection-brightening-serums",
    title: "Antioxidant serums",
    categoryToken: "serum",
    primaryActivities: ["brightening"],
    leadCount: 3,
  },
];

const DAILY_ROUTINE_RECIPE: BroadSubTopicSpec[] = [
  {
    id: "daily-cleansers",
    title: "Gentle cleansers",
    categoryToken: "cleanser",
    leadCount: 6,
  },
  {
    id: "daily-softeners",
    title: "Hydrating softeners",
    categoryToken: "softener",
    leadCount: 6,
  },
  {
    id: "daily-serums",
    title: "Treatment serums",
    categoryToken: "serum",
    leadCount: 6,
  },
  {
    id: "daily-eye-care",
    title: "Eye & lip care",
    categoryToken: "eye",
    leadCount: 6,
  },
  {
    id: "daily-moisturizers",
    title: "Daily moisturizers",
    categoryToken: "moisturizer",
    leadCount: 6,
  },
  {
    id: "daily-sunscreen",
    title: "Daily sunscreen",
    categoryToken: "sunscreen",
    leadCount: 6,
  },
];

/* ---------- Category-led recipes ----------
 *
 * Used when the shopper EXPLICITLY names a product category in the
 * query ("show me serums", "recommend a moisturizer", "sunscreen for
 * my trip"). The lead row reflects the named category so the routine
 * builder anchors on it; supporting rows fill in the complementary
 * routine steps. These take priority over concern detection (a query
 * like "for dry skin, suggest a cleanser" should land on cleansers,
 * NOT a hydration-serum-led routine).
 *
 * Keys align with the category the shopper named. Categories not
 * present here fall through to concern / tag detection. */

const CLEANSERS_RECIPE: BroadSubTopicSpec[] = [
  {
    id: "category-cleansers",
    title: "Cleansers",
    categoryToken: "cleanser",
    leadCount: 6,
  },
  {
    id: "category-cleansers-softeners",
    title: "Softeners",
    categoryToken: "softener",
    leadCount: 4,
  },
  {
    id: "category-cleansers-moisturizers",
    title: "Moisturizers",
    categoryToken: "moisturizer",
    leadCount: 4,
  },
];

const SOFTENERS_RECIPE: BroadSubTopicSpec[] = [
  {
    id: "category-softeners",
    title: "Softeners",
    categoryToken: "softener",
    leadCount: 6,
  },
  {
    id: "category-softeners-serums",
    title: "Serums & treatments",
    categoryToken: "serum",
    leadCount: 4,
  },
  {
    id: "category-softeners-moisturizers",
    title: "Moisturizers",
    categoryToken: "moisturizer",
    leadCount: 4,
  },
];

const SERUMS_RECIPE: BroadSubTopicSpec[] = [
  {
    id: "category-serums",
    title: "Serums & treatments",
    categoryToken: "serum",
    leadCount: 6,
  },
  {
    id: "category-serums-moisturizers",
    title: "Moisturizers",
    categoryToken: "moisturizer",
    leadCount: 4,
  },
  {
    id: "category-serums-eye-care",
    title: "Eye & lip care",
    categoryToken: "eye",
    leadCount: 4,
  },
];

const MOISTURIZERS_RECIPE: BroadSubTopicSpec[] = [
  {
    id: "category-moisturizers",
    title: "Moisturizers",
    categoryToken: "moisturizer",
    leadCount: 6,
  },
  {
    id: "category-moisturizers-serums",
    title: "Serums & treatments",
    categoryToken: "serum",
    leadCount: 4,
  },
  {
    id: "category-moisturizers-sunscreen",
    title: "Daily sunscreen",
    categoryToken: "sunscreen",
    leadCount: 4,
  },
];

const EYE_CARE_RECIPE: BroadSubTopicSpec[] = [
  {
    id: "category-eye-care",
    title: "Eye & lip care",
    categoryToken: "eye",
    leadCount: 6,
  },
  {
    id: "category-eye-care-serums",
    title: "Serums & treatments",
    categoryToken: "serum",
    leadCount: 4,
  },
  {
    id: "category-eye-care-moisturizers",
    title: "Moisturizers",
    categoryToken: "moisturizer",
    leadCount: 4,
  },
];

const MASKS_RECIPE: BroadSubTopicSpec[] = [
  {
    id: "category-masks",
    title: "Masks",
    categoryToken: "mask",
    leadCount: 6,
  },
  {
    id: "category-masks-serums",
    title: "Serums & treatments",
    categoryToken: "serum",
    leadCount: 4,
  },
  {
    id: "category-masks-moisturizers",
    title: "Moisturizers",
    categoryToken: "moisturizer",
    leadCount: 4,
  },
];

const SUNSCREEN_RECIPE: BroadSubTopicSpec[] = [
  {
    id: "category-sunscreen",
    title: "Sunscreen",
    categoryToken: "sunscreen",
    leadCount: 6,
  },
  {
    id: "category-sunscreen-moisturizers",
    title: "Day moisturizers",
    categoryToken: "moisturizer",
    leadCount: 4,
  },
  {
    id: "category-sunscreen-serums",
    title: "Antioxidant serums",
    categoryToken: "serum",
    primaryActivities: ["brightening"],
    leadCount: 4,
  },
];

/** Map from an explicitly-named category to the recipe to use when
 *  the shopper named that category. Categories not present here fall
 *  through to concern / tag detection. */
const CATEGORY_LED_RECIPES: Record<string, BroadSubTopicSpec[]> = {
  cleansers: CLEANSERS_RECIPE,
  softeners: SOFTENERS_RECIPE,
  serums: SERUMS_RECIPE,
  "serums & treatments": SERUMS_RECIPE,
  moisturizers: MOISTURIZERS_RECIPE,
  "eye & lip care": EYE_CARE_RECIPE,
  masks: MASKS_RECIPE,
  sunscreen: SUNSCREEN_RECIPE,
};

/** Map from a detected skin goal / concern token to a static routine.
 *  Populated from `extractActivitiesFromQuery` so a shopper query that
 *  mentions a goal ("anti-aging", "brightening", "hydration") routes
 *  to the matching regimen even without the LLM in the loop. */
const GOAL_LED_RECIPES: Record<string, BroadSubTopicSpec[]> = {
  "anti-aging": ANTI_AGING_RECIPE,
  brightening: BRIGHTENING_RECIPE,
  hydration: HYDRATION_RECIPE,
  "pore-control": PORE_CONTROL_RECIPE,
  mens: MENS_RECIPE,
  sun: SUN_PROTECTION_RECIPE,
};

const ALL_RECIPES: BroadSubTopicSpec[][] = [
  ANTI_AGING_RECIPE,
  BRIGHTENING_RECIPE,
  HYDRATION_RECIPE,
  PORE_CONTROL_RECIPE,
  MENS_RECIPE,
  SUN_PROTECTION_RECIPE,
  CLEANSERS_RECIPE,
  SOFTENERS_RECIPE,
  SERUMS_RECIPE,
  MOISTURIZERS_RECIPE,
  EYE_CARE_RECIPE,
  MASKS_RECIPE,
  SUNSCREEN_RECIPE,
  DAILY_ROUTINE_RECIPE,
];

const ALL_SPECS_BY_ID: Map<string, BroadSubTopicSpec> = (() => {
  const map = new Map<string, BroadSubTopicSpec>();
  for (const recipe of ALL_RECIPES) {
    for (const spec of recipe) {
      if (map.has(spec.id) && map.get(spec.id) !== spec) {
        // Every spec must carry a unique id so the PLP handoff can
        // re-resolve the exact row. Surface a console warning if we
        // ever break that invariant.
        // eslint-disable-next-line no-console
        console.warn(`[broadRecipes] duplicate spec id: ${spec.id}`);
      }
      map.set(spec.id, spec);
    }
  }
  return map;
})();

/* =============================================================
 * Concern-driven fallback recipes
 *
 * The LLM-as-recipe-author tool is the primary path for broad
 * queries. When it doesn't fire (no API key, network error, model
 * timeout), the rule-based fallback used to drop straight to
 * DAILY_ROUTINE_RECIPE, a neutral full-routine sweep. The keyword
 * detector below makes the fallback concern-aware so any query that
 * mentions a skin goal (anti-aging, brightening, hydration, …) still
 * produces a tailored routine card without the LLM in the loop.
 * ============================================================= */

/**
 * Output shape consumed by `buildActivityRecipe`. Field set is
 * intentionally narrow: only the catalog-filter knobs the hierarchy
 * generator can populate.
 */
type ActivityRowTemplate = {
  title: string;
  categoryToken: string;
  subtypes?: string[];
  capabilities?: string[];
  accessoryRole?: AccessoryRoleKey;
  allowBundles?: boolean;
  leadCount?: number;
};

/**
 * Maps shopper-facing keywords to skin-goal tokens. Compiled to regex
 * on first use so the rule-based fallback can scan any query in a
 * single pass. e.g. "smooth my wrinkles" → `anti-aging`; "even out
 * dark spots" → `brightening`; "my skin feels so dry" → `hydration`.
 */
const ACTIVITY_KEYWORD_PATTERNS: Array<{
  activity: string;
  test: RegExp;
}> = [
  {
    activity: "anti-aging",
    test: /\b(anti[-\s]?aging|ageing|wrinkl\w*|fine\s*lines?|firm\w*|lift\w*|sag\w*|elasticity|mature\s*skin|youthful|crow'?s\s*feet)\b/i,
  },
  {
    activity: "brightening",
    test: /\b(bright\w*|dark\s*spots?|hyperpigment\w*|pigmentation|dull\w*|radian\w*|glow\w*|luminos\w*|uneven\s*(?:tone|skin)|blotch\w*|discolou?r\w*|spot\s*correct\w*)\b/i,
  },
  {
    activity: "sun",
    test: /\b(sunscreen|sunblock|\bspf\b|uva?\b|uv\s*protection|sun\s*protect\w*|sun\s*damage|photo[-\s]?aging|sun\s*care)\b/i,
  },
  {
    activity: "pore-control",
    test: /\b(oily|oil\s*control|acne|breakout\w*|blemish\w*|pores?|blackhead\w*|shine|shiny|combination\s*skin|congest\w*|sebum)\b/i,
  },
  {
    activity: "hydration",
    test: /\b(hydrat\w*|dry\s*skin|dryness|dehydrat\w*|moistur\w*|parched|flak\w*|tight\s*skin|plump\w*|dewy)\b/i,
  },
  {
    activity: "mens",
    test: /\b(men'?s?|male|for\s+him|husband|boyfriend|beard|after[-\s]?shave|shav\w*)\b/i,
  },
];

/**
 * Scan a query for skin-goal keywords. Returns the first 1-3 goals
 * that hit, in priority order (specific concerns like `anti-aging`
 * win over broad ones).
 */
export function extractActivitiesFromQuery(query: string | undefined): string[] {
  const trimmed = (query ?? "").trim();
  if (!trimmed) return [];
  const out: string[] = [];
  for (const { activity, test } of ACTIVITY_KEYWORD_PATTERNS) {
    if (test.test(trimmed) && !out.includes(activity)) {
      out.push(activity);
      if (out.length >= 3) break;
    }
  }
  return out;
}

/* Monotonic counter shared by the hierarchy row generator's id
 * minter (`hierarchyRowId`) so each registered runtime spec is
 * unique even when multiple goals are evaluated in the same
 * session. */
let activityRecipeIdCounter = 0;

/* ============================================================
 * Hierarchy-driven row generation
 *
 * `ACTIVITY_HIERARCHIES` (in `src/catalog/activityHierarchies.ts`) is
 * the source of truth for the row layout of a hierarchy-backed goal.
 * `buildActivityRowTemplates(activity, tier)` converts a hierarchy
 * entry into the `ActivityRowTemplate[]` shape every consumer already
 * understands. Tier inclusion rules live in `TIER_INCLUSION` next to
 * the hierarchy data. Goals without a hierarchy entry fall back to the
 * static routines in `GOAL_LED_RECIPES`.
 * ============================================================ */

/* Stable row id within a single hierarchy → spec conversion. We
 * include the LEVEL + TIER + activity in the id so the runtime
 * registry can distinguish rows built at different tiers for the same
 * goal (the PLP `?recipe=<id>` URL always carries the exact tier the
 * routine was built for). */
function hierarchyRowId(
  activity: string,
  tier: Tier,
  level: "l1" | "l2" | "l3",
  index: number,
): string {
  activityRecipeIdCounter += 1;
  return `hier-${activity}-${tier}-${level}-${index}-${activityRecipeIdCounter}`;
}

/* Title generators for each level. Hierarchy entries don't carry row
 * titles (they're filter specs), so we synthesize sensible display
 * labels from the categoryToken + subtypes (repurposed to Skin Type
 * tokens). Keeps the data model lean. */
function titleForFilter(filter: CategoryFilter): string {
  const subtype: string | undefined = filter.subtypes?.[0];
  if (subtype) {
    if (subtype === "dry") return "For dry skin";
    if (subtype === "oily") return "For oily skin";
    if (subtype === "combination") return "For combination skin";
    if (subtype === "normal") return "For normal skin";
    if (subtype === "all") return "For all skin types";
  }
  /* Fallback: title-case the categoryToken. */
  return filter.categoryToken.replace(/\b\w/g, (c) => c.toUpperCase());
}

function filterToActivityRowTemplate(
  filter: CategoryFilter,
  title: string,
  leadCount: number,
  accessoryRole?: AccessoryRoleKey,
): ActivityRowTemplate {
  return {
    title,
    categoryToken: filter.categoryToken,
    ...(filter.subtypes ? { subtypes: filter.subtypes } : {}),
    ...(filter.capabilities ? { capabilities: filter.capabilities } : {}),
    ...(accessoryRole ? { accessoryRole } : {}),
    ...(filter.allowBundles ? { allowBundles: filter.allowBundles } : {}),
    leadCount,
  };
}

/**
 * Build the row templates for a goal at a given tier from the goal
 * hierarchy. Returns an `ActivityRowTemplate[]` that every downstream
 * consumer (sidecar, sxs, routine plan) consumes directly.
 *
 * Tier inclusion (see `TIER_INCLUSION` in activityHierarchies.ts):
 *   - budget : L1 + 0 of L2 + 2 of L3
 *   - ideal  : L1 + 1 of L2 + 3 of L3
 *   - top    : L1 + up to 3 of L2 (those whose `tiers` includes "top")
 *              + 4 of L3
 *
 * Returns an empty array when the goal has no hierarchy entry. Add the
 * goal to `ACTIVITY_HIERARCHIES` to register it.
 */
export function buildActivityRowTemplates(
  activity: string,
  tier: Tier = "ideal",
): ActivityRowTemplate[] {
  const hierarchy: ActivityHierarchy | undefined = ACTIVITY_HIERARCHIES[activity];
  if (!hierarchy) return [];

  const inclusion = TIER_INCLUSION[tier];
  const rows: ActivityRowTemplate[] = [];

  /* L1: always included. The first row is the ANCHOR; the routine
   * plan's core picker keys off this. */
  rows.push(
    filterToActivityRowTemplate(
      hierarchy.primary,
      titleForFilter(hierarchy.primary),
      TIER_LEAD_COUNT[tier],
    ),
  );

  /* L2: filter by tier allowlist, capped at `inclusion.secondary`. */
  let l2Used = 0;
  for (const sec of hierarchy.secondary) {
    if (l2Used >= inclusion.secondary) break;
    const allowedTiers: Tier[] = sec.tiers ?? ["ideal", "top"];
    if (!allowedTiers.includes(tier)) continue;
    rows.push(
      filterToActivityRowTemplate(
        sec,
        titleForFilter(sec),
        4,
      ),
    );
    l2Used += 1;
  }

  /* L3: supporting rows in priority order, capped. */
  for (let i = 0; i < hierarchy.accessories.length && i < inclusion.accessories; i += 1) {
    const acc: AccessoryHint = hierarchy.accessories[i];
    rows.push(
      filterToActivityRowTemplate(
        acc,
        titleForFilter(acc),
        4,
        acc.accessoryRole as AccessoryRoleKey | undefined,
      ),
    );
  }

  return rows;
}

/**
 * Build a recipe for a detected goal by composing its hierarchy row
 * templates into `BroadSubTopicSpec`s. Specs are registered in the
 * runtime registry so the PLP click handler can resolve them via
 * `?recipe=<id>`.
 *
 * The optional `tier` parameter lets tier-aware callers (the routine
 * plan) request tier-specific row sets. It defaults to "ideal", which is
 * what non-tier-aware callers (sidecar, sxs) want. Returns an empty
 * array when the goal isn't registered as a hierarchy.
 */
function buildActivityRecipe(
  activity: string,
  tier: Tier = "ideal",
): BroadSubTopicSpec[] {
  const templates = buildActivityRowTemplates(activity, tier);
  if (templates.length === 0) return [];

  const specs: BroadSubTopicSpec[] = [];
  for (let idx = 0; idx < templates.length; idx += 1) {
    const t = templates[idx];
    const id = hierarchyRowId(
      activity,
      tier,
      idx === 0 ? "l1" : idx <= TIER_INCLUSION[tier].secondary ? "l2" : "l3",
      idx,
    );
    const spec: BroadSubTopicSpec = {
      id,
      title: t.title,
      categoryToken: t.categoryToken,
      ...(t.subtypes ? { subtypes: t.subtypes } : {}),
      ...(t.capabilities ? { capabilities: t.capabilities } : {}),
      ...(t.accessoryRole ? { accessoryRole: t.accessoryRole } : {}),
      ...(t.allowBundles ? { allowBundles: t.allowBundles } : {}),
      ...(t.leadCount !== undefined ? { leadCount: t.leadCount } : {}),
    };
    specs.push(spec);
    RUNTIME_SPECS.set(spec.id, spec);
  }
  return specs;
}

/**
 * Pick the most-specific recipe that matches the inferred intent.
 *
 * Selection priority (first match wins):
 *  1. EXPLICIT CATEGORY named in the query ("serums", "moisturizers",
 *     "sunscreen", …). It uses `CATEGORY_LED_RECIPES`. We check this
 *     FIRST so a query like "for dry skin, suggest a cleanser" leads
 *     with cleansers instead of being captured by hydration-flavoured
 *     concern detection.
 *  2. SKIN GOAL keyword detected in the raw query (anti-aging,
 *     brightening, hydration, pore-control, men's, sun protection). It
 *     builds a tailored routine, preferring a hierarchy-backed recipe
 *     and falling back to the static `GOAL_LED_RECIPES` routine.
 *  3. `anti-aging` / `brightening` / `hydration` tags on the intent.
 *  4. `tier === "beginner"` → everyday-essentials routine.
 *  5. fallback to the complete daily routine.
 */
export function pickRecipeForIntent(
  intent: Intent | undefined,
  query?: string,
): BroadSubTopicSpec[] {
  const tags = new Set(intent?.requiredTags ?? []);

  /* Explicit-category override. If the shopper named a category, we
   * always lead with that, even if their query also tripped a
   * concern. */
  const explicitCategoryLabel = intent?.categoryLabel?.toLowerCase();
  if (explicitCategoryLabel && explicitCategoryLabel in CATEGORY_LED_RECIPES) {
    return CATEGORY_LED_RECIPES[explicitCategoryLabel];
  }

  const detectedGoals = extractActivitiesFromQuery(query);
  if (detectedGoals.length > 0) {
    // Prefer the first specific goal match. Try a hierarchy-backed
    // recipe first, then the static routine. If nothing yields rows,
    // the caller (`buildBroadSubTopics` / `resolveRecipe`) retries with
    // the default recipe, the same fallback we already do for empty
    // matches.
    for (const goal of detectedGoals) {
      const recipe = buildActivityRecipe(goal);
      if (recipe.length > 0) return recipe;
      const staticRecipe = GOAL_LED_RECIPES[goal];
      if (staticRecipe) return staticRecipe;
    }
  }

  if (tags.has("anti-aging")) return ANTI_AGING_RECIPE;
  if (tags.has("brightening")) return BRIGHTENING_RECIPE;
  if (tags.has("deeply-hydrating")) return HYDRATION_RECIPE;
  if (tags.has("pore-minimizing")) return PORE_CONTROL_RECIPE;
  if (tags.has("spf")) return SUN_PROTECTION_RECIPE;
  return DAILY_ROUTINE_RECIPE;
}

/** Default recipe exposed for callers that want a guaranteed fallback. */
export function getDefaultRecipe(): BroadSubTopicSpec[] {
  return DAILY_ROUTINE_RECIPE;
}

/**
 * Runtime registry: receives LLM-emitted specs from the
 * `propose_broad_recipe` tool. In-memory only (lost on page refresh,
 * which is fine, since refresh URLs degrade gracefully via the existing
 * `?recipe=` fallback path).
 *
 * Runtime entries are checked BEFORE static specs in `getRecipeSpecById`,
 * so a freshly-emitted spec wins over any stale id collision.
 */
const RUNTIME_SPECS: Map<string, BroadSubTopicSpec> = new Map();

/**
 * Register an LLM-emitted spec so the PLP can resolve it on row click
 * via `?recipe=<spec.id>`. Returns the id (caller is expected to have
 * already minted a unique one, typically `llm-{ts}-{idx}`).
 */
export function registerRuntimeSpec(spec: BroadSubTopicSpec): string {
  RUNTIME_SPECS.set(spec.id, spec);
  return spec.id;
}

/** Look up a spec by its id (e.g. for the PLP recipe-aware filter). */
export function getRecipeSpecById(id: string | null | undefined): BroadSubTopicSpec | null {
  if (!id) return null;
  return RUNTIME_SPECS.get(id) ?? ALL_SPECS_BY_ID.get(id) ?? null;
}

function lower(value: string | null | undefined): string {
  return (value ?? "").toLowerCase();
}

/**
 * Resolve a single {@link BroadSubTopicSpec} against the loaded catalog.
 * Returns the filtered, de-duped, leadCount-capped product list. The
 * caller decides how many to slice for slugs and which one to use as
 * the lead thumb.
 *
 * Returns an empty array when no products match. Callers should drop
 * empty rows so the card never renders an empty bucket.
 */
export function buildRowProductsFromSpec(
  spec: BroadSubTopicSpec,
  products: CatalogProduct[],
): CatalogProduct[] {
  const categoryToken = lower(spec.categoryToken);
  const includeNeedles = (spec.titleMatchAny ?? []).map(lower).filter(Boolean);
  const excludeNeedles = (spec.titleExcludeAny ?? []).map(lower).filter(Boolean);

  const seenSlugs = new Set<string>();
  const out: CatalogProduct[] = [];

  for (const p of products) {
    if (p.isBundle && !spec.allowBundles) continue;
    if (categoryToken && !lower(p.category).includes(categoryToken)) continue;

    if (spec.accessoryRole) {
      if (p.accessoryRole !== spec.accessoryRole) continue;
    }

    if (spec.capabilities && spec.capabilities.length > 0) {
      // AND on the fused catalog tags (category / concern / skin-type /
      // collection slugs, plus `spf` and `best-seller`). e.g.
      // `["spf"]` keeps sunscreens; `["best-seller"]` keeps hero SKUs.
      const tokens = p.capabilities;
      if (!spec.capabilities.every((tag) => tokens.includes(tag))) continue;
    }

    if (spec.subtypes && spec.subtypes.length > 0) {
      // AND on Skin Type tokens: every requested skin type must be on
      // the product. e.g. `["dry"]` matches products tagged for dry
      // skin; `["all"]` matches all-skin-type formulas.
      const tokens = p.subtypes;
      if (!spec.subtypes.every((tag) => tokens.includes(tag))) continue;
    }

    if (spec.primaryActivities && spec.primaryActivities.length > 0) {
      // OR on Concern tokens: any single match surfaces the product.
      // e.g. `["anti-aging", "wrinkle-smoothing"]` keeps products that
      // target either concern.
      const tokens = p.primaryActivities;
      if (!spec.primaryActivities.some((tag) => tokens.includes(tag))) continue;
    }

    if (spec.series && spec.series.length > 0) {
      // OR on the product Collection slug: any single match surfaces
      // the product. Products with `series === null` are dropped from
      // collection-scoped rows.
      if (!p.series || !spec.series.includes(p.series)) continue;
    }

    if (spec.compatibleWith) {
      // Free-text token: match against the product title (e.g. a
      // specific line or hero ingredient like "retinol").
      const token = lower(spec.compatibleWith);
      const titleHit = lower(p.title).includes(token);
      const modelHit = p.compatibleWithModels.some((m) =>
        lower(m).includes(token),
      );
      if (!titleHit && !modelHit) continue;
    }

    const titleLower = lower(p.title);
    if (excludeNeedles.length > 0 && excludeNeedles.some((n) => titleLower.includes(n))) {
      continue;
    }
    if (includeNeedles.length > 0 && !includeNeedles.some((n) => titleLower.includes(n))) {
      continue;
    }

    if (seenSlugs.has(p.slug)) continue;
    seenSlugs.add(p.slug);
    out.push(p);
  }

  const cap = Math.max(1, spec.leadCount ?? 6);
  return out.slice(0, cap);
}
