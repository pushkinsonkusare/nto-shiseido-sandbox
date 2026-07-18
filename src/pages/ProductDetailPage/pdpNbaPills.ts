import type { CatalogProduct } from "../../catalog/catalog";

export type PdpNbaPillKind =
  | "faq" // Product FAQ (e.g. "Is this 4K?", "What's in the box?")
  | "upsell" // Step-up to a higher-tier sibling, or a feature-search step-up
  | "downsell" // Step-down to a cheaper sibling
  | "bundle" // Combo / kit / accessory bundling
  | "hygiene" // Returns, warranty, shipping
  | "open"; // "Ask me anything" catch-all — has no arrow icon

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

/** Wrap-around index pick — keeps set-rotation logic concise. */
function pickByIndex<T>(pool: readonly T[], index: number): T | null {
  if (pool.length === 0) return null;
  const len = pool.length;
  return pool[((index % len) + len) % len];
}

function hasTag(tags: readonly string[] | undefined, token: string): boolean {
  if (!tags) return false;
  return tags.includes(token);
}

/* ---------- catalog-relative fallbacks ----------
 *
 * Retained from the previous implementation so the lane-driven pills can
 * fall back to a real sibling SKU when a lane has no hook-feature match
 * (e.g. an "Accessories" SKU mistagged into a flagship category). The
 * primary upsell/bundle paths now go through `LANE_PACKS`. */

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

/* ---------- lane resolver ---------- */

type Lane = "drone" | "action_cam" | "gimbal" | "mic" | "accessory";

/**
 * Pick the NBA content lane for a product. We prefer `productTypeGroup`
 * because it's already canonicalised at catalog-load time, falling back
 * to a category regex (mics aren't a group, and freshly-tagged SKUs may
 * land with an empty group).
 */
function resolveLane(product: CatalogProduct): Lane {
  const group = product.productTypeGroup;
  if (group === "drone") return "drone";
  if (group === "action_camera") return "action_cam";
  if (group === "gimbal") return "gimbal";

  const category = (product.category ?? "").toLowerCase();
  if (/microphone|\bmic\b/.test(category)) return "mic";
  if (/drone/.test(category)) return "drone";
  if (/action/.test(category)) return "action_cam";
  if (/gimbal/.test(category)) return "gimbal";

  // Title-level rescue for misclassified rows (mics commonly land as
  // "Accessories" in the CSV but should still get the mic-lane prompts).
  const title = product.title.toLowerCase();
  if (/microphone|\bmic\b/.test(title)) return "mic";

  return "accessory";
}

/* ---------- universal pill pools ----------
 *
 * Every set surfaces one in-box pill, one hygiene pill, and the open
 * fallback. The hygiene pool rotates by `setIndex` so a shopper who
 * spins the regenerator sees a different policy framing each time. */

