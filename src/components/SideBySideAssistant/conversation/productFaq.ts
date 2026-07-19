import type { CatalogProduct } from "../../../catalog/catalog";

/**
 * Programmatic FAQ floor for PDP-origin shopper questions.
 *
 * The `faq` NBA pills (e.g. "What's included?", "Is this good for
 * beginners?", "Walk me through the key benefits") prefer the OpenAI
 * agent's free-text reply when an API key is configured. When the key
 * is absent — or the agent fails / yields no usable text — we fall
 * back to this resolver, which derives an answer from the
 * authoritative catalog metadata so the assistant always responds with
 * something product-aware (rather than the broad-card category
 * suggestion the rule-based engine would otherwise emit).
 *
 * The shape of every answer mirrors the body copy used in the Figma
 * "Simple answer (no docs)" variant — a single short paragraph,
 * leading with the product context (the AgentPdpUtterance card already
 * renders the title + category header above the body).
 */

const TIER_LABEL: Record<CatalogProduct["tier"], string> = {
  beginner: "everyday essentials",
  intermediate: "daily-care skincare",
  pro: "prestige, advanced care",
};

function joinSentences(parts: string[]): string {
  return parts
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ");
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
 * Return up to `limit` `Label: Value` strings whose label or value matches
 * any of the provided patterns. Empty values are skipped so we never emit
 * a dangling "Some Spec: ".
 */
function specsMatchingLabel(
  product: CatalogProduct,
  patterns: RegExp[],
  limit = 3,
): string[] {
  const out: string[] = [];
  for (const spec of product.specs) {
    if (!spec.label || !spec.value) continue;
    if (patterns.some((p) => p.test(spec.label) || p.test(spec.value))) {
      out.push(`${spec.label}: ${spec.value}`);
      if (out.length >= limit) break;
    }
  }
  return out;
}

function inTheBoxAnswer(product: CatalogProduct): string {
  // `inTheBox` is empty at runtime for the skincare catalog, so we go
  // straight to a featureBlocks scan for "what's included" copy —
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
        `Here's what the ${product.title} set includes:`,
        block,
      ]);
    }
    const sizes = specByLabel(product, [/sizes?/i]);
    return joinSentences([
      `The ${product.title} is a curated set.`,
      sizes ? `${sizes}.` : "",
      "See the full contents in the product details on this page.",
    ]);
  }
  if (block) {
    return joinSentences([`With the ${product.title} —`, block]);
  }
  const sizes = specByLabel(product, [/sizes?/i]);
  if (sizes) {
    return `The ${product.title} comes in the following options — ${sizes}. Full details are on this page.`;
  }
  return `The ${product.title} comes as a single product — the size options and details are listed on this page.`;
}

function beginnerAnswer(product: CatalogProduct): string {
  if (product.tier === "beginner") {
    return `Yes — the ${product.title} is a great pick for ${TIER_LABEL.beginner}. Approachable, easy to work into any routine, and gentle enough to start with.`;
  }
  if (product.tier === "intermediate") {
    return `It can be — the ${product.title} sits in the ${TIER_LABEL.intermediate} band. Newcomers can absolutely use it, though you'll get the most from it once you have the basics of a routine down.`;
  }
  return `The ${product.title} is ${TIER_LABEL.pro} — a more advanced, targeted formula. If you're just starting out, an everyday-essentials product from the same collection is a gentler first step.`;
}

function specsAnswer(product: CatalogProduct): string {
  const summary = listSpecs(product, 5);
  if (summary) {
    return `Key details at a glance for the ${product.title}: ${summary}.`;
  }
  if (product.shortDescription) {
    return product.shortDescription;
  }
  return `Full details for the ${product.title} are listed on this page.`;
}

function travelAnswer(product: CatalogProduct): string {
  // Repurposed from the legacy "good for travel?" pill to an
  // everyday-vs-advanced positioning answer keyed off `tier`.
  if (product.tier === "beginner") {
    return `The ${product.title} is one of our ${TIER_LABEL.beginner} — an easy daily-care pick you can reach for every morning or evening.`;
  }
  if (product.tier === "intermediate") {
    return `The ${product.title} is solid ${TIER_LABEL.intermediate} — a step up for a routine you're ready to invest a little more in.`;
  }
  return `The ${product.title} is ${TIER_LABEL.pro} — a prestige, results-focused formula for when you want the most targeted treatment.`;
}

