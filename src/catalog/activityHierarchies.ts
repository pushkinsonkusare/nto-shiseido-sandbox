/* =============================================================
 * Activity-driven recommendation hierarchy.
 *
 * Single source of truth for "what does an X kit look like" — used
 * by every Wingman / Sidecar / SideBySide flow that needs to pick a
 * core SKU and supporting accessories for a detected activity.
 *
 * Structure (3 levels):
 *
 *   Level 1 — Primary capture device (REQUIRED)
 *     The kit's flagship. Sets the productType the deterministic
 *     planner anchors on. For paragliding this is action_camera;
 *     for a wedding it's drone_cinema. There is exactly one L1.
 *
 *   Level 2 — DJI ecosystem enhancers (PREFERRED, tier-aware)
 *     Cross-sell candidates that meaningfully extend the kit
 *     (mics, gimbals, second body, FPV components). Each entry can
 *     opt out of cheaper tiers via `tiers` so we don't push a
 *     $250 mic into the $400 budget kit.
 *
 *   Level 3 — Activity-specific accessories (FALLBACK)
 *     Mounts, batteries, cases, filters that fill remaining slots.
 *     Order = priority — higher entries get picked first when there
 *     are more candidates than slots.
 *
 *   Exclusions
 *     Hard "never include" rules. Kills the long-standing footgun
 *     where paragliding kits picked drones because the catalog
 *     ranking happened to surface a high-rated drone.
 *
 * Tier inclusion (default):
 *   budget — L1 + 2 of L3
 *   ideal  — L1 + 1 of L2 + 3 of L3
 *   top    — L1 + up to 3 of L2 + 4 of L3
 *
 * The 22 hierarchies below mirror the activities that
 * `extractActivitiesFromQuery` (broadRecipes.ts) detects from a
 * shopper query. Adding an activity to that detector REQUIRES a
 * matching hierarchy here — otherwise the planner falls back to the
 * legacy `ACTIVITY_ROW_TEMPLATES` literal.
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

/** Filter spec used at every level — narrows the live catalog down
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
  /** Whether the row should pull bundles (Fly More / Combo SKUs).
   *  Defaults false; mic rows usually want true. */
  allowBundles?: boolean;
};

/** Level 2 enhancer — same shape as a `CategoryFilter` plus a tier
 *  allowlist. When `tiers` is omitted it defaults to
 *  `["ideal", "top"]` (skip in budget). */
export type SecondaryEnhancer = CategoryFilter & {
  tiers?: Tier[];
};

/** Level 3 accessory — `CategoryFilter` plus an optional explicit
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
  /** L1 — required flagship. The core SKU comes from this filter. */
  primary: CategoryFilter;
  /** L2 — preferred enhancers, tier-aware. Order = priority. */
  secondary: SecondaryEnhancer[];
  /** L3 — accessory candidates. Order = priority. */
  accessories: AccessoryHint[];
  /** Hard "never include" rules. */
  exclusions?: ActivityExclusions;
  /** Tier of the L1 core that the planner should prefer when the
   *  catalog has multiple matches. Most kits prefer beginner core
   *  for budget, intermediate for ideal, pro for top — but a few
   *  activities (e.g. professional_filmmaker) skew pro at every
   *  tier. Defaults to undefined → standard ladder. */
  tierBias?: Partial<Record<Tier, ProductTier[]>>;
};

