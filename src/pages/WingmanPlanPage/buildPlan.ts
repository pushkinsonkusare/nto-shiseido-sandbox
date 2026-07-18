import type { CatalogProduct, ProductTier, ProductSubtype } from "../../catalog/catalog";
import {
  buildActivityConstraints,
  detectActivitiesFromQuery as detectWaveActivities,
  enforceAndRankActivityFit,
} from "../../catalog/activityProfiles";
import {
  ACTIVITY_HIERARCHIES,
  type ActivityHierarchy,
  type CategoryFilter,
  type Tier,
} from "../../catalog/activityHierarchies";
import { detectDatasetActivity } from "../../catalog/activityDataset";
import { buildDatasetCombos } from "./datasetCombos";
import {
  buildRowProductsFromSpec,
  extractActivitiesFromQuery,
  pickRecipeForIntent,
} from "../../components/SideBySideAssistant/conversation/broadRecipes";
import {
  buildAccessoryBundle,
  classifyIntent,
  findAccessoriesFor,
  isAccessoryCompatibleWithAnyCoreStrict,
} from "../../components/SidecarAssistant/conversation/flow";

/* =============================================================
 * Hierarchy-driven filtering helpers
 *
 * Used to enforce `ActivityHierarchy.exclusions` at every product
 * filtering step in this file (core pool, accessory bundle, post-
 * pipeline normalization). Every helper is a no-op when no
 * hierarchy exists for the active activity, so non-hierarchy
 * activities continue to use the legacy ranking only.
 * ============================================================= */

/** Pick the hierarchy for the FIRST detected activity, or `null`
 *  when none of the detected activities have a registered hierarchy.
 *  Mirrors the way `pickRecipeForIntent` picks the first hit so
 *  recipe + planner stay in lockstep. */
function pickActivityHierarchy(
  detectedActivities: readonly string[],
): ActivityHierarchy | null {
  for (const activity of detectedActivities) {
    const hit = ACTIVITY_HIERARCHIES[activity];
    if (hit) return hit;
  }
  return null;
}

/** Drop products that violate `hierarchy.exclusions`. Pure — caller
 *  swaps the returned array in. */
function applyHierarchyExclusions<T extends CatalogProduct>(
  products: T[],
  hierarchy: ActivityHierarchy | null,
): T[] {
  if (!hierarchy?.exclusions) return products;
  const { productTypes, subtypes, titleTokens } = hierarchy.exclusions;
  const forbiddenTypes = productTypes ? new Set<string>(productTypes) : null;
  const forbiddenSubtypes = subtypes ? new Set<string>(subtypes) : null;
  const forbiddenTokens =
    titleTokens && titleTokens.length > 0
      ? titleTokens.map((t) => t.toLowerCase())
      : null;
  if (!forbiddenTypes && !forbiddenSubtypes && !forbiddenTokens) {
    return products;
  }
  return products.filter((p) => {
    if (forbiddenTypes && p.productType && forbiddenTypes.has(p.productType)) {
      return false;
    }
    if (forbiddenSubtypes) {
      for (const s of p.subtypes) {
        if (forbiddenSubtypes.has(s)) return false;
      }
    }
    if (forbiddenTokens) {
      const lower = p.title.toLowerCase();
      for (const tok of forbiddenTokens) {
        if (lower.includes(tok)) return false;
      }
    }
    return true;
  });
}

/** Test whether a product matches a `CategoryFilter`. Subtype-first
 *  semantics: when `filter.subtypes` is specified, the subtype check
 *  IS the identity gate — `categoryToken` becomes informational and
 *  is not enforced. This is necessary because the catalog occasionally
 *  files a product under a category that doesn't contain the
 *  obvious token (e.g. selfie sticks tagged `mount_extension` live
 *  under "Camera grips & sticks", not "Action camera mounts"); the
 *  subtype tag is the source of truth.
 *
 *  When subtypes are NOT specified (e.g. real_estate_aerial's L1
 *  `{ categoryToken: "4k drones" }`), the categoryToken substring
 *  match remains the gate. */
function productMatchesFilter(
  product: CatalogProduct,
  filter: CategoryFilter,
): boolean {
  const hasSubtypes = (filter.subtypes?.length ?? 0) > 0;
  if (hasSubtypes) {
    for (const s of filter.subtypes!) {
      if (!product.subtypes.includes(s)) return false;
    }
  } else if (
    filter.categoryToken &&
    !product.category.toLowerCase().includes(filter.categoryToken.toLowerCase())
  ) {
    return false;
  }
  if (filter.capabilities && filter.capabilities.length > 0) {
    for (const cap of filter.capabilities) {
      if (!product.useCaseTags.includes(cap)) return false;
    }
  }
  if (filter.titleExcludeAny) {
    const lower = product.title.toLowerCase();
    for (const tok of filter.titleExcludeAny) {
      if (lower.includes(tok.toLowerCase())) return false;
    }
  }
  return true;
}

/** Reorder + filter an accessory list by hierarchy tier rules:
 *
 *  1. Drop accessories that match an L2 enhancer whose `tiers`
 *     allowlist excludes the current tier (e.g. drop the wireless
 *     mic from a paragliding budget kit because the L2 entry only
 *     permits it at ideal/top).
 *  2. Sort by an L3 priority score so the highest-priority L3
 *     entries land first.
 *  3. Enforce slot diversity — within the priority-sorted list,
 *     promote AT MOST ONE accessory per L3 entry to the front,
 *     followed by the rest of the (deprioritized) candidates.
 *     Without step 3, hiking's pro kit would happily fill all 4
 *     accessory slots with `mount_extension` products (3 selfie
 *     sticks + 1 grip) because they all share the same L3 score.
 *
 *  No-op when the activity has no hierarchy. */
function applyHierarchyTierFilter(
  accessories: CatalogProduct[],
  hierarchy: ActivityHierarchy | null,
  tier: Tier,
): CatalogProduct[] {
  if (!hierarchy) return accessories;

  /* L2 tier allowlist check. Build a set of subtype keys whose
   * presence on a product flags it as "this L2 enhancer is
   * NOT permitted at this tier". Any product matching such a
   * pattern gets dropped. */
  const droppedAccessorySlugs = new Set<string>();
  for (const sec of hierarchy.secondary) {
    const allowedTiers: Tier[] = sec.tiers ?? ["ideal", "top"];
    if (allowedTiers.includes(tier)) continue;
    for (const product of accessories) {
      if (productMatchesFilter(product, sec)) {
        droppedAccessorySlugs.add(product.slug);
      }
    }
  }

  /* Find the index of the FIRST L3 entry the product matches, or -1
   * if it doesn't match any. Used to bucket products by slot for
   * the diversity pass below. */
  const l3SlotFor = (product: CatalogProduct): number => {
    for (let i = 0; i < hierarchy.accessories.length; i += 1) {
      if (productMatchesFilter(product, hierarchy.accessories[i])) return i;
    }
    return -1;
  };

  /* Find an L2 slot the product matches AND is permitted at the
   * current tier. Used when sorting the deprioritized tail. */
  const matchesPermittedL2 = (product: CatalogProduct): boolean => {
    for (const sec of hierarchy.secondary) {
      const allowedTiers: Tier[] = sec.tiers ?? ["ideal", "top"];
      if (!allowedTiers.includes(tier)) continue;
      if (productMatchesFilter(product, sec)) return true;
    }
    return false;
  };

  const kept = accessories.filter((p) => !droppedAccessorySlugs.has(p.slug));

  /* Bucket products by L3 slot index. Within each slot the
   * upstream ordering (rating / activity fit) is preserved, so
   * "the best mount_extension" naturally lands first inside its
   * slot and gets promoted by the diversity pass. */
  const slotBuckets: CatalogProduct[][] = hierarchy.accessories.map(() => []);
  const l2Tail: CatalogProduct[] = [];
  const looseTail: CatalogProduct[] = [];
  for (const product of kept) {
    const slot = l3SlotFor(product);
    if (slot >= 0) {
      slotBuckets[slot].push(product);
    } else if (matchesPermittedL2(product)) {
      l2Tail.push(product);
    } else {
      looseTail.push(product);
    }
  }

  /* Diversity pass: take AT MOST ONE accessory per L3 slot. The
   * actual one-per-slot guarantee is enforced LATER by
   * `enforceSlotDiversity` after the size-normalize step (which
   * refills from the broader catalog and can re-introduce
   * duplicates). This pass just orders the front of the list so
   * the size cap downstream picks diverse items first.
   *
   * The user-visible bug this prevents: hiking pro kit filling
   * 3 of 5 slots with `mount_extension` products (selfie sticks)
   * just because the catalog has 3 of them. */
  const promoted: CatalogProduct[] = [];
  const slotLeftovers: CatalogProduct[] = [];
  for (const bucket of slotBuckets) {
    if (bucket.length === 0) continue;
    promoted.push(bucket[0]);
    if (bucket.length > 1) slotLeftovers.push(...bucket.slice(1));
  }

  /* Final order:
   *  1. promoted   — one per L3 slot (the diverse core of the kit)
   *  2. l2Tail     — L2 enhancers permitted at this tier
   *  3. looseTail  — accessories that didn't match L3 or permitted L2
   *  4. slotLeftovers — additional same-slot candidates (last resort) */
  return [...promoted, ...l2Tail, ...looseTail, ...slotLeftovers];
}

/** Enforce one-accessory-per-L3-slot at the END of the pipeline.
 *  Slot identity is determined by the product's PRIMARY subtype
 *  (the first entry in `product.subtypes`) — DJI's catalog tags
 *  multi-purpose mounts with `mount_extension` as a SECONDARY
 *  subtype (e.g. the Magnetic Ball Joint Mount has subtypes
 *  `[mount_magnetic, mount_extension]`), so matching by ANY subtype
 *  would conflate distinct products. Primary-subtype matching
 *  treats the magnetic mount as `mount_magnetic` (no L3 slot for
 *  hiking) and the actual selfie sticks as `mount_extension` (L3
 *  slot 1) — giving the kit one of each instead of three selfie
 *  sticks crowded into the same slot. */