function resolutionAnswer(product: CatalogProduct): string {
  // Answers "what does this target / what are the key benefits?" —
  // sourced from the Targets spec and featureBlocks.
  const targets = specByLabel(product, [/targets?/i, /concerns?/i]);
  if (targets) {
    return `What the ${product.title} focuses on — ${targets}.`;
  }
  const block = findFeatureBlockMatching(product, [
    /\bbenefit\b/i,
    /\bhelps?\b/i,
    /\btargets?\b/i,
    /\bimproves?\b/i,
    /\breduces?\b/i,
  ]);
  if (block) {
    return joinSentences([`Key benefit of the ${product.title} —`, block]);
  }
  return product.shortDescription
    ? product.shortDescription
    : `The key benefits of the ${product.title} are listed in the details section on this page.`;
}

/* ============================================================
 * v2 builders — added when the original patterns weren't enough to
 * keep unknown-question answers from dumping `shortDescription`
 * (which the user perceived as "everything thrown at me randomly").
 * Each helper consults `useCaseTags` / `subtypes` first (highest-
 * fidelity signal), then a spec/featureBlock scan, then a tight
 * neutral string — never the verbose shortDescription.
 * ============================================================ */

function waterproofAnswer(product: CatalogProduct): string {
  // Answers "is this suitable for sensitive skin / gentle enough?" —
  // based on the skin-type tokens, fused tags, and any soothing/gentle
  // feature copy.
  const skinTypes = new Set(product.subtypes.map((s) => s.toLowerCase()));
  const suitsAll = skinTypes.has("all");
  const specRows = specsMatchingLabel(
    product,
    [
      /skin\s*type/i,
      /sensitive/i,
      /gentle/i,
      /soothing/i,
      /fragrance[-\s]?free/i,
      /non[-\s]?comedogenic/i,
    ],
    2,
  );
  const gentleBlock = findFeatureBlockMatching(product, [
    /\bsensitive\b/i,
    /\bgentle\b/i,
    /\bsooth\w*/i,
    /\bfragrance[-\s]?free\b/i,
    /\bnon[-\s]?comedogenic\b/i,
    /\bhypoallergenic\b/i,
  ]);
  if (suitsAll && (specRows.length > 0 || gentleBlock)) {
    return joinSentences([
      `Yes — the ${product.title} is formulated for all skin types, so it's a gentle choice for sensitive skin.`,
      gentleBlock ?? (specRows.length > 0 ? `${specRows.join("; ")}.` : ""),
    ]);
  }
  if (suitsAll) {
    return `Yes — the ${product.title} is suited to all skin types, which makes it a safe pick for sensitive skin. If your skin reacts easily, patch-test first and check the ingredient list on this page.`;
  }
  if (gentleBlock) {
    return joinSentences([`On sensitivity for the ${product.title} —`, gentleBlock]);
  }
  if (specRows.length > 0) {
    return `Per the details for the ${product.title}: ${specRows.join("; ")}. Patch-test first if your skin is easily irritated.`;
  }
  const skinTypeSpec = specByLabel(product, [/skin\s*type/i]);
  if (skinTypeSpec) {
    return `The ${product.title} is formulated for these skin types — ${skinTypeSpec}. For sensitive skin, patch-test first and review the ingredient list on this page.`;
  }
  return `The ${product.title} doesn't call out a specific sensitive-skin claim on this listing. Patch-test first, or look at an all-skin-types formula in the same collection if your skin is easily irritated.`;
}

function batteryAnswer(product: CatalogProduct): string {
  // Answers "how long does it last / how do I use it?" — sourced from
  // the Sizes and Routine specs plus any usage feature copy.
  const rows = specsMatchingLabel(
    product,
    [
      /sizes?/i,
      /\bml\b/i,
      /volume/i,
      /routine/i,
      /\bam\b|\bpm\b/i,
      /morning|evening|night/i,
      /how\s*to\s*use/i,
      /apply|application/i,
    ],
    2,
  );
  if (rows.length > 0) {
    return `Usage details for the ${product.title} — ${rows.join("; ")}.`;
  }
  const block = findFeatureBlockMatching(product, [
    /\bapply\b/i,
    /\bmorning\b/i,
    /\bevening\b/i,
    /\bdaily\b/i,
    /\broutine\b/i,
  ]);
  if (block) {
    return joinSentences([`How to use the ${product.title} —`, block]);
  }
  return `I don't have usage-timing details for the ${product.title} on file. Check the details section on this page for size options and how to work it into your routine.`;
}

