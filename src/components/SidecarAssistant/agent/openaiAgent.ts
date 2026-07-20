import { getOpenAIClient, getOpenAIModel } from "../../../lib/openaiClient";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";
import type { AccessoryRole, CatalogProduct } from "../../../catalog/catalog";
import { PRIMARY_ACTIVITY_VALUES } from "../../../catalog/catalog";
import {
  HELP_CENTER_URL,
  POLICY_BODIES,
  classifyHygieneTopic,
  findAccessoriesFor,
  type HygieneTopic,
} from "../conversation/flow";

/**
 * Retained accessory-role vocab. Skincare products don't carry an
 * accessory role (the `accessoryRole` field is neutralized to null),
 * so this is effectively inert, kept only so the shared
 * `AccessoryRole` type and the tool schemas that reference it still
 * compile. Do NOT filter skincare recommendations on these values.
 */
const ACCESSORY_ROLE_VALUES: AccessoryRole[] = [
  "power",
  "mounting",
  "stabilization",
  "visual_enhancement",
  "storage",
  "general",
];

/**
 * Skin-type tokens carried on `product.subtypes` for skincare.
 * Used to validate the LLM's skin-type filters (dry / oily /
 * combination / normal / all).
 */
const SKIN_TYPE_VALUES: ReadonlySet<string> = new Set([
  "dry",
  "oily",
  "combination",
  "normal",
  "all",
]);

/**
 * Skincare filter tokens the LLM may pass as `useCases` / `capabilities`.
 * These live on `product.useCaseTags` / `product.capabilities` (fused
 * skin-type + concern + collection + category tokens, plus `spf` on
 * every sunscreen and `best-seller` on hero SKUs).
 */
const SKINCARE_TAG_VALUES: ReadonlySet<string> = new Set([
  "dry",
  "oily",
  "combination",
  "normal",
  "spf",
  "best-seller",
]);

/**
 * Collection vocab, kept in lockstep with `SERIES_VALUES` in
 * `catalog.ts` (the `series` field carries the product Collection slug).
 * Used to validate the LLM's `series` filter values across
 * `search_catalog`, `propose_broad_recipe`, and `find_accessories`.
 */
const SERIES_ENUM = [
  "benefiance",
  "vital-perfection",
  "future-solution-lx",
  "bio-performance",
  "essentials",
  "essential-energy",
  "ultimune",
  "eudermine",
  "urban-environment",
  "ultimate-sun",
  "shiseido-men",
] as const;
type ProductSeriesValue = (typeof SERIES_ENUM)[number];
const SERIES_VALUES_LOCAL: ReadonlySet<string> = new Set(SERIES_ENUM);

/**
 * Spec shape shared with the side-by-side assistant's
 * `BroadSubTopicSpec`, declared locally so this module stays
 * self-contained (the agent is shared infrastructure; the recipe
 * engine lives downstream of it). Field semantics match
 * `buildRowProductsFromSpec` exactly.
 */
export type ProposeBroadRecipeSpec = {
  id: string;
  title: string;
  categoryToken: string;
  capabilities?: string[];
  subtypes?: string[];
  primaryActivities?: string[];
  accessoryRole?: AccessoryRole;
  titleMatchAny?: string[];
  titleExcludeAny?: string[];
  leadCount?: number;
  allowBundles?: boolean;
  /**
   * v6.1: OR-filter on `product.series` (the Collection slug). Any
   * single match surfaces the product. Lets the LLM compose
   * collection-flavoured rows like "Ultimune essentials"
   * (`series: ["ultimune"]`) or a "Men's routine"
   * (`series: ["shiseido-men"]`) without leaning on title regex.
   */
  series?: string[];
  /**
   * v6.1: lowercased title token. Filters rows to products whose
   * title contains this substring. Use for SPECIFIC-PRODUCT rows
   * ("Products in the Vital Perfection LiftDefine line"); use
   * `series` for COLLECTION-level scoping.
   */
  compatibleWith?: string;
};

/* =============================================================
 * OpenAI-powered agent for the SidecarAssistant.
 *
 * The host (SidecarAssistant.tsx) calls `agent.respond(text)` and
 * receives a list of UI-facing AgentActions, which it then maps onto
 * the existing card-rendering helpers (PLP, PDP, cart, order, NBAs).
 *
 * Tools are evaluated locally: read-only tools (search_catalog,
 * lookup_policy) return data back to the model, while render/mutate
 * tools (show_product_listing, add_to_cart, …) push entries into an
 * `actions` queue and return a tiny success ack so the model can
 * decide whether to speak afterwards.
 * ============================================================= */

export type AgentAction =
  | { type: "say"; text: string; title?: string }
  | {
      type: "show_product_listing";
      intro: string;
      productSlugs: string[];
      showMoreCard?: boolean;
      /**
       * Canonical use-case tags (`dry`, `oily`, `spf`, `best-seller`,
       * etc.) the carousel was scoped to. Threaded through the See
       * Results handoff so the PLP shows the same narrowed subset.
       * Optional; omit for unfiltered listings.
       */
      useCases?: string[];
      /**
       * Lowercased title token (`vital perfection`, `ultimune`) the
       * carousel was scoped to. Threaded so the PLP applies the same
       * title filter.
       */
      compatibleWith?: string;
      /** Optional category name for the See Results handoff. */
      category?: string;
      /**
       * Buyer tier (`beginner` / `intermediate` / `pro`) the carousel
       * was scoped to. Threaded so a "Prestige serums" card narrows
       * the PLP to premium SKUs and doesn't leak everyday-tier
       * products.
       */
      tier?: "beginner" | "intermediate" | "pro";
      /**
       * Price ceiling in USD (e.g. 60 for "under $60"). Threaded so
       * "Sunscreen under $60" narrows both card and PLP to ≤ $60 SKUs.
       */
      priceMax?: number;
      /**
       * Price floor in USD. Set automatically for pro-tier queries
       * to filter out entry-level SKUs that match the category.
       */
      priceMin?: number;
      /**
       * Skin-type narrowing: `["dry"]` for a dry-skin carousel,
       * `["oily"]` for oily/combination-skin picks.
       */
      subtypes?: string[];
    }
  | {
      type: "show_broad_listing";
      intro: string;
      rows: Array<{
        title: string;
        productSlugs: string[];
        category?: string;
        /** Use-case tags AND-applied to the PLP when this row is clicked. */
        capabilities?: string[];
        /** Accessory role filter for accessory-only rows. */
        accessoryRole?: string;
      }>;
    }
  | {
      type: "propose_broad_recipe";
      intro: string;
      /**
       * Already-validated specs (vocab filtered to the v6 allow-lists,
       * ids minted, defaults applied). Consumer pipes each spec into
       * `buildRowProductsFromSpec` to materialise the actual rows.
       */
      specs: ProposeBroadRecipeSpec[];
    }
  | { type: "show_product_detail"; productSlug: string }
  | { type: "add_to_cart"; productSlug: string; quantity: number }
  | { type: "apply_promo"; code: string }
  | { type: "checkout" }
  | { type: "suggest_nbas"; labels: string[] };

export type OpenAIAgentDeps = {
  /** Optional override for the chat model. Defaults to whatever
   *  `getOpenAIModel()` resolves (env-driven, falling back to
   *  gpt-4o-mini). The previously-required `apiKey` field has
   *  been removed; keys are now injected by the proxy worker
   *  in production, or by `lib/openaiClient` in dev. */
  model?: string;
  products: CatalogProduct[];
  getProductBySlug: (slug: string) => CatalogProduct | undefined;
};

