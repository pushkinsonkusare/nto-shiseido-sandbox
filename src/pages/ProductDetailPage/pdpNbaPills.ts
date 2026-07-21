import type { CatalogProduct } from "../../catalog/catalog";

export type PdpNbaPillKind =
  | "faq" // Product FAQ (e.g. "Is this good for dry skin?", "How do I use it?")
  | "upsell" // Step-up to a higher-tier sibling, or a feature-search step-up
  | "downsell" // Step-down to a cheaper sibling
  | "bundle" // Routine / set building
  | "hygiene" // Returns, warranty, shipping
  | "open"; // "Ask me anything" catch-all, has no arrow icon

export type PdpNbaPill = {
  /** Stable id for React keys + click telemetry. */
  id: string;
  /** Visible label rendered in the pill. */
  label: string;
  /** Prompt sent to the assistant when clicked. Defaults to `label`. */
  prompt?: string;
  /** Categorisation used by telemetry to track which lane converts best. */
  kind: PdpNbaPillKind;
};

const NBSP = "\u00a0";

/* ---------- shared helpers ---------- */

/** Truncate long product titles so pills stay on one line. */
function shortenTitle(title: string, max = 32): string {
  const trimmed = title.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1).trimEnd()}…`;
}

/** Wrap-around index pick that keeps set-rotation logic concise. */
function pickByIndex<T>(pool: readonly T[], index: number): T | null {
  if (pool.length === 0) return null;
  const len = pool.length;
  return pool[((index % len) + len) % len];
}

/* ---------- catalog-relative fallbacks ----------
 *
 * Lets the lane-driven pills fall back to a real sibling SKU when a lane
 * has no hook-feature match. The primary upsell/bundle paths go through
 * `LANE_PACKS`. */

function findStepUpSibling(
  product: CatalogProduct,
  catalog: CatalogProduct[],
): CatalogProduct | null {
  if (!product.price) return null;
  const ceiling = product.price * 2;
  const floor = product.price * 1.2;
  const candidates = catalog.filter(
    (p) =>
      p.slug !== product.slug &&
      !p.isBundle &&
      p.category === product.category &&
      typeof p.price === "number" &&
      (p.price as number) >= floor &&
      (p.price as number) <= ceiling,
  );
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => (a.price ?? 0) - (b.price ?? 0));
  return candidates[0];
}

function findCombo(
  product: CatalogProduct,
  catalog: CatalogProduct[],
): CatalogProduct | null {
  return (
    catalog.find(
      (p) =>
        p.isBundle &&
        (p.bundleBaseSlug === product.slug ||
          p.title
            .toLowerCase()
            .includes(product.title.toLowerCase().split(/\s+/)[1] ?? "")),
    ) ?? null
  );
}

/**
 * Shared "routine-building" bundle pills for a single (non-set) product:
 * an optional linked set, plus a build-a-routine and a pairs-with prompt.
 * Every non-set lane leans on this so its bundle slot never goes dark.
 */
function routineBundlePills(
  product: CatalogProduct,
  catalog: CatalogProduct[],
  pairLabel: string,
): PdpNbaPill[] {
  const pills: PdpNbaPill[] = [];
  const combo = findCombo(product, catalog);
  if (combo) {
    pills.push({
      id: "bundle-linked-set",
      label: `Show the ${shortenTitle(combo.title, 28)}`,
      prompt: `Tell me about the ${combo.title} and what it includes.`,
      kind: "bundle",
    });
  }
  pills.push({
    id: "bundle-build-routine",
    label: "Build a complete routine",
    prompt: `Help me build a complete skincare routine around the ${product.title}.`,
    kind: "bundle",
  });
  pills.push({
    id: "bundle-pairs-with",
    label: pairLabel,
    prompt: `What products pair well with the ${product.title}?`,
    kind: "bundle",
  });
  return pills;
}

/* ---------- lane resolver ---------- */

type Lane =
  | "cleanser"
  | "serum"
  | "moisturizer"
  | "sunscreen"
  | "eye"
  | "softener"
  | "mask"
  | "set"
  | "default";

/**
 * Pick the NBA content lane for a skincare product from its storefront
 * category (bundles are detected first via `isBundle`, then a category
 * regex, then a title rescue for rows that landed in a generic
 * "Skincare" bucket). Anything unrecognised falls back to the generic
 * `default` lane, which asks skin-type / routine / ingredient FAQs that
 * apply to any product.
 */
function resolveLane(product: CatalogProduct): Lane {
  if (product.isBundle) return "set";

  const category = (product.category ?? "").toLowerCase();
  if (/sets?\b|bundle/.test(category)) return "set";
  if (/cleanser|cleans/.test(category)) return "cleanser";
  if (/serum|treatment|essence|concentrate/.test(category)) return "serum";
  if (/sunscreen|sun\s*care|spf/.test(category)) return "sunscreen";
  if (/eye|lip/.test(category)) return "eye";
  if (/softener|toner|lotion/.test(category)) return "softener";
  if (/mask/.test(category)) return "mask";
  if (/moisturi[sz]er|cream|emulsion/.test(category)) return "moisturizer";

  // Title rescue for the catch-all "Skincare" category.
  const title = product.title.toLowerCase();
  if (/cleanser|cleansing|foam|wash/.test(title)) return "cleanser";
  if (/serum|treatment|concentrate|essence/.test(title)) return "serum";
  if (/sunscreen|\bspf\b|sun\b/.test(title)) return "sunscreen";
  if (/eye|lip/.test(title)) return "eye";
  if (/mask/.test(title)) return "mask";
  if (/cream|moisturi[sz]er|emulsion/.test(title)) return "moisturizer";

  return "default";
}

/* ---------- universal pill pools ----------
 *
 * Every set surfaces one lead pill, one hygiene pill, and the open
 * fallback. The hygiene pool rotates by `setIndex` so a shopper who
 * spins the regenerator sees a different policy framing each time. */

function whatsInBoxPill(product: CatalogProduct): PdpNbaPill {
  return {
    id: "faq-whats-in-box",
    label: product.isBundle ? "What's included?" : "What size do I get?",
    prompt: product.isBundle
      ? `What's included in the ${product.title}?`
      : `What sizes does the ${product.title} come in, and how long does one last?`,
    kind: "faq",
  };
}

