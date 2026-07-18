import { getOpenAIClient, getOpenAIModel } from "../../../lib/openaiClient";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";
import type { AccessoryRole, CatalogProduct } from "../../../catalog/catalog";
import {
  PRIMARY_ACTIVITY_VALUES,
  RAW_CAPABILITY_VALUES,
  SUBTYPE_VALUES,
} from "../../../catalog/catalog";
import {
  DJI_HELP_CENTER_URL,
  POLICY_BODIES,
  classifyHygieneTopic,
  findAccessoriesFor,
  type HygieneTopic,
} from "../conversation/flow";

const ACCESSORY_ROLE_VALUES: AccessoryRole[] = [
  "power",
  "mounting",
  "stabilization",
  "visual_enhancement",
  "storage",
  "general",
  "fpv_component",
];

/**
 * v6.1 series vocab — kept in lockstep with `ProductSeries` in
 * `catalog.ts`. Used to validate the LLM's `series` filter values
 * across `search_catalog`, `propose_broad_recipe`, and `find_accessories`.
 */
const SERIES_ENUM = [
  "mavic",
  "air",
  "mini",
  "avata",
  "neo",
  "inspire",
  "matrice",
  "osmo_action",
  "osmo_pocket",
  "osmo_mobile",
  "osmo_360",
  "osmo_nano",
  "ronin_rs",
  "dji_mic",
  "fpv_goggles",
  "fpv_controller",
] as const;
type ProductSeriesValue = (typeof SERIES_ENUM)[number];
const SERIES_VALUES_LOCAL: ReadonlySet<string> = new Set(SERIES_ENUM);

/**
 * Spec shape shared with the side-by-side assistant's
 * `BroadSubTopicSpec` — declared locally so this module stays
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
   * v6.1: OR-filter on `product.series`. Any single match surfaces
   * the product. Lets the LLM compose series-flavoured rows like
   * "Mavic essentials" (`series: ["mavic"]`) or "FPV starter kit"
   * (`series: ["avata", "fpv_goggles", "fpv_controller"]`) without
   * leaning on title regex.
   */
  series?: string[];
  /**
   * v6.1: lowercased model token. Filters rows to products whose
   * `compatibleWithModels` OR title contains this substring. Use for
   * SPECIFIC-MODEL accessory rows ("Accessories for Mavic 4 Pro");
   * use `series` for FAMILY-level scoping.
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
 * Tools are evaluated locally — read-only tools (search_catalog,
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
       * Canonical use-case tags (`waterproof`, `compact`, `rugged`,
       * etc.) the carousel was scoped to. Threaded through the See
       * Results handoff so the PLP shows the same narrowed subset.
       * Optional — omit for unfiltered listings.
       */
      useCases?: string[];
      /**
       * Lowercased model token (`mavic 4 pro`, `osmo pocket 3`) the
       * carousel was scoped to. Threaded so the PLP applies the same
       * compatibility filter.
       */
      compatibleWith?: string;
      /** Optional category name for the See Results handoff. */
      category?: string;
      /**
       * Buyer tier (`beginner` / `intermediate` / `pro`) the carousel
       * was scoped to. Threaded so a "Pro drones" / "Filmmaker drone"
       * card narrows the PLP to flagship SKUs and doesn't leak Mini /
       * Neo / Flip beginner-tier products.
       */
      tier?: "beginner" | "intermediate" | "pro";
      /**
       * Price ceiling in USD (e.g. 500 for "under $500"). Threaded so
       * "Gimbal under $200" narrows both card and PLP to ≤ $200 SKUs.
       */
      priceMax?: number;
      /**
       * Price floor in USD. Set automatically for pro-tier queries
       * to filter out entry-level SKUs that match the category.
       */
      priceMin?: number;
      /**
       * v6 subtype narrowing — `["mount_helmet"]` for a "helmet
       * mount" carousel, `["acc_filter_nd"]` for ND-only filters.
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
   *  been removed — keys are now injected by the proxy worker
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

// Policy answers are sourced from the canonical DJI Help Center page
// (see `flow.ts` → POLICY_BODIES). Both the rule-based and OpenAI paths
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

const PROMO_HINTS = "Available demo promos: FLY10 (10% off), DJI20 (20% off).";

/* ---------- tool schema ---------- */

