/**
 * Next Best Action (NBA) logic for the Wingman plan page selection.
 *
 * When the shopper ticks product checkboxes (in "Create your own kit"
 * or the combo tiles), the picks land in `wingmanSelectionStore` and
 * surface as pills in the agent bar. This module decides what the
 * shopper most likely wants to do next with that selection and returns
 * a small set of tappable actions rendered right below the pills:
 *
 *   • 1 product          → contextual FAQ chips ("Is it waterproof?",
 *                          "Is it beginner friendly?", …). Tapping asks
 *                          Wingman and gets a templated answer built
 *                          from the product's own catalog data.
 *   • 2-3, same category  → "Compare these" — drops a side-by-side
 *                          comparison into the chat thread.
 *   • 2-3, mixed category → a single "Ask Wingman about these" fallback
 *                          (a cross-category spec comparison isn't
 *                          meaningful).
 *
 * All answers are templated from `CatalogProduct` fields (specs,
 * useCaseTags, tier, …) so they're deterministic and instant — no
 * network / LLM round-trip. Wording can be upgraded later without
 * touching the resolver shape.
 */

import type { CatalogProduct, ProductTier } from "../../catalog/catalog";
import { isAccessoryCompatibleWithCoreStrict } from "../../components/SidecarAssistant/conversation/flow";

export type WingmanNbaItem = {
  /** Stable id for the React key. */
  id: string;
  /** Button copy shown in the NBA row. */
  label: string;
  /** Fired when the shopper taps the chip. */
  run: () => void;
};

/**
 * Callbacks the resolver's action closures need. Kept as a dependency
 * bag so `resolveSelectionNbas` stays a pure function of (products,
 * context, deps) and the page owns the actual chat / kit side-effects.
 */
export type WingmanNbaDeps = {
  /** Append a shopper question + the templated Wingman answer to chat. */
  askInChat: (question: string, answer: string) => void;
  /** Remove the given slugs from the active kit AND untick them. */
  removeFromKit: (slugs: string[]) => void;
  /** Add a browsed product into the (custom) kit. */
  addToKit: (slug: string) => void;
  /** Swap an in-kit product for a higher-tier alternative in place. */
  swapForBetter: (oldSlug: string, newSlug: string) => void;
  /** Open the side-by-side comparison panel for the given products.
   * Comparison is a routine feature, so it opens a dedicated tabular
   * surface rather than dropping a text summary into the chat. */
  compareProducts: (products: CatalogProduct[]) => void;
  /** Open the reviews panel (YouTube videos + text reviews) for a
   * single product. Like comparison, a routine surface rather than a
   * chat exchange. */
  viewReviews: (product: CatalogProduct) => void;
};

/**
 * The active-kit context the resolver needs to decide whether a ticked
 * product is part of the kit the shopper is currently looking at, what
 * role it plays, and whether a higher-tier alternative exists.
 */
export type SelectionContext = {
  /** Slugs currently in the active kit (core + accessories). */
  activeKitSlugs: Set<string>;
  /** The active kit's core/hero product slug, if any. */
  coreSlug: string | null;
  /** Full catalog — used to look up a "better version". */
  catalog: CatalogProduct[];
};

/* ============================================================
 * Spec lookup helper
 * ============================================================ */

/**
 * Find the first spec whose label OR value mentions any of `keywords`
 * (case-insensitive). Returns the raw `CatalogSpec` so callers can
 * decide how to phrase the answer, or null when nothing matches.
 */
function findSpec(
  product: CatalogProduct,
  keywords: string[],
): { label: string; value: string } | null {
  const lowered = keywords.map((k) => k.toLowerCase());
  for (const spec of product.specs) {
    const haystack = `${spec.label} ${spec.value}`.toLowerCase();
    if (lowered.some((k) => haystack.includes(k))) return spec;
  }
  return null;
}

function hasTag(product: CatalogProduct, ...tags: string[]): boolean {
  const set = new Set([...product.useCaseTags, ...product.capabilities]);
  return tags.some((t) => set.has(t));
}