const HYGIENE_ROTATION: readonly PdpNbaPill[] = [
  {
    id: "hygiene-returns",
    label: "What's the return policy?",
    prompt: "What is the return policy?",
    kind: "hygiene",
  },
  {
    id: "hygiene-warranty",
    label: "Is there a warranty?",
    prompt: "Is there a warranty included, and what does it cover?",
    kind: "hygiene",
  },
  {
    id: "hygiene-shipping",
    label: "How fast is shipping?",
    prompt: "How long does shipping take and what are the delivery options?",
    kind: "hygiene",
  },
];

function openPill(product: CatalogProduct, suffix: string): PdpNbaPill {
  return {
    id: `open-anything-${suffix}`,
    label: `Ask${NBSP}me${NBSP}anything`,
    prompt: `Ask me anything about the ${product.title}.`,
    kind: "open",
  };
}

/* ---------- lane packs ----------
 *
 * Each lane exposes three pools:
 *   - `confidenceFaqs`: skin-type suitability / how-to-use / ingredient /
 *     results FAQs that defuse the most common pre-purchase hesitations
 *     for the category.
 *   - `hookFeatures`: discovery / step-up prompts. Order matters: the
 *     first entry whose `match` returns true is preferred for set A;
 *     subsequent sets cycle through the rest.
 *   - `bundles`: routine-building pills. Always returns at least one
 *     entry so the bundle slot in the rotation never goes dark.
 */

type HookFeature = {
  pill: PdpNbaPill;
  /** Optional gate. Returns true when the pill fits this product. */
  match?: (product: CatalogProduct) => boolean;
};

type LanePack = {
  confidenceFaqs: (product: CatalogProduct) => PdpNbaPill[];
  hookFeatures: (product: CatalogProduct) => HookFeature[];
  bundles: (
    product: CatalogProduct,
    catalog: CatalogProduct[],
  ) => PdpNbaPill[];
};