function dimensionsAnswer(product: CatalogProduct): string {
  // Repurposed from "dimensions / weight" to "what size / volume does
  // it come in?" — sourced from the Sizes spec.
  const rows = specsMatchingLabel(
    product,
    [
      /sizes?/i,
      /\bml\b/i,
      /\bg\b/i,
      /volume/i,
      /capacity/i,
    ],
    3,
  );
  if (rows.length > 0) {
    return `Available sizes for the ${product.title} — ${rows.join("; ")}.`;
  }
  return `I don't have size or volume details for the ${product.title} on file. Check the details section on this page for the available options.`;
}

function rangeAnswer(product: CatalogProduct): string {
  // Repurposed from "transmission range" to "which collection is this
  // from / where does it sit in the lineup?" — sourced from the
  // Collection spec.
  const rows = specsMatchingLabel(
    product,
    [
      /collection/i,
      /line/i,
      /range/i,
    ],
    2,
  );
  if (rows.length > 0) {
    return `The ${product.title} is part of — ${rows.join("; ")}.`;
  }
  if (product.model) {
    return `The ${product.title} belongs to the ${product.model} collection. Explore the rest of the line from the collection page.`;
  }
  return `I don't have collection details for the ${product.title} on file. Check the details section on this page.`;
}

function audioAnswer(product: CatalogProduct): string {
  // Repurposed from the legacy "what should I pair this with?" pill to
  // "how do I layer this?" — recommends the next routine step based on
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
    return joinSentences([`Layering the ${product.title} —`, block]);
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
    nextStep = "Use it as the last step of your routine — after serum — and add sunscreen over the top in the morning.";
  } else if (category.includes("sunscreen")) {
    nextStep = "Apply it as the final morning step, after your moisturizer, before makeup.";
  } else if (category.includes("mask")) {
    nextStep = "Use it a few times a week after cleansing; follow with serum and moisturizer.";
  } else {
    nextStep = "Layer it in your usual order — cleanser, softener, serum, eye care, moisturizer, then sunscreen in the morning.";
  }
  return `The ${product.title} pairs best with the rest of your routine — ${nextStep}`;
}

function stabilizationAnswer(product: CatalogProduct): string {
  // Repurposed from the legacy "stabilization" pill to "what's the
  // texture / finish / how does it absorb?" — sourced from texture
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
    return joinSentences([`Texture & finish of the ${product.title} —`, block]);
  }
  const rows = specsMatchingLabel(
    product,
    [/type/i, /texture/i, /finish/i],
    1,
  );
  if (rows.length > 0) {
    return `Texture for the ${product.title} — ${rows.join("; ")}.`;
  }
  return `I don't have a texture note for the ${product.title} on file. Check the details section on this page for the format and finish.`;
}

function connectivityAnswer(product: CatalogProduct): string {
  // Repurposed from "connectivity / app" to "which skin types is this
  // for?" — sourced from the Skin type spec and subtype tokens.
  const rows = specsMatchingLabel(
    product,
    [
      /skin\s*type/i,
      /\bdry\b/i,
      /\boily\b/i,
      /\bcombination\b/i,
      /\bnormal\b/i,
      /all\s*skin/i,
    ],
    3,
  );
  if (rows.length > 0) {
    return `Skin types for the ${product.title} — ${rows.join("; ")}.`;
  }
  if (product.subtypes.length > 0) {
    return `The ${product.title} is formulated for ${product.subtypes.join(", ")} skin. Full details are on this page.`;
  }
  return `I don't have skin-type details for the ${product.title} on file. Check the details section on this page for who it's best suited to.`;
}

