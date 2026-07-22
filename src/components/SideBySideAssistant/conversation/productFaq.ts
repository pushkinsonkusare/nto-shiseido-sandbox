import type { CatalogProduct } from "../../../catalog/catalog";
import { getBundleComponents } from "../../../catalog/catalog";

/**
 * Programmatic FAQ floor for PDP-origin shopper questions.
 *
 * The `faq` NBA pills (e.g. "What's included?", "Is this good for
 * beginners?", "Walk me through the key benefits") prefer the OpenAI
 * agent's free-text reply when an API key is configured. When the key
 * is absent, or the agent fails / yields no usable text, we fall
 * back to this resolver, which derives an answer from the
 * authoritative catalog metadata so the assistant always responds with
 * something product-aware (rather than the broad-card category
 * suggestion the rule-based engine would otherwise emit).
 *
 * The shape of every answer mirrors the body copy used in the Figma
 * "Simple answer (no docs)" variant: a single short paragraph,
 * leading with the product context (the AgentPdpUtterance card already
 * renders the title + category header above the body).
 */

const TIER_LABEL: Record<CatalogProduct["tier"], string> = {
  beginner: "everyday essentials",
  intermediate: "daily-care skincare",
  pro: "prestige, advanced care",
};

/**
 * Curated one-liners for components whose only catalog match is a
 * gender-/line-specific SKU (e.g. Men's Ultimune standing in for the
 * women's Ultimune that isn't in this dataset). Keyed by slug.
 */
const COMPONENT_TARGET_OVERRIDES: Record<string, string> = {
  "shiseido-men-ultimune-power-infusing-serum":
    "helps strengthen skin's natural defenses and visibly correct signs of aging (fine lines, firmness, and dullness)",
};

function joinSentences(parts: string[]): string {
  return parts
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ");
}

/**
 * Detect a marketing-hype sentence that leads with an imperative "brand
 * voice" opener or a superlative flourish rather than describing what the
 * product actually does. These read as slogans ("See and feel ultimate
 * resilience like you've never experienced before.") and make weak FAQ
 * answers, so `overviewLead` skips them in favour of the next substantive
 * sentence.
 */
function isMarketingHype(sentence: string): boolean {
  return (
    /^(see|feel|discover|experience|imagine|reveal|unlock|meet|introducing|welcome|say\s+hello|get\s+ready)\b/i.test(
      sentence,
    ) ||
    /\b(like you'?ve never|ever before|the future of|redefines?|reimagines?)\b/i.test(
      sentence,
    ) ||
    /!$/.test(sentence)
  );
}

/**
 * Pull the first substantive sentence from the product `overview`, used as a
 * grounded fallback in place of a bare `shortDescription`. Skips a leading
 * marketing-hype slogan when a real descriptive sentence follows. Returns
 * null when the lead is a terse label (e.g. "Revitalizing eye cream")
 * rather than a real sentence, so callers can deflect gracefully instead.
 */
function overviewLead(product: CatalogProduct): string | null {
  const raw = product.overview?.trim();
  if (!raw || /^n\/?a\b/i.test(raw)) return null;
  const firstLine = raw.split(/\n+/).map((s) => s.trim()).find(Boolean);
  if (!firstLine || /^n\/?a\b/i.test(firstLine)) return null;
  const sentences = firstLine
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  // Prefer the first substantive, non-hype sentence.
  const substantive = sentences.find(
    (s) => s.split(/\s+/).length >= 6 && !isMarketingHype(s),
  );
  if (substantive) return substantive;
  // Otherwise fall back to the first long-enough sentence (even if hype),
  // so a product whose whole overview is a single slogan still answers.
  const first = sentences[0];
  return first && first.split(/\s+/).length >= 6 ? first : null;
}

/** Prefer "Benefiance Wrinkle Smoothing Eye Cream" over a bare product name. */
function componentDisplayTitle(product: CatalogProduct): string {
  // Men's Ultimune stands in for the women's Ultimune missing from this
  // catalog — never surface the men-line branding on mixed/women sets.
  if (
    /ultimune/i.test(product.title) &&
    /shiseido-men/i.test(product.series || "")
  ) {
    return "Ultimune Power Infusing Serum";
  }
  const collection = product.model?.trim();
  if (
    collection &&
    !/^shiseido\s*men$/i.test(collection) &&
    !new RegExp(collection.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(
      product.title,
    )
  ) {
    return `${collection} ${product.title}`;
  }
  return product.title;
}

function trimTrailingPunctuation(text: string): string {
  return text.replace(/[.!?;,:]+$/u, "").trim();
}

/**
 * One-line "what it does" blurb for a bundle component. Prefers real
 * benefit bullets; falls back to curated overrides when the only match
 * is a gender-specific stand-in SKU.
 */
function componentTargetBlurb(
  component: CatalogProduct,
  bundle: CatalogProduct,
): string {
  const override = COMPONENT_TARGET_OVERRIDES[component.slug];
  const bundleIsMens = /\bmen'?s?\b|shiseido-men/i.test(
    `${bundle.title} ${bundle.model || ""} ${bundle.series || ""}`,
  );
  const componentIsMens = /shiseido-men/i.test(component.series || "");
  if (override && componentIsMens && !bundleIsMens) {
    return override;
  }

  const benefits = benefitBlocks(component);
  if (benefits.length > 0) {
    const lead = benefits[0];
    // Tag-style benefit rows ("Anti-Aging, Hydrating, Skin Strengthening")
    // read better as a short lowercase list than as a fake sentence.
    if (/,\s*/.test(lead) && lead.length < 120 && !/[.!?]$/.test(lead)) {
      const tags = lead
        .split(",")
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean)
        .slice(0, 4);
      if (tags.length >= 2) return tags.join(", ");
    }
    return trimTrailingPunctuation(lead);
  }

  const lead = overviewLead(component);
  if (lead) return trimTrailingPunctuation(lead);

  const short = component.shortDescription?.trim();
  if (short && !/^n\/?a\b/i.test(short)) {
    return trimTrailingPunctuation(short);
  }
  return "delivers complementary skincare benefits in this set";
}