const CLEANSER_LANE: LanePack = {
  confidenceFaqs: (product) => [
    {
      id: "faq-cleanser-skintype",
      label: "Will it dry out my skin?",
      prompt: `Is the ${product.title} gentle enough for my skin type, or will it leave my skin feeling tight or dry?`,
      kind: "faq",
    },
    {
      id: "faq-cleanser-frequency",
      label: "How often should I use it?",
      prompt: `How often should I use the ${product.title} — morning, night, or both?`,
      kind: "faq",
    },
    {
      id: "faq-cleanser-makeup",
      label: "Does it remove makeup & SPF?",
      prompt: `Does the ${product.title} fully remove makeup and sunscreen, or do I need a separate first cleanse?`,
      kind: "faq",
    },
    {
      id: "faq-cleanser-sensitive",
      label: "Good for sensitive skin?",
      prompt: `Is the ${product.title} gentle enough for sensitive or reactive skin?`,
      kind: "faq",
    },
  ],
  hookFeatures: (product) => [
    {
      pill: {
        id: "upsell-cleanser-next-step",
        label: "See the next routine step",
        prompt: `What should I use right after cleansing with the ${product.title}?`,
        kind: "upsell",
      },
    },
    {
      pill: {
        id: "upsell-cleanser-softener",
        label: "See a softener to pair",
        prompt: `Show me a softener or toner to use after the ${product.title}.`,
        kind: "upsell",
      },
    },
  ],
  bundles: (product, catalog) =>
    routineBundlePills(product, catalog, "What pairs with this cleanser?"),
};

const SERUM_LANE: LanePack = {
  confidenceFaqs: (product) => [
    {
      id: "faq-serum-target",
      label: "What does it target?",
      prompt: `What skin concerns does the ${product.title} target?`,
      kind: "faq",
    },
    {
      id: "faq-serum-results",
      label: "How long until I see results?",
      prompt: `How long until I see results from the ${product.title}, and how should I use it?`,
      kind: "faq",
    },
    {
      id: "faq-serum-ingredients",
      label: "What are the key ingredients?",
      prompt: `What are the key ingredients in the ${product.title} and what do they do?`,
      kind: "faq",
    },
    {
      id: "faq-serum-skintype",
      label: "Which skin types is it for?",
      prompt: `Which skin types is the ${product.title} best suited to?`,
      kind: "faq",
    },
  ],
  hookFeatures: (product) => [
    {
      pill: {
        id: "upsell-serum-stronger",
        label: "See a more targeted treatment",
        prompt: `Show me a more targeted or higher-strength treatment than the ${product.title}.`,
        kind: "upsell",
      },
    },
    {
      pill: {
        id: "upsell-serum-moisturizer",
        label: "See a moisturizer to layer",
        prompt: `What moisturizer should I layer over the ${product.title}?`,
        kind: "upsell",
      },
    },
  ],
  bundles: (product, catalog) =>
    routineBundlePills(product, catalog, "What pairs with this serum?"),
};

const MOISTURIZER_LANE: LanePack = {
  confidenceFaqs: (product) => [
    {
      id: "faq-moist-skintype",
      label: "Is it right for my skin type?",
      prompt: `Is the ${product.title} suitable for my skin type — is it lightweight or rich?`,
      kind: "faq",
    },
    {
      id: "faq-moist-daynight",
      label: "Day or night?",
      prompt: `Should I use the ${product.title} in the morning, at night, or both?`,
      kind: "faq",
    },
    {
      id: "faq-moist-makeup",
      label: "Does it work under makeup?",
      prompt: `Can I wear the ${product.title} under sunscreen and makeup?`,
      kind: "faq",
    },
    {
      id: "faq-moist-ingredients",
      label: "What are the key ingredients?",
      prompt: `What are the key ingredients in the ${product.title}?`,
      kind: "faq",
    },
  ],
  hookFeatures: (product) => [
    {
      pill: {
        id: "upsell-moist-serum",
        label: "See a serum to layer under",
        prompt: `What serum should I layer under the ${product.title}?`,
        kind: "upsell",
      },
    },
    {
      pill: {
        id: "upsell-moist-counterpart",
        label: "See the day/night counterpart",
        prompt: `Is there a day or night counterpart to the ${product.title}?`,
        kind: "upsell",
      },
    },
  ],
  bundles: (product, catalog) =>
    routineBundlePills(product, catalog, "What pairs with this moisturizer?"),
};