function lowLightAnswer(product: CatalogProduct): string {
  // Repurposed from "low-light performance" to "what results can I
  // expect / what are the key ingredients?" — sourced from key-benefit
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
    return joinSentences([`Key ingredients & results for the ${product.title} —`, block]);
  }
  const rows = specsMatchingLabel(
    product,
    [/targets?/i, /concerns?/i, /ingredient/i],
    2,
  );
  if (rows.length > 0) {
    return `What the ${product.title} works on — ${rows.join("; ")}.`;
  }
  return `I don't have a curated ingredient/results note for the ${product.title} on file. Check the details section on this page.`;
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
 * patterns ("what's included?", "is this good for beginners?", "walk
 * me through the benefits", "which skin type is this for?", "what does
 * it target?") and picks the matching builder. Unknown prompts fall
 * back to a concise spec snippet so the answer is at least
 * product-relevant.
 */
export function resolveProductFaq(
  product: CatalogProduct,
  prompt: string,
): string {
  const q = prompt.toLowerCase();

  if (/\bwhat'?s?\s+included\b|\bincludes?\b|\bin\s+the\s+set\b|\bset\s+contents?\b|\bcomes?\s+with\b/.test(q)) {
    return inTheBoxAnswer(product);
  }
  if (/\bbeginner|first[-\s]?time|easy\s+to\s+use|starter|entry[-\s]?level|new\s+to\s+skincare\b/.test(q)) {
    return beginnerAnswer(product);
  }
  if (/\b(spec|specs|specification|key\s+specs?|details)\b/.test(q)) {
    return specsAnswer(product);
  }
  if (/\beveryday|daily\s+use|prestige|advanced\s+care|luxur\w*|splurge\b/.test(q)) {
    return travelAnswer(product);
  }
  if (/\btarget\w*|concern\w*|benefit\w*|what\s+does\s+it\s+do|good\s+for\b/.test(q)) {
    return resolutionAnswer(product);
  }

  // v2 patterns — high-fidelity question shapes that previously fell
  // through to the shortDescription dump.
  if (/\b(sensitive|gentle|fragrance[-\s]?free|non[-\s]?comedogenic|irritat\w*|reactive|allerg\w*|hypoallergenic)\b/.test(q)) {
    return waterproofAnswer(product);
  }
  if (/\b(how\s+to\s+use|how\s+do\s+i\s+use|apply|application|routine|morning|evening|night|am\b|pm\b|how\s+often|how\s+long\s+(does\s+it\s+last|will\s+it\s+last)|last)\b/.test(q)) {
    return batteryAnswer(product);
  }
  if (/\b(size|sizes|volume|ml\b|how\s+much\s+product|how\s+big|capacity|how\s+many\s+ml)\b/.test(q)) {
    return dimensionsAnswer(product);
  }
  if (/\b(collection|line\b|lineup|which\s+range|part\s+of)\b/.test(q)) {
    return rangeAnswer(product);
  }
  if (/\b(layer|pair\s+with|what\s+to\s+use\s+with|combine|goes\s+with|next\s+step|order\s+of|before\s+or\s+after)\b/.test(q)) {
    return audioAnswer(product);
  }
  if (/\b(texture|finish|absorb\w*|greasy|sticky|feel\b|lightweight|rich\b|cream\b|gel\b|lotion\b|emulsion\b|consistency)\b/.test(q)) {
    return stabilizationAnswer(product);
  }
  if (/\b(skin\s*type|dry\s+skin|oily\s+skin|combination\s+skin|normal\s+skin|all\s+skin|who\s+is\s+it\s+for|suitable\s+for)\b/.test(q)) {
    return connectivityAnswer(product);
  }
  if (/\b(ingredient\w*|result\w*|does\s+it\s+work|effective\w*|proven|how\s+long\s+to\s+see|what'?s?\s+in\s+it|active\w*|retinol|vitamin|hyaluronic)\b/.test(q)) {
    return lowLightAnswer(product);
  }
  if (/\b(spf|sunscreen|sun\s+protect\w*|uv\b|sunblock)\b/.test(q)) {
    // Sunscreens are best answered with their benefit/target copy.
    return resolutionAnswer(product);
  }

  // Unknown question — try a single concise spec snippet that mentions
  // a content word from the prompt before deflecting to a one-liner.
  // Critically, we no longer return `product.shortDescription` here:
  // that's a multi-paragraph feature-block dump that read like
  // "everything thrown at me randomly".
  const fuzzy = fuzzyMatchSpec(product, q);
  if (fuzzy) {
    return `Per the details for the ${product.title}: ${fuzzy.label}: ${fuzzy.value}.`;
  }
  return `I don't have a specific answer for that on the ${product.title}. Check the details section on this page, or pick one of the suggested questions below.`;
}
