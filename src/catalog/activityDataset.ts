/* =============================================================
 * Activity training dataset — routing ground-truth.
 *
 * Sourced from the DJI agent training dataset (.xlsx), transcribed
 * into `activityDataset.generated.ts` by
 * `scripts/build-activity-dataset.mjs`. This module wraps the raw
 * rows with types, a query -> activity detector, and accessors.
 *
 * The dataset is the AUTHORITY for:
 *   - which product FAMILY an activity routes to (Drone/Action/Pocket)
 *   - which PRODUCT within that family each skill rung gets
 *   - the SECONDARY product (mostly Audio)
 *
 * The 3 UI kit tabs map to 3 of the 4 skill rungs:
 *   Cost Effective <- Beginner / Low
 *   Ideal          <- Creator  / High
 *   Pro            <- Professional / Premium
 * (Enthusiast / Medium is intentionally dropped.)
 * ============================================================= */

import { ACTIVITY_DATASET_ROWS } from "./activityDataset.generated";

export type DatasetEnvironment =
  | "Outdoor"
  | "Air"
  | "Water"
  | "Sports"
  | "Travel"
  | "Creator"
  | "Commercial";

export type SkillLevel = "Beginner" | "Enthusiast" | "Creator" | "Professional";

export type BudgetTier = "Low" | "Medium" | "High" | "Premium";

export type PrimaryFamily = "Drone" | "Action" | "Pocket";

export type SecondaryFamily = "Audio" | "Action" | "Drone" | "Pocket" | "";

/** One row of the training dataset = (activity, skill) pairing. */
export type ActivityDatasetRow = {
  activity: string;
  environment: DatasetEnvironment;
  skillLevel: SkillLevel;
  budgetTier: BudgetTier;
  primaryFamily: PrimaryFamily;
  recommendedProduct: string;
  secondaryFamily: SecondaryFamily;
  secondaryProduct: string;
  accessoryCategories: string;
  costEffectiveKit: string;
  idealKit: string;
  proKit: string;
};

/** The three UI tabs and the skill rung each maps to. */
export type DatasetTier = "budget" | "ideal" | "top";

export const TIER_TO_SKILL: Record<DatasetTier, SkillLevel> = {
  budget: "Beginner",
  ideal: "Creator",
  top: "Professional",
};

/* ---------- Indexing ---------- */

/** activity (lower-cased) -> rows for that activity, keyed by skill. */
const ROWS_BY_ACTIVITY = new Map<string, Map<SkillLevel, ActivityDatasetRow>>();
for (const row of ACTIVITY_DATASET_ROWS) {
  const key = row.activity.toLowerCase();
  let bySkill = ROWS_BY_ACTIVITY.get(key);
  if (!bySkill) {
    bySkill = new Map();
    ROWS_BY_ACTIVITY.set(key, bySkill);
  }
  bySkill.set(row.skillLevel, row);
}

/** All distinct activity display names, in dataset order. */
export const DATASET_ACTIVITIES: string[] = (() => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of ACTIVITY_DATASET_ROWS) {
    if (!seen.has(row.activity)) {
      seen.add(row.activity);
      out.push(row.activity);
    }
  }
  return out;
})();

/** Return the row for a given activity + skill rung, or null. */
export function getDatasetRow(
  activity: string,
  skill: SkillLevel,
): ActivityDatasetRow | null {
  return ROWS_BY_ACTIVITY.get(activity.toLowerCase())?.get(skill) ?? null;
}

/** Return all 4 skill rows for an activity, or null when unknown. */
export function getDatasetRows(activity: string): ActivityDatasetRow[] | null {
  const bySkill = ROWS_BY_ACTIVITY.get(activity.toLowerCase());
  if (!bySkill) return null;
  return [...bySkill.values()];
}

/** Return the 3 rows that back the UI tabs (Beginner/Creator/Professional). */
export function getTierRows(
  activity: string,
): Record<DatasetTier, ActivityDatasetRow> | null {
  const budget = getDatasetRow(activity, TIER_TO_SKILL.budget);
  const ideal = getDatasetRow(activity, TIER_TO_SKILL.ideal);
  const top = getDatasetRow(activity, TIER_TO_SKILL.top);
  if (!budget || !ideal || !top) return null;
  return { budget, ideal, top };
}

/* ---------- Query -> activity detection ----------
 *
 * Keyword patterns mapping free-text queries onto the 29 dataset
 * activities. Order matters — more specific activities first so a
 * compound query ("mountain biking trip") hits `Mountain Biking`
 * before the generic `Road Trip`. The first match wins.
 *
 * Each pattern intentionally errs toward precision: a miss falls
 * through to the legacy hierarchy planner, which is a safe default.
 */
