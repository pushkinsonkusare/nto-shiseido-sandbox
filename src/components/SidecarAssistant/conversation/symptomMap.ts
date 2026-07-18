import type { AccessoryRole, ProductSeries } from "../../../catalog/catalog";

/* =============================================================
 * Symptom -> accessory mapping for the rule layer.
 *
 * Powers the "I have an X, how do I solve Y" branch of the
 * assistant. Each entry maps a symptom phrase the shopper might
 * use (`glare`, `wind noise`, `battery dies`, ...) to:
 *
 *   - `role`: the canonical AccessoryRole bucket the answer
 *     should live in (so `findAccessoriesFor({role})` returns the
 *     right shelf).
 *   - `subtypes`: optional v6 ProductSubtype tokens for further
 *     narrowing inside that role bucket. e.g. role
 *     `visual_enhancement` + subtype `acc_filter_cpl` surfaces
 *     polarising filters specifically (vs ND or UV variants).
 *   - `capabilities`: optional v6 capability tokens used as an
 *     additional require-any filter — needed for waterproof gear
 *     where the role bucket alone (`general`) is too wide.
 *   - `label`: short human-readable accessory family name used
 *     when composing card titles ("Polarising filters for ...").
 *
 * Vocabulary rules:
 *   - Subtype tokens MUST exist in `SUBTYPE_VALUES` in
 *     `catalog.ts`. Capability tokens MUST exist in
 *     `RAW_CAPABILITY_VALUES`. Both are validated at module load
 *     so a typo fails loudly during development.
 *   - The intentionally small (~7) entry list is the point — the
 *     LLM is responsible for the long tail. Keep this curated.
 * ============================================================= */

export type SymptomEntry = {
  test: RegExp;
  role: AccessoryRole;
  subtypes?: string[];
  capabilities?: string[];
  label: string;
};

export const SYMPTOM_PATTERNS: ReadonlyArray<SymptomEntry> = [
  {
    // CPL-class problems: any non-metallic surface reflection.
    test: /\b(glare|reflect\w*|shiny|window\s*reflect|mirror\s*reflect|water\s*reflect)\b/i,
    role: "visual_enhancement",
    subtypes: ["acc_filter_cpl"],
    label: "polarising filters",
  },
  {
    // ND-class problems: too much ambient light. We deliberately
    // avoid "low light" here — that's a sensor/lens problem, not
    // an ND filter problem.
    test: /\b(too\s*bright|over\s*expos\w*|overexpos\w*|bright\s*sun|sunny\s*day|harsh\s*light|too\s*much\s*light|blown\s*out)\b/i,
    role: "visual_enhancement",
    subtypes: ["acc_filter_nd"],
    label: "ND filters",
  },
  {
    // Audio problems caused by wind. Maps to mic windscreens (the
    // canonical v6 subtype is `mic_windscreen`, not `acc_*`).
    test: /\b(wind\s*noise|windy\s*audio|muffled\s*audio|outdoor\s*audio|crackl\w*\s*audio|noisy\s*outdoor)\b/i,
    role: "general",
    subtypes: ["mic_windscreen"],
    label: "windscreens",
  },
  {
    // Stabilisation. Note: any of "shake", "shaky", "shakes",
    // "jittery", "wobbly" etc. trigger the gimbal recommendation.
    test: /\b(shak\w*|jitter\w*|unstable\s*footage|wobbly|smooth\s*footage|need\s*stabili[sz]\w*)\b/i,
    role: "stabilization",
    label: "gimbals",
  },
  {
    // Power problems: short runtime, dead battery mid-shoot.
    test: /\b(battery\s*(dies|drains|short)|short\s*battery|longer\s*recording|extra\s*batter\w*|spare\s*batter\w*|need\s*more\s*power|power\s*bank)\b/i,
    role: "power",
    label: "extra batteries",
  },
  {
    // Water/diving — surfaces waterproof cases via the `acc_case`
    // subtype filtered by the `waterproof` capability tag (so
    // ordinary carrying cases don't leak in).
    test: /\b(underwater|scuba|dive|diving|snorkel\w*|swim\w*|wet|rain|splash|kayak|raft\w*)\b/i,
    role: "general",
    subtypes: ["acc_case"],
    capabilities: ["waterproof", "underwater"],
    label: "waterproof gear",
  },
  {
    // Lens scratch / protection — the UV filter doubles as a
    // sacrificial protector on every DJI lens we ship.
    test: /\b(scratch\w*|protect\w*\s*(?:my\s*)?lens|lens\s*protect\w*|lens\s*cap)\b/i,
    role: "visual_enhancement",
    subtypes: ["acc_filter_uv"],
    label: "lens protectors",
  },
];