function whatsInBoxPill(product: CatalogProduct): PdpNbaPill {
  return {
    id: "faq-whats-in-box",
    label: "What's in the box?",
    prompt: `What's in the box with the ${product.title}?`,
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
    prompt: "Is there a warranty included? What does DJI Care cover?",
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
 *   - `confidenceFaqs`: durability / fit-for-use / regulatory FAQs that
 *     defuse the most common pre-purchase hesitations for the category.
 *   - `hookFeatures`: feature-search upsells. Order matters — the first
 *     entry whose `match` returns true is preferred for set A; subsequent
 *     sets cycle through the rest.
 *   - `bundles`: lane-flavored bundle/accessory pills. Always returns at
 *     least one entry so the bundle slot in the rotation never goes dark.
 */

type HookFeature = {
  pill: PdpNbaPill;
  /** Optional tier/series/subtype gate. Returns true when the pill fits this product. */
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

const DRONE_LANE: LanePack = {
  confidenceFaqs: (product) => [
    {
      id: "faq-drone-registration",
      label: "Do I need to register it?",
      prompt: `Do I need to register the ${product.title} with the FAA / CASA before I fly?`,
      kind: "faq",
    },
    {
      id: "faq-drone-battery",
      label: "How long does the battery last?",
      prompt: `How long does the ${product.title} fly on a single charge, and how long does it take to recharge?`,
      kind: "faq",
    },
    {
      id: "faq-drone-wind",
      label: "Can it handle wind?",
      prompt: `Can the ${product.title} fly safely in coastal or mountain wind, and what's its wind resistance rating?`,
      kind: "faq",
    },
    {
      id: "faq-drone-crash",
      label: "What if I crash it?",
      prompt: `If I crash the ${product.title}, is there DJI Care or accidental damage coverage available?`,
      kind: "faq",
    },
    {
      id: "faq-drone-noise",
      label: "Is it noisy?",
      prompt: `How loud is the ${product.title} in flight — will it disturb people or wildlife nearby?`,
      kind: "faq",
    },
  ],
  hookFeatures: (product) => [
    {
      pill: {
        id: "upsell-drone-omnidirectional",
        label: "See drones with 360° obstacle sensing",
        prompt:
          "Show me drones with omnidirectional obstacle sensing for safer flying.",
        kind: "upsell",
      },
    },
    {
      pill: {
        id: "upsell-drone-skip-registration",
        label: "See ultra-light drones (no registration)",
        prompt:
          "Show me ultra-light drones under the FAA / CASA registration weight that I can fly without registering.",
        kind: "upsell",
      },
      match: (p) =>
        p.tier === "beginner" ||
        p.series === "mini" ||
        p.series === "neo",
    },
    {
      pill: {
        id: "upsell-drone-fpv",
        label: "See cinematic FPV drones",
        prompt:
          "Show me cinematic FPV drones with motion-controller flying for first-person video.",
        kind: "upsell",
      },
      match: (p) =>
        p.series === "avata" || hasTag(p.subtypes, "drone_fpv"),
    },
    {
      pill: {
        id: "upsell-drone-cinema",
        label: "See drones with a Hasselblad sensor",
        prompt:
          "Show me drones with a Hasselblad camera or 4/3 CMOS sensor for cinema-grade footage.",
        kind: "upsell",
      },
      match: (p) =>
        p.tier === "pro" ||
        hasTag(p.subtypes, "drone_cinema") ||
        hasTag(p.useCaseTags, "cinematic"),
    },
    {
      pill: {
        id: "upsell-drone-range",
        label: "See drones with longer flight time",
        prompt:
          "Show me drones with the longest flight time and transmission range in this price range.",
        kind: "upsell",
      },
    },
  ],
  bundles: (product, catalog) => {
    const combo = findCombo(product, catalog);
    const pills: PdpNbaPill[] = [];
    if (combo) {
      pills.push({
        id: "bundle-drone-combo",
        label: `Show the ${shortenTitle(combo.title, 28)}`,
        prompt: `Tell me about the ${combo.title} and what extras it includes.`,
        kind: "bundle",
      });
    }
    pills.push({
      id: "bundle-drone-batteries",
      label: "Pair it with extra batteries",
      prompt: `Suggest extra batteries and a charging hub for the ${product.title}.`,
      kind: "bundle",
    });
    pills.push({
      id: "bundle-drone-kit",
      label: "Suggest a complete fly-more kit",
      prompt: `Suggest a complete fly-more kit (batteries, ND filters, case) to pair with the ${product.title}.`,
      kind: "bundle",
    });
    return pills;
  },
};

const ACTION_CAM_LANE: LanePack = {
  confidenceFaqs: (product) => [
    {
      id: "faq-cam-waterproof",
      label: "How deep can it go underwater?",
      prompt: `How deep can the ${product.title} go underwater without a separate housing?`,
      kind: "faq",
    },
    {
      id: "faq-cam-mounts",
      label: "Will my GoPro mounts fit?",
      prompt: `Is the ${product.title} compatible with standard GoPro-style mounts and what mounts come in the box?`,
      kind: "faq",
    },
    {
      id: "faq-cam-stabilization",
      label: "How is stabilisation on a bike or ski?",
      prompt: `How well does the ${product.title} stabilise footage on a bike, motorcycle or ski helmet?`,
      kind: "faq",
    },
    {
      id: "faq-cam-battery",
      label: "How long does it record per battery?",
      prompt: `How long does the ${product.title} record on one battery at 4K, and does it overheat?`,
      kind: "faq",
    },
    {
      id: "faq-cam-lowlight",
      label: "How is it in low light?",
      prompt: `How well does the ${product.title} handle low-light and night-time scenes?`,
      kind: "faq",
    },
  ],
  hookFeatures: (product) => [
    {
      pill: {
        id: "upsell-cam-dive-rated",
        label: "See action cams rated for diving",
        prompt:
          "Show me action cameras rated for diving 20m or deeper without a separate underwater housing.",
        kind: "upsell",
      },
    },
    {
      pill: {
        id: "upsell-cam-360",
        label: "See 360° action cameras",
        prompt:
          "Show me 360° action cameras for invisible-selfie-stick and reframe-anywhere shots.",
        kind: "upsell",
      },
      match: (p) =>
        hasTag(p.subtypes, "cam_360") || p.series === "osmo_360",
    },
    {
      pill: {
        id: "upsell-cam-pocket",
        label: "See pocket vlogging cams",
        prompt:
          "Show me pocket-sized vlogging cameras with a flip screen and built-in gimbal stabilisation.",
        kind: "upsell",
      },
      match: (p) =>
        hasTag(p.subtypes, "cam_pocket") || p.series === "osmo_pocket",
    },
    {
      pill: {
        id: "upsell-cam-pro",
        label: "See action cams with 10-bit log",
        prompt:
          "Show me action cameras that shoot 10-bit HDR or D-Log for color grading.",
        kind: "upsell",
      },
      match: (p) => p.tier === "pro",
    },
    {
      pill: {
        id: "upsell-cam-magnetic",
        label: "See action cams with magnetic mounts",
        prompt:
          "Show me action cameras with magnetic quick-release mounting for fast scene changes.",
        kind: "upsell",
      },
    },
  ],
  bundles: (product, catalog) => {
    const combo = findCombo(product, catalog);
    const pills: PdpNbaPill[] = [];
    if (combo) {
      pills.push({
        id: "bundle-cam-combo",
        label: `Show the ${shortenTitle(combo.title, 28)}`,
        prompt: `Tell me about the ${combo.title} and what extras it includes.`,
        kind: "bundle",
      });
    }
    pills.push({
      id: "bundle-cam-mic",
      label: "Pair it with a wireless mic",
      prompt: `Suggest a wireless microphone that pairs with the ${product.title}.`,
      kind: "bundle",
    });
    pills.push({
      id: "bundle-cam-mounts",
      label: "Suggest a mount + battery kit",
      prompt: `Suggest a mount and extra-battery kit to pair with the ${product.title}.`,
      kind: "bundle",
    });
    return pills;
  },
};

const GIMBAL_LANE: LanePack = {
  confidenceFaqs: (product) => [
    {
      id: "faq-gimbal-fit",
      label: "Will my phone or camera fit?",
      prompt: `Will my phone, mirrorless camera or lens combo fit and balance on the ${product.title}?`,
      kind: "faq",
    },
    {
      id: "faq-gimbal-battery",
      label: "How long does the battery last?",
      prompt: `How long does the ${product.title} run on a full charge?`,
      kind: "faq",
    },
    {
      id: "faq-gimbal-tracking",
      label: "Does ActiveTrack actually work?",
      prompt: `How well does ActiveTrack on the ${product.title} keep moving subjects in frame?`,
      kind: "faq",
    },
    {
      id: "faq-gimbal-travel",
      label: "Is it travel-friendly?",
      prompt: `Is the ${product.title} travel-friendly — does it fold down and fit in a daypack?`,
      kind: "faq",
    },
    {
      id: "faq-gimbal-app",
      label: "What can I do with the app?",
      prompt: `What does the companion app for the ${product.title} let me do (gestures, timelapse, tracking)?`,
      kind: "faq",
    },
  ],
  hookFeatures: (product) => [
    {
      pill: {
        id: "upsell-gimbal-mobile-tracking",
        label: "See gimbals with built-in tracking",
        prompt:
          "Show me phone gimbals with built-in subject tracking and gesture control.",
        kind: "upsell",
      },
      match: (p) =>
        p.productType === "mobile_gimbal" ||
        hasTag(p.subtypes, "gimbal_mobile"),
    },
    {
      pill: {
        id: "upsell-gimbal-camera-payload",
        label: "See gimbals for full-frame cameras",
        prompt:
          "Show me gimbals that handle full-frame mirrorless setups with cinema lenses.",
        kind: "upsell",
      },
      match: (p) =>
        p.productType === "camera_gimbal" || p.tier === "pro",
    },
    {
      pill: {
        id: "upsell-gimbal-ronin",
        label: "See pro Ronin RS-series gimbals",
        prompt:
          "Show me pro Ronin RS-series gimbals with focus motors and image transmission.",
        kind: "upsell",
      },
    },
  ],
  bundles: (product, catalog) => {
    const combo = findCombo(product, catalog);
    const pills: PdpNbaPill[] = [];
    if (combo) {
      pills.push({
        id: "bundle-gimbal-combo",
        label: `Show the ${shortenTitle(combo.title, 28)}`,
        prompt: `Tell me about the ${combo.title} and what extras it includes.`,
        kind: "bundle",
      });
    }
    pills.push({
      id: "bundle-gimbal-grip",
      label: "Pair it with a tripod grip",
      prompt: `Suggest a tripod grip extension and case for the ${product.title}.`,
      kind: "bundle",
    });
    pills.push({
      id: "bundle-gimbal-kit",
      label: "Suggest a creator kit",
      prompt: `Suggest a creator kit (mic, light, case) to pair with the ${product.title}.`,
      kind: "bundle",
    });
    return pills;
  },
};

const MIC_LANE: LanePack = {
  confidenceFaqs: (product) => [
    {
      id: "faq-mic-compat",
      label: "Does it work with iPhone, Android & cameras?",
      prompt: `Does the ${product.title} plug into iPhone, Android phones and standard cameras out of the box?`,
      kind: "faq",
    },
    {
      id: "faq-mic-range",
      label: "How far is the wireless range?",
      prompt: `What's the real-world wireless range of the ${product.title} before audio drops out?`,
      kind: "faq",
    },
    {
      id: "faq-mic-backup",
      label: "Does it record locally as backup?",
      prompt: `Does the ${product.title} record audio on the transmitter as a backup if the wireless signal drops?`,
      kind: "faq",
    },
    {
      id: "faq-mic-battery",
      label: "How long does a charge last?",
      prompt: `How long does a single charge last on the ${product.title} for a full shoot day?`,
      kind: "faq",
    },
    {
      id: "faq-mic-noise",
      label: "How does it handle wind & noise?",
      prompt: `How well does the ${product.title} handle wind and background noise — what windshields are included?`,
      kind: "faq",
    },
  ],
  hookFeatures: (product) => [
    {
      pill: {
        id: "upsell-mic-32bit",
        label: "See mics with 32-bit float recording",
        prompt:
          "Show me wireless mics with 32-bit float recording so I never clip my audio.",
        kind: "upsell",
      },
    },
    {
      pill: {
        id: "upsell-mic-two-tx",
        label: "See two-transmitter interview kits",
        prompt:
          "Show me wireless mic kits with two transmitters for interviews and dual-host recording.",
        kind: "upsell",
      },
    },
    {
      pill: {
        id: "upsell-mic-range",
        label: "See long-range wireless mics",
        prompt:
          "Show me wireless mics with the longest reliable range for outdoor and event shoots.",
        kind: "upsell",
      },
    },
  ],
  bundles: (product, catalog) => {
    const combo = findCombo(product, catalog);
    const pills: PdpNbaPill[] = [];
    if (combo) {
      pills.push({
        id: "bundle-mic-combo",
        label: `Show the ${shortenTitle(combo.title, 28)}`,
        prompt: `Tell me about the ${combo.title} and what extras it includes.`,
        kind: "bundle",
      });
    }
    pills.push({
      id: "bundle-mic-cam",
      label: "Pair it with an action cam",
      prompt: `Suggest an action camera that pairs well with the ${product.title}.`,
      kind: "bundle",
    });
    pills.push({
      id: "bundle-mic-charging",
      label: "Suggest a charging case kit",
      prompt: `Suggest a charging case and accessory kit for the ${product.title}.`,
      kind: "bundle",
    });
    return pills;
  },
};

const ACCESSORY_LANE: LanePack = {
  confidenceFaqs: (product) => {
    const compatHint =
      product.compatibleWithModels.length > 0
        ? product.compatibleWithModels[0]
        : product.compatibleWithType.length > 0
          ? product.compatibleWithType[0].replace(/_/g, " ")
          : "my gear";
    return [
      {
        id: "faq-acc-compat",
        label: `Will it work with ${shortenTitle(compatHint, 24)}?`,
        prompt: `Will the ${product.title} work with my ${compatHint}? What models is it compatible with?`,
        kind: "faq",
      },
      {
        id: "faq-acc-difference",
        label: "What's different vs the standard version?",
        prompt: `How is the ${product.title} different from the standard or previous version, and is it worth the upgrade?`,
        kind: "faq",
      },
      {
        id: "faq-acc-genuine",
        label: "Is this genuine DJI?",
        prompt: `Is the ${product.title} a genuine DJI accessory, and is it covered by DJI's warranty?`,
        kind: "faq",
      },
      {
        id: "faq-acc-install",
        label: "How do I install it?",
        prompt: `How do I install or set up the ${product.title} — does it need firmware updates?`,
        kind: "faq",
      },
    ];
  },
  // Accessories don't get a hook-feature upsell — there's no meaningful
  // step-up to a "better" battery / case. The set builders detect an
  // empty pool and substitute a second confidence FAQ instead.
  hookFeatures: () => [],
  bundles: (product, catalog) => {
    const combo = findCombo(product, catalog);
    const pills: PdpNbaPill[] = [];
    if (combo) {
      pills.push({
        id: "bundle-acc-combo",
        label: `Show the ${shortenTitle(combo.title, 28)}`,
        prompt: `Tell me about the ${combo.title} and what extras it includes.`,
        kind: "bundle",
      });
    }
    pills.push({
      id: "bundle-acc-host-kit",
      label: "Show a complete kit around my host",
      prompt: `Show me a complete kit built around the host product the ${product.title} is designed for.`,
      kind: "bundle",
    });
    pills.push({
      id: "bundle-acc-related",
      label: "What other accessories pair with this?",
      prompt: `What other accessories pair well with the ${product.title}?`,
      kind: "bundle",
    });
    return pills;
  },
};

const LANE_PACKS: Record<Lane, LanePack> = {
  drone: DRONE_LANE,
  action_cam: ACTION_CAM_LANE,
  gimbal: GIMBAL_LANE,
  mic: MIC_LANE,
  accessory: ACCESSORY_LANE,
};

/* ---------- hook-feature picker ----------
 *
 * Returns the lane's hook-feature pool ordered by relevance: every
 * `match`ing pill first (in the order they're declared in the lane
 * pack), then the unconditional defaults. This lets the most specific
 * upsell — e.g. "FPV drones" for an Avata PDP — land in set A. */

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
 * The three sets share a common skeleton (in-box + hygiene + open) and
 * differ in how they fill the remaining two contextual slots:
 *   - Set A: hook-feature[0] + bundle[0]   (default lead — discovery + kit)
 *   - Set B: confidence-FAQ[1] + hook-feature[1] (durability deep-dive)
 *   - Set C: confidence-FAQ[2] + bundle[1]  (objection-handling + kit)
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
    // Accessory lane fallback — promote a confidence FAQ into the slot.
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
    // Accessory lane — substitute a third confidence FAQ.
    const faq3 = pickByIndex(faqPool, 2);
    if (faq3) pills.push(faq3);
  }

  pills.push(HYGIENE_ROTATION[1]);
  pills.push(openPill(product, "b"));

  // Falling back for very small lanes that can't fill three contextual
  // slots — pad with the catalog-relative compare so the rotation never
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
 * The pill content is now lane-aware: drones get FAA / wind / DJI Care
 * confidence FAQs and obstacle-sensing-style hook-feature upsells; action
 * cameras get waterproof / mount / stabilisation FAQs and dive-rated /
 * 360 / pocket upsells; gimbals get fit / tracking FAQs; mics get
 * iPhone / range / backup FAQs; accessories skip the upsell pill in
 * favour of compatibility-focused FAQs. `setIndex` cycles through the
 * three curated rotations; the "What's in the box?" + open pills stay
 * stable so shoppers can always find them.
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

/** Total number of curated rotations — exported for telemetry & tests. */
export const PDP_NBA_PILL_SET_COUNT = 3;
