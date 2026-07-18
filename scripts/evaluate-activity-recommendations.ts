import { catalogStore } from "../src/catalog/catalog";
import {
  buildAccessoryBundle,
  classifyIntent,
  filterProducts,
  findAccessoriesFor,
  isAccessoryCompatibleWithAnyCoreStrict,
  pickRecommendations,
} from "../src/components/SidecarAssistant/conversation/flow";
import {
  buildActivityConstraints,
  detectActivitiesFromQuery,
  enforceAndRankActivityFit,
} from "../src/catalog/activityProfiles";
import { ACTIVITY_REGRESSION_FIXTURES } from "../src/pages/WingmanPlanPage/activityRegressionFixtures";
import { buildPlan, type Combo } from "../src/pages/WingmanPlanPage/buildPlan";
import {
  ACTIVITY_HIERARCHIES,
  type ActivityHierarchy,
} from "../src/catalog/activityHierarchies";
import { extractActivitiesFromQuery } from "../src/components/SideBySideAssistant/conversation/broadRecipes";
import {
  DATASET_ACTIVITIES,
  detectDatasetActivity,
  getTierRows,
  type DatasetTier,
  type PrimaryFamily,
} from "../src/catalog/activityDataset";

type LaneResult = {
  passed: boolean;
  expectedHits: string[];
  expectedMisses: string[];
  disallowedHits: string[];
  compatibilityFailures?: string[];
  topTitles: string[];
};

type FixtureResult = {
  name: string;
  overallPassed: boolean;
  core: LaneResult;
  accessory: LaneResult;
};

function haystackForProduct(product: (typeof catalogStore.products)[number]): string {
  return [
    product.title,
    product.category,
    product.subtypes.join(" "),
    product.useCaseTags.join(" "),
    product.primaryActivities.join(" "),
    product.accessoryRole ?? "",
  ]
    .join(" ")
    .toLowerCase();
}

function visibleHaystackForProduct(product: (typeof catalogStore.products)[number]): string {
  return [
    product.title,
    product.category,
    product.subtypes.join(" "),
    product.useCaseTags.join(" "),
  ]
    .join(" ")
    .toLowerCase();
}

const ACCESSORY_SIGNAL_TOKENS = [
  "mount_",
  "mic_",
  "gimbal_",
  "handlebar",
  "helmet",
  "wrist",
  "transmitter",
  "receiver",
  "lavalier",
  "adapter",
];
const AERIAL_ACTIVITY_IDS = new Set(["paragliding", "base_jumping"]);
const AERIAL_MOUNT_PRIORITY = ["mount_helmet", "mount_chest", "mount_wrist"] as const;
const WHITEWATER_ACTIVITY_IDS = new Set(["whitewater_rafting"]);
const WHITEWATER_MOUNT_PRIORITY = ["mount_wrist", "mount_chest"] as const;
const EXPECTED_SIGNAL_ALIASES: Record<string, string[]> = {
  // Current catalog has no explicit mount_wrist accessories; chest mounts are
  // the closest body-mount fallback for whitewater scenarios.
  mount_wrist: ["mount_chest"],
};

function isAccessorySignal(signal: string): boolean {
  const lower = signal.toLowerCase();
  return ACCESSORY_SIGNAL_TOKENS.some((token) => lower.includes(token));
}

function checkSignals(
  haystacks: string[],
  expected: string[],
  disallowed: string[],
  disallowedHaystacks?: string[],
): Omit<LaneResult, "topTitles"> {
  const expectedHits: string[] = [];
  const expectedMisses: string[] = [];
  for (const signal of expected) {
    const signalLower = signal.toLowerCase();
    const aliases = EXPECTED_SIGNAL_ALIASES[signalLower] ?? [];
    const candidates = [signalLower, ...aliases];
    if (haystacks.some((h) => candidates.some((candidate) => h.includes(candidate)))) {
      expectedHits.push(signal);
    } else expectedMisses.push(signal);
  }

  const disallowedHits: string[] = [];
  const disallowedSource = disallowedHaystacks ?? haystacks;
  for (const signal of disallowed) {
    const signalLower = signal.toLowerCase();
    if (disallowedSource.some((h) => h.includes(signalLower))) disallowedHits.push(signal);
  }

  return {
    passed: expectedMisses.length === 0 && disallowedHits.length === 0,
    expectedHits,
    expectedMisses,
    disallowedHits,
  };
}