/* =============================================================
 * Question / ownership shape detectors.
 *
 * These anchor the symptom-routing branch so we don't hijack
 * ordinary "show me X" / "compare X and Y" queries. The branch
 * fires only when AT LEAST ONE of these patterns matches AND a
 * SYMPTOM_PATTERNS entry matches.
 * ============================================================= */

export const OWNS_PATTERN =
  /\b(i\s+(have|own|got|use|bought|just\s*bought)|i'?ve\s+got|my|i'?m\s+using|i\s+just\s+got)\b/i;

export const HOWTO_PATTERN =
  /\b(how\s+(do|can|should)\s+i|how\s+to|what\s+(do|should|can)\s+i\s+(use|get|need|do)|recommend|suggest|best\s+way|help\s+(?:me\s+)?(?:reduce|fix|solve|stop))\b/i;

/* =============================================================
 * Bare-model "family" detector.
 *
 * Existing `MODEL_PATTERNS` in flow.ts all require a version
 * number ("Mavic 4 Pro", "Osmo Action 5 Pro"). When the shopper
 * says "my osmo action" / "i have a mavic" without a version,
 * we still want to scope the recommendation to that family.
 *
 * `series` aligns with `ProductSeries` in catalog.ts so callers
 * can `catalog.filter(p => p.series === fam.series)`. The
 * `titleFragment` is the natural-language phrase used in card
 * titles ("Polarising filters for your Osmo Action").
 *
 * Patterns are ordered most-specific-first; the negative
 * lookahead `(?!\s*\d)` ensures we never beat a versioned
 * MODEL_PATTERNS match.
 * ============================================================= */

export type ModelFamily = {
  test: RegExp;
  series: ProductSeries;
  titleFragment: string;
};

export const MODEL_FAMILY_PATTERNS: ReadonlyArray<ModelFamily> = [
  // Two-word families first so "osmo action" doesn't get partially
  // captured by a bare "osmo".
  {
    test: /\bosmo\s*action\b(?!\s*\d)/i,
    series: "osmo_action",
    titleFragment: "Osmo Action",
  },
  {
    test: /\bosmo\s*pocket\b(?!\s*\d)/i,
    series: "osmo_pocket",
    titleFragment: "Osmo Pocket",
  },
  {
    test: /\bosmo\s*mobile\b(?!\s*\d)/i,
    series: "osmo_mobile",
    titleFragment: "Osmo Mobile",
  },
  {
    test: /\bosmo\s*nano\b(?!\s*\d)/i,
    series: "osmo_nano",
    titleFragment: "Osmo Nano",
  },
  {
    test: /\bosmo\s*360\b/i,
    series: "osmo_360",
    titleFragment: "Osmo 360",
  },
  // Single-word families. "mini" / "air" are common English words
  // so they require ownership/howto context to fire (the caller
  // already gates on OWNS/HOWTO patterns before consulting these).
  { test: /\bmavic\b(?!\s*\d)/i,    series: "mavic",         titleFragment: "Mavic" },
  { test: /\bmini\b(?!\s*\d)/i,     series: "mini",          titleFragment: "Mini" },
  { test: /\bair\b(?!\s*\d)/i,      series: "air",           titleFragment: "Air" },
  { test: /\bavata\b(?!\s*\d)/i,    series: "avata",         titleFragment: "Avata" },
  { test: /\bneo\b(?!\s*\d)/i,      series: "neo",           titleFragment: "Neo" },
  { test: /\binspire\b(?!\s*\d)/i,  series: "inspire",       titleFragment: "Inspire" },
  { test: /\b(ronin|rs)\b(?!\s*\d)/i, series: "ronin_rs",    titleFragment: "Ronin" },
  { test: /\b(dji\s*mic|mic\s*\d)\b/i, series: "dji_mic",    titleFragment: "DJI Mic" },
  { test: /\bgoggles?\b/i,          series: "fpv_goggles",   titleFragment: "FPV Goggles" },
];

export function detectModelFamily(query: string): ModelFamily | undefined {
  for (const fam of MODEL_FAMILY_PATTERNS) {
    if (fam.test.test(query)) return fam;
  }
  return undefined;
}

export function detectSymptom(query: string): SymptomEntry | undefined {
  for (const sym of SYMPTOM_PATTERNS) {
    if (sym.test.test(query)) return sym;
  }
  return undefined;
}

export function hasOwnsOrHowtoSignal(query: string): boolean {
  return OWNS_PATTERN.test(query) || HOWTO_PATTERN.test(query);
}
