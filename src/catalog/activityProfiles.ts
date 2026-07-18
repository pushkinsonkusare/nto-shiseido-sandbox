import type { AccessoryRole, CatalogProduct } from "./catalog";

export type ActivityId =
  | "scuba_diving_snorkeling"
  | "road_cycling"
  | "mountain_biking"
  | "moto_vlogging"
  | "motocross"
  | "trail_running_ultra"
  | "paragliding"
  | "base_jumping"
  | "freediving"
  | "sailing"
  | "whitewater_rafting"
  | "kayak_fishing"
  | "gym_fitness_creator"
  | "documentary_filmmaking"
  | "live_event_multicam"
  | "phone_photography";

type ActivityProfile = {
  id: ActivityId;
  keywords: RegExp[];
  preferredPrimaryActivities?: string[];
  preferredUseCaseTags?: string[];
  preferredSubtypes?: string[];
  preferredAccessoryRoles?: AccessoryRole[];
  disallowedSubtypes?: string[];
  disallowedAccessoryRoles?: AccessoryRole[];
  disallowedTitleTokens?: string[];
};

export type ActivityConstraints = {
  activities: ActivityId[];
  preferredPrimaryActivities: string[];
  preferredUseCaseTags: string[];
  preferredSubtypes: string[];
  preferredAccessoryRoles: AccessoryRole[];
  disallowedSubtypes: string[];
  disallowedAccessoryRoles: AccessoryRole[];
  disallowedTitleTokens: string[];
};

/* Exported for the hierarchy-alignment validator in
 * `activityHierarchies.ts`. Read-only — do not mutate. */
