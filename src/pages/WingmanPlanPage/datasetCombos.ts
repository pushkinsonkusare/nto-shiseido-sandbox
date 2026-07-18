/* =============================================================
 * Dataset-driven combo builder.
 *
 * Turns a detected dataset activity into the three kit combos using
 * the training dataset as routing ground-truth:
 *   - core per tier comes from the dataset's per-skill product ladder
 *     (Beginner -> Cost Effective, Creator -> Ideal, Professional -> Pro)
 *   - secondary product comes from the dataset's Secondary column
 *   - accessories fill Mounts/Batteries/Filters/Cases, ordered by an
 *     environment-specific subtype priority, deduped one-per-slot,
 *     with a guaranteed waterproof case for Water activities.
 *
 * Composition per the v2 spec:
 *   Cost Effective: core + 1 accessory (no secondary)
 *   Ideal:          core + 1 secondary + 2 accessories
 *   Pro:            core + 1-2 secondary + 3-4 accessories
 * ============================================================= */

import type { CatalogProduct, ProductSubtype } from "../../catalog/catalog";
import {
  getTierRows,
  type ActivityDatasetRow,
  type DatasetEnvironment,
  type DatasetTier,
  type DatasetMatch,
} from "../../catalog/activityDataset";
import { resolveDatasetProduct } from "../../catalog/resolveDatasetProduct";
import { buildAccessoryBundle } from "../../components/SidecarAssistant/conversation/flow";
import type { Combo, ComboBadgeTone, WingmanComboTier } from "./buildPlan";

/* Per-environment accessory shaping. `subtypeOrder` is the slot
 * priority used for one-per-slot diversity; `requireWaterproofCase`
 * forces a waterproof case into Water kits even when the catalog
 * tags it as a bundle; `excludeSubtypes` / `excludeProductTypes`
 * mirror the activity-hierarchy exclusions. */
type EnvAccessoryProfile = {
  subtypeOrder: ProductSubtype[];
  requireWaterproofCase?: boolean;
  excludeSubtypes?: ProductSubtype[];
  /** Exclude REAL drones (by drone_* subtype) — not productType,
   *  which the catalog mistags on some cases ("Drone Mini Case"). */
  excludeDrones?: boolean;
};

const ENV_ACCESSORY_PROFILE: Record<DatasetEnvironment, EnvAccessoryProfile> = {
  Water: {
    subtypeOrder: ["acc_case", "mount_wrist", "mount_extension", "acc_battery"],
    requireWaterproofCase: true,
    excludeSubtypes: ["mount_handlebar"],
    excludeDrones: true,
  },
  Air: {
    subtypeOrder: ["mount_helmet", "mount_chest", "mount_extension", "acc_battery", "acc_case"],
    excludeSubtypes: ["mount_handlebar"],
  },
  Sports: {
    subtypeOrder: ["mount_helmet", "mount_handlebar", "mount_chest", "acc_battery", "acc_case"],
  },
  Outdoor: {
    // Outdoor routes to a drone core.
    subtypeOrder: ["acc_filter_nd", "acc_battery", "acc_case", "mount_extension"],
  },
  Travel: {
    // Travel routes to a pocket core.
    subtypeOrder: ["mount_tripod", "acc_battery", "acc_case", "mount_extension"],
  },
  Creator: {
    subtypeOrder: ["mount_tripod", "acc_battery", "mic_windscreen", "acc_case"],
  },
  Commercial: {
    // Commercial routes to a drone core.
    subtypeOrder: ["acc_filter_nd", "acc_battery", "acc_case"],
  },
};

/* Accessory + secondary counts per tier (v2 spec composition). */
const TIER_PLAN: Record<
  DatasetTier,
  { accessories: number; secondary: number }
> = {
  budget: { accessories: 1, secondary: 0 },
  ideal: { accessories: 2, secondary: 1 },
  top: { accessories: 4, secondary: 2 },
};

const COMBO_PRESENTATION: Record<
  DatasetTier,
  { label: string; tagline: string; badgeTone: ComboBadgeTone }
