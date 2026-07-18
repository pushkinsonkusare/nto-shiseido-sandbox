/* =============================================================
 * Barrel export for the React components that live inside the
 * SidecarAssistant chat panel.  Each component matches a frame in
 * the Figma design system (Branch — INTERNAL — Storefront Future
 * Components).  See the individual component files for the matching
 * Figma node ids and prop documentation.
 * ============================================================= */

export {
  AgentSimpleUtterance,
  type AgentSimpleUtteranceCTA,
  type AgentSimpleUtteranceProps,
} from "./AgentSimpleUtterance";

export {
  AgentProductCard,
  AgentShowMoreCard,
  type AgentProductSwatch,
  type AgentProductCardProps,
  type AgentShowMoreCardProps,
} from "./AgentProductCard";

export {
  AgentPLPCard,
  type AgentPLPProduct,
  type AgentPLPCardProps,
} from "./AgentPLPCard";

export {
  AgentPDPCard,
  type AgentPDPColorOption,
  type AgentPDPSizeOption,
  type AgentPDPCardProps,
} from "./AgentPDPCard";

export {
  AgentCart,
  type AgentCartItem,
  type AgentCartLineItem,
  type AgentCartProps,
} from "./AgentCart";

export {
  AgentOrderSummary,
  type AgentOrderItem,
  type AgentOrderLineItem,
  type AgentOrderSummaryProps,
} from "./AgentOrderSummary";

export {
  AgentNBAs,
  type AgentNBA,
  type AgentNBAsProps,
} from "./AgentNBAs";

export {
  LatencyLoader,
  type LatencyLoaderVariant,
  type LatencyLoaderProps,
} from "./LatencyLoader";