/** True when the set/bundle lacks its own usable benefit/overview copy. */
function needsComponentComposition(product: CatalogProduct): boolean {
  if (!product.isBundle && product.bundleComponentSlugs.length === 0) {
    return false;
  }
  const components = getBundleComponents(product);
  if (components.length < 2) return false;
  const hasRealBenefits = benefitBlocks(product).length > 0;
  const hasOverview = Boolean(overviewLead(product));
  return !hasRealBenefits && !hasOverview;
}

/**
 * Break a thin bundle FAQ into what each included product does.
 * Example: "This set pairs two products. Ultimune … — …. Benefiance … — …."
 */
function composeComponentTargetAnswer(product: CatalogProduct): string | null {
  const components = getBundleComponents(product);
  if (components.length < 2) return null;

  const lines = components.map((component) => {
    const title = componentDisplayTitle(component);
    const blurb = componentTargetBlurb(component, product);
    const body = /^[a-z]/.test(blurb) ? blurb : lowerFirst(blurb);
    return `${title} — ${body}.`;
  });

  const lead =
    components.length === 2
      ? "This set pairs two products."
      : `This set includes ${components.length} products.`;
  return joinSentences([lead, ...lines]);
}

function composeComponentIncludedAnswer(product: CatalogProduct): string | null {
  const components = getBundleComponents(product);
  if (components.length < 2) return null;
  const names = components.map(componentDisplayTitle);
  return `The ${product.title} includes ${joinNatural(names)}.`;
}

function composeComponentHowToUseAnswer(product: CatalogProduct): string | null {
  const components = getBundleComponents(product);
  if (components.length < 2) return null;
  const names = components.map(componentDisplayTitle);
  return `Use each product in the ${product.title} on its own routine step — apply ${joinNatural(
    names,
  )} as you normally would for that category (serum before eye cream, essence before serum, and so on).`;
}

/**
 * Feature blocks (sourced from `keyBenefits`) that describe what the
 * product does, excluding pure formulation claims (paraben-free,
 * dermatologist-tested, etc.) and bare suitability lines that don't
 * answer "what does it do / target". Used to ground benefit / target
 * answers in real copy before any marketing overview.
 */
function benefitBlocks(product: CatalogProduct): string[] {
  return product.featureBlocks
    .map((block) => block.trim())
    .filter(Boolean)
    .filter(
      (block) =>
        !/^(paraben|mineral[-\s]?oil|fragrance[-\s]?free|alcohol[-\s]?free|allergy[-\s]?tested|irritation[-\s]?tested|dermatolog|ophthalmolog|non[-\s]?comedogenic|clinically|tested by|suitable for|good for|free of|refill|\d)/i.test(
          block,
        ),
    );
}

function findFeatureBlockMatching(
  product: CatalogProduct,
  patterns: RegExp[],
): string | null {
  for (const block of product.featureBlocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    if (patterns.some((p) => p.test(trimmed))) {
      return trimmed;
    }
  }
  return null;
}

function listSpecs(
  product: CatalogProduct,
  count: number,
): string | null {
  const specs = product.specs.filter(
    (spec) => Boolean(spec.label) && Boolean(spec.value),
  );
  if (specs.length === 0) return null;
  const slice = specs.slice(0, count);
  return slice.map((spec) => `${spec.label}: ${spec.value}`).join("; ");
}

function specByLabel(
  product: CatalogProduct,
  patterns: RegExp[],
): string | null {
  for (const spec of product.specs) {
    if (patterns.some((p) => p.test(spec.label))) {
      return `${spec.label}: ${spec.value}`;
    }
  }
  return null;
}

/**
 * Join a list of tokens into a natural, Oxford-comma phrase:
 * ["combination", "dry", "oily"] -> "combination, dry, and oily".
 */
function joinNatural(parts: string[]): string {
  const clean = parts.map((p) => p.trim()).filter(Boolean);
  if (clean.length === 0) return "";
  if (clean.length === 1) return clean[0];
  if (clean.length === 2) return `${clean[0]} and ${clean[1]}`;
  return `${clean.slice(0, -1).join(", ")}, and ${clean[clean.length - 1]}`;
}

/** Split a spec value on commas / slashes into its individual tokens. */
function splitValues(value: string): string[] {
  return value
    .split(/[,/]/)
    .map((token) => token.trim())
    .filter(Boolean);
}

/** Strip a leading "Label: " prefix from a `Label: Value` spec string. */
function specValue(row: string): string {
  const index = row.indexOf(":");
  return index >= 0 ? row.slice(index + 1).trim() : row.trim();
}