export const ACTIVITY_PROFILES: ActivityProfile[] = [
  {
    id: "scuba_diving_snorkeling",
    keywords: [
      /\b(scuba|scuba\s*div\w*|diving|snorkel\w*|underwater|reef|free\s*div\w*)\b/i,
    ],
    preferredPrimaryActivities: ["watersports", "surfing"],
    preferredUseCaseTags: ["waterproof", "underwater"],
    preferredSubtypes: ["cam_action", "acc_case", "acc_filter_nd", "mount_wrist"],
    preferredAccessoryRoles: ["storage", "visual_enhancement", "power"],
    disallowedSubtypes: ["mount_handlebar", "mount_helmet", "mic_transmitter"],
    disallowedAccessoryRoles: ["mounting"],
    disallowedTitleTokens: ["handlebar", "bike", "motorcycle", "transmitter"],
  },
  {
    id: "road_cycling",
    keywords: [/\b(road\s*cycl\w*|cycling|road\s*bike|peloton)\b/i],
    preferredPrimaryActivities: ["cycling"],
    preferredUseCaseTags: ["sports", "rugged", "stabilized"],
    preferredSubtypes: ["cam_action", "mount_handlebar", "mount_chest", "acc_battery"],
    preferredAccessoryRoles: ["mounting", "power"],
    disallowedSubtypes: ["acc_case"],
    disallowedTitleTokens: ["underwater", "scuba"],
  },
  {
    id: "mountain_biking",
    keywords: [/\b(mountain\s*bik\w*|mtb|trail\s*bik\w*|downhill|enduro)\b/i],
    preferredPrimaryActivities: ["cycling", "hiking_outdoor"],
    preferredUseCaseTags: ["sports", "rugged", "stabilized"],
    preferredSubtypes: ["cam_action", "mount_helmet", "mount_chest", "acc_case"],
    preferredAccessoryRoles: ["mounting", "storage", "power"],
    disallowedTitleTokens: ["underwater", "scuba"],
  },
  {
    id: "moto_vlogging",
    keywords: [/\b(moto\s*vlog\w*|motorcycle\s*vlog\w*|motovlog\w*|rider\s*pov)\b/i],
    preferredPrimaryActivities: ["motorcycle", "vlog"],
    preferredUseCaseTags: ["vlogging", "rugged", "sports"],
    preferredSubtypes: ["cam_action", "mic_wireless", "mount_helmet"],
    preferredAccessoryRoles: ["mounting", "power"],
    disallowedTitleTokens: ["underwater", "scuba", "handlebar mount for bikes"],
  },
  {
    id: "motocross",
    keywords: [/\b(motocross|mx|dirt\s*bike)\b/i],
    preferredPrimaryActivities: ["motorcycle"],
    preferredUseCaseTags: ["sports", "rugged", "stabilized"],
    preferredSubtypes: ["cam_action", "mount_helmet", "mount_chest", "acc_case"],
    preferredAccessoryRoles: ["mounting", "power", "storage"],
    disallowedTitleTokens: ["underwater", "scuba"],
  },
  {
    id: "trail_running_ultra",
    keywords: [
      /\b(trail\s*run\w*|ultra\s*run\w*|ultramarathon|mountain\s*run\w*|hik\w*|trek\w*|backpack\w*|camp\w*)\b/i,
    ],
    preferredPrimaryActivities: ["hiking_outdoor", "travel"],
    preferredUseCaseTags: ["sports", "compact", "rugged"],
    preferredSubtypes: ["cam_action", "mount_chest", "acc_case"],
    preferredAccessoryRoles: ["mounting", "power"],
    disallowedSubtypes: ["mount_handlebar"],
    disallowedTitleTokens: ["underwater", "scuba", "handlebar", "bike", "motorcycle"],
  },
  {
    id: "paragliding",
    keywords: [/\b(paraglid\w*|canopy\s*flight|ridge\s*soaring)\b/i],
    preferredPrimaryActivities: ["hiking_outdoor", "travel"],
    preferredUseCaseTags: ["compact", "sports", "rugged", "stabilized"],
    preferredSubtypes: ["cam_action", "mount_helmet", "mount_chest", "acc_case"],
    preferredAccessoryRoles: ["mounting", "power", "storage"],
    disallowedSubtypes: ["mount_handlebar"],
    disallowedTitleTokens: ["underwater", "scuba", "handlebar", "bike", "motorcycle"],
  },
  {
    id: "base_jumping",
    keywords: [/\b(base\s*jump\w*|wingsuit\w*|cliff\s*jump\w*|skydiv\w*|skydive\w*)\b/i],
    preferredPrimaryActivities: ["hiking_outdoor"],
    preferredUseCaseTags: ["compact", "sports", "rugged", "stabilized"],
    preferredSubtypes: ["cam_action", "mount_helmet", "mount_chest", "acc_case"],
    preferredAccessoryRoles: ["mounting", "power", "storage"],
    disallowedSubtypes: ["mount_handlebar"],
    disallowedTitleTokens: ["underwater", "scuba", "handlebar", "bike", "motorcycle"],
  },
  {
    id: "freediving",
    keywords: [/\b(free\s*div\w*|apnea\s*div\w*)\b/i],
    preferredPrimaryActivities: ["watersports"],
    preferredUseCaseTags: ["waterproof", "underwater"],
    preferredSubtypes: ["cam_action", "acc_case", "mount_wrist"],
    preferredAccessoryRoles: ["storage", "power"],
    disallowedSubtypes: ["mount_handlebar", "mount_helmet", "mic_transmitter"],
    disallowedAccessoryRoles: ["mounting"],
    disallowedTitleTokens: ["bike", "motorcycle", "transmitter"],
  },
  {
    id: "sailing",
    keywords: [/\b(sail\w*|yacht\w*|boat\s*trip|offshore)\b/i],
    preferredPrimaryActivities: ["watersports", "travel"],
    preferredUseCaseTags: ["waterproof", "rugged", "wind_resistant"],
    preferredSubtypes: ["cam_action", "acc_case", "acc_filter_nd"],
    preferredAccessoryRoles: ["storage", "visual_enhancement", "power"],
    disallowedTitleTokens: ["handlebar", "dirt bike"],
  },
  {
    id: "whitewater_rafting",
    keywords: [/\b(whitewater|rafting|river\s*rapid\w*|rapids)\b/i],
    preferredPrimaryActivities: ["watersports"],
    preferredUseCaseTags: ["waterproof", "rugged", "sports"],
    preferredSubtypes: ["cam_action", "mount_chest", "mount_wrist", "acc_case"],
    preferredAccessoryRoles: ["mounting", "storage", "power"],
    disallowedSubtypes: [
      "mount_handlebar",
      "mount_magnetic",
      "mount_clamp",
      "mount_extension",
      "mount_tripod",
    ],
    disallowedTitleTokens: ["handlebar", "motorcycle", "selfie", "ball joint", "clamp"],
  },
  {
    id: "kayak_fishing",
    keywords: [/\b(kayak\s*fishing|kayak|angler|fishing\s*trip)\b/i],
    preferredPrimaryActivities: ["watersports", "travel"],
    preferredUseCaseTags: ["waterproof", "rugged", "compact"],
    preferredSubtypes: ["cam_action", "mount_chest", "acc_case"],
    preferredAccessoryRoles: ["mounting", "storage", "power"],
    disallowedTitleTokens: ["handlebar", "motocross"],
  },
  {
    id: "gym_fitness_creator",
    keywords: [/\b(gym|fitness\s*creator|workout\s*vlog\w*|crossfit|hyrox)\b/i],
    preferredPrimaryActivities: ["indoor_sports", "vlog"],
    preferredUseCaseTags: ["vlogging", "stabilized", "compact"],
    preferredSubtypes: ["cam_pocket", "cam_action", "mic_wireless", "gimbal_phone"],
    preferredAccessoryRoles: ["power", "mounting"],
    disallowedTitleTokens: ["underwater", "scuba", "propeller"],
  },
  {
    id: "documentary_filmmaking",
    keywords: [/\b(documentary|docu\s*film\w*|run\s*and\s*gun|field\s*story)\b/i],
    preferredPrimaryActivities: ["professional_filmmaker", "news_journalism"],
    preferredUseCaseTags: ["cinematic", "stabilized", "vlogging"],
    preferredSubtypes: ["drone_cinema", "gimbal_camera", "mic_wireless", "acc_filter_nd"],
    preferredAccessoryRoles: ["visual_enhancement", "power"],
    disallowedTitleTokens: ["motocross", "handlebar mount"],
  },
  {
    id: "live_event_multicam",
    keywords: [/\b(live\s*event|multi\s*cam|multicam|stage\s*show|conference\s*capture)\b/i],
    preferredPrimaryActivities: ["concert_event", "theatre", "livestream"],
    preferredUseCaseTags: ["vlogging", "stabilized", "lowlight"],
    preferredSubtypes: ["mic_wireless", "gimbal_camera", "cam_pocket", "acc_battery"],
    preferredAccessoryRoles: ["power", "storage"],
    disallowedTitleTokens: ["underwater", "dirt bike", "motocross"],
  },
  {
    /* Phone-creator wave activity — narrow ranking layer that mirrors
     * the `phone_photography` broad-recipe routing. The broad recipe
     * already chooses Mobile gimbals as the core via the flagship
     * row, so this profile's job is mostly defensive: bias accessory
     * ranking toward phone-relevant subtypes (clamps, ND filters,
     * wireless mics) and hard-exclude drone SKUs that might slip
     * through a compatibility relaxation.
     *
     * Keyword pattern mirrors the broad-recipe routing:
     *   - Bare `iphone` / `smartphone` always count (no ambiguity on
     *     a DJI commerce site — these are explicit phone signals).
     *   - Bare `phone` / `mobile` / `android` must pair with a
     *     creator modifier so we don't disallow drones in queries
     *     like "mobile drone documentary" where "mobile" is just an
     *     adjective on a drone kit.
     *   - Specific phrases like "phone photography" / "mobile video"
     *     catch the obvious natural-language framings. */
    id: "phone_photography",
    keywords: [
      /\b(iphone|smartphone)\b|\b(phone|mobile|android)\s+(photo\w*|video\w*|filmmak\w*|cinematograph\w*|creator|shoot\w*|content|gimbal|vlog\w*|stream\w*|record\w*)\b|\bphone\s*photography\b|\bmobile\s*(photo\w*|video\w*)\b/i,
    ],
    preferredPrimaryActivities: ["vlog", "family", "indoor_sports", "travel"],
    preferredUseCaseTags: ["vlogging", "stabilized", "compact"],
    preferredSubtypes: [
      "gimbal_phone",
      "mount_magnetic",
      "mount_clamp",
      "mount_tripod",
      "acc_filter_nd",
      "mic_wireless",
    ],
    preferredAccessoryRoles: ["mounting", "visual_enhancement", "power"],
    disallowedSubtypes: ["drone_cinema", "drone_fpv", "drone_compact", "drone_selfie"],
    disallowedAccessoryRoles: ["fpv_component"],
    disallowedTitleTokens: [
      "drone",
      "inspire",
      "mavic",
      "avata",
      "propeller",
      "flight battery",
    ],
  },
];

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