> = {
  budget: { label: "Cost Effective Kit", tagline: "BEST VALUE", badgeTone: "green" },
  ideal: { label: "Ideal Kit", tagline: "RECOMMENDED", badgeTone: "blue" },
  top: { label: "Pro Kit", tagline: "TOP OF THE LINE", badgeTone: "purple" },
};

function isWaterproofCase(p: CatalogProduct): boolean {
  return (
    p.subtypes.includes("acc_case") &&
    (p.useCaseTags.includes("waterproof") ||
      p.useCaseTags.includes("underwater") ||
      p.capabilities.includes("waterproof") ||
      p.capabilities.includes("underwater"))
  );
}

/** Loose model-token compatibility: does the accessory name an
 *  overlap with the core's title family? Used only for the
 *  waterproof-case guarantee, where the strict bundle-excluding
 *  accessory pool would have dropped the (bundle-tagged) diving kit. */
function looselyCompatible(accessory: CatalogProduct, core: CatalogProduct): boolean {
  if (accessory.compatibleWithModels.length === 0) return true;
  const coreTitle = core.title.toLowerCase();
  return accessory.compatibleWithModels.some((m) => {
    const tok = m.toLowerCase().replace(/^dji\s+/, "");
    // match on a distinctive token like "osmo action 5" / "osmo action 4"
    return coreTitle.includes(tok) || tok.split(" ").every((w) => coreTitle.includes(w));
  });
}

function primarySubtype(p: CatalogProduct): string | undefined {
  return p.subtypes[0];
}

function isExcluded(p: CatalogProduct, profile: EnvAccessoryProfile): boolean {
  if (profile.excludeDrones && p.subtypes.some((s) => s.startsWith("drone_"))) {
    return true;
  }
  if (profile.excludeSubtypes) {
    for (const s of p.subtypes) {
      if (profile.excludeSubtypes.includes(s as ProductSubtype)) return true;
    }
  }
  return false;
}

/**
 * Select accessories for a dataset combo: env-ordered, one-per-slot,
 * exclusion-filtered, capped to `count`. Guarantees a waterproof
 * case for Water environments.
 */
function selectAccessories(
  core: CatalogProduct,
  catalog: CatalogProduct[],
  env: DatasetEnvironment,
  count: number,
  excludeSlugs: Set<string>,
): CatalogProduct[] {
  if (count <= 0) return [];
  const profile = ENV_ACCESSORY_PROFILE[env];

  /* Compatible accessory pool (excludes bundles by default). */
  const pool = buildAccessoryBundle(core, catalog, 24).filter(
    (p) => !excludeSlugs.has(p.slug) && !isExcluded(p, profile),
  );

  const slotIndex = (p: CatalogProduct): number => {
    const sub = primarySubtype(p);
    if (!sub) return profile.subtypeOrder.length + 1;
    const i = profile.subtypeOrder.indexOf(sub as ProductSubtype);
    return i === -1 ? profile.subtypeOrder.length : i;
  };

  /* Sort by slot priority, then rating. */
  const sorted = [...pool].sort((a, b) => {
    const si = slotIndex(a) - slotIndex(b);
    if (si !== 0) return si;
    return (b.rating ?? 0) - (a.rating ?? 0);
  });

  /* One-per-slot diversity (primary subtype). */
  const chosen: CatalogProduct[] = [];
  const usedSlots = new Set<number>();
  const usedSlugs = new Set<string>(excludeSlugs);
  for (const p of sorted) {
    if (chosen.length >= count) break;
    if (usedSlugs.has(p.slug)) continue;
    const slot = slotIndex(p);
    if (usedSlots.has(slot)) continue;
    chosen.push(p);
    usedSlots.add(slot);
    usedSlugs.add(p.slug);
  }
  /* If still short (thin catalog), backfill ignoring slot diversity. */
  if (chosen.length < count) {
    for (const p of sorted) {
      if (chosen.length >= count) break;
      if (usedSlugs.has(p.slug)) continue;
      chosen.push(p);
      usedSlugs.add(p.slug);
    }
  }

  /* Water guarantee: ensure a waterproof case is present, pulling
   * from the FULL catalog (bundles included) when the strict pool
   * lacked one. Replaces the lowest-priority chosen accessory if the
   * cap is already full. */
  if (profile.requireWaterproofCase && !chosen.some(isWaterproofCase)) {
    const waterproof = catalog
      .filter(
        (p) =>
          isWaterproofCase(p) &&
          !usedSlugs.has(p.slug) &&
          looselyCompatible(p, core),
      )
      .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))[0];
    if (waterproof) {
      if (chosen.length < count) chosen.push(waterproof);
      else chosen[chosen.length - 1] = waterproof;
    }
  }

  return chosen;
}