/** Lower-case the first character so a claim fragment can be dropped mid-sentence
 *  after a lead-in (e.g. "is " + "Dermatologist-tested." -> "is dermatologist-tested."). */
function lowerFirst(text: string): string {
  return text ? text.charAt(0).toLowerCase() + text.slice(1) : text;
}

/**
 * Soften skincare jargon in a raw catalog claim so a shopper answer reads in
 * plain language. Currently expands "non-comedogenic" with a parenthetical the
 * first time it appears (unless the copy already explains it).
 */
function decodeSkinJargon(block: string): string {
  if (/non[-\s]?comedogenic\s*\(/i.test(block)) return block;
  let expanded = false;
  return block.replace(/non[-\s]?comedogenic/i, (match) => {
    if (expanded) return match;
    expanded = true;
    return `${match} (won't clog pores)`;
  });
}

function inTheBoxAnswer(product: CatalogProduct): string {
  // Prefer resolved component SKUs for thin "&"-style combos that have no
  // "Set Includes" copy of their own.
  const composed = composeComponentIncludedAnswer(product);
  if (composed && needsComponentComposition(product)) {
    return composed;
  }
  if (composed && product.isBundle && benefitBlocks(product).length === 0) {
    return composed;
  }

  // `inTheBox` is empty at runtime for the skincare catalog, so we go
  // straight to a featureBlocks scan for "what's included" copy,
  // useful for Sets & Bundles where the set contents are described in
  // the key-benefit blocks.
  const block = findFeatureBlockMatching(product, [
    /\bincludes?\b/i,
    /\bwhat's? included\b/i,
    /\bset (?:of|contains|includes)\b/i,
    /\bcomes? with\b/i,
    /\bkit\b/i,
  ]);
  if (product.isBundle) {
    if (block) {
      return joinSentences([
        `The ${product.title} set includes ${block.charAt(0).toLowerCase()}${block.slice(1)}`,
      ]);
    }
    if (composed) return composed;
    const sizes = specByLabel(product, [/sizes?/i]);
    return sizes
      ? `The ${product.title} is a curated set in ${joinNatural(splitValues(specValue(sizes)))}.`
      : `The ${product.title} is a curated set of complementary products.`;
  }
  if (block) {
    return block;
  }
  const sizes = specByLabel(product, [/sizes?/i]);
  if (sizes) {
    return `The ${product.title} comes in ${joinNatural(splitValues(specValue(sizes)))}.`;
  }
  return `The ${product.title} comes as a single product.`;
}

function beginnerAnswer(product: CatalogProduct): string {
  if (product.tier === "beginner") {
    return `Yes, the ${product.title} is a great pick for ${TIER_LABEL.beginner}. Approachable, easy to work into any routine, and gentle enough to start with.`;
  }
  if (product.tier === "intermediate") {
    return `It can be. The ${product.title} sits in the ${TIER_LABEL.intermediate} band. Newcomers can absolutely use it, though you'll get the most from it once you have the basics of a routine down.`;
  }
  return `The ${product.title} is ${TIER_LABEL.pro}: a more advanced, targeted formula. If you're just starting out, an everyday-essentials product from the same collection is a gentler first step.`;
}

function specsAnswer(product: CatalogProduct): string {
  const summary = listSpecs(product, 5);
  if (summary) {
    return `The ${product.title} at a glance — ${summary}.`;
  }
  return (
    overviewLead(product) ??
    `The ${product.title} is a ${product.category.toLowerCase()} product from ${product.brand}.`
  );
}

function travelAnswer(product: CatalogProduct): string {
  // Repurposed from the legacy "good for travel?" pill to an
  // everyday-vs-advanced positioning answer keyed off `tier`.
  if (product.tier === "beginner") {
    return `The ${product.title} is one of our ${TIER_LABEL.beginner}, an easy daily-care pick you can reach for every morning or evening.`;
  }
  if (product.tier === "intermediate") {
    return `The ${product.title} is solid ${TIER_LABEL.intermediate}, a step up for a routine you're ready to invest a little more in.`;
  }
  return `The ${product.title} is ${TIER_LABEL.pro}: a prestige, results-focused formula for when you want the most targeted treatment.`;
}

function resolutionAnswer(product: CatalogProduct): string {
  // Answers "what does this target / what are the key benefits?",
  // sourced from the Targets spec and featureBlocks.
  const targets = specByLabel(product, [/targets?/i, /concerns?/i]);
  if (targets) {
    return `The ${product.title} targets ${joinNatural(splitValues(specValue(targets)))}.`;
  }

  // Thin bundle/combo pages: speak to each component individually.
  if (needsComponentComposition(product)) {
    const composed = composeComponentTargetAnswer(product);
    if (composed) return composed;
  }

  // Ground the answer in the product's real benefit bullets (keyBenefits)
  // before any marketing overview copy. Lead with a benefit-worded block
  // when one exists, otherwise summarise the top two benefit bullets.
  const block = findFeatureBlockMatching(product, [
    /\bbenefit\b/i,
    /\bhelps?\b/i,
    /\btargets?\b/i,
    /\bimproves?\b/i,
    /\breduces?\b/i,
    /\bvisibly\b/i,
    /\bboosts?\b/i,
    /\bdefends?\b/i,
    /\bstrengthens?\b/i,
    /\bhydrat\w*/i,
    /\bbrighten\w*/i,
    /\bfirm\w*/i,
    /\bsmooth\w*/i,
  ]);
  if (block && !/^n\/?a\b/i.test(block)) {
    return block;
  }
  const benefits = benefitBlocks(product).filter((b) => !/^n\/?a\b/i.test(b));
  if (benefits.length > 0) {
    return joinSentences(
      benefits.slice(0, 2).map((b) => (/[.!?]$/.test(b) ? b : `${b}.`)),
    );
  }

  const composedFallback = composeComponentTargetAnswer(product);
  if (composedFallback) return composedFallback;

  return (
    overviewLead(product) ??
    `The ${product.title} is designed to deliver visible skincare results — want the full product page?`
  );
}

/* ============================================================
 * v2 builders: added when the original patterns weren't enough to
 * keep unknown-question answers from dumping `shortDescription`
 * (which the user perceived as "everything thrown at me randomly").
 * Each helper consults `useCaseTags` / `subtypes` first (highest-
 * fidelity signal), then a spec/featureBlock scan, then a tight
 * neutral string, never the verbose shortDescription.
 * ============================================================ */

function waterproofAnswer(product: CatalogProduct): string {
  // Answers "is this suitable for sensitive skin / gentle enough?",
  // based on the skin-type tokens, fused tags, and any soothing/gentle
  // feature copy.
  const skinTypes = new Set(product.subtypes.map((s) => s.toLowerCase()));
  const suitsAll = skinTypes.has("all");
  const gentleBlock = findFeatureBlockMatching(product, [
    /\bsensitive\b/i,
    /\bgentle\b/i,
    /\bsooth\w*/i,
    /\bfragrance[-\s]?free\b/i,
    /\bnon[-\s]?comedogenic\b/i,
    /\bhypoallergenic\b/i,
  ]);
  if (suitsAll && gentleBlock) {
    return joinSentences([
      `Yes — the ${product.title} is formulated for all skin types, so it's a gentle choice for sensitive skin.`,
      gentleBlock,
    ]);
  }
  if (suitsAll) {
    return `Yes — the ${product.title} suits all skin types, which makes it a safe pick for sensitive skin. If your skin reacts easily, patch-test first.`;
  }
  if (gentleBlock) {
    return joinSentences([
      `It can be a good fit for sensitive skin — the ${product.title} is ${lowerFirst(
        decodeSkinJargon(gentleBlock),
      )}`,
      "If your skin reacts easily, patch-test first.",
    ]);
  }
  const skinTypeSpec = specByLabel(product, [/skin\s*type/i]);
  if (skinTypeSpec) {
    return `The ${product.title} is suitable for ${joinNatural(
      splitValues(specValue(skinTypeSpec)),
    )} skin. For sensitive skin, patch-test first.`;
  }
  return `The ${product.title} doesn't call out a specific sensitive-skin claim. Patch-test first, or try an all-skin-types formula in the same collection if your skin is easily irritated.`;
}

function batteryAnswer(product: CatalogProduct): string {
  // Answers "how do I use it / when / how often?", preferring curated
  // howToUse steps, then usage feature copy, then routine specs.
  if (needsComponentComposition(product)) {
    const composed = composeComponentHowToUseAnswer(product);
    if (composed) return composed;
  }
  if (product.howToUse.length > 0) {
    const steps = product.howToUse
      .slice(0, 3)
      .map((step) => (/[.!?]$/.test(step) ? step : `${step}.`));
    return joinSentences([`For the ${product.title}:`, ...steps]);
  }
  const block = findFeatureBlockMatching(product, [
    /\bapply\b/i,
    /\bmorning\b/i,
    /\bevening\b/i,
    /\bdaily\b/i,
    /\broutine\b/i,
    /\bmassage\b/i,
    /\bpump\b/i,
  ]);
  if (block && !/^n\/?a\b/i.test(block)) {
    return block;
  }
  const routine = specByLabel(product, [/routine/i]);
  if (routine) {
    return `Apply the ${product.title} as part of your ${specValue(
      routine,
    ).toLowerCase()} routine.`;
  }
  const composed = composeComponentHowToUseAnswer(product);
  if (composed) return composed;
  return `Apply the ${product.title} as directed, morning and evening — a little goes a long way.`;
}

function priceAnswer(product: CatalogProduct): string {
  if (product.comparePriceFormatted) {
    return `The ${product.title} is ${product.priceFormatted} (was ${product.comparePriceFormatted}).`;
  }
  return `The ${product.title} is ${product.priceFormatted}.`;
}

function availabilityAnswer(product: CatalogProduct): string {
  if (/out\s+of\s+stock/i.test(product.badgeLabel)) {
    return `The ${product.title} is currently out of stock. Want me to suggest something similar?`;
  }
  return `Yes — the ${product.title} is available. You can add it to your cart whenever you're ready.`;
}

function scentAnswer(product: CatalogProduct): string {
  const fragranceFreeBlock = findFeatureBlockMatching(product, [
    /\bfragrance[-\s]?free\b/i,
    /\bunscented\b/i,
    /\bno\s+fragrance\b/i,
  ]);
  if (fragranceFreeBlock) {
    return `Yes — the ${product.title} is fragrance-free.`;
  }
  const raw = product.ingredients || "";
  if (/\bfragrance[-\s]?free\b/i.test(raw)) {
    return `The ${product.title} is fragrance-free.`;
  }
  if (/\bfragrance\b|\bparfum\b/i.test(raw)) {
    return `The ${product.title} includes a light fragrance. If you're scent-sensitive, patch-test first.`;
  }
  return `The ${product.title} doesn't call out a strong scent — most of what you'll notice is the texture and finish.`;
}

function aboutProductAnswer(product: CatalogProduct): string {
  const lead = overviewLead(product);
  if (lead) return lead;
  const benefits = benefitBlocks(product).filter((b) => !/^n\/?a\b/i.test(b));
  if (benefits.length > 0) {
    return joinSentences(
      benefits.slice(0, 2).map((b) => (/[.!?]$/.test(b) ? b : `${b}.`)),
    );
  }
  return specsAnswer(product);
}

function reviewsAnswer(product: CatalogProduct): string {
  const rating = product.rating;
  const count = product.reviewCount;
  if (typeof rating === "number" && typeof count === "number") {
    const score = rating.toFixed(1);
    const reviews = count.toLocaleString();
    if (rating >= 4.6) {
      return `Shoppers love the ${product.title} — it's rated ${score} out of 5 from ${reviews} reviews, one of the stronger scores in this lineup.`;
    }
    if (rating >= 4.0) {
      return `The ${product.title} is rated ${score} out of 5 from ${reviews} reviews. Overall feedback is solid.`;
    }
    return `The ${product.title} is rated ${score} out of 5 from ${reviews} reviews. Want me to compare it with a higher-rated alternative?`;
  }
  if (typeof rating === "number") {
    return `The ${product.title} is rated ${rating.toFixed(1)} out of 5.`;
  }
  return `I don't have detailed review quotes on hand for the ${product.title}, but I can compare it with similar options or open the full product page.`;
}

function dimensionsAnswer(product: CatalogProduct): string {
  // Repurposed from "dimensions / weight" to "what size / volume does
  // it come in?", sourced from the Sizes spec.
  const sizeSpec = specByLabel(product, [/sizes?/i, /volume/i, /capacity/i]);
  if (sizeSpec) {
    return `The ${product.title} comes in ${joinNatural(
      splitValues(specValue(sizeSpec)),
    )}.`;
  }
  return `The ${product.title} comes in one standard size.`;
}

function rangeAnswer(product: CatalogProduct): string {
  // Repurposed from "transmission range" to "which collection is this
  // from / where does it sit in the lineup?", sourced from the
  // Collection spec.
  const collection = specByLabel(product, [/collection/i, /line/i, /range/i]);
  if (collection) {
    return `The ${product.title} is part of the ${specValue(
      collection,
    )} collection.`;
  }
  if (product.model) {
    return `The ${product.title} is part of the ${product.model} collection.`;
  }
  return `The ${product.title} is part of the ${product.brand} lineup.`;
}

function audioAnswer(product: CatalogProduct): string {
  // Repurposed from the legacy "what should I pair this with?" pill to
  // "how do I layer this?". It recommends the next routine step based on
  // the product's category.
  const category = product.category.toLowerCase();
  const block = findFeatureBlockMatching(product, [
    /\blayer\b/i,
    /\bfollow\s*with\b/i,
    /\bpair\b/i,
    /\bafter\s*cleans/i,
    /\bbefore\s*moistur/i,
  ]);
  if (block) {
    return block;
  }
  let nextStep: string;
  if (category.includes("cleanser")) {
    nextStep = "Follow it with a softener to prep skin, then your serum and moisturizer.";
  } else if (category.includes("softener")) {
    nextStep = "Apply it after cleansing, then layer your serum, eye care, and moisturizer.";
  } else if (category.includes("serum") || category.includes("treatment")) {
    nextStep = "Smooth it on after your softener and before your moisturizer to seal it in.";
  } else if (category.includes("eye") || category.includes("lip")) {
    nextStep = "Gently pat it around the eye and lip area after your serum, before moisturizer.";
  } else if (category.includes("moisturizer")) {
    nextStep = "Use it as the last step of your routine, after serum, and add sunscreen over the top in the morning.";
  } else if (category.includes("sunscreen")) {
    nextStep = "Apply it as the final morning step, after your moisturizer, before makeup.";
  } else if (category.includes("mask")) {
    nextStep = "Use it a few times a week after cleansing; follow with serum and moisturizer.";
  } else {
    nextStep = "Layer it in your usual order: cleanser, softener, serum, eye care, moisturizer, then sunscreen in the morning.";
  }
  return `The ${product.title} pairs best with the rest of your routine. ${nextStep}`;
}

function stabilizationAnswer(product: CatalogProduct): string {
  // Repurposed from the legacy "stabilization" pill to "what's the
  // texture / finish / how does it absorb?", sourced from texture
  // feature copy and the Type spec.
  const block = findFeatureBlockMatching(product, [
    /\btexture\b/i,
    /\bfinish\b/i,
    /\babsorb\w*/i,
    /\blightweight\b/i,
    /\bcream\b/i,
    /\bgel\b/i,
    /\blotion\b/i,
    /\bemulsion\b/i,
    /\bfeel\b/i,
  ]);
  if (block) {
    return block;
  }
  const typeSpec = specByLabel(product, [/type/i, /texture/i, /finish/i]);
  if (typeSpec) {
    return `The ${product.title} has a ${specValue(
      typeSpec,
    ).toLowerCase()} texture.`;
  }
  return `The ${product.title} absorbs cleanly without a greasy finish.`;
}

function connectivityAnswer(product: CatalogProduct): string {
  // Repurposed from "connectivity / app" to "which skin types is this
  // for?", sourced from the Skin type spec and subtype tokens.
  const skinTypeSpec = specByLabel(product, [/skin\s*type/i]);
  if (skinTypeSpec) {
    const value = specValue(skinTypeSpec);
    if (/^all\b/i.test(value)) {
      return `The ${product.title} works for all skin types.`;
    }
    return `The ${product.title} is suitable for ${joinNatural(
      splitValues(value).map((token) => token.toLowerCase()),
    )} skin.`;
  }
  if (product.subtypes.length > 0) {
    if (product.subtypes.some((s) => s.toLowerCase() === "all")) {
      return `The ${product.title} works for all skin types.`;
    }
    return `The ${product.title} is suitable for ${joinNatural(
      product.subtypes.map((s) => s.toLowerCase()),
    )} skin.`;
  }
  return `The ${product.title} works across most skin types — patch-test first if yours reacts easily.`;
}

function lowLightAnswer(product: CatalogProduct): string {
  // Repurposed from "low-light performance" to "what results can I
  // expect / what are the key ingredients?", sourced from key-benefit
  // feature copy and the Targets spec.
  const block = findFeatureBlockMatching(product, [
    /\bingredient\b/i,
    /\bresult\w*/i,
    /\bproven\b/i,
    /\bweeks?\b/i,
    /\bvisibl\w*/i,
    /\bcomplex\b/i,
    /\bextract\b/i,
    /\bacid\b/i,
  ]);
  if (block) {
    return block;
  }
  const targets = specByLabel(product, [
    /targets?/i,
    /concerns?/i,
    /ingredient/i,
  ]);
  if (targets) {
    return `The ${product.title} focuses on ${joinNatural(
      splitValues(specValue(targets)),
    )}.`;
  }
  return (
    overviewLead(product) ??
    `The ${product.title} is formulated to deliver visible results over time.`
  );
}

/**
 * Parse the highlighted "- Key: description" lines from the raw ingredient
 * copy (the curated hero ingredients shown above the full INCI list).
 */
function parseKeyIngredients(raw: string): { name: string; desc: string }[] {
  const out: { name: string; desc: string }[] = [];
  for (const line of raw.split(/\n+/)) {
    const trimmed = line.trim();
    if (/^ingredients:/i.test(trimmed)) continue;
    const withDesc = trimmed.match(/^[-•]\s*([^:]+):\s*(.+)$/);
    if (withDesc) {
      out.push({
        name: withDesc[1].trim(),
        desc: withDesc[2].trim().replace(/[.\s]+$/, ""),
      });
      continue;
    }
    const nameOnly = trimmed.match(/^[-•]\s*(.+)$/);
    if (nameOnly) out.push({ name: nameOnly[1].trim(), desc: "" });
  }
  return out;
}

/** Pull the first `limit` entries from the full "INGREDIENTS: ..." INCI list,
 * title-cased so the all-caps source reads naturally. */
function parseInciTop(raw: string, limit: number): string[] {
  const match = raw.match(/ingredients:\s*([\s\S]*)/i);
  if (!match) return [];
  return match[1]
    .split(/[･·・,\n]/)
    .map((token) => token.trim())
    .filter(Boolean)
    .slice(0, limit)
    .map((token) => token.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase()));
}

