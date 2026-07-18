import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CatalogProduct } from "../../../catalog/catalog";
import { formatPrice } from "../../../catalog/catalog";
import {
  getProductsForProductListingPage,
  orderProductsLikeCatalog,
} from "../../../catalog/plpListing";
import { useCatalog } from "../../../catalog/CatalogContext";
import type { PdpNbaPillKind } from "../../../pages/ProductDetailPage/pdpNbaPills";
import {
  createOpenAIAgent,
  type AgentAction,
  type OpenAIAgent,
} from "../../SidecarAssistant/agent/openaiAgent";
import {
  DJI_HELP_CENTER_URL,
  POLICY_BODIES,
  buildPlpIntro,
  buildStageNbas,
  classifyHygieneTopic,
  classifyIntent,
  classifySymptomAccessory,
  filterProducts,
  findBundlesForIntent,
  findSymptomAccessories,
  listSymptomHostCandidates,
  type HygieneTopic,
  type Intent,
  type SymptomAccessoryIntent,
} from "../../SidecarAssistant/conversation/flow";
import type { BroadResultRow } from "../components/BroadResultCard";
import type { CompactResultProduct } from "../components/CompactResultCard";
import type { NbaPill } from "../components/NbaPillRow";
import {
  buildRowProductsFromSpec,
  extractActivitiesFromQuery,
  getDefaultRecipe,
  pickRecipeForIntent,
  registerRuntimeSpec,
  type BroadSubTopicSpec,
} from "./broadRecipes";
import { resolveProductFaq } from "./productFaq";
import type { SxsMessage } from "./types";
import { isLlmConfigured } from "../../../lib/openaiClient";

const RESPONSE_LATENCY_MS = 900;

const GREETING_BODY =
  "I'm your DJI Personal Assistant. I can help you find the right gear, compare specs, and bundle the right accessories. What are you shopping for?";

/** Per-topic label for the variant-1 external-link CTA inside the
 * AgentPdpUtterance card. Always points at DJI_HELP_CENTER_URL. */
const HYGIENE_CTA_LABEL: Record<HygieneTopic, string> = {
  return: "Detailed return policy",
  replacement: "Replacement service details",
  warranty: "Warranty information",
  shipping: "Shipping & delivery info",
};

let messageIdCounter = 0;
function nextId(prefix: string) {
  messageIdCounter += 1;
  return `${prefix}-${messageIdCounter}`;
}

function toCompactProduct(product: CatalogProduct): CompactResultProduct {
  return {
    id: product.slug,
    imageUrl: product.imageUrl,
    imageAlt: product.imageAlt,
    title: product.title,
  };
}

function buildResultBody(intro: string, count: number): string {
  if (intro && intro.trim()) return intro.trim();
  if (count === 0) {
    return "I couldn't find a great match — let's narrow that down. What matters most to you?";
  }
  return `I curated ${count} option${count === 1 ? "" : "s"} for you. Tap See Results to explore them in the storefront, or pick a follow-up below.`;
}

/**
 * Title shown above the result-card carousel. Prefer the resolved
 * intent's `categoryLabel` (lightly tier-prefixed) over the raw query
 * — echoing the query reads as "ND filter for Mavic 4 Pro" on a card
 * that's clearly a drone listing, which is confusing.
 */
function buildResultTitle(query: string, intent?: Intent): string {
  if (intent && intent.kind === "direct" && intent.categoryLabel) {
    const base = intent.categoryLabel;
    const capitalized = base.charAt(0).toUpperCase() + base.slice(1);
    // Tier prefix only applies to flagship categories where it's
    // semantically meaningful. Accessory rows ("filters", "mounts",
    // "cases") aren't tier-graded — keep them clean.
    const FLAGSHIP_LABELS = new Set([
      "drones", "action cameras", "gimbals", "microphones", "cameras",
    ]);
    // When the shopper named a specific model, anchor the title on it
    // so the card reads "Filters for Mavic 4 Pro" instead of just
    // "Filters" (which would be ambiguous given the compatibility-
    // narrowed product list below).
    if (intent.compatibleWith) {
      const model = titleCaseModel(intent.compatibleWith);
      return `${capitalized} for ${model}`;
    }
    if (FLAGSHIP_LABELS.has(base)) {
      if (intent.tier === "pro") return `Pro ${base}`;
      if (intent.tier === "beginner") return `Beginner-friendly ${base}`;
    }
    return capitalized;
  }
  const trimmed = query.trim();
  if (!trimmed) return "Curated picks for you";
  const cleaned = trimmed.replace(/[?.!]+$/u, "").trim();
  if (cleaned.length === 0) return "Curated picks for you";
  return cleaned.length > 64 ? `${cleaned.slice(0, 61)}…` : cleaned;
}

/**
 * Render a model token like "mavic 4 pro" / "osmo pocket 3" / "rs 4
 * pro" with appropriate casing for use in card titles ("Mavic 4 Pro").
 */