const SUNSCREEN_LANE: LanePack = {
  confidenceFaqs: (product) => [
    {
      id: "faq-sun-spf",
      label: "What SPF is it?",
      prompt: `What SPF does the ${product.title} provide, and is it broad-spectrum?`,
      kind: "faq",
    },
    {
      id: "faq-sun-cast",
      label: "Does it leave a white cast?",
      prompt: `Does the ${product.title} leave a white cast or feel greasy?`,
      kind: "faq",
    },
    {
      id: "faq-sun-water",
      label: "Is it water-resistant?",
      prompt: `Is the ${product.title} water-resistant, and how often should I reapply?`,
      kind: "faq",
    },
    {
      id: "faq-sun-makeup",
      label: "Can I wear it under makeup?",
      prompt: `Can I wear the ${product.title} under makeup, and where does it go in my routine?`,
      kind: "faq",
    },
  ],
  hookFeatures: (product) => [
    {
      pill: {
        id: "upsell-sun-higher",
        label: "See a higher-SPF option",
        prompt: `Show me a higher-SPF option than the ${product.title}.`,
        kind: "upsell",
      },
    },
    {
      pill: {
        id: "upsell-sun-tinted",
        label: "See a tinted option",
        prompt: `Is there a tinted version of the ${product.title}?`,
        kind: "upsell",
      },
    },
  ],
  bundles: (product, catalog) =>
    routineBundlePills(product, catalog, "What to layer under it?"),
};

const EYE_LANE: LanePack = {
  confidenceFaqs: (product) => [
    {
      id: "faq-eye-target",
      label: "What does it target?",
      prompt: `Does the ${product.title} target dark circles, puffiness, or fine lines?`,
      kind: "faq",
    },
    {
      id: "faq-eye-apply",
      label: "How do I apply it?",
      prompt: `How much of the ${product.title} should I use, and how do I apply it around the eyes?`,
      kind: "faq",
    },
    {
      id: "faq-eye-sensitive",
      label: "Is it gentle around the eyes?",
      prompt: `Is the ${product.title} gentle and fragrance-free enough for the delicate eye area?`,
      kind: "faq",
    },
    {
      id: "faq-eye-when",
      label: "When in my routine?",
      prompt: `When in my routine should I use the ${product.title}?`,
      kind: "faq",
    },
  ],
  hookFeatures: (product) => [
    {
      pill: {
        id: "upsell-eye-serum",
        label: "See a matching serum",
        prompt: `What serum pairs well with the ${product.title}?`,
        kind: "upsell",
      },
    },
  ],
  bundles: (product, catalog) =>
    routineBundlePills(product, catalog, "What pairs with this eye cream?"),
};

const SOFTENER_LANE: LanePack = {
  confidenceFaqs: (product) => [
    {
      id: "faq-soft-what",
      label: "What does a softener do?",
      prompt: `What does the ${product.title} do, and where does it fit in my routine?`,
      kind: "faq",
    },
    {
      id: "faq-soft-how",
      label: "How do I use it?",
      prompt: `How do I apply the ${product.title} — with my hands or a cotton pad?`,
      kind: "faq",
    },
    {
      id: "faq-soft-skintype",
      label: "Is it right for my skin type?",
      prompt: `Is the ${product.title} suitable for my skin type?`,
      kind: "faq",
    },
    {
      id: "faq-soft-when",
      label: "When in my routine?",
      prompt: `When in my routine should I use the ${product.title}?`,
      kind: "faq",
    },
  ],
  hookFeatures: (product) => [
    {
      pill: {
        id: "upsell-soft-serum",
        label: "See a serum to follow with",
        prompt: `What serum should I use after the ${product.title}?`,
        kind: "upsell",
      },
    },
  ],
  bundles: (product, catalog) =>
    routineBundlePills(product, catalog, "What pairs with this softener?"),
};

const MASK_LANE: LanePack = {
  confidenceFaqs: (product) => [
    {
      id: "faq-mask-frequency",
      label: "How often should I use it?",
      prompt: `How often should I use the ${product.title}?`,
      kind: "faq",
    },
    {
      id: "faq-mask-when",
      label: "When in my routine?",
      prompt: `When in my routine should I use the ${product.title}, and do I rinse it off?`,
      kind: "faq",
    },
    {
      id: "faq-mask-target",
      label: "What does it do?",
      prompt: `What does the ${product.title} do for my skin?`,
      kind: "faq",
    },
    {
      id: "faq-mask-skintype",
      label: "Which skin types is it for?",
      prompt: `Which skin types is the ${product.title} best suited to?`,
      kind: "faq",
    },
  ],
  hookFeatures: (product) => [
    {
      pill: {
        id: "upsell-mask-daily",
        label: "See a daily treatment",
        prompt: `Show me a daily treatment I can use alongside the ${product.title}.`,
        kind: "upsell",
      },
    },
  ],
  bundles: (product, catalog) =>
    routineBundlePills(product, catalog, "What to use after masking?"),
};