function isCore(product: CatalogProduct): boolean {
  return !product.isAccessory;
}

/* ============================================================
 * FAQ rule library
 * ============================================================ */

type FaqRule = {
  id: string;
  question: (product: CatalogProduct) => string;
  applies: (product: CatalogProduct) => boolean;
  answer: (product: CatalogProduct) => string;
};

const FAQ_RULES: FaqRule[] = [
  {
    id: "beginner",
    question: () => "Is this beginner friendly?",
    applies: (p) => isCore(p),
    answer: (p) => {
      if (p.tier === "beginner" || hasTag(p, "beginner")) {
        return `Yes — the ${p.title} is a great pick if you're just starting out. It's approachable out of the box with sensible defaults.`;
      }
      if (p.tier === "pro" || hasTag(p, "professional")) {
        return `The ${p.title} is a pro-tier product — very capable, but you'll get the most from it once you have some experience.`;
      }
      return `The ${p.title} is a solid intermediate choice — easy enough to start with, but with room to grow into.`;
    },
  },
  {
    id: "waterproof",
    question: () => "Is this waterproof?",
    applies: (p) =>
      p.productTypeGroup === "action_camera" ||
      p.productTypeGroup === "gimbal" ||
      p.productTypeGroup === "drone",
    answer: (p) => {
      if (hasTag(p, "waterproof", "underwater")) {
        const spec = findSpec(p, ["waterproof", "depth", "ip", "water"]);
        return spec
          ? `Yes — the ${p.title} is built for water. ${spec.label}: ${spec.value}.`
          : `Yes — the ${p.title} is built to handle water and wet conditions.`;
      }
      return `No — the ${p.title} isn't waterproof. Keep it dry, or pair it with a protective case for wet conditions.`;
    },
  },
  {
    id: "range",
    question: () => "What's the flight range and time?",
    applies: (p) => p.productTypeGroup === "drone",
    answer: (p) => {
      const range = findSpec(p, ["range", "distance", "transmission"]);
      const time = findSpec(p, ["flight time", "battery", "runtime"]);
      const parts: string[] = [];
      if (range) parts.push(`${range.label}: ${range.value}`);
      if (time) parts.push(`${time.label}: ${time.value}`);
      if (parts.length > 0) {
        return `For the ${p.title} — ${parts.join(" · ")}.`;
      }
      return `The ${p.title}'s exact range and flight time are on its product page — most DJI drones in this class cover several kilometres with 20-45 min of flight per battery.`;
    },
  },
  {
    id: "battery",
    question: (p) =>
      p.productTypeGroup === "drone"
        ? "How long is the flight time?"
        : "How long does the battery last?",
    applies: (p) => p.productTypeGroup !== "drone",
    answer: (p) => {
      const spec = findSpec(p, ["battery", "runtime", "flight time", "operating"]);
      return spec
        ? `For the ${p.title} — ${spec.label}: ${spec.value}.`
        : `Battery life for the ${p.title} varies with usage; check its product page for the rated runtime.`;
    },
  },
  {
    id: "video",
    question: () => "What video quality does it shoot?",
    applies: (p) =>
      p.productTypeGroup === "action_camera" || p.productTypeGroup === "drone",
    answer: (p) => {
      const spec = findSpec(p, ["resolution", "video", "photo", "sensor", "4k", "fps"]);
      if (spec) return `The ${p.title} — ${spec.label}: ${spec.value}.`;
      if (hasTag(p, "lowlight")) {
        return `The ${p.title} shoots high-resolution video and holds up well in low light.`;
      }
      return `The ${p.title} shoots crisp high-resolution video — the exact modes are listed on its product page.`;
    },
  },
  {
    id: "compatibility",
    question: (p) =>
      p.productType === "mobile_gimbal"
        ? "Will it hold my phone?"
        : "What does it work with?",
    applies: (p) => p.productTypeGroup === "gimbal",
    answer: (p) => {
      if (p.productType === "mobile_gimbal") {
        return `Yes — the ${p.title} is a phone gimbal, designed to hold and stabilise a smartphone.`;
      }
      if (p.productType === "camera_gimbal") {
        return `The ${p.title} is a camera gimbal, built for mirrorless / DSLR bodies. Check its payload rating against your camera on the product page.`;
      }
      const types = p.compatibleWithType.filter((t) => t !== "universal");
      return types.length > 0
        ? `The ${p.title} works with: ${types.join(", ")}.`
        : `The ${p.title} is a versatile stabiliser — see its product page for the supported devices.`;
    },
  },
  {
    id: "in-the-box",
    question: () => "What's in the box?",
    applies: (p) => p.inTheBox.length > 0,
    answer: (p) => {
      const items = p.inTheBox.slice(0, 6).join(", ");
      const more = p.inTheBox.length > 6 ? ", and more" : "";
      return `The ${p.title} box includes: ${items}${more}.`;
    },
  },
  {
    id: "value",
    question: () => "Is it worth the price?",
    applies: () => true,
    answer: (p) => {
      const ratingPart =
        p.rating != null
          ? ` It's rated ${p.rating.toFixed(1)}${p.reviewCount ? ` across ${p.reviewCount} reviews` : ""}.`
          : "";
      return `The ${p.title} is ${p.priceFormatted}.${ratingPart} For its ${p.tier} tier it's a strong value in the DJI lineup.`;
    },
  },
];