export function detectActivitiesFromQuery(query: string, limit = 3): ActivityId[] {
  const out: ActivityId[] = [];
  for (const profile of ACTIVITY_PROFILES) {
    if (profile.keywords.some((pattern) => pattern.test(query))) {
      out.push(profile.id);
      if (out.length >= limit) break;
    }
  }
  return out;
}

export function buildActivityConstraints(activities: ActivityId[]): ActivityConstraints {
  const picked = ACTIVITY_PROFILES.filter((p) => activities.includes(p.id));
  return {
    activities: unique(picked.map((p) => p.id)),
    preferredPrimaryActivities: unique(
      picked.flatMap((p) => p.preferredPrimaryActivities ?? []),
    ),
    preferredUseCaseTags: unique(picked.flatMap((p) => p.preferredUseCaseTags ?? [])),
    preferredSubtypes: unique(picked.flatMap((p) => p.preferredSubtypes ?? [])),
    preferredAccessoryRoles: unique(
      picked.flatMap((p) => p.preferredAccessoryRoles ?? []),
    ) as AccessoryRole[],
    disallowedSubtypes: unique(picked.flatMap((p) => p.disallowedSubtypes ?? [])),
    disallowedAccessoryRoles: unique(
      picked.flatMap((p) => p.disallowedAccessoryRoles ?? []),
    ) as AccessoryRole[],
    disallowedTitleTokens: unique(picked.flatMap((p) => p.disallowedTitleTokens ?? [])),
  };
}