function ingredientsAnswer(product: CatalogProduct): string {
  const raw = product.ingredients?.trim();
  if (raw) {
    const keys = parseKeyIngredients(raw);
    if (keys.length > 0) {
      const parts = keys
        .slice(0, 3)
        .map((k) => (k.desc ? `${k.name} (${k.desc.toLowerCase()})` : k.name));
      return `The ${product.title}'s key ingredients are ${joinNatural(parts)}.`;
    }
    const inci = parseInciTop(raw, 5);
    if (inci.length > 0) {
      return `The ${product.title} is formulated with ${joinNatural(inci)}, among others.`;
    }
  }
  if (product.isBundle) {
    return `The ${product.title} is a set — each product inside has its own formula and ingredient list.`;
  }
  return `I don't have a detailed ingredient list for the ${product.title}.`;
}

function waterResistanceAnswer(product: CatalogProduct): string {
  // Grounded in category + capability tags + feature copy. Skincare
  // isn't sold on a "waterproof" spec, so the only genuine water-
  // resistance signal is sun care (water-resistant sunscreen) or copy
  // that explicitly calls it out.
  const tags = product.useCaseTags.map((t) => t.toLowerCase());
  const isSunCare =
    /sunscreen|sun\s*care/i.test(product.category) ||
    tags.some((t) => t === "spf" || t.includes("sun"));
  const waterBlock = findFeatureBlockMatching(product, [
    /\bwater[-\s]?resist\w*/i,
    /\bwaterproof\b/i,
    /\bsweat[-\s]?resist\w*/i,
    /\bhumidity\b/i,
  ]);
  if (waterBlock) {
    return waterBlock;
  }
  if (isSunCare) {
    return `The ${product.title} is sun care, so it's designed to hold up better against water and sweat than most skincare. For swimming or heavy perspiration, reapply regularly.`;
  }
  return `The ${product.title} isn't a waterproof product. It's a leave-on skincare step meant to absorb into the skin rather than sit on top like a barrier. If you need water or sweat resistance, a water-resistant sunscreen is the piece built for that.`;
}