/** Max FAQ chips surfaced for a single-product selection. */
const MAX_FAQS = 4;

/**
 * Build the contextual FAQ list for a single product — the first
 * `MAX_FAQS` rules that apply, each carrying its templated answer.
 */
export function buildProductFaqs(
  product: CatalogProduct,
): Array<{ id: string; question: string; answer: string }> {
  return FAQ_RULES.filter((rule) => rule.applies(product))
    .slice(0, MAX_FAQS)
    .map((rule) => ({
      id: rule.id,
      question: rule.question(product),
      answer: rule.answer(product),
    }));
}

/* ============================================================
 * Free-text product Q&A
 * ============================================================
 *
 * Powers the chat bar's natural-language questions ("is this
 * waterproof?"). Deterministic and instant — routes the shopper's
 * question to the same FAQ_RULES answer wording used by the preset
 * chips, so a typed question and a tapped chip read identically.
 */

/* Fast lookup from FAQ rule id to its definition so the free-text
 * router can reuse a rule's `answer()` without re-declaring copy. */
const FAQ_RULES_BY_ID: Record<string, FaqRule> = Object.fromEntries(
  FAQ_RULES.map((rule) => [rule.id, rule]),
);

/* Leading imperative verbs that mark a plan-steering command rather
 * than a question — kept out of the "is this a question?" heuristic so
 * "make it cheaper" / "remove this" still flow to the steering path. */
const IMPERATIVE_LEAD =
  /^\s*(make|suggest|show|find|update|swap|replace|add|remove|change|give)\b/i;