export type OpenAIAgent = {
  respond: (userText: string) => Promise<AgentAction[]>;
  reset: () => void;
};

const TOOL_LOOP_LIMIT = 5;
// A single broad-recipe turn (user + 2-3 search_catalog grounding
// calls + propose_broad_recipe + final assistant) emits 8-10 messages.
// Keep the limit high enough to retain ~3 turns of context, otherwise
// the trim will routinely slice mid-tool-sequence and OpenAI rejects
// with "messages with role 'tool' must be a response to a preceeding
// message with 'tool_calls'".
const HISTORY_LIMIT = 32;

// Policy answers are sourced from Shiseido customer care (see
// `flow.ts` → POLICY_BODIES). Both the rule-based and OpenAI paths
// read from the same module so the prototype can't drift on hygiene
// answers. The legacy `returns` key here is preserved for the existing
// `lookup_policy` tool schema; everything else is mapped through the
// shared knowledge base.
const LEGACY_TOPIC_TO_HYGIENE: Record<string, HygieneTopic> = {
  returns: "return",
  return: "return",
  refund: "return",
  replacement: "replacement",
  warranty: "warranty",
  shipping: "shipping",
};

function lookupPolicyText(rawTopic: string): string | null {
  const direct = LEGACY_TOPIC_TO_HYGIENE[rawTopic.toLowerCase()];
  const topic = direct ?? classifyHygieneTopic(rawTopic);
  if (!topic) return null;
  return POLICY_BODIES[topic];
}

const PROMO_HINTS = "Available demo promos: GLOW10 (10% off), GLOW20 (20% off).";

/* ---------- tool schema ---------- */

