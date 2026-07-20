import type {
  AgentNBA,
  AgentPLPProduct,
  AgentPDPColorOption,
  AgentPDPSizeOption,
  AgentCartItem,
  AgentCartLineItem,
  AgentCompareColumn,
  AgentCompareRow,
  LatencyLoaderVariant,
} from "../components";
import type { NbaLane, NbaStage } from "./flow";

/* =============================================================
 * Conversation message types rendered inside the SidecarAssistant
 * chat panel.  Each shape is a discriminated union variant keyed
 * by `kind` so the renderer can switch over them exhaustively.
 * ============================================================= */

export type ChatMessage =
  | AgentSimpleMessage
  | ShopperTextMessage
  | AgentLoaderMessage
  | AgentPlpMessage
  | AgentRoutineMessage
  | AgentPdpMessage
  | AgentCompareMessage
  | AgentCartMessage
  | AgentOrderMessage
  | AgentNbasMessage;

export type AgentSimpleMessage = {
  id: string;
  kind: "agent_simple";
  title?: string;
  body: string;
  imageUrl?: string;
  imageAlt?: string;
  showBrandLogo?: boolean;
};

export type ShopperTextMessage = {
  id: string;
  kind: "shopper_text";
  text: string;
};

export type AgentLoaderMessage = {
  id: string;
  kind: "agent_loader";
  variant: LatencyLoaderVariant;
};

export type AgentPlpMessage = {
  id: string;
  kind: "agent_plp";
  intro: string;
  products: AgentPLPProduct[];
  /** When true, append the "Show more" tile at the end of the carousel. */
  showMoreCard: boolean;
  /** Ranked-but-not-yet-shown product slugs, paged in by "Show more". */
  remainingSlugs?: string[];
  /** The shopper's original query, used for the "Show more <term>" bubble. */
  searchTerm?: string;
};

/** One step of a broad-intent routine: a category header, a short
 * description, and a paged product carousel (5 + optional "Show more"). */
export type RoutineSection = {
  /** Ordinal step label, e.g. "1. Cleanse". */
  stepLabel: string;
  /** Human category title, e.g. "Cleansers". */
  categoryTitle: string;
  /** Catalog category name, used to page in more products on "Show more". */
  categoryKey: string;
  /** Concern/skin-type aware description shown under the heading. */
  description: string;
  /** Products currently shown in this section's carousel. */
  products: AgentPLPProduct[];
  /** When true, append the "Show more" tile to this section's carousel. */
  showMoreCard: boolean;
  /** Ranked-but-not-yet-shown slugs for this section, paged in by "Show more". */
  remainingSlugs?: string[];
};

/** A unified broad-intent "routine" card: one acknowledgement followed by
 * ordered category sections, each with its own carousel. */
export type AgentRoutineMessage = {
  id: string;
  kind: "agent_routine";
  acknowledgement: string;
  sections: RoutineSection[];
};

export type AgentPdpMessage = {
  id: string;
  kind: "agent_pdp";
  productSlug: string;
  images: { url: string; alt: string }[];
  title: string;
  price: string;
  comparePrice?: string;
  description?: string;
  rating?: number;
  reviewCount?: number;
  colors?: AgentPDPColorOption[];
  sizes?: AgentPDPSizeOption[];
};

export type AgentCompareMessage = {
  id: string;
  kind: "agent_compare";
  /** Body copy rendered above the comparison table. */
  intro: string;
  /** Products compared, one per table column. */
  columns: AgentCompareColumn[];
  /** Attribute rows, each with one value per column. */
  rows: AgentCompareRow[];
  /** Optional closing recommendation shown beneath the table. */
  recommendation?: string;
  /** Slug of the recommended product, bolded inside the recommendation copy. */
  recommendedSlug?: string;
};

export type AgentCartMessage = {
  id: string;
  kind: "agent_cart";
  acknowledgement?: string;
  summary: string;
  items: AgentCartItem[];
  lineItems: AgentCartLineItem[];
  cartCoupons?: string[];
  /** Internal: the promo applied to the cart, retained so totals can be
   * recomputed when the shopper changes quantities or removes items. */
  appliedPromo?: { code: string; fraction: number };
};

export type AgentOrderMessage = {
  id: string;
  kind: "agent_order";
  acknowledgement?: string;
  summary: string;
  items: AgentCartItem[];
  lineItems: AgentCartLineItem[];
};

export type AgentNbasMessage = {
  id: string;
  kind: "agent_nbas";
  nbas: AgentNBA[];
  /** When true, the NBA refresh affordance is rendered. */
  regenerateButton?: boolean;
  /** Conversation stage that produced this set, used for telemetry. */
  stage?: NbaStage | "welcome";
  /** Map of label -> semantic lane for telemetry attribution. */
  laneByLabel?: Record<string, NbaLane>;
  /** When true, this is a selected-product follow-up row: it routes through the
   * contextual pill handler and stays visible even while a product is selected
   * (it is exempt from the selection-suppression applied to normal NBA rows). */
  contextual?: boolean;
  /** For contextual follow-up rows: the product the pills are about, so they
   * resolve correctly even if the live selection has since changed/cleared. */
  productSlug?: string;
};