/* Interrogative openers that mark a question even without a "?". */
const QUESTION_LEAD =
  /^\s*(is|are|does|do|can|could|will|would|what|what's|whats|how|which|why|should|has|have)\b/i;

/**
 * Heuristic for whether a typed message is a question about the
 * selected product (vs. a plan-steering command). True when the text
 * ends/contains a "?", opens with an interrogative, or references
 * "this"/"it" without leading with an imperative verb.
 */
export function isProductQuestion(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (IMPERATIVE_LEAD.test(trimmed)) return false;
  if (trimmed.includes("?")) return true;
  if (QUESTION_LEAD.test(trimmed)) return true;
  return /\b(this|it)\b/i.test(trimmed);
}

/* Ordered keyword → FAQ rule id map. First hit wins, so more specific
 * patterns sit above generic ones. */
const QUESTION_INTENTS: Array<{ match: RegExp; ruleId: string }> = [
  { match: /waterproof|underwater|submerge|\bwet\b|\bwater\b|\brain/i, ruleId: "waterproof" },
  { match: /beginner|\beasy\b|new to|starter|first[- ]?time|hard to use/i, ruleId: "beginner" },
  { match: /flight time|\brange\b|distance|how far|\breach\b/i, ruleId: "range" },
  { match: /battery|how long.*(last|go)|runtime|\bcharge\b/i, ruleId: "battery" },
  { match: /video|resolution|\b4k\b|\bfps\b|record|footage|photo|image quality/i, ruleId: "video" },
  { match: /work with|compatible|hold my phone|\bfit\b|\bmount\b|\battach\b/i, ruleId: "compatibility" },
  { match: /\bbox\b|included|come(s)? with|what do i get/i, ruleId: "in-the-box" },
  { match: /worth|\bprice\b|\bcost\b|expensive|\bvalue\b|\bcheap\b|budget/i, ruleId: "value" },
];

/**
 * Answer a free-text question about a single product, built entirely
 * from its catalog data. Routes the question to an existing FAQ rule
 * where possible, then falls back to a direct spec search, then to a
 * generic capability summary.
 */
export function answerProductQuestion(
  product: CatalogProduct,
  question: string,
): string {
  for (const { match, ruleId } of QUESTION_INTENTS) {
    if (!match.test(question)) continue;
    /* "In the box" only reads well when we actually have contents;
     * otherwise let it fall through to the spec/generic fallbacks. */
    if (ruleId === "in-the-box" && product.inTheBox.length === 0) continue;
    const rule = FAQ_RULES_BY_ID[ruleId];
    if (rule) return rule.answer(product);
  }

  /* Spec-search fallback: pull meaningful words from the question and
   * look for a spec whose label/value mentions any of them. */
  const words = question
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4);
  if (words.length > 0) {
    const spec = findSpec(product, words);
    if (spec) return `For the ${product.title} — ${spec.label}: ${spec.value}.`;
  }

  /* Generic capability summary. */
  return `The ${product.title} is a ${product.tier}-tier ${product.category} at ${product.priceFormatted}. Ask about specs like battery, video, range, or what's in the box.`;
}

/* ============================================================
 * Free-text comparison requests
 * ============================================================
 *
 * Powers "compare this with the action 5", "osmo 6 vs pocket 3",
 * "how does it stack up against the action 4?" typed into the chat.
 * When a comparison verb is present AND we can resolve the named
 * product(s) from the catalog, the page opens the side-by-side compare
 * table instead of answering as text or (worse) steering the plan into
 * a brand-new combo.
 */

/* Comparison verbs / phrasings. Deliberately excludes a bare "better"
 * (too ambiguous with "is this any good?") — an explicit "better than"
 * still counts. */
const COMPARE_INTENT =
  /\b(compare|comparison|compared|versus|vs\.?|difference(s)?|better\s+than|stack(s)?\s+up|side[-\s]?by[-\s]?side)\b/i;

/* Filler dropped before matching the remaining tokens against catalog
 * product names — the compare verbs themselves plus connectors and
 * self-references ("this"/"it") that point back at the anchor. */
const COMPARE_STOPWORDS = new Set([
  "compare", "comparison", "compared", "versus", "vs", "difference",
  "differences", "better", "than", "stack", "stacks", "up", "side",
  "by", "with", "to", "against", "and", "or", "between", "the", "a",
  "an", "this", "that", "it", "them", "these", "those", "my", "our",
  "please", "show", "me", "how", "does", "do", "is", "are", "which",
  "would", "should", "vs.", "dji",
]);

function compareTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t && !COMPARE_STOPWORDS.has(t));
}

/* Score how strongly a product's name matches the leftover query
 * tokens. Numeric/model tokens ("5", "3s") weigh double because they're
 * what disambiguates siblings ("action 5" vs "action 6"). */
function scoreProductNameMatch(
  queryTokens: string[],
  product: CatalogProduct,
): number {
  const nameTokens = new Set(
    `${product.title} ${product.model ?? ""} ${product.series ?? ""}`
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter(Boolean),
  );
  let score = 0;
  for (const token of queryTokens) {
    if (nameTokens.has(token)) score += /\d/.test(token) ? 2 : 1;
  }
  return score;
}