const TOOLS: ChatCompletionTool[] = [
    {
    type: "function",
    function: {
      name: "search_catalog",
      description:
        "Search the Shiseido skincare catalog. Use the structured filters (`category`, `tier`, `priceMin`/`priceMax`) whenever the shopper signals a formula level or budget; don't rely on free-text alone. Call BEFORE show_product_listing or add_to_cart so slugs and prices are grounded.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Free-text query, e.g. 'brightening serum'. Optional." },
          category: {
            type: "string",
            description: "Optional category filter (e.g. 'Cleansers', 'Softeners', 'Serums & Treatments', 'Moisturizers', 'Eye & Lip Care', 'Masks', 'Sunscreen', 'Sets & Bundles').",
          },
          tier: {
            type: "string",
            enum: ["beginner", "intermediate", "pro"],
            description:
              "Buyer tier. Pick `pro` for prestige/luxury/premium/advanced requests, `beginner` for everyday/affordable/starter, `intermediate` otherwise.",
          },
          priceMin: { type: "number", description: "Optional price floor in USD. Use this for 'prestige'/'luxury'/'advanced' requests to filter out entry-level products." },
          priceMax: { type: "number", description: "Optional price ceiling in USD." },
          includeBundles: {
            type: "boolean",
            description:
              "Defaults to false: results EXCLUDE multi-product sets/bundles (Sets & Bundles). Set to true ONLY when the shopper explicitly asks for a set/bundle/kit/routine. Bundles should otherwise be surfaced as upsell NBAs, not in the main PLP.",
          },
          useCases: {
            type: "array",
            items: {
              type: "string",
              enum: [
                "dry",
                "oily",
                "combination",
                "normal",
                "spf",
                "best-seller",
              ],
            },
            description:
              "Required filter tags from the curated catalog vocabulary. Pass `['dry']` for dry/dehydrated skin, `['oily']` for oily/shine-prone skin, `['combination']` or `['normal']` for those skin types, `['spf']` for sun protection / daily sunscreen, `['best-seller']` for most-popular/top-rated picks. Returns ONLY products tagged with every value; use this to keep non-matching SKUs out of the carousel.",
          },
          productType: {
            type: "string",
            description:
              "Unused for skincare (the catalog's product-type column is empty). Prefer `category` to scope to a product family (Cleansers, Serums & Treatments, Moisturizers, Sunscreen, …).",
          },
          accessoryRole: {
            type: "string",
            enum: [
              "power",
              "mounting",
              "stabilization",
              "visual_enhancement",
              "storage",
              "general",
            ],
            description:
              "Legacy accessory-role filter, unused for skincare (products don't carry an accessory role). Prefer `category` or `series` to narrow results.",
          },
          series: {
            type: "string",
            enum: [...SERIES_ENUM],
            description:
              "Optional collection filter (e.g. 'benefiance', 'vital-perfection', 'ultimune', 'shiseido-men'). Use when the shopper names a collection ('show me Ultimune', 'the Vital Perfection line', 'Shiseido Men products'); this is much sharper than free-text because each product carries a structured `series` (Collection) slug.",
          },
          sortBy: {
            type: "string",
            enum: ["relevance", "price_desc", "price_asc", "rating"],
            description:
              "How to rank results. Default is relevance. Use `price_desc` for prestige/luxury asks so flagship products surface first.",
          },
          limit: { type: "number", description: "Max number of results to return. Default 5." },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "show_product_listing",
      description:
        "Render a horizontal product carousel (PLP) inside the chat. Use after search_catalog to surface the recommended slugs. The `intro` becomes the agent's lead-in line above the carousel, so do NOT also repeat it in your free-text reply. CRITICAL: when your search_catalog call narrowed the results by `useCases`, `category`, OR `tier`, ALSO pass those values here so the PLP's See Results handoff lands on the SAME subset shown in the card. Otherwise clicking the card shows the unfiltered category and the shopper sees products that contradict your intro text (e.g. 'Prestige serums' but the PLP includes everyday-tier picks).",
      parameters: {
        type: "object",
        properties: {
          intro: { type: "string", description: "One short lead-in sentence shown above the carousel." },
          productSlugs: {
            type: "array",
            items: { type: "string" },
            description: "Catalog slugs to render, in display order. Max 5.",
          },
          showMoreCard: {
            type: "boolean",
            description: "Append a 'Show more' tile at the end of the carousel.",
          },
          category: {
            type: "string",
            description:
              "Optional category to scope the PLP when the shopper clicks See Results (e.g. 'Serums & Treatments', 'Moisturizers', 'Sunscreen').",
          },
          useCases: {
            type: "array",
            items: {
              type: "string",
              enum: [
                "dry", "oily", "combination", "normal", "spf", "best-seller",
              ],
            },
            description:
              "Pass the SAME `useCases` you used in `search_catalog` so the PLP narrows to the same subset. Critical for queries like 'dry-skin picks', 'oily-skin moisturizers', 'best-selling serums'; without this, the PLP shows the full category and contradicts your curated card.",
          },
          compatibleWith: {
            type: "string",
            description:
              "Lowercased title token (e.g. 'vital perfection', 'ultimune') if the carousel is scoped to a specific product line. The PLP will narrow results to SKUs whose title contains this token.",
          },
          tier: {
            type: "string",
            enum: ["beginner", "intermediate", "pro"],
            description:
              "Pass when `search_catalog` was called with the same `tier`. Critical for tier-flavored queries like 'Prestige serums', 'Luxury cream', 'Everyday cleanser'. Without this, the PLP shows the full category and a 'Prestige serums' card surfaces everyday-tier SKUs.",
          },
          priceMax: {
            type: "number",
            description:
              "Pass when `search_catalog` was called with `priceMax` (e.g. 'under $150', 'cheaper than $60'). Without this, a 'Sunscreen under $60' card shows products above $60 because the budget filter doesn't propagate to the PLP.",
          },
          priceMin: {
            type: "number",
            description:
              "Pass when `search_catalog` was called with `priceMin`. Less common; mostly auto-set for pro-tier queries to filter out entry-level SKUs.",
          },
          subtypes: {
            type: "array",
            items: {
              type: "string",
              enum: [
                "dry", "oily", "combination", "normal", "all",
              ],
            },
            description:
              "Skin-type narrowing: pass for QUERIES THAT NAME A SKIN TYPE (e.g. 'dry skin' → ['dry']; 'oily skin' → ['oily']; 'combination skin' → ['combination']). Without this, a 'for dry skin' card surfaces products for all skin types because the category alone doesn't differentiate within the bucket.",
          },
        },
        required: ["intro", "productSlugs"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "show_broad_listing",
      description:
        "Render a stack of 3-5 sub-topic rows (each = a sub-search the shopper can drill into) for BROAD/exploratory queries that span multiple categories, e.g. 'a routine for dry skin', 'I'm new to skincare, where do I start', 'help me build an anti-aging regimen'. Prefer this over `show_product_listing` whenever the shopper's request can't be answered with a single product carousel. Each row points at a sub-search of catalog slugs grounded by `search_catalog`. The card also shows a 'Show all' link that opens the full storefront.",
      parameters: {
        type: "object",
        properties: {
          intro: {
            type: "string",
            description:
              "One short lead-in sentence shown above the rows (e.g. 'Here are a few directions for a dry-skin routine').",
          },
          rows: {
            type: "array",
            minItems: 2,
            maxItems: 5,
            items: {
              type: "object",
              properties: {
                title: {
                  type: "string",
                  description:
                    "Sub-topic label (e.g. 'Hydrating serums', 'Gentle cleansers for dry skin'). 2-5 words.",
                },
                productSlugs: {
                  type: "array",
                  items: { type: "string" },
                  description:
                    "Catalog slugs that match this sub-topic, in display order. The first slug becomes the row's lead thumbnail. Must come from `search_catalog`.",
                },
                category: {
                  type: "string",
                  description:
                    "Optional catalog category (e.g. 'Cleansers', 'Serums & Treatments', 'Moisturizers', 'Sunscreen', 'Sets & Bundles') used to scope the PLP when the shopper clicks the row.",
                },
                capabilities: {
                  type: "array",
                  items: {
                    type: "string",
                    enum: [
                      "dry",
                      "oily",
                      "combination",
                      "normal",
                      "spf",
                      "best-seller",
                    ],
                  },
                  description:
                    "Optional filter tags applied AS A FILTER on the PLP when the shopper clicks the row. Pass these whenever the row's TITLE narrows the category (e.g. row='Sunscreen', category='Sunscreen' → capabilities:['spf']; row='Moisturizers for dry skin', category='Moisturizers' → capabilities:['dry']). Do NOT pass for unfiltered category rows.",
                },
                accessoryRole: {
                  type: "string",
                  enum: [
                    "power",
                    "mounting",
                    "stabilization",
                    "visual_enhancement",
                    "storage",
                    "general",
                  ],
                  description:
                    "Legacy accessory-role filter, unused for skincare (products don't carry an accessory role). Leave unset.",
                },
              },
              required: ["title", "productSlugs"],
              additionalProperties: false,
            },
          },
        },
        required: ["intro", "rows"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_broad_recipe",
      description:
        "PREFERRED tool for broad/exploratory skincare queries (replaces show_broad_listing in almost every case). Each row is a SPEC describing a category + skin-type + concern + collection filter, and the platform's deterministic engine resolves the actual SKUs from the catalog. You never name slugs here, eliminating slug hallucinations. ALWAYS call `search_catalog` 1-2 times first to verify the category names and product families you're reasoning about exist; otherwise your filters may produce empty rows.",
      parameters: {
        type: "object",
        properties: {
          intro: {
            type: "string",
            description:
              "One short body-text sentence shown above the rows (e.g. 'I have curated a routine that covers each step for dry skin.').",
          },
          rows: {
            type: "array",
            minItems: 2,
            maxItems: 6,
            items: {
              type: "object",
              properties: {
                title: {
                  type: "string",
                  description:
                    "2-5 word row label (e.g. 'Gentle cleansers', 'Hydrating serums', 'Daily sunscreen').",
                },
                categoryToken: {
                  type: "string",
                  description:
                    "Substring matched (case-insensitive) against `product.category`. Use the skincare category vocab. Examples: 'cleanser', 'softener', 'serum', 'treatment', 'moisturizer', 'eye', 'mask', 'sunscreen', 'set'.",
                },
                capabilities: {
                  type: "array",
                  items: {
                    type: "string",
                    enum: [
                      "dry", "oily", "combination", "normal",
                      "spf", "best-seller",
                    ],
                  },
                  description:
                    "AND-filter on `capabilities` (fused skin-type / concern / collection tokens). Every requested token must be present on the product. Use sparingly, because `primaryActivities` (concerns) and `series` (collections) usually narrow better.",
                },
                subtypes: {
                  type: "array",
                  items: {
                    type: "string",
                    enum: [
                      "dry", "oily", "combination", "normal", "all",
                    ],
                  },
                  description:
                    "AND-filter on `subtypes` (skin type). `[dry]` selects products formulated for dry skin; `[oily]` selects oily/combination picks; `[all]` selects all-skin-type products.",
                },
                accessoryRole: {
                  type: "string",
                  enum: [
                    "power", "mounting", "stabilization",
                    "visual_enhancement", "storage", "general",
                  ],
                  description:
                    "Legacy accessory-role filter, unused for skincare (products don't carry an accessory role). Leave unset.",
                },
                series: {
                  type: "array",
                  items: {
                    type: "string",
                    enum: [...SERIES_ENUM],
                  },
                  description:
                    "OR-filter on `product.series` (the Collection slug). Sharper than title regex for collection-scoped rows. Examples: ['ultimune'] for an Ultimune-line row, ['vital-perfection'] for a Vital Perfection row, ['shiseido-men'] for a men's-routine row, ['ultimate-sun'] for a sun-care row.",
                },
                compatibleWith: {
                  type: "string",
                  description:
                    "Lowercased title token (e.g. 'vital perfection', 'ultimune', 'clarifying'). Surfaces only products whose title contains this substring. Use for SPECIFIC-PRODUCT rows like 'Products in the Vital Perfection LiftDefine line'. Pair with `series` when you want both a collection AND a specific line, e.g. series:['vital-perfection'] + compatibleWith:'liftdefine' picks the LiftDefine products from the Vital Perfection pool.",
                },
                primaryActivities: {
                  type: "array",
                  items: {
                    type: "string",
                    enum: [
                      "brightening", "anti-aging", "wrinkle-smoothing",
                      "lifting-and-firming", "deeply-hydrating",
                      "pore-minimizing",
                    ],
                  },
                  description:
                    "OR-filter on `primaryActivities` (skin concerns), where any single match counts. e.g. `[anti-aging, wrinkle-smoothing]` keeps products flagged for either. Powerful for concern-driven queries: `[brightening]`, `[lifting-and-firming]`, `[deeply-hydrating]`.",
                },
                titleMatchAny: {
                  type: "array",
                  items: { type: "string" },
                  description:
                    "Last-resort title substrings; prefer `subtypes` / `primaryActivities` first. Use only when the vocab can't disambiguate (e.g. a specific product name like 'Ultimune Power Infusing Concentrate').",
                },
                titleExcludeAny: {
                  type: "array",
                  items: { type: "string" },
                  description:
                    "Reject titles containing any of these substrings. Common values: 'Set', 'Bundle', 'Duo' (multi-product sets) when you want single products only.",
                },
                leadCount: {
                  type: "integer",
                  minimum: 1,
                  maximum: 12,
                  description:
                    "Hard cap on products surfaced for this row. Use 3-5 for sharply-curated rows; up to 12 for breadth (e.g. a wide serum lineup).",
                },
                allowBundles: {
                  type: "boolean",
                  description:
                    "Set true for rows that intentionally surface Sets & Bundles (e.g. a 'Gift sets' or 'Routine kits' row). Default false.",
                },
              },
              required: ["title", "categoryToken"],
              additionalProperties: false,
            },
          },
        },
        required: ["intro", "rows"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "show_product_detail",
      description: "Render a product-detail card in the chat for the given slug.",
      parameters: {
        type: "object",
        properties: { productSlug: { type: "string" } },
        required: ["productSlug"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_to_cart",
      description: "Add a product to the cart and render a cart card. Use only when the shopper clearly wants to buy.",
      parameters: {
        type: "object",
        properties: {
          productSlug: { type: "string" },
          quantity: { type: "number", minimum: 1, maximum: 10 },
        },
        required: ["productSlug", "quantity"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "apply_promo",
      description:
        "Apply a promo code to the most recent cart card. Use this when the shopper provides a code.",
      parameters: {
        type: "object",
        properties: { code: { type: "string" } },
        required: ["code"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "checkout",
      description: "Complete checkout for the most recent cart and render an order-confirmation card.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "suggest_nbas",
      description:
        "Render up to 4 short follow-up suggestion chips. Each label should be 2–6 words. ALWAYS call this after `show_product_listing`, `show_product_detail`, or `add_to_cart` so the shopper has obvious next steps; only skip on pure conversational replies.",
      parameters: {
        type: "object",
        properties: {
          labels: {
            type: "array",
            items: { type: "string" },
            minItems: 1,
            maxItems: 4,
          },
        },
        required: ["labels"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "find_accessories",
      description:
        "Find complementary routine products for a given product: the next routine step or same-collection companions (e.g. a softener and moisturizer to pair with a serum, or a sunscreen to finish a daytime routine). Call this after `show_product_detail` or `add_to_cart` to surface the right routine follow-ups and power cross-sell `suggest_nbas` chips.",
      parameters: {
        type: "object",
        properties: {
          productSlug: {
            type: "string",
            description: "Catalog slug of the anchor product (e.g. the serum or cleanser the shopper is viewing). Complementary products are computed relative to this SKU.",
          },
          role: {
            type: "string",
            enum: [
              "power",
              "mounting",
              "stabilization",
              "visual_enhancement",
              "storage",
              "general",
            ],
            description: "Legacy role filter, unused for skincare (products don't carry an accessory role). Leave unset; complementary products are resolved by category and collection.",
          },
          limit: {
            type: "number",
            description: "Max results. Default 5.",
          },
          requireModelMatch: {
            type: "boolean",
            description: "Legacy flag, unused for skincare. Leave unset (defaults to false).",
          },
        },
        required: ["productSlug"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "lookup_policy",
      description: "Look up store policy text on a given topic (returns / satisfaction guarantee / shipping).",
      parameters: {
        type: "object",
        properties: {
          topic: {
            type: "string",
            enum: ["returns", "warranty", "shipping"],
          },
        },
        required: ["topic"],
        additionalProperties: false,
      },
    },
  },
];

function buildSystemPrompt(products: CatalogProduct[]): string {
  const categories = [...new Set(products.map((p) => p.category))].sort();
  return [
    "You are the Shiseido Personal Beauty Advisor inside a storefront prototype. You help shoppers discover skincare, build routines, answer product questions, manage their cart, and complete checkout.",
    "",
    "STYLE: Be concise, warm, and helpful. Keep to 1-2 short sentences per turn unless the shopper asks for detail. Never invent product titles, slugs, or prices; always call `search_catalog` first to ground recommendations. Never give medical or dermatological diagnoses. Recommend products and suggest seeing a dermatologist for persistent concerns.",
    "FORMATTING: Reply in plain conversational prose. Do NOT use Markdown: no `**bold**`, no `*italic*`, no headers, no bullet or numbered lists. When you need to enumerate items, write them inline as a comma-separated sentence (e.g. \"Start with the cleanser, then the softener, then the serum, and finish with a moisturizer.\").",
    "",
    "WORKFLOW:",
    "- BROAD-VS-SPECIFIC PRECEDENCE (read this BEFORE any tier/category routing): routine- or goal-phrased asks of the shape `routine|regimen|set|products|help for {skin goal, concern, or skin type}` are ALWAYS broad and MUST go to `propose_broad_recipe`, NEVER to `show_product_listing`. The {goal} can be a concern ('anti-aging', 'brightening', 'dark spots', 'firming', 'hydration', 'acne / oily skin'), a skin type ('dry skin', 'sensitive skin', 'combination skin'), or an audience ('men's skincare', 'a routine for my mom'). Do NOT collapse these into a single carousel. Produce a multi-step routine (2-6 rows, one per routine step or concern lane).",
    "- For SPECIFIC shopping intent (e.g. 'show me serums', 'a moisturizer for dry skin', 'sunscreen for the face', 'brightening treatment'), call `search_catalog`, then `show_product_listing` with up to 5 real slugs from the result. Set `showMoreCard: true` if the search found more than you displayed.",
    "- TIER PROPAGATION: when the query implies a price tier ('prestige serum', 'luxury cream', 'everyday moisturizer', 'affordable cleanser'), pass `tier` to BOTH `search_catalog` AND `show_product_listing`. Map: prestige/luxury/premium/advanced/intensive → 'pro'; everyday/affordable/basic/starter → 'beginner'.",
    "- BUDGET PROPAGATION: when the query has a price cap ('serum under $150', 'sunscreen under $60', 'cheaper than $100'), pass `priceMax` to BOTH `search_catalog` AND `show_product_listing`. Same for `priceMin` when set.",
    "- ZERO-RESULT REASONING: if `search_catalog` returns 0 results for a constrained query, DO NOT widen silently. Write a short reply explaining what didn't match (e.g. 'I couldn't find a sunscreen under $40. The most affordable is the Clear Sunscreen Stick at $30.') and call `suggest_nbas` with viable alternatives. Name a real closest product when you can.",
    "- For BROAD/EXPLORATORY intent that spans multiple routine steps (e.g. 'a routine for dry skin', 'help me with dark spots', 'men's skincare routine', 'anti-aging regimen'), STRONGLY PREFER `propose_broad_recipe`. Describe each row as a FILTER SPEC (categoryToken + capabilities + primaryActivities + series + leadCount) and the deterministic engine resolves real SKUs. You never name slugs there.",
    "- BEFORE calling `propose_broad_recipe`, call `search_catalog` 1-2 times to ground yourself: verify the category strings you'll match exist (Cleansers, Softeners, Serums & Treatments, Moisturizers, Eye & Lip Care, Masks, Sunscreen, Sets & Bundles).",
    "- VOCAB for `propose_broad_recipe` (use these tokens exactly):\n  CATEGORIES (categoryToken, substring-matched): cleanser, softener, serum, treatment, moisturizer, eye, mask, sunscreen, set.\n  CAPABILITIES / SKIN TYPES (capabilities): dry, oily, combination, normal, spf, best-seller.\n  CONCERNS (primaryActivities): brightening, anti-aging, wrinkle-smoothing, lifting-and-firming, deeply-hydrating, pore-minimizing.\n  COLLECTIONS (series, OR-filter): benefiance, future-solution-lx, shiseido-men, vital-perfection, essentials, ultimate-sun, ultimune, urban-environment, bio-performance, essential-energy, eudermine. Use `series` when a row scopes to a collection (e.g. 'Shiseido Men routine' → series:['shiseido-men']).",
    "- COMPOSITION HEURISTICS for `propose_broad_recipe` rows: emit 2-6 rows total, using the smallest count that genuinely covers the query and NEVER pad. A full routine follows the order Cleanser → Softener → Serum/Treatment → Eye & Lip Care → Moisturizer → Sunscreen (AM) / Mask (weekly). A concern-led ask ('brightening') may only warrant Serums + Moisturizers + Sunscreen. Set `allowBundles: true` only for set/bundle rows.",
    "- WORKED EXAMPLES for `propose_broad_recipe`:\n  • 'Build a full routine' / 'complete regimen' → Cleansers (categoryToken:'cleanser'); Softeners (categoryToken:'softener'); Serums & treatments (categoryToken:'serum'); Moisturizers (categoryToken:'moisturizer'); Daily sunscreen (categoryToken:'sunscreen').\n  • 'Anti-aging routine' → Serums & treatments (categoryToken:'serum', primaryActivities:['anti-aging','wrinkle-smoothing']); Anti-aging moisturizers (categoryToken:'moisturizer', primaryActivities:['anti-aging']); Eye creams (categoryToken:'eye'); Daily sunscreen (categoryToken:'sunscreen').\n  • 'Brightening / dark spots' → Brightening serums (categoryToken:'serum', primaryActivities:['brightening']); Brightening moisturizers (categoryToken:'moisturizer', primaryActivities:['brightening']); Daily sunscreen (categoryToken:'sunscreen').\n  • 'Routine for dry skin' → Gentle cleansers (categoryToken:'cleanser', capabilities:['dry']); Hydrating softeners (categoryToken:'softener', capabilities:['dry']); Hydrating serums (categoryToken:'serum', capabilities:['dry']); Rich moisturizers (categoryToken:'moisturizer', capabilities:['dry']).\n  • 'Oily / acne-prone routine' → Foaming cleansers (categoryToken:'cleanser', capabilities:['oily']); Balancing softeners (categoryToken:'softener', capabilities:['oily']); Lightweight moisturizers (categoryToken:'moisturizer', capabilities:['oily']); Daily sunscreen (categoryToken:'sunscreen', capabilities:['oily']).\n  • \"Men's skincare\" → Cleansers (categoryToken:'cleanser', series:['shiseido-men']); Moisturizers (categoryToken:'moisturizer', series:['shiseido-men']); Sunscreen (categoryToken:'sunscreen', series:['shiseido-men']).",
    "- For a specific product, call `show_product_detail`.",
    "- For 'add to cart' / 'buy' requests, call `add_to_cart` with the slug and quantity (default 1).",
    "- For promo codes, call `apply_promo`. " + PROMO_HINTS,
    "- For 'checkout' / 'pay', call `checkout`.",
    "- For policy questions (returns, refunds, replacement, guarantee, shipping), call `lookup_policy` and base your answer ONLY on the returned `text`, which is grounded in Shiseido customer care. Do NOT invent return windows or refund timing. Mention the URL from the tool's `source` field.",
    "- For routine cross-sell (after `add_to_cart` or a PDP), call `find_accessories` with the product slug to surface complementary routine steps or same-collection products, and use them to power `suggest_nbas` chips like 'Add a moisturizer to finish your routine'.",
    "- After EVERY `show_product_listing`, `show_broad_listing`, `show_product_detail`, or `add_to_cart` call, ALWAYS follow up with `suggest_nbas` (2-4 short, stage-relevant chips). Never end a turn that surfaced a card without them.",
    "",
    "TIER ROUTING (match recommendations to budget / formula level):",
    "- Map shopper language to a `tier` filter on `search_catalog` (tier is a price band: prestige / mid / everyday). This applies ONLY to SPECIFIC queries. For BROAD routine/concern queries, the BROAD-VS-SPECIFIC PRECEDENCE rule applies first.",
    "  • 'prestige', 'luxury', 'premium', 'advanced', 'intensive', 'best results', 'most effective' → tier: 'pro' (also pass `sortBy: 'price_desc'`).",
    "  • 'everyday', 'affordable', 'budget', 'basic', 'starter', 'gift', 'new to skincare' → tier: 'beginner'.",
    "  • Mid-range / daily / core language → tier: 'intermediate'.",
    "- ALWAYS pass `category` whenever the shopper named one (cleanser, serum, moisturizer, sunscreen, eye cream, mask, etc.).",
    "",
    "CONCERN & SKIN-TYPE ROUTING (match recommendations to the shopper's skin):",
    "- Map shopper context to `useCases` values on `search_catalog`. The catalog ships curated tags per product, so trust them.",
    "  • 'dry', 'dryness', 'dehydrated' → useCases: ['dry']",
    "  • 'oily', 'oil control', 'shine' → useCases: ['oily']",
    "  • 'combination skin' → useCases: ['combination']",
    "  • 'SPF', 'sun protection', 'sunscreen' → useCases: ['spf']",
    "  • 'best seller', 'most popular', 'top rated' → useCases: ['best-seller']",
    "- For concern words (anti-aging, wrinkles, brightening, dark spots, firming, hydration, pores), route by CATEGORY: brightening/anti-aging/firming → Serums & Treatments + Moisturizers; hydration → Moisturizers + Serums & Treatments; pores/oil → Cleansers + Softeners; sun protection → Sunscreen.",
    "",
    "COLLECTION ROUTING (match recommendations to a Shiseido collection):",
    "- Each product carries a `series` tag = its collection: Benefiance, Future Solution LX, Vital Perfection, Ultimune, Bio-Performance, Essential Energy, Eudermine, Essentials, Urban Environment, Ultimate Sun, Shiseido Men.",
    "- When the shopper names a collection ('show me Ultimune', 'the Vital Perfection line', 'Shiseido Men products'), pass the matching `series` value (slugified, e.g. 'vital-perfection') to `search_catalog`.",
    "",
    "ROUTINE CROSS-SELL (drives AOV):",
    "- After surfacing a product via `show_product_detail` or `add_to_cart`, suggest the NEXT routine step or a same-collection product via `suggest_nbas` chips. A serum pairs with a moisturizer and sunscreen; a cleanser pairs with a softener; a moisturizer pairs with daily sunscreen.",
    "",
    "SKIN-CONCERN RECOMMENDATIONS (answers \"my skin is X, what should I use\" turns):",
    "- When the shopper describes a concern (dryness, dullness, dark spots, fine lines, sagging, oiliness/large pores, dark circles, redness/sensitivity, sun protection), recommend the right product family, not the entire shelf. Map: dryness → hydrating moisturizers; dullness/uneven tone → brightening serums; dark spots → dark-spot treatments; fine lines/wrinkles → anti-aging treatments; sagging → firming treatments; oily/large pores → pore-refining cleansers & softeners; dark circles/puffiness → eye creams; sensitivity/redness → gentle, soothing products; sun → daily sunscreen.",
    "- Card title should read like \"Hydrating moisturizers for dry skin\", never echoing the literal query.",
    "",
    "BUNDLES vs SINGLE PRODUCTS:",
    "- Default: carousels show single products. `search_catalog` excludes Sets & Bundles by default.",
    "- Set `includeBundles: true` ONLY when the shopper mentions 'set', 'bundle', 'kit', 'routine', or 'gift set'.",
    "- After showing single products, prefer `suggest_nbas` chips like 'See sets & save', since bundles are an upsell.",
    "",
    "IMPORTANT:",
    "- Do NOT repeat the `intro` text in your free-text reply when calling `show_product_listing`; the carousel renders its own intro.",
    "- When the user picks a follow-up chip, treat its label as their next message and act accordingly.",
    "- When you can't find a match, say so honestly and suggest narrowing.",
    "",
    `Available catalog categories: ${categories.join(", ")}.`,
  ].join("\n");
}

/* ---------- agent factory ---------- */

export function createOpenAIAgent({
  model,
  products,
  getProductBySlug,
}: OpenAIAgentDeps): OpenAIAgent {
  /* The shared client returns `null` only when neither a proxy URL
   * nor a direct API key is configured. Callers gate `createOpenAIAgent`
   * on `isLlmConfigured()` so reaching here without a client is a
   * programmer error, so throw eagerly so the caller's gate doesn't
   * silently produce a broken agent. */
  const client = getOpenAIClient();
  if (!client) {
    throw new Error(
      "createOpenAIAgent: no LLM backend configured. Gate this call on isLlmConfigured() before invoking.",
    );
  }
  const resolvedModel = model ?? getOpenAIModel();
  const systemPrompt = buildSystemPrompt(products);
  let history: ChatCompletionMessageParam[] = [];

  function trimmedHistory(): ChatCompletionMessageParam[] {
    if (history.length <= HISTORY_LIMIT) return history;
    // OpenAI requires every `tool` message to follow an `assistant`
    // message with matching `tool_calls`. A naïve slice can start
    // mid-sequence, on a `tool` message whose `tool_calls` parent
    // got trimmed, or on an `assistant` whose `tool_call_id`s
    // reference tool messages we no longer have. Walk forward to the
    // next `user` message, which is always a safe conversation
    // boundary (the user just-pushed for this turn guarantees we'll
    // find at least one).
    let start = history.length - HISTORY_LIMIT;
    while (start < history.length && history[start].role !== "user") {
      start += 1;
    }
    return history.slice(start);
  }

  function runSearchCatalog(args: {
    query?: string;
    category?: string;
    tier?: "beginner" | "intermediate" | "pro";
    priceMin?: number;
    priceMax?: number;
    includeBundles?: boolean;
    useCases?: string[];
    // Neutralized for skincare (products carry no product-type or
    // accessory-role); accepted for schema compatibility but not used
    // to filter; prefer `category` / `series`.
    productType?: string;
    accessoryRole?: AccessoryRole;
    series?: string;
    sortBy?: "relevance" | "price_desc" | "price_asc" | "rating";
    limit?: number;
  }) {
    const {
      query,
      category,
      tier,
      priceMin,
      priceMax,
      includeBundles = false,
      useCases,
      productType,
      accessoryRole,
      series,
      sortBy = "relevance",
      limit = 5,
    } = args;
    const seriesFilter =
      typeof series === "string" && SERIES_VALUES_LOCAL.has(series)
        ? (series as ProductSeriesValue)
        : null;
    const requiredTags =
      Array.isArray(useCases) && useCases.length > 0
        ? useCases.map(String)
        : null;

    const STOPWORDS = new Set([
      "the", "and", "for", "with", "that", "this", "what", "which", "who", "are",
      "was", "were", "from", "you", "your", "have", "has", "will", "want", "need",
      "good", "best", "show", "find", "give", "looking", "look", "some", "any",
    ]);

    // Synonym expansion: map shopper vocabulary to catalog vocabulary.
    // Each token can expand into several alternatives; ANY of them in the
    // haystack counts as a hit for that token group.
    const SYNONYMS: Record<string, string[]> = {
      cleanser: ["cleanser", "cleansing", "wash", "foam"],
      cleansers: ["cleanser", "cleansing", "wash", "foam"],
      toner: ["softener", "toner", "lotion", "essence"],
      softener: ["softener", "toner", "lotion", "essence"],
      serum: ["serum", "treatment", "concentrate", "ampoule"],
      serums: ["serum", "treatment", "concentrate", "ampoule"],
      treatment: ["treatment", "serum", "concentrate"],
      moisturizer: ["moisturizer", "moisturiser", "cream", "emulsion"],
      moisturiser: ["moisturizer", "moisturiser", "cream", "emulsion"],
      cream: ["cream", "moisturizer", "emulsion"],
      sunscreen: ["sunscreen", "spf", "sun", "uv"],
      spf: ["spf", "sunscreen", "sun"],
      mask: ["mask", "masks"],
      eye: ["eye", "eyes"],
      wrinkle: ["wrinkle", "anti-aging", "anti-ageing", "aging"],
      wrinkles: ["wrinkle", "anti-aging", "anti-ageing", "aging"],
      antiaging: ["anti-aging", "wrinkle", "firming"],
      brightening: ["brightening", "dark", "spot", "radiance", "glow"],
      hydration: ["hydrating", "deeply-hydrating", "moisture", "dry"],
      hydrating: ["hydrating", "deeply-hydrating", "moisture", "dry"],
      firming: ["firming", "lifting", "lift"],
      pores: ["pore", "pore-minimizing", "oily"],
      oily: ["oily", "oil", "pore"],
      dry: ["dry", "hydrating"],
      prestige: ["prestige", "luxury", "premium", "advanced"],
      luxury: ["prestige", "luxury", "premium", "advanced"],
      everyday: ["everyday", "essential", "affordable"],
      men: ["men", "shiseido-men"],
    };

    function expand(token: string): string[] {
      const exp = SYNONYMS[token];
      return exp ? [...exp] : [token];
    }

    const rawTokens = (query ?? "")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 2 && !STOPWORDS.has(t));

    const tokenGroups = rawTokens.map(expand);

    // Auto-detect "set / bundle / routine" queries so the default
    // bundle exclusion doesn't silently drop multi-product sets when
    // the shopper clearly asks for them. Trigger on:
    // - a category-substring that names the Sets & Bundles bucket
    // - query tokens that look like set/kit/routine words
    const SET_QUERY_HINTS = new Set([
      "set", "sets", "bundle", "bundles", "kit", "kits",
      "routine", "regimen", "duo", "trio", "collection",
      "gift", "gifts", "refill", "refills",
    ]);
    const queryLooksLikeSet = rawTokens.some((t) =>
      SET_QUERY_HINTS.has(t),
    );
    const categoryLooksLikeSet =
      typeof category === "string" &&
      /set|bundle|kit|routine|collection|gift/i.test(category);
    const askedForBundles = queryLooksLikeSet || categoryLooksLikeSet;

    // Drop token groups that no product in the catalog matches at
    // all. Without this, one unknown query word (e.g. "podcasting",
    // "skiing") empties the entire result set under our AND
    // semantics. The remaining groups still narrow real signal.
    const productHaystacks = products.map(
      (p) => `${p.title} ${p.category} ${p.shortDescription}`.toLowerCase(),
    );
    const usableTokenGroups = tokenGroups.filter((group) =>
      group.some((alt) => productHaystacks.some((h) => h.includes(alt))),
    );

    const matches = products.filter((p) => {
      // Bundle gating: by default we EXCLUDE Sets & Bundles from the
      // main results so single products lead the carousel. A query
      // that names a set/kit/routine (or an explicit `includeBundles`)
      // keeps them. `includeBundles` flips to bundles-only.
      if (includeBundles) {
        if (!p.isBundle) return false;
      } else if (!askedForBundles && p.isBundle) {
        return false;
      }
      if (seriesFilter && (p.series as string | null) !== seriesFilter) return false;
      // Substring category match that aligns with `getProductsForProductListingPage`
      // and the recipe filter, so the model can pass natural names like
      // "Serums", "Moisturizers", "Sunscreen" without exact-matching
      // the full catalog vocab ("Serums & Treatments", etc.).
      if (
        category &&
        !p.category.toLowerCase().includes(category.toLowerCase())
      ) {
        return false;
      }
      if (tier && p.tier !== tier) return false;
      if (typeof priceMin === "number" && (p.price == null || p.price < priceMin)) return false;
      if (typeof priceMax === "number" && (p.price == null || p.price > priceMax)) return false;
      if (
        requiredTags &&
        !requiredTags.every((tag) => p.useCaseTags.includes(tag))
      ) {
        return false;
      }
      if (usableTokenGroups.length === 0) return true;

      const haystack = `${p.title} ${p.category} ${p.shortDescription}`.toLowerCase();
      // AND across the usable groups only: every shopper token (or
      // one of its synonyms) that exists somewhere in the catalog
      // must hit on this product.
      return usableTokenGroups.every((group) =>
        group.some((alt) => haystack.includes(alt)),
      );
    });

    const sorted = [...matches];
    switch (sortBy) {
      case "price_desc":
        sorted.sort((a, b) => (b.price ?? 0) - (a.price ?? 0));
        break;
      case "price_asc":
        sorted.sort((a, b) => (a.price ?? Number.MAX_SAFE_INTEGER) - (b.price ?? Number.MAX_SAFE_INTEGER));
        break;
      case "rating":
        sorted.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
        break;
      case "relevance":
      default:
        // Stable original order (catalog order) for relevance.
        break;
    }

    const trimmed = sorted.slice(0, Math.min(Math.max(limit, 1), 10)).map((p) => ({
      slug: p.slug,
      title: p.title,
      category: p.category,
      tier: p.tier,
      isBundle: p.isBundle,
      bundleBaseSlug: p.bundleBaseSlug,
      useCaseTags: p.useCaseTags,
      capabilities: p.capabilities,
      subtypes: p.subtypes,
      primaryActivities: p.primaryActivities,
      series: p.series,
      price: p.priceFormatted,
      priceUsd: p.price ?? null,
      rating: p.rating ?? null,
      shortDescription: p.shortDescription,
    }));

    return {
      totalMatches: matches.length,
      results: trimmed,
    };
  }

  function executeTool(
    name: string,
    rawArgs: string,
    actions: AgentAction[],
  ): unknown {
    let args: Record<string, unknown> = {};
    try {
      args = rawArgs ? JSON.parse(rawArgs) : {};
    } catch {
      return { error: "Invalid JSON arguments." };
    }

    switch (name) {
      case "search_catalog":
        return runSearchCatalog(args as Parameters<typeof runSearchCatalog>[0]);

      case "show_product_listing": {
        const intro = String(args.intro ?? "");
        const productSlugs = Array.isArray(args.productSlugs)
          ? (args.productSlugs as unknown[]).map(String).slice(0, 5)
          : [];
        const validSlugs = productSlugs.filter((slug) => Boolean(getProductBySlug(slug)));
        if (validSlugs.length === 0) {
          return { ok: false, error: "No valid product slugs supplied." };
        }
        const useCases = Array.isArray(args.useCases)
          ? Array.from(
              new Set(
                (args.useCases as unknown[])
                  .map((t) => String(t).trim().toLowerCase())
                  .filter((t) => t && SKINCARE_TAG_VALUES.has(t)),
              ),
            )
          : [];
        const compatibleWith =
          typeof args.compatibleWith === "string"
            ? args.compatibleWith.trim().toLowerCase() || undefined
            : undefined;
        const category =
          typeof args.category === "string"
            ? args.category.trim() || undefined
            : undefined;
        const tierRaw =
          typeof args.tier === "string" ? args.tier.trim().toLowerCase() : "";
        const tier =
          tierRaw === "beginner" || tierRaw === "intermediate" || tierRaw === "pro"
            ? tierRaw
            : undefined;
        const priceMax =
          typeof args.priceMax === "number" && Number.isFinite(args.priceMax)
            ? Math.max(0, args.priceMax)
            : undefined;
        const priceMin =
          typeof args.priceMin === "number" && Number.isFinite(args.priceMin)
            ? Math.max(0, args.priceMin)
            : undefined;
        const subtypes = Array.isArray(args.subtypes)
          ? Array.from(
              new Set(
                (args.subtypes as unknown[])
                  .map((s) => String(s).trim().toLowerCase())
                  .filter((s) => s && SKIN_TYPE_VALUES.has(s)),
              ),
            )
          : [];
        actions.push({
          type: "show_product_listing",
          intro,
          productSlugs: validSlugs,
          showMoreCard: Boolean(args.showMoreCard),
          ...(useCases.length > 0 ? { useCases } : {}),
          ...(compatibleWith ? { compatibleWith } : {}),
          ...(category ? { category } : {}),
          ...(tier ? { tier } : {}),
          ...(priceMax !== undefined ? { priceMax } : {}),
          ...(priceMin !== undefined ? { priceMin } : {}),
          ...(subtypes.length > 0 ? { subtypes } : {}),
        });
        return { ok: true, rendered: validSlugs.length };
      }

      case "show_broad_listing": {
        const intro = String(args.intro ?? "");
        const rawRows = Array.isArray(args.rows) ? (args.rows as unknown[]) : [];
        type BroadRow = {
          title: string;
          productSlugs: string[];
          category?: string;
          capabilities?: string[];
          accessoryRole?: string;
        };
        const ALLOWED_CAPABILITIES = SKINCARE_TAG_VALUES;
        const ALLOWED_ROLES = new Set([
          "power",
          "mounting",
          "stabilization",
          "visual_enhancement",
          "storage",
          "general",
        ]);
        const rows: BroadRow[] = [];
        for (const entry of rawRows) {
          if (!entry || typeof entry !== "object") continue;
          const row = entry as Record<string, unknown>;
          const title = String(row.title ?? "").trim();
          if (!title) continue;
          const slugsArray = Array.isArray(row.productSlugs)
            ? (row.productSlugs as unknown[]).map(String)
            : [];
          const validSlugs = slugsArray.filter((slug) =>
            Boolean(getProductBySlug(slug)),
          );
          if (validSlugs.length === 0) continue;
          const categoryRaw =
            typeof row.category === "string" ? row.category.trim() : "";
          const built: BroadRow = {
            title,
            productSlugs: validSlugs.slice(0, 6),
          };
          if (categoryRaw) built.category = categoryRaw;

          if (Array.isArray(row.capabilities)) {
            const tags = (row.capabilities as unknown[])
              .map((t) => String(t).trim().toLowerCase())
              .filter((t) => t && ALLOWED_CAPABILITIES.has(t));
            if (tags.length > 0) {
              built.capabilities = Array.from(new Set(tags));
            }
          }

          if (typeof row.accessoryRole === "string") {
            const role = row.accessoryRole.trim();
            if (role && ALLOWED_ROLES.has(role)) built.accessoryRole = role;
          }

          rows.push(built);
          if (rows.length >= 5) break;
        }
        if (rows.length < 2) {
          return {
            ok: false,
            error: "Need at least 2 rows with valid productSlugs.",
          };
        }
        actions.push({ type: "show_broad_listing", intro, rows });
        return { ok: true, rendered: rows.length };
      }
      case "propose_broad_recipe": {
        const intro = String(args.intro ?? "");
        const rawRows = Array.isArray(args.rows) ? (args.rows as unknown[]) : [];

        const ALLOWED_ROLES_LOCAL = new Set<string>(ACCESSORY_ROLE_VALUES);

        const filterToVocab = (raw: unknown, allow: ReadonlySet<string>): string[] => {
          if (!Array.isArray(raw)) return [];
          const out: string[] = [];
          const seen = new Set<string>();
          for (const v of raw) {
            const t = String(v).trim().toLowerCase();
            if (!t || !allow.has(t) || seen.has(t)) continue;
            seen.add(t);
            out.push(t);
          }
          return out;
        };
        const arrayOfStrings = (raw: unknown): string[] => {
          if (!Array.isArray(raw)) return [];
          const out: string[] = [];
          for (const v of raw) {
            const t = String(v).trim();
            if (t) out.push(t);
          }
          return out;
        };
        const clampInt = (raw: unknown, lo: number, hi: number): number | undefined => {
          const n = Number(raw);
          if (!Number.isFinite(n)) return undefined;
          return Math.max(lo, Math.min(hi, Math.round(n)));
        };

        const specs: ProposeBroadRecipeSpec[] = [];
        const tsBase = Date.now().toString(36);
        for (let i = 0; i < rawRows.length; i++) {
          const r = (rawRows[i] ?? {}) as Record<string, unknown>;
          const title = String(r.title ?? "").trim();
          const categoryToken = String(r.categoryToken ?? "").trim();
          if (!title || !categoryToken) continue;

          const capabilities = filterToVocab(r.capabilities, SKINCARE_TAG_VALUES);
          const subtypes = filterToVocab(r.subtypes, SKIN_TYPE_VALUES);
          const primaryActivities = filterToVocab(r.primaryActivities, PRIMARY_ACTIVITY_VALUES);
          const accessoryRoleRaw = typeof r.accessoryRole === "string"
            ? r.accessoryRole.trim().toLowerCase()
            : "";
          const accessoryRole = ALLOWED_ROLES_LOCAL.has(accessoryRoleRaw)
            ? (accessoryRoleRaw as AccessoryRole)
            : undefined;
          const series = filterToVocab(r.series, SERIES_VALUES_LOCAL);
          const compatibleWith =
            typeof r.compatibleWith === "string"
              ? r.compatibleWith.trim().toLowerCase() || undefined
              : undefined;
          const titleMatchAny = arrayOfStrings(r.titleMatchAny);
          const titleExcludeAny = arrayOfStrings(r.titleExcludeAny);
          const leadCount = clampInt(r.leadCount, 1, 12);
          const allowBundles = Boolean(r.allowBundles);

          const spec: ProposeBroadRecipeSpec = {
            id: `llm-${tsBase}-${i}`,
            title,
            categoryToken,
            allowBundles,
          };
          if (capabilities.length > 0) spec.capabilities = capabilities;
          if (subtypes.length > 0) spec.subtypes = subtypes;
          if (primaryActivities.length > 0) spec.primaryActivities = primaryActivities;
          if (accessoryRole) spec.accessoryRole = accessoryRole;
          if (series.length > 0) spec.series = series;
          if (compatibleWith) spec.compatibleWith = compatibleWith;
          if (titleMatchAny.length > 0) spec.titleMatchAny = titleMatchAny;
          if (titleExcludeAny.length > 0) spec.titleExcludeAny = titleExcludeAny;
          if (leadCount !== undefined) spec.leadCount = leadCount;

          specs.push(spec);
          if (specs.length >= 5) break;
        }
        if (specs.length < 2) {
          return {
            ok: false,
            error:
              "Need at least 2 valid rows. Each row requires `title` and `categoryToken`. Refine your filters.",
          };
        }
        actions.push({ type: "propose_broad_recipe", intro, specs });
        return { ok: true, rendered: specs.length };
      }

      case "show_product_detail": {
        const slug = String(args.productSlug ?? "");
        const product = getProductBySlug(slug);
        if (!product) return { ok: false, error: "Unknown product slug." };
        actions.push({ type: "show_product_detail", productSlug: slug });
        return { ok: true, title: product.title };
      }

      case "add_to_cart": {
        const slug = String(args.productSlug ?? "");
        const quantity = Math.max(1, Math.min(10, Number(args.quantity ?? 1)));
        const product = getProductBySlug(slug);
        if (!product) return { ok: false, error: "Unknown product slug." };
        actions.push({ type: "add_to_cart", productSlug: slug, quantity });
        return { ok: true, title: product.title, quantity };
      }

      case "apply_promo": {
        const code = String(args.code ?? "").trim();
        if (!code) return { ok: false, error: "Empty promo code." };
        actions.push({ type: "apply_promo", code });
        return { ok: true, code: code.toUpperCase() };
      }

      case "checkout":
        actions.push({ type: "checkout" });
        return { ok: true };

      case "suggest_nbas": {
        const labels = Array.isArray(args.labels)
          ? (args.labels as unknown[]).map(String).filter(Boolean).slice(0, 4)
          : [];
        if (labels.length === 0) return { ok: false, error: "No labels supplied." };
        actions.push({ type: "suggest_nbas", labels });
        return { ok: true };
      }

      case "find_accessories": {
        const slug = String(args.productSlug ?? "");
        const core = getProductBySlug(slug);
        if (!core) return { ok: false, error: "Unknown product slug." };
        const role = ACCESSORY_ROLE_VALUES.includes(args.role as AccessoryRole)
          ? (args.role as AccessoryRole)
          : undefined;
        const limit = Math.min(Math.max(Number(args.limit ?? 5), 1), 10);
        const requireModelMatch = Boolean(args.requireModelMatch);
        const accessories = findAccessoriesFor(core, products, {
          role,
          limit,
          requireModelMatch,
        });
        return {
          ok: true,
          coreSlug: core.slug,
          coreTitle: core.title,
          totalMatches: accessories.length,
          accessories: accessories.map((p) => ({
            slug: p.slug,
            title: p.title,
            category: p.category,
            tier: p.tier,
            useCaseTags: p.useCaseTags,
            capabilities: p.capabilities,
            subtypes: p.subtypes,
            primaryActivities: p.primaryActivities,
            series: p.series,
            price: p.priceFormatted,
            priceUsd: p.price ?? null,
            rating: p.rating ?? null,
            shortDescription: p.shortDescription,
          })),
        };
      }

      case "lookup_policy": {
        const topic = String(args.topic ?? "").toLowerCase();
        const text = lookupPolicyText(topic);
        if (!text) return { ok: false, error: "Unknown topic." };
        return { ok: true, topic, text, source: HELP_CENTER_URL };
      }

      default:
        return { ok: false, error: `Unknown tool ${name}.` };
    }
  }

  async function respond(userText: string): Promise<AgentAction[]> {
    const actions: AgentAction[] = [];
    history.push({ role: "user", content: userText });

    let iterations = 0;
    while (iterations < TOOL_LOOP_LIMIT) {
      iterations += 1;

      const completion = await client!.chat.completions.create({
        model: resolvedModel,
        temperature: 0.4,
        messages: [
          { role: "system", content: systemPrompt },
          ...trimmedHistory(),
        ],
        tools: TOOLS,
        tool_choice: "auto",
      });

      const choice = completion.choices[0];
      const message = choice?.message;
      if (!message) break;

      history.push(message);

      const text = (message.content ?? "").trim();
      if (text) {
        actions.push({ type: "say", text });
      }

      const toolCalls = message.tool_calls ?? [];
      if (toolCalls.length === 0) break;

      for (const call of toolCalls) {
        if (call.type !== "function") continue;
        const result = executeTool(call.function.name, call.function.arguments, actions);
        history.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(result),
        });
      }
    }

    return actions;
  }

  function reset() {
    history = [];
  }

  return { respond, reset };
}
