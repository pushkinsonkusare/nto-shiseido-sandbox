import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCatalog } from "../../catalog/CatalogContext";
import {
  CloseIcon,
  EllipsisVerticalIcon,
  SendHorizontalIcon,
  SparkleIcon,
} from "../icons/StorefrontIcons";
import {
  AgentCart,
  AgentNBAs,
  AgentOrderSummary,
  AgentPDPCard,
  AgentPLPCard,
  AgentSimpleUtterance,
  LatencyLoader,
  type AgentNBA,
  type AgentCartItem,
  type AgentCartLineItem,
  type AgentPLPProduct,
} from "./components";
import {
  LANDING_NBA_SUCCESS_THRESHOLDS,
  ORDER_FOLLOWUP_NBAS,
  POLICY_BODIES,
  PROBING_FALLBACK_BODY,
  TRACK_ORDER_BODY,
  WELCOME_BODY,
  WELCOME_TITLE,
  buildStageNbas,
  buildWelcomeNbas,
  buildPlpIntro,
  classifyHygieneTopic,
  classifyIntent,
  filterProducts,
  findBundlesForIntent,
  findMatchingBundle,
  getLandingNbaLane,
  pickRecommendations,
  type HygieneTopic,
  type Intent,
  type NbaLane,
  type NbaStage,
  type StageNbaItem,
} from "./conversation/flow";
import type { ChatMessage } from "./conversation/types";
import type { CatalogProduct } from "../../catalog/catalog";
import { createOpenAIAgent, type AgentAction, type OpenAIAgent } from "./agent/openaiAgent";
import { isLlmConfigured } from "../../lib/openaiClient";
import "./SidecarAssistant.css";

const PLACEHOLDER_INPUT =
  "Ask anything about DJI gear, orders, or recommendations…";

const NUDGE_INTERVAL_MS = 90_000;
const NUDGE_DURATION_MS = 2500;

const RESPONSE_LATENCY_MS = 1200;
const TALL_CARD_VIEWPORT_RATIO = 0.92;
const TALL_CARD_ANCHOR_RATIO = 0.6;
const TALL_CARD_TOP_INSET_PX = 16;
const TALL_CARD_SETTLE_TIMEOUT_MS = 140;

let messageIdCounter = 0;
function nextId(prefix: string) {
  messageIdCounter += 1;
  return `${prefix}-${messageIdCounter}`;
}

/** Format a number as a USD currency string (used for promo math). */
const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

function toPlpProduct(
  product: CatalogProduct,
  onSelect: (slug: string) => void,
): AgentPLPProduct {
  return {
    id: product.slug,
    imageUrl: product.imageUrl,
    imageAlt: product.imageAlt,
    title: product.title,
    price: product.priceFormatted,
    description: product.shortDescription,
    rating: product.rating ?? undefined,
    swatches: product.swatches.map((color) => ({ color })),
    badgeLabel: product.badgeLabel,
    onSelect: () => onSelect(product.slug),
  };
}

function toCartItem(product: CatalogProduct, quantity: number): AgentCartItem {
  return {
    id: `cart-${product.slug}`,
    imageUrl: product.imageUrl,
    imageAlt: product.imageAlt,
    title: product.title,
    meta: [`Brand: ${product.brand}`, `Category: ${product.category}`],
    price: product.priceFormatted,
    quantity,
  };
}

function buildCartLineItems(
  product: CatalogProduct,
  quantity: number,
  promoDiscount = 0,
): AgentCartLineItem[] {
  const subtotal = (product.price ?? 0) * quantity;
  const items: AgentCartLineItem[] = [
    { label: `Subtotal (${quantity} item${quantity === 1 ? "" : "s"})`, value: usd.format(subtotal) },
  ];

  if (promoDiscount > 0) {
    items.push({ label: "Promo discount", value: `-${usd.format(promoDiscount)}` });
  }

  items.push({ label: "Shipping", value: "Calculated at checkout" });
  items.push({
    label: "Estimated total",
    value: usd.format(Math.max(0, subtotal - promoDiscount)),
    emphasis: true,
  });
  return items;
}

function buildNbasMessage(
  labels: ReadonlyArray<string>,
  regenerateButton = true,
  options: {
    stage?: NbaStage | "welcome";
    laneByLabel?: Record<string, NbaLane>;
    idPrefix?: string;
  } = {},
): ChatMessage {
  return {
    id: nextId("nbas"),
    kind: "agent_nbas",
    regenerateButton,
    stage: options.stage,
    laneByLabel: options.laneByLabel,
    nbas: buildNbaItems(labels, options.idPrefix ?? "nba"),
  };
}

function buildStageNbasMessage(
  stage: NbaStage,
  items: StageNbaItem[],
  regenerateButton = true,
): ChatMessage {
  const labels = items.map((item) => item.label);
  const laneByLabel = items.reduce<Record<string, NbaLane>>((acc, item) => {
    acc[item.label] = item.lane;
    return acc;
  }, {});
  return buildNbasMessage(labels, regenerateButton, {
    stage,
    laneByLabel,
    idPrefix: `nba-${stage}`,
  });
}

function buildNbaItems(labels: ReadonlyArray<string>, idPrefix = "nba"): AgentNBA[] {
  return labels.map((label) => ({
    id: `${idPrefix}-${label.replace(/\W+/g, "-").toLowerCase()}-${nextId("nba")}`,
    label,
  }));
}