/* ---------- The 22 activity hierarchies ----------
 *
 * Activity ids match `ACTIVITY_KEYWORD_PATTERNS` in
 * `src/components/SideBySideAssistant/conversation/broadRecipes.ts`.
 *
 * Why each L1 was chosen:
 *  - Body-mounted aerial (paragliding, base_jumping, skydiving) → action camera
 *    Pilots ARE the subject; a drone is impractical and often restricted.
 *  - Watersports (surfing, scuba, snorkeling) → waterproof action camera
 *    Drones are water-incompatible; mics are useless underwater.
 *  - Travel / family / vlog / beginner → pocket camera
 *    Pocket cams are the sweet spot for casual creator workflows.
 *  - Audio-first (podcast, interview, livestream, news, concert,
 *    theatre) → wireless mic. The headline product IS the mic.
 *  - Aerial cinema (wedding, real_estate, professional_filmmaker)
 *    → cinema drone. The shoot is fundamentally aerial.
 *  - Phone photography → phone gimbal. The phone is the camera.
 * ----------------------------------------------------------- */

export const ACTIVITY_HIERARCHIES: Record<string, ActivityHierarchy> = {
  /* ---------- Body-mounted aerial sports ---------- */
  paragliding: {
    primary: {
      categoryToken: "action camera",
      subtypes: ["cam_action"],
      titleExcludeAny: ["Adventure", "Fly More"],
    },
    secondary: [
      {
        categoryToken: "microphone",
        subtypes: ["mic_wireless"],
        allowBundles: true,
        tiers: ["ideal", "top"],
      },
      {
        categoryToken: "pocket camera",
        subtypes: ["cam_pocket"],
        tiers: ["top"],
      },
    ],
    accessories: [
      { categoryToken: "mount", subtypes: ["mount_helmet"], accessoryRole: "mounting" },
      { categoryToken: "mount", subtypes: ["mount_chest"], accessoryRole: "mounting" },
      { categoryToken: "mount", subtypes: ["mount_extension"], accessoryRole: "mounting" },
      { categoryToken: "battery", subtypes: ["acc_battery"], accessoryRole: "power" },
      { categoryToken: "case", subtypes: ["acc_case"], accessoryRole: "storage" },
    ],
    exclusions: {
      productTypes: ["drone"],
      subtypes: ["mount_handlebar"],
    },
  },

  /* ---------- Snow sports ---------- */
  skiing_snowboarding: {
    primary: {
      categoryToken: "action camera",
      subtypes: ["cam_action"],
      titleExcludeAny: ["Adventure", "Fly More"],
    },
    secondary: [
      {
        categoryToken: "4k drones",
        subtypes: ["drone_compact"],
        titleExcludeAny: ["Combo", "Fly More"],
        tiers: ["top"],
      },
      {
        categoryToken: "microphone",
        subtypes: ["mic_wireless"],
        allowBundles: true,
        tiers: ["ideal", "top"],
      },
    ],
    accessories: [
      { categoryToken: "mount", subtypes: ["mount_helmet"], accessoryRole: "mounting" },
      { categoryToken: "mount", subtypes: ["mount_chest"], accessoryRole: "mounting" },
      { categoryToken: "mount", subtypes: ["mount_extension"], accessoryRole: "mounting" },
      { categoryToken: "battery", subtypes: ["acc_battery"], accessoryRole: "power" },
      { categoryToken: "case", subtypes: ["acc_case"], accessoryRole: "storage" },
    ],
    exclusions: {
      subtypes: ["mount_handlebar"],
    },
  },

  /* ---------- Surfing ---------- */
  surfing: {
    primary: {
      categoryToken: "action camera",
      subtypes: ["cam_action"],
      capabilities: ["waterproof"],
      titleExcludeAny: ["Adventure", "Fly More"],
    },
    secondary: [],
    accessories: [
      { categoryToken: "mount", subtypes: ["mount_wrist"], accessoryRole: "mounting" },
      { categoryToken: "mount", subtypes: ["mount_chest"], accessoryRole: "mounting" },
      { categoryToken: "mount", subtypes: ["mount_extension"], accessoryRole: "mounting" },
      { categoryToken: "case", subtypes: ["acc_case"], accessoryRole: "storage" },
      { categoryToken: "battery", subtypes: ["acc_battery"], accessoryRole: "power" },
    ],
    exclusions: {
      productTypes: ["drone"],
      subtypes: ["mic_wireless", "mic_lavalier", "mount_handlebar"],
    },
  },

  /* ---------- Watersports / scuba / kayak / sailing ---------- */
  watersports: {
    primary: {
      categoryToken: "action camera",
      subtypes: ["cam_action"],
      capabilities: ["waterproof"],
      titleExcludeAny: ["Adventure", "Fly More"],
    },
    secondary: [],
    accessories: [
      { categoryToken: "case", subtypes: ["acc_case"], capabilities: ["waterproof"], accessoryRole: "storage" },
      { categoryToken: "case", subtypes: ["acc_case"], accessoryRole: "storage" },
      { categoryToken: "mount", subtypes: ["mount_wrist"], accessoryRole: "mounting" },
      { categoryToken: "mount", subtypes: ["mount_extension"], accessoryRole: "mounting" },
      { categoryToken: "battery", subtypes: ["acc_battery"], accessoryRole: "power" },
    ],
    exclusions: {
      productTypes: ["drone"],
      subtypes: ["mic_wireless", "mic_lavalier", "mount_handlebar"],
    },
  },

  /* ---------- Motorsports ---------- */
  motorcycle: {
    primary: {
      categoryToken: "action camera",
      subtypes: ["cam_action"],
      titleExcludeAny: ["Adventure", "Fly More"],
    },
    secondary: [
      {
        categoryToken: "microphone",
        subtypes: ["mic_wireless"],
        allowBundles: true,
        tiers: ["ideal", "top"],
      },
      {
        categoryToken: "4k drones",
        subtypes: ["drone_compact"],
        titleExcludeAny: ["Combo", "Fly More"],
        tiers: ["top"],
      },
    ],
    accessories: [
      { categoryToken: "mount", subtypes: ["mount_helmet"], accessoryRole: "mounting" },
      { categoryToken: "mount", subtypes: ["mount_handlebar"], accessoryRole: "mounting" },
      { categoryToken: "mount", subtypes: ["mount_chest"], accessoryRole: "mounting" },
      { categoryToken: "mount", subtypes: ["mount_suction"], accessoryRole: "mounting" },
      { categoryToken: "battery", subtypes: ["acc_battery"], accessoryRole: "power" },
    ],
  },

  cycling: {
    primary: {
      categoryToken: "action camera",
      subtypes: ["cam_action"],
      titleExcludeAny: ["Adventure", "Fly More"],
    },
    secondary: [
      {
        categoryToken: "microphone",
        subtypes: ["mic_wireless"],
        allowBundles: true,
        tiers: ["ideal", "top"],
      },
    ],
    accessories: [
      { categoryToken: "mount", subtypes: ["mount_handlebar"], accessoryRole: "mounting" },
      { categoryToken: "mount", subtypes: ["mount_helmet"], accessoryRole: "mounting" },
      { categoryToken: "mount", subtypes: ["mount_chest"], accessoryRole: "mounting" },
      { categoryToken: "battery", subtypes: ["acc_battery"], accessoryRole: "power" },
      { categoryToken: "case", subtypes: ["acc_case"], accessoryRole: "storage" },
    ],
  },

  /* ---------- Hiking / outdoor ---------- */
  hiking_outdoor: {
    primary: {
      categoryToken: "action camera",
      subtypes: ["cam_action"],
      titleExcludeAny: ["Adventure", "Fly More"],
    },
    secondary: [
      {
        categoryToken: "4k drones",
        subtypes: ["drone_compact"],
        titleExcludeAny: ["Combo", "Fly More"],
        tiers: ["ideal", "top"],
      },
      {
        categoryToken: "microphone",
        subtypes: ["mic_wireless"],
        allowBundles: true,
        tiers: ["top"],
      },
    ],
    accessories: [
      { categoryToken: "mount", subtypes: ["mount_chest"], accessoryRole: "mounting" },
      { categoryToken: "mount", subtypes: ["mount_extension"], accessoryRole: "mounting" },
      { categoryToken: "battery", subtypes: ["acc_battery"], accessoryRole: "power" },
      { categoryToken: "case", subtypes: ["acc_case"], accessoryRole: "storage" },
    ],
  },

  /* ---------- Travel ---------- */
  travel: {
    primary: {
      categoryToken: "action camera",
      subtypes: ["cam_pocket"],
    },
    secondary: [
      {
        categoryToken: "4k drones",
        subtypes: ["drone_compact"],
        titleExcludeAny: ["Combo", "Fly More"],
        tiers: ["ideal", "top"],
      },
      {
        categoryToken: "microphone",
        subtypes: ["mic_wireless"],
        allowBundles: true,
        tiers: ["ideal", "top"],
      },
      {
        categoryToken: "gimbal",
        subtypes: ["gimbal_compact"],
        tiers: ["top"],
      },
    ],
    accessories: [
      { categoryToken: "mount", subtypes: ["mount_tripod"], accessoryRole: "mounting" },
      { categoryToken: "mount", subtypes: ["mount_extension"], accessoryRole: "mounting" },
      { categoryToken: "battery", subtypes: ["acc_battery"], accessoryRole: "power" },
      { categoryToken: "case", subtypes: ["acc_case"], accessoryRole: "storage" },
    ],
  },

  /* ---------- Vlog ---------- */
  vlog: {
    primary: {
      categoryToken: "action camera",
      subtypes: ["cam_pocket"],
    },
    secondary: [
      {
        categoryToken: "microphone",
        subtypes: ["mic_wireless"],
        allowBundles: true,
        tiers: ["ideal", "top"],
      },
      {
        categoryToken: "gimbal",
        subtypes: ["gimbal_phone"],
        tiers: ["top"],
      },
    ],
    accessories: [
      { categoryToken: "mount", subtypes: ["mount_tripod"], accessoryRole: "mounting" },
      { categoryToken: "battery", subtypes: ["acc_battery"], accessoryRole: "power" },
      { categoryToken: "mount", subtypes: ["mount_extension"], accessoryRole: "mounting" },
    ],
  },

  /* ---------- Audio-first ---------- */
  podcast: {
    primary: {
      categoryToken: "microphone",
      subtypes: ["mic_wireless"],
      allowBundles: true,
    },
    secondary: [
      {
        categoryToken: "microphone",
        subtypes: ["mic_lavalier"],
        tiers: ["ideal", "top"],
      },
    ],
    accessories: [
      { categoryToken: "mount", subtypes: ["mount_tripod"], accessoryRole: "mounting" },
      { categoryToken: "microphone", subtypes: ["mic_windscreen"] },
      { categoryToken: "battery", subtypes: ["acc_battery"], accessoryRole: "power" },
    ],
    exclusions: {
      productTypes: ["drone"],
      subtypes: ["cam_action"],
    },
  },

  interview: {
    primary: {
      categoryToken: "microphone",
      subtypes: ["mic_wireless"],
      allowBundles: true,
    },
    secondary: [
      {
        categoryToken: "microphone",
        subtypes: ["mic_lavalier"],
        tiers: ["ideal", "top"],
      },
      {
        categoryToken: "action camera",
        subtypes: ["cam_pocket"],
        tiers: ["top"],
      },
    ],
    accessories: [
      { categoryToken: "mount", subtypes: ["mount_tripod"], accessoryRole: "mounting" },
      { categoryToken: "battery", subtypes: ["acc_battery"], accessoryRole: "power" },
    ],
  },

  livestream: {
    primary: {
      categoryToken: "microphone",
      subtypes: ["mic_wireless"],
      allowBundles: true,
    },
    secondary: [
      {
        categoryToken: "gimbal",
        subtypes: ["gimbal_phone"],
        tiers: ["ideal", "top"],
      },
      {
        categoryToken: "action camera",
        subtypes: ["cam_pocket"],
        tiers: ["top"],
      },
    ],
    accessories: [
      { categoryToken: "mount", subtypes: ["mount_tripod"], accessoryRole: "mounting" },
      { categoryToken: "battery", subtypes: ["acc_battery"], accessoryRole: "power" },
    ],
  },

  /* ---------- Aerial cinema ---------- */
  wedding: {
    primary: {
      categoryToken: "4k drones",
      subtypes: ["drone_cinema"],
      titleExcludeAny: ["Combo", "Fly More"],
    },
    secondary: [
      {
        categoryToken: "gimbal",
        subtypes: ["gimbal_camera"],
        tiers: ["ideal", "top"],
      },
      {
        categoryToken: "microphone",
        subtypes: ["mic_wireless"],
        allowBundles: true,
        tiers: ["ideal", "top"],
      },
    ],
    accessories: [
      { categoryToken: "lens filter", subtypes: ["acc_filter_nd"], accessoryRole: "visual_enhancement" },
      { categoryToken: "battery", subtypes: ["acc_battery"], accessoryRole: "power" },
      { categoryToken: "case", subtypes: ["acc_case"], accessoryRole: "storage" },
    ],
  },

  real_estate_aerial: {
    /* L1 filter intentionally omits the `drone_cinema` subtype lock.
     * Real-estate listings are typically shot with whatever pro
     * drone the realtor owns — Mavic / Air / Mini Pro are all fair
     * game. The category lock keeps it drone-anchored; tier
     * laddering naturally surfaces Inspire 3 at top when available. */
    primary: {
      categoryToken: "4k drones",
      titleExcludeAny: ["Combo", "Fly More"],
    },
    secondary: [
      {
        categoryToken: "lens",
        subtypes: ["acc_lens_wide"],
        tiers: ["ideal", "top"],
      },
      {
        categoryToken: "lens filter",
        subtypes: ["acc_filter_nd"],
        tiers: ["ideal", "top"],
      },
    ],
    accessories: [
      { categoryToken: "battery", subtypes: ["acc_battery"], accessoryRole: "power" },
      { categoryToken: "case", subtypes: ["acc_case"], accessoryRole: "storage" },
    ],
  },

  /* ---------- News / events ---------- */
  news_journalism: {
    primary: {
      categoryToken: "microphone",
      subtypes: ["mic_wireless"],
      allowBundles: true,
    },
    secondary: [
      {
        categoryToken: "action camera",
        subtypes: ["cam_pocket"],
        tiers: ["ideal", "top"],
      },
      {
        categoryToken: "gimbal",
        subtypes: ["gimbal_phone"],
        tiers: ["top"],
      },
    ],
    accessories: [
      { categoryToken: "mount", subtypes: ["mount_tripod"], accessoryRole: "mounting" },
      { categoryToken: "battery", subtypes: ["acc_battery"], accessoryRole: "power" },
    ],
  },

  concert_event: {
    primary: {
      categoryToken: "microphone",
      subtypes: ["mic_wireless"],
      allowBundles: true,
    },
    secondary: [
      {
        categoryToken: "gimbal",
        subtypes: ["gimbal_camera"],
        tiers: ["ideal", "top"],
      },
    ],
    accessories: [
      { categoryToken: "mount", subtypes: ["mount_tripod"], accessoryRole: "mounting" },
      { categoryToken: "battery", subtypes: ["acc_battery"], accessoryRole: "power" },
    ],
    exclusions: {
      productTypes: ["drone"],
    },
  },

  theatre: {
    primary: {
      categoryToken: "microphone",
      subtypes: ["mic_wireless"],
      allowBundles: true,
    },
    secondary: [
      {
        categoryToken: "gimbal",
        subtypes: ["gimbal_camera"],
        tiers: ["ideal", "top"],
      },
    ],
    accessories: [
      { categoryToken: "mount", subtypes: ["mount_tripod"], accessoryRole: "mounting" },
    ],
    exclusions: {
      productTypes: ["drone"],
      subtypes: ["cam_action"],
    },
  },

  /* ---------- Indoor sports ---------- */
  indoor_sports: {
    primary: {
      categoryToken: "action camera",
      subtypes: ["cam_action"],
      titleExcludeAny: ["Adventure", "Fly More"],
    },
    secondary: [
      {
        categoryToken: "4k drones",
        subtypes: ["drone_fpv"],
        tiers: ["top"],
      },
      {
        categoryToken: "gimbal",
        subtypes: ["gimbal_phone"],
        tiers: ["ideal", "top"],
      },
    ],
    accessories: [
      { categoryToken: "mount", subtypes: ["mount_helmet"], accessoryRole: "mounting" },
      { categoryToken: "mount", subtypes: ["mount_chest"], accessoryRole: "mounting" },
      { categoryToken: "battery", subtypes: ["acc_battery"], accessoryRole: "power" },
    ],
  },

  /* ---------- Casual / family / beginner ---------- */
  family: {
    primary: {
      categoryToken: "action camera",
      subtypes: ["cam_pocket"],
    },
    secondary: [
      {
        categoryToken: "gimbal",
        subtypes: ["gimbal_phone"],
        tiers: ["ideal", "top"],
      },
      {
        categoryToken: "4k drones",
        subtypes: ["drone_compact"],
        titleExcludeAny: ["Combo", "Fly More"],
        tiers: ["top"],
      },
    ],
    accessories: [
      { categoryToken: "mount", subtypes: ["mount_tripod"], accessoryRole: "mounting" },
      { categoryToken: "battery", subtypes: ["acc_battery"], accessoryRole: "power" },
    ],
  },

  beginner_creator: {
    primary: {
      categoryToken: "action camera",
      subtypes: ["cam_pocket"],
    },
    secondary: [
      {
        categoryToken: "4k drones",
        subtypes: ["drone_compact"],
        titleExcludeAny: ["Combo", "Fly More"],
        tiers: ["ideal", "top"],
      },
      {
        categoryToken: "gimbal",
        subtypes: ["gimbal_phone"],
        tiers: ["ideal", "top"],
      },
      {
        categoryToken: "microphone",
        subtypes: ["mic_wireless"],
        allowBundles: true,
        tiers: ["top"],
      },
    ],
    accessories: [
      { categoryToken: "mount", subtypes: ["mount_tripod"], accessoryRole: "mounting" },
      { categoryToken: "battery", subtypes: ["acc_battery"], accessoryRole: "power" },
    ],
  },

  /* ---------- Pro filmmaking ---------- */
  professional_filmmaker: {
    /* L1 filter intentionally omits the `drone_cinema` subtype lock.
     * Pro filmmakers buy a compact pro drone (Mini Pro, Air Pro)
     * for B-roll alongside their cinema rig, so we keep the L1
     * permissive on subtype and let `tierBias` surface cinema
     * drones at the top tier when the catalog has them. */
    primary: {
      categoryToken: "4k drones",
      titleExcludeAny: ["Combo", "Fly More"],
    },
    secondary: [
      {
        categoryToken: "gimbal",
        subtypes: ["gimbal_camera"],
        tiers: ["ideal", "top"],
      },
      {
        categoryToken: "microphone",
        subtypes: ["mic_wireless"],
        allowBundles: true,
        tiers: ["ideal", "top"],
      },
    ],
    accessories: [
      { categoryToken: "lens filter", subtypes: ["acc_filter_nd"], accessoryRole: "visual_enhancement" },
      { categoryToken: "battery", subtypes: ["acc_battery"], accessoryRole: "power" },
      { categoryToken: "case", subtypes: ["acc_case"], accessoryRole: "storage" },
    ],
    /* Pro filmmakers buy pro gear at every tier — bias the ladder
     * toward `pro` cores even for "budget". Better to show a
     * cheaper pro drone than a beginner one. */
    tierBias: {
      budget: ["intermediate", "pro"],
      ideal: ["pro", "intermediate"],
      top: ["pro"],
    },
  },

  /* ---------- Phone-first creators ---------- */
  phone_photography: {
    primary: {
      categoryToken: "gimbal",
      subtypes: ["gimbal_phone"],
    },
    secondary: [
      {
        categoryToken: "microphone",
        subtypes: ["mic_wireless"],
        allowBundles: true,
        tiers: ["ideal", "top"],
      },
    ],
    accessories: [
      { categoryToken: "mount", subtypes: ["mount_clamp"], accessoryRole: "mounting" },
      { categoryToken: "mount", subtypes: ["mount_magnetic"], accessoryRole: "mounting" },
      { categoryToken: "lens filter", subtypes: ["acc_filter_nd"], accessoryRole: "visual_enhancement" },
      { categoryToken: "mount", subtypes: ["mount_tripod"], accessoryRole: "mounting" },
    ],
    exclusions: {
      productTypes: ["drone"],
    },
  },
};

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

