/* =============================================================
 * Per-category PLP drill-down facet config
 *
 * When the shopper has narrowed to a single top-level category
 * (e.g. "4K drones"), the sidebar swaps the cross-category
 * "Shop by Category" multi-select for category-specific facets
 * — drone series, drone subtype, tier, and activity. The facet
 * tokens map 1:1 onto v6 catalog fields, so the existing per-
 * product filter pipeline picks them up without any extra
 * plumbing.
 *
 * Lookup is substring-tolerant (case-insensitive) on the active
 * category name so "Action cameras" and "Action camera" both
 * resolve. Categories without a config (e.g. "Camera batteries",
 * "Lens filters") fall back to today's cross-category sidebar.
 * ============================================================= */

export type FacetParamKey =
  | "series"
  | "subtypes"
  | "tier"
  | "primaryActivities";

export type FacetSpec = {
  /** Display title for the sidebar group (e.g. "Drone series"). */
  title: string;
  /** Sidebar interaction kind. */
  kind: "single-select" | "multi-select";
  /**
   * Which active-state list and URL param this facet drives. Maps
   * directly onto the `NavigateOptions` field of the same name.
   */
  paramKey: FacetParamKey;
  /**
   * Selectable rows. `value` is the raw v6 token (e.g. `mavic`,
   * `drone_compact`, `wedding`). `label` is the friendly display
   * string. The PLP filter pipeline only cares about `value`; the
   * sidebar UI only cares about `label`.
   */
  options: { label: string; value: string }[];
};

/**
 * Drilled-in facet config keyed by lowercased category substring.
 * Keys are matched as substrings against the active category so
 * minor naming drift ("Action camera" vs "Action cameras") doesn't
 * break the lookup.
 *
 * Drone key is `drones` (plural) rather than `4k drones` so it
 * resolves both the top-nav `category: "Drones"` value (siteContent's
 * broader nickname) AND the catalog's canonical `4K drones`. Plural
 * keeps it from leaking into singular siblings like "Drone
 * accessories" or "Drone batteries".
 */
const CATEGORY_FACETS: Record<string, FacetSpec[]> = {
  drones: [
    {
      title: "Drone series",
      kind: "multi-select",
      paramKey: "series",
      options: [
        { label: "Mavic", value: "mavic" },
        { label: "Air", value: "air" },
        { label: "Mini", value: "mini" },
        { label: "Avata", value: "avata" },
        { label: "Neo", value: "neo" },
        { label: "Inspire", value: "inspire" },
        { label: "Matrice", value: "matrice" },
      ],
    },
    {
      title: "Drone type",
      kind: "multi-select",
      paramKey: "subtypes",
      options: [
        { label: "Compact", value: "drone_compact" },
        { label: "Cinema", value: "drone_cinema" },
        { label: "FPV", value: "drone_fpv" },
        { label: "Selfie", value: "drone_selfie" },
        { label: "Racing", value: "drone_racing" },
        { label: "Enterprise", value: "drone_enterprise" },
      ],
    },
    {
      title: "Tier",
      kind: "single-select",
      paramKey: "tier",
      options: [
        { label: "Beginner", value: "beginner" },
        { label: "Intermediate", value: "intermediate" },
        { label: "Pro", value: "pro" },
      ],
    },
    {
      title: "Use case",
      kind: "multi-select",
      paramKey: "primaryActivities",
      options: [
        { label: "Travel", value: "travel" },
        { label: "Aerial / Real estate", value: "real_estate_aerial" },
        { label: "Wedding", value: "wedding" },
        { label: "Professional film", value: "professional_filmmaker" },
      ],
    },
  ],
  "action camera": [
    {
      title: "Camera series",
      kind: "multi-select",
      paramKey: "series",
      options: [
        { label: "Osmo Action", value: "osmo_action" },
        { label: "Osmo Pocket", value: "osmo_pocket" },
        { label: "Osmo 360", value: "osmo_360" },
        { label: "Osmo Nano", value: "osmo_nano" },
      ],
    },
    {
      title: "Camera type",
      kind: "multi-select",
      paramKey: "subtypes",
      options: [
        { label: "Action", value: "cam_action" },
        { label: "Pocket", value: "cam_pocket" },
        { label: "360", value: "cam_360" },
        { label: "Nano", value: "cam_nano" },
      ],
    },
    {
      title: "Tier",
      kind: "single-select",
      paramKey: "tier",
      options: [
        { label: "Beginner", value: "beginner" },
        { label: "Intermediate", value: "intermediate" },
        { label: "Pro", value: "pro" },
      ],
    },
    {
      title: "Use case",
      kind: "multi-select",
      paramKey: "primaryActivities",
      options: [
        { label: "Vlog", value: "vlog" },
        { label: "Travel", value: "travel" },
        { label: "Motorcycle", value: "motorcycle" },
        { label: "Skiing / Snowboard", value: "skiing_snowboarding" },
        { label: "Surfing", value: "surfing" },
        { label: "Wedding", value: "wedding" },
      ],
    },
  ],
  microphone: [
    {
      title: "Mic type",
      kind: "multi-select",
      paramKey: "subtypes",
      options: [
        { label: "Wireless", value: "mic_wireless" },
        { label: "Lavalier", value: "mic_lavalier" },
        { label: "Phone adapter", value: "mic_phone_adapter" },
        { label: "Receiver", value: "mic_receiver" },
        { label: "Transmitter", value: "mic_transmitter" },
      ],
    },
    {
      title: "Series",
      kind: "multi-select",
      paramKey: "series",
      options: [{ label: "DJI Mic", value: "dji_mic" }],
    },
    {
      title: "Use case",
      kind: "multi-select",
      paramKey: "primaryActivities",
      options: [
        { label: "Vlog", value: "vlog" },
        { label: "Podcast", value: "podcast" },
        { label: "Interview", value: "interview" },
        { label: "Livestream", value: "livestream" },
      ],
    },
  ],
  gimbal: [
    {
      title: "Gimbal type",
      kind: "multi-select",
      paramKey: "subtypes",
      options: [
        { label: "Phone gimbal", value: "gimbal_phone" },
        { label: "Camera gimbal", value: "gimbal_camera" },
        { label: "Compact", value: "gimbal_compact" },
      ],
    },
    {
      title: "Series",
      kind: "multi-select",
      paramKey: "series",
      options: [
        { label: "Osmo Mobile", value: "osmo_mobile" },
        { label: "Ronin RS", value: "ronin_rs" },
      ],
    },
    {
      title: "Tier",
      kind: "single-select",
      paramKey: "tier",
      options: [
        { label: "Beginner", value: "beginner" },
        { label: "Intermediate", value: "intermediate" },
        { label: "Pro", value: "pro" },
      ],
    },
    {
      title: "Use case",
      kind: "multi-select",
      paramKey: "primaryActivities",
      options: [
        { label: "Vlog", value: "vlog" },
        { label: "Wedding", value: "wedding" },
        { label: "Professional film", value: "professional_filmmaker" },
      ],
    },
  ],
  mount: [
    {
      title: "Mount type",
      kind: "multi-select",
      paramKey: "subtypes",
      options: [
        { label: "Helmet", value: "mount_helmet" },
        { label: "Handlebar", value: "mount_handlebar" },
        { label: "Suction cup", value: "mount_suction" },
        { label: "Chest", value: "mount_chest" },
        { label: "Wrist", value: "mount_wrist" },
        { label: "Tripod", value: "mount_tripod" },
      ],
    },
    {
      title: "Use case",
      kind: "multi-select",
      paramKey: "primaryActivities",
      options: [
        { label: "Motorcycle", value: "motorcycle" },
        { label: "Cycling", value: "cycling" },
        { label: "Skiing / Snowboard", value: "skiing_snowboarding" },
        { label: "Surfing", value: "surfing" },
      ],
    },
  ],
};