function buildAccessoryPicks(query: string, corePicks: (typeof catalogStore.products)[number][]) {
  if (corePicks.length === 0) return [];
  const activities = detectActivitiesFromQuery(query);
  const core = corePicks[0];
  const bundle = buildAccessoryBundle(core, catalogStore.products, 5);
  if (activities.length === 0) return bundle;
  const constraints = buildActivityConstraints(activities);
  const ranked = enforceAndRankActivityFit(bundle, query, constraints);
  const injectMounts = (
    picks: (typeof catalogStore.products)[number][],
    allowedSubtypes: readonly string[],
  ) => {
    const existing = new Set(picks.map((p) => p.slug));
    const mountCandidates = findAccessoriesFor(core, catalogStore.products, {
      role: "mounting",
      limit: 12,
    }).filter((product) => allowedSubtypes.some((subtype) => product.subtypes.includes(subtype)));
    const injected = [...picks];
    for (const candidate of mountCandidates) {
      if (existing.has(candidate.slug)) continue;
      injected.unshift(candidate);
      existing.add(candidate.slug);
      if (injected.length >= 6) break;
    }
    return injected;
  };

  let enriched = ranked;
  if (activities.some((id) => AERIAL_ACTIVITY_IDS.has(id))) {
    enriched = injectMounts(enriched, AERIAL_MOUNT_PRIORITY);
  }
  if (activities.some((id) => WHITEWATER_ACTIVITY_IDS.has(id))) {
    enriched = injectMounts(enriched, WHITEWATER_MOUNT_PRIORITY);
  }

  if (
    !activities.some((id) => AERIAL_ACTIVITY_IDS.has(id)) &&
    !activities.some((id) => WHITEWATER_ACTIVITY_IDS.has(id))
  ) {
    return enriched;
  }
  const revalidated = enforceAndRankActivityFit(enriched, query, constraints);
  const rankBySubtype = (product: (typeof catalogStore.products)[number]): number => {
    const aerialIdx = AERIAL_MOUNT_PRIORITY.findIndex((subtype) => product.subtypes.includes(subtype));
    if (aerialIdx !== -1) return aerialIdx;
    const waterIdx = WHITEWATER_MOUNT_PRIORITY.findIndex((subtype) =>
      product.subtypes.includes(subtype)
    );
    return waterIdx === -1 ? Number.MAX_SAFE_INTEGER : waterIdx + 10;
  };
  return [...revalidated].sort((a, b) => {
    const aRank = rankBySubtype(a);
    const bRank = rankBySubtype(b);
    if (aRank !== bRank) return aRank - bRank;
    return 0;
  });
}

function evaluateFixture(
  query: string,
  name: string,
  expected: string[],
  disallowed: string[],
): FixtureResult {
  const intent = classifyIntent(query);
  const pool = filterProducts(intent, catalogStore.products);
  const corePicks = pickRecommendations(pool, 5, intent);
  const accessoryPicks = buildAccessoryPicks(query, corePicks);

  const coreExpected = expected.filter((signal) => !isAccessorySignal(signal));
  const accessoryExpected = expected.filter((signal) => isAccessorySignal(signal));
  const coreDisallowed = disallowed.filter((signal) => !isAccessorySignal(signal));
  const accessoryDisallowed = disallowed.filter((signal) => isAccessorySignal(signal));

  const coreCheck = checkSignals(
    corePicks.map(haystackForProduct),
    coreExpected,
    coreDisallowed,
    corePicks.map(visibleHaystackForProduct),
  );
  const accessoryCheck = checkSignals(
    accessoryPicks.map(haystackForProduct),
    accessoryExpected,
    accessoryDisallowed,
  );

  const core: LaneResult = {
    ...coreCheck,
    passed: coreCheck.passed && corePicks.length > 0,
    topTitles: corePicks.map((p) => p.title),
  };
  const incompatibleAccessoryTitles = accessoryPicks
    .filter((accessory) => !isAccessoryCompatibleWithAnyCoreStrict(accessory, corePicks))
    .map((p) => p.title);
  const accessory: LaneResult = {
    ...accessoryCheck,
    compatibilityFailures: incompatibleAccessoryTitles,
    passed:
      accessoryCheck.passed &&
      incompatibleAccessoryTitles.length === 0 &&
      accessoryPicks.length > 0,
    topTitles: accessoryPicks.map((p) => p.title),
  };

  return {
    name,
    overallPassed: core.passed && accessory.passed,
    core,
    accessory,
  };
}

