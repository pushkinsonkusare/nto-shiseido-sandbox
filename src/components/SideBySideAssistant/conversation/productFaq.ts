import type { CatalogProduct } from "../../../catalog/catalog";

/**
 * Programmatic FAQ floor for PDP-origin shopper questions.
 *
 * The `faq` NBA pills (e.g. "What's in the box?", "Is this
 * beginner-friendly?", "Walk me through the key specs") prefer the
 * OpenAI agent's free-text reply when an API key is configured. When
 * the key is absent — or the agent fails / yields no usable text — we
 * fall back to this resolver, which derives an answer from the
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
  beginner: "first-time creators",
  intermediate: "weekend creators",
  pro: "professional creators",
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
  // Prefer the curated `In_The_Box` list scraped from the JB Hi-Fi PDP
  // ("What's in the Box?" section) — it's the authoritative, fully
  // itemised inventory. Falls back to a heuristic featureBlocks scan
  // for SKUs whose source PDP was a stub / delisted at scrape time.
  if (product.inTheBox.length > 0) {
    return joinSentences([
      `Here's what ships with the ${product.title}:`,
      product.inTheBox.join("; ") + ".",
    ]);
  }
  const block = findFeatureBlockMatching(product, [
    /\bin the box\b/i,
    /\bwhat's? included\b/i,
    /\bwhat's? in the box\b/i,
    /\bships?\s+with\b/i,
  ]);
  if (block) {
    return joinSentences([
      `Here's what ships with the ${product.title}:`,
      block,
    ]);
  }
  return `The ${product.title} ships with the standard accessories listed in the product details on this page — open the gallery for the full unboxing shot.`;
}

function beginnerAnswer(product: CatalogProduct): string {
  if (product.tier === "beginner") {
    return `Yes — the ${product.title} is tuned for ${TIER_LABEL.beginner}. Simple controls, intelligent automation, and a forgiving learning curve.`;
  }
  if (product.tier === "intermediate") {
    return `It can be — the ${product.title} sits in the intermediate band. Beginners can grow into it, but you'll get more out of it once you're comfortable with the basics.`;
  }
  return `Not really — the ${product.title} is built for ${TIER_LABEL.pro}. If you're just starting out, consider a beginner-friendly option from the same family first.`;
}

function specsAnswer(product: CatalogProduct): string {
  const summary = listSpecs(product, 5);
  if (summary) {
    return `Top specs at a glance for the ${product.title}: ${summary}.`;
  }
  if (product.shortDescription) {
    return product.shortDescription;
  }
  return `Detailed specs for the ${product.title} are listed on this page.`;
}

function travelAnswer(product: CatalogProduct): string {
  const tags = new Set(product.useCaseTags.map((t) => t.toLowerCase()));
  const hits = ["travel", "compact", "portable", "lightweight"].filter((t) =>
    tags.has(t),
  );
  if (hits.length > 0) {
    return `Yes — the ${product.title} is tagged for ${hits.join(", ")}, so it's a solid travel companion.`;
  }
  return `The ${product.title} isn't specifically optimised for travel; if portability is your priority, check the compact/travel-tagged options in the same category.`;
}

function resolutionAnswer(product: CatalogProduct): string {
  const spec = specByLabel(product, [
    /resolution/i,
    /video/i,
    /\b4k\b/i,
    /\b8k\b/i,
  ]);
  if (spec) {
    return `Capture details for the ${product.title} — ${spec}.`;
  }
  if (/\b(4k|5\.1k|6k|8k)\b/i.test(product.title)) {
    const match = product.title.match(/\b(4k|5\.1k|6k|8k)\b/i);
    if (match) {
      return `Yes — the ${product.title} captures ${match[1].toUpperCase()} video.`;
    }
  }
  return product.shortDescription
    ? product.shortDescription
    : `Resolution details for the ${product.title} are listed in the specs section on this page.`;
}

/* ============================================================
 * v2 builders — added when the original 5 patterns weren't
 * enough to keep unknown-question answers from dumping
 * `shortDescription` (which the user perceived as "all product
 * specs thrown at me randomly"). Each helper consults
 * `useCaseTags` first (highest-fidelity signal), then a
 * spec/featureBlock scan, then a tight neutral string —
 * never the verbose shortDescription.
 * ============================================================ */