/**
 * Priority order for substring matching, walked top-down. Accessory
 * keys (`mount`, `microphone`) come first so a category like
 * "Action camera mounts" routes to the mount facets instead of being
 * caught by the broader "action camera" key. Flagship keys come last.
 */
const FACET_LOOKUP_ORDER: readonly string[] = [
  "mount",
  "microphone",
  "gimbal",
  "drones",
  "action camera",
];

/**
 * Resolve the per-category facet config for a category name.
 * Substring + case-insensitive match in priority order so accessory
 * keys win over flagship keys, and so single nicknames like "Drones"
 * (top-nav) and the catalog's canonical "4K drones" both resolve to
 * the drone facets.
 *
 * Returns null when the category isn't a known drill-down target —
 * caller should fall back to the cross-category sidebar.
 */
export function getCategoryFacets(category: string | null | undefined): FacetSpec[] | null {
  if (!category) return null;
  const needle = category.trim().toLowerCase();
  if (!needle) return null;
  for (const key of FACET_LOOKUP_ORDER) {
    if (needle.includes(key) && CATEGORY_FACETS[key]) {
      return CATEGORY_FACETS[key];
    }
  }
  return null;
}

/**
 * Friendly capitalisation for a v6 series token. Used by the heading
 * suffix builder so URLs like `?series=osmo_action` render as
 * "Osmo Action" in the page header rather than `osmo_action`.
 */
export function formatSeriesLabel(value: string): string {
  // Quick lookup against the canonical option labels — keeps the
  // output in lockstep with the sidebar UI.
  for (const facets of Object.values(CATEGORY_FACETS)) {
    for (const facet of facets) {
      if (facet.paramKey !== "series") continue;
      const hit = facet.options.find((o) => o.value === value);
      if (hit) return hit.label;
    }
  }
  return value
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Friendly capitalisation for a v6 primary-activity token. Same
 * lookup pattern as `formatSeriesLabel` so heading suffix labels
 * read identically to the sidebar option labels.
 */
export function formatActivityLabel(value: string): string {
  for (const facets of Object.values(CATEGORY_FACETS)) {
    for (const facet of facets) {
      if (facet.paramKey !== "primaryActivities") continue;
      const hit = facet.options.find((o) => o.value === value);
      if (hit) return hit.label;
    }
  }
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