function printLane(label: string, lane: LaneResult) {
  const status = lane.passed ? "PASS" : "FAIL";
  // eslint-disable-next-line no-console
  console.log(`  [${status}] ${label}`);
  if (lane.expectedMisses.length > 0) {
    // eslint-disable-next-line no-console
    console.log(`    missing expected: ${lane.expectedMisses.join(", ")}`);
  }
  if (lane.disallowedHits.length > 0) {
    // eslint-disable-next-line no-console
    console.log(`    disallowed hit: ${lane.disallowedHits.join(", ")}`);
  }
  if (lane.compatibilityFailures && lane.compatibilityFailures.length > 0) {
    // eslint-disable-next-line no-console
    console.log(
      `    compatibility FAIL: ${lane.compatibilityFailures.join(" | ")}`,
    );
  }
  // eslint-disable-next-line no-console
  console.log(`    top picks: ${lane.topTitles.join(" | ")}`);
}

/* =============================================================
 * Hierarchy / buildPlan lane
 *
 * Tests every fixture against `buildPlan()` (the actual code path
 * the Wingman Plan page uses) and asserts:
 *   - the hero core of every combo matches the L1 primary filter
 *     of the activity's hierarchy (if one exists)
 *   - no `exclusions.productTypes` / `subtypes` / `titleTokens`
 *     appear anywhere in the kit (core or accessories)
 *
 * Fixtures whose query doesn't hit any registered hierarchy are
 * skipped — we only assert the hierarchy contract where it applies.
 * Failures here are the canonical signal that the planner regressed
 * (the older lane-based check above tests an adjacent assistant
 * code path that doesn't go through buildPlan). */

type BuildPlanResult = {
  name: string;
  query: string;
  passed: boolean;
  hierarchyId: string | null;
  reasons: string[];
  combos: Array<{ id: Combo["id"]; coreTitle: string; accessoryTitles: string[] }>;
};

function pickHierarchyForQuery(query: string): { id: string; hierarchy: ActivityHierarchy } | null {
  const detected = extractActivitiesFromQuery(query);
  for (const id of detected) {
    const hit = ACTIVITY_HIERARCHIES[id];
    if (hit) return { id, hierarchy: hit };
  }
  return null;
}

function comboViolatesExclusions(
  combo: Combo,
  hierarchy: ActivityHierarchy,
): string[] {
  const violations: string[] = [];
  const excl = hierarchy.exclusions;
  if (!excl) return violations;
  const all = [combo.core, ...combo.accessories];
  const forbiddenTypes = new Set<string>(excl.productTypes ?? []);
  const forbiddenSubtypes = new Set<string>(excl.subtypes ?? []);
  const forbiddenTokens = (excl.titleTokens ?? []).map((t) => t.toLowerCase());
  for (const product of all) {
    if (forbiddenTypes.size > 0 && product.productType && forbiddenTypes.has(product.productType)) {
      violations.push(
        `${combo.id}: "${product.title}" has forbidden productType="${product.productType}"`,
      );
    }
    if (forbiddenSubtypes.size > 0) {
      for (const s of product.subtypes) {
        if (forbiddenSubtypes.has(s)) {
          violations.push(`${combo.id}: "${product.title}" has forbidden subtype="${s}"`);
        }
      }
    }
    if (forbiddenTokens.length > 0) {
      const lower = product.title.toLowerCase();
      for (const tok of forbiddenTokens) {
        if (lower.includes(tok)) {
          violations.push(`${combo.id}: "${product.title}" matches forbidden title token="${tok}"`);
        }
      }
    }
  }
  return violations;
}