/**
 * Detect a comparison request and resolve the products to compare.
 *
 * Returns the ordered list to hand to the compare panel (the anchor
 * product the shopper is looking at, followed by the named competitor)
 * when both a comparison verb and a resolvable target are present, or
 * `null` when the message isn't a comparison. `unresolved` is set when a
 * comparison verb IS present but we couldn't match a target — the caller
 * can then prompt for a name instead of dropping into the steering path.
 */
export function detectComparisonRequest(
  question: string,
  anchors: CatalogProduct[],
  catalog: CatalogProduct[],
): { products: CatalogProduct[] | null; unresolved: boolean } {
  if (!COMPARE_INTENT.test(question)) {
    return { products: null, unresolved: false };
  }

  const anchorSlugs = new Set(anchors.map((p) => p.slug));
  const anchorTypes = new Set(anchors.map((p) => p.productType));
  const tokens = compareTokens(question);

  const scored = catalog
    .filter((p) => !anchorSlugs.has(p.slug))
    .map((p) => ({ p, score: scoreProductNameMatch(tokens, p) }))
    .filter((x) => x.score >= 2)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      /* Same score: prefer a product of the same kind as the anchor so
       * "osmo 5" next to an action cam resolves to the Action 5, not a
       * same-numbered product from another category. */
      const aAffinB = anchorTypes.has(b.p.productType) ? 1 : 0;
      const aAffinA = anchorTypes.has(a.p.productType) ? 1 : 0;
      if (aAffinA !== aAffinB) return aAffinB - aAffinA;
      return (b.p.rating ?? 0) - (a.p.rating ?? 0);
    });

  const named: CatalogProduct[] = [];
  for (const { p } of scored) {
    if (named.length >= 2) break;
    if (!named.some((n) => n.slug === p.slug)) named.push(p);
  }

  if (named.length === 0) {
    /* Verb present, no target found — surface as "unresolved" only when
     * there's an anchor to compare against; otherwise it wasn't really
     * an actionable comparison. */
    return { products: null, unresolved: anchors.length > 0 };
  }

  const products: CatalogProduct[] = [];
  for (const p of [...anchors, ...named]) {
    if (!products.some((x) => x.slug === p.slug)) products.push(p);
  }
  if (products.length < 2) return { products: null, unresolved: anchors.length > 0 };
  return { products: products.slice(0, 3), unresolved: false };
}

/* ============================================================
 * Resolver
 * ============================================================ */

/* Ordinal ladder for the "better version" upgrade path. */
const TIER_ORDER: Record<ProductTier, number> = {
  beginner: 0,
  intermediate: 1,
  pro: 2,
};

/**
 * Find the best "better version" of `product` while staying strictly
 * within the same fine-grained kind — so an ND filter never becomes a
 * mic, and a Mini drone upgrades to another drone rather than a gimbal.
 *
 * Kind matching:
 *   • Core products (drones, cameras, gimbals): same `productType`
 *     (keeps drone->drone, mobile_gimbal->mobile_gimbal, etc.).
 *     "Better" means a strictly higher tier.
 *   • Accessories: same `accessoryRole` AND still compatible with the
 *     kit's `core` (or, when browsing without a kit, sharing the
 *     source's `compatible_with_type`). Accessory tiers are near-
 *     uniform, so "better" also accepts a same-tier SKU that's pricier
 *     and at least as well rated (a premium version). When the
 *     accessory has no `accessoryRole` we can't identify its kind, so
 *     we bail (no swap) rather than risk crossing categories.
 *
 * Candidates are ranked by series / subtype / productType affinity,
 * then tier, then rating. Returns null when no genuine upgrade exists
 * (the NBA is then omitted).
 */