function priceOf(products: CatalogProduct[]): number {
  return products.reduce((sum, p) => sum + (p.price ?? 0), 0);
}

/* Templated reasoning — overwritten by the LLM when configured. */
function templatedReasoning(
  tier: DatasetTier,
  activity: string,
  core: CatalogProduct,
  secondary: CatalogProduct[],
): string {
  const sec = secondary[0];
  switch (tier) {
    case "budget":
      return `${core.title} is the most cost-effective core for ${activity.toLowerCase()}, paired with one essential accessory to keep the kit lean.`;
    case "ideal":
      return `${core.title}${sec ? ` plus ${sec.title}` : ""} covers ${activity.toLowerCase()} end to end, with two accessories for the situations that matter most.`;
    case "top":
      return `A no-compromise ${activity.toLowerCase()} rig: ${core.title}${sec ? ` with ${sec.title}` : ""} and a full accessory bundle for professional results.`;
  }
}

export type DatasetComboResult = {
  combos: Combo[];
  activitySummary: string;
};

/**
 * Build the three dataset-driven combos for a matched activity.
 * Returns null when the dataset rows can't be resolved to catalog
 * products (caller falls back to the hierarchy planner).
 */
export function buildDatasetCombos(
  match: DatasetMatch,
  catalog: CatalogProduct[],
): DatasetComboResult | null {
  const tierRows = getTierRows(match.activity);
  if (!tierRows) return null;

  const tiers: DatasetTier[] = ["budget", "ideal", "top"];
  const combos: Combo[] = [];

  for (const tier of tiers) {
    const row: ActivityDatasetRow = tierRows[tier];
    const core = resolveDatasetProduct(
      row.recommendedProduct,
      catalog,
      row.primaryFamily,
    );
    if (!core) return null; // can't anchor this tier -> bail to fallback

    const plan = TIER_PLAN[tier];

    /* Secondary products (core-class, mostly Audio). */
    const secondary: CatalogProduct[] = [];
    const excludeSlugs = new Set<string>([core.slug]);
    if (plan.secondary > 0 && row.secondaryProduct && row.secondaryFamily) {
      const sec = resolveDatasetProduct(
        row.secondaryProduct,
        catalog,
        row.secondaryFamily,
      );
      if (sec && sec.slug !== core.slug) {
        secondary.push(sec);
        excludeSlugs.add(sec.slug);
      }
    }

    const accessories = selectAccessories(
      core,
      catalog,
      match.environment,
      plan.accessories,
      excludeSlugs,
    );

    /* Rail = secondary first, then accessories. */
    const rail = [...secondary, ...accessories];
    const present = COMBO_PRESENTATION[tier];

    combos.push({
      id: tier as WingmanComboTier,
      label: present.label,
      tagline: present.tagline,
      badgeTone: present.badgeTone,
      core,
      secondary,
      accessories: rail,
      reasoning: templatedReasoning(tier, match.activity, core, secondary),
      totalPrice: (core.price ?? 0) + priceOf(rail),
    });
  }

  const activitySummary = `For ${match.activity.toLowerCase()}, ${familyNoun(tierRows.ideal.primaryFamily)} is the most useful core. These three kits scale from a cost-effective starter to a no-compromise pro rig.`;

  return { combos, activitySummary };
}

/** Family -> grammatically-correct noun phrase for the summary. */
function familyNoun(family: ActivityDatasetRow["primaryFamily"]): string {
  switch (family) {
    case "Action":
      return "an action camera";
    case "Pocket":
      return "a pocket camera";
    case "Drone":
    default:
      return "a drone";
  }
}