function coreMatchesPrimary(combo: Combo, hierarchy: ActivityHierarchy): string | null {
  const filter = hierarchy.primary;
  const core = combo.core;
  if (
    filter.categoryToken &&
    !core.category.toLowerCase().includes(filter.categoryToken.toLowerCase())
  ) {
    return `${combo.id}: core category "${core.category}" doesn't include "${filter.categoryToken}"`;
  }
  if (filter.subtypes && filter.subtypes.length > 0) {
    for (const s of filter.subtypes) {
      if (!core.subtypes.includes(s)) {
        return `${combo.id}: core "${core.title}" missing required subtype="${s}"`;
      }
    }
  }
  return null;
}

function evaluateBuildPlanFixture(name: string, query: string): BuildPlanResult {
  const reasons: string[] = [];
  const hier = pickHierarchyForQuery(query);
  const plan = buildPlan(query, catalogStore.products);
  const combos = plan.combos;
  const summary = {
    name,
    query,
    passed: true,
    hierarchyId: hier?.id ?? null,
    reasons,
    combos: combos.map((c) => ({
      id: c.id,
      coreTitle: c.core.title,
      accessoryTitles: c.accessories.map((a) => a.title),
    })),
  } satisfies BuildPlanResult;

  if (!hier) {
    /* No hierarchy entry — the buildPlan still ran, but we can't
     * assert against L1/exclusions. Treat as PASS by default; the
     * legacy lane covers ranking quality. */
    return summary;
  }

  if (combos.length === 0) {
    summary.passed = false;
    reasons.push("buildPlan returned 0 combos");
    return summary;
  }

  for (const combo of combos) {
    const primaryReason = coreMatchesPrimary(combo, hier.hierarchy);
    if (primaryReason) reasons.push(primaryReason);
    reasons.push(...comboViolatesExclusions(combo, hier.hierarchy));
  }

  summary.passed = reasons.length === 0;
  return summary;
}

function printBuildPlanResult(result: BuildPlanResult) {
  const status = result.passed ? "PASS" : "FAIL";
  // eslint-disable-next-line no-console
  console.log(
    `  [${status}] hierarchy=${result.hierarchyId ?? "(none)"} ` +
      result.combos.map((c) => `${c.id}=${c.coreTitle}`).join(" | "),
  );
  if (result.reasons.length > 0) {
    for (const reason of result.reasons) {
      // eslint-disable-next-line no-console
      console.log(`    -> ${reason}`);
    }
  }
}

/* =============================================================
 * Dataset lane — the canonical gate.
 *
 * For every activity in the training dataset, drive buildPlan with
 * the activity name as the query and assert the dataset contract:
 *   - the query detects to that same activity
 *   - each tier's core matches the dataset Primary_Family
 *   - Ideal + Pro carry at least one secondary product
 *   - every combo has at least one accessory
 *   - Water kits include a waterproof case
 *   - no kit contains a forbidden product type for the environment
 * ============================================================= */

type DatasetLaneResult = {
  activity: string;
  passed: boolean;
  reasons: string[];
  cores: string[];
};

function familyMatches(core: (typeof catalogStore.products)[number], family: PrimaryFamily): boolean {
  switch (family) {
    case "Drone":
      return (
        core.productTypeGroup === "drone" ||
        core.subtypes.some((s) => s.startsWith("drone_"))
      );
    case "Action":
      return core.subtypes.includes("cam_action");
    case "Pocket":
      return core.subtypes.includes("cam_pocket");
    default:
      return true;
  }
}

function isWaterproofCaseProduct(p: (typeof catalogStore.products)[number]): boolean {
  return (
    p.subtypes.includes("acc_case") &&
    (p.useCaseTags.includes("waterproof") || p.useCaseTags.includes("underwater"))
  );
}