const SET_LANE: LanePack = {
  confidenceFaqs: (product) => [
    {
      id: "faq-set-forwho",
      label: "Who is this set for?",
      prompt: `Who is the ${product.title} best suited for?`,
      kind: "faq",
    },
    {
      id: "faq-set-value",
      label: "Is it good value?",
      prompt: `Is the ${product.title} better value than buying the products separately?`,
      kind: "faq",
    },
    {
      id: "faq-set-order",
      label: "What order do I use them?",
      prompt: `In what order should I use the products in the ${product.title}?`,
      kind: "faq",
    },
    {
      id: "faq-set-skintype",
      label: "Is it right for my skin type?",
      prompt: `Is the ${product.title} suitable for my skin type?`,
      kind: "faq",
    },
  ],
  // A set is already a bundle, so there's no meaningful step-up hook.
  hookFeatures: () => [],
  bundles: (product) => [
    {
      id: "bundle-set-individual",
      label: "Show individual products",
      prompt: `Can I buy the products in the ${product.title} individually?`,
      kind: "bundle",
    },
    {
      id: "bundle-set-more",
      label: "What else pairs with it?",
      prompt: `What else pairs well with the ${product.title}?`,
      kind: "bundle",
    },
  ],
};

const DEFAULT_LANE: LanePack = {
  confidenceFaqs: (product) => [
    {
      id: "faq-default-skintype",
      label: "Is it right for my skin type?",
      prompt: `Is the ${product.title} suitable for my skin type?`,
      kind: "faq",
    },
    {
      id: "faq-default-how",
      label: "How do I use it?",
      prompt: `How and when do I use the ${product.title} in my routine?`,
      kind: "faq",
    },
    {
      id: "faq-default-ingredients",
      label: "What are the key ingredients?",
      prompt: `What are the key ingredients in the ${product.title}?`,
      kind: "faq",
    },
    {
      id: "faq-default-results",
      label: "What results can I expect?",
      prompt: `What results can I expect from the ${product.title}, and how soon?`,
      kind: "faq",
    },
  ],
  hookFeatures: (product) => [
    {
      pill: {
        id: "upsell-default-routine",
        label: "See how it fits a routine",
        prompt: `How does the ${product.title} fit into a complete skincare routine?`,
        kind: "upsell",
      },
    },
  ],
  bundles: (product, catalog) =>
    routineBundlePills(product, catalog, "What pairs with this?"),
};

const LANE_PACKS: Record<Lane, LanePack> = {
  cleanser: CLEANSER_LANE,
  serum: SERUM_LANE,
  moisturizer: MOISTURIZER_LANE,
  sunscreen: SUNSCREEN_LANE,
  eye: EYE_LANE,
  softener: SOFTENER_LANE,
  mask: MASK_LANE,
  set: SET_LANE,
  default: DEFAULT_LANE,
};

/* ---------- hook-feature picker ----------
 *
 * Returns the lane's hook-feature pool ordered by relevance: every
 * `match`ing pill first (in the order they're declared in the lane
 * pack), then the unconditional defaults. */

function rankHookFeatures(
  features: HookFeature[],
  product: CatalogProduct,
): PdpNbaPill[] {
  const matched: PdpNbaPill[] = [];
  const unmatched: PdpNbaPill[] = [];
  for (const feature of features) {
    if (!feature.match) {
      unmatched.push(feature.pill);
      continue;
    }
    if (feature.match(product)) {
      matched.push(feature.pill);
    }
  }
  return [...matched, ...unmatched];
}

/* ---------- set builders ----------
 *
 * The three sets share a common skeleton (lead + hygiene + open) and
 * differ in how they fill the remaining two contextual slots:
 *   - Set A: hook-feature[0] + bundle[0]   (default lead: discovery + routine)
 *   - Set B: confidence-FAQ[1] + hook-feature[1] (fit-for-use deep-dive)
 *   - Set C: confidence-FAQ[2] + bundle[1]  (objection-handling + routine)
 * Inside the rotation, every contextual pill has a unique id so a single
 * regenerator click never re-shows the same pill. */