export function findBetterVersion(
  product: CatalogProduct,
  catalog: CatalogProduct[],
  excludeSlugs: Set<string>,
  core?: CatalogProduct | null,
): CatalogProduct | null {
  const baseTier = TIER_ORDER[product.tier];
  const basePrice = product.price ?? 0;
  const baseRating = product.rating ?? 0;
  const isAccessory = product.isAccessory;

  /* Accessories with no role can't be safely kind-matched; cores need a
   * concrete productType to match against. Bail in either gap. */
  if (isAccessory && !product.accessoryRole) return null;
  if (!isAccessory && !product.productType) return null;

  /* Does `c` count as a genuine step up? Higher tier always wins;
   * otherwise (same tier) require a pricier SKU that's at least as well
   * rated, so we never swap sideways or downward. */
  const isBetter = (c: CatalogProduct): boolean => {
    const cTier = TIER_ORDER[c.tier];
    if (cTier > baseTier) return true;
    if (cTier < baseTier) return false;
    return (c.price ?? 0) > basePrice && (c.rating ?? 0) >= baseRating;
  };

  const sharesSubtype = (c: CatalogProduct): boolean =>
    product.subtypes.length > 0 &&
    c.subtypes.some((s) => product.subtypes.includes(s));

  /* Keep an accessory swap compatible with the same host. With a kit
   * core, reuse the strict combo-assembly check; when browsing without
   * a core, fall back to compatible_with_type overlap (universal is a
   * free pass). */
  const compatibleAccessory = (c: CatalogProduct): boolean => {
    if (core) return isAccessoryCompatibleWithCoreStrict(c, core);
    if (
      product.compatibleWithType.includes("universal") ||
      c.compatibleWithType.includes("universal")
    ) {
      return true;
    }
    if (product.compatibleWithType.length === 0) return true;
    return c.compatibleWithType.some((t) =>
      product.compatibleWithType.includes(t),
    );
  };

  const candidates = catalog.filter((c) => {
    if (c.slug === product.slug) return false;
    if (excludeSlugs.has(c.slug)) return false;
    if (c.isBundle) return false;
    if (!isBetter(c)) return false;

    if (isAccessory) {
      if (!c.isAccessory) return false;
      if (c.accessoryRole !== product.accessoryRole) return false;
      return compatibleAccessory(c);
    }
    return c.productType === product.productType;
  });
  if (candidates.length === 0) return null;

  const scored = candidates.map((c) => {
    let score = TIER_ORDER[c.tier] * 10;
    if (product.series && c.series === product.series) score += 100;
    if (isAccessory && sharesSubtype(c)) score += 40;
    if (c.productType === product.productType) score += 50;
    if (c.rating != null) score += c.rating;
    return { c, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0].c;
}

/* A stable "product family" key for compare-eligibility. Two selections
 * are compare-worthy only when they map to the same key — a cross-family
 * comparison (e.g. an action camera vs a helmet mount) shares almost no
 * specs and yields an all-"—" table, so we suppress it.
 *
 * Cores bucket by imaging group (`productTypeGroup` is always populated,
 * so two action cameras always match). Accessories bucket by their
 * subtype family prefix — `mount_helmet`/`mount_handlebar` -> `mount`,
 * `mic_wireless`/`mic_kit` -> `mic` — so two mounts compare but a mic vs
 * a mount does not (the `accessoryRole` alone is often unset for these,
 * collapsing everything to "general"). Falls back to `accessoryRole`,
 * then a generic bucket, when a SKU ships no subtype. */
function compareFamilyKey(p: CatalogProduct): string {
  if (p.isAccessory || p.productTypeGroup === "accessory") {
    const sub = p.subtypes.find((s) => s.includes("_"));
    if (sub) return `accessory:${sub.slice(0, sub.indexOf("_"))}`;
    if (p.accessoryRole) return `accessory:role:${p.accessoryRole}`;
    return "accessory:general";
  }
  return `core:${p.productTypeGroup || p.productType || "unknown"}`;
}

/**
 * Resolve the Next Best Actions for the current selection. Returns an
 * ordered list of tappable items (empty when nothing is selected).
 *
 * The list is contextual to the active kit: ticked products that are
 * part of the kit the shopper is looking at get build-your-kit actions
 * (swap for a better version, remove), while products browsed outside
 * the kit keep the discovery actions (add to kit, FAQs, compare).
 */
export function resolveSelectionNbas(
  products: CatalogProduct[],
  context: SelectionContext,
  deps: WingmanNbaDeps,
): WingmanNbaItem[] {
  if (products.length === 0) return [];

  const inKit = (p: CatalogProduct) => context.activeKitSlugs.has(p.slug);
  const core = context.coreSlug
    ? context.catalog.find((p) => p.slug === context.coreSlug) ?? null
    : null;

  if (products.length === 1) {
    const product = products[0];
    const better = findBetterVersion(
      product,
      context.catalog,
      context.activeKitSlugs,
      core,
    );
    const items: WingmanNbaItem[] = [];

    if (inKit(product)) {
      /* In-kit: help the shopper refine the kit. */
      if (better) {
        items.push({
          id: `swap-${product.slug}`,
          label: "Suggest a better version",
          run: () => deps.swapForBetter(product.slug, better.slug),
        });
      }
      if (context.coreSlug === product.slug) {
        /* Never offer "remove" on the core — it would empty the kit.
         * Round out the row with a single contextual FAQ instead. */
        const faq = buildProductFaqs(product)[0];
        if (faq) {
          items.push({
            id: `faq-${product.slug}-${faq.id}`,
            label: faq.question,
            run: () => deps.askInChat(faq.question, faq.answer),
          });
        }
      } else {
        items.push({
          id: `remove-${product.slug}`,
          label: "Remove this",
          run: () => deps.removeFromKit([product.slug]),
        });
      }
      items.push({
        id: `reviews-${product.slug}`,
        label: "View reviews",
        run: () => deps.viewReviews(product),
      });
      return items;
    }

    /* Browsing (not in the active kit): discovery actions. */
    items.push({
      id: `add-${product.slug}`,
      label: "Add to kit",
      run: () => deps.addToKit(product.slug),
    });
    if (better) {
      items.push({
        id: `swap-${product.slug}`,
        label: "Suggest a better version",
        run: () => deps.swapForBetter(product.slug, better.slug),
      });
    }
    for (const faq of buildProductFaqs(product).slice(0, 2)) {
      items.push({
        id: `faq-${product.slug}-${faq.id}`,
        label: faq.question,
        run: () => deps.askInChat(faq.question, faq.answer),
      });
    }
    items.push({
      id: `reviews-${product.slug}`,
      label: "View reviews",
      run: () => deps.viewReviews(product),
    });
    return items;
  }

  /* 2-3 products. */
  if (products.every(inKit)) {
    const items: WingmanNbaItem[] = [
      {
        id: "remove-these",
        label: "Remove these",
        run: () => deps.removeFromKit(products.map((p) => p.slug)),
      },
    ];
    const upgradable = products
      .map((p) => ({
        p,
        better: findBetterVersion(
          p,
          context.catalog,
          context.activeKitSlugs,
          core,
        ),
      }))
      .filter(
        (x): x is { p: CatalogProduct; better: CatalogProduct } =>
          x.better !== null,
      );
    if (upgradable.length > 0) {
      items.push({
        id: "swap-these",
        label: "Suggest better versions",
        run: () => {
          for (const { p, better } of upgradable) {
            deps.swapForBetter(p.slug, better.slug);
          }
        },
      });
    }
    return items;
  }

  /* Browsing selection — comparison is a routine feature, so it opens
   * the dedicated tabular compare panel rather than the chat thread.
   * Only offer it when the picks are the same product family: a
   * cross-family comparison (e.g. an action camera vs a helmet mount)
   * shares almost no specs and renders an all-"—" table. */
  const sameFamily = new Set(products.map(compareFamilyKey)).size === 1;
  if (sameFamily) {
    return [
      {
        id: "compare",
        label: "Compare these",
        run: () => deps.compareProducts(products),
      },
    ];
  }

  /* Not comparable (e.g. camera + mount) — let the shopper add the
   * browsed picks to the kit instead of forcing an empty comparison. */
  const addable = products.filter((p) => !inKit(p));
  if (addable.length > 0) {
    return [
      {
        id: "add-these",
        label: "Add these to kit",
        run: () => addable.forEach((p) => deps.addToKit(p.slug)),
      },
    ];
  }
  return [];
}