function waterproofAnswer(product: CatalogProduct): string {
  const isTagged = product.useCaseTags.includes("waterproof");
  const specRows = specsMatchingLabel(
    product,
    [
      /environmental\s*protection/i,
      /water[-\s]?proof/i,
      /water\s*resistan/i,
      /\bIP\s?\d{2}\b/i,
      /submer/i,
      /\bdive|diving|depth\b/i,
    ],
    2,
  );
  if (isTagged && specRows.length > 0) {
    return `Yes — the ${product.title} is rated for water use. ${specRows.join("; ")}.`;
  }
  if (isTagged) {
    return `Yes — the ${product.title} is rated waterproof. Check the specs section for the rated depth or housing requirements.`;
  }
  if (specRows.length > 0) {
    return `Per the specs for the ${product.title}: ${specRows.join("; ")}.`;
  }
  // Negative branch — pivot the recommendation on product type. Drones
  // don't take protective housings; "pair with a housing" was misleading
  // advice for any non-camera SKU. Action cameras and pocket cameras do
  // accept waterproof housings, so the original phrasing stays for them.
  if (product.productTypeGroup === "drone") {
    return `No — the ${product.title} is not water-rated and shouldn't be flown in rain or over water. For wet conditions, look at DJI's waterproof action cameras (Osmo Action / Osmo 360) instead.`;
  }
  if (
    product.productTypeGroup === "action_camera" ||
    product.productTypeGroup === "camera"
  ) {
    return `Not on this listing — the ${product.title} isn't water-rated by itself. Pair it with a protective housing for wet conditions, or pick one of DJI's IP-rated action cameras (Osmo Action / Osmo 360).`;
  }
  return `Not specifically — the ${product.title} isn't water-rated on this listing. Check the specs section or look at a waterproof-tagged alternative for wet conditions.`;
}

function batteryAnswer(product: CatalogProduct): string {
  const rows = specsMatchingLabel(
    product,
    [
      /\bbattery\b/i,
      /\bflight\s*time\b/i,
      /\bruntime\b/i,
      /\brun\s*time\b/i,
      /\brecording\s*time\b/i,
      /\bcharging\b/i,
      /\bcharge\s*time\b/i,
    ],
    2,
  );
  if (rows.length > 0) {
    return `Battery details for the ${product.title} — ${rows.join("; ")}.`;
  }
  return `I don't have battery details for the ${product.title} on file. Check the specs section on this page for runtime and charging info.`;
}

function dimensionsAnswer(product: CatalogProduct): string {
  const rows = specsMatchingLabel(
    product,
    [
      // Weight rows on DJI listings: "Product Weight (kg)", "Weight",
      // "Takeoff Weight", "Item weight". `\bweight\b` covers them all.
      /\bweight\b/i,
      // Physical dimensions rows: "Dimensions", "Folded size",
      // "Unfolded size", "Product size". Bare `/\bsize\b/i` is
      // intentionally NOT included — it false-matches "Device screen
      // size", "Internal memory size", "Battery size", etc.
      /\bdimension/i,
      /\b(?:folded|unfolded|product|item)\s+size\b/i,
      /\b(?:height|width|length|depth)\b/i,
    ],
    3,
  );
  if (rows.length > 0) {
    return `Dimensions for the ${product.title} — ${rows.join("; ")}.`;
  }
  return `I don't have size or weight details for the ${product.title} on file. Check the specs section on this page for the measurements.`;
}

function rangeAnswer(product: CatalogProduct): string {
  const rows = specsMatchingLabel(
    product,
    [
      /\brange\b/i,
      /\btransmission\b/i,
      /\bdistance\b/i,
      /\bvideo\s*range\b/i,
    ],
    2,
  );
  if (rows.length > 0) {
    return `Range for the ${product.title} — ${rows.join("; ")}.`;
  }
  return `I don't have a transmission-range figure for the ${product.title} on file. Check the specs section on this page for the rated range.`;
}

function audioAnswer(product: CatalogProduct): string {
  const block = findFeatureBlockMatching(product, [
    /\baudio\b/i,
    /\bmicrophone\b/i,
    /\bnoise/i,
  ]);
  if (block) {
    return joinSentences([`Audio on the ${product.title} —`, block]);
  }
  const rows = specsMatchingLabel(
    product,
    [/\bmic|microphone|audio|noise\b/i],
    2,
  );
  if (rows.length > 0) {
    return `Audio for the ${product.title} — ${rows.join("; ")}.`;
  }
  return `I don't have a dedicated audio breakdown for the ${product.title} on file. Pair it with a DJI Mic for clean voiceover.`;
}

function stabilizationAnswer(product: CatalogProduct): string {
  const block = findFeatureBlockMatching(product, [
    /\bstabili[sz]/i,
    /\bRockSteady\b/i,
    /\bHorizonSteady\b/i,
    /\bHorizonBalancing\b/i,
    /\b(?:E|O)IS\b/,
  ]);
  if (block) {
    return joinSentences([`Stabilization on the ${product.title} —`, block]);
  }
  const rows = specsMatchingLabel(
    product,
    [/\bstabili[sz]/i],
    1,
  );
  if (rows.length > 0) {
    return `Stabilization for the ${product.title} — ${rows.join("; ")}.`;
  }
  return `I don't have explicit stabilization details for the ${product.title} on file. Check the specs section for the rated mode.`;
}