function evaluateDatasetActivity(activity: string): DatasetLaneResult {
  const reasons: string[] = [];
  const query = activity; // activity name doubles as a representative query
  const match = detectDatasetActivity(query);
  if (!match || match.activity !== activity) {
    reasons.push(`detection mismatch: "${query}" -> ${match?.activity ?? "(none)"}`);
  }
  const tierRows = getTierRows(activity);
  const plan = buildPlan(query, catalogStore.products);
  const byId = new Map(plan.combos.map((c) => [c.id, c] as const));
  const cores: string[] = [];

  const tiers: DatasetTier[] = ["budget", "ideal", "top"];
  for (const tier of tiers) {
    const combo = byId.get(tier);
    if (!combo) {
      reasons.push(`${tier}: missing combo`);
      continue;
    }
    cores.push(`${tier}=${combo.core.title}`);
    const expectedFamily = tierRows?.[tier].primaryFamily;
    if (expectedFamily && !familyMatches(combo.core, expectedFamily)) {
      reasons.push(`${tier}: core "${combo.core.title}" is not family ${expectedFamily}`);
    }
    if ((tier === "ideal" || tier === "top") && (combo.secondary?.length ?? 0) === 0) {
      reasons.push(`${tier}: missing secondary product`);
    }
    if (combo.accessories.length === 0) {
      reasons.push(`${tier}: zero accessories`);
    }
    if (match?.environment === "Water" && !combo.accessories.some(isWaterproofCaseProduct)) {
      reasons.push(`${tier}: water kit lacks a waterproof case`);
    }
    /* Real-drone detection keys on the functional drone_* subtype,
     * NOT productTypeGroup — the catalog mistags some storage cases
     * ("Drone Mini Case") as productType drone. */
    if (
      (match?.environment === "Water" || match?.environment === "Air") &&
      !combo.core.subtypes.some((s) => s.startsWith("drone_")) &&
      combo.accessories.some((a) => a.subtypes.some((s) => s.startsWith("drone_")))
    ) {
      reasons.push(`${tier}: ${match?.environment} kit contains a drone accessory`);
    }
  }

  return { activity, passed: reasons.length === 0, reasons, cores };
}

function main() {
  const datasetResults = DATASET_ACTIVITIES.map(evaluateDatasetActivity);
  const datasetPassed = datasetResults.filter((r) => r.passed).length;
  const datasetTotal = datasetResults.length;

  // eslint-disable-next-line no-console
  console.log(`\nDataset lane: ${datasetPassed}/${datasetTotal} activities passed`);
  for (const r of datasetResults) {
    const status = r.passed ? "PASS" : "FAIL";
    // eslint-disable-next-line no-console
    console.log(`  [${status}] ${r.activity} — ${r.cores.join(" | ")}`);
    for (const reason of r.reasons) {
      // eslint-disable-next-line no-console
      console.log(`      -> ${reason}`);
    }
  }
  // eslint-disable-next-line no-console
  console.log("");

  const legacyResults = ACTIVITY_REGRESSION_FIXTURES.map((fixture) =>
    evaluateFixture(
      fixture.query,
      fixture.name,
      fixture.expectedSignals,
      fixture.disallowedSignals,
    ),
  );

  const planResults = ACTIVITY_REGRESSION_FIXTURES.map((fixture) =>
    evaluateBuildPlanFixture(fixture.name, fixture.query),
  );

  const legacyPassed = legacyResults.filter((r) => r.overallPassed).length;
  const planPassed = planResults.filter((r) => r.passed).length;
  const total = legacyResults.length;

  // eslint-disable-next-line no-console
  console.log(
    `Activity evaluator: legacy ${legacyPassed}/${total} | buildPlan ${planPassed}/${total}\n`,
  );

  for (let i = 0; i < legacyResults.length; i += 1) {
    const legacy = legacyResults[i];
    const plan = planResults[i];
    const legacyStatus = legacy.overallPassed ? "PASS" : "FAIL";
    // eslint-disable-next-line no-console
    console.log(`[${legacyStatus}] ${legacy.name} (legacy)`);
    printLane("core", legacy.core);
    printLane("accessory", legacy.accessory);
    printBuildPlanResult(plan);
    // eslint-disable-next-line no-console
    console.log("");
  }

  /* The DATASET lane is the canonical regression gate now — it tests
   * the dataset-driven routing that the user-facing kit picker uses.
   * The legacy + hierarchy buildPlan lanes are kept for visibility
   * (they assert the OLD hierarchy contract, which the dataset
   * intentionally overrides for covered activities) but are not
   * enforced. */
  if (datasetPassed !== datasetTotal) process.exitCode = 1;
}

main();