const TOOLS: ChatCompletionTool[] = [
    {
    type: "function",
    function: {
      name: "search_catalog",
      description:
        "Search the DJI product catalog. Use the structured filters (`category`, `tier`, `priceMin`/`priceMax`) whenever the shopper signals expertise or budget — don't rely on free-text alone. Call BEFORE show_product_listing or add_to_cart so slugs and prices are grounded.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Free-text query, e.g. 'wireless mic'. Optional." },
          category: {
            type: "string",
            description: "Optional category filter (e.g. 'Drones', 'Action cameras', 'Microphones', 'Gimbals').",
          },
          tier: {
            type: "string",
            enum: ["beginner", "intermediate", "pro"],
            description:
              "Buyer tier. Pick `pro` for expert/professional/cinematic/filmmaker requests, `beginner` for first-time/easy/starter, `intermediate` otherwise.",
          },
          priceMin: { type: "number", description: "Optional price floor in USD. Use this for 'serious'/'pro'/'expert' requests to filter out entry-level gear." },
          priceMax: { type: "number", description: "Optional price ceiling in USD." },
          includeBundles: {
            type: "boolean",
            description:
              "Defaults to false: results EXCLUDE multi-SKU bundles/combos (Fly More Combo, Creator Combo). Set to true ONLY when the shopper explicitly asks for a bundle/combo/kit. Bundles should otherwise be surfaced as upsell NBAs, not in the main PLP.",
          },
          useCases: {
            type: "array",
            items: {
              type: "string",
              enum: [
                "waterproof",
                "underwater",
                "rugged",
                "vlogging",
                "compact",
                "lowlight",
                "sports",
                "outdoor",
                "cinematic",
                "travel",
                "wind_resistant",
                "stabilized",
                "360",
                "gimbal",
                "fpv",
              ],
            },
            description:
              "Required use-case tags from the curated catalog vocabulary. Pass `['waterproof']` for diving/ocean/pool/wet conditions, `['underwater']` if explicitly underwater, `['rugged']` for extreme conditions, `['vlogging']` for content creation, `['compact']` or `['travel']` for portability, `['cinematic']` for filmmaker asks, `['outdoor']` for landscape/nature, `['sports']` for action/activity, `['wind_resistant']` for outdoor flight, `['stabilized']` for handheld smooth video, `['360']` for panoramic. Returns ONLY products tagged with every value — use this to keep non-matching SKUs out of the carousel.",
          },
          productType: {
            type: "string",
            enum: [
              "drone",
              "action_camera",
              "gimbal",
              "mobile_gimbal",
              "camera_gimbal",
              "accessory",
            ],
            description:
              "Optional taxonomy filter from the curated `product_type` column. Cleaner than `category` when you want the core hardware (e.g. only `drone`-typed rows when shopper says 'drones', excluding drone batteries that share the same category). The legacy `gimbal` value matches both `mobile_gimbal` (phone-mount) and `camera_gimbal` (mirrorless-mount).",
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
              "fpv_component",
            ],
            description:
              "Optional accessory role filter from the curated `accessory_role` column. Use when the shopper asks for a specific accessory class — e.g. `power` for batteries/chargers, `visual_enhancement` for filters/lenses, `mounting` for cages/clamps, `storage` for cases/bags, `fpv_component` for goggles or motion controllers (Avata family).",
          },
          series: {
            type: "string",
            enum: [...SERIES_ENUM],
            description:
              "Optional v6.1 series filter (e.g. 'mavic', 'air', 'mini', 'avata', 'osmo_action', 'osmo_pocket', 'dji_mic'). Use when the shopper names a series ('show me the Mavic line', 'Osmo Action gear', 'DJI Mic options') — much sharper than free-text because each product carries a structured `series` tag derived from its title.",
          },
          sortBy: {
            type: "string",
            enum: ["relevance", "price_desc", "price_asc", "rating"],
            description:
              "How to rank results. Default is relevance. Use `price_desc` for pro/cinematic asks so flagship gear surfaces first.",
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
        "Render a horizontal product carousel (PLP) inside the chat. Use after search_catalog to surface the recommended slugs. The `intro` becomes the agent's lead-in line above the carousel — do NOT also repeat it in your free-text reply. CRITICAL: when your search_catalog call narrowed the results by `useCases`, `category`, OR `tier`, ALSO pass those values here so the PLP's See Results handoff lands on the SAME subset shown in the card. Otherwise clicking the card shows the unfiltered category and the shopper sees products that contradict your intro text (e.g. 'Pro drones' but the PLP includes Mini and Neo).",
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
              "Optional category to scope the PLP when the shopper clicks See Results (e.g. 'Drones', 'Microphones', 'Action camera mounts').",
          },
          useCases: {
            type: "array",
            items: {
              type: "string",
              enum: [
                "waterproof", "underwater", "rugged", "vlogging", "compact",
                "lowlight", "sports", "outdoor", "cinematic", "travel",
                "wind_resistant", "stabilized", "360", "gimbal", "fpv",
              ],
            },
            description:
              "Pass the SAME `useCases` you used in `search_catalog` so the PLP narrows to the same subset. Critical for queries like 'waterproof gear', 'travel-friendly drones', 'rugged cameras' — without this, the PLP shows the full category and contradicts your curated card.",
          },
          compatibleWith: {
            type: "string",
            description:
              "Lowercased model token (e.g. 'mavic 4 pro', 'osmo pocket 3') if the carousel is scoped to a specific host product. The PLP will narrow accessory results to SKUs whose `compatibleWithModels` or title contains this token.",
          },
          tier: {
            type: "string",
            enum: ["beginner", "intermediate", "pro"],
            description:
              "Pass when `search_catalog` was called with the same `tier`. Critical for tier-flavored queries like 'Pro drones', 'Filmmaker drone', 'Beginner action cam'. Without this, the PLP shows the full category and a 'Pro drones' card surfaces beginner-tier Mini and Neo SKUs.",
          },
          priceMax: {
            type: "number",
            description:
              "Pass when `search_catalog` was called with `priceMax` (e.g. 'under $500', 'cheaper than $200'). Without this, a 'Gimbal under $200' card shows gimbals at $1,299 because the budget filter doesn't propagate to the PLP.",
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
                "cam_action", "cam_pocket", "cam_360", "cam_dual_screen", "cam_nano",
                "drone_compact", "drone_cinema", "drone_fpv", "drone_selfie",
                "drone_racing", "drone_enterprise",
                "gimbal_phone", "gimbal_camera", "gimbal_compact",
                "mic_wireless", "mic_lavalier", "mic_phone_adapter", "mic_transmitter",
                "mic_receiver", "mic_windscreen", "mic_charging_case", "mic_kit",
                "mount_helmet", "mount_handlebar", "mount_suction", "mount_chest",
                "mount_neck", "mount_wrist", "mount_tripod", "mount_clamp",
                "mount_magnetic", "mount_extension",
                "acc_battery", "acc_charger", "acc_filter_nd", "acc_filter_cpl",
                "acc_filter_uv", "acc_lens_wide", "acc_lens_macro", "acc_propeller",
                "acc_case", "acc_strap", "acc_remote", "acc_landing_gear",
              ],
            },
            description:
              "v6 subtype narrowing — pass for QUERIES THAT NAME A SPECIFIC VARIANT (e.g. 'helmet mount' → ['mount_helmet']; 'ND filter' → ['acc_filter_nd']; 'lavalier mic' → ['mic_lavalier']). Without this, a 'helmet mount' card surfaces all 12 mount types because the category alone (Action camera mounts) doesn't differentiate within the bucket.",
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
        "Render a stack of 3-5 sub-topic rows (each = a sub-search the shopper can drill into) for BROAD/exploratory queries that span multiple categories — e.g. 'gear for my New Zealand trip', 'I'm a beginner, suggest equipment', 'I'm a filmmaker travelling to Iceland, what should I carry'. Prefer this over `show_product_listing` whenever the shopper's request can't be answered with a single product carousel. Each row points at a sub-search of catalog slugs grounded by `search_catalog`. The card also shows a 'Show all' link that opens the full storefront.",
      parameters: {
        type: "object",
        properties: {
          intro: {
            type: "string",
            description:
              "One short lead-in sentence shown above the rows (e.g. 'Here are a few directions for a New Zealand trip').",
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
                    "Sub-topic label (e.g. 'Travel-friendly drones', 'Wireless mics for creators'). 2-5 words.",
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
                    "Optional catalog category (e.g. 'Drones', 'Action cameras', 'Gimbals', 'Microphones', 'Accessories') used to scope the PLP when the shopper clicks the row.",
                },
                capabilities: {
                  type: "array",
                  items: {
                    type: "string",
                    enum: [
                      "waterproof",
                      "underwater",
                      "rugged",
                      "vlogging",
                      "compact",
                      "lowlight",
                      "sports",
                      "outdoor",
                      "cinematic",
                      "travel",
                      "wind_resistant",
                      "stabilized",
                      "360",
                      "gimbal",
                      "fpv",
                    ],
                  },
                  description:
                    "Optional use-case tags applied AS A FILTER on the PLP when the shopper clicks the row. Pass these whenever the row's TITLE narrows the category (e.g. row='360 cameras', category='Action cameras' → capabilities:['360']; row='Travel-friendly drones', category='Drones' → capabilities:['compact']). Do NOT pass for unfiltered category rows.",
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
                    "fpv_component",
                  ],
                  description:
                    "Optional accessory role filter, used for accessory-only rows (e.g. row='Mounting accessories' → accessoryRole:'mounting'; row='Travel cases' → accessoryRole:'storage'; row='FPV goggles & controllers' → accessoryRole:'fpv_component'). Only set when category is 'Accessories'.",
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
        "PREFERRED tool for broad/exploratory shopping queries (replaces show_broad_listing in almost every case). Each row is a SPEC describing a category + capability + subtype + activity filter — the platform's deterministic engine resolves the actual SKUs from the catalog. You never name slugs here, eliminating slug hallucinations. ALWAYS call `search_catalog` 1-2 times first to verify the category names and SKU families you're reasoning about exist; otherwise your filters may produce empty rows.",
      parameters: {
        type: "object",
        properties: {
          intro: {
            type: "string",
            description:
              "One short body-text sentence shown above the rows (e.g. 'I have curated a set of gear that you would need for moto vlogging.').",
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
                    "2-5 word row label (e.g. 'Action cameras', 'Helmet & handlebar mounts', 'Wireless microphones').",
                },
                categoryToken: {
                  type: "string",
                  description:
                    "Substring matched (case-insensitive) against `product.category`. Use the v6 catalog category vocab. Examples: 'action camera', '4k drones', 'gimbal', 'microphone', 'mount', 'case', 'lens filter', 'camcorder'.",
                },
                capabilities: {
                  type: "array",
                  items: {
                    type: "string",
                    enum: [
                      "vlogging", "rugged", "sports", "outdoor", "waterproof",
                      "underwater", "cinematic", "professional", "beginner",
                      "portable", "lightweight", "wind_resistant", "hands_free",
                      "mounting", "navigation", "tracking", "low_light",
                      "smooth_video", "light_control", "protection", "power",
                      "storage", "battery_extension", "flight_support",
                      "control", "travel", "intermediate",
                    ],
                  },
                  description:
                    "AND-filter on raw CSV `capabilities`. Every requested token must be present on the product. Use sparingly — `subtypes` and `primaryActivities` usually narrow better.",
                },
                subtypes: {
                  type: "array",
                  items: {
                    type: "string",
                    enum: [
                      "cam_action", "cam_pocket", "cam_360", "cam_dual_screen",
                      "cam_nano",
                      "drone_compact", "drone_cinema", "drone_fpv",
                      "drone_selfie", "drone_racing", "drone_enterprise",
                      "gimbal_phone", "gimbal_camera", "gimbal_compact",
                      "mic_wireless", "mic_lavalier", "mic_phone_adapter",
                      "mic_transmitter", "mic_receiver", "mic_windscreen",
                      "mic_charging_case", "mic_kit",
                      "mount_helmet", "mount_handlebar", "mount_suction",
                      "mount_chest", "mount_neck", "mount_wrist",
                      "mount_tripod", "mount_clamp", "mount_magnetic",
                      "mount_extension",
                      "acc_battery", "acc_charger", "acc_filter_nd",
                      "acc_filter_cpl", "acc_filter_uv", "acc_lens_wide",
                      "acc_lens_macro", "acc_propeller", "acc_case",
                      "acc_strap", "acc_remote", "acc_landing_gear",
                    ],
                  },
                  description:
                    "AND-filter on `subtypes` (v6 structured taxonomy). Sharpest tool: `[cam_action]` selects flagship action cams; `[mic_wireless]` selects every wireless mic SKU; `[mount_helmet]` selects helmet mounts.",
                },
                accessoryRole: {
                  type: "string",
                  enum: [
                    "power", "mounting", "stabilization",
                    "visual_enhancement", "storage", "general",
                    "fpv_component",
                  ],
                  description:
                    "Filter on `accessory_role`. Set for accessory-only rows (e.g. `mounting` for a mounts row, `storage` for a cases/bags row, `fpv_component` for an FPV goggles/controller row paired with an Avata core).",
                },
                series: {
                  type: "array",
                  items: {
                    type: "string",
                    enum: [...SERIES_ENUM],
                  },
                  description:
                    "OR-filter on `product.series` (v6.1). Sharper than title regex for series-scoped rows. Examples: ['mavic'] for a Mavic-line row, ['osmo_action'] for an Osmo Action row, ['avata','fpv_goggles','fpv_controller'] for an FPV starter-kit row, ['dji_mic'] for a wireless-mic row scoped to the DJI Mic family.",
                },
                compatibleWith: {
                  type: "string",
                  description:
                    "Lowercased model token (e.g. 'mavic 4 pro', 'avata', 'osmo action'). Surfaces only products whose `compatibleWithModels` OR title contains this substring. Use for SPECIFIC-MODEL accessory rows like 'Accessories for Mavic 4 Pro'. Pair with `series` when you want both a family AND a specific model — e.g. series:['avata'] + compatibleWith:'avata 2' picks Avata 2 batteries from the Avata family pool.",
                },
                primaryActivities: {
                  type: "array",
                  items: {
                    type: "string",
                    enum: [
                      "motorcycle", "cycling", "skiing_snowboarding",
                      "surfing", "watersports", "hiking_outdoor", "travel",
                      "vlog", "podcast", "interview", "livestream",
                      "wedding", "real_estate_aerial", "news_journalism",
                      "concert_event", "theatre", "indoor_sports", "family",
                      "beginner_creator", "professional_filmmaker",
                    ],
                  },
                  description:
                    "OR-filter on `primary_activities` — any single match counts. e.g. `[motorcycle, cycling]` keeps gear flagged for either. Powerful for activity-driven queries: `[wedding]`, `[skiing_snowboarding]`, `[podcast]`.",
                },
                titleMatchAny: {
                  type: "array",
                  items: { type: "string" },
                  description:
                    "Last-resort title substrings; prefer `subtypes` / `primaryActivities` first. Use only when the v6 vocab can't disambiguate (e.g. specific model patterns like 'Mavic 4 Pro').",
                },
                titleExcludeAny: {
                  type: "array",
                  items: { type: "string" },
                  description:
                    "Reject titles containing any of these substrings. Common values: 'Adventure', 'Fly More' (variant bundles); 'Combo' (avoid except for action cams whose Standard Combo is the base SKU).",
                },
                leadCount: {
                  type: "integer",
                  minimum: 1,
                  maximum: 12,
                  description:
                    "Hard cap on products surfaced for this row. Use 3-5 for sharply-curated rows; up to 12 for breadth (e.g. wireless mic kits).",
                },
                allowBundles: {
                  type: "boolean",
                  description:
                    "Set true when the row's base SKUs include 'Kit' / 'Combo' titles that are NOT bundles (e.g. wireless mic kits like 'Mic 2 Digital Wireless Microphone Kit'). Default false.",
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
        "Render up to 4 short follow-up suggestion chips. Each label should be 2–6 words. ALWAYS call this after `show_product_listing`, `show_product_detail`, or `add_to_cart` so the shopper has obvious next steps — only skip on pure conversational replies.",
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
        "Find accessories from the catalog that are compatible with a given core product (drone / action camera / gimbal). Uses the curated `compatible_with_type`, `compatible_with_models`, and `accessory_role` columns from v5 — much more reliable than free-text search for cross-sell. Call this after `show_product_detail` or `add_to_cart` to find the right batteries, ND filters, mounts, or cases for the shopper's gear.",
      parameters: {
        type: "object",
        properties: {
          productSlug: {
            type: "string",
            description: "Catalog slug of the CORE product (e.g. the drone or action camera). The accessory list is computed relative to this SKU.",
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
              "fpv_component",
            ],
            description: "Optional accessory role filter. Use `power` for batteries, `visual_enhancement` for ND filters/lens kits, `mounting` for mounts/cages, `storage` for cases/bags, `fpv_component` for goggles/controllers (only meaningful when the core is an Avata-family drone).",
          },
          limit: {
            type: "number",
            description: "Max results. Default 5.",
          },
          requireModelMatch: {
            type: "boolean",
            description: "When true, only return accessories whose `compatible_with_models` explicitly names the core product. When false (default), type-only compatibility is enough.",
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
      description: "Look up store policy text on a given topic (returns / warranty / shipping).",
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
    "You are the DJI Personal Assistant inside a storefront prototype. You help shoppers discover gear, answer product questions, manage their cart, and complete checkout.",
    "",
    "STYLE: Be concise, friendly, and helpful — 1-2 short sentences per turn unless the shopper asks for detail. Never invent product titles, slugs, or prices; always call `search_catalog` first to ground recommendations.",
    "FORMATTING: Reply in plain conversational prose. Do NOT use Markdown — no `**bold**`, no `*italic*`, no `__underline__`, no headers (`#`/`##`), no bullet (`- `, `* `) or numbered (`1.`, `2.`) lists. When you need to enumerate items, write them inline as a comma-separated sentence (e.g. \"It includes the drone, the controller, two batteries, and a carrying case.\"). The host renders a small subset of Markdown defensively, but well-written plain prose always reads better than escaped formatting.",
    "",
    "WORKFLOW:",
    "- BROAD-VS-SPECIFIC PRECEDENCE (CRITICAL — read this BEFORE any tier/category routing): identity- or activity-phrased asks of the shape `gear|kit|equipment|setup|essentials|accessories for {audience or activity}` are ALWAYS broad and MUST go to `propose_broad_recipe`, NEVER to `show_product_listing`. The {audience} can be an identity ('professional filmmaker', 'vlogger', 'photographer', 'content creator', 'YouTuber', 'wedding videographer', 'skier', 'cyclist', 'traveller', 'podcaster', 'real estate agent') or an activity ('moto vlogging', 'skiing', 'a New Zealand trip', 'underwater shoots', 'aerial photography', 'wedding shoots'). Do NOT collapse these into a single PLP carousel — even when the audience word also appears in tier routing (e.g. 'filmmaker' = pro tier for SPECIFIC asks like 'filmmaker drone', but 'gear for filmmaker' is BROAD and produces 2-6 category lanes (use only as many lanes as the query genuinely warrants — never pad)). Tier flavouring still applies INSIDE the recipe rows (e.g. drone row uses `subtypes:['drone_cinema']`), but the OUTPUT shape must be a multi-row recipe.",
    "- For SPECIFIC shopping intent (e.g. 'show me drones', 'mic for vlogging', 'filmmaker drone', 'pro action cam'), call `search_catalog`, then `show_product_listing` with up to 5 real slugs from the result. Set `showMoreCard: true` if the search found more than you displayed.",
    "- TIER PROPAGATION (CRITICAL): when the query implies a tier ('Pro drones', 'Filmmaker drone', 'Cinema gimbal', 'Beginner action cam', 'Starter drone', 'Expert filmmaker'), pass `tier` to BOTH `search_catalog` AND `show_product_listing`. Map: pro/filmmaker/cinema/cinematic/professional/expert → 'pro'; beginner/first-time/starter/just-starting/getting-into → 'beginner'. Without `tier` on `show_product_listing`, the PLP shows the full category and a 'Pro drones' card includes Mini and Neo (which are beginner-tier).",
    "- BUDGET PROPAGATION (CRITICAL): when the query has a price cap ('Gimbal under $200', 'Drones under $500', 'cheaper than $1000'), pass `priceMax` to BOTH `search_catalog` AND `show_product_listing`. Same for `priceMin` when set. Without this, a 'Gimbal under $200' card surfaces $1,299 RS4 Pro gimbals because the budget filter doesn't propagate to the PLP.",
    "- SUBTYPE PROPAGATION (CRITICAL): when the query names a SPECIFIC variant (e.g. 'helmet mount', 'handlebar mount', 'suction cup mount', 'chest strap', 'ND filter', 'CPL filter', 'lavalier mic', 'wireless mic', 'wide-angle lens'), pass the matching v6 subtype on `show_product_listing.subtypes`. Examples: 'helmet mount' → ['mount_helmet']; 'ND filter' → ['acc_filter_nd']; 'lavalier mic' → ['mic_lavalier']; 'wireless mic' → ['mic_wireless']; 'wide-angle lens' → ['acc_lens_wide']. Without this, the carousel shows every variant in the category (a 'helmet mount' query surfaces all 12 mount types).",
    "- ZERO-RESULT REASONING: if `search_catalog` returns 0 results for a constrained query (priceMax / priceMin / tier / useCases that nothing in the catalog matches), DO NOT call `show_product_listing` with slugs from a wider search — that would surface products that violate the shopper's stated constraint. Instead, write a short text reply explaining what didn't match (e.g. 'I couldn't find any action cameras under $300. The most affordable is the Osmo Action 4 at $329.'), and call `suggest_nbas` with viable alternatives ('Show action cameras under $400', 'Show all action cameras', 'Browse beginner drones instead'). Be concrete: name a real cheapest/closest SKU when you can.",
    "- For BROAD/EXPLORATORY shopping intent that spans multiple categories (e.g. 'gear for moto vlogging', 'gear for my New Zealand trip', 'I'm a beginner, suggest equipment', 'I'm getting into aerial photography, what should I have', 'I'm a filmmaker travelling to Iceland — what equipment should I carry'), STRONGLY PREFER `propose_broad_recipe` over `show_broad_listing`. The new tool lets you describe each row as a FILTER SPEC (categoryToken + capabilities + subtypes + primary_activities + accessory_role + title patterns + leadCount) and the platform's deterministic engine resolves real SKUs from the catalog. You never name slugs there — eliminates hallucinated slugs and keeps the card and PLP in lockstep automatically. Use `show_broad_listing` only as a fallback when the v6 vocab below genuinely can't express the row (rare).",
    "- BEFORE calling `propose_broad_recipe`, ALWAYS call `search_catalog` 1-2 times to ground yourself: verify (i) the category strings you'll match exist (e.g. 'Action cameras', '4K drones', 'Camera microphones', 'Action camera mounts', 'Lens filters'), and (ii) the SKU families you're reasoning about are actually in the catalog. Empty rows usually trace back to skipped grounding.",
    "- v6 VOCAB for `propose_broad_recipe` (use these tokens exactly):\n  RAW CAPABILITIES: vlogging, rugged, sports, outdoor, waterproof, underwater, cinematic, professional, beginner, portable, lightweight, wind_resistant, hands_free, mounting, navigation, tracking, low_light, smooth_video, light_control, protection, power, storage, battery_extension, flight_support, control, travel, intermediate.\n  SUBTYPES — Cameras: cam_action, cam_pocket, cam_360, cam_dual_screen, cam_nano. Drones: drone_compact, drone_cinema, drone_fpv, drone_selfie, drone_racing, drone_enterprise. Gimbals: gimbal_phone, gimbal_camera, gimbal_compact. Mics: mic_wireless, mic_lavalier, mic_phone_adapter, mic_transmitter, mic_receiver, mic_windscreen, mic_charging_case, mic_kit. Mounts: mount_helmet, mount_handlebar, mount_suction, mount_chest, mount_neck, mount_wrist, mount_tripod, mount_clamp, mount_magnetic, mount_extension. Other accessories: acc_battery, acc_charger, acc_filter_nd, acc_filter_cpl, acc_filter_uv, acc_lens_wide, acc_lens_macro, acc_propeller, acc_case, acc_strap, acc_remote, acc_landing_gear.\n  PRIMARY ACTIVITIES: motorcycle, cycling, skiing_snowboarding, surfing, watersports, hiking_outdoor, travel, vlog, podcast, interview, livestream, wedding, real_estate_aerial, news_journalism, concert_event, theatre, indoor_sports, family, beginner_creator, professional_filmmaker.\n  ACCESSORY ROLES: power, mounting, stabilization, visual_enhancement, storage, general, fpv_component.\n  SERIES (v6.1, OR-filter): mavic, air, mini, avata, neo, inspire, matrice, osmo_action, osmo_pocket, osmo_mobile, osmo_360, osmo_nano, ronin_rs, dji_mic, fpv_goggles, fpv_controller. Use `series` whenever a row scopes to a marketing line (e.g. 'Mavic essentials' → series:['mavic']; 'FPV starter kit' → series:['avata','fpv_goggles','fpv_controller']; 'Osmo creator setup' → series:['osmo_action','osmo_pocket','osmo_mobile']).",
    "- COMPOSITION HEURISTICS for `propose_broad_recipe` rows: emit 2-6 rows total — use the smallest count that genuinely covers the query and NEVER pad to a target. A narrow ask ('gear for podcasting') may only warrant 2-3 rows; a wide multi-axis ask ('full cinematographer kit') may warrant 5-6. Prefer `subtypes` + `primaryActivities` over `titleMatchAny`. Use `accessoryRole` for accessory rows. Set `allowBundles: true` only for accessory rows whose base SKU is named '… Kit' (wireless mic kits, action cam accessory kits). Use `titleExcludeAny: ['Adventure', 'Fly More']` to drop variant bundles; `titleExcludeAny: ['Combo']` for drones (action-cam Standard Combos are kept by the platform automatically). Set `leadCount: 3-5` for sharply-curated rows; up to `12` for breadth (mic kits).",
    "- COMPAT FILTERING (CRITICAL for accessory rows): when the recipe targets a SPECIFIC host (e.g. 'FPV starter kit' implies Avata; 'Mavic ecosystem' implies Mavic; 'Accessories for Mavic 4 Pro' implies Mavic 4 Pro), every accessory row MUST carry either `series` or `compatibleWith` (or both). Without it, an `acc_battery` row falls back to ALL spare batteries in the catalog (Mini + Neo + Mini 2 + …) instead of the host's. Rule: family scope → `series:['mavic']`/`['avata']`; model scope → `compatibleWith:'mavic 4 pro'`/`'avata 2'`. Use both together when you want a family of accessories narrowed to a specific model variant within it.",
    "- ACCESSORIES-ONLY RULE: when the shopper's query explicitly says 'accessories' / 'accessory' / 'add-ons' (e.g. 'osmo action accessories for deep sea', 'accessories for Mavic 4 Pro', 'flip drone accessories'), the rows must contain ACCESSORY subtypes ONLY: `acc_*`, `mount_*`, `mic_*`. NEVER include flagship-camera (`cam_action`, `cam_pocket`, `cam_360`, `cam_nano`), drone (`drone_compact`, `drone_cinema`, `drone_fpv`, `drone_selfie`), or gimbal (`gimbal_phone`, `gimbal_camera`, `gimbal_compact`) subtypes — those are flagship products, not accessories. The shopper asked for accessories; surfacing the camera or drone itself contradicts the request. For 'osmo action accessories for deep sea' use rows like Diving accessory kits (categoryToken:'kit', subtypes:['acc_case'], capabilities:['waterproof'], allowBundles:true), Mounting accessories (categoryToken:'mount', accessoryRole:'mounting', capabilities:['waterproof']), Wrist & chest mounts (subtypes:['mount_wrist','mount_chest']), ND filters (categoryToken:'lens filter', subtypes:['acc_filter_nd']). For single-axis accessory queries (e.g. 'wireless mic for podcasting', 'helmet mount', 'ND filter for Mavic 4 Pro'), prefer `show_product_listing` instead of `propose_broad_recipe`.",
    "- GENERIC ACCESSORIES-FOR-MODEL RULE: when the shopper says 'accessories for [model]' WITHOUT naming a specific accessory class (no 'mount', 'filter', 'battery', 'case', 'mic', etc.), the request spans MULTIPLE accessory categories (filters + batteries + propellers + cases). MUST use `propose_broad_recipe` with 2-6 accessory rows (typically 3-4; use only as many as the model genuinely needs — never pad) — DO NOT call `show_product_listing` with a single `category` like 'Lens filters', that narrows the result to one bucket and contradicts what the shopper asked for. See the 'Accessories for Mavic 4 Pro' worked example below.",
    "- WORKED EXAMPLES for `propose_broad_recipe`:\n  • 'Gear for professional filmmaker' / 'Kit for cinematographer' / 'Equipment for film production' → 4 rows. Cinema drones (categoryToken:'4k drones', subtypes:['drone_cinema'], primaryActivities:['professional_filmmaker'], titleExcludeAny:['Combo','Fly More'], leadCount:4); Camera gimbals (categoryToken:'gimbal', subtypes:['gimbal_camera'], primaryActivities:['professional_filmmaker','wedding'], leadCount:4); Wireless microphones (categoryToken:'microphone', subtypes:['mic_wireless'], allowBundles:true, leadCount:6); ND filters (categoryToken:'lens filter', subtypes:['acc_filter_nd','acc_filter_cpl'], leadCount:4).\n  • 'Gear for moto vlogging' → 4 rows. Action cameras (categoryToken:'action camera', subtypes:['cam_action'], primaryActivities:['motorcycle'], titleExcludeAny:['Adventure','Fly More'], leadCount:3); Wireless microphones (categoryToken:'microphone', subtypes:['mic_wireless'], allowBundles:true, leadCount:12); Mounting accessories (categoryToken:'mount', accessoryRole:'mounting', primaryActivities:['motorcycle','cycling'], leadCount:4); Compact drones (categoryToken:'4k drones', subtypes:['drone_compact'], titleExcludeAny:['Combo','Fly More'], leadCount:5).\n  • 'Gear for skiing' → Rugged action cams (categoryToken:'action camera', subtypes:['cam_action'], primaryActivities:['skiing_snowboarding']); Helmet & chest mounts (categoryToken:'mount', accessoryRole:'mounting', primaryActivities:['skiing_snowboarding']); Travel cases (categoryToken:'case', subtypes:['acc_case'], primaryActivities:['skiing_snowboarding','travel']); Wind-resistant compact drones (categoryToken:'4k drones', subtypes:['drone_compact'], capabilities:['wind_resistant']).\n  • 'Wedding videographer kit' → Cinema drones (categoryToken:'4k drones', subtypes:['drone_cinema'], primaryActivities:['wedding']); Camera gimbals (categoryToken:'gimbal', subtypes:['gimbal_camera'], primaryActivities:['wedding','professional_filmmaker']); Wireless microphones (categoryToken:'microphone', subtypes:['mic_wireless'], allowBundles:true, leadCount:6); ND filters (categoryToken:'lens filter', subtypes:['acc_filter_nd']).\n  • 'Real estate aerial photography' → Cinema drones (categoryToken:'4k drones', subtypes:['drone_cinema'], primaryActivities:['real_estate_aerial']); Wide-angle lenses (categoryToken:'lens', subtypes:['acc_lens_wide']); ND filters (categoryToken:'lens filter', subtypes:['acc_filter_nd','acc_filter_cpl']); Travel cases (categoryToken:'case', subtypes:['acc_case']).\n  • 'Osmo Action accessories for deep sea' → ACCESSORIES-ONLY rows (NO `cam_action` row). Diving accessory kits (categoryToken:'kit', subtypes:['acc_case'], capabilities:['waterproof','underwater'], allowBundles:true, compatibleWith:'osmo action'); Wrist & chest mounts (categoryToken:'mount', accessoryRole:'mounting', subtypes:['mount_wrist','mount_chest'], compatibleWith:'osmo action'); Suction cup mounts (categoryToken:'mount', accessoryRole:'mounting', subtypes:['mount_suction'], compatibleWith:'osmo action'); ND filters (categoryToken:'lens filter', subtypes:['acc_filter_nd'], compatibleWith:'osmo action').\n  • 'Accessories for Mavic 4 Pro' → Filters (categoryToken:'lens filter', subtypes:['acc_filter_nd','acc_filter_cpl'], compatibleWith:'mavic 4 pro'); Spare batteries (categoryToken:'drone accessor', subtypes:['acc_battery'], compatibleWith:'mavic 4 pro'); Propellers (categoryToken:'drone accessor', subtypes:['acc_propeller'], compatibleWith:'mavic 4 pro'); Carrying cases (categoryToken:'case', subtypes:['acc_case'], compatibleWith:'mavic 4 pro').\n  • 'FPV starter kit' / 'I'm getting into FPV' → 4 rows. FPV drones (categoryToken:'4k drones', subtypes:['drone_fpv'], series:['avata']); Goggles & viewers (categoryToken:'drone', accessoryRole:'fpv_component', series:['fpv_goggles']); Motion controllers (categoryToken:'drone', accessoryRole:'fpv_component', series:['fpv_controller']); Spare batteries (categoryToken:'drone', subtypes:['acc_battery'], series:['avata'], compatibleWith:'avata'). NOTE: `compatibleWith:'avata'` is REQUIRED on the spare-batteries row — without it the row falls back to ALL spare batteries in the catalog (Mini, Neo, etc.) which is wrong for an FPV kit. Always pair accessory rows with EITHER `series` (family) OR `compatibleWith` (model) when the host is implied.\n  • 'Show me the Mavic ecosystem' → Mavic drones (categoryToken:'4k drones', subtypes:['drone_compact','drone_cinema'], series:['mavic'], titleExcludeAny:['Combo','Fly More']); Mavic ND filters (categoryToken:'lens filter', subtypes:['acc_filter_nd'], compatibleWith:'mavic'); Mavic batteries (categoryToken:'drone', subtypes:['acc_battery'], compatibleWith:'mavic'); Mavic carry cases (categoryToken:'case', subtypes:['acc_case'], compatibleWith:'mavic').\n  • 'Osmo creator setup' → Pocket cameras (categoryToken:'action camera', subtypes:['cam_pocket'], series:['osmo_pocket']); Action cameras (categoryToken:'action camera', subtypes:['cam_action'], series:['osmo_action']); Phone gimbals (categoryToken:'gimbal', subtypes:['gimbal_phone'], series:['osmo_mobile']); Wireless microphones (categoryToken:'microphone', subtypes:['mic_wireless'], series:['dji_mic'], allowBundles:true, leadCount:6).",
    "- LEGACY `show_broad_listing` GUIDANCE (use only as fallback): run `search_catalog` once per relevant category, then call `show_broad_listing` with one row per category and slugs from those results. When a row narrows its category by use-case or role, also pass that filter on the row (`capabilities` for use-case slices, `accessoryRole` for accessory buckets) so the PLP lands on the same subset shown in the card. Prefer fewer, sharper rows (3-5 products each).",
    "- For a specific product, call `show_product_detail`.",
    "- For 'add to cart' / 'buy' requests, call `add_to_cart` with the slug and quantity (default 1).",
    "- For promo codes, call `apply_promo`. " + PROMO_HINTS,
    "- For 'checkout' / 'pay', call `checkout`.",
    "- For policy questions (returns, refunds, replacement, warranty, shipping), call `lookup_policy` and base your answer ONLY on the returned `text` — it's grounded in the DJI Help Center. Do NOT invent return windows, refund timing, or warranty length. Mention the help-center URL from the tool's `source` field so the shopper can read the full policy.",
    "- For accessory cross-sell (after `add_to_cart` or a PDP for a CORE product), call `find_accessories` with the core slug to discover the right batteries / ND filters / mounts / cases. Use those results to power `suggest_nbas` chips like `Add ND filter set: Freewell ND Mini 4 Pro`.",
    "- After EVERY `show_product_listing`, `show_broad_listing`, `show_product_detail`, or `add_to_cart` call, ALWAYS follow up with `suggest_nbas` (2-4 short, stage-relevant chips). The shopper relies on these chips to take the next step — never end a turn that surfaced a card without them.",
    "",
    "TIER ROUTING (CRITICAL — match recommendations to expertise/budget):",
    "- Map shopper language to a `tier` filter on `search_catalog`. NOTE: tier routing applies ONLY to SPECIFIC queries (e.g. 'filmmaker drone', 'pro action cam', 'cinema gimbal'). For BROAD identity-phrased queries ('gear for filmmaker', 'kit for vlogger', 'equipment for cinematographer'), the BROAD-VS-SPECIFIC PRECEDENCE rule applies first — go to `propose_broad_recipe`, not a tier-filtered carousel.",
    "  • 'pro', 'expert', 'professional', 'cinematic', 'cinema', 'filmmaker', 'serious', 'commercial', 'enterprise' → tier: 'pro' (also pass `sortBy: 'price_desc'`).",
    "  • 'landscape photography', 'wildlife', 'aerial photography', 'real-estate', 'long-range', 'mapping', 'survey' → tier: 'pro' AND `priceMin: 800` (camera quality + flight time matter — never surface the Neo or Mini SE for these).",
    "  • Photography-as-the-goal language (any 'photography'/'photo' word with a serious context: travel photography, nature photography, landscape photography) → tier: 'intermediate' minimum, prefer 'pro'.",
    "  • 'first drone', 'beginner', 'starter', 'easy', 'kid', 'gift', 'casual', 'just trying it' → tier: 'beginner'.",
    "  • Mid-range / hobbyist / weekend creator language → tier: 'intermediate'.",
    "- For pro/expert asks, ALSO pass `priceMin: 1000` for drones (or `priceMin: 400` for cameras/gimbals/mics) so entry-level gear is filtered out.",
    "- Never recommend the DJI Neo, DJI Mini SE, or any 'beginner' tier product to a shopper who used pro/expert/cinematic/filmmaker language OR who explicitly mentioned photography as their goal (landscape/wildlife/aerial/travel photography). The Neo is a toy-class FPV trainer, NOT a photography drone — it has a fixed-aperture 1/2-inch sensor and no obstacle sensing.",
    "- When tier filtering returns 0 results, drop `priceMin` first, keep `tier`, and re-search before falling back.",
    "- ALWAYS pass `category` whenever the shopper named one (drone/drones, mic/mics, gimbal/gimbals, camera/cameras, etc.). NEVER call `search_catalog` with `tier` set but `category` unset when the query clearly mentions a category — this leaks unrelated SKUs (e.g. robotic vacuums) into the results.",
    "",
    "USE-CASE ROUTING (CRITICAL — match recommendations to the activity):",
    "- Map shopper context to `useCases` filter values on `search_catalog`. The catalog ships curated `capabilities` per product — these tags are authoritative; trust them.",
    "  • 'dive', 'diving', 'scuba', 'snorkel', 'underwater', 'swim', 'ocean', 'sea', 'surf', 'beach', 'pool', 'rain' → useCases: ['waterproof'] (add 'underwater' for explicit underwater/scuba)",
    "  • 'rugged', 'extreme', 'cold', 'mountain', 'hiking', 'skiing', 'biking', 'adventure' → useCases: ['rugged']",
    "  • 'sports', 'sport', 'action', 'cycling', 'running' → useCases: ['sports']",
    "  • 'vlog', 'creator', 'selfie', 'content creator' → useCases: ['vlogging']",
    "  • 'travel', 'trip', 'backpack' → useCases: ['travel']  (also implies compact)",
    "  • 'compact', 'portable', 'lightweight', 'pocket' → useCases: ['compact']",
    "  • 'cinematic', 'cinema', 'filmmaker', 'film', 'commercial' → useCases: ['cinematic']  (often pair with tier:'pro')",
    "  • 'outdoor', 'landscape', 'nature' → useCases: ['outdoor']",
    "  • 'wind', 'windy', 'gusty' → useCases: ['wind_resistant']",
    "  • 'stabilized', 'stabilization', 'smooth handheld' → useCases: ['stabilized']",
    "  • 'low light', 'night', 'sunset', 'astro' → useCases: ['lowlight']",
    "  • '360', 'panoramic', 'all around' → useCases: ['360']",
    "  • 'fpv', 'first person', 'racing' → useCases: ['fpv']",
    "- CRITICAL: For diving / underwater / swimming / surfing queries, ALWAYS pass `useCases: ['waterproof']`. Only Action 3/4/5/6, Osmo Nano, and Osmo 360 carry this tag — the DJI Pocket 3 does not. Without this filter you WILL recommend the wrong gear.",
    "- After search, sanity-check: every result row exposes `useCaseTags` AND `capabilities` (the raw curated tokens). If a result is missing the required tag, drop it before calling `show_product_listing`.",
    "",
    "PRODUCT TYPE ROUTING:",
    "- The catalog has a `productType` column with values: 'drone', 'action_camera', 'mobile_gimbal', 'camera_gimbal', 'accessory'. The legacy alias 'gimbal' matches both gimbal sub-types.",
    "- Pass `productType: 'drone'` for 'drones' queries (excludes drone batteries / spare props that share the same category).",
    "- Pass `productType: 'action_camera'` for camera queries.",
    "- Pass `productType: 'mobile_gimbal'` when the shopper specifically wants a phone gimbal (Osmo Mobile family). Pass `productType: 'camera_gimbal'` for mirrorless-mount gimbals (Ronin family). Use the catch-all `'gimbal'` if it's ambiguous.",
    "- NEVER pass `productType: 'accessory'` unless the shopper explicitly asked for an accessory. Use `find_accessories` for cross-sell instead — it's grounded in the curated `compatible_with_type` / `compatible_with_models` columns.",
    "",
    "SERIES ROUTING (v6.1 — match recommendations to a marketing line):",
    "- Each product carries a structured `series` tag inferred from its title. Series cover DJI's full lineup: Drones (mavic, air, mini, avata, neo, inspire, matrice), Cameras (osmo_action, osmo_pocket, osmo_360, osmo_nano), Gimbals (osmo_mobile, ronin_rs), Audio (dji_mic), and FPV peripherals (fpv_goggles, fpv_controller).",
    "- When the shopper names a series — 'show me the Mavic line', 'Osmo Action gear', 'Ronin gimbals', 'DJI Mic options', 'I want a Mini drone' — pass the matching `series` value to `search_catalog`. Sharper than free-text because the tag is grounded.",
    "- For ecosystem queries that span an entire series ('what's in the Mavic ecosystem', 'Osmo creator setup', 'FPV starter kit'), use `propose_broad_recipe` and pass `series` on each row. Examples: 'FPV starter kit' → row 1 (Avata drones, series:['avata']) + row 2 (Goggles, series:['fpv_goggles']) + row 3 (Controllers, series:['fpv_controller']) + row 4 (Spare batteries, accessoryRole:'power', compatibleWith:'avata').",
    "- Series → tier defaults (use as a sanity check; the catalog's curated `tier` is still authoritative): mavic / air / inspire / ronin_rs → typically pro or intermediate; mini / neo / osmo_pocket → typically beginner-to-intermediate; avata → intermediate (FPV); matrice → pro/enterprise.",
    "",
    "ACCESSORY CROSS-SELL (CRITICAL — drives AOV):",
    "- After surfacing a CORE product (drone, action camera, gimbal) via `show_product_detail` or `add_to_cart`, ALWAYS call `find_accessories(productSlug)` to discover compatible batteries, ND filters, mounts, and cases.",
    "- Use the returned accessories to power 2-3 `suggest_nbas` chips. Prefer concrete labels like `'Add ND filter: Freewell Mini 4 Pro'` over vague ones like `'Add ND filter'` — the curated `compatible_with_models` makes precise chips possible.",
    "- Use `accessoryRole` filtering when the shopper signals intent: shopper says 'extra battery' → `role: 'power'`; 'lens kit' → `role: 'visual_enhancement'`; 'mount' → `role: 'mounting'`; 'case'/'bag' → `role: 'storage'`.",
    "- For a complete-creator-kit pitch, call `find_accessories` once for `role='power'` and once for `role='visual_enhancement'` and combine the top picks into the NBA chips.",
    "",
    "SYMPTOM-DRIVEN ACCESSORY RECOMMENDATIONS (CRITICAL — answers \"I have X, how do I solve Y\" turns):",
    "- When the shopper indicates they OWN a product (\"I have a Mavic 4 Pro\", \"my Osmo Action\", \"I just got a DJI Mic\") AND describes a problem they want to solve (glare, reflections, wind noise, shaky footage, short battery life, footage too bright, water/diving, scratched lens), DO NOT call `show_product_listing` with `category: 'Action cameras'` (or any flagship category). That collapses the answer to the entire camera shelf and ignores what the shopper asked. Instead, recommend the right ACCESSORY shelf scoped to the named host.",
    "- Preferred path when a specific SKU is named: call `find_accessories(productSlug, role)` with the slug of the owned product. The `productSlug` may need to be looked up first via a quick `search_catalog({ query: '<model>' })` so you can pick the matching CORE SKU.",
    "- Preferred path when only a family is named (\"my osmo action\" without a version): call `search_catalog` with `productType` + `accessoryRole` + `subtypes` and the family token in `compatibleWith`. Example for \"how do I reduce glare on my Osmo Action\": `search_catalog({ accessoryRole: 'visual_enhancement', subtypes: ['acc_filter_cpl'], compatibleWith: 'osmo action' })` then `show_product_listing` with the resulting slugs and a card title like \"Polarising filters for your Osmo Action\".",
    "- Symptom → role / subtype mapping (use these exactly):",
    "    glare / reflections / shiny → role: 'visual_enhancement', subtypes: ['acc_filter_cpl'], label: 'polarising filters'.",
    "    too bright / overexposed / sunny day / harsh light / blown out → role: 'visual_enhancement', subtypes: ['acc_filter_nd'], label: 'ND filters'.",
    "    wind noise / muffled outdoor audio → role: 'general', subtypes: ['mic_windscreen'], label: 'windscreens'.",
    "    shaky / jittery / unstable / wobbly footage → role: 'stabilization', label: 'gimbals'.",
    "    battery dies / drains / short / extra battery / power bank → role: 'power', label: 'extra batteries'.",
    "    underwater / scuba / diving / snorkel / wet / rain → role: 'general', subtypes: ['acc_case'], capabilities: ['waterproof','underwater'], label: 'waterproof gear'.",
    "    scratched lens / lens protector / lens cap → role: 'visual_enhancement', subtypes: ['acc_filter_uv'], label: 'lens protectors'.",
    "- Card title MUST follow the form `\"<Label> for your <Model>\"` (e.g. \"Polarising filters for your Osmo Action 5 Pro\") — never echo the literal query, and never use a flagship-category title like \"Action cameras\" for a symptom turn.",
    "- After surfacing the recommendation, follow with `suggest_nbas` chips that let the shopper pivot: ('Reduce glare on Osmo Action 6', 'See all polarising filters', 'Compare CPL vs ND filters'). Keep them short and symptom-aware.",
    "",
    "FPV ECOSYSTEM CROSS-SELL (when the core is an Avata-family drone):",
    "- The Avata FPV experience requires a drone + goggles + controller. After surfacing an Avata core via `show_product_detail` or `add_to_cart`, ALWAYS call `find_accessories(productSlug, role: 'fpv_component')` IN ADDITION to the standard accessory call. The `fpv_component` role surfaces goggles (Goggles 3 / Goggles Integra) and controllers (Motion Controller / FPV Remote Controller) when they're standalone SKUs in the catalog.",
    "- If `find_accessories(role: 'fpv_component')` returns 0 results (the catalog ships only Avata combo bundles today), fall back to `search_catalog({ query: 'goggles', includeBundles: true })` and surface the matching Avata combo SKU as the upsell instead.",
    "- For broad FPV queries ('I'm getting into FPV', 'FPV starter kit', 'what do I need to fly Avata'), use `propose_broad_recipe` with at least three rows: FPV drones (categoryToken:'4k drones', subtypes:['drone_fpv'], series:['avata']), Goggles & viewers (categoryToken:'drone', accessoryRole:'fpv_component', series:['fpv_goggles']), Controllers (categoryToken:'drone', accessoryRole:'fpv_component', series:['fpv_controller']). When the goggles/controllers row resolves to 0 SKUs (catalog gap), the platform drops the empty row automatically — that's expected.",
    "- NEVER recommend Avata goggles or motion controllers for a non-FPV core (Mavic, Air, Mini, Neo, Inspire, Matrice). They only pair with the Avata family — the catalog's `compatibleWithModels` enforces this, but be defensive in your reasoning too.",
    "",
    "BUNDLES vs CORE PRODUCTS:",
    "- Default behaviour: PLP carousels show CORE products (single SKUs). `search_catalog` excludes bundles (Fly More Combo, Creator Combo, Cine Premium Combo, kits) by default.",
    "- Set `includeBundles: true` ONLY when the shopper explicitly mentions 'bundle', 'combo', 'kit', 'fly more', or 'save more'.",
    "- After showing core products, prefer `suggest_nbas` chips like 'Save more with Mavic 4 Pro Creator Combo' or 'See drone bundles & save' — bundles are an upsell, not the default recommendation.",
    "- Never call `show_product_listing` with bundle slugs unless the shopper asked for bundles. If `search_catalog` returns a result with `isBundle: true`, treat it as a candidate upsell chip, not a primary recommendation.",
    "",
    "IMPORTANT:",
    "- Do NOT repeat the `intro` text in your free-text reply when calling `show_product_listing` — the carousel renders its own intro.",
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
   * programmer error — throw eagerly so the caller's gate doesn't
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
    // mid-sequence — on a `tool` message whose `tool_calls` parent
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
    productType?:
      | "drone"
      | "action_camera"
      | "gimbal"
      | "mobile_gimbal"
      | "camera_gimbal"
      | "accessory";
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

    // Synonym expansion — map shopper vocabulary to catalog vocabulary.
    // Each token can expand into several alternatives; ANY of them in the
    // haystack counts as a hit for that token group.
    const SYNONYMS: Record<string, string[]> = {
      drone: ["drone", "mavic", "air", "mini", "neo", "avata", "inspire", "matrice"],
      drones: ["drone", "mavic", "air", "mini", "neo", "avata", "inspire", "matrice"],
      camera: ["camera", "osmo", "action", "pocket"],
      cameras: ["camera", "osmo", "action", "pocket"],
      mic: ["mic", "microphone"],
      microphone: ["mic", "microphone"],
      gimbal: ["gimbal", "ronin", "rs"],
      cinematic: ["cinematic", "cine", "pro", "x9", "ronin", "inspire", "raw"],
      cinema: ["cinematic", "cine", "pro", "x9", "ronin", "inspire", "raw"],
      filmmaker: ["cine", "pro", "x9", "ronin", "inspire", "raw"],
      filmmaking: ["cine", "pro", "x9", "ronin", "inspire", "raw"],
      pro: ["pro", "cine", "ronin", "inspire", "x9", "raw"],
      expert: ["pro", "cine", "ronin", "inspire", "x9", "raw"],
      professional: ["pro", "cine", "ronin", "inspire", "x9", "raw"],
      vlog: ["vlog", "osmo", "pocket", "action", "mic"],
      vlogging: ["vlog", "osmo", "pocket", "action", "mic"],
      travel: ["mini", "pocket", "neo", "compact"],
      compact: ["mini", "pocket", "neo", "compact"],
      beginner: ["mini", "neo", "starter"],
      starter: ["mini", "neo", "starter"],
      enterprise: ["matrice", "enterprise"],
      racing: ["avata", "fpv"],
      fpv: ["avata", "fpv"],
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

    // Auto-detect accessory queries so the default isAccessory hide
    // doesn't silently drop mics, mounts, batteries, filters, etc.
    // when the shopper clearly asks for them. Trigger on:
    // - explicit productType="accessory" or accessoryRole
    // - category-substring that names an accessory bucket
    // - query tokens that look like accessory class words
    const ACCESSORY_QUERY_HINTS = new Set([
      "mic", "microphone", "microphones", "mics",
      "mount", "mounts", "tripod", "tripods", "selfie", "stick",
      "battery", "batteries", "charger", "chargers",
      "filter", "filters", "lens", "lenses", "uv", "cpl",
      "case", "cases", "bag", "bags", "backpack", "backpacks",
      "adapter", "adapters", "strap", "straps", "propeller",
      "remote", "headband", "cage", "kit",
    ]);
    const queryLooksAccessory = rawTokens.some((t) =>
      ACCESSORY_QUERY_HINTS.has(t),
    );
    const categoryLooksAccessory =
      typeof category === "string" &&
      /microphone|mount|case|bag|backpack|filter|strap|tripod|adapter|grip|stick|battery|charger|lens|remote|accessor/i.test(
        category,
      );
    const askedForAccessories =
      productType === "accessory" ||
      Boolean(accessoryRole) ||
      queryLooksAccessory ||
      categoryLooksAccessory;

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
      // Bundle gating mirrors the rule-based path: accessory queries
      // skip the bundle exclusion so Kit-named accessory SKUs (e.g.
      // "Diving Accessory Kit", "Mic 2 Microphone Kit") survive the
      // catalog's `\bkit\b`-based bundle heuristic. An explicit ask
      // for `includeBundles` flips to bundles-only as before.
      if (includeBundles) {
        if (!p.isBundle) return false;
      } else if (!askedForAccessories && p.isBundle) {
        return false;
      }
      // Hide accessories from default search results unless the
      // shopper explicitly asked for them (via productType,
      // accessoryRole, accessory-flavoured category, or accessory
      // class words in the query — see `askedForAccessories`).
      if (!askedForAccessories && p.isAccessory) {
        return false;
      }
      if (productType) {
        if (productType === "gimbal") {
          if (p.productTypeGroup !== "gimbal") return false;
        } else if (p.productType !== productType) {
          return false;
        }
      }
      if (accessoryRole && p.accessoryRole !== accessoryRole) return false;
      if (seriesFilter && p.series !== seriesFilter) return false;
      // Substring category match — aligns with `getProductsForProductListingPage`
      // and the recipe filter, so the model can pass natural names like
      // "Drones", "Microphones", "Action cameras" without exact-matching
      // the v6 vocab ("4K drones", "Camera microphones", etc.).
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
      // AND across the usable groups only — every shopper token (or
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
      productType: p.productType,
      productTypeGroup: p.productTypeGroup,
      isAccessory: p.isAccessory,
      accessoryRole: p.accessoryRole,
      compatibleWithType: p.compatibleWithType,
      compatibleWithModels: p.compatibleWithModels,
      tier: p.tier,
      isBundle: p.isBundle,
      bundleBaseSlug: p.bundleBaseSlug,
      useCaseTags: p.useCaseTags,
      capabilities: p.capabilities,
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
        const ALLOWED_USECASES = new Set([
          "waterproof","underwater","rugged","vlogging","compact","lowlight",
          "sports","outdoor","cinematic","travel","wind_resistant","stabilized",
          "360","gimbal","fpv",
        ]);
        const useCases = Array.isArray(args.useCases)
          ? Array.from(
              new Set(
                (args.useCases as unknown[])
                  .map((t) => String(t).trim().toLowerCase())
                  .filter((t) => t && ALLOWED_USECASES.has(t)),
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
                  .filter((s) => s && SUBTYPE_VALUES.has(s)),
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
        const ALLOWED_CAPABILITIES = new Set([
          "waterproof",
          "underwater",
          "rugged",
          "vlogging",
          "compact",
          "lowlight",
          "sports",
          "outdoor",
          "cinematic",
          "travel",
          "wind_resistant",
          "stabilized",
          "360",
          "gimbal",
          "fpv",
        ]);
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

        // Detect "accessories-only" intent from the most-recent user
        // message in history. When the shopper explicitly asked for
        // accessories, we drop flagship rows (cam_/drone_/gimbal_)
        // before they reach the renderer — runtime guard against the
        // model occasionally including a flagship row anyway.
        const isAccessoryOnlyIntent = (() => {
          for (let i = history.length - 1; i >= 0; i--) {
            const msg = history[i];
            if (
              msg.role === "user" &&
              typeof msg.content === "string"
            ) {
              return /\b(accessor(y|ies)|add[- ]ons?)\b/i.test(msg.content);
            }
          }
          return false;
        })();
        const FLAGSHIP_SUBTYPE_PREFIXES = ["cam_", "drone_", "gimbal_"];

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

          const capabilities = filterToVocab(r.capabilities, RAW_CAPABILITY_VALUES);
          const subtypes = filterToVocab(r.subtypes, SUBTYPE_VALUES);
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

          // Runtime accessory-only guard — when the shopper asked for
          // accessories, reject any row whose subtypes are dominated
          // by flagship product types (cam_/drone_/gimbal_). Mirrors
          // the prompt's ACCESSORIES-ONLY RULE so the renderer never
          // sees a "Waterproof Action Cameras" row in an accessory
          // listing.
          if (isAccessoryOnlyIntent && subtypes.length > 0) {
            const allFlagship = subtypes.every((s) =>
              FLAGSHIP_SUBTYPE_PREFIXES.some((prefix) => s.startsWith(prefix)),
            );
            if (allFlagship) continue;
          }

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
            productType: p.productType,
            accessoryRole: p.accessoryRole,
            compatibleWithType: p.compatibleWithType,
            compatibleWithModels: p.compatibleWithModels,
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
        return { ok: true, topic, text, source: DJI_HELP_CENTER_URL };
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

      const completion = await client.chat.completions.create({
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