/* =============================================================
 * Cross-system alignment validator
 *
 * `activityProfiles.ts` carries a separate set of disallowed
 * subtypes / accessory roles / title tokens that drive the wave-2
 * `enforceAndRankActivityFit` pass. Where an activity exists in
 * BOTH systems with the same id (e.g. `paragliding`,
 * `phone_photography`), the disallowed lists should be a subset of
 * each other so the planner doesn't accept-then-reject the same
 * product across the two passes.
 *
 * `validateActivityHierarchyAlignment` is a dev-time guard: it
 * walks every hierarchy id, looks for a matching profile, and
 * reports drift. Invoked once at module load when `import.meta.env.DEV`
 * so misconfigurations surface in the dev console immediately.
 * Production builds skip the check entirely.
 * ============================================================= */

import { ACTIVITY_PROFILES } from "./activityProfiles";

type AlignmentMismatch = {
  activity: string;
  field: "subtypes";
  inHierarchyOnly: string[];
  inProfileOnly: string[];
};

export function validateActivityHierarchyAlignment(): AlignmentMismatch[] {
  const mismatches: AlignmentMismatch[] = [];
  const profilesById = new Map(ACTIVITY_PROFILES.map((p) => [p.id, p]));
  for (const [activityId, hierarchy] of Object.entries(ACTIVITY_HIERARCHIES)) {
    const profile = profilesById.get(activityId as never);
    if (!profile) continue;
    const hierarchySubtypes = new Set<string>(hierarchy.exclusions?.subtypes ?? []);
    const profileSubtypes = new Set<string>(profile.disallowedSubtypes ?? []);
    const inHierarchyOnly: string[] = [];
    const inProfileOnly: string[] = [];
    for (const s of hierarchySubtypes) {
      if (!profileSubtypes.has(s)) inHierarchyOnly.push(s);
    }
    for (const s of profileSubtypes) {
      if (!hierarchySubtypes.has(s)) inProfileOnly.push(s);
    }
    if (inHierarchyOnly.length > 0 || inProfileOnly.length > 0) {
      mismatches.push({
        activity: activityId,
        field: "subtypes",
        inHierarchyOnly,
        inProfileOnly,
      });
    }
  }
  return mismatches;
}

if (import.meta.env.DEV) {
  const mismatches = validateActivityHierarchyAlignment();
  if (mismatches.length > 0) {
    /* Single grouped warn so the dev console gets one entry, not
     * one per drifted activity. The data structure is preserved so
     * an engineer can expand the array to see what diverged. */
    // eslint-disable-next-line no-console
    console.warn(
      "[activityHierarchies] disallowedSubtypes drift between hierarchy.exclusions and ACTIVITY_PROFILES:",
      mismatches,
    );
  }
}