function enforceSlotDiversity(
  accessories: CatalogProduct[],
  hierarchy: ActivityHierarchy | null,
): CatalogProduct[] {
  if (!hierarchy || hierarchy.accessories.length === 0) return accessories;
  const seenSlots = new Set<number>();
  const out: CatalogProduct[] = [];
  for (const product of accessories) {
    const primarySubtype = product.subtypes[0];
    let slot = -1;
    if (primarySubtype) {
      for (let i = 0; i < hierarchy.accessories.length; i += 1) {
        const filterSubtypes = hierarchy.accessories[i].subtypes;
        if (filterSubtypes && filterSubtypes.includes(primarySubtype)) {
          slot = i;
          break;
        }
      }
    }
    if (slot === -1) {
      /* Doesn't map to any L3 slot via primary subtype — keep as-is
       * (loose-tail product, e.g. ND filters or magnetic mounts on
       * a hiking kit). */
      out.push(product);
      continue;
    }
    if (seenSlots.has(slot)) continue;
    seenSlots.add(slot);
    out.push(product);
  }
  return out;
}

/** Score a candidate against the L1 primary spec — higher = better
 *  match. Used to find the flagship row when the recipe doesn't
 *  obviously surface one (or when the recipe was generated by a
 *  non-hierarchy code path). */
function matchesPrimaryFilter(
  product: CatalogProduct,
  hierarchy: ActivityHierarchy,
): boolean {
  return productMatchesFilter(product, hierarchy.primary);
}

/* Subtype prefixes that DJI's catalog tags as "accessory-class"
 * via `isAccessory=true`, even when the product is functionally
 * the headline of the kit (DJI Mic, Osmo Mobile, etc.).
 * Mic-led / gimbal-led activities specify these in their L1
 * `primary.subtypes`, and the planner needs to know to keep the
 * isAccessory=true products in the core pool when so configured. */
const ACCESSORY_CLASS_PREFIXES = ["mic_", "gimbal_", "mount_", "acc_"] as const;

function hierarchyPrimaryIsAccessoryClass(hierarchy: ActivityHierarchy): boolean {
  const subtypes = hierarchy.primary.subtypes ?? [];
  return subtypes.some((s) =>
    ACCESSORY_CLASS_PREFIXES.some((prefix) => s.startsWith(prefix)),
  );
}

/* =============================================================
 * buildPlan — pure, catalog-aware planner for the Wingman Plan page.
 *
 * Given a free-text shopper query (e.g. "I want to start drone
 * photography"), it produces:
 *   - a shortened hero headline
 *   - a per-activity subhead + lifestyle banner image
 *   - three curated combos (budget / ideal / top-of-the-line) that
 *     each pair a core product with a 5-6 item accessory bundle
 *   - a list of category accordions (one per recipe row)
 *
 * Implementation reuses the existing intent + recipe + accessory
 * helpers so the curation stays consistent with what the side-by-side
 * assistant produces for the same query — no hand-authored combos,
 * no new ML calls.
 * ============================================================= */

/* Wingman-curated tiers — the three combos `buildPlan()` returns
 * for any plan. */
export type WingmanComboTier = "budget" | "ideal" | "top";

/* All combo identities, including the chat-derived "Custom" combo
 * that appears in the tab strip only after the shopper has asked the
 * Wingman chat bar to steer (see `buildCustomCombo.ts`). The custom
 * combo isn't part of `PlanResult.combos` — it's lifted into
 * `WingmanPlanPage` and concatenated for display. */
export type ComboTier = WingmanComboTier | "custom";
export type ComboBadgeTone = "green" | "blue" | "purple" | "amber";

export type Combo = {
  id: ComboTier;
  /** Human-readable kit label, e.g. "Budget Kit". */
  label: string;
  /** All-caps tagline chip, e.g. "GREAT VALUE". */
  tagline: string;
  /** Pastel badge tint that paints the "01"/"02"/"03" pill. */
  badgeTone: ComboBadgeTone;
  /** Hero/core product anchoring the combo. */
  core: CatalogProduct;
  /** Secondary core-class DJI products (mostly Audio) the dataset
   *  pairs with the core. Empty for the cost-effective tier and for
   *  the legacy hierarchy fallback. Rendered folded into the
   *  accessory rail but tracked separately for labelling. */
  secondary?: CatalogProduct[];
  /** 0-6 accessories. In the dataset path the secondary products are
   *  prepended here so the rail renders them; `secondary` retains the
   *  distinction. */
  accessories: CatalogProduct[];
  /** Per-kit "why this kit" prose. Templated by the deterministic
   *  planner; upgraded by the LLM when configured. */
  reasoning?: string;
  /** core.price + sum(accessory.price). 0 when prices are missing. */
  totalPrice: number;
};

export type CategoryAccordion = {
  /** Stable id sourced from the {@link BroadSubTopicSpec} the row was
   * built from. Lets the caller key React lists without colliding even
   * across regenerated runtime specs. */
  id: string;
  /** Title from the recipe row, e.g. "Compact drones". */
  title: string;
  /** Per-category one-liner (canned, see CATEGORY_SUBTITLE map). */
  subtitle: string;
  /** First product image — used as the collapsed-row thumbnail. */
  thumbnailUrl?: string;
  products: CatalogProduct[];
};

export type PlanResult = {
  /** Best-effort hero headline derived from the query. Falls back to
   * the raw query when the shortener has nothing to strip. */
  headline: string;
  /** Original query unchanged — kept so the empty state and the CTAs
   * can echo it back to the shopper exactly as typed. */
  rawQuery: string;
  /** Short supporting copy under the headline. Varies by detected
   * activity (e.g. "perfect for travel" vs. "podcast-ready audio"). */
  subhead: string;
  /** File name inside `public/Dji_product_images/marketing-assets/
   * activity-banner/` — resolve through `activityBannerUrl()`. */
  heroImageFile: string;
  /** Activities the keyword extractor caught in the query — surfaced
   * for analytics / debugging, not currently rendered. */
  detectedActivities: string[];
  /** Exactly 3 combos when `hasResults` is true; ordered budget → ideal
   * → top so the rendering layer can map by index without re-sorting. */
  combos: Combo[];
  /** One accordion per non-empty recipe row. */
  categories: CategoryAccordion[];
  /** Activity-level summary shown above the kit tabs. Templated by
   *  the deterministic planner; upgraded by the LLM when configured.
   *  Undefined for the legacy hierarchy path (page falls back to the
   *  subhead). */
  activitySummary?: string;
  /** False when the query is empty OR when the catalog produced zero
   * usable cores AND zero category rows. Page renders an empty state. */
  hasResults: boolean;
};

/* ---------- Hero copy + imagery ---------- */

const HERO_BANNER_BASE = `${
  (import.meta.env.BASE_URL || "/").replace(/\/+$/, "")
}/Dji_product_images/marketing-assets/activity-banner`;

/** Default banner — used when no activity is detected or when an
 *  activity has no curated banner mapped. The "Mini Beginner drone"
 *  shot covers the common drone-photography starter intent that drove
 *  the v1 design. */
export const FALLBACK_HERO_FILE = "Mini Beginner drone banner.jpg";

/** Per-activity hero banner. Limited by what's actually shipped under
 *  `public/Dji_product_images/marketing-assets/activity-banner/` —
 *  unmapped activities fall through to {@link FALLBACK_HERO_FILE}. */
const ACTIVITY_BANNER_FILE: Record<string, string> = {
  motorcycle: "Moto vlog banner.jpg",
  cycling: "Mountain bike banner.jpg",
  skiing_snowboarding: "Skiing banner.jpg",
  surfing: "Surfing banner.jpg",
  watersports: "Diving Banner.jpg",
  hiking_outdoor: "Hiking banner.jpeg",
  travel: "Street photography banner.webp",
  vlog: "Vlogging Banner.jpg",
  podcast: "podcast interview banner.jpg",
  interview: "podcast interview banner.jpg",
  livestream: "Mic banner.jpg",
  wedding: "Wedding photography banner.png",
  real_estate_aerial: "Real estate banner.jpg",
  news_journalism: "Vlogging Banner.jpg",
  concert_event: "Mic banner.jpg",
  theatre: "Mic banner.jpg",
  indoor_sports: "Stabilizer banner.jpg",
  family: "Mini Beginner drone banner.jpg",
  beginner_creator: "Beginner drone banner.jpg",
  professional_filmmaker: "Advanced Film making banner.jpg",
  /* Phone-creator hero — reuse the Stabilizer banner since the
   * Osmo Mobile lineup is the visual centerpiece of the kit. */
  phone_photography: "Stabilizer banner.jpg",
};

/* Query-keyword banner overrides — cover shopper sub-themes that
 * aren't first-class primary activities (FPV racing, running) so the
 * new banners under `activity-banner/` actually surface for the
 * queries they were shot for. Each entry pairs a banner file with a
 * matching subhead so the hero copy stays in lockstep with the image.
 *
 * Order matters: more-specific patterns sit above broader ones (drone
 * racing wins over generic FPV). Overrides win over the
 * `ACTIVITY_BANNER_FILE` lookup so a query like "fpv vlog" lands on
 * the FPV banner instead of the generic vlog one — the override
 * keywords are narrower than any activity in the vocab, so existing
 * activity matches (motorcycle, surfing, wedding, …) keep firing
 * unchanged whenever the query has no override hit. */