function explicitlyRequested(query: string, token: string): boolean {
  const normalized = token.trim().toLowerCase();
  if (!normalized) return false;
  return query.toLowerCase().includes(normalized);
}

function isHardExcluded(
  product: CatalogProduct,
  constraints: ActivityConstraints,
  query: string,
): boolean {
  if (
    constraints.disallowedAccessoryRoles.includes(
      (product.accessoryRole ?? "general") as AccessoryRole,
    )
  ) {
    const role = (product.accessoryRole ?? "").toLowerCase();
    if (!explicitlyRequested(query, role)) return true;
  }
  if (
    product.subtypes.some((s) => constraints.disallowedSubtypes.includes(s)) &&
    !product.subtypes.some((s) => explicitlyRequested(query, s))
  ) {
    return true;
  }
  const titleLower = product.title.toLowerCase();
  if (
    constraints.disallowedTitleTokens.some(
      (token) => titleLower.includes(token.toLowerCase()) && !explicitlyRequested(query, token),
    )
  ) {
    return true;
  }
  return false;
}

function activityScore(product: CatalogProduct, constraints: ActivityConstraints): number {
  let score = 0;
  if (
    constraints.preferredPrimaryActivities.length > 0 &&
    product.primaryActivities.some((activity) =>
      constraints.preferredPrimaryActivities.includes(activity),
    )
  ) {
    score += 3;
  }
  if (
    constraints.preferredUseCaseTags.length > 0 &&
    product.useCaseTags.some((tag) => constraints.preferredUseCaseTags.includes(tag))
  ) {
    score += 3;
  }
  if (
    constraints.preferredSubtypes.length > 0 &&
    product.subtypes.some((subtype) => constraints.preferredSubtypes.includes(subtype))
  ) {
    score += 2;
  }
  if (
    product.accessoryRole &&
    constraints.preferredAccessoryRoles.includes(product.accessoryRole)
  ) {
    score += 2;
  }
  return score;
}

export function enforceAndRankActivityFit(
  products: CatalogProduct[],
  query: string,
  constraints: ActivityConstraints,
): CatalogProduct[] {
  const filtered = products.filter((product) => !isHardExcluded(product, constraints, query));
  return [...filtered].sort((a, b) => activityScore(b, constraints) - activityScore(a, constraints));
}