function emitAssistantTelemetry(event: string, payload: Record<string, unknown>) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("agentic:assistant-telemetry", {
      detail: { event, payload, ts: Date.now() },
    }),
  );
}

function buildOrderLineItems(
  product: CatalogProduct,
  quantity: number,
  promoDiscount = 0,
): AgentCartLineItem[] {
  const subtotal = (product.price ?? 0) * quantity;
  const shipping = 0;
  const tax = Math.round(subtotal * 0.0875 * 100) / 100;
  const total = Math.max(0, subtotal - promoDiscount) + shipping + tax;

  const items: AgentCartLineItem[] = [
    { label: `Subtotal (${quantity} item${quantity === 1 ? "" : "s"})`, value: usd.format(subtotal) },
  ];
  if (promoDiscount > 0) {
    items.push({ label: "Promo discount", value: `-${usd.format(promoDiscount)}` });
  }
  items.push({ label: "Shipping", value: "Free" });
  items.push({ label: "Tax", value: usd.format(tax) });
  items.push({ label: "Total paid", value: usd.format(total), emphasis: true });
  return items;
}

type AgentRuntimeError = {
  status?: number;
  code?: string;
  type?: string;
  message?: string;
  error?: {
    code?: string;
    type?: string;
    message?: string;
  };
};

function buildAgentFailureMessage(error: unknown): string {
  const runtimeError = error as AgentRuntimeError | undefined;
  const errorCode = runtimeError?.code ?? runtimeError?.error?.code ?? "";
  const errorType = runtimeError?.type ?? runtimeError?.error?.type ?? "";
  const status = runtimeError?.status;

  if (errorCode === "insufficient_quota" || errorType === "insufficient_quota") {
    return "I couldn't reach OpenAI because this API key is out of quota — falling back to local recommendations.";
  }

  if (status === 401 || errorCode === "invalid_api_key" || errorType === "authentication_error") {
    return "I couldn't reach OpenAI because the API key is invalid or unauthorized — falling back to local recommendations.";
  }

  if (errorCode === "model_not_found") {
    return `I couldn't reach OpenAI because model "${OPENAI_MODEL}" isn't available for this key — falling back to local recommendations.`;
  }

  return "I hit a hiccup reaching the model — falling back to local recommendations.";
}