const KEYWORD_BANNER_OVERRIDES: ReadonlyArray<{
  test: RegExp;
  file: string;
  subhead: string;
}> = [
  /* ---- Drone product / family overrides ----
   * These fire when the shopper explicitly names a product line, and
   * win over activity-driven banners ("Mavic for travel" should show
   * the Mavic banner, not the generic Street-photography travel one).
   * Ordered specific → broad inside the family. */
  {
    test: /\b(inspire\s*3|inspire\s*iii)\b/i,
    file: "Inspire 3 banner.jpg",
    subhead:
      "Cinema-grade aerial cinematography paired with the lenses, batteries and rigging crews trust.",
  },
  {
    test: /\b(mini\s*3\s*pro|dji\s*mini\s*3\s*pro)\b/i,
    file: "Mini 3 pro banner.jpg",
    subhead:
      "A compact, plane-friendly aerial that punches well above its weight class.",
  },
  {
    /* Catches Mavic 4 Pro / Mavic 3 Pro / Mavic Air / generic Mavic
     * — broad enough to be a useful family fallback, but only fires
     * when the shopper actually typed "Mavic". */
    test: /\bmavic\b/i,
    file: "Mavic banner.png",
    subhead:
      "Pro-grade aerial photography with the optics, range and stabilization the Mavic line is known for.",
  },

  /* ---- FPV / racing — kept above the generic "running" / photo
   * niches because shoppers mentioning FPV almost always want the
   * goggles-on framing, even if the rest of the query mentions
   * filmmaking or vlogging. */
  {
    test: /\b(drone\s*racing|racing\s*drone|race[rsd]?\s*drone|fpv\s*racing)\b/i,
    file: "FPV 2 banner.jpg",
    subhead:
      "Race-ready FPV drones, goggles and protective gear tuned for high-speed flight.",
  },
  {
    test: /\b(fpv|first[\s-]*person[\s-]*view)\b/i,
    file: "FPV banner.jpg",
    subhead:
      "Immersive FPV drones, goggles and accessories that put you in the cockpit.",
  },
  {
    test: /\b(hik\w*|trek\w*|trail|outdoor(?:s)?|wilderness|backpack\w*)\b/i,
    file: "Hiking banner.jpeg",
    subhead:
      "Explore the outdoors with rugged, lightweight gear tuned for hiking routes and travel days.",
  },
  {
    test: /\b(paraglid\w*|base\s*jump\w*|wingsuit\w*|skydiv\w*|skydive\w*)\b/i,
    file: "Aerial activity banner optimized.jpg",
    subhead:
      "Aerial-ready kits with secure body mounts, rugged capture, and stabilized footage for high-altitude adventures.",
  },

  /* ---- Activity sub-themes that aren't first-class primary
   * activities in the v6 vocab. Each one is intentionally narrow so
   * generic queries ("photography", "video") don't get hijacked. */
  {
    test: /\b(snorkel\w*|reef\s*shoot\w*|coral\s*shoot\w*)\b/i,
    file: "Snorkeling banner.jpg",
    subhead:
      "Submersible-ready cameras and floating mounts for shallow-water and reef shoots.",
  },
  {
    test: /\b(landscape\s*photo\w*|nature\s*photo\w*|scenic\s*shoot\w*|landscape\s*shoot\w*|vista\s*shoot\w*)\b/i,
    file: "Landscape photography banner.png",
    subhead:
      "Wide-angle aerials and stabilizers for sweeping vistas and the long approach shot.",
  },
  {
    /* Cityscape sits next to landscape so urban-skyline shoppers get
     * a kit framed for buildings + lights rather than the wider
     * nature framing of the landscape banner. */
    test: /\b(cityscape\w*|city\s*sky\s*line\w*|urban\s*sky\s*line\w*|urban\s*photo\w*|skyline\s*photo\w*)\b/i,
    file: "cityscape banner.jpg",
    subhead:
      "Aerial drones and stabilized cameras tuned for skylines, neon and the long urban exposure.",
  },
  {
    /* "Night photography" is its own intent — distinct from astro /
     * milky way (which need a tracker mindset) and from generic
     * low-light vlogging. Sits above the low-light override so the
     * explicit phrase always wins. */
    test: /\b(night\s*photo\w*|night\s*time\s*photo\w*|after\s*dark\s*shoot\w*|after[\s-]*dark\s*photo\w*)\b/i,
    file: "night photography banner.jpg",
    subhead:
      "Low-light-ready cameras and tripods built for cityscapes, long exposures and the after-dark shoot.",
  },
  {
    /* "low light" alone is too broad (any creator might say "I shoot
     * in low light") — pair it with photo / capture context so a
     * vlogger asking about low-light vlogging doesn't lose their
     * vlog banner. Astro / night-sky / Milky Way are unambiguous. */
    test: /\b(astro\w*|night\s*sky|milky\s*way|star\s*scape|star[\s-]*photo\w*|low[\s-]*light\s+(?:photo\w*|video|shoot\w*|capture|content))\b/i,
    file: "Low light banner.jpg",
    subhead:
      "Low-light-ready cameras and stabilization built for the moments after the sun goes down.",
  },
  {
    /* Real-estate photo / property tour queries — covers the cases
     * where the catalog tagger doesn't flip the `real_estate_aerial`
     * activity (e.g. "real estate photography kit"). The activity
     * mapping above handles aerial-specific intent. */
    test: /\b(real\s*estate\s*(?:photo\w*|video|shoot\w*|tour\w*|listing\w*|content)|property\s*(?:photo\w*|video|shoot\w*|tour\w*|listing\w*)|listing\s*photo\w*|architectural\s*(?:photo\w*|shoot\w*))\b/i,
    file: "Real estate banner.jpg",
    subhead:
      "Aerial-first kit tuned for property reveals, listing tours and architectural shots.",
  },
  {
    /* Gym / fitness creator queries — covers home-gym workout vlogs,
     * crossfit / strength content, fitness coaching kits. Sits above
     * the bare "running" override since a gym-running query is more
     * gym-shaped than trail-shaped. */
    test: /\b(gym|home\s*gym|fitness\s*(?:vlog\w*|content|creator|coach\w*|kit|gear|setup)?|workout\s*(?:vlog\w*|content|video|kit|gear)?|cross\s*fit|weight\s*lift\w*|strength\s*train\w*|body\s*build\w*|powerlift\w*|hiit\s*(?:workout|training|content)?)\b/i,
    file: "Gym banner.jpg",
    subhead:
      "Body-mounted cameras, mics and stabilization built for the gym floor and home workout setups.",
  },
  {
    test: /\b(film\s?making|film\s?maker|short\s*film|narrative\s*film|cine(?:ma)?\s*shoot\w*|cinematic\s*shoot\w*)\b/i,
    file: "Film making banner.jpg",
    subhead:
      "Cinematic kits — drones, gimbals and audio tuned for narrative shoots and short film sets.",
  },
  {
    /* Sits below film-making and the product overrides so explicit
     * intent wins, but above generic activity matches so a "content
     * creator kit for travel" still leans creator-first visually. */
    test: /\b(content\s*creator|content\s*creation|creator\s*(?:kit|setup|gear)|youtube[r]?\s*(?:kit|setup|gear)?)\b/i,
    file: "Content creation banner 3.jpg",
    subhead:
      "All-in-one creator kits — capture, audio and stabilization built for your next post.",
  },

  /* ---- Running — most permissive override, kept last so any of the
   * narrower patterns above can claim ambiguous queries first. */
  {
    /* Bare "running" is intentionally NOT matched on its own — it
     * shows up as a verb in unrelated queries like "running a podcast"
     * or "running a small business". We only fire on tokens that are
     * almost always sport-running (jogger / marathon / trail runner /
     * the noun "runner") OR on "running" in a gear-shopping context
     * ("running gear", "kit for running", etc.). */
    test: /\b(jogg(?:ing|er)|marathon\w*|runners?|trail\s*runn\w*|running\s+(?:gear|kit|equipment|cam(?:era)?|vlog|video|content|track\w*|capture|setup|workout)|(?:gear|kit|equipment|setup)\s+for\s+(?:running|runners?|joggers?|marathon\w*))\b/i,
    file: "Running banner.jpg",
    subhead:
      "Lightweight, body-friendly capture gear that keeps up on every run.",
  },
];

/** Resolve a banner file name to a fully-qualified URL, BASE_URL-aware
 *  so dev and the GitHub Pages build both work. Per-segment
 *  `encodeURIComponent` keeps spaces and the `.webp` extension safe. */
export function activityBannerUrl(file: string): string {
  return `${HERO_BANNER_BASE}/${encodeURIComponent(file)}`;
}

/* ---------- Per-product marketing imagery ---------- */

/* Curated marketing photography per product *family* (lives under
 * `public/Dji_product_images/marketing-assets/Product type/`). The
 * default PDP image (Image_URL) is a transparent product cut-out
 * suitable for thumbnails; the marketing assets are full lifestyle /
 * editorial shots that read better as the kit's hero tile.
 *
 * Lookup is by regex match against the product's title (case-insensitive,
 * with `\b` boundaries). Order matters — more-specific patterns sit
 * above broader ones so "Mavic 4 Pro" beats "Mavic 3 Pro" beats a
 * hypothetical bare "Mavic", "Mic Mini 2" beats "Mic Mini" beats
 * "Mic 2" beats bare "Mic", etc. The list only covers products that
 * actually ship a curated image — anything unmatched falls through to
 * the PDP image at the call site. */
const PRODUCT_TYPE_IMAGE_BASE = `${
  (import.meta.env.BASE_URL || "/").replace(/\/+$/, "")
}/Dji_product_images/marketing-assets/Product type`;

const PRODUCT_TYPE_IMAGE_FILES: ReadonlyArray<{ test: RegExp; file: string }> =
  [
    /* Action cameras (Osmo Action series) */
    { test: /\bosmo\s*action\s*6\b/i, file: "Action 6.jpg" },
    { test: /\bosmo\s*action\s*5\s*pro\b/i, file: "Action 5 pro.jpg" },
    { test: /\bosmo\s*action\s*2\b/i, file: "Action 2.jpg" },

    /* Drones — most-specific names first so "Mini 5 Pro" beats
     * a "Mini" prefix match etc. */
    { test: /\bair\s*3s\b/i, file: "Air 3S.jpg" },
    { test: /\bavata\s*2\b/i, file: "Avata 2.jpg" },
    { test: /\bavata\b/i, file: "Avata.jpg" },
    { test: /\bflip\b/i, file: "Flip.jpg" },
    { test: /\blito\s*x1\b/i, file: "Lito X1.jpg" },
    { test: /\bmavic\s*4\s*pro\b/i, file: "Mavic 4 pro.jpg" },
    { test: /\bmavic\s*3\s*pro\b/i, file: "Mavic 3 Pro.jpg" },
    { test: /\bmini\s*5\s*pro\b/i, file: "Mini 5 pro.jpg" },
    { test: /\bmini\s*4\s*pro\b/i, file: "Mini 4 Pro.jpg" },
    { test: /\bneo\s*2\b/i, file: "Neo 2.jpg" },

    /* Microphones — Mini 2 > Mini > 3 > 2 > bare Mic */
    { test: /\bmic\s*mini\s*2\b/i, file: "Mic Mini 2.jpg" },
    { test: /\bmic\s*mini\b/i, file: "Mic mini.jpg" },
    { test: /\bmic\s*3\b/i, file: "Mic 3.jpg" },
    { test: /\bmic\s*2\b/i, file: "Mic 2.jpg" },
    { test: /\bdji\s*mic\b/i, file: "Mic.jpg" },

    /* Pocket / Nano / 360 */
    { test: /\bosmo\s*nano\b/i, file: "Osmo Nano.jpg" },
    { test: /\bosmo\s*360\b/i, file: "osmo 360.jpg" },
    { test: /\bosmo\s*pocket\b/i, file: "Osmo pocket.jpg" },

    /* Mobile gimbals — version numbers first, SE last so the bare
     * "Osmo Mobile SE" doesn't get clobbered by a numeric match. */
    { test: /\bosmo\s*mobile\s*8\b/i, file: "Osmo mobile 8.jpg" },
    { test: /\bosmo\s*mobile\s*7\b/i, file: "Osmo mobile 7.jpg" },
    { test: /\bosmo\s*mobile\s*6\b/i, file: "Osmo mobile 6.jpg" },
    { test: /\bosmo\s*mobile\s*se\b/i, file: "Osmo mobile SE.jpg" },

    /* Camera gimbals (RS series) — accept "RS4", "RS 4", "RS-4". */
    { test: /\brs[\s-]*3[\s-]*mini\b/i, file: "RS3 mini.jpg" },
    { test: /\brs[\s-]*4[\s-]*mini\b/i, file: "RS4 Mini.jpg" },
    { test: /\brs[\s-]*4[\s-]*pro\b/i, file: "RS4 Pro.jpg" },
    { test: /\brs[\s-]*5\b/i, file: "RS5.jpg" },
    { test: /\brs[\s-]*4\b/i, file: "RS4.jpg" },
  ];