function buildSetA(
  product: CatalogProduct,
  catalog: CatalogProduct[],
  pack: LanePack,
): PdpNbaPill[] {
  const hookPool = rankHookFeatures(pack.hookFeatures(product), product);
  const bundlePool = pack.bundles(product, catalog);
  const faqPool = pack.confidenceFaqs(product);

  const pills: PdpNbaPill[] = [whatsInBoxPill(product)];

  const hook = pickByIndex(hookPool, 0);
  if (hook) {
    pills.push(hook);
  } else {
    // Lanes with no hook (e.g. sets): promote a confidence FAQ instead.
    const faq = pickByIndex(faqPool, 0);
    if (faq) pills.push(faq);
  }

  const bundle = pickByIndex(bundlePool, 0);
  if (bundle) pills.push(bundle);

  pills.push(HYGIENE_ROTATION[0]);
  pills.push(openPill(product, "a"));

  return pills;
}

function buildSetB(
  product: CatalogProduct,
  catalog: CatalogProduct[],
  pack: LanePack,
): PdpNbaPill[] {
  const hookPool = rankHookFeatures(pack.hookFeatures(product), product);
  const faqPool = pack.confidenceFaqs(product);

  const pills: PdpNbaPill[] = [];

  const faq1 = pickByIndex(faqPool, 0);
  if (faq1) pills.push(faq1);

  const faq2 = pickByIndex(faqPool, 1);
  if (faq2) pills.push(faq2);

  const hook = pickByIndex(hookPool, 1) ?? pickByIndex(hookPool, 0);
  if (hook) {
    pills.push(hook);
  } else {
    // Lanes with no hook: substitute a third confidence FAQ.
    const faq3 = pickByIndex(faqPool, 2);
    if (faq3) pills.push(faq3);
  }

  pills.push(HYGIENE_ROTATION[1]);
  pills.push(openPill(product, "b"));

  // Falling back for very small lanes that can't fill three contextual
  // slots. Pad with the catalog-relative compare so the rotation never
  // ships with fewer than five pills.
  if (pills.length < 5) {
    const compare = findStepUpSibling(product, catalog);
    if (compare) {
      pills.splice(2, 0, {
        id: "upsell-fallback-stepup",
        label: `Compare to ${shortenTitle(compare.title, 28)}`,
        prompt: `How does the ${product.title} compare to the ${compare.title}?`,
        kind: "upsell",
      });
    }
  }

  return pills;
}

function buildSetC(
  product: CatalogProduct,
  catalog: CatalogProduct[],
  pack: LanePack,
): PdpNbaPill[] {
  const hookPool = rankHookFeatures(pack.hookFeatures(product), product);
  const bundlePool = pack.bundles(product, catalog);
  const faqPool = pack.confidenceFaqs(product);

  const pills: PdpNbaPill[] = [];

  const faq = pickByIndex(faqPool, 2);
  if (faq) pills.push(faq);

  const hook = pickByIndex(hookPool, 2) ?? pickByIndex(hookPool, 0);
  if (hook) {
    pills.push(hook);
  } else {
    const faq2 = pickByIndex(faqPool, 3);
    if (faq2) pills.push(faq2);
  }

  const bundle = pickByIndex(bundlePool, 1) ?? pickByIndex(bundlePool, 0);
  if (bundle) pills.push(bundle);

  pills.push(HYGIENE_ROTATION[2]);
  pills.push(openPill(product, "c"));

  return pills;
}

/**
 * Build the contextual NBA pill set for the PDP Ask Assistant module.
 *
 * The pill content is lane-aware: cleansers get gentleness / frequency /
 * makeup-removal FAQs; serums get target / results / ingredient FAQs;
 * moisturizers get skin-type / day-night FAQs; sunscreens get SPF /
 * white-cast / water-resistance FAQs; eye care gets application FAQs;
 * masks get frequency / routine FAQs; sets get value / order FAQs; and a
 * generic default lane covers anything uncategorised. `setIndex` cycles
 * through the three curated rotations; the lead + open pills stay stable
 * so shoppers can always find them.
 */
export function buildPdpNbaPills(
  product: CatalogProduct,
  catalog: CatalogProduct[],
  setIndex = 0,
): PdpNbaPill[] {
  const lane = resolveLane(product);
  const pack = LANE_PACKS[lane];
  const builders = [buildSetA, buildSetB, buildSetC];
  const builder =
    builders[((setIndex % builders.length) + builders.length) % builders.length];
  return builder(product, catalog, pack);
}

/** Total number of curated rotations, exported for telemetry & tests. */
export const PDP_NBA_PILL_SET_COUNT = 3;