export function SidecarAssistant() {
  const { products, heroProduct, getProductBySlug, orderHistory } = useCatalog();
  const [isOpen, setIsOpen] = useState(false);
  const [hasUserOpenedFab, setHasUserOpenedFab] = useState(false);
  const [isNudging, setIsNudging] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [welcomeRefreshCount, setWelcomeRefreshCount] = useState(0);

  const chatRef = useRef<HTMLDivElement>(null);
  const previousMessageIdsRef = useRef<string[]>([]);
  const panelRef = useRef<HTMLElement>(null);
  const pendingTimeouts = useRef<number[]>([]);
  const messagesRef = useRef<ChatMessage[]>([]);
  const welcomeNbasMessageIdRef = useRef<string | null>(null);
  const firstShopperTurnHandledRef = useRef(false);
  const lastStageNbaClickRef = useRef<{
    stage: NbaStage | "welcome";
    lane?: NbaLane;
    label: string;
  } | null>(null);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  /* ---------- mutation helpers ---------- */

  const appendMessage = useCallback((message: ChatMessage) => {
    setMessages((current) => {
      // Only ever show the most recent NBA set: when a new one is appended,
      // drop any prior NBA sets so historical ones don't accumulate in the
      // scrollback or remain interactive after the conversation has moved on.
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
    setMessages((current) => current.filter((message) => message.id !== id));
  }, []);

  const updateMessage = useCallback(
    (id: string, updater: (message: ChatMessage) => ChatMessage) => {
      setMessages((current) =>
        current.map((message) => (message.id === id ? updater(message) : message)),
      );
    },
    [],
  );

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

  /* ---------- pure render helpers (no shopper-text / loader prefix) ---------- */

  const renderPdpCard = useCallback(
    (slug: string) => {
      const product = getProductBySlug(slug);
      if (!product) return;
      appendMessage({
        id: nextId("pdp"),
        kind: "agent_pdp",
        productSlug: product.slug,
        images:
          product.gallery.length > 0
            ? product.gallery.map((url) => ({ url, alt: product.imageAlt }))
            : [{ url: product.imageUrl, alt: product.imageAlt }],
        title: product.title,
        price: product.priceFormatted,
        description: product.shortDescription,
        colors: product.swatches.slice(0, 3).map((color, index) => ({
          id: `color-${index}`,
          label: index === 0 ? "Default" : `Variant ${index + 1}`,
          color,
        })),
      });
    },
    [appendMessage, getProductBySlug],
  );

  const renderCartCard = useCallback(
    (slug: string, quantity: number): string | undefined => {
      const product = getProductBySlug(slug);
      if (!product) return undefined;
      const id = nextId("cart");
      const subtotal = (product.price ?? 0) * quantity;
      appendMessage({
        id,
        kind: "agent_cart",
        acknowledgement: `Got it — I added ${product.title} to your cart.`,
        summary: `Your cart has ${quantity} item${quantity === 1 ? "" : "s"} with a subtotal of ${usd.format(subtotal)}.`,
        items: [toCartItem(product, quantity)],
        lineItems: buildCartLineItems(product, quantity),
      });
      return id;
    },
    [appendMessage, getProductBySlug],
  );

  const renderRecentOrderSummary = useCallback(() => {
    const latestOrder = orderHistory[0];
    if (!latestOrder) {
      appendMessage({
        id: nextId("agent"),
        kind: "agent_simple",
        title: "Order tracking",
        body: "I couldn't find a recent order yet. Share an order ID and I'll check status.",
      });
      return;
    }

    const items = latestOrder.productSlugs
      .map((slug) => getProductBySlug(slug))
      .filter((product): product is CatalogProduct => Boolean(product))
      .slice(0, 2)
      .map((product) => toCartItem(product, 1));

    appendMessage({
      id: nextId("order"),
      kind: "agent_order",
      acknowledgement: `Order ${latestOrder.id} is ${latestOrder.status.toLowerCase()}.`,
      summary: TRACK_ORDER_BODY,
      items,
      lineItems: [
        { label: "Order ID", value: latestOrder.id },
        { label: "Status", value: latestOrder.status },
        { label: "Payment", value: latestOrder.paymentMethod },
        { label: "Order total", value: latestOrder.total, emphasis: true },
      ],
    });
  }, [appendMessage, getProductBySlug, orderHistory]);

  const applyPromoToCart = useCallback(
    (cartMessageId: string, code: string) => {
      const trimmed = code.trim().toUpperCase();
      if (!trimmed) return;

      const PROMO_DB: Record<string, { discount: number; label: string }> = {
        FLY10: { discount: 0.1, label: "10% off" },
        DJI20: { discount: 0.2, label: "20% off" },
      };

      const promo = PROMO_DB[trimmed];
      if (!promo) {
        appendMessage({
          id: nextId("agent"),
          kind: "agent_simple",
          body: `I couldn't find a promo named "${trimmed}". Try FLY10 or DJI20.`,
        });
        return;
      }

      let discountAmount = 0;
      updateMessage(cartMessageId, (message) => {
        if (message.kind !== "agent_cart") return message;
        const subtotal = message.items.reduce((sum, item) => {
          const price = Number(item.price.replace(/[^0-9.]/g, "")) || 0;
          return sum + price * item.quantity;
        }, 0);
        discountAmount = Math.round(subtotal * promo.discount * 100) / 100;
        const product = getProductBySlug(message.items[0]?.id.replace(/^cart-/, ""));
        if (!product) return message;
        return {
          ...message,
          lineItems: buildCartLineItems(product, message.items[0].quantity, discountAmount),
          summary: `Promo applied — your new estimated total is ${usd.format(Math.max(0, subtotal - discountAmount))}.`,
        };
      });

      appendMessage({
        id: nextId("agent"),
        kind: "agent_simple",
        body: `Nice! Promo "${trimmed}" applied (${promo.label}). You saved ${usd.format(discountAmount)}.`,
      });
    },
    [appendMessage, getProductBySlug, updateMessage],
  );

  const runCheckoutFlow = useCallback(
    (cartMessageId: string) => {
      const cart = messagesRef.current.find((m) => m.id === cartMessageId);
      if (!cart || cart.kind !== "agent_cart") return;

      const paymentLoaderId = nextId("loader");
      appendMessage({ id: paymentLoaderId, kind: "agent_loader", variant: "fetching_payment" });

      scheduleResponse(() => {
        removeMessage(paymentLoaderId);
        const completingId = nextId("loader");
        appendMessage({ id: completingId, kind: "agent_loader", variant: "completing_order" });

        scheduleResponse(() => {
          removeMessage(completingId);

          const firstItem = cart.items[0];
          const product = firstItem ? getProductBySlug(firstItem.id.replace(/^cart-/, "")) : undefined;
          if (!product || !firstItem) return;

          const subtotal = (product.price ?? 0) * firstItem.quantity;
          const tax = Math.round(subtotal * 0.0875 * 100) / 100;
          const total = subtotal + tax;
          const orderNumber = `DJI-${Math.floor(40000 + Math.random() * 9999)}`;

          appendMessage({
            id: nextId("order"),
            kind: "agent_order",
            acknowledgement: `Your order is confirmed! Order #${orderNumber}.`,
            summary: `Your new ${product.title} will arrive in 2-4 business days. Total: ${usd.format(total)}.`,
            items: cart.items,
            lineItems: buildOrderLineItems(product, firstItem.quantity),
          });

          const orderItems = buildStageNbas({
            stage: "order",
            orderProducts: [product],
            matchingBundle: findMatchingBundle(product, products),
            catalog: products,
          });
          appendMessage(buildStageNbasMessage("order", orderItems));
          emitAssistantTelemetry("nba_impression", {
            stage: "order",
            labels: orderItems.map((item) => item.label),
            lanes: orderItems.map((item) => item.lane),
          });

          const lastClick = lastStageNbaClickRef.current;
          if (lastClick) {
            emitAssistantTelemetry("nba_conversion", {
              conversion: "checkout",
              fromStage: lastClick.stage,
              fromLane: lastClick.lane,
              fromLabel: lastClick.label,
              productSlug: product.slug,
            });
            lastStageNbaClickRef.current = null;
          }
        }, 1500);
      });
    },
    [appendMessage, getProductBySlug, removeMessage, scheduleResponse],
  );

  /* ---------- user-facing handlers (rule-based path) ---------- */

  const handleProductSelect = useCallback(
    (slug: string) => {
      const product = getProductBySlug(slug);
      if (!product) return;

      appendMessage({
        id: nextId("shopper"),
        kind: "shopper_text",
        text: `Tell me more about the ${product.title}`,
      });
      const loaderId = nextId("loader");
      appendMessage({ id: loaderId, kind: "agent_loader", variant: "answering" });

      scheduleResponse(() => {
        removeMessage(loaderId);
        renderPdpCard(slug);
        const items = buildStageNbas({
          stage: "pdp",
          product,
          matchingBundle: findMatchingBundle(product, products),
          catalog: products,
        });
        const nbasMessage = buildStageNbasMessage("pdp", items);
        appendMessage(nbasMessage);
        emitAssistantTelemetry("nba_impression", {
          stage: "pdp",
          labels: items.map((item) => item.label),
          lanes: items.map((item) => item.lane),
        });
      });
    },
    [appendMessage, getProductBySlug, removeMessage, renderPdpCard, scheduleResponse],
  );

  const renderPlpCard = useCallback(
    (intro: string, slugs: string[], showMoreCard: boolean) => {
      const valid = slugs
        .map((slug) => getProductBySlug(slug))
        .filter((p): p is CatalogProduct => Boolean(p));
      if (valid.length === 0) return;
      appendMessage({
        id: nextId("plp"),
        kind: "agent_plp",
        intro,
        products: valid.map((p) => toPlpProduct(p, handleProductSelect)),
        showMoreCard,
      });
    },
    [appendMessage, getProductBySlug, handleProductSelect],
  );

  const handleAddToCart = useCallback(
    (slug: string, quantity: number) => {
      const product = getProductBySlug(slug);
      if (!product) return;

      appendMessage({
        id: nextId("shopper"),
        kind: "shopper_text",
        text: `Add ${quantity} × ${product.title} to my cart`,
      });
      const loaderId = nextId("loader");
      appendMessage({ id: loaderId, kind: "agent_loader", variant: "thinking" });

      const lastClick = lastStageNbaClickRef.current;
      if (lastClick) {
        emitAssistantTelemetry("nba_conversion", {
          conversion: "add_to_cart",
          fromStage: lastClick.stage,
          fromLane: lastClick.lane,
          fromLabel: lastClick.label,
          productSlug: slug,
        });
        lastStageNbaClickRef.current = null;
      }

      scheduleResponse(() => {
        removeMessage(loaderId);
        renderCartCard(slug, quantity);
        const items = buildStageNbas({
          stage: "cart",
          cartProducts: [product],
          matchingBundle: findMatchingBundle(product, products),
          catalog: products,
        });
        const nbasMessage = buildStageNbasMessage("cart", items);
        appendMessage(nbasMessage);
        emitAssistantTelemetry("nba_impression", {
          stage: "cart",
          labels: items.map((item) => item.label),
          lanes: items.map((item) => item.lane),
        });
      });
    },
    [appendMessage, getProductBySlug, products, removeMessage, renderCartCard, scheduleResponse],
  );

  const handleApplyPromo = useCallback(
    (cartMessageId: string, code: string) => {
      const trimmed = code.trim().toUpperCase();
      if (!trimmed) return;

      appendMessage({
        id: nextId("shopper"),
        kind: "shopper_text",
        text: `Apply promo code ${trimmed}`,
      });

      const loaderId = nextId("loader");
      appendMessage({ id: loaderId, kind: "agent_loader", variant: "thinking" });

      scheduleResponse(() => {
        removeMessage(loaderId);
        applyPromoToCart(cartMessageId, trimmed);
      });
    },
    [appendMessage, applyPromoToCart, removeMessage, scheduleResponse],
  );

  const handleCheckout = useCallback(
    (cartMessageId: string) => {
      appendMessage({
        id: nextId("shopper"),
        kind: "shopper_text",
        text: "Pay with Apple Pay",
      });
      runCheckoutFlow(cartMessageId);
    },
    [appendMessage, runCheckoutFlow],
  );

  /* ---------- OpenAI agent (optional) ---------- */

  const agentRef = useRef<OpenAIAgent | null>(null);
  if (agentRef.current === null && isLlmConfigured()) {
    agentRef.current = createOpenAIAgent({
      products,
      getProductBySlug: (slug) => getProductBySlug(slug),
    });
  }

  const findLatestCartId = useCallback((): string | undefined => {
    const list = messagesRef.current;
    for (let i = list.length - 1; i >= 0; i -= 1) {
      if (list[i].kind === "agent_cart") return list[i].id;
    }
    return undefined;
  }, []);

  const applyAgentActions = useCallback(
    (actions: AgentAction[]) => {
      const sawSuggestNbas = actions.some((a) => a.type === "suggest_nbas");
      let lastPlpSlugs: string[] | undefined;
      let lastPdpProduct: CatalogProduct | undefined;
      let lastCartProduct: CatalogProduct | undefined;

      for (const action of actions) {
        switch (action.type) {
          case "say":
            appendMessage({
              id: nextId("agent"),
              kind: "agent_simple",
              title: action.title,
              body: action.text,
            });
            break;
          case "show_product_listing":
            renderPlpCard(
              action.intro,
              action.productSlugs,
              Boolean(action.showMoreCard),
            );
            lastPlpSlugs = action.productSlugs;
            break;
          case "show_product_detail":
            renderPdpCard(action.productSlug);
            lastPdpProduct = getProductBySlug(action.productSlug);
            break;
          case "add_to_cart":
            renderCartCard(action.productSlug, action.quantity);
            lastCartProduct = getProductBySlug(action.productSlug);
            break;
          case "apply_promo": {
            const cartId = findLatestCartId();
            if (cartId) applyPromoToCart(cartId, action.code);
            break;
          }
          case "checkout": {
            const cartId = findLatestCartId();
            if (cartId) runCheckoutFlow(cartId);
            break;
          }
          case "suggest_nbas":
            appendMessage(buildNbasMessage(action.labels));
            break;
        }
      }

      // Defensive default: if the agent emitted a stage-changing content action
      // but skipped `suggest_nbas`, fall back to stage-aware NBAs so the shopper
      // always has follow-up chips. The order/checkout flow appends its own
      // NBAs from inside `runCheckoutFlow`, so we don't double-emit there.
      if (sawSuggestNbas) return;

      if (lastCartProduct) {
        const items = buildStageNbas({
          stage: "cart",
          cartProducts: [lastCartProduct],
          matchingBundle: findMatchingBundle(lastCartProduct, products),
          catalog: products,
        });
        appendMessage(buildStageNbasMessage("cart", items));
        emitAssistantTelemetry("nba_impression", {
          stage: "cart",
          labels: items.map((item) => item.label),
          lanes: items.map((item) => item.lane),
        });
        return;
      }

      if (lastPdpProduct) {
        const items = buildStageNbas({
          stage: "pdp",
          product: lastPdpProduct,
          matchingBundle: findMatchingBundle(lastPdpProduct, products),
          catalog: products,
        });
        appendMessage(buildStageNbasMessage("pdp", items));
        emitAssistantTelemetry("nba_impression", {
          stage: "pdp",
          labels: items.map((item) => item.label),
          lanes: items.map((item) => item.lane),
        });
        return;
      }

      if (lastPlpSlugs) {
        // Re-derive intent from the latest shopper message so the chips are
        // tuned to whatever the shopper just asked for.
        let latestShopperText = "";
        for (let i = messagesRef.current.length - 1; i >= 0; i -= 1) {
          const m = messagesRef.current[i];
          if (m.kind === "shopper_text") {
            latestShopperText = m.text;
            break;
          }
        }
        const intent = classifyIntent(latestShopperText);
        const items = buildStageNbas({
          stage: "plp",
          intent,
          matchCount: lastPlpSlugs.length,
          bundleProducts: findBundlesForIntent(intent, products),
        });
        appendMessage(buildStageNbasMessage("plp", items));
        emitAssistantTelemetry("nba_impression", {
          stage: "plp",
          labels: items.map((item) => item.label),
          lanes: items.map((item) => item.lane),
        });
      }
    },
    [
      appendMessage,
      applyPromoToCart,
      findLatestCartId,
      getProductBySlug,
      products,
      renderCartCard,
      renderPdpCard,
      renderPlpCard,
      runCheckoutFlow,
    ],
  );

  /* ---------- shopper input + dispatch ---------- */

  const dispatchRuleBasedResponse = useCallback(
    (trimmed: string) => {
      const intent = classifyIntent(trimmed);
      const isOrderTrackingIntent =
        /\b(track|tracking|where\s+is|order\s+status|recent\s+order)\b/i.test(trimmed) &&
        /\border\b/i.test(trimmed);

      const hygieneTopic = classifyHygieneTopic(trimmed);
      if (hygieneTopic) {
        const HYGIENE_TITLE: Record<HygieneTopic, string> = {
          return: "Returns & refunds",
          replacement: "Replacement service",
          warranty: "Warranty & repair",
          shipping: "Shipping & delivery",
        };
        appendMessage({
          id: nextId("agent"),
          kind: "agent_simple",
          title: HYGIENE_TITLE[hygieneTopic],
          body: POLICY_BODIES[hygieneTopic],
        });
        appendMessage(buildNbasMessage(buildWelcomeNbas(0)));
        return;
      }

      if (isOrderTrackingIntent) {
        renderRecentOrderSummary();
        appendMessage(buildNbasMessage(ORDER_FOLLOWUP_NBAS));
        return;
      }

      if (intent.kind === "broad" || intent.kind === "empty") {
        appendMessage({
          id: nextId("agent"),
          kind: "agent_simple",
          body: PROBING_FALLBACK_BODY,
        });
        const probingItems = buildStageNbas({ stage: "probing", intent });
        appendMessage(buildStageNbasMessage("probing", probingItems));
        emitAssistantTelemetry("nba_impression", {
          stage: "probing",
          labels: probingItems.map((item) => item.label),
          lanes: probingItems.map((item) => item.lane),
        });
        return;
      }

      const matches = filterProducts(intent, products);
      const recs = pickRecommendations(matches, 5, intent);

      if (recs.length === 0) {
        appendMessage({
          id: nextId("agent"),
          kind: "agent_simple",
          body: "I couldn't find an exact match — let's narrow that down. What matters most to you?",
        });
        const probingItems = buildStageNbas({ stage: "probing", intent });
        appendMessage(buildStageNbasMessage("probing", probingItems));
        emitAssistantTelemetry("nba_impression", {
          stage: "probing",
          labels: probingItems.map((item) => item.label),
          lanes: probingItems.map((item) => item.lane),
        });
        return;
      }

      renderPlpCard(
        buildPlpIntro(trimmed, intent, recs.length),
        recs.map((p) => p.slug),
        matches.length > recs.length,
      );
      const plpItems = buildStageNbas({
        stage: "plp",
        intent,
        matchCount: matches.length,
        bundleProducts: findBundlesForIntent(intent, products),
      });
      appendMessage(buildStageNbasMessage("plp", plpItems));
      emitAssistantTelemetry("nba_impression", {
        stage: "plp",
        labels: plpItems.map((item) => item.label),
        lanes: plpItems.map((item) => item.lane),
      });
    },
    [appendMessage, products, renderPlpCard, renderRecentOrderSummary],
  );

  const dispatchShopperMessage = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      appendMessage({ id: nextId("shopper"), kind: "shopper_text", text: trimmed });

      const loaderId = nextId("loader");
      appendMessage({ id: loaderId, kind: "agent_loader", variant: "answering" });

      if (!firstShopperTurnHandledRef.current) {
        firstShopperTurnHandledRef.current = true;
        scheduleResponse(() => {
          removeMessage(loaderId);
          dispatchRuleBasedResponse(trimmed);
        });
        return;
      }

      const agent = agentRef.current;
      if (agent) {
        agent
          .respond(trimmed)
          .then((actions) => {
            removeMessage(loaderId);

            // Enforce deterministic UI flow: ignore free-form model chatter and
            // only honor structured actions that map to designed cards/controls.
            const structuredActions = actions.filter((action) => action.type !== "say");
            if (structuredActions.length === 0) {
              dispatchRuleBasedResponse(trimmed);
              return;
            }
            applyAgentActions(structuredActions);
          })
          .catch((error) => {
            console.error("[SidecarAssistant] OpenAI agent failed", error);
            removeMessage(loaderId);
            appendMessage({
              id: nextId("agent"),
              kind: "agent_simple",
              body: buildAgentFailureMessage(error),
            });
            dispatchRuleBasedResponse(trimmed);
          });
        return;
      }

      scheduleResponse(() => {
        removeMessage(loaderId);
        dispatchRuleBasedResponse(trimmed);
      });
    },
    [
      appendMessage,
      applyAgentActions,
      dispatchRuleBasedResponse,
      removeMessage,
      scheduleResponse,
    ],
  );

  const handleNbaSelect = useCallback(
    (messageId: string, label: string) => {
      if (messageId === welcomeNbasMessageIdRef.current) {
        const lane = getLandingNbaLane(label);
        emitAssistantTelemetry("landing_nba_click", {
          label,
          lane,
          refreshCount: welcomeRefreshCount,
        });
        lastStageNbaClickRef.current = { stage: "welcome", lane: undefined, label };
      } else {
        const parent = messagesRef.current.find((m) => m.id === messageId);
        if (parent?.kind === "agent_nbas" && parent.stage && parent.stage !== "welcome") {
          const lane = parent.laneByLabel?.[label];
          emitAssistantTelemetry("nba_click", {
            stage: parent.stage,
            lane,
            label,
          });
          lastStageNbaClickRef.current = { stage: parent.stage, lane, label };
        }
      }
      removeMessage(messageId);
      dispatchShopperMessage(label);
    },
    [dispatchShopperMessage, removeMessage, welcomeRefreshCount],
  );

  const handleNbaRegenerate = useCallback(
    (messageId: string) => {
      if (messageId !== welcomeNbasMessageIdRef.current) {
        return;
      }

      setWelcomeRefreshCount((current) => {
        const next = current + 1;
        const labels = buildWelcomeNbas(next);
        updateMessage(messageId, (message) => {
          if (message.kind !== "agent_nbas") return message;
          return {
            ...message,
            nbas: buildNbaItems(labels, "nba-welcome"),
          };
        });
        emitAssistantTelemetry("landing_nba_refresh", {
          refreshCount: next,
          labels,
        });
        return next;
      });
    },
    [updateMessage],
  );

  /* ---------- lifecycle ---------- */

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isOpen]);

  // Lock background page scroll while the sidecar panel is open.
  useEffect(() => {
    if (!isOpen) return;
    const previousBodyOverflow = document.body.style.overflow;
    const previousDocumentOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousDocumentOverflow;
    };
  }, [isOpen]);

  // Close the sidecar when the shopper clicks outside the panel.
  useEffect(() => {
    if (!isOpen) return;
    const onPointerDownCapture = (event: PointerEvent) => {
      const panel = panelRef.current;
      if (!panel) return;
      const path = event.composedPath?.() ?? [];
      const clickedInsidePanel =
        path.includes(panel) ||
        (event.target instanceof Node && panel.contains(event.target));
      if (!clickedInsidePanel) {
        setIsOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDownCapture, true);
    return () =>
      document.removeEventListener("pointerdown", onPointerDownCapture, true);
  }, [isOpen]);

  useEffect(() => {
    const onOpenRequested = () => setIsOpen(true);
    document.addEventListener("agentic:open-assistant", onOpenRequested);
    return () =>
      document.removeEventListener("agentic:open-assistant", onOpenRequested);
  }, []);

  useEffect(() => {
    const onAskRequested = (event: Event) => {
      const detail = (event as CustomEvent<{ prompt?: string }>).detail;
      const prompt = detail?.prompt?.trim();
      if (!prompt) return;
      setIsOpen(true);
      // Defer one frame so the open-driven welcome seeding effect commits
      // first; otherwise the seeding clobbers the shopper turn we're about
      // to enqueue.
      window.requestAnimationFrame(() => dispatchShopperMessage(prompt));
    };
    document.addEventListener("agentic:ask-assistant", onAskRequested);
    return () =>
      document.removeEventListener("agentic:ask-assistant", onAskRequested);
  }, [dispatchShopperMessage]);

  useEffect(() => {
    if (isOpen || hasUserOpenedFab) return;

    const prefersReducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (prefersReducedMotion) return;

    let collapseTimer: number | undefined;
    const intervalId = window.setInterval(() => {
      setIsNudging(true);
      collapseTimer = window.setTimeout(() => {
        setIsNudging(false);
      }, NUDGE_DURATION_MS);
    }, NUDGE_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
      if (collapseTimer) window.clearTimeout(collapseTimer);
      setIsNudging(false);
    };
  }, [isOpen, hasUserOpenedFab]);

  // Seed the welcome card the first time the panel opens.
  useEffect(() => {
    if (!isOpen) return;
    if (messages.length > 0) return;
    const welcomeLabels = buildWelcomeNbas(0);
    const welcomeNbasId = nextId("nbas");
    welcomeNbasMessageIdRef.current = welcomeNbasId;
    setWelcomeRefreshCount(0);
    firstShopperTurnHandledRef.current = false;
    setMessages([
      {
        id: nextId("welcome"),
        kind: "agent_simple",
        title: WELCOME_TITLE,
        body: WELCOME_BODY,
        imageUrl: "/Welcome_cover.jpeg",
        imageAlt: "Welcome to the DJI store",
      },
      {
        id: welcomeNbasId,
        kind: "agent_nbas",
        regenerateButton: true,
        nbas: buildNbaItems(welcomeLabels, "nba-welcome"),
      },
    ]);
    emitAssistantTelemetry("landing_nba_impression", {
      labels: welcomeLabels,
      refreshCount: 0,
      thresholds: LANDING_NBA_SUCCESS_THRESHOLDS,
    });
  }, [isOpen, messages.length]);

  // Hybrid auto-scroll:
  // - Small new cards stay bottom-oriented.
  // - Tall new card blocks reveal from their top edge.
  useEffect(() => {
    const node = chatRef.current;
    if (!node) return;
    const currentIds = messages.map((message) => message.id);
    const previousIds = previousMessageIdsRef.current;
    let commonPrefix = 0;
    while (
      commonPrefix < previousIds.length &&
      commonPrefix < currentIds.length &&
      previousIds[commonPrefix] === currentIds[commonPrefix]
    ) {
      commonPrefix += 1;
    }

    const appendedCount = currentIds.length - commonPrefix;
    if (appendedCount <= 0) {
      previousMessageIdsRef.current = currentIds;
      return;
    }

    const children = Array.from(node.children) as HTMLElement[];
    const appendedNodes = children.slice(-appendedCount);
    if (appendedNodes.length === 0) {
      previousMessageIdsRef.current = currentIds;
      return;
    }

    const viewportHeight = node.clientHeight;
    const appendedBlockHeight = appendedNodes.reduce(
      (total, child) => total + child.offsetHeight,
      0,
    );
    const hasTallCard = appendedNodes.some(
      (child) => child.offsetHeight > viewportHeight * TALL_CARD_VIEWPORT_RATIO,
    );

    const cleanupFns: Array<() => void> = [];

    if (hasTallCard || appendedBlockHeight > viewportHeight * TALL_CARD_VIEWPORT_RATIO) {
      // Regression guard:
      // Tall cards must start from chatTop + 16px so card headers are not hidden
      // under the assistant header (especially on mobile Safari after image reflow).
      const anchorNode =
        appendedNodes.find((child) => child.offsetHeight > viewportHeight * TALL_CARD_ANCHOR_RATIO) ??
        appendedNodes[0];
      const alignTallAnchor = () => {
        const chatRect = node.getBoundingClientRect();
        const anchorRect = anchorNode.getBoundingClientRect();
        const topTarget = Math.max(
          0,
          node.scrollTop + (anchorRect.top - chatRect.top) - TALL_CARD_TOP_INSET_PX,
        );
        node.scrollTo({ top: topTarget, behavior: "auto" });
      };

      alignTallAnchor();
      const rafA = window.requestAnimationFrame(alignTallAnchor);
      const rafB = window.requestAnimationFrame(() => {
        window.requestAnimationFrame(alignTallAnchor);
      });
      const timeoutId = window.setTimeout(alignTallAnchor, TALL_CARD_SETTLE_TIMEOUT_MS);
      cleanupFns.push(() => window.cancelAnimationFrame(rafA));
      cleanupFns.push(() => window.cancelAnimationFrame(rafB));
      cleanupFns.push(() => window.clearTimeout(timeoutId));

      const mediaNodes = Array.from(anchorNode.querySelectorAll("img"));
      for (const media of mediaNodes) {
        if (media.complete) continue;
        const onMediaSettled = () => alignTallAnchor();
        media.addEventListener("load", onMediaSettled);
        media.addEventListener("error", onMediaSettled);
        cleanupFns.push(() => media.removeEventListener("load", onMediaSettled));
        cleanupFns.push(() => media.removeEventListener("error", onMediaSettled));
      }
    } else {
      node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
    }

    previousMessageIdsRef.current = currentIds;
    return () => {
      cleanupFns.forEach((cleanup) => cleanup());
    };
  }, [messages]);

  // Clear pending response timers on unmount / close.
  useEffect(() => {
    return () => {
      pendingTimeouts.current.forEach((id) => window.clearTimeout(id));
      pendingTimeouts.current = [];
    };
  }, []);

  const handleFabClick = () => {
    setHasUserOpenedFab(true);
    setIsNudging(false);
    setIsOpen(true);
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = inputValue.trim();
    if (!value) return;
    setInputValue("");
    dispatchShopperMessage(value);
  };

  /* ---------- render ---------- */

  const renderedMessages = useMemo(
    () =>
      messages.map((message) => {
        switch (message.kind) {
          case "agent_simple":
            return (
              <AgentSimpleUtterance
                key={message.id}
                title={message.title}
                body={message.body}
                imageUrl={message.imageUrl}
                imageAlt={message.imageAlt ?? ""}
              />
            );
          case "shopper_text":
            return (
              <div key={message.id} className="sidecar-assistant__user-row">
                <div className="sidecar-assistant__user-bubble">{message.text}</div>
              </div>
            );
          case "agent_loader":
            return <LatencyLoader key={message.id} variant={message.variant} />;
          case "agent_plp":
            return (
              <AgentPLPCard
                key={message.id}
                intro={message.intro}
                products={message.products}
                showMoreCard={message.showMoreCard}
              />
            );
          case "agent_pdp":
            return (
              <AgentPDPCard
                key={message.id}
                images={message.images}
                title={message.title}
                price={message.price}
                comparePrice={message.comparePrice}
                description={message.description}
                colors={message.colors}
                sizes={message.sizes}
                onAddToCart={({ quantity }) =>
                  handleAddToCart(message.productSlug, quantity)
                }
                onApplePay={() => handleAddToCart(message.productSlug, 1)}
              />
            );
          case "agent_cart":
            return (
              <AgentCart
                key={message.id}
                acknowledgement={message.acknowledgement}
                summary={message.summary}
                items={message.items}
                lineItems={message.lineItems}
                onApplyPromo={(code) => handleApplyPromo(message.id, code)}
                onCheckout={() => handleCheckout(message.id)}
                onApplePay={() => handleCheckout(message.id)}
              />
            );
          case "agent_order":
            return (
              <AgentOrderSummary
                key={message.id}
                acknowledgement={message.acknowledgement}
                summary={message.summary}
                items={message.items}
                lineItems={message.lineItems}
              />
            );
          case "agent_nbas":
            return (
              <AgentNBAs
                key={message.id}
                nbas={message.nbas}
                regenerateButton={message.regenerateButton}
                onSelect={(nba) => handleNbaSelect(message.id, nba.label)}
                onRegenerate={() => handleNbaRegenerate(message.id)}
              />
            );
          default:
            return null;
        }
      }),
    [
      handleAddToCart,
      handleApplyPromo,
      handleCheckout,
      handleNbaRegenerate,
      handleNbaSelect,
      messages,
    ],
  );

  if (!isOpen) {
    return (
      <button
        type="button"
        className={
          "sidecar-assistant__fab" +
          (isNudging ? " sidecar-assistant__fab--nudging" : "")
        }
        aria-label="Open Personal Assistant"
        onClick={handleFabClick}
        onMouseEnter={() => setIsNudging(false)}
      >
        <SparkleIcon
          width={22}
          height={22}
          className="sidecar-assistant__fab-icon"
        />
        <span className="sidecar-assistant__fab-label" aria-hidden="true">
          fly with me
        </span>
      </button>
    );
  }

  return (
    <>
      <button
        type="button"
        className="sidecar-assistant__backdrop"
        aria-label="Close assistant overlay"
        onClick={() => setIsOpen(false)}
      />
      <aside
        ref={panelRef}
        className="sidecar-assistant"
        role="complementary"
        aria-label="Personal Assistant"
      >
        <header className="sidecar-assistant__header">
        <div className="sidecar-assistant__header-title">
          <span className="sidecar-assistant__header-icon" aria-hidden="true">
            <SparkleIcon width={20} height={20} />
          </span>
          <span className="sidecar-assistant__header-label">Personal Assistant</span>
        </div>
        <div className="sidecar-assistant__header-actions">
          <button
            type="button"
            className="sidecar-assistant__header-btn"
            aria-label="More options"
          >
            <EllipsisVerticalIcon width={20} height={20} />
          </button>
          <button
            type="button"
            className="sidecar-assistant__header-btn"
            aria-label="Close assistant"
            onClick={() => setIsOpen(false)}
          >
            <CloseIcon width={20} height={20} />
          </button>
        </div>
      </header>

        <div className="sidecar-assistant__chat" ref={chatRef}>
          {renderedMessages}
        </div>

        <form className="sidecar-assistant__input-bar" onSubmit={handleSubmit}>
          <div className="sidecar-assistant__input-shell">
            <input
              type="text"
              className="sidecar-assistant__input"
              placeholder={PLACEHOLDER_INPUT}
              value={inputValue}
              onChange={(event) => setInputValue(event.target.value)}
              aria-label="Ask the personal assistant"
            />
            <button
              type="submit"
              className="sidecar-assistant__send"
              aria-label="Send message"
              disabled={!inputValue.trim()}
            >
              <SendHorizontalIcon width={20} height={20} />
            </button>
          </div>
        </form>
      </aside>
    </>
  );
}

export default SidecarAssistant;