/** Resolve a curated marketing image for the given product. Returns
 *  `undefined` when no curated image is mapped — callers should fall
 *  back to `product.imageUrl` (the PDP cut-out). */
export function productTypeImageUrl(
  product: { title?: string | null } | null | undefined,
): string | undefined {
  const title = product?.title;
  if (!title) return undefined;
  for (const { test, file } of PRODUCT_TYPE_IMAGE_FILES) {
    if (test.test(title)) {
      return `${PRODUCT_TYPE_IMAGE_BASE}/${encodeURIComponent(file)}`;
    }
  }
  return undefined;
}

/**
 * Pick the hero banner + subhead for a Wingman query.
 *
 * Order:
 *   1. {@link KEYWORD_BANNER_OVERRIDES} — narrow shopper sub-themes
 *      (FPV racing, FPV, running) that don't map to a first-class
 *      primary activity but ship with a curated banner under
 *      `activity-banner/`.
 *   2. {@link ACTIVITY_BANNER_FILE} / {@link ACTIVITY_SUBHEAD} —
 *      banner + copy for the first detected v6 primary activity
 *      (motorcycle, vlog, wedding, …).
 *   3. {@link FALLBACK_HERO_FILE} / {@link DEFAULT_SUBHEAD} — a
 *      neutral beginner-drone visual when nothing else matches.
 *
 * Returning the pair from a single helper keeps banner and subhead in
 * lockstep — they used to be looked up from parallel maps at each
 * call site, which made it easy to update one and forget the other.
 */
function pickHero(
  query: string,
  detectedActivities: string[],
): { heroImageFile: string; subhead: string } {
  for (const override of KEYWORD_BANNER_OVERRIDES) {
    if (override.test.test(query)) {
      return { heroImageFile: override.file, subhead: override.subhead };
    }
  }
  const primary = detectedActivities[0] ?? "";
  return {
    heroImageFile: ACTIVITY_BANNER_FILE[primary] ?? FALLBACK_HERO_FILE,
    subhead: ACTIVITY_SUBHEAD[primary] ?? DEFAULT_SUBHEAD,
  };
}

/** Per-activity subhead. Mirrors the Figma's tone — punchy, present
 *  tense, "we're going to help you get there". */
const ACTIVITY_SUBHEAD: Record<string, string> = {
  motorcycle: "Built to ride: rugged cameras, mounts and mics for capturing every twist of the road.",
  cycling: "Hands-free shots from the saddle — action cams, mounts and aerial pairings ready to roll.",
  skiing_snowboarding: "Wind-resistant gear that keeps shooting when the temperature drops.",
  surfing: "Waterproof rigs and floating mounts so the next set is the only thing you have to worry about.",
  watersports: "Submersible-ready cameras and protective cases tuned for the water.",
  hiking_outdoor: "Lightweight kit that travels well and shoots better off-grid.",
  travel: "Compact, plane-friendly gear that captures the trip without weighing down the bag.",
  vlog: "Talking-head ready: pocket cameras, mics and gimbals tuned for creator workflows.",
  podcast: "Studio-quality audio in a kit that fits in a backpack — ready when guests are.",
  interview: "Two-mic, one-camera setups built for clean dialogue in any room.",
  livestream: "Stream-ready cameras and audio that look professional from frame one.",
  wedding: "Cinematic drones, smooth gimbals and dependable wireless audio for the day that has to come out perfect.",
  real_estate_aerial: "Aerial-first kit tuned for property reveals and architectural shots.",
  news_journalism: "Run-and-gun ready: pocket cams, wireless mics and stabilization for fast turnarounds.",
  concert_event: "Capture the crowd and the stage with gear sized for tight venues.",
  theatre: "Discreet audio + stable visuals for stage productions where reshoots aren't an option.",
  indoor_sports: "Court-side action cams and FPV stabilization built for fast indoor motion.",
  family: "Easy-to-fly drones and pocket cameras the whole family can pick up and use.",
  beginner_creator: "Beginner-friendly kits with everything you need to start creating from day one.",
  professional_filmmaker: "Pro-grade aerials, gimbals and audio for sets that demand cinematic results.",
  phone_photography:
    "Phone-first kits — Osmo Mobile gimbals, magnetic clamps, ND filters and wireless audio for shooting straight from your pocket.",
};

/** Subhead shown when no activity is detected — calibrated to the
 *  drone-photography starter intent the page was designed around. */
const DEFAULT_SUBHEAD =
  "Here are beginner-friendly kits curated by Wingman to help you start creating right away.";

/** Eyebrow + chips copy lives on the page component itself rather than
 *  the planner — they don't depend on the query. */

/* ---------- Combo presentation labels ----------
 *
 * Branded names + tagline chips don't come from the catalog — they're
 * a product-marketing layer the planner stamps on top of the dynamic
 * core/accessory selection. Keeping them here (vs. in the page
 * component) lets us swap copy per-tier without touching JSX.
 */

type ComboCopy = { label: string; tagline: string; badgeTone: ComboBadgeTone };

/* Only the three wingman-curated tiers carry built-in copy — the
 * "custom" combo built from a chat message authors its own copy in
 * `buildCustomCombo.ts`. */
const COMBO_COPY: Record<WingmanComboTier, ComboCopy> = {
  budget: {
    label: "Budget Kit",
    tagline: "BEST VALUE",
    badgeTone: "green",
  },
  ideal: {
    label: "Ideal Kit",
    tagline: "MOST POPULAR",
    badgeTone: "blue",
  },
  top: {
    label: "Top of the Line",
    tagline: "PRO-GRADE PERFORMANCE",
    badgeTone: "purple",
  },
};

const TIER_TOTAL_MIN: Record<WingmanComboTier, number> = {
  // Total products includes core + accessories. Retuned to the v2
  // spec composition (Cost Effective = core + 1; Ideal = core +
  // secondary + 2; Pro = core + 1-2 secondary + 3-4).
  budget: 2,
  ideal: 3,
  top: 5,
};

const TIER_TOTAL_MAX: Record<WingmanComboTier, number> = {
  budget: 3,
  ideal: 4,
  top: 7,
};

const BUNDLE_MAX_BY_TIER: Record<WingmanComboTier, number> = {
  budget: TIER_TOTAL_MAX.budget - 1,
  ideal: TIER_TOTAL_MAX.ideal - 1,
  top: TIER_TOTAL_MAX.top - 1,
};

const AERIAL_ACTIVITY_IDS = new Set(["paragliding", "base_jumping"]);
const AERIAL_MOUNT_PRIORITY = ["mount_helmet", "mount_chest", "mount_wrist"] as const;
const WHITEWATER_ACTIVITY_IDS = new Set(["whitewater_rafting"]);
const WHITEWATER_MOUNT_PRIORITY = ["mount_wrist", "mount_chest"] as const;
const WATERSPORT_ACTIVITY_IDS = new Set([
  "scuba_diving_snorkeling",
  "freediving",
  "whitewater_rafting",
  "kayak_fishing",
  "sailing",
]);
const WATERSPORT_QUERY_PATTERN =
  /\b(scuba|snorkel\w*|freediv\w*|diving|underwater|watersport\w*|water\s*sport\w*|whitewater|rafting|kayak\w*|surf\w*|sail\w*|ocean|sea)\b/i;
const AUDIO_FIRST_QUERY_PATTERN =
  /\b(podcast\w*|interview\w*|livestream\w*|live\s*stream\w*|radio\s*show|microphone\w*|\bmic\b)\b/i;
const EXPLICIT_DRONE_QUERY_PATTERN =
  /\b(drone\w*|mavic|avata|fpv|aerial|mini\s*\d|air\s*\d)\b/i;

function isDroneLikeCore(product: CatalogProduct): boolean {
  if (product.productTypeGroup === "drone") return true;
  if (product.category === "drone") return true;
  if (product.subtypes.some((subtype) => subtype.startsWith("drone_"))) return true;
  return /\b(drone|mavic|avata|fpv|aerial)\b/i.test(product.title);
}

function isAudioFirstSignal(query: string): boolean {
  return AUDIO_FIRST_QUERY_PATTERN.test(query) && !EXPLICIT_DRONE_QUERY_PATTERN.test(query);
}

function isAudioPrimaryProduct(product: CatalogProduct): boolean {
  if (product.category === "microphone") return true;
  if (product.subtypes.some((subtype) => subtype.startsWith("mic_"))) return true;
  if (product.useCaseTags.some((tag) => ["podcast", "interview", "livestream"].includes(tag))) {
    return true;
  }
  return /\b(mic|microphone|transmitter|receiver|lavalier)\b/i.test(product.title);
}

function hasWatersportSignal(activityIds: string[], query: string): boolean {
  return activityIds.some((id) => WATERSPORT_ACTIVITY_IDS.has(id)) || WATERSPORT_QUERY_PATTERN.test(query);
}