/** Stopwords + question words to strip when extracting content tokens
 *  for the unknown-question fuzzy spec match. */
const FUZZY_STOPWORDS = new Set([
  "is", "are", "was", "were", "the", "a", "an", "and", "or", "of", "to",
  "in", "on", "at", "for", "with", "by", "this", "that", "it", "its",
  "i", "we", "you", "they", "he", "she", "do", "does", "did", "have",
  "has", "had", "what", "whats", "what's", "how", "why", "when", "where",
  "who", "which", "can", "could", "would", "should", "will", "won't",
  "wont", "be", "been", "being", "as", "if", "than", "then", "so", "but",
  "not", "no", "yes", "any", "some", "all", "tell", "me", "about",
]);

/**
 * Last-resort answer source for unknown questions: scan specs for any
 * row whose label or value contains a content token from the prompt.
 * Returns the first concise match (value capped to 80 chars so we
 * don't emit a paragraph-long blob).
 */
function fuzzyMatchSpec(
  product: CatalogProduct,
  prompt: string,
): { label: string; value: string } | null {
  const tokens = prompt
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !FUZZY_STOPWORDS.has(t));
  if (tokens.length === 0) return null;
  for (const spec of product.specs) {
    if (!spec.label || !spec.value) continue;
    if (spec.value.length >= 80) continue;
    const haystack = `${spec.label} ${spec.value}`.toLowerCase();
    if (tokens.some((t) => haystack.includes(t))) {
      return { label: spec.label, value: spec.value };
    }
  }
  return null;
}

