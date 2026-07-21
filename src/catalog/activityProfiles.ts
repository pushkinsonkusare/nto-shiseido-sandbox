import type { AccessoryRole, CatalogProduct } from "./catalog";

/* =============================================================
 * Activity profiles (neutralised for the skincare catalog).
 *
 * The original prototype matched free-text activity queries (e.g.
 * "gear for mountain biking") to curated product constraints. The
 * skincare storefront routes shopper intent through category /
 * concern / skin-type signals instead (see `flow.ts` and the
 * side-by-side `GOAL_LED_RECIPES`), so there are no activity
 * profiles to match.
 *
 * The exports below are retained as inert no-ops so existing callers
 * in `flow.ts` and `activityHierarchies.ts` keep compiling without a
 * wider refactor: `detectActivitiesFromQuery` always returns `[]`,
 * `buildActivityConstraints` yields empty constraints, and
 * `enforceAndRankActivityFit` passes products through unchanged.
 * ============================================================= */

/** Free-text activity id. No fixed taxonomy for the skincare catalog. */
export type ActivityId = string;

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
 * `activityHierarchies.ts`. Empty for the skincare catalog. */
export const ACTIVITY_PROFILES: ActivityProfile[] = [];

export function detectActivitiesFromQuery(
  _query: string,
  _limit = 3,
): ActivityId[] {
  return [];
}

export function buildActivityConstraints(
  activities: ActivityId[],
): ActivityConstraints {
  return {
    activities,
    preferredPrimaryActivities: [],
    preferredUseCaseTags: [],
    preferredSubtypes: [],
    preferredAccessoryRoles: [],
    disallowedSubtypes: [],
    disallowedAccessoryRoles: [],
    disallowedTitleTokens: [],
  };
}

export function enforceAndRankActivityFit(
  products: CatalogProduct[],
  _query: string,
  _constraints: ActivityConstraints,
): CatalogProduct[] {
  // No activity constraints for skincare — return products untouched.
  return products;
}