function prioritizeAerialMountAccessories(
  accessories: CatalogProduct[],
  activityIds: string[],
): CatalogProduct[] {
  if (!activityIds.some((id) => AERIAL_ACTIVITY_IDS.has(id))) return accessories;
  const rankBySubtype = (product: CatalogProduct): number => {
    const idx = AERIAL_MOUNT_PRIORITY.findIndex((subtype) => product.subtypes.includes(subtype));
    return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
  };
  return [...accessories].sort((a, b) => {
    const aRank = rankBySubtype(a);
    const bRank = rankBySubtype(b);
    if (aRank !== bRank) return aRank - bRank;
    return 0;
  });
}

function prioritizeWhitewaterMountAccessories(
  accessories: CatalogProduct[],
  activityIds: string[],
): CatalogProduct[] {
  if (!activityIds.some((id) => WHITEWATER_ACTIVITY_IDS.has(id))) return accessories;
  const rankBySubtype = (product: CatalogProduct): number => {
    const idx = WHITEWATER_MOUNT_PRIORITY.findIndex((subtype) =>
      product.subtypes.includes(subtype),
    );
    return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
  };
  return [...accessories].sort((a, b) => {
    const aRank = rankBySubtype(a);
    const bRank = rankBySubtype(b);
    if (aRank !== bRank) return aRank - bRank;
    return 0;
  });
}

function injectAerialMountFallbacks(
  core: CatalogProduct,
  catalog: CatalogProduct[],
  accessories: CatalogProduct[],
  activityIds: string[],
  size: number,
): CatalogProduct[] {
  if (!activityIds.some((id) => AERIAL_ACTIVITY_IDS.has(id))) return accessories;
  const bySlug = new Set(accessories.map((a) => a.slug));
  const mountCandidates = findAccessoriesFor(core, catalog, {
    role: "mounting",
    limit: 12,
  }).filter((product) =>
    AERIAL_MOUNT_PRIORITY.some((subtype) => product.subtypes.includes(subtype)),
  );
  const injected: CatalogProduct[] = [];
  for (const candidate of mountCandidates) {
    if (bySlug.has(candidate.slug)) continue;
    injected.push(candidate);
    bySlug.add(candidate.slug);
    if (injected.length >= 2) break;
  }
  return [...injected, ...accessories].slice(0, Math.max(1, size));
}

function injectWhitewaterMountFallbacks(
  core: CatalogProduct,
  catalog: CatalogProduct[],
  accessories: CatalogProduct[],
  activityIds: string[],
  size: number,
): CatalogProduct[] {
  if (!activityIds.some((id) => WHITEWATER_ACTIVITY_IDS.has(id))) return accessories;
  const bySlug = new Set(accessories.map((a) => a.slug));
  const mountCandidates = findAccessoriesFor(core, catalog, {
    role: "mounting",
    limit: 12,
  }).filter((product) =>
    WHITEWATER_MOUNT_PRIORITY.some((subtype) => product.subtypes.includes(subtype)),
  );
  const injected: CatalogProduct[] = [];
  for (const candidate of mountCandidates) {
    if (bySlug.has(candidate.slug)) continue;
    injected.push(candidate);
    bySlug.add(candidate.slug);
    if (injected.length >= 2) break;
  }
  return [...injected, ...accessories].slice(0, Math.max(1, size));
}

function injectWatersportCaseFallbacks(
  core: CatalogProduct,
  catalog: CatalogProduct[],
  accessories: CatalogProduct[],
  activityIds: string[],
  query: string,
  size: number,
): CatalogProduct[] {
  if (!hasWatersportSignal(activityIds, query)) return accessories;
  const bySlug = new Set(accessories.map((a) => a.slug));
  const caseCandidates = findAccessoriesFor(core, catalog, {
    role: "storage",
    limit: 12,
    subtypes: ["acc_case"],
    capabilities: ["waterproof"],
  });
  const fallbackCandidates =
    caseCandidates.length > 0
      ? caseCandidates
      : findAccessoriesFor(core, catalog, {
          role: "storage",
          limit: 12,
          subtypes: ["acc_case"],
        });
  const injected: CatalogProduct[] = [];
  for (const candidate of fallbackCandidates) {
    if (bySlug.has(candidate.slug)) continue;
    injected.push(candidate);
    bySlug.add(candidate.slug);
    if (injected.length >= 2) break;
  }
  return [...injected, ...accessories].slice(0, Math.max(1, size));
}

function filterAccessoriesByDisplayedCores(
  accessories: CatalogProduct[],
  cores: CatalogProduct[],
): CatalogProduct[] {
  return accessories.filter((accessory) =>
    isAccessoryCompatibleWithAnyCoreStrict(accessory, cores),
  );
}

function refillStrictCompatibleAccessories(
  accessories: CatalogProduct[],
  cores: CatalogProduct[],
  catalog: CatalogProduct[],
  size: number,
): CatalogProduct[] {
  if (accessories.length >= size) return accessories.slice(0, size);
  const out = [...accessories];
  const seen = new Set(out.map((p) => p.slug));

  const addCandidates = (candidates: CatalogProduct[]) => {
    for (const candidate of candidates) {
      if (out.length >= size) break;
      if (seen.has(candidate.slug)) continue;
      if (!isAccessoryCompatibleWithAnyCoreStrict(candidate, cores)) continue;
      out.push(candidate);
      seen.add(candidate.slug);
    }
  };

  for (const core of cores) {
    if (out.length >= size) break;
    addCandidates(
      findAccessoriesFor(core, catalog, {
        limit: Math.max(10, size * 4),
        requireModelMatch: true,
      }),
    );
  }

  for (const core of cores) {
    if (out.length >= size) break;
    addCandidates(
      findAccessoriesFor(core, catalog, {
        limit: Math.max(10, size * 4),
      }),
    );
  }

  return out.slice(0, size);
}

function normalizeTierAccessoryCount(
  accessories: CatalogProduct[],
  core: CatalogProduct,
  catalog: CatalogProduct[],
  tier: WingmanComboTier,
): CatalogProduct[] {
  const minAccessories = Math.max(0, TIER_TOTAL_MIN[tier] - 1);
  const maxAccessories = Math.max(minAccessories, TIER_TOTAL_MAX[tier] - 1);
  const out = [...accessories].slice(0, maxAccessories);
  if (out.length >= minAccessories) return out;

  const seen = new Set(out.map((a) => a.slug));
  const refill = findAccessoriesFor(core, catalog, {
    limit: Math.max(10, maxAccessories * 4),
    requireModelMatch: true,
  });
  for (const candidate of refill) {
    if (out.length >= minAccessories) break;
    if (seen.has(candidate.slug)) continue;
    out.push(candidate);
    seen.add(candidate.slug);
  }
  if (out.length < minAccessories) {
    const relaxedRefill = findAccessoriesFor(core, catalog, {
      limit: Math.max(12, maxAccessories * 5),
    });
    for (const candidate of relaxedRefill) {
      if (out.length >= minAccessories) break;
      if (seen.has(candidate.slug)) continue;
      out.push(candidate);
      seen.add(candidate.slug);
    }
  }
  if (out.length < minAccessories) {
    const broadRefill = buildAccessoryBundle(core, catalog, Math.max(minAccessories, maxAccessories));
    for (const candidate of broadRefill) {
      if (out.length >= minAccessories) break;
      if (seen.has(candidate.slug)) continue;
      out.push(candidate);
      seen.add(candidate.slug);
    }
  }
  return out.slice(0, maxAccessories);
}

function ensureAudioFirstBundleSize(
  accessories: CatalogProduct[],
  core: CatalogProduct,
  catalog: CatalogProduct[],
  tier: WingmanComboTier,
): CatalogProduct[] {
  const minAccessories = Math.max(0, TIER_TOTAL_MIN[tier] - 1);
  const maxAccessories = Math.max(minAccessories, TIER_TOTAL_MAX[tier] - 1);
  const out = [...accessories].slice(0, maxAccessories);
  if (out.length >= minAccessories) return out;

  const seen = new Set(out.map((a) => a.slug));
  const audioCandidates = catalog
    .filter((product) => {
      if (product.slug === core.slug) return false;
      if (isDroneLikeCore(product)) return false;
      if (!product.isAccessory && !product.isBundle && product.category !== "microphone") return false;
      if (isAudioPrimaryProduct(product)) return true;
      if (product.useCaseTags.some((tag) => ["podcast", "interview", "livestream"].includes(tag))) {
        return true;
      }
      return /\b(tripod|stand|adapter|receiver|transmitter|windscreen|charging\s*case)\b/i.test(
        product.title,
      );
    })
    .sort(byRatingDesc);

  for (const candidate of audioCandidates) {
    if (out.length >= minAccessories) break;
    if (seen.has(candidate.slug)) continue;
    out.push(candidate);
    seen.add(candidate.slug);
  }
  return out.slice(0, maxAccessories);
}

function ensureWatersportCaseSlot(
  accessories: CatalogProduct[],
  core: CatalogProduct,
  catalog: CatalogProduct[],
  activityIds: string[],
  query: string,
  size: number,
): CatalogProduct[] {
  if (!hasWatersportSignal(activityIds, query)) return accessories;
  const alreadyHasCase = accessories.some((a) => a.subtypes.includes("acc_case"));
  if (alreadyHasCase) return accessories;
  const candidates = findAccessoriesFor(core, catalog, {
    role: "storage",
    limit: 20,
    subtypes: ["acc_case"],
    capabilities: ["waterproof"],
  });
  const fallbackCandidates =
    candidates.length > 0
      ? candidates
      : findAccessoriesFor(core, catalog, {
          role: "storage",
          limit: 20,
          subtypes: ["acc_case"],
        });
  const replacement = fallbackCandidates.find(
    (c) => !accessories.some((a) => a.slug === c.slug),
  );
  if (!replacement) return accessories;
  const out = [...accessories];
  if (out.length < size) return [...out, replacement].slice(0, size);
  const replaceIndex = out.findIndex((a) => !a.subtypes.includes("acc_case"));
  if (replaceIndex === -1) return out;
  out[replaceIndex] = replacement;
  return out;
}

/* ---------- Headline shortening ----------
 *
 * Shoppers type conversational sentences ("I want to start drone
 * photography"). The hero looks better with a punchy fragment ("Drone
 * photography starter kit"). Strip the leading "I want to / help me /
 * etc.", strip trailing question marks, capitalize, cap to ~60 chars.
 *
 * Falls back to the raw trimmed query when stripping leaves nothing —
 * we never return a blank headline. */