/**
 * Resolve a programmatic FAQ answer for a `(product, prompt)` pair.
 *
 * The classifier inspects the prompt against canonical NBA-pill copy
 * and common free-text cosmetics phrasings ("what's in it?", "how do I
 * apply this?", "is it good for dark spots?") and picks the matching
 * builder. Unknown prompts fall back to a concise product-grounded
 * snippet before a soft deflection.
 */
export function resolveProductFaq(
  product: CatalogProduct,
  prompt: string,
): string {
  const q = prompt
    .toLowerCase()
    .replace(/[“”"']/g, "")
    .replace(/[.!?]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  // --- Ingredients / formula / composition ---
  if (
    /\b(ingredients?|composition|formula|formulation|inci|actives?|key\s+ingredients?|what'?s?\s+(in\s+it|inside)|what\s+(is\s+it|its)\s+made\s+(of|with)|made\s+(of|with|from)|contains?\s+what|what\s+does\s+it\s+contain|retinol|vitamin\s*c|hyaluronic|niacinamide|peptides?|ceramides?)\b/.test(
      q,
    )
  ) {
    return ingredientsAnswer(product);
  }

  // --- Sensitive / gentle / allergy / pregnancy caution ---
  if (
    /\b(sensitive|gentle|fragrance[-\s]?free|unscented|non[-\s]?comedogenic|won'?t\s+clog|clog\s+(my\s+)?pores?|irritat\w*|reactive|allerg\w*|hypoallergenic|patch[-\s]?test|pregnant|pregnancy|nursing|breastfeed\w*)\b/.test(
      q,
    )
  ) {
    if (/\b(pregnant|pregnancy|nursing|breastfeed\w*)\b/.test(q)) {
      return `For pregnancy or nursing, check with your dermatologist before using the ${product.title}. I can share the ingredient list if that helps your conversation.`;
    }
    return waterproofAnswer(product);
  }

  // --- Skin type ---
  if (
    /\b(skin\s*types?|dry\s+skin|oily\s+skin|combination\s+skin|normal\s+skin|all\s+skin|who\s+(is\s+it|can\s+use)|suitable\s+for|good\s+for\s+my\s+skin|which\s+skin|what\s+skin)\b/.test(
      q,
    )
  ) {
    return connectivityAnswer(product);
  }

  // --- How to use / when / how often / amount ---
  if (
    /\b(how\s+to\s+use|how\s+do\s+i\s+use|how\s+should\s+i\s+use|how\s+do\s+you\s+use|apply|application|directions?|instructions?|when\s+(do\s+i|to)\s+(use|apply)|how\s+often|how\s+much\s+(do\s+i|to)\s+(use|apply)|pea[-\s]?size|morning|evening|night\s+time|at\s+night|am\b|pm\b|day\s+or\s+night|daytime|nighttime|how\s+long\s+(does\s+it\s+last|will\s+it\s+last)|shelf\s+life|expire|expiry|best\s+before)\b/.test(
      q,
    ) ||
    /\b(use|using|apply|wear)\s+(it|this)\b/.test(q)
  ) {
    return batteryAnswer(product);
  }

  // --- Reviews / ratings ---
  if (
    /\b(reviews?|ratings?|what\s+do\s+(reviews?|people|shoppers|customers)\s+say|how\s+is\s+it\s+rated|stars?\b|what\s+do\s+people\s+think)\b/.test(
      q,
    )
  ) {
    return reviewsAnswer(product);
  }

  // --- Size / volume / travel ---
  if (
    /\b(sizes?|volume|capacity|how\s+big|how\s+much\s+product|how\s+many\s+(ml|oz)|ml\b|fl\.?\s*oz|ounces?|travel\s+size|refill|pump)\b/.test(
      q,
    )
  ) {
    return dimensionsAnswer(product);
  }

  // --- Price ---
  if (
    /\b(price|cost|how\s+much(\s+is\s+it)?|expensive|affordable|on\s+sale|discount|what\s+does\s+it\s+cost)\b/.test(
      q,
    )
  ) {
    return priceAnswer(product);
  }

  // --- Stock / availability ---
  if (
    /\b(in\s+stock|out\s+of\s+stock|available|availability|can\s+i\s+buy|do\s+you\s+have|sold\s+out)\b/.test(
      q,
    )
  ) {
    return availabilityAnswer(product);
  }

  // --- Bundle contents ---
  if (
    /\b(what'?s?\s+included|includes?|in\s+the\s+(set|box|kit)|set\s+contents?|comes?\s+with|what'?s?\s+in\s+the\s+(set|box|kit)|what\s+do\s+i\s+get)\b/.test(
      q,
    )
  ) {
    return inTheBoxAnswer(product);
  }

  // --- Beginner / first time ---
  if (
    /\b(beginner|first[-\s]?time|easy\s+to\s+use|starter|entry[-\s]?level|new\s+to\s+skincare|just\s+starting|newbie)\b/.test(
      q,
    )
  ) {
    return beginnerAnswer(product);
  }

  // --- Collection / line ---
  if (
    /\b(collection|line\b|lineup|which\s+range|part\s+of|which\s+(line|collection)|from\s+the)\b/.test(
      q,
    )
  ) {
    return rangeAnswer(product);
  }

  // --- Layering / pairing ---
  if (
    /\b(layer|layering|pair\s+with|what\s+to\s+use\s+with|combine|goes\s+with|next\s+step|order\s+of|before\s+or\s+after|after\s+(cleanser|serum|moisturizer)|before\s+(moisturizer|cream|sunscreen)|what\s+comes?\s+(before|after)|routine\s+order|where\s+in\s+(my\s+)?routine|in\s+my\s+routine|stack\s+with)\b/.test(
      q,
    )
  ) {
    return audioAnswer(product);
  }

  // --- Texture / feel ---
  if (
    /\b(texture|finish|absorb\w*|greasy|sticky|feel\b|feels?\s+like|lightweight|rich\b|cream\b|gel\b|lotion\b|emulsion\b|serum[-\s]?like|consistency|silky|matte|dewy|oily\s+finish)\b/.test(
      q,
    )
  ) {
    return stabilizationAnswer(product);
  }

  // --- Scent ---
  if (/\b(scent|smell|fragrance|perfume|odour|odor|aromatic)\b/.test(q)) {
    return scentAnswer(product);
  }

  // --- SPF / sun ---
  if (/\b(spf|sunscreen|sun\s+protect\w*|uv\b|sunblock|sun\s+care)\b/.test(q)) {
    return resolutionAnswer(product);
  }

  // --- Water / sweat resistance ---
  if (/\bwaterproof\b|water[-\s]?resist\w*|\bsweat\b|\bswim\w*|\bperspir\w*/.test(q)) {
    return waterResistanceAnswer(product);
  }

  // --- Results / efficacy ---
  if (
    /\b(result\w*|does\s+it\s+work|will\s+it\s+work|effective\w*|proven|clinical|how\s+long\s+(to|until|before)\s+(see|notice)|when\s+will\s+i\s+see|how\s+soon)\b/.test(
      q,
    )
  ) {
    return lowLightAnswer(product);
  }

  // --- Targets / benefits / concerns (broad cosmetics intents) ---
  if (
    /\b(target\w*|concern\w*|benefit\w*|what\s+does\s+(it|this)\s+do|what\s+is\s+it\s+for|good\s+for|helps?\s+with|treats?|reduces?|improves?|wrinkle\w*|fine\s+lines?|anti[-\s]?ag\w*|aging|ageing|dark\s+spots?|pigment\w*|brighten\w*|dull(ness)?|firm\w*|sag\w*|lift\w*|hydrat\w*|moisturi[sz]\w*|acne|blemish\w*|pore\w*|oil\s+control|redness|even\s+tone|radiance|glow|collagen|elasticity|eye\s+bags?|puffiness|crow'?s?\s+feet)\b/.test(
      q,
    )
  ) {
    return resolutionAnswer(product);
  }

  // --- Everyday vs prestige positioning ---
  if (
    /\b(everyday|daily\s+use|prestige|advanced\s+care|luxur\w*|splurge|worth\s+it|high[-\s]?end|entry[-\s]?level\s+or)\b/.test(
      q,
    )
  ) {
    return travelAnswer(product);
  }

  // --- Specs / details / "tell me about" ---
  if (
    /\b(spec|specs|specification|key\s+specs?|details|tell\s+me\s+about|what\s+is\s+(this|it)|about\s+(this|it|the\s+product)|overview|describe)\b/.test(
      q,
    )
  ) {
    return aboutProductAnswer(product);
  }

  // Unknown: fuzzy spec hit, then overview/benefits, then soft deflection.
  const fuzzy = fuzzyMatchSpec(product, q);
  if (fuzzy) {
    return `The ${product.title}'s ${fuzzy.label.toLowerCase()} is ${fuzzy.value}.`;
  }
  const about = aboutProductAnswer(product);
  if (about && !/^The .+ at a glance/i.test(about)) {
    // Prefer a real overview/benefit answer over a bare specs dump for
    // unmatched free text — still product-grounded, less like a deflection.
    return about;
  }
  return `I don't have that detail on hand for the ${product.title} — want me to suggest something similar or share the full product page?`;
}