function connectivityAnswer(product: CatalogProduct): string {
  const rows = specsMatchingLabel(
    product,
    [
      /\bwi[-\s]?fi\b/i,
      /\bbluetooth\b/i,
      /\bapp\b/i,
      /\bnfc\b/i,
      /\busb\b/i,
    ],
    3,
  );
  if (rows.length > 0) {
    return `Connectivity for the ${product.title} — ${rows.join("; ")}.`;
  }
  return `I don't have connectivity details for the ${product.title} on file. Check the specs section on this page for Wi-Fi / Bluetooth / USB info.`;
}

function lowLightAnswer(product: CatalogProduct): string {
  const block = findFeatureBlockMatching(product, [
    /\blow[-\s]?light\b/i,
    /\bnight\s*mode\b/i,
    /\bSuperNight\b/i,
    /\bdynamic\s*range\b/i,
    /\bISO\b/,
  ]);
  if (block) {
    return joinSentences([`Low-light on the ${product.title} —`, block]);
  }
  const rows = specsMatchingLabel(
    product,
    [/\bISO\b|\blow[-\s]?light\b|\bdynamic\s*range\b/i],
    2,
  );
  if (rows.length > 0) {
    return `Low-light for the ${product.title} — ${rows.join("; ")}.`;
  }
  return `I don't have a curated low-light note for the ${product.title} on file. Check the gallery or specs section for sensor details.`;
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
 * patterns ("what's in the box?", "is this beginner-friendly?", "walk
 * me through specs", "will this work for travel?", "is this 4K?") and
 * picks the matching builder. Unknown prompts fall back to the
 * product's short description so the answer is at least
 * product-relevant.
 */
export function resolveProductFaq(
  product: CatalogProduct,
  prompt: string,
): string {
  const q = prompt.toLowerCase();

  if (/\bin\s+the\s+box\b|\bwhat'?s?\s+included\b|\bbox\s+contents?\b/.test(q)) {
    return inTheBoxAnswer(product);
  }
  if (/\bbeginner|first[-\s]?time|easy\s+to\s+use|starter|entry[-\s]?level\b/.test(q)) {
    return beginnerAnswer(product);
  }
  if (/\b(spec|specs|specification|key\s+specs?)\b/.test(q)) {
    return specsAnswer(product);
  }
  if (/\btravel|trip|on[-\s]?the[-\s]?go|portable|backpack\b/.test(q)) {
    return travelAnswer(product);
  }
  if (/\b4k|5\.1k|6k|8k|resolution|video\s+quality\b/.test(q)) {
    return resolutionAnswer(product);
  }

  // v2 patterns — high-fidelity question shapes that previously fell
  // through to the shortDescription dump.
  if (/\b(waterproof|water[-\s]?proof|water\s*resistan|underwater|submer\w*|dive|diving|scuba|swim\w*|wet|rain)\b/.test(q)) {
    return waterproofAnswer(product);
  }
  if (/\b(battery|charge|charging|flight\s*time|runtime|how\s*long\s*(does\s+it\s+last|can\s+i\s+(fly|use|record))|hours?\s+of\s+use|recording\s+time)\b/.test(q)) {
    return batteryAnswer(product);
  }
  if (/\b(weight|weighs|how\s*heavy|dimension|dimensions|size|how\s*big|how\s*small|fold(ed)?\s*size|height|width|length)\b/.test(q)) {
    return dimensionsAnswer(product);
  }
  if (/\b(range|how\s*far|transmission|signal\s*range|distance|video\s*range)\b/.test(q)) {
    return rangeAnswer(product);
  }
  if (/\b(audio|microphone|mic\b|sound\s*quality|noise|wind\s*noise)\b/.test(q)) {
    return audioAnswer(product);
  }
  if (/\b(stabili[sz]ation|stabili[sz]ed|stable|shaky|rocksteady|horizonsteady|gimbal\s*lock|electronic\s*stabili|optical\s*stabili)\b/.test(q)) {
    return stabilizationAnswer(product);
  }
  if (/\b(wi[-\s]?fi|bluetooth|app|connect\w*|stream|live\s*stream|usb)\b/.test(q)) {
    return connectivityAnswer(product);
  }
  if (/\b(low[-\s]?light|night\s*mode|night\s+shooting|night\s+vision|iso|dark|dim|sunset|sunrise|astro)\b/.test(q)) {
    return lowLightAnswer(product);
  }

  // Unknown question — try a single concise spec snippet that mentions
  // a content word from the prompt before deflecting to a one-liner.
  // Critically, we no longer return `product.shortDescription` here:
  // that's a multi-paragraph feature-block dump that read like
  // "all product specs thrown at me randomly".
  const fuzzy = fuzzyMatchSpec(product, q);
  if (fuzzy) {
    return `Per the specs for the ${product.title}: ${fuzzy.label}: ${fuzzy.value}.`;
  }
  return `I don't have a specific answer for that on the ${product.title}. Check the specs section on this page, or pick one of the suggested questions below.`;
}