const ACTIVITY_PATTERNS: Array<{ activity: string; test: RegExp }> = [
  /* Order matters — first match wins. Physical-activity environments
   * (Commercial, Air, Water, Sports, Outdoor) are checked BEFORE the
   * generic Creator `vlog` pattern so a query like "moto vlogging"
   * routes to Motorcycle Touring (Action + helmet/handlebar mounts +
   * mic), NOT Travel Vlogging (pocket + drone). Explicit Creator
   * intents (podcast/youtube/wedding/product review) don't share
   * keywords with the physical activities, so they still resolve
   * correctly from their later position. */

  // Commercial (specific phrases before generic drone/real-estate)
  { activity: "Construction Inspection", test: /\b(construction|site\s*inspect\w*|infrastructure\s*inspect\w*|building\s*inspect\w*)\b/i },
  { activity: "Property Marketing", test: /\b(property\s*market\w*|listing\s*video|property\s*video|real\s*estate\s*market\w*)\b/i },
  { activity: "Real Estate", test: /\b(real\s*estate|property\s*tour|home\s*tour|property\s*photo\w*)\b/i },

  // Air
  { activity: "Paragliding", test: /\b(paraglid\w*|canopy\s*flight|ridge\s*soaring)\b/i },
  { activity: "Skydiving", test: /\b(skydiv\w*|skydive\w*|freefall|tandem\s*jump)\b/i },
  { activity: "Hang Gliding", test: /\b(hang\s*glid\w*)\b/i },

  // Water
  { activity: "Scuba Diving", test: /\b(scuba|deep\s*div\w*|dive\s*trip|diving)\b/i },
  { activity: "Snorkeling", test: /\b(snorkel\w*|reef\s*shoot\w*)\b/i },
  { activity: "Surfing", test: /\b(surf\w*|paddleboard\w*|bodyboard\w*)\b/i },
  { activity: "Kayaking", test: /\b(kayak\w*|canoe\w*|paddling)\b/i },
  { activity: "Fishing", test: /\b(fish\w*|angling|kayak\s*fish\w*)\b/i },

  // Sports — checked before the generic `vlog` pattern so
  // "moto vlogging", "mtb vlog", "ski edit" win their sport.
  { activity: "Motorcycle Touring", test: /\b(moto(?:rcycle|rbike)?\s*(?:tour\w*|vlog\w*|trip|riding|ride)?|motorbike|motorcycl\w*|\brider\b)\b/i },
  { activity: "Mountain Biking", test: /\b(mountain\s*bik\w*|mtb|downhill\s*bik\w*|trail\s*bik\w*)\b/i },
  { activity: "Road Cycling", test: /\b(road\s*cycl\w*|road\s*bik\w*|cycl(?:e|ing|ist)|bicycl\w*|peloton)\b/i },
  { activity: "Skiing", test: /\b(ski(?:ing)?|alpine\s*ski\w*)\b/i },
  { activity: "Snowboarding", test: /\b(snowboard\w*|snow\s*board\w*)\b/i },

  // Outdoor
  { activity: "Wildlife Safari", test: /\b(safari|wildlife|animal\s*photo\w*|nature\s*reserve)\b/i },
  { activity: "Bird Watching", test: /\b(bird\s*watch\w*|birding|ornitholog\w*)\b/i },
  { activity: "Backpacking", test: /\b(backpack\w*|thru\s*hik\w*|multi\s*day\s*hik\w*)\b/i },
  { activity: "Camping", test: /\b(camp\w*|campsite|glamping)\b/i },
  { activity: "Hiking", test: /\b(hik\w*|trek\w*|trail|wilderness|mountaineer\w*)\b/i },

  // Creator (explicit intents; the broad `vlog` term sits last here so
  // sport-specific vlogging already routed above)
  { activity: "Podcast Creator", test: /\b(podcast\w*|radio\s*show)\b/i },
  { activity: "Product Reviews", test: /\b(product\s*review\w*|unboxing|review\s*channel|tech\s*review\w*)\b/i },
  { activity: "Wedding Creator", test: /\b(wedding\w*|bridal|engagement|elopement)\b/i },
  { activity: "YouTube Creator", test: /\b(youtub\w*|content\s*creat\w*|streamer|twitch|tiktok\w*|reels?|influencer)\b/i },
  { activity: "Travel Vlogging", test: /\b(travel\s*vlog\w*|vlog\w*|travel\s*diary)\b/i },

  // Travel (generic — checked late so specific travel sub-types win)
  { activity: "Road Trip", test: /\b(road\s*trip|roadtrip|drive\s*trip|cross\s*country\s*drive)\b/i },
  { activity: "Family Vacation", test: /\b(family\s*vacation|family\s*holiday|family\s*trip|vacation\s*with\s*(?:my\s*)?(?:kids|family))\b/i },
  { activity: "City Exploration", test: /\b(city\s*explor\w*|city\s*tour|city\s*break|urban\s*explor\w*|sightsee\w*|walking\s*tour)\b/i },
];

export type DatasetMatch = {
  activity: string;
  environment: DatasetEnvironment;
};

/**
 * Detect the dataset activity for a free-text query. Returns the
 * matched activity + its environment, or null when nothing matches
 * (caller falls back to the legacy hierarchy planner).
 */
export function detectDatasetActivity(
  query: string | null | undefined,
): DatasetMatch | null {
  const trimmed = (query ?? "").trim();
  if (!trimmed) return null;
  for (const { activity, test } of ACTIVITY_PATTERNS) {
    if (test.test(trimmed)) {
      const row = getDatasetRow(activity, "Beginner");
      if (row) return { activity, environment: row.environment };
    }
  }
  return null;
}

export { ACTIVITY_DATASET_ROWS };
