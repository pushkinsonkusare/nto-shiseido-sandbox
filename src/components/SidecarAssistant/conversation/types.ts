import type {
  AgentNBA,
  AgentPLPProduct,
  AgentPDPColorOption,
  AgentPDPSizeOption,
  AgentCartItem,
  AgentCartLineItem,
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
  | AgentPdpMessage
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
  colors?: AgentPDPColorOption[];
  sizes?: AgentPDPSizeOption[];
};

export type AgentCartMessage = {
  id: string;
  kind: "agent_cart";
  acknowledgement?: string;
  summary: string;
  items: AgentCartItem[];
  lineItems: AgentCartLineItem[];
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
};
