import type { AccessoryRole, ProductSeries } from "../../../catalog/catalog";

/* =============================================================
 * Skin-concern -> product mapping for the rule layer.
 *
 * Powers the "my skin is X, what should I use" branch of the
 * assistant. Each entry maps a skin symptom the shopper might
 * describe (`dry`, `dull`, `breakouts`, `dark circles`, ...) to:
 *
 *   - `role`: retained (AccessoryRole) only for the shared entry
 *     shape; skincare products don't carry accessory roles, so
 *     every entry uses "general".
 *   - `label`: short human-readable product family name used when
 *     composing card titles ("Hydrating moisturizers for ...").
 *
 * `subtypes` / `capabilities` are intentionally omitted for
 * skincare (the fields they used to filter carry different data
 * now). Keep this list small and curated because the LLM handles the
 * long tail.
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
    // Dryness / tightness / flaking → hydration.
    test: /\b(dry|dryness|tight\w*|flak\w*|dehydrat\w*|parched|rough\s*skin)\b/i,
    role: "general",
    label: "hydrating moisturizers",
  },
  {
    // Dullness / uneven tone → brightening.
    test: /\b(dull\w*|lacklustre|lackluster|uneven\s*tone|sallow|tired[-\s]?looking|no\s*glow)\b/i,
    role: "general",
    label: "brightening serums",
  },
  {
    // Dark spots / pigmentation → targeted brightening treatments.
    test: /\b(dark\s*spots?|age\s*spots?|sun\s*spots?|hyperpigment\w*|pigmentation|discolou?ration)\b/i,
    role: "general",
    label: "dark-spot treatments",
  },
  {
    // Fine lines / wrinkles → anti-aging.
    test: /\b(wrinkl\w*|fine\s*lines?|crow'?s?\s*feet|crepe\w*|aging|ageing)\b/i,
    role: "general",
    label: "anti-aging treatments",
  },
  {
    // Loss of firmness / sagging → firming.
    test: /\b(sag\w*|loss\s*of\s*firmness|not\s*firm|loose\s*skin|lack\s*of\s*bounce|elasticity)\b/i,
    role: "general",
    label: "firming treatments",
  },
  {
    // Oiliness / shine / large pores → oil control.
    test: /\b(oily|greasy|shine|shiny|large\s*pores?|enlarged\s*pores?|blackheads?|breakouts?|acne|blemish\w*)\b/i,
    role: "general",
    label: "pore-refining products",
  },
  {
    // Under-eye concerns → eye care.
    test: /\b(dark\s*circles?|puffiness|puffy\s*eyes|under[-\s]?eye|eye\s*bags?)\b/i,
    role: "general",
    label: "eye creams",
  },
  {
    // Sensitivity / redness → gentle, soothing care.
    test: /\b(sensitive|redness|irritat\w*|reactive\s*skin|stinging)\b/i,
    role: "general",
    label: "gentle, soothing products",
  },
  {
    // Sun protection.
    test: /\b(sun\s*protect\w*|sunburn|uv\s*damage|spf|sunscreen)\b/i,
    role: "general",
    label: "daily sunscreen",
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
 * Bare-collection "family" detector.
 *
 * Skincare products are chosen by concern / skin type / category
 * rather than a versioned model line, so there is no family
 * detection. Kept as an empty list (with the shared `ModelFamily`
 * shape) so `detectModelFamily` stays a no-op without a wider
 * refactor of its callers.
 * ============================================================= */

export type ModelFamily = {
  test: RegExp;
  series: ProductSeries;
  titleFragment: string;
};

export const MODEL_FAMILY_PATTERNS: ReadonlyArray<ModelFamily> = [];

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