function titleCaseModel(model: string): string {
  return model
    .split(" ")
    .map((word) => {
      if (!word) return word;
      // Keep alphanumeric tokens like "4k", "3", "se" as the model
      // table writes them — uppercase the first letter, leave the
      // rest as-is so "rs", "se", "4k" don't get mangled.
      if (/^\d/.test(word)) return word.toUpperCase();
      if (word.length <= 2) return word.toUpperCase();
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}

/**
 * Title for a symptom-driven recommendation card. Rendered as
 *   "<Polarising filters> for your <Osmo Action 5 Pro>"
 *   "<Polarising filters> for your <Osmo Action>" (family case)
 *   "<Polarising filters>" (no model named)
 */
function buildSymptomResultTitle(intent: SymptomAccessoryIntent): string {
  const label = intent.symptom.label;
  const capitalized = label.charAt(0).toUpperCase() + label.slice(1);
  if (intent.modelToken) {
    return `${capitalized} for your ${titleCaseModel(intent.modelToken)}`;
  }
  if (intent.modelFamily) {
    return `${capitalized} for your ${intent.modelFamily.titleFragment}`;
  }
  return capitalized;
}

/**
 * Imperative phrase used as the prefix of a disambiguation-chip
 * label. The phrase MUST embed a SYMPTOM_PATTERNS-matching keyword
 * so when the shopper clicks the chip, the resulting follow-up
 * message ("Reduce glare on my Osmo Action 6") re-fires the
 * symptom branch with a now-versioned `modelToken`.
 *
 * Keyed on the symptom label (the `label` field on
 * `SYMPTOM_PATTERNS` entries). Falls back to the label itself if
 * unknown — the chip would then route via the regular classifier,
 * losing the symptom context, but at least won't fail.
 */
const SYMPTOM_CHIP_PREFIX: Record<string, string> = {
  "polarising filters": "Reduce glare",
  "ND filters": "Tame bright sun",
  windscreens: "Cut wind noise",
  gimbals: "Stabilize shaky footage",
  "extra batteries": "Extra battery",
  "waterproof gear": "Take it underwater",
  "lens protectors": "Protect against scratches",
};

function symptomChipPrefix(intent: SymptomAccessoryIntent): string {
  return SYMPTOM_CHIP_PREFIX[intent.symptom.label] ?? intent.symptom.label;
}

/**
 * Intro line for a symptom-driven recommendation card. Pivots on
 * count and on whether the shopper named a specific host so the
 * copy never claims "for your Mavic 4 Pro" when no model was
 * named.
 */
function buildSymptomIntro(
  intent: SymptomAccessoryIntent,
  count: number,
): string {
  const label = intent.symptom.label;
  if (count === 0) {
    return `I couldn't find a perfect ${label} match — try one of the related options below.`;
  }
  if (intent.modelToken) {
    return `Here are the best ${label} for your ${titleCaseModel(intent.modelToken)}:`;
  }
  if (intent.modelFamily) {
    return `Here are the best ${label} for your ${intent.modelFamily.titleFragment}:`;
  }
  return `Here are the ${label} that should help:`;
}

/**
 * Build the grounding preamble we prepend to a PDP-origin FAQ prompt
 * before sending it to the LLM. The shopper's bubble in the chat keeps
 * showing the raw question — only the model-facing prompt is enriched.
 *
 * Without this, the agent only sees the product TITLE + CATEGORY in the
 * preamble (legacy behaviour) and confabulates concrete facts like
 * what ships in the box, weight, runtime, rated depth, etc. — even when
 * the catalog already has authoritative scraped data for the SKU.
 *
 * The block is intentionally compact: capped to the most-likely-useful
 * fields and a hard length budget per block so the per-turn token cost
 * stays bounded. The phrasing is borrowed from `resolveProductFaq` so
 * the LLM can paraphrase it directly when the question matches one of
 * the canonical FAQ patterns.
 */
function buildPdpFaqGroundedPrompt(
  product: CatalogProduct,
  question: string,
): string {
  const facts: string[] = [];

  // Product taxonomy + canonical capability tags. These were missing
  // from the v1 preamble, which left the LLM unable to confidently
  // answer definitive yes/no questions ("is this waterproof?", "is
  // this rugged?", "good for travel?") for SKUs whose answer depends
  // on the curated capability tag rather than a verbatim spec row —
  // e.g. drones like the Mini 5 Pro have no waterproof spec line, so
  // the LLM would deflect with "I don't have that detail" even though
  // the catalog clearly tags them as NOT waterproof. Surfacing the
  // tags + a derived `Waterproof: Yes/No` line lets the LLM answer
  // assertively with catalog-grounded confidence.
  const productTypeLabel = product.productTypeGroup
    ? product.productTypeGroup.replace(/_/g, " ")
    : product.category;
  if (productTypeLabel) {
    facts.push(`- Product type: ${productTypeLabel}.`);
  }
  if (product.useCaseTags.length > 0) {
    facts.push(`- Capabilities: ${product.useCaseTags.join(", ")}.`);
  }
  // Explicit waterproof line — the most common definitive yes/no FAQ
  // and the one the LLM consistently gets wrong without it. The
  // assertive phrasing on each branch lets the model paraphrase
  // directly without hedging.
  if (product.useCaseTags.includes("waterproof")) {
    facts.push(
      `- Waterproof: Yes — this product is rated for water use. Cite the IP rating / depth from specs or feature highlights when present.`,
    );
  } else {
    facts.push(
      `- Waterproof: No — this product is NOT water-rated. Drones especially should not be flown in rain or near water; recommend a protective housing or a waterproof-tagged alternative.`,
    );
  }

  if (product.inTheBox.length > 0) {
    facts.push(`- In the box: ${product.inTheBox.join("; ")}.`);
  }

  // Cap specs to the first 12 label/value pairs so the preamble stays
  // bounded for SKUs (e.g. drones) that ship 40+ rows. The most
  // important specs are listed first on the JB Hi-Fi PDP we scraped, so
  // the head-of-list slice is a reasonable signal.
  const usefulSpecs = product.specs
    .filter((s) => s.label && s.value)
    .slice(0, 12)
    .map((s) => `${s.label}: ${s.value}`);
  if (usefulSpecs.length > 0) {
    facts.push(`- Key specs: ${usefulSpecs.join("; ")}.`);
  }

  // Feature blocks are free-text marketing prose — useful for "is this
  // beginner friendly", "how is the low-light", "what's the
  // stabilization story" questions. Cap each block to ~240 chars and
  // include up to 4 so the preamble doesn't balloon.
  const usefulBlocks = product.featureBlocks
    .map((b) => b.trim())
    .filter(Boolean)
    .slice(0, 4)
    .map((b) => (b.length > 240 ? `${b.slice(0, 237)}…` : b));
  if (usefulBlocks.length > 0) {
    facts.push(`- Highlights: ${usefulBlocks.join(" | ")}`);
  }

  if (product.priceFormatted) {
    facts.push(`- Price: ${product.priceFormatted}.`);
  }

  if (product.shortDescription) {
    const trimmed = product.shortDescription.trim();
    const capped = trimmed.length > 240 ? `${trimmed.slice(0, 237)}…` : trimmed;
    facts.push(`- Summary: ${capped}`);
  }

  const factsBlock = facts.length > 0
    ? [
        "",
        "PRODUCT FACTS (authoritative — answer ONLY from these. Do NOT invent box contents, specs, prices, or features not listed here. If the answer isn't here, say you don't have that detail and point them at the specs section on the page):",
        ...facts,
        "",
      ].join("\n")
    : "";

  return [
    `The shopper is currently viewing the ${product.title} (${product.category}).`,
    factsBlock,
    `Their question: ${question}`,
  ].join("\n");
}

function buildPillsFromLabels(labels: ReadonlyArray<string>): NbaPill[] {
  return labels.map((label) => ({
    id: `pill-${label.replace(/\W+/g, "-").toLowerCase()}-${nextId("pill")}`,
    label,
  }));
}

/* ---------- Broad result card builders ----------
 *
 * For a broad/exploratory shopper query (e.g. "Gear for moto vlogging",
 * "Help me pick gear for my New Zealand trip", "I'm a beginner — suggest
 * equipment") we surface a stack of curated sub-topic rows instead of a
 * single carousel. The recipe + product-resolution logic lives in
 * `./broadRecipes.ts` so the data is easy to tweak. Here we only mint
 * row ids, slice the resolved product pools into thumb + slug payloads,
 * and gate empty results.
 */

/**
 * Resolve the chosen recipe against the loaded catalog into BroadResultRows.
 * Returns at least 2 rows on success; falls back to the default 5-category
 * recipe if the chosen recipe can't yield enough rows from this catalog.
 * Returns [] when even the default recipe is empty (catalog not loaded).
 */
function buildBroadSubTopics(
  intent: Intent,
  products: CatalogProduct[],
  query?: string,
): BroadResultRow[] {
  if (products.length === 0) return [];

  const resolveRecipe = (recipe: BroadSubTopicSpec[]): BroadResultRow[] => {
    const rows: BroadResultRow[] = [];
    for (const spec of recipe) {
      const pool = buildRowProductsFromSpec(spec, products);
      if (pool.length === 0) continue;
      // `buildRowProductsFromSpec` already enforces `spec.leadCount` so
      // `pool.length` IS the curated count we want to show.
      rows.push({
        id: nextId("broad-row"),
        title: spec.title,
        thumb: toCompactProduct(pool[0]),
        productSlugs: pool.map((p) => p.slug),
        totalResultCount: pool.length,
        // The recipe path leans on `recipeKey` for the See Results
        // handoff: the PLP looks the spec up by id and reapplies the
        // full filter (incl. title patterns the URL can't carry
        // cleanly). Leaving category/capabilities/accessoryRole
        // undefined keeps the URL clean — the recipe spec is the
        // single source of truth.
        recipeKey: spec.id,
      });
      if (rows.length >= 6) break;
    }
    return rows;
  };

  // Pass the raw query so the picker can detect activity keywords
  // (podcast, wedding, skiing, surfing, …) that don't surface as
  // canonical `useCaseTags` and route to a tailored activity recipe
  // instead of the generic 5-row DEFAULT.
  const primaryRecipe = pickRecipeForIntent(intent, query);
  const primary = resolveRecipe(primaryRecipe);
  if (primary.length >= 2) return primary;

  const fallback = resolveRecipe(getDefaultRecipe());
  return fallback.length >= 2 ? fallback : [];
}

/**
 * Tailored body-text by detected activity — mirrors the Figma vlogging
 * card copy and gives every other recognised activity a similarly-shaped
 * intro instead of the generic "curated a few directions for you".
 */
const ACTIVITY_BODY_TEXT: Record<string, string> = {
  motorcycle: "I have curated a set of gear that you would need for moto vlogging. Let me know if you have anything specific in mind.",
  cycling: "Here's a set of cycling-ready gear across categories. Pick a row to explore, or tell me more about your ride.",
  skiing_snowboarding: "I've pulled together gear that holds up on the mountain. Pick a row to explore, or share more about the conditions you're shooting in.",
  surfing: "Here's a set of waterproof gear for surf sessions. Pick a row to dive in, or tell me more about your setup.",
  watersports: "Here's a set of waterproof gear for watersports. Pick a row to explore, or tell me more about what you'll be shooting.",
  hiking_outdoor: "I've curated outdoor-ready gear across categories. Pick a row to explore, or share more about your trail plans.",
  travel: "I've pulled together travel-ready picks across categories. Tap one to dive in, or share more about your trip.",
  vlog: "I've curated a vlogger's kit across categories. Pick a row to explore, or tell me more about your style.",
  podcast: "Here's a podcasting-ready kit. Pick a row to explore, or tell me more about your setup.",
  interview: "Here's a kit suited for interviews. Pick a row to explore, or share more about the format.",
  livestream: "I've pulled together livestream-ready gear. Pick a row to explore, or share more about your stream.",
  wedding: "I've curated a wedding videographer's kit. Pick a row to explore, or tell me more about the shoot.",
  real_estate_aerial: "Here's a real-estate aerial kit. Pick a row to explore, or tell me more about the property.",
  news_journalism: "I've curated gear for journalism work. Pick a row to explore, or tell me more about your beat.",
  concert_event: "Here's a concert/event kit. Pick a row to explore, or share more about the venue.",
  theatre: "I've curated gear suited for theatre productions. Pick a row to explore.",
  indoor_sports: "Here's a kit for indoor-sports coverage. Pick a row to explore.",
  family: "Here's a set of family-friendly gear. Pick a row to explore, or tell me more about how you'll use it.",
  beginner_creator: "Here are some beginner-friendly starting points. Pick a row to explore, or tell me more about what you'll shoot.",
  professional_filmmaker: "Here's a professional filmmaker's kit. Pick a row to explore, or tell me more about your project.",
};

function buildBroadBodyText(query: string, intent: Intent): string {
  const trimmed = query.trim();
  if (intent.kind === "empty" || !trimmed) {
    return "I've curated a few starting points. Pick one to explore, or tell me a bit more about what you're shopping for.";
  }
  const tags = intent.requiredTags ?? [];
  // v6 activity-aware body text runs FIRST so compound queries like
  // "gear for travel vlogging" pick up the travel-flavoured copy
  // (matches the routing change in `pickRecipeForIntent` that now
  // prefers the activity scanner over the `vlogging` tag).
  const activities = extractActivitiesFromQuery(query);
  if (activities.length > 0) {
    const copy = ACTIVITY_BODY_TEXT[activities[0]];
    if (copy) return copy;
  }
  if (tags.includes("vlogging")) {
    // Selfie/creator-tag fallthrough — no activity matched, so the
    // residual VLOGGING_RECIPE is what the picker returned. Keep the
    // legacy moto-vlogging copy here so existing recipe stays exact.
    return ACTIVITY_BODY_TEXT.motorcycle;
  }
  if (tags.includes("rugged")) {
    return "Here's a set of rugged-ready gear across categories. Tap a row to dive in, or tell me more about your shoot.";
  }
  if (intent.tier === "beginner") {
    return ACTIVITY_BODY_TEXT.beginner_creator;
  }
  if (tags.includes("compact") || tags.includes("travel")) {
    return ACTIVITY_BODY_TEXT.travel;
  }
  return "I've curated a few directions for you. Pick one to explore, or tell me a bit more about what you're after.";
}

/**
 * Result-card payload returned to the host so the host can drive the storefront
 * (e.g. navigate the PLP to those products) when the shopper clicks "See Results".
 */
export type SeeResultsPayload = {
  productSlugs: string[];
  category?: string;
  query: string;
};

/**
 * The welcome pill row is curated to teach four things at a glance:
 *   1. How to write a great prompt (tier + use-case + budget recipe).
 *   2. The breadth of what we sell (broad card across all categories).
 *   3. What a specific search feels like (clean direct query).
 *   4. What a contextual broad search feels like (real-world exploratory query).
 *
 * Pills 1 and 3 hit category patterns in `classifyIntent` so they classify
 * as `direct` and render a CompactResultCard. Pills 2 and 4 use "Help me"
 * phrasing that matches BROAD_PATTERNS, so they classify as `broad` and
 * render the BroadResultCard. The OpenAI agent's system prompt also routes
 * exploratory queries to `show_broad_listing`, keeping behaviour aligned
 * across both branches.
 */
const WELCOME_NBA_LABELS: ReadonlyArray<string> = [
  "Beginner drone for landscape photography under $500",
  "Gear for moto vlogging",
  "Wireless mic for podcasts",
  "Help me pick gear for my New Zealand trip",
];

/**
 * Build the initial conversation: a greeting card + a curated NBA pill row.
 * Shared between the first-load seed effect and `clearChat` so both surfaces
 * stay in lockstep with the welcome experience.
 */
function buildWelcomeMessages(): SxsMessage[] {
  return [
    {
      id: nextId("greeting"),
      kind: "greeting",
      imageUrl: "/Welcome_cover.jpeg",
      imageAlt: "Welcome to the DJI store",
      greeting: "Hello!",
      body: GREETING_BODY,
    },
    {
      id: nextId("nbas"),
      kind: "agent_nbas",
      pills: buildPillsFromLabels(WELCOME_NBA_LABELS),
    },
  ];
}

export function useSideBySideAgent() {
  const { products, getProductBySlug } = useCatalog();
  const [messages, setMessages] = useState<SxsMessage[]>([]);
  const [isResponding, setIsResponding] = useState(false);

  const messagesRef = useRef<SxsMessage[]>([]);
  const pendingTimeouts = useRef<number[]>([]);
  const lastQueryRef = useRef<string>("");
  const seededRef = useRef(false);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  /* ---------- helpers ---------- */

  const appendMessage = useCallback((message: SxsMessage) => {
    setMessages((current) => {
      // Only one NBA pill row at a time — drop any earlier pills when new ones land.
      if (message.kind === "agent_nbas") {
        return [
          ...current.filter((m) => m.kind !== "agent_nbas"),
          message,
        ];
      }
      return [...current, message];
    });
  }, []);

  const removeMessage = useCallback((id: string) => {
    setMessages((current) => current.filter((m) => m.id !== id));
  }, []);

  const scheduleResponse = useCallback(
    (handler: () => void, delay = RESPONSE_LATENCY_MS) => {
      const timeoutId = window.setTimeout(() => {
        handler();
        pendingTimeouts.current = pendingTimeouts.current.filter(
          (id) => id !== timeoutId,
        );
      }, delay);
      pendingTimeouts.current.push(timeoutId);
    },
    [],
  );

  /* ---------- OpenAI agent (optional, mirrors Sidecar) ---------- */

  const agentRef = useRef<OpenAIAgent | null>(null);
  if (agentRef.current === null && isLlmConfigured() && products.length > 0) {
    agentRef.current = createOpenAIAgent({
      products,
      getProductBySlug: (slug) => getProductBySlug(slug),
    });
  }

  /* ---------- rule-based fallback ---------- */

  const renderRuleBased = useCallback(
    (query: string) => {
      // Hygiene questions (returns, refunds, warranty, shipping,
      // replacement) short-circuit BEFORE intent classification — they
      // aren't shopping queries, so the broad/direct flow would otherwise
      // surface a curated category card that ignores what the shopper
      // actually asked. Answers are sourced from the shared DJI Help
      // Center knowledge base in `flow.ts` so the rule-based and OpenAI
      // paths stay aligned.
      const hygieneTopic = classifyHygieneTopic(query);
      if (hygieneTopic) {
        appendMessage({
          id: nextId("agent"),
          kind: "agent_text",
          body: POLICY_BODIES[hygieneTopic],
        });
        const followUps = buildStageNbas({
          stage: "probing",
          intent: { kind: "broad" },
        });
        if (followUps.length > 0) {
          appendMessage({
            id: nextId("nbas"),
            kind: "agent_nbas",
            pills: buildPillsFromLabels(followUps.map((item) => item.label)),
          });
        }
        return;
      }

      // Symptom-driven accessory branch. Catches "I have an X, how
      // do I solve Y" turns (glare, wind noise, shaky footage, etc.)
      // and surfaces the right accessory shelf scoped to the named
      // host product instead of dumping the whole category. Runs
      // BEFORE classifyIntent so the existing CATEGORY_PATTERNS
      // (which would otherwise capture "osmo action" → action
      // cameras category) doesn't beat us to the punch. When no
      // matching accessory is found we fall through to
      // classifyIntent so the shopper still gets a useful card.
      const symptomIntent = classifySymptomAccessory(query);
      if (symptomIntent) {
        const matches = findSymptomAccessories(symptomIntent, products, 6);
        if (matches.length > 0) {
          const cardSlice = matches.slice(0, 6);
          const intro = buildSymptomIntro(symptomIntent, matches.length);
          // Pass the modelToken / family token through as
          // `compatibleWith` so the See Results CTA narrows the PLP
          // to the same scope the card showed.
          const compatibleWith =
            symptomIntent.modelToken ??
            symptomIntent.modelFamily?.titleFragment.toLowerCase();
          appendMessage({
            id: nextId("symptom-result"),
            kind: "agent_result_card",
            bodyText: buildResultBody(intro, matches.length),
            title: buildSymptomResultTitle(symptomIntent),
            products: cardSlice.map(toCompactProduct),
            productSlugs: cardSlice.map((p) => p.slug),
            totalResultCount: matches.length,
            // Use the first match's category so the See Results CTA
            // lands on a real PLP bucket (Lens filters, Camera
            // batteries, Gimbals, ...).
            category: cardSlice[0]?.category,
            compatibleWith,
            subtypes: symptomIntent.symptom.subtypes,
          });

          // Disambiguation chips: only when the shopper named a family
          // (no version) AND the family has 2+ candidate hosts. Each
          // chip becomes a follow-up shopper turn that re-fires this
          // branch with a versioned modelToken — the chip label keeps
          // the symptom keyword AND adds an explicit "my <model>"
          // clause so OWNS + symptom both match on re-classify.
          const hostCandidates = listSymptomHostCandidates(
            symptomIntent,
            products,
            4,
          );
          if (hostCandidates.length >= 2) {
            const chipPrefix = symptomChipPrefix(symptomIntent);
            const chipLabels = hostCandidates.map(
              (host) =>
                `${chipPrefix} on my ${host.title.replace(/^DJI\s+/i, "")}`,
            );
            appendMessage({
              id: nextId("nbas"),
              kind: "agent_nbas",
              pills: buildPillsFromLabels(chipLabels),
            });
          }
          return;
        }
        // No matches found — let classifyIntent take over so we
        // never dead-end the shopper with an empty card.
      }

      const intent = classifyIntent(query);

      if (intent.kind === "broad" || intent.kind === "empty") {
        const broadRows = buildBroadSubTopics(intent, products, query);
        if (broadRows.length > 0) {
          appendMessage({
            id: nextId("broad-result"),
            kind: "agent_broad_result_card",
            bodyText: buildBroadBodyText(query, intent),
            rows: broadRows,
          });
          const probing = buildStageNbas({ stage: "probing", intent });
          if (probing.length > 0) {
            appendMessage({
              id: nextId("nbas"),
              kind: "agent_nbas",
              pills: buildPillsFromLabels(probing.map((item) => item.label)),
            });
          }
          return;
        }
        // Catalog couldn't yield enough sub-topics — fall back to the
        // legacy text + probing pills response so we never render an
        // empty card.
        appendMessage({
          id: nextId("agent"),
          kind: "agent_text",
          body: "Tell me a bit more — are you shopping for a drone, an action camera, a gimbal, or accessories?",
        });
        const probing = buildStageNbas({ stage: "probing", intent });
        appendMessage({
          id: nextId("nbas"),
          kind: "agent_nbas",
          pills: buildPillsFromLabels(probing.map((item) => item.label)),
        });
        return;
      }

      const matches = filterProducts(intent, products);

      if (matches.length === 0) {
        appendMessage({
          id: nextId("agent"),
          kind: "agent_text",
          body: "I couldn't find an exact match — let's narrow that down. What matters most to you?",
        });
        const probing = buildStageNbas({ stage: "probing", intent });
        appendMessage({
          id: nextId("nbas"),
          kind: "agent_nbas",
          pills: buildPillsFromLabels(probing.map((item) => item.label)),
        });
        return;
      }

      // When the intent narrows beyond the bare category — by a
      // specific model (e.g. "ND filter for Mavic 4 Pro"), required
      // use-case tags (e.g. "accessories for deep sea" → waterproof),
      // a buyer tier ("Pro drones", "Beginner action cam"), or a
      // budget cap ("drones under $500") — use the already-narrowed
      // `matches` instead of the full category preview row. Otherwise
      // the carousel ignores the narrowing filter and shows the whole
      // category (e.g. "Pro drones" leaking Mini/Neo).
      //
      // GENERIC ACCESSORIES FOR A MODEL ("Accessories for Mavic 4
      // Pro"): the categoryLabel resolves to "accessories" which maps
      // to 14 categories internally, but the URL only carries one
      // category — that narrows the PLP to a single bucket (Lens
      // filters, etc.). Drop the category so the PLP shows ALL
      // accessory categories matching the named model.
      const isGenericAccessoriesForModel =
        intent.kind === "direct" &&
        intent.categoryLabel === "accessories" &&
        Boolean(intent.compatibleWith) &&
        !(intent.subtypeHints && intent.subtypeHints.length > 0);
      const category = isGenericAccessoriesForModel
        ? undefined
        : intent.categories?.[0];
      const isNarrowed =
        Boolean(intent.compatibleWith) ||
        Boolean(intent.requiredTags && intent.requiredTags.length > 0) ||
        Boolean(intent.tier) ||
        typeof intent.priceMax === "number" ||
        typeof intent.priceMin === "number" ||
        Boolean(intent.subtypeHints && intent.subtypeHints.length > 0);
      const previewRow = isNarrowed
        ? orderProductsLikeCatalog(matches, products)
        : category
          ? getProductsForProductListingPage(products, category)
          : orderProductsLikeCatalog(matches, products);
      const cardSlice = previewRow.slice(0, 6);

      const intro = buildPlpIntro(query, intent, previewRow.length);
      appendMessage({
        id: nextId("result"),
        kind: "agent_result_card",
        bodyText: buildResultBody(intro, previewRow.length),
        title: buildResultTitle(query, intent),
        products: cardSlice.map(toCompactProduct),
        productSlugs: cardSlice.map((p) => p.slug),
        totalResultCount: previewRow.length,
        category,
        useCases: intent.requiredTags,
        compatibleWith: intent.compatibleWith,
        tier: intent.tier,
        priceMax: intent.priceMax,
        priceMin: intent.priceMin,
        subtypes: intent.subtypeHints,
      });

      const plpItems = buildStageNbas({
        stage: "plp",
        intent,
        matchCount: matches.length,
        bundleProducts: findBundlesForIntent(intent, products),
      });
      appendMessage({
        id: nextId("nbas"),
        kind: "agent_nbas",
        pills: buildPillsFromLabels(plpItems.map((item) => item.label)),
      });
    },
    [appendMessage, products],
  );

  /* ---------- agent action mapping ---------- */

  const applyAgentActions = useCallback(
    (actions: AgentAction[], originalQuery: string) => {
      let lastListing:
        | {
            intro: string;
            productSlugs: string[];
            category?: string;
            /** PLP row size (same semantics as rule-based `matches.length`). */
            matchCount: number;
          }
        | undefined;
      let broadEmitted = false;

      for (const action of actions) {
        switch (action.type) {
          case "say":
            appendMessage({
              id: nextId("agent"),
              kind: "agent_text",
              body: action.text,
            });
            break;
          case "show_product_listing": {
            const valid = action.productSlugs
              .map((slug) => getProductBySlug(slug))
              .filter((p): p is CatalogProduct => Boolean(p));
            if (valid.length === 0) break;
            // Prefer the explicit category passed by the model (it
            // tracks the search_catalog filter); fall back to the
            // first product's category. This matters when the model
            // searched within "Camera microphones" but the first
            // valid slug happens to be in "Drone accessories".
            //
            // Special case: a GENERIC accessories query ("accessories
            // for Mavic 4 Pro") asks for everything across multiple
            // accessory categories (filters + batteries + cases +
            // propellers). The model may still pass a single category
            // like "Lens filters" — that narrows the PLP to ONE
            // bucket. Detect the generic case and drop the category
            // so the PLP shows all accessories for the named model.
            const isGenericAccessoryQuery =
              /\b(accessor(y|ies)|add[- ]ons?)\b/i.test(originalQuery) &&
              !/\b(helmet|handlebar|suction|chest\s*strap|wrist\s*strap|neck\s*mount|magnetic\s*ball|nd\s*filter|cpl|polariz|uv\s*filter|wide[- ]?angle\s*lens|lavalier|wireless\s*mic|tripod|propeller|charging\s*hub|spare\s*batter|carrying\s*case|hard\s*case|protective\s*case|backpack)\b/i.test(
                originalQuery,
              );
            const broadenForGenericAccessories =
              isGenericAccessoryQuery && Boolean(action.compatibleWith);
            const category = broadenForGenericAccessories
              ? undefined
              : action.category?.trim() || valid[0].category;
            // When the model narrowed the listing by useCases,
            // compatibleWith, OR tier, materialise the carousel from
            // the SAME-narrowed pool so the card matches the PLP.
            // Without this, "Filmmaker drone" / "Pro drones" would
            // surface beginner-tier Mini and Neo SKUs.
            const useCases = action.useCases ?? [];
            const compatibleWith = action.compatibleWith;
            const tier = action.tier;
            const priceMax = action.priceMax;
            const priceMin = action.priceMin;
            const llmSubtypes = action.subtypes ?? [];
            const isNarrowed =
              useCases.length > 0 ||
              Boolean(compatibleWith) ||
              Boolean(tier) ||
              typeof priceMax === "number" ||
              typeof priceMin === "number" ||
              llmSubtypes.length > 0;
            let previewRow: CatalogProduct[];
            if (isNarrowed) {
              const target = compatibleWith?.toLowerCase();
              previewRow = getProductsForProductListingPage(products, category)
                .filter((p) => {
                  // Drop bundles when ANY narrowing filter is set so
                  // the carousel matches the rule-based path's bundle
                  // semantics — "Pro drones" shouldn't show Fly More
                  // Combo bundles even though some have pro tier.
                  if (p.isBundle) return false;
                  // Generic-accessories-for-model query: keep only
                  // SKUs flagged as accessories. Without this, a
                  // title-based compat match would surface the device
                  // itself (the Mavic 4 Pro drone) alongside the
                  // accessories the shopper actually wants.
                  if (broadenForGenericAccessories && !p.isAccessory) {
                    return false;
                  }
                  if (
                    useCases.length > 0 &&
                    !useCases.every((tag) => p.useCaseTags.includes(tag))
                  ) {
                    return false;
                  }
                  if (target) {
                    if (
                      !p.compatibleWithModels.some((m) =>
                        m.toLowerCase().includes(target),
                      ) &&
                      !p.title.toLowerCase().includes(target)
                    ) {
                      return false;
                    }
                  }
                  if (tier && p.tier !== tier) return false;
                  if (
                    typeof priceMax === "number" &&
                    (p.price == null || p.price > priceMax)
                  ) {
                    return false;
                  }
                  if (
                    typeof priceMin === "number" &&
                    (p.price == null || p.price < priceMin)
                  ) {
                    return false;
                  }
                  if (
                    llmSubtypes.length > 0 &&
                    !p.subtypes.some((s) => llmSubtypes.includes(s))
                  ) {
                    return false;
                  }
                  return true;
                });
              // When the narrowing produces zero matches we DO NOT
              // silently fall back to the model's slug list (which
              // would contradict the constraint by showing items that
              // violate it — e.g. "$709 Action 5 Pro" inside a
              // "Action cam under $300" card). Instead, render a
              // reasoning text + NBA alternatives so the shopper
              // knows the budget/tier/etc didn't match anything and
              // can pick a viable next step.
              if (previewRow.length === 0) {
                const inCategory = getProductsForProductListingPage(
                  products,
                  category,
                ).filter((p) => !p.isBundle && p.price != null);
                const sortedByPrice = [...inCategory].sort(
                  (a, b) => (a.price ?? 0) - (b.price ?? 0),
                );
                const cheapest = sortedByPrice[0];
                const mostExpensive = sortedByPrice[sortedByPrice.length - 1];

                const categoryLc = category
                  ? category.toLowerCase()
                  : "products";
                const constraints: string[] = [];
                if (tier) constraints.push(tier);
                if (useCases.length > 0) constraints.push(...useCases);
                if (target) constraints.push(`for ${target}`);
                const constraintPrefix =
                  constraints.length > 0 ? `${constraints.join(" / ")} ` : "";

                let body: string;
                if (typeof priceMax === "number") {
                  body =
                    `I couldn't find any ${constraintPrefix}${categoryLc} ` +
                    `priced under ${formatPrice(priceMax)}.`;
                  if (cheapest && cheapest.price != null) {
                    body +=
                      ` Our most affordable in this category is the ` +
                      `${cheapest.title} at ${cheapest.priceFormatted}.`;
                  }
                  body += ` Want me to widen the budget?`;
                } else if (typeof priceMin === "number") {
                  body =
                    `I couldn't find any ${constraintPrefix}${categoryLc} ` +
                    `priced above ${formatPrice(priceMin)}.`;
                  if (mostExpensive && mostExpensive.price != null) {
                    body +=
                      ` The flagship pick is the ${mostExpensive.title} at ` +
                      `${mostExpensive.priceFormatted}.`;
                  }
                } else {
                  body =
                    `I couldn't find any ${constraintPrefix}${categoryLc} ` +
                    `that match what you described.`;
                }

                appendMessage({
                  id: nextId("agent"),
                  kind: "agent_text",
                  body,
                });

                // Alternative NBAs — widen the budget, drop the tier,
                // browse the full category.
                const altLabels: string[] = [];
                if (
                  typeof priceMax === "number" &&
                  cheapest &&
                  cheapest.price != null
                ) {
                  // Round up to the next $50 above the cheapest SKU
                  // so the suggestion is achievable.
                  const widened = Math.ceil(cheapest.price / 50) * 50 + 50;
                  altLabels.push(`Show ${categoryLc} under ${formatPrice(widened)}`);
                }
                if (tier) {
                  altLabels.push(`Show all ${categoryLc}`);
                } else {
                  altLabels.push(`Browse ${categoryLc}`);
                }
                if (target) {
                  altLabels.push(`Show all accessories for ${target}`);
                }
                if (altLabels.length > 0) {
                  appendMessage({
                    id: nextId("nbas"),
                    kind: "agent_nbas",
                    pills: buildPillsFromLabels(altLabels),
                  });
                }
                break;
              }
            } else {
              previewRow = getProductsForProductListingPage(products, category);
            }
            const cardSlice = previewRow.slice(0, 6);
            lastListing = {
              intro: action.intro,
              productSlugs: cardSlice.map((p) => p.slug),
              category,
              matchCount: previewRow.length,
            };
            appendMessage({
              id: nextId("result"),
              kind: "agent_result_card",
              bodyText: buildResultBody(action.intro, previewRow.length),
              title: buildResultTitle(originalQuery),
              products: cardSlice.map(toCompactProduct),
              productSlugs: cardSlice.map((p) => p.slug),
              totalResultCount: previewRow.length,
              category,
              ...(useCases.length > 0 ? { useCases } : {}),
              ...(compatibleWith ? { compatibleWith } : {}),
              ...(tier ? { tier } : {}),
              ...(typeof priceMax === "number" ? { priceMax } : {}),
              ...(typeof priceMin === "number" ? { priceMin } : {}),
              ...(llmSubtypes.length > 0 ? { subtypes: llmSubtypes } : {}),
            });
            break;
          }
          case "show_broad_listing": {
            const builtRows: BroadResultRow[] = [];
            broadEmitted = true;
            for (const rawRow of action.rows) {
              const validProducts = rawRow.productSlugs
                .map((slug) => getProductBySlug(slug))
                .filter((p): p is CatalogProduct => Boolean(p));
              if (validProducts.length === 0) continue;
              const lead = validProducts[0];
              const rowCategory = rawRow.category || lead.category;
              // When the agent supplied capability / role filters, derive
              // the row count from a real spec resolution so it matches
              // what the PLP will show after the click. Falls back to the
              // category preview row otherwise (existing behaviour).
              const hasCapabilityFilter =
                (rawRow.capabilities && rawRow.capabilities.length > 0) ||
                Boolean(rawRow.accessoryRole);
              let totalResultCount: number;
              if (hasCapabilityFilter && rowCategory) {
                // Synthesise a transient spec from the agent's row so
                // the count + filter logic matches what the PLP will
                // do for the same URL. This spec doesn't get
                // registered for `getRecipeSpecById` lookup — it lives
                // only for this builder pass.
                const spec: BroadSubTopicSpec = {
                  id: `openai-${rawRow.title}`,
                  title: rawRow.title,
                  categoryToken: rowCategory,
                  capabilities: rawRow.capabilities,
                  accessoryRole: rawRow.accessoryRole as
                    | BroadSubTopicSpec["accessoryRole"]
                    | undefined,
                };
                const filteredPool = buildRowProductsFromSpec(spec, products);
                totalResultCount = Math.max(
                  filteredPool.length,
                  validProducts.length,
                );
              } else {
                const previewRow = rowCategory
                  ? getProductsForProductListingPage(products, rowCategory)
                  : validProducts;
                totalResultCount = Math.max(
                  previewRow.length,
                  validProducts.length,
                );
              }
              builtRows.push({
                id: nextId("broad-row"),
                title: rawRow.title,
                thumb: toCompactProduct(lead),
                productSlugs: validProducts.map((p) => p.slug),
                totalResultCount,
                category: rowCategory,
                capabilities:
                  rawRow.capabilities && rawRow.capabilities.length > 0
                    ? rawRow.capabilities
                    : undefined,
                accessoryRole: rawRow.accessoryRole,
              });
              if (builtRows.length >= 5) break;
            }
            if (builtRows.length < 2) break;
            appendMessage({
              id: nextId("broad-result"),
              kind: "agent_broad_result_card",
              bodyText: action.intro?.trim()
                ? action.intro.trim()
                : "I've curated a few directions for you. Pick one to explore, or tell me a bit more about what you're after.",
              rows: builtRows,
            });
            break;
          }
          case "propose_broad_recipe": {
            // The model emitted filter SPECS (no slugs) — we resolve
            // each one via the same `buildRowProductsFromSpec` the
            // rule-based recipes use, register the spec in the runtime
            // registry so the PLP can re-resolve it when the row is
            // clicked, and render the standard broad result card.
            const builtRows: BroadResultRow[] = [];
            broadEmitted = true;
            for (const rawSpec of action.specs) {
              // The agent's executor already validated the vocab; here
              // we just adopt the spec object verbatim — same shape as
              // BroadSubTopicSpec. accessoryRole tightens to the
              // recipe spec union via a defensive cast (vocab match
              // already enforced upstream).
              const spec: BroadSubTopicSpec = {
                ...rawSpec,
                accessoryRole: rawSpec.accessoryRole as
                  | BroadSubTopicSpec["accessoryRole"]
                  | undefined,
              };
              const pool = buildRowProductsFromSpec(spec, products);
              if (pool.length === 0) continue;
              registerRuntimeSpec(spec);
              builtRows.push({
                id: nextId("broad-row"),
                title: spec.title,
                thumb: toCompactProduct(pool[0]),
                productSlugs: pool.map((p) => p.slug),
                totalResultCount: pool.length,
                recipeKey: spec.id,
              });
              if (builtRows.length >= 5) break;
            }
            if (builtRows.length < 2) {
              // The LLM proposed a recipe but its rows resolved to <2
              // products against the catalog. This used to dead-end
              // the shopper with a generic apology message; instead
              // fall through to the rule-based renderer which will
              // try the deterministic activity / use-case recipes
              // (watersports, motorcycle, etc.) before giving up.
              // Suppresses the false "I couldn't find" message when
              // the LLM happens to pick filters that don't exist in
              // the catalog while a perfectly good rule-based recipe
              // exists for the same query.
              renderRuleBased(originalQuery);
              break;
            }
            appendMessage({
              id: nextId("broad-result"),
              kind: "agent_broad_result_card",
              bodyText: action.intro?.trim()
                ? action.intro.trim()
                : "Here's a curated set for you. Pick a row to dive in, or tell me a bit more about what you're after.",
              rows: builtRows,
            });
            break;
          }
          case "show_product_detail": {
            const product = getProductBySlug(action.productSlug);
            if (!product) break;
            // Render PDP as a single-product compact card for visual consistency.
            appendMessage({
              id: nextId("result"),
              kind: "agent_result_card",
              bodyText: `Here's the ${product.title} — ${product.shortDescription}`,
              title: product.title,
              products: [toCompactProduct(product)],
              productSlugs: [product.slug],
              category: product.category,
            });
            break;
          }
          case "add_to_cart": {
            const product = getProductBySlug(action.productSlug);
            if (!product) break;
            appendMessage({
              id: nextId("agent"),
              kind: "agent_text",
              body: `Added ${product.title} to your cart.`,
            });
            break;
          }
          case "suggest_nbas":
            appendMessage({
              id: nextId("nbas"),
              kind: "agent_nbas",
              pills: buildPillsFromLabels(action.labels),
            });
            break;
          // apply_promo / checkout are ignored in Phase 1 of the side-by-side surface.
        }
      }

      // Defensive default: if the agent didn't send NBAs but did show a
      // listing (specific OR broad), synthesise stage-aware pills from
      // the rule-based engine. Broad cards fall back to probing pills so
      // the shopper still gets refining suggestions.
      // Do not use messagesRef here — the welcome row's agent_nbas is still in
      // the ref until after commit, which incorrectly skipped synthesis.
      const agentEmittedNbas = actions.some((a) => a.type === "suggest_nbas");
      if (!agentEmittedNbas && lastListing) {
        const intent = classifyIntent(originalQuery);
        const items = buildStageNbas({
          stage: "plp",
          intent,
          matchCount: lastListing.matchCount,
          bundleProducts: findBundlesForIntent(intent, products),
        });
        if (items.length > 0) {
          appendMessage({
            id: nextId("nbas"),
            kind: "agent_nbas",
            pills: buildPillsFromLabels(items.map((item) => item.label)),
          });
        }
      } else if (!agentEmittedNbas && broadEmitted) {
        const intent = classifyIntent(originalQuery);
        const items = buildStageNbas({ stage: "probing", intent });
        if (items.length > 0) {
          appendMessage({
            id: nextId("nbas"),
            kind: "agent_nbas",
            pills: buildPillsFromLabels(items.map((item) => item.label)),
          });
        }
      }
    },
    [appendMessage, getProductBySlug, products, renderRuleBased],
  );

  /* ---------- public dispatch ---------- */

  const dispatchShopperMessage = useCallback(
    (
      text: string,
      ctx?: { productSlug?: string; pillKind?: PdpNbaPillKind },
    ) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      lastQueryRef.current = trimmed;

      appendMessage({ id: nextId("shopper"), kind: "shopper", text: trimmed });

      // ---------- PDP-origin fast paths (NBA pill clicks) ----------
      // These three pill kinds have deterministic answers tied to the
      // PDP. They render the AgentPdpUtterance variant matching their
      // Figma node and skip both the loader and the rule-based /
      // OpenAI flow. Falls through to the standard flow when
      // productSlug is missing (defensive — PDP pills always supply it).
      const pillKind = ctx?.pillKind;
      const productSlug = ctx?.productSlug;

      if (pillKind === "open" && productSlug) {
        const product = getProductBySlug(productSlug);
        const productName = product?.title ?? "this product";
        appendMessage({
          id: nextId("pdp-utterance"),
          kind: "agent_pdp_utterance",
          productSlug,
          body: `Shoot your question about the ${productName} and I'll do my best to find an answer.`,
        });
        return;
      }

      if (pillKind === "hygiene" && productSlug) {
        const topic = classifyHygieneTopic(trimmed) ?? "return";
        appendMessage({
          id: nextId("pdp-utterance"),
          kind: "agent_pdp_utterance",
          productSlug,
          body: POLICY_BODIES[topic],
          cta: {
            label: HYGIENE_CTA_LABEL[topic],
            href: DJI_HELP_CENTER_URL,
          },
        });
        return;
      }

      // ---------- agentic / rule-based path ----------
      const loaderId = nextId("loader");
      appendMessage({ id: loaderId, kind: "agent_loading", variant: "thinking" });
      setIsResponding(true);

      const finalize = () => {
        removeMessage(loaderId);
        setIsResponding(false);
      };

      // PDP-origin FAQ: surface the agent's free-text reply (a turn
      // made of `say` actions only) inside the AgentPdpUtterance
      // variant. Without this the SxS code below would silently drop
      // the say text and fall through to renderRuleBased, which would
      // answer "Is this beginner-friendly?" with a curated category
      // suggestion card.
      const surfacePdpFaqFallback = () => {
        if (!productSlug) {
          renderRuleBased(trimmed);
          return;
        }
        const product = getProductBySlug(productSlug);
        const body = product
          ? resolveProductFaq(product, trimmed)
          : `Here's what I know — full details are on this page.`;
        appendMessage({
          id: nextId("pdp-utterance"),
          kind: "agent_pdp_utterance",
          productSlug,
          body,
        });
      };

      const agent = agentRef.current;
      if (agent) {
        // PDP-aware grounding: when the turn carries a product context
        // (a PDP FAQ pill click, OR a free-typed input dispatched while
        // the shopper is on a PDP — see `dispatchOnPage` in
        // SideBySideAssistant.tsx), prepend a structured preamble that
        // names the product AND inlines the catalog's authoritative
        // facts (in-the-box list, top specs, highlights). Without the
        // facts block the LLM happily invents box contents and spec
        // values for any SKU it hasn't memorised — the bug surfaced
        // most loudly on the Osmo Action 5 Pro Standard Combo where
        // the model fabricated a generic "camera + accessories"
        // unboxing list while the catalog had the real 9-item
        // inventory scraped from the PDP.
        // The shopper bubble in the chat keeps showing the raw `trimmed`
        // text — only the prompt sent to OpenAI is enriched.
        let groundedText = trimmed;
        if (pillKind === "faq" && productSlug) {
          const product = getProductBySlug(productSlug);
          if (product) {
            groundedText = buildPdpFaqGroundedPrompt(product, trimmed);
          }
        }
        agent
          .respond(groundedText)
          .then((actions) => {
            finalize();
            // PDP-origin FAQ turns must always render as an
            // AgentPdpUtterance and never trigger PLP navigation. We
            // decide this BEFORE the structured-action branch so that
            // even when the LLM returns tool calls (commonly
            // `show_product_detail` for the same SKU the shopper is
            // already viewing), we drop the structured actions and
            // surface the say text — falling back to the catalog-derived
            // FAQ answer when the model emitted no usable text.
            // Without this guard, the structured action would emit an
            // `agent_result_card`, which the auto-sync useEffect in
            // SideBySideAssistant.tsx would treat as a signal to
            // navigate the main panel to the PLP, yanking the shopper
            // off the PDP they were reading.
            if (pillKind === "faq" && productSlug) {
              const sayText = actions
                .filter((a): a is { type: "say"; text: string; title?: string } =>
                  a.type === "say",
                )
                .map((a) => a.text.trim())
                .filter(Boolean)
                .join("\n\n");
              if (sayText) {
                appendMessage({
                  id: nextId("pdp-utterance"),
                  kind: "agent_pdp_utterance",
                  productSlug,
                  body: sayText,
                });
                return;
              }
              surfacePdpFaqFallback();
              return;
            }

            const structured = actions.filter((a) => a.type !== "say");
            if (structured.length > 0) {
              applyAgentActions(structured, trimmed);
              return;
            }
            renderRuleBased(trimmed);
          })
          .catch((error) => {
            console.error("[SideBySideAssistant] OpenAI agent failed", error);
            finalize();
            if (pillKind === "faq" && productSlug) {
              surfacePdpFaqFallback();
              return;
            }
            renderRuleBased(trimmed);
          });
        return;
      }

      scheduleResponse(() => {
        finalize();
        if (pillKind === "faq" && productSlug) {
          surfacePdpFaqFallback();
          return;
        }
        renderRuleBased(trimmed);
      });
    },
    [
      appendMessage,
      applyAgentActions,
      getProductBySlug,
      removeMessage,
      renderRuleBased,
      scheduleResponse,
    ],
  );

  /* ---------- welcome seed (new session / refresh) ---------- */

  useEffect(() => {
    if (seededRef.current) return;
    if (products.length === 0) return;
    seededRef.current = true;
    lastQueryRef.current = "";
    setMessages(buildWelcomeMessages());
  }, [products]);

  /* ---------- chat session controls ---------- */

  /**
   * Reset the conversation back to the welcome state: drop every message,
   * cancel any in-flight thinking timers, and re-seed the greeting + probing
   * pills so the surface looks like a fresh session.
   */
  const clearChat = useCallback(() => {
    pendingTimeouts.current.forEach((id) => window.clearTimeout(id));
    pendingTimeouts.current = [];
    lastQueryRef.current = "";
    setIsResponding(false);

    if (products.length === 0) {
      // Catalog hasn't loaded yet — clear the surface and let the seed
      // effect re-run when products become available.
      seededRef.current = false;
      setMessages([]);
      return;
    }

    seededRef.current = true;
    setMessages(buildWelcomeMessages());
  }, [products]);

  /**
   * Snapshot the current conversation to disk as JSON so the shopper (or a
   * researcher reviewing the prototype) can persist the session locally.
   */
  const saveChat = useCallback(() => {
    if (typeof window === "undefined") return;
    const payload = {
      savedAt: new Date().toISOString(),
      messages,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `assistant-chat-${new Date()
      .toISOString()
      .replace(/[:.]/g, "-")}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }, [messages]);

  /* ---------- cleanup ---------- */

  useEffect(() => {
    return () => {
      pendingTimeouts.current.forEach((id) => window.clearTimeout(id));
      pendingTimeouts.current = [];
    };
  }, []);

  return useMemo(
    () => ({
      messages,
      isResponding,
      dispatchShopperMessage,
      clearChat,
      saveChat,
    }),
    [messages, isResponding, dispatchShopperMessage, clearChat, saveChat],
  );
}