const HEADLINE_LEADING_PATTERNS: RegExp[] = [
  /^i\s+(want|need|would\s+like|hope)\s+to\s+/i,
  /^i'?m\s+(looking\s+to|trying\s+to|going\s+to|planning\s+to|headed\s+to|off\s+to)\s+/i,
  /* `i am` / `we are` / `we're` cases — mirror the contracted variants
   * above. Without these, "I am going to yosemite next month" keeps
   * its full leading clause and the heuristic returns a 12-word
   * banner. */
  /^i\s+am\s+(looking\s+to|trying\s+to|going\s+to|planning\s+to|headed\s+to|off\s+to)\s+/i,
  /^we\s+(are|'re)\s+(looking\s+to|trying\s+to|going\s+to|planning\s+to|headed\s+to|off\s+to)\s+/i,
  /* BARE gerund openers — "heading to iceland", "going to alaska",
   * "off to bali". Casual shoppers drop the "I'm" / "we're" subject.
   * Without these patterns the leading clause survives and the
   * heuristic banner reads like the raw query. */
  /^(heading|going|off|headed|traveling|travelling|flying|driving|biking|hiking)\s+(to|for|out)\s+/i,
  /* Verb + gerund openers — "planning a road trip", "thinking about a
   * wedding shoot". Followed by an article so we don't accidentally
   * eat verbs that anchor the activity. */
  /^(planning|thinking\s+about|considering|preparing\s+for|getting\s+ready\s+for)\s+(a|an|my|our|the)\s+/i,
  /* Preference / hobby openers — "i am into mountain biking", "i'm
   * into drones", "i love hiking", "i enjoy vlogging". These state
   * the activity but the subject clause is pure filler for a headline. */
  /^i(\s+am|'?m)\s+into\s+/i,
  /^i\s+(love|enjoy|like|do)\s+/i,
  /* Beginner-intent verbs — "start vlogging", "begin drone photography",
   * "learn to fly". Followed optionally by "to" so "learn to fly"
   * collapses to "fly". */
  /^(start|begin|learn|try)\s+(to\s+)?/i,
  /^help\s+me\s+(with\s+)?/i,
  /^show\s+me\s+/i,
  /^build\s+(me\s+)?/i,
  /^find\s+me\s+/i,
  /^get\s+(me\s+)?/i,
  /^let'?s\s+/i,
  /^can\s+you\s+(help\s+me\s+)?/i,
  /^how\s+do\s+i\s+/i,
  /^what'?s\s+(the\s+)?(best|right)\s+(gear|kit|setup|equipment)\s+for\s+/i,
];

/* Trailing interrogative / intent clauses that shoppers chain onto a
 * context sentence ("…next month, what should I carry"). We strip
 * these after the leading-verb pass so the heuristic returns the
 * descriptive prefix rather than the question. Patterns are anchored
 * to a clause boundary (start of string, comma, or period) so we
 * never gobble an internal phrase that happens to contain "what". */
const HEADLINE_TRAILING_INTERROGATIVES: RegExp[] = [
  /[\s,;]+(what|which)\s+(should|do|gear|kit|equipment|stuff)\s+.*$/i,
  /[\s,;]+(can\s+you|could\s+you)\s+(suggest|recommend|help)\s+.*$/i,
  /[\s,;]+(any\s+)?(suggestions?|recommendations?|ideas?)\??\s*$/i,
  /[\s,;]+(help|advice)\s+(needed|please)?\??\s*$/i,
  /* Intent clauses — "..., want to film the northern lights" /
   * "..., planning to document the trip". These are second-clause
   * elaborations on the user's goal that bloat the headline. */
  /[\s,;]+(want\s+to|wanting\s+to|need\s+to|planning\s+to|going\s+to|hoping\s+to|trying\s+to)\s+.*$/i,
  /* Time/companion qualifiers — "..., in december with my partner",
   * "...next week", "...this weekend". Anything starting with a
   * preposition + time/companion noun is throat-clearing context. */
  /[\s,;]+(in|on|during|with)\s+(my|our|the|january|february|march|april|may|june|july|august|september|october|november|december|spring|summer|fall|winter|autumn|partner|family|friends|kids|wife|husband|girlfriend|boyfriend)\b.*$/i,
  /* Bare "next X" / "this X" / "for the X" time phrases. The
   * second token can be any single word — lazier than enumerating
   * every time unit and good enough for the heuristic. */
  /[\s,;]?\s+(next|this|last|every|each|over\s+the)\s+(week|weeks|weekend|month|months|year|years|day|days|spring|summer|fall|winter|autumn|holiday|holidays|trip|vacation)\b.*$/i,
];

/* Words that, when they appear as a standalone token after the
 * stripping passes, mean the heuristic still has filler in it.
 * If a stripped headline ends with one of these, drop the trailing
 * tail back to the previous word boundary. */
const HEADLINE_TRAILING_DEAD_WORDS = new Set([
  "to",
  "with",
  "in",
  "on",
  "for",
  "and",
  "or",
  "of",
  "the",
  "a",
  "an",
  "my",
  "our",
  /* Dangling subject pronoun left behind when a trailing clause is
   * stripped mid-sentence, e.g. "mountain biking, i want to…" →
   * "mountain biking, i" → "mountain biking". */
  "i",
]);

/* 40 chars ≈ 6 words at typical English word lengths — matches the
 * LLM headline target of 2-5 words so the fallback and the LLM
 * upgrade feel consistent in size. The previous 64-char cap let
 * the heuristic render two-clause sentences. */
const HEADLINE_MAX_LENGTH = 40;

/* Shopping nouns that mean the distilled phrase already reads as a
 * "what to buy" headline ("action camera kit", "travel gear"). When
 * one is present we skip the "Gear for …" wrapper to avoid stutter
 * like "gear for camera gear". */
const HEADLINE_SHOPPING_NOUN_RE =
  /\b(gear|kit|equipment|setup|tech|combo|combos|rig|rigs|bundle|essentials|drone|camera|gimbal|mic|microphone)\b/i;

/**
 * Frame a distilled activity phrase as a "Gear for {activity}" headline
 * so the fallback reads like a curated recommendation ("Gear for
 * mountain biking") instead of a bare fragment ("Mountain biking").
 *
 * Skipped — the phrase is returned untouched — when it already:
 *   • contains an explicit "for" clause ("best drone for vlogging"),
 *   • names a shopping noun ("action camera", "travel kit"), or
 *   • is too long (> 5 words) to reframe without reading awkwardly.
 */
function ensureGearFraming(phrase: string): string {
  if (!phrase) return phrase;
  if (/\bfor\b/i.test(phrase)) return phrase;
  if (HEADLINE_SHOPPING_NOUN_RE.test(phrase)) return phrase;
  if (phrase.trim().split(/\s+/).length > 5) return phrase;
  return `gear for ${phrase}`;
}

export function shortenQuery(query: string): string {
  let working = query.trim();
  if (!working) return "";

  /* Strip the leading conversational verb phrase. Loop so chains like
   * "I want to start to ..." get progressively trimmed; cap at 3
   * iterations to avoid pathological inputs eating CPU. */
  for (let i = 0; i < 3; i += 1) {
    let matched = false;
    for (const pattern of HEADLINE_LEADING_PATTERNS) {
      const next = working.replace(pattern, "");
      if (next !== working) {
        working = next.trim();
        matched = true;
        break;
      }
    }
    if (!matched) break;
  }

  /* Strip a trailing interrogative / intent clause ("…what should
   * I carry", "…want to film the northern lights"). Loop so chained
   * trailing clauses (intent clause followed by an interrogative)
   * collapse in one shortenQuery pass. Cap iterations defensively. */
  for (let i = 0; i < 3; i += 1) {
    let matched = false;
    for (const pattern of HEADLINE_TRAILING_INTERROGATIVES) {
      const next = working.replace(pattern, "");
      if (next !== working) {
        working = next.trim();
        matched = true;
        break;
      }
    }
    if (!matched) break;
  }

  /* Drop a trailing punctuation tail; keep internal punctuation intact
   * so phrases like "drones, gimbals & mics" still read naturally. */
  working = working.replace(/[?!.,;:]+$/g, "").trim();

  /* If the previous strips left a dangling preposition or article
   * ("…going for", "…with my"), peel it back to the last meaningful
   * word so the banner doesn't read mid-thought. */
  for (let i = 0; i < 3; i += 1) {
    const lastSpace = working.lastIndexOf(" ");
    if (lastSpace <= 0) break;
    const tail = working.slice(lastSpace + 1).toLowerCase().replace(/[^a-z']/g, "");
    if (!HEADLINE_TRAILING_DEAD_WORDS.has(tail)) break;
    working = working.slice(0, lastSpace).replace(/[?!.,;:]+$/g, "").trim();
  }

  if (!working) return query.trim();

  /* Reframe the bare activity as a "Gear for …" recommendation so the
   * heuristic fallback reads like a headline, matching the LLM
   * upgrade's "{thing} for {activity}" template. */
  working = ensureGearFraming(working);

  /* Ellipsize over-long headlines at a word boundary so we don't
   * truncate mid-token. Shoppers can still see the full query in the
   * subhead/empty-state copy if needed. */
  if (working.length > HEADLINE_MAX_LENGTH) {
    const slice = working.slice(0, HEADLINE_MAX_LENGTH);
    const lastSpace = slice.lastIndexOf(" ");
    working = (lastSpace > 0 ? slice.slice(0, lastSpace) : slice).trim() + "…";
  }

  /* Capitalize the first letter only — preserve any intentional camel-
   * casing or proper nouns the shopper typed (e.g. "Mavic", "DJI"). */
  return working.charAt(0).toUpperCase() + working.slice(1);
}

function buildHeroHeadline(
  query: string,
  audioFirst: boolean,
  detectedActivities: string[],
): string {
  if (!audioFirst) return shortenQuery(query);
  if (detectedActivities.includes("podcast")) return "Podcast recording kit";
  if (detectedActivities.includes("interview")) return "Interview audio kit";
  if (detectedActivities.includes("livestream")) return "Livestream audio kit";
  if (/\bpodcast\w*\b/i.test(query)) return "Podcast recording kit";
  if (/\binterview\w*\b/i.test(query)) return "Interview audio kit";
  if (/\b(livestream\w*|live\s*stream\w*)\b/i.test(query)) return "Livestream audio kit";
  return shortenQuery(query);
}

/* ---------- Per-row subtitle copy ---------- */

/** Map a recipe row title to a single-sentence sub-copy used by the
 *  collapsed accordion row. Keys are matched by lower-cased substring
 *  so renamed rows ("Wireless microphones" vs. "Microphones") still
 *  hit the same template. Order matters — first hit wins. */
const ROW_SUBTITLE_RULES: Array<{ test: string; subtitle: string }> = [
  { test: "drone", subtitle: "Compact, beginner-friendly aerial cameras" },
  { test: "action camera", subtitle: "Rugged cameras tuned for movement" },
  { test: "pocket camera", subtitle: "Vlog-ready handhelds that fit in a pocket" },
  { test: "vlogging camera", subtitle: "Vlog-ready handhelds tuned for talking heads" },
  { test: "gimbal", subtitle: "Stabilize phone or camera footage in any light" },
  { test: "microphone", subtitle: "Capture clean audio anywhere" },
  { test: "lavalier", subtitle: "Discreet clip-on mics for interviews and dialogue" },
  { test: "filter", subtitle: "Control light and add cinematic depth" },
  { test: "lens", subtitle: "Expand framing with optical add-ons" },
  { test: "case", subtitle: "Protect and carry your gear" },
  { test: "bag", subtitle: "Travel-ready storage for the full kit" },
  { test: "tripod", subtitle: "Steady, repeatable shots — solo or studio" },
  { test: "mount", subtitle: "Attach your camera to anything" },
  { test: "battery", subtitle: "Extend shoot time without swaps" },
  { test: "charger", subtitle: "Top up the kit between flights" },
];

const DEFAULT_ROW_SUBTITLE = "Hand-picked products that match your goal.";

function subtitleFor(rowTitle: string): string {
  const lower = rowTitle.toLowerCase();
  const hit = ROW_SUBTITLE_RULES.find(({ test }) => lower.includes(test));
  return hit?.subtitle ?? DEFAULT_ROW_SUBTITLE;
}

/* ---------- Core picking ---------- */

function byRatingDesc(a: CatalogProduct, b: CatalogProduct): number {
  const ar = a.rating ?? 0;
  const br = b.rating ?? 0;
  if (ar !== br) return br - ar;
  /* Tie-breaker: review count, then price asc so cheaper-but-equally-
   * rated cores naturally land in the budget combo. */
  const av = a.reviewCount ?? 0;
  const bv = b.reviewCount ?? 0;
  if (av !== bv) return bv - av;
  return (a.price ?? Infinity) - (b.price ?? Infinity);
}

/* ---------- Public entry point ---------- */

/**
 * Build a curated plan for the Wingman Plan page.
 *
 * Returns `hasResults: false` (and stable empty arrays) when:
 *   • the query is blank, OR
 *   • the catalog hasn't loaded yet, OR
 *   • the recipe yields zero usable cores AND zero category rows.
 *
 * The page component is responsible for switching to the empty-state
 * UI in those cases — the planner stays pure and side-effect-free.
 */
export function buildPlan(query: string, catalog: CatalogProduct[]): PlanResult {
  const trimmed = query.trim();
  const audioFirst = isAudioFirstSignal(trimmed);
  const waveActivities = detectWaveActivities(trimmed);
  const activityConstraints = buildActivityConstraints(waveActivities);

  const baseEmpty: PlanResult = {
    headline: trimmed ? shortenQuery(trimmed) : "Tell Wingman what you want to shoot",
    rawQuery: trimmed,
    subhead: DEFAULT_SUBHEAD,
    heroImageFile: FALLBACK_HERO_FILE,
    detectedActivities: [],
    combos: [],
    categories: [],
    hasResults: false,
  };

  if (!trimmed || catalog.length === 0) {
    return baseEmpty;
  }

  const detectedActivities = extractActivitiesFromQuery(trimmed);
  const intent = classifyIntent(trimmed);
  const recipe = pickRecipeForIntent(intent, trimmed);

  /* Resolve every recipe row against the live catalog up-front so
   * combo selection and category accordions share the same product
   * pool. Empty rows are dropped — the recipe templates intentionally
   * over-provide so a couple of empty buckets is normal. */
  let rows = recipe
    .map((spec) => ({
      spec,
      products: buildRowProductsFromSpec(spec, catalog),
    }))
    .filter((row) => row.products.length > 0);

  if (rows.length === 0 && hasWatersportSignal(activityConstraints.activities, trimmed)) {
    const fallbackCores = catalog
      .filter((product) => {
        if (product.isAccessory || product.isBundle) return false;
        if (product.category === "action_camera") return true;
        if (product.useCaseTags.includes("underwater")) return true;
        if (product.useCaseTags.includes("waterproof")) return true;
        return /action|osmo/i.test(product.title);
      })
      .sort(byRatingDesc)
      .slice(0, 12);
    if (fallbackCores.length > 0) {
      rows = [
        {
          spec: {
            id: "watersport_fallback_core",
            title: "Underwater-ready cameras",
          },
          products: fallbackCores,
        },
      ];
    }
  }
  if (rows.length === 0 && audioFirst) {
    const fallbackAudioCores = catalog
      .filter((product) => {
        if (product.isBundle && !isAudioPrimaryProduct(product)) return false;
        if (isDroneLikeCore(product)) return false;
        return isAudioPrimaryProduct(product);
      })
      .sort(byRatingDesc)
      .slice(0, 12);
    if (fallbackAudioCores.length > 0) {
      rows = [
        {
          spec: {
            id: "audio_fallback_core",
            title: "Podcast and interview audio gear",
          },
          products: fallbackAudioCores,
        },
      ];
    }
  }

  if (rows.length === 0) {
    return {
      ...baseEmpty,
      detectedActivities,
      ...pickHero(trimmed, detectedActivities),
    };
  }

  /* Resolve the active activity hierarchy (if any) once — used for
   * (a) flagship row override, (b) core-pool exclusion filtering,
   * (c) accessory-bundle exclusion filtering further down. When no
   * hierarchy applies, every helper is a no-op so legacy behaviour
   * is preserved. */
  const activityHierarchy = pickActivityHierarchy(detectedActivities);

  /* Core pool. Hierarchy-aware:
   *  1. PREFER a row whose products match the L1 primary filter.
   *     The hierarchy explicitly specifies whether the primary IS
   *     an accessory-class product (mic_*, gimbal_*, etc.) — for
   *     mic-led activities like podcast / interview / livestream
   *     / concert / theatre we MUST allow `isAccessory=true`
   *     products to seed the core pool, since DJI mics and gimbals
   *     are tagged `isAccessory=true` in the catalog.
   *  2. Otherwise fall back to the legacy "first row with a
   *     non-accessory" rule (preserves drone/cam-led behaviour
   *     for activities without a hierarchy entry).
   *  3. If even that misses (rare), use the union of every row. */
  const primaryIsAccessoryClass = activityHierarchy
    ? hierarchyPrimaryIsAccessoryClass(activityHierarchy)
    : false;
  let flagshipRow: typeof rows[number] | undefined;
  if (activityHierarchy) {
    flagshipRow = rows.find((row) =>
      row.products.some((p) => {
        if (!matchesPrimaryFilter(p, activityHierarchy)) return false;
        /* Allow accessory-class products through when the L1 IS
         * accessory-class. */
        return primaryIsAccessoryClass ? true : !p.isAccessory;
      }),
    );
  }
  if (!flagshipRow) {
    flagshipRow = rows.find((row) =>
      row.products.some((p) => !p.isAccessory),
    );
  }
  const corePoolSeed: CatalogProduct[] = flagshipRow
    ? primaryIsAccessoryClass
      ? flagshipRow.products
      : flagshipRow.products.filter((p) => !p.isAccessory)
    : rows.flatMap((row) => row.products);
  /* Apply hierarchy exclusions BEFORE the existing audio-first /
   * accessory / bundle filters so a forbidden productType (e.g. a
   * drone in a paragliding kit) is removed even if it would have
   * otherwise survived the audio-first branch. */
  const exclusionFilteredSeed = applyHierarchyExclusions(
    corePoolSeed,
    activityHierarchy,
  );
  let corePool: CatalogProduct[] = exclusionFilteredSeed.filter((product) => {
    if (audioFirst && isAudioPrimaryProduct(product) && !isDroneLikeCore(product)) return true;
    /* When the activity's L1 primary is accessory-class (mic-led,
     * gimbal-led activities), we must keep `isAccessory=true` /
     * `isBundle=true` products in the core pool — they ARE the
     * core. The L1 `allowBundles: true` hint in the hierarchy is
     * the explicit opt-in. */
    if (primaryIsAccessoryClass && activityHierarchy) {
      const allowBundles = activityHierarchy.primary.allowBundles ?? false;
      if (product.isBundle && !allowBundles) return false;
      return matchesPrimaryFilter(product, activityHierarchy);
    }
    return !product.isAccessory && !product.isBundle;
  });
  if (corePool.length === 0 && hasWatersportSignal(activityConstraints.activities, trimmed)) {
    corePool = catalog
      .filter((product) => {
        if (product.isAccessory || product.isBundle) return false;
        if (product.category === "action_camera") return true;
        if (product.useCaseTags.includes("underwater")) return true;
        if (product.useCaseTags.includes("waterproof")) return true;
        return /action|osmo/i.test(product.title);
      })
      .sort(byRatingDesc)
      .slice(0, 12);
    corePool = applyHierarchyExclusions(corePool, activityHierarchy);
  }
  if (corePool.length === 0 && audioFirst) {
    corePool = catalog
      .filter((product) => {
        if (!isAudioPrimaryProduct(product) && (product.isAccessory || product.isBundle)) return false;
        if (isDroneLikeCore(product)) return false;
        return isAudioPrimaryProduct(product);
      })
      .sort(byRatingDesc)
      .slice(0, 12);
    corePool = applyHierarchyExclusions(corePool, activityHierarchy);
  }
  if (corePool.length === 0) {
    /* Final-fallback core pool. Hierarchy-aware: if a hierarchy
     * exists, narrow to products that match the L1 primary filter
     * before applying the rating sort. This way a paragliding kit
     * never falls back to a drone-led pool just because the recipe
     * row resolution came up dry. Accessory-class L1 activities
     * (mic-led, gimbal-led) keep their `isAccessory=true` /
     * `isBundle=true` products provided the hierarchy explicitly
     * opts in via `primary.allowBundles`. */
    const hierarchyMatches = activityHierarchy
      ? catalog.filter((p) => {
          if (!matchesPrimaryFilter(p, activityHierarchy)) return false;
          if (primaryIsAccessoryClass) {
            const allowBundles = activityHierarchy.primary.allowBundles ?? false;
            if (p.isBundle && !allowBundles) return false;
            return true;
          }
          return !p.isAccessory && !p.isBundle;
        })
      : [];
    if (hierarchyMatches.length > 0) {
      corePool = hierarchyMatches.sort(byRatingDesc).slice(0, 12);
    } else {
      corePool = catalog
        .filter((product) => !product.isAccessory && !product.isBundle)
        .sort(byRatingDesc)
        .slice(0, 12);
      corePool = applyHierarchyExclusions(corePool, activityHierarchy);
    }
  }

  const uniqueCorePool = [...new Map(corePool.map((p) => [p.slug, p])).values()];
  const rankedCoresPre =
    waveActivities.length > 0
      ? enforceAndRankActivityFit(uniqueCorePool, trimmed, activityConstraints)
      : [...uniqueCorePool].sort(byRatingDesc);
  const rankedCoresMidAudio =
    audioFirst
      ? rankedCoresPre.filter((product) => !isDroneLikeCore(product))
      : rankedCoresPre;
  /* One final exclusions pass on the fully-ranked list. The
   * `applyHierarchyExclusions` helper is idempotent so this is safe
   * even when the seed was already filtered — and it catches any
   * stragglers that slipped in via the audio-first or watersport
   * fallbacks above. */
  const rankedCoresRaw = applyHierarchyExclusions(rankedCoresMidAudio, activityHierarchy);
  const rankedCores = rankedCoresRaw.length > 0 ? rankedCoresRaw : [...uniqueCorePool].sort(byRatingDesc);

  const byTier = {
    beginner: rankedCores.filter((p) => p.tier === "beginner"),
    intermediate: rankedCores.filter((p) => p.tier === "intermediate"),
    pro: rankedCores.filter((p) => p.tier === "pro"),
    other: rankedCores.filter(
      (p) => p.tier !== "beginner" && p.tier !== "intermediate" && p.tier !== "pro",
    ),
  };
  const accessorySupplyCache = new Map<string, number>();
  const accessorySupplyForCore = (core: CatalogProduct): number => {
    const cached = accessorySupplyCache.get(core.slug);
    if (cached !== undefined) return cached;
    const strict = findAccessoriesFor(core, catalog, {
      limit: 12,
      requireModelMatch: true,
    }).length;
    const broad =
      strict > 0
        ? strict
        : findAccessoriesFor(core, catalog, {
            limit: 12,
          }).length;
    const score = Math.max(strict, broad);
    accessorySupplyCache.set(core.slug, score);
    return score;
  };
  const chosen = new Set<string>();
  const takeFirstDistinct = (
    candidates: CatalogProduct[],
    minAccessories: number,
  ): CatalogProduct | null => {
    for (const candidate of candidates) {
      if (chosen.has(candidate.slug)) continue;
      if (accessorySupplyForCore(candidate) < minAccessories) continue;
      chosen.add(candidate.slug);
      return candidate;
    }
    for (const candidate of candidates) {
      if (chosen.has(candidate.slug)) continue;
      chosen.add(candidate.slug);
      return candidate;
    }
    return null;
  };

  const budgetCore =
    takeFirstDistinct([
      ...byTier.beginner,
      ...byTier.intermediate,
      ...byTier.pro,
      ...byTier.other,
    ], TIER_TOTAL_MIN.budget - 1) ?? null;
  const idealCore =
    takeFirstDistinct([
      ...byTier.intermediate,
      ...byTier.beginner,
      ...byTier.pro,
      ...byTier.other,
    ], TIER_TOTAL_MIN.ideal - 1) ?? null;
  const topCore =
    takeFirstDistinct([
      ...byTier.pro,
      ...byTier.intermediate,
      ...byTier.beginner,
      ...byTier.other,
    ], TIER_TOTAL_MIN.top - 1) ?? null;

  const fallbackCore =
    budgetCore ?? idealCore ?? topCore ?? rankedCores[0] ?? uniqueCorePool[0] ?? null;

  const combos: Combo[] = [];
  const orderedSelections: Array<[WingmanComboTier, CatalogProduct | null]> = [
    ["budget", budgetCore ?? fallbackCore],
    ["ideal", idealCore ?? fallbackCore],
    ["top", topCore ?? fallbackCore],
  ];

  for (const [id, core] of orderedSelections) {
    if (!core) continue;
    const displayedCores: CatalogProduct[] = [core];
    const bundle = buildAccessoryBundle(core, catalog, BUNDLE_MAX_BY_TIER[id]);
    const constrained =
      waveActivities.length > 0
        ? enforceAndRankActivityFit(bundle, trimmed, activityConstraints)
        : bundle;
    const withAerialFallbacks = injectAerialMountFallbacks(
      core,
      catalog,
      constrained,
      activityConstraints.activities,
      BUNDLE_MAX_BY_TIER[id],
    );
    const withWhitewaterFallbacks = injectWhitewaterMountFallbacks(
      core,
      catalog,
      withAerialFallbacks,
      activityConstraints.activities,
      BUNDLE_MAX_BY_TIER[id],
    );
    const withWatersportCases = injectWatersportCaseFallbacks(
      core,
      catalog,
      withWhitewaterFallbacks,
      activityConstraints.activities,
      trimmed,
      BUNDLE_MAX_BY_TIER[id],
    );
    const revalidated =
      waveActivities.length > 0
        ? enforceAndRankActivityFit(withWatersportCases, trimmed, activityConstraints)
        : withWatersportCases;
    const aerialPrioritized = prioritizeAerialMountAccessories(revalidated, activityConstraints.activities);
    const whitewaterPrioritized = prioritizeWhitewaterMountAccessories(
      aerialPrioritized,
      activityConstraints.activities,
    );
    const compatibleOnly = filterAccessoriesByDisplayedCores(
      whitewaterPrioritized,
      displayedCores,
    );
    const accessories = refillStrictCompatibleAccessories(
      compatibleOnly,
      displayedCores,
      catalog,
      BUNDLE_MAX_BY_TIER[id],
    );
    const caseGuaranteed = ensureWatersportCaseSlot(
      accessories,
      core,
      catalog,
      activityConstraints.activities,
      trimmed,
      BUNDLE_MAX_BY_TIER[id],
    );
    /* Hierarchy-aware tier filter: drops L2 enhancers not allowed
     * at this tier (e.g. wireless mic on a budget paragliding kit
     * when the L2 entry only permits ideal/top) and sorts the
     * remaining accessories by L3 priority so the size cap below
     * keeps the right ones. No-op when no hierarchy applies. */
    const tierFiltered = applyHierarchyTierFilter(
      caseGuaranteed,
      activityHierarchy,
      id,
    );
    const sizeNormalized = normalizeTierAccessoryCount(
      tierFiltered,
      core,
      catalog,
      id,
    );
    const tierSizedRaw = audioFirst
      ? ensureAudioFirstBundleSize(sizeNormalized, core, catalog, id)
      : sizeNormalized;
    /* Final hierarchy-exclusion pass on accessories. Catches any
     * forbidden subtype/productType that slipped through the bundler
     * (e.g. a `mount_handlebar` that gets pulled in for a paragliding
     * kit because the broader compatibility check approved it). */
    const exclusionFiltered = applyHierarchyExclusions(
      tierSizedRaw,
      activityHierarchy,
    );
    /* Final slot-diversity pass: drops same-L3-slot duplicates that
     * the refill step in `normalizeTierAccessoryCount` may have
     * pulled in via `findAccessoriesFor` (which is slot-blind). The
     * kit ends up with at most ONE product per L3 entry — fewer
     * accessories total when the catalog can't supply diversity, but
     * never three selfie sticks in a hiking pro kit. */
    const tierSizedAccessories = enforceSlotDiversity(
      exclusionFiltered,
      activityHierarchy,
    );
    const totalPrice =
      (core.price ?? 0) +
      tierSizedAccessories.reduce((sum, accessory) => sum + (accessory.price ?? 0), 0);
    const copy = COMBO_COPY[id];
    combos.push({
      id,
      label: copy.label,
      tagline: copy.tagline,
      badgeTone: copy.badgeTone,
      core,
      accessories: tierSizedAccessories,
      totalPrice,
    });
  }

  const categories: CategoryAccordion[] = rows.map((row) => ({
    id: row.spec.id,
    title: row.spec.title,
    subtitle: subtitleFor(row.spec.title),
    thumbnailUrl: row.products[0]?.imageUrl,
    products: row.products,
  }));

  /* Dataset override. When the query maps to a training-dataset
   * activity AND every tier resolves to a real catalog core, the
   * dataset-driven combos replace the hierarchy combos as the
   * routing authority. The hierarchy combos above still ran (cheap,
   * pure) and remain the fallback when the dataset can't resolve.
   * Category accordions + hero copy are kept from the existing
   * pipeline. */
  const datasetMatch = detectDatasetActivity(trimmed);
  const datasetResult = datasetMatch ? buildDatasetCombos(datasetMatch, catalog) : null;
  const finalCombos = datasetResult ? datasetResult.combos : combos;
  const activitySummary = datasetResult?.activitySummary;

  return {
    headline: buildHeroHeadline(trimmed, audioFirst, detectedActivities),
    rawQuery: trimmed,
    ...pickHero(trimmed, detectedActivities),
    detectedActivities,
    combos: finalCombos,
    categories,
    activitySummary,
    hasResults:
      finalCombos.length > 0 && (categories.length > 0 || datasetResult !== null),
  };
}

/* ---------- Price formatting ----------
 *
 * The catalog already exports a USD-formatted price string per
 * product, but combo totals are computed in this module so we mint a
 * matching formatter here. Kept as a module-level Intl instance so
 * we don't allocate one per render.
 */

const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export function formatPriceUsd(priceCents: number): string {
  return usdFormatter.format(Math.max(0, Math.round(priceCents)));
}
