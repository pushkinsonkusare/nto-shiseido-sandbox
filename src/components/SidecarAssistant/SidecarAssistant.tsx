import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCatalog } from "../../catalog/CatalogContext";
import { useAgentMode } from "../AgentModeBar/AgentModeContext";
import {
  ChevronRightIcon,
  CloseIcon,
  EllipsisVerticalIcon,
  ExpandIcon,
  SaveIcon,
  SendHorizontalIcon,
  ShoppingCartIcon,
  ShrinkIcon,
  SparkleIcon,
  Trash2Icon,
} from "../icons/StorefrontIcons";
import {
  AgentCart,
  AgentCompareCard,
  AgentNBAs,
  AgentOrderSummary,
  AgentPDPCard,
  AgentPLPCard,
  AgentRoutineCard,
  AgentSimpleUtterance,
  LatencyLoader,
  type AgentNBA,
  type AgentCartItem,
  type AgentCartLineItem,
  type AgentCompareColumn,
  type AgentCompareRow,
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
  buildRoutineAcknowledgement,
  buildRoutineSectionDescription,
  classifyHygieneTopic,
  classifyIntent,
  detectRoutineIntent,
  filterProducts,
  findBundlesForIntent,
  findMatchingBundle,
  getLandingNbaLane,
  pickRecommendations,
  ROUTINE_STEPS,
  type HygieneTopic,
  type Intent,
  type NbaLane,
  type NbaStage,
  type RoutineIntent,
  type StageNbaItem,
} from "./conversation/flow";
import type { ChatMessage, RoutineSection } from "./conversation/types";
import type { CatalogProduct } from "../../catalog/catalog";
import { resolveProductFaq } from "../SideBySideAssistant/conversation/productFaq";
import { createOpenAIAgent, type AgentAction, type OpenAIAgent } from "./agent/openaiAgent";
import { isLlmConfigured } from "../../lib/openaiClient";
import { stripEmDashes } from "../../lib/sanitizeText";
import "./SidecarAssistant.css";

const PLACEHOLDER_INPUT =
  "Ask anything about skincare, routines, orders, or recommendations…";

const NUDGE_INTERVAL_MS = 90_000;
const NUDGE_DURATION_MS = 2500;

const RESPONSE_LATENCY_MS = 1200;
const PLP_PAGE_SIZE = 5;

/** Maximum number of products a shopper can select at once. */
const MAX_SELECTED_PRODUCTS = 3;

/** Contextual pills that are NOT product FAQs: they trigger dedicated flows
 * (related-products carousel / comparison table / add-to-cart) rather than a
 * local answer. */
const CONTEXTUAL_ACTION_LABELS = new Set(["Show similar", "Compare", "Add to cart"]);

/** Always-present FAQ pill for a single selected product. */
const INGREDIENTS_FAQ_LABEL = "What are the ingredients?";

/**
 * Sitewide em-dash scrub for agent utterances. Applied to every message before
 * it is appended so both deterministic copy and free-form LLM output stay in a
 * plain, spoken voice. Only agent-authored narrative fields are touched;
 * shopper text, loaders, and catalog-derived fields (product titles, PDP copy)
 * are left untouched.
 */
function sanitizeAgentMessage(message: ChatMessage): ChatMessage {
  switch (message.kind) {
    case "agent_simple":
      return {
        ...message,
        title: message.title ? stripEmDashes(message.title) : message.title,
        body: stripEmDashes(message.body),
      };
    case "agent_plp":
      return { ...message, intro: stripEmDashes(message.intro) };
    case "agent_routine":
      return {
        ...message,
        acknowledgement: stripEmDashes(message.acknowledgement),
        sections: message.sections.map((section) => ({
          ...section,
          description: stripEmDashes(section.description),
        })),
      };
    case "agent_compare":
      return {
        ...message,
        intro: stripEmDashes(message.intro),
        recommendation: message.recommendation
          ? stripEmDashes(message.recommendation)
          : message.recommendation,
      };
    case "agent_cart":
    case "agent_order":
      return {
        ...message,
        acknowledgement: message.acknowledgement
          ? stripEmDashes(message.acknowledgement)
          : message.acknowledgement,
        summary: stripEmDashes(message.summary),
      };
    case "agent_nbas":
      return {
        ...message,
        nbas: message.nbas.map((nba) => ({
          ...nba,
          label: stripEmDashes(nba.label),
        })),
      };
    default:
      return message;
  }
}

/**
 * Follow-up pills shown after a contextual FAQ answer: the product's other
 * FAQs (dropping the one just asked so we never repeat it) plus a commit
 * ("Add to cart") and a lateral ("Show similar") action, so there's always a
 * next step.
 */
function buildContextualFollowupLabels(
  product: CatalogProduct,
  askedLabel: string,
): string[] {
  const allFaqs = [...buildContextualFaqs(product), INGREDIENTS_FAQ_LABEL];
  const remaining = allFaqs.filter((label) => label !== askedLabel);
  return [...remaining, "Add to cart", "Show similar"];
}

/**
 * Pick the two most relevant FAQ pills for a single selected product. The
 * phrasings are chosen so `resolveProductFaq` routes each to a product-grounded
 * answer (e.g. "layer" -> layering copy, "texture" -> texture copy). The
 * always-on "What are the ingredients?" pill is appended separately by the
 * caller, so this returns only the two product-tuned questions.
 */
function buildContextualFaqs(product: CatalogProduct): [string, string] {
  const category = product.category.toLowerCase();
  const tags = product.useCaseTags.map((tag) => tag.toLowerCase());
  const isSunCare =
    /sunscreen|sun\s*care/.test(category) ||
    tags.some((tag) => tag === "spf" || tag.includes("sun"));

  if (product.isBundle) {
    return ["What's included?", "What skin types is this for?"];
  }
  if (isSunCare) {
    return ["Is this waterproof?", "Can I layer this under makeup?"];
  }
  if (/serum|treatment|essence|booster/.test(category)) {
    return ["Is this good for sensitive skin?", "How do I layer this with other products?"];
  }
  if (/moisturizer|cream|emulsion|lotion/.test(category)) {
    return ["What's the texture like?", "What skin types is this for?"];
  }
  if (/cleanser|softener|toner|foam/.test(category)) {
    return ["How do I use this?", "What skin types is this for?"];
  }
  if (/eye|lip/.test(category)) {
    return ["What does this target?", "How do I layer this with other products?"];
  }
  if (/mask/.test(category)) {
    return ["What's the texture like?", "What does this target?"];
  }
  return ["Is this good for sensitive skin?", "What does this target?"];
}
const TALL_CARD_VIEWPORT_RATIO = 0.92;
const TALL_CARD_ANCHOR_RATIO = 0.6;
const TALL_CARD_TOP_INSET_PX = 16;
const TALL_CARD_SETTLE_TIMEOUT_MS = 140;

let messageIdCounter = 0;
function nextId(prefix: string) {
  messageIdCounter += 1;
  return `${prefix}-${messageIdCounter}`;
}

/**
 * Serialize the current conversation into a plain-text transcript suitable for
 * downloading. Each message is rendered from the shopper's or the assistant's
 * point of view so the exported file reads like a chat log.
 */
function buildTranscriptText(messages: ChatMessage[]): string {
  const lines: string[] = [
    "Shiseido Personal Assistant Session Transcript",
    `Exported: ${new Date().toLocaleString()}`,
    "",
  ];

  for (const message of messages) {
    switch (message.kind) {
      case "shopper_text":
        lines.push(`Shopper: ${message.text}`);
        break;
      case "agent_simple":
        lines.push(
          `Assistant: ${message.title ? `${message.title}: ` : ""}${message.body}`,
        );
        break;
      case "agent_plp":
        lines.push(`Assistant: ${message.intro}`);
        for (const product of message.products) {
          lines.push(`  • ${product.title} (${product.price})`);
        }
        break;
      case "agent_pdp":
        lines.push(`Assistant: ${message.title} (${message.price})`);
        break;
      case "agent_compare":
        lines.push(`Assistant: ${message.intro}`);
        lines.push(`  ${message.columns.map((column) => column.title).join(" vs ")}`);
        for (const row of message.rows) {
          lines.push(
            `    ${row.label}: ${row.values
              .map((value) => value ?? "N/A")
              .join(" | ")}`,
          );
        }
        if (message.recommendation) {
          lines.push(`Assistant: ${message.recommendation}`);
        }
        break;
      case "agent_cart":
      case "agent_order":
        if (message.acknowledgement) {
          lines.push(`Assistant: ${message.acknowledgement}`);
        }
        lines.push(`Assistant: ${message.summary}`);
        for (const item of message.items) {
          lines.push(`  • ${item.title}`);
        }
        for (const lineItem of message.lineItems) {
          lines.push(`    ${lineItem.label}: ${lineItem.value}`);
        }
        break;
      case "agent_nbas":
        lines.push(
          `Assistant (suggestions): ${message.nbas
            .map((nba) => nba.label)
            .join(", ")}`,
        );
        break;
      case "agent_loader":
        break;
      default:
        break;
    }
  }

  return lines.join("\n");
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
    comparePrice: product.comparePriceFormatted ?? undefined,
    description: product.shortDescription,
    rating: product.rating ?? undefined,
    reviewCount: product.reviewCount ?? undefined,
    swatches: product.swatches.map((color) => ({ color })),
    badgeLabel: product.badgeLabel,
    onSelect: () => onSelect(product.slug),
  };
}

function toCompareColumn(product: CatalogProduct): AgentCompareColumn {
  return {
    id: product.slug,
    slug: product.slug,
    imageUrl: product.imageUrl,
    imageAlt: product.imageAlt,
    title: product.title,
    price: product.priceFormatted,
    comparePrice: product.comparePriceFormatted ?? undefined,
    rating: product.rating ?? undefined,
    reviewCount: product.reviewCount ?? undefined,
  };
}

/* Preferred order for spec rows in the comparison table; any remaining
 * spec labels present on the products are appended after these. */
const COMPARE_SPEC_ORDER = [
  "Collection",
  "Type",
  "Skin type",
  "Targets",
  "Sizes",
  "Routine",
];

/** Build catalog-grounded comparison rows (category, then shared specs) for a
 * set of products. Price and rating are rendered in the column headers instead
 * of as rows. Missing values are left as `null` so the table renders "N/A". */
function buildCompareRows(products: CatalogProduct[]): AgentCompareRow[] {
  const specValue = (product: CatalogProduct, label: string): string | null => {
    const spec = product.specs.find((entry) => entry.label === label);
    return spec && spec.value ? spec.value : null;
  };

  const rows: AgentCompareRow[] = [
    { label: "Category", values: products.map((p) => p.category || null) },
  ];

  const seen = new Set<string>();
  const orderedLabels = [
    ...COMPARE_SPEC_ORDER,
    ...products.flatMap((p) => p.specs.map((s) => s.label)),
  ];
  for (const label of orderedLabels) {
    if (!label || seen.has(label)) continue;
    seen.add(label);
    const values = products.map((p) => specValue(p, label));
    if (values.some((value) => value != null)) {
      rows.push({ label, values });
    }
  }

  return rows;
}

function toCartItem(product: CatalogProduct, quantity: number): AgentCartItem {
  return {
    id: `cart-${product.slug}`,
    imageUrl: product.imageUrl,
    imageAlt: product.imageAlt,
    title: product.title,
    meta: [`Brand: ${product.brand}`, `Category: ${product.category}`],
    price: product.priceFormatted,
    comparePrice: product.comparePriceFormatted ?? undefined,
    quantity,
  };
}

function cartItemUnitPrice(item: AgentCartItem): number {
  return Number(item.price.replace(/[^0-9.]/g, "")) || 0;
}

/** Recompute cart totals for an arbitrary set of items, honoring an optional
 * applied promo (stored as a fraction so it survives quantity edits). */
function recomputeCartLineItems(
  items: AgentCartItem[],
  appliedPromo?: { code: string; fraction: number },
): AgentCartLineItem[] {
  const count = items.reduce((sum, item) => sum + item.quantity, 0);
  const subtotal = items.reduce(
    (sum, item) => sum + cartItemUnitPrice(item) * item.quantity,
    0,
  );
  const discount = appliedPromo
    ? Math.round(subtotal * appliedPromo.fraction * 100) / 100
    : 0;

  const lines: AgentCartLineItem[] = [
    {
      label: `Subtotal (${count} item${count === 1 ? "" : "s"})`,
      value: usd.format(subtotal),
    },
  ];
  if (discount > 0 && appliedPromo) {
    lines.push({
      label: "Coupon",
      note: appliedPromo.code,
      value: `-${usd.format(discount)}`,
    });
  }
  // Not yet calculated, so these show as placeholders until wired to pricing logic.
  lines.push({ label: "Promotions", value: "-" });
  lines.push({ label: "Shipping", value: "-" });
  lines.push({ label: "Shipping Discount", value: "-" });
  lines.push({ label: "Tax", value: "TBD" });
  lines.push({
    label: "Estimated total",
    value: usd.format(Math.max(0, subtotal - discount)),
    emphasis: true,
  });
  return lines;
}

function cartSummaryText(items: AgentCartItem[], total: number): string {
  const count = items.reduce((sum, item) => sum + item.quantity, 0);
  return `Your cart has ${count} item${count === 1 ? "" : "s"} with a subtotal of ${usd.format(total)}.`;
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

type SidecarAssistantProps = {
  /** When true, the assistant renders as a flush docked panel that fills its
   * container (see SidecarDockLayout) instead of a floating fixed overlay.
   * In this mode open/close is owned by the layout via `open`/`onRequestClose`
   * and the component skips its overlay-only behaviors (backdrop, own FAB,
   * page scroll-lock, outside-click / Escape to close). */
  docked?: boolean;
  /** Open state, only consulted when `docked`. */
  open?: boolean;
  /** Close request from the docked panel's header button. */
  onRequestClose?: () => void;
  /** When true (docked only), the panel is floating as a centered modal. */
  detached?: boolean;
  /** Toggle between docked and detached modal, driven by the Expand button. */
  onToggleDetach?: () => void;
};

export function SidecarAssistant({
  docked = false,
  open = false,
  onRequestClose,
  detached = false,
  onToggleDetach,
}: SidecarAssistantProps = {}) {
  const { products, heroProduct, getProductBySlug, getRelatedProducts, orderHistory } =
    useCatalog();
  const { accordionRecommendations, contextIsland } = useAgentMode();
  const [isOpen, setIsOpen] = useState(false);

  // When docked, the surrounding layout owns open/close; mirror it into the
  // internal `isOpen` so all the open-driven effects (welcome seeding, etc.)
  // keep working unchanged.
  useEffect(() => {
    if (!docked) return;
    setIsOpen(open);
  }, [docked, open]);
  const [hasUserOpenedFab, setHasUserOpenedFab] = useState(false);
  const [isNudging, setIsNudging] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [welcomeRefreshCount, setWelcomeRefreshCount] = useState(0);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [selectedSlugs, setSelectedSlugs] = useState<string[]>([]);
  const selectedSet = useMemo(() => new Set(selectedSlugs), [selectedSlugs]);

  // Context island: item count from the latest cart card, and the product the
  // conversation is currently scoped to (the primary selection).
  const cartItemCount = useMemo(() => {
    const cart = [...messages]
      .reverse()
      .find(
        (m): m is Extract<ChatMessage, { kind: "agent_cart" }> =>
          m.kind === "agent_cart",
      );
    return cart ? cart.items.reduce((sum, item) => sum + item.quantity, 0) : 0;
  }, [messages]);
  const contextProduct = useMemo(() => {
    // A live selection is the strongest signal for the product in context.
    if (selectedSlugs.length > 0) {
      return getProductBySlug(selectedSlugs[0]);
    }
    // Otherwise, during a product FAQ thread the selection is often cleared,
    // but the current (single, pruned) NBA row is flagged contextual and
    // carries the product it's about - use that so the island persists.
    const latestNba = [...messages]
      .reverse()
      .find(
        (m): m is Extract<ChatMessage, { kind: "agent_nbas" }> =>
          m.kind === "agent_nbas",
      );
    if (latestNba?.contextual && latestNba.productSlug) {
      return getProductBySlug(latestNba.productSlug);
    }
    return undefined;
  }, [selectedSlugs, messages, getProductBySlug]);
  const showContextIsland =
    contextIsland && (cartItemCount > 0 || Boolean(contextProduct));
  // True once the shopper has asked a contextual FAQ for the current selection:
  // the follow-up pills then live in-chat, so the tray hides its own pill row.
  const [contextualThreadActive, setContextualThreadActive] = useState(false);
  // Contextual pills adapt to how many products are selected: a single product
  // offers Show similar + two product-tuned FAQs + the ingredients FAQ, while
  // two or more products collapse to a single Compare action.
  const contextualNbas = useMemo(() => {
    if (selectedSlugs.length >= 2) {
      return buildNbaItems(["Compare"], "nba-contextual");
    }
    const firstSlug = selectedSlugs[0];
    const product = firstSlug ? getProductBySlug(firstSlug) : undefined;
    if (!product) return [];
    const [faq1, faq2] = buildContextualFaqs(product);
    return buildNbaItems(
      ["Show similar", faq1, faq2, INGREDIENTS_FAQ_LABEL],
      "nba-contextual",
    );
  }, [selectedSlugs, getProductBySlug]);

  // When products are selected, the input invites a product-scoped question.
  const inputPlaceholder = useMemo(() => {
    if (selectedSlugs.length === 1) {
      const product = getProductBySlug(selectedSlugs[0]);
      if (product) return `Ask me anything about ${product.title}`;
    }
    if (selectedSlugs.length > 1) {
      return `Ask me anything about your ${selectedSlugs.length} selected products`;
    }
    return PLACEHOLDER_INPUT;
  }, [selectedSlugs, getProductBySlug]);

  const chatRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const previousMessageIdsRef = useRef<string[]>([]);
  const panelRef = useRef<HTMLElement>(null);
  const pendingTimeouts = useRef<number[]>([]);
  const messagesRef = useRef<ChatMessage[]>([]);
  // Slug of the product the most recent context separator announced, so we
  // only drop a fresh divider when the FAQ context switches products.
  const lastSeparatorSlugRef = useRef<string | null>(null);
  const welcomeNbasMessageIdRef = useRef<string | null>(null);
  const firstShopperTurnHandledRef = useRef(false);
  const previousSelectedCountRef = useRef(0);
  // The intent behind the currently-shown PLP, so refinement NBA pills can
  // narrow the current result set (keeping category + filters) instead of
  // re-running as a fresh, context-less query.
  const activePlpIntentRef = useRef<Intent | null>(null);
  const lastStageNbaClickRef = useRef<{
    stage: NbaStage | "welcome";
    lane?: NbaLane;
    label: string;
  } | null>(null);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // Selecting a product moves focus to the composer (cursor blinking) so the
  // shopper can immediately ask about it; the placeholder names the product.
  // A selection change also resets the contextual thread so the tray shows its
  // entry pills again for the new selection.
  useEffect(() => {
    if (selectedSlugs.length > previousSelectedCountRef.current) {
      inputRef.current?.focus();
    }
    previousSelectedCountRef.current = selectedSlugs.length;
    setContextualThreadActive(false);
  }, [selectedSlugs]);

  /* ---------- mutation helpers ---------- */

  const appendMessage = useCallback((rawMessage: ChatMessage) => {
    const message = sanitizeAgentMessage(rawMessage);
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
      // A new shopper utterance supersedes any pending follow-up prompts:
      // suggestion chips are transient affordances tied to the previous turn,
      // so clear stale NBA sets the instant the shopper proceeds (typed input,
      // NBA pill, contextual pill, or "Show more"). A fresh set may be appended
      // by the response that follows.
      if (message.kind === "shopper_text") {
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
        current.map((message) =>
          message.id === id ? sanitizeAgentMessage(updater(message)) : message,
        ),
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
        comparePrice: product.comparePriceFormatted ?? undefined,
        description:
          product.overview && !/^n\/a\b/i.test(product.overview.trim())
            ? product.overview
            : product.shortDescription,
        rating: product.rating ?? undefined,
        reviewCount: product.reviewCount ?? undefined,
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

      // Accumulate into the shopper's existing cart rather than spawning a
      // fresh single-item card on every add. We fold the new item into the
      // most recent cart card, replacing it so only one up-to-date cart shows.
      const list = messagesRef.current;
      const previousCart = [...list]
        .reverse()
        .find((message): message is Extract<ChatMessage, { kind: "agent_cart" }> =>
          message.kind === "agent_cart",
        );

      const newItem = toCartItem(product, quantity);
      let items: AgentCartItem[];
      if (previousCart) {
        const existingIndex = previousCart.items.findIndex(
          (item) => item.id === newItem.id,
        );
        items =
          existingIndex >= 0
            ? previousCart.items.map((item, index) =>
                index === existingIndex
                  ? { ...item, quantity: item.quantity + quantity }
                  : item,
              )
            : [...previousCart.items, newItem];
      } else {
        items = [newItem];
      }

      const appliedPromo = previousCart?.appliedPromo;
      const cartCoupons = previousCart?.cartCoupons;
      const subtotal = items.reduce(
        (sum, item) => sum + cartItemUnitPrice(item) * item.quantity,
        0,
      );

      if (previousCart) removeMessage(previousCart.id);

      const id = nextId("cart");
      appendMessage({
        id,
        kind: "agent_cart",
        acknowledgement: `Got it, I added ${product.title} to your cart.`,
        summary: cartSummaryText(items, subtotal),
        items,
        lineItems: recomputeCartLineItems(items, appliedPromo),
        cartCoupons,
        appliedPromo,
      });
      return id;
    },
    [appendMessage, getProductBySlug, removeMessage],
  );

  // Surface the shopper's current cart as a fresh cart card at the bottom of
  // the conversation. Used by the context-island cart button so a tap always
  // brings the up-to-date cart back into view.
  const showCartCard = useCallback(() => {
    const list = messagesRef.current;
    const previousCart = [...list]
      .reverse()
      .find((message): message is Extract<ChatMessage, { kind: "agent_cart" }> =>
        message.kind === "agent_cart",
      );
    if (!previousCart) return;

    removeMessage(previousCart.id);
    appendMessage({
      ...previousCart,
      id: nextId("cart"),
      acknowledgement: "Here's your cart.",
    });
  }, [appendMessage, removeMessage]);

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
        GLOW10: { discount: 0.1, label: "10% off" },
        GLOW20: { discount: 0.2, label: "20% off" },
      };

      const promo = PROMO_DB[trimmed];
      if (!promo) {
        appendMessage({
          id: nextId("agent"),
          kind: "agent_simple",
          body: `I couldn't find a promo named "${trimmed}". Try GLOW10 or GLOW20.`,
        });
        return;
      }

      let discountAmount = 0;
      updateMessage(cartMessageId, (message) => {
        if (message.kind !== "agent_cart") return message;
        const subtotal = message.items.reduce(
          (sum, item) => sum + cartItemUnitPrice(item) * item.quantity,
          0,
        );
        discountAmount = Math.round(subtotal * promo.discount * 100) / 100;
        const appliedPromo = { code: trimmed, fraction: promo.discount };
        const existingCoupons = (message.cartCoupons ?? []).filter(
          (existing) => existing !== trimmed,
        );
        return {
          ...message,
          appliedPromo,
          cartCoupons: [...existingCoupons, trimmed],
          lineItems: recomputeCartLineItems(message.items, appliedPromo),
          summary: `Promo applied. Your new estimated total is ${usd.format(Math.max(0, subtotal - discountAmount))}.`,
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
          const orderNumber = `SHI-${Math.floor(40000 + Math.random() * 9999)}`;

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
    (
      intro: string,
      slugs: string[],
      showMoreCard: boolean,
      options?: { remainingSlugs?: string[]; searchTerm?: string },
    ) => {
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
        remainingSlugs: options?.remainingSlugs,
        searchTerm: options?.searchTerm,
      });
    },
    [appendMessage, getProductBySlug, handleProductSelect],
  );

  // Broad-intent "routine" card: one acknowledgement + a section per routine
  // step. Each section's products are the top matches for that step's category
  // filtered by the detected skin type (with a category-only fallback so a
  // step never renders empty), split into a first page (5) + "Show more".
  const renderRoutineCard = useCallback(
    (routine: RoutineIntent) => {
      const sections: RoutineSection[] = [];

      for (const step of ROUTINE_STEPS) {
        const sectionIntent: Intent = {
          kind: "direct",
          rawQuery: routine.rawQuery,
          categories: [step.categoryKey],
          requiredTags: routine.skinType ? [routine.skinType] : undefined,
        };

        let ranked = pickRecommendations(
          filterProducts(sectionIntent, products),
          24,
          sectionIntent,
        );
        // Skin-type tags are sparse; if the hard filter zeroes the step, fall
        // back to a category-only pool so every routine step still populates.
        if (ranked.length === 0 && routine.skinType) {
          const categoryOnly: Intent = {
            kind: "direct",
            rawQuery: routine.rawQuery,
            categories: [step.categoryKey],
          };
          ranked = pickRecommendations(
            filterProducts(categoryOnly, products),
            24,
            categoryOnly,
          );
        }
        if (ranked.length === 0) continue;

        const firstPage = ranked.slice(0, PLP_PAGE_SIZE);
        const rest = ranked.slice(PLP_PAGE_SIZE);
        sections.push({
          stepLabel: step.stepLabel,
          categoryTitle: step.categoryTitle,
          categoryKey: step.categoryKey,
          description: buildRoutineSectionDescription(step.categoryKey, routine),
          products: firstPage.map((p) => toPlpProduct(p, handleProductSelect)),
          showMoreCard: rest.length > 0,
          remainingSlugs: rest.map((p) => p.slug),
        });
      }

      if (sections.length === 0) return false;

      appendMessage({
        id: nextId("routine"),
        kind: "agent_routine",
        acknowledgement: buildRoutineAcknowledgement(routine),
        sections,
      });
      return true;
    },
    [appendMessage, getProductBySlug, handleProductSelect, products],
  );

  const handleRoutineShowMore = useCallback(
    (routineMessageId: string, sectionIndex: number) => {
      updateMessage(routineMessageId, (message) => {
        if (message.kind !== "agent_routine") return message;
        const section = message.sections[sectionIndex];
        if (!section) return message;
        const remaining = section.remainingSlugs ?? [];
        if (remaining.length === 0) return message;

        const nextPage = remaining
          .slice(0, PLP_PAGE_SIZE)
          .map((slug) => getProductBySlug(slug))
          .filter((p): p is CatalogProduct => Boolean(p))
          .map((p) => toPlpProduct(p, handleProductSelect));
        const rest = remaining.slice(PLP_PAGE_SIZE);

        const sections = message.sections.map((existing, index) =>
          index === sectionIndex
            ? {
                ...existing,
                products: [...existing.products, ...nextPage],
                remainingSlugs: rest,
                showMoreCard: rest.length > 0,
              }
            : existing,
        );
        return { ...message, sections };
      });
    },
    [getProductBySlug, handleProductSelect, updateMessage],
  );

  const handleToggleSelect = useCallback((slug: string) => {
    setSelectedSlugs((current) =>
      current.includes(slug)
        ? current.filter((existing) => existing !== slug)
        : current.length >= MAX_SELECTED_PRODUCTS
          ? current
          : [...current, slug],
    );
  }, []);

  const handleRemoveSelected = useCallback((slug: string) => {
    setSelectedSlugs((current) => current.filter((existing) => existing !== slug));
  }, []);

  const handleShowMore = useCallback(
    (plpMessageId: string) => {
      const message = messagesRef.current.find((m) => m.id === plpMessageId);
      if (!message || message.kind !== "agent_plp") return;

      const remaining = message.remainingSlugs ?? [];
      if (remaining.length === 0) return;
      const term = message.searchTerm ?? "";

      // Consume the affordance on the source card so it can't be re-triggered.
      updateMessage(plpMessageId, (current) =>
        current.kind === "agent_plp"
          ? { ...current, showMoreCard: false, remainingSlugs: [] }
          : current,
      );

      appendMessage({
        id: nextId("shopper"),
        kind: "shopper_text",
        text: `Show more${term ? ` ${term}` : ""}`,
      });
      const loaderId = nextId("loader");
      appendMessage({ id: loaderId, kind: "agent_loader", variant: "answering" });

      scheduleResponse(() => {
        removeMessage(loaderId);
        const nextPage = remaining.slice(0, PLP_PAGE_SIZE);
        const rest = remaining.slice(PLP_PAGE_SIZE);
        renderPlpCard(
          term
            ? `Here are more options that match "${term}":`
            : "Here are a few more options:",
          nextPage,
          rest.length > 0,
          { remainingSlugs: rest, searchTerm: term },
        );
      });
    },
    [appendMessage, removeMessage, renderPlpCard, scheduleResponse, updateMessage],
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

  const handleCartQuantityChange = useCallback(
    (cartMessageId: string, itemId: string, quantity: number) => {
      const nextQuantity = Math.max(1, quantity);
      updateMessage(cartMessageId, (message) => {
        if (message.kind !== "agent_cart") return message;
        const items = message.items.map((item) =>
          item.id === itemId ? { ...item, quantity: nextQuantity } : item,
        );
        const lineItems = recomputeCartLineItems(items, message.appliedPromo);
        const subtotal = items.reduce(
          (sum, item) => sum + cartItemUnitPrice(item) * item.quantity,
          0,
        );
        return {
          ...message,
          items,
          lineItems,
          summary: cartSummaryText(items, subtotal),
        };
      });
    },
    [updateMessage],
  );

  const handleRemoveCartItem = useCallback(
    (cartMessageId: string, itemId: string) => {
      const cart = messagesRef.current.find((m) => m.id === cartMessageId);
      if (!cart || cart.kind !== "agent_cart") return;
      const remaining = cart.items.filter((item) => item.id !== itemId);

      if (remaining.length === 0) {
        const productName =
          cart.items.find((item) => item.id === itemId)?.title ?? "that item";

        // Turn the removal into a conversational turn: shopper utterance,
        // a "removing" latency loader, then a plain-text confirmation and
        // discovery pills so the shopper can continue.
        appendMessage({
          id: nextId("shopper"),
          kind: "shopper_text",
          text: `Remove ${productName}`,
        });
        // Convert the cart card into its "Got it, I added X" acknowledgement
        // line (kept in place) rather than deleting it. This preserves the
        // agent's response to the original add so the "Add" and "Remove"
        // shopper bubbles aren't left back-to-back, and — since it's no longer
        // an agent_cart — the next add starts a fresh cart card.
        updateMessage(cartMessageId, (message) =>
          message.kind === "agent_cart"
            ? {
                id: message.id,
                kind: "agent_simple",
                body:
                  message.acknowledgement ??
                  `Added ${productName} to your cart.`,
              }
            : message,
        );
        const loaderId = nextId("loader");
        appendMessage({ id: loaderId, kind: "agent_loader", variant: "removing" });
        scheduleResponse(() => {
          removeMessage(loaderId);
          appendMessage({
            id: nextId("agent"),
            kind: "agent_simple",
            body: `Removed ${productName} from your cart. Your cart is empty. Let me know what you wish to check out next.`,
          });
          appendMessage(buildNbasMessage(buildWelcomeNbas(0)));
        });
        return;
      }

      updateMessage(cartMessageId, (message) => {
        if (message.kind !== "agent_cart") return message;
        const items = message.items.filter((item) => item.id !== itemId);
        const lineItems = recomputeCartLineItems(items, message.appliedPromo);
        const subtotal = items.reduce(
          (sum, item) => sum + cartItemUnitPrice(item) * item.quantity,
          0,
        );
        return {
          ...message,
          items,
          lineItems,
          summary: cartSummaryText(items, subtotal),
        };
      });
    },
    [appendMessage, removeMessage, updateMessage, scheduleResponse],
  );

  const handleRemoveCartCoupon = useCallback(
    (cartMessageId: string, code: string) => {
      updateMessage(cartMessageId, (message) => {
        if (message.kind !== "agent_cart") return message;
        const cartCoupons = (message.cartCoupons ?? []).filter(
          (existing) => existing !== code,
        );
        const appliedPromo =
          message.appliedPromo?.code === code
            ? undefined
            : message.appliedPromo;
        const items = message.items;
        const subtotal = items.reduce(
          (sum, item) => sum + cartItemUnitPrice(item) * item.quantity,
          0,
        );
        return {
          ...message,
          cartCoupons,
          appliedPromo,
          lineItems: recomputeCartLineItems(items, appliedPromo),
          summary: cartSummaryText(items, subtotal),
        };
      });
    },
    [updateMessage],
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
          // `say` is intentionally not handled: free-form acknowledgements must
          // live inside the following card's intro (the main bubble), never as a
          // separate agent_simple bubble. `say` is already filtered upstream
          // before this runs; ignoring it here enforces that structurally.
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
        // Remember the intent behind this PLP so refinement pills can narrow it.
        activePlpIntentRef.current = intent;
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

  // Shared PLP renderer: filter -> rank -> render carousel + plp NBAs (or a
  // no-match probing fallback). Records the intent behind the shown PLP so
  // refinement pills can narrow it while preserving category + filters.
  const renderRankedPlp = useCallback(
    (query: string, intent: Intent) => {
      activePlpIntentRef.current = intent;
      const matches = filterProducts(intent, products);
      const ranked = pickRecommendations(matches, matches.length, intent);
      const firstPage = ranked.slice(0, PLP_PAGE_SIZE);
      const rest = ranked.slice(PLP_PAGE_SIZE);

      if (firstPage.length === 0) {
        appendMessage({
          id: nextId("agent"),
          kind: "agent_simple",
          body: "I couldn't find an exact match. Let's narrow that down. What matters most to you?",
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
        buildPlpIntro(query, intent, firstPage.length),
        firstPage.map((p) => p.slug),
        rest.length > 0,
        { remainingSlugs: rest.map((p) => p.slug), searchTerm: query },
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
    [appendMessage, products, renderPlpCard],
  );

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

      // Broad intent (skin type / concern / routine cue, no explicit category):
      // synthesise the full multi-step routine card instead of a single carousel.
      const routine = detectRoutineIntent(trimmed);
      if (routine.isRoutine && renderRoutineCard(routine)) {
        appendMessage(
          buildNbasMessage([
            "Show a simpler routine",
            "Best for sensitive skin",
            "Budget-friendly picks",
          ]),
        );
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

      renderRankedPlp(trimmed, intent);
    },
    [
      appendMessage,
      products,
      renderRankedPlp,
      renderRecentOrderSummary,
      renderRoutineCard,
    ],
  );

  // Refine the current PLP from a stage NBA pill: merge the active PLP intent
  // (category + budget/tier/tags) with the pill's added constraint, then
  // re-render directly - bypassing routine detection and the LLM so context is
  // never lost.
  const dispatchPlpRefinement = useCallback(
    (label: string) => {
      const base = activePlpIntentRef.current;
      const patch = classifyIntent(label);
      const requiredTags = Array.from(
        new Set([...(base?.requiredTags ?? []), ...(patch.requiredTags ?? [])]),
      );
      const merged: Intent = {
        kind: "direct",
        rawQuery: label,
        categories: base?.categories ?? patch.categories,
        categoryLabel: base?.categoryLabel ?? patch.categoryLabel,
        priceMax: patch.priceMax ?? base?.priceMax,
        priceMin: patch.priceMin ?? base?.priceMin,
        tier: patch.tier ?? base?.tier,
        includeBundles: Boolean(patch.includeBundles || base?.includeBundles),
        requiredTags: requiredTags.length > 0 ? requiredTags : undefined,
        activities: base?.activities,
      };

      appendMessage({ id: nextId("shopper"), kind: "shopper_text", text: label });
      const loaderId = nextId("loader");
      appendMessage({ id: loaderId, kind: "agent_loader", variant: "answering" });
      scheduleResponse(() => {
        removeMessage(loaderId);
        renderRankedPlp(label, merged);
      });
    },
    [appendMessage, removeMessage, renderRankedPlp, scheduleResponse],
  );

  const dispatchShopperMessage = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      appendMessage({ id: nextId("shopper"), kind: "shopper_text", text: trimmed });

      const loaderId = nextId("loader");
      appendMessage({ id: loaderId, kind: "agent_loader", variant: "answering" });

      // Broad-intent routine requests are rendered deterministically as a
      // unified routine card on every turn, bypassing the LLM (which would
      // otherwise return a single-category listing for these queries).
      const routine = detectRoutineIntent(trimmed);
      if (routine.isRoutine) {
        firstShopperTurnHandledRef.current = true;
        scheduleResponse(() => {
          removeMessage(loaderId);
          if (renderRoutineCard(routine)) {
            appendMessage(
              buildNbasMessage([
                "Show a simpler routine",
                "Best for sensitive skin",
                "Budget-friendly picks",
              ]),
            );
          } else {
            dispatchRuleBasedResponse(trimmed);
          }
        });
        return;
      }

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
            // Fall back to the deterministic rule-based response silently so the
            // shopper sees a single utterance (the results intro), not a filler
            // "let me pull that together" line followed by the results.
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
      renderRoutineCard,
      scheduleResponse,
    ],
  );

  /** Contextual (selected-product) pills, routed conditionally:
   *  - Informational pills ("Is this waterproof?", "Ingredients") answer
   *    inline from catalog data via `resolveProductFaq` and keep the
   *    selection tray open for follow-ups.
   *  - "Show similar" renders a related-products carousel, then collapses
   *    the tray.
   *  - "Compare" renders a comparison table of the selected products, then
   *    collapses the tray. */
  const handleContextualPill = useCallback(
    (label: string, contextSlug?: string) => {
      // Contextual follow-up rows carry the product they're about, so they keep
      // resolving correctly even if the live selection changed or cleared since
      // the row was shown. Tray pills omit `contextSlug` and use the current
      // selection.
      const contextSlugs = contextSlug ? [contextSlug] : selectedSlugs;
      const selectedProducts = contextSlugs
        .map((slug) => getProductBySlug(slug))
        .filter((p): p is CatalogProduct => Boolean(p));
      const firstProduct = selectedProducts[0];

      // Any pill that isn't a dedicated action (Show similar / Compare) is a
      // product FAQ, answered locally from catalog data so it always returns a
      // single, product-grounded reply. The selection tray stays open for
      // follow-up questions.
      if (firstProduct && !CONTEXTUAL_ACTION_LABELS.has(label)) {
        // When the context island is off, drop an in-chat context separator so
        // the shopper always sees which product the FAQ thread is about. Only
        // insert one when the product changes, so consecutive FAQs about the
        // same product stay grouped under a single divider.
        if (!contextIsland && lastSeparatorSlugRef.current !== firstProduct.slug) {
          appendMessage({
            id: nextId("sep"),
            kind: "context_separator",
            productSlug: firstProduct.slug,
          });
          lastSeparatorSlugRef.current = firstProduct.slug;
        }
        appendMessage({ id: nextId("shopper"), kind: "shopper_text", text: label });
        const loaderId = nextId("loader");
        appendMessage({ id: loaderId, kind: "agent_loader", variant: "answering" });
        scheduleResponse(() => {
          removeMessage(loaderId);
          appendMessage({
            id: nextId("agent"),
            kind: "agent_simple",
            body: resolveProductFaq(firstProduct, label),
          });
          // Offer an in-chat follow-up row so the shopper can keep exploring
          // this product (remaining FAQs) or move forward (add / show similar).
          appendMessage({
            id: nextId("nbas"),
            kind: "agent_nbas",
            contextual: true,
            productSlug: firstProduct.slug,
            regenerateButton: false,
            nbas: buildNbaItems(
              buildContextualFollowupLabels(firstProduct, label),
              "nba-followup",
            ),
          });
          setContextualThreadActive(true);
        });
        return;
      }

      if (firstProduct && label === "Add to cart") {
        handleAddToCart(firstProduct.slug, 1);
        // Adding ends the contextual thread: clearing the selection closes the
        // tray and lets the cart-stage NBAs from handleAddToCart show.
        setSelectedSlugs([]);
        return;
      }

      if (firstProduct && label === "Show similar") {
        appendMessage({ id: nextId("shopper"), kind: "shopper_text", text: label });
        const loaderId = nextId("loader");
        appendMessage({ id: loaderId, kind: "agent_loader", variant: "answering" });
        scheduleResponse(() => {
          removeMessage(loaderId);
          const excluded = new Set(contextSlugs);
          const related: CatalogProduct[] = [];
          const seen = new Set<string>();
          for (const slug of contextSlugs) {
            // Pull a deep pool so the carousel can paginate the same way the
            // normal PLP flow does (first page + "Show more" for the rest).
            for (const candidate of getRelatedProducts(slug, 18)) {
              if (excluded.has(candidate.slug) || seen.has(candidate.slug)) {
                continue;
              }
              seen.add(candidate.slug);
              related.push(candidate);
            }
          }
          if (related.length === 0) {
            appendMessage({
              id: nextId("agent"),
              kind: "agent_simple",
              body: `I couldn't find close matches to the ${firstProduct.title} right now. Tell me what matters most and I'll keep looking.`,
            });
            return;
          }
          // Same 5+1 pagination as search results: show the first page and a
          // "Show more" card, then let handleShowMore reveal the rest in pages.
          const firstPage = related.slice(0, PLP_PAGE_SIZE);
          const rest = related.slice(PLP_PAGE_SIZE);
          renderPlpCard(
            `Here are a few options similar to the ${firstProduct.title}:`,
            firstPage.map((p) => p.slug),
            rest.length > 0,
            { remainingSlugs: rest.map((p) => p.slug) },
          );
          setSelectedSlugs([]);
        });
        return;
      }

      if (firstProduct && label === "Compare") {
        appendMessage({ id: nextId("shopper"), kind: "shopper_text", text: label });
        const loaderId = nextId("loader");
        appendMessage({ id: loaderId, kind: "agent_loader", variant: "answering" });
        scheduleResponse(() => {
          removeMessage(loaderId);
          const compareProducts = [...selectedProducts];
          const included = new Set(compareProducts.map((p) => p.slug));
          // Pad with related products so a single-selection compare still
          // produces a meaningful multi-column table.
          if (compareProducts.length < 2) {
            for (const candidate of getRelatedProducts(firstProduct.slug, 6)) {
              if (included.has(candidate.slug)) continue;
              included.add(candidate.slug);
              compareProducts.push(candidate);
              if (compareProducts.length >= MAX_SELECTED_PRODUCTS) break;
            }
          }
          const comparedProducts = compareProducts.slice(0, MAX_SELECTED_PRODUCTS);
          const columns = comparedProducts.map(toCompareColumn);
          if (columns.length < 2) {
            appendMessage({
              id: nextId("agent"),
              kind: "agent_simple",
              body: `I need at least two products to compare. Select another item and I'll line them up side by side.`,
            });
            return;
          }
          const otherCount = comparedProducts.length - 1;
          const recommended = [...comparedProducts].sort(
            (a, b) =>
              (b.rating ?? 0) - (a.rating ?? 0) ||
              (b.reviewCount ?? 0) - (a.reviewCount ?? 0),
          )[0];
          const recommendation =
            recommended.rating != null
              ? `I'd recommend the ${recommended.title}. It has the highest rating (${recommended.rating.toFixed(1)}${recommended.reviewCount != null ? ` from ${recommended.reviewCount} reviews` : ""}) and is priced at ${recommended.priceFormatted}.`
              : `I'd recommend the ${recommended.title}, priced at ${recommended.priceFormatted}.`;
          appendMessage({
            id: nextId("compare"),
            kind: "agent_compare",
            intro: `Here's a side-by-side comparison of ${firstProduct.title} and ${otherCount} other ${otherCount === 1 ? "item" : "items"}.`,
            columns,
            rows: buildCompareRows(comparedProducts),
            recommendation,
            recommendedSlug: recommended.slug,
          });
          setSelectedSlugs([]);
        });
        return;
      }

      dispatchShopperMessage(label);
    },
    [
      selectedSlugs,
      getProductBySlug,
      getRelatedProducts,
      renderPlpCard,
      appendMessage,
      scheduleResponse,
      removeMessage,
      dispatchShopperMessage,
      handleAddToCart,
      contextIsland,
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
      // PLP refinement/capture/cross-sell pills narrow the current result set
      // (keeping category + filters) rather than starting a fresh query, so
      // they never lose context or fall into the broad routine card.
      const clicked = messagesRef.current.find((m) => m.id === messageId);
      const clickedLane =
        clicked?.kind === "agent_nbas" ? clicked.laneByLabel?.[label] : undefined;
      const isPlpRefinement =
        clicked?.kind === "agent_nbas" &&
        clicked.stage === "plp" &&
        (clickedLane === "refinement" ||
          clickedLane === "capture" ||
          clickedLane === "crossSell");

      removeMessage(messageId);

      if (isPlpRefinement && activePlpIntentRef.current?.categories?.length) {
        dispatchPlpRefinement(label);
        return;
      }
      dispatchShopperMessage(label);
    },
    [
      dispatchPlpRefinement,
      dispatchShopperMessage,
      removeMessage,
      welcomeRefreshCount,
    ],
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
    // A docked panel lives inside the page flow (like SideBySide), so Escape
    // must not tear it down; the layout owns close. When detached as a modal,
    // Escape re-docks it instead.
    if (docked) {
      if (!detached) return;
      const onDetachedKeyDown = (event: KeyboardEvent) => {
        if (event.key === "Escape") {
          onToggleDetach?.();
        }
      };
      document.addEventListener("keydown", onDetachedKeyDown);
      return () => document.removeEventListener("keydown", onDetachedKeyDown);
    }
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isOpen, docked, detached, onToggleDetach]);

  // Lock background page scroll while the sidecar panel is open.
  // Skipped when docked: the docked panel reflows the page (grid column) and
  // sticks while the storefront scrolls, matching SideBySide.
  useEffect(() => {
    if (docked) return;
    if (!isOpen) return;
    const previousBodyOverflow = document.body.style.overflow;
    const previousDocumentOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousDocumentOverflow;
    };
  }, [isOpen, docked]);

  // Close the sidecar when the shopper clicks outside the panel.
  // Docked panels stay open regardless of outside clicks (layout owns close).
  useEffect(() => {
    if (docked) return;
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
  }, [isOpen, docked]);

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
    // The docked layout renders its own FAB, so the sidecar's own nudge
    // animation is not applicable there.
    if (docked) return;
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
  }, [isOpen, hasUserOpenedFab, docked]);

  // Seed the welcome card the first time the panel opens.
  useEffect(() => {
    if (!isOpen) return;
    if (messages.length > 0) return;
    const welcomeLabels = buildWelcomeNbas(0);
    const welcomeNbasId = nextId("nbas");
    welcomeNbasMessageIdRef.current = welcomeNbasId;
    setWelcomeRefreshCount(0);
    firstShopperTurnHandledRef.current = false;
    const seedMessages: ChatMessage[] = [
      {
        id: nextId("welcome"),
        kind: "agent_simple",
        title: WELCOME_TITLE,
        body: WELCOME_BODY,
        imageUrl: "/Welcome_cover.jpeg",
        imageAlt: "Welcome to the Shiseido store",
        showBrandLogo: true,
      },
      {
        id: welcomeNbasId,
        kind: "agent_nbas",
        regenerateButton: true,
        nbas: buildNbaItems(welcomeLabels, "nba-welcome"),
      },
    ];
    setMessages(seedMessages.map(sanitizeAgentMessage));
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
                showBrandLogo={message.showBrandLogo}
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
                onShowMore={() => handleShowMore(message.id)}
                selectedIds={selectedSet}
                onToggleSelect={handleToggleSelect}
                onAddToCart={(slug) => handleAddToCart(slug, 1)}
                selectionLimitReached={selectedSet.size >= MAX_SELECTED_PRODUCTS}
              />
            );
          case "agent_routine":
            return (
              <AgentRoutineCard
                key={message.id}
                acknowledgement={message.acknowledgement}
                sections={message.sections}
                onShowMore={(sectionIndex) =>
                  handleRoutineShowMore(message.id, sectionIndex)
                }
                selectedIds={selectedSet}
                onToggleSelect={handleToggleSelect}
                onAddToCart={(slug) => handleAddToCart(slug, 1)}
                selectionLimitReached={selectedSet.size >= MAX_SELECTED_PRODUCTS}
                accordion={accordionRecommendations}
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
                rating={message.rating}
                reviewCount={message.reviewCount}
                colors={message.colors}
                sizes={message.sizes}
                onAddToCart={({ quantity }) =>
                  handleAddToCart(message.productSlug, quantity)
                }
                onApplePay={() => handleAddToCart(message.productSlug, 1)}
              />
            );
          case "agent_compare":
            return (
              <AgentCompareCard
                key={message.id}
                intro={message.intro}
                columns={message.columns}
                rows={message.rows}
                recommendation={message.recommendation}
                recommendedSlug={message.recommendedSlug}
                onSelect={handleProductSelect}
                onAddToCart={(slug) => handleAddToCart(slug, 1)}
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
                cartCoupons={message.cartCoupons}
                onApplyPromo={(code) => handleApplyPromo(message.id, code)}
                onRemoveCoupon={(code) => handleRemoveCartCoupon(message.id, code)}
                onQuantityChange={(itemId, quantity) =>
                  handleCartQuantityChange(message.id, itemId, quantity)
                }
                onRemoveItem={(itemId) => handleRemoveCartItem(message.id, itemId)}
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
                className={
                  selectedSet.size > 0 && !message.contextual
                    ? "agent-nba__set--suppressed"
                    : undefined
                }
                onSelect={(nba) =>
                  message.contextual
                    ? handleContextualPill(nba.label, message.productSlug)
                    : handleNbaSelect(message.id, nba.label)
                }
                onRegenerate={() => handleNbaRegenerate(message.id)}
              />
            );
          case "context_separator": {
            const product = getProductBySlug(message.productSlug);
            if (!product) return null;
            return (
              <div
                key={message.id}
                className="sidecar-assistant__context-separator"
              >
                <span className="sidecar-assistant__context-separator-line" />
                <div className="sidecar-assistant__context-separator-chip">
                  <img
                    className="sidecar-assistant__context-separator-thumb"
                    src={product.imageUrl}
                    alt={product.imageAlt}
                  />
                  <span className="sidecar-assistant__context-separator-title">
                    {product.title}
                  </span>
                  <button
                    type="button"
                    className="sidecar-assistant__context-separator-action"
                    aria-label={`More about ${product.title}`}
                    onClick={() => handleProductSelect(message.productSlug)}
                  >
                    <ChevronRightIcon width={16} height={16} />
                  </button>
                </div>
                <span className="sidecar-assistant__context-separator-line" />
              </div>
            );
          }
          default:
            return null;
        }
      }),
    [
      handleAddToCart,
      handleApplyPromo,
      handleCartQuantityChange,
      handleCheckout,
      handleContextualPill,
      handleNbaRegenerate,
      handleNbaSelect,
      handleRemoveCartCoupon,
      handleRemoveCartItem,
      handleRoutineShowMore,
      handleShowMore,
      handleToggleSelect,
      handleProductSelect,
      getProductBySlug,
      selectedSet,
      messages,
      accordionRecommendations,
    ],
  );

  const handleCloseClick = () => {
    if (docked) {
      onRequestClose?.();
      return;
    }
    setIsOpen(false);
  };

  // Close the header options menu on outside click or Escape.
  useEffect(() => {
    if (!isMenuOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsMenuOpen(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isMenuOpen]);

  const handleClearChat = () => {
    setIsMenuOpen(false);
    pendingTimeouts.current.forEach((id) => window.clearTimeout(id));
    pendingTimeouts.current = [];
    welcomeNbasMessageIdRef.current = null;
    firstShopperTurnHandledRef.current = false;
    lastSeparatorSlugRef.current = null;
    setWelcomeRefreshCount(0);
    setSelectedSlugs([]);
    // Emptying the list lets the welcome-seed effect re-run and restore the
    // greeting card + NBA row, matching a fresh session.
    setMessages([]);
  };

  const handleSaveTranscript = () => {
    setIsMenuOpen(false);
    const transcript = buildTranscriptText(messagesRef.current);
    const blob = new Blob([transcript], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    anchor.href = url;
    anchor.download = `shiseido-assistant-transcript-${stamp}.txt`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  };

  const panelBody = (
    <>
      <header className="sidecar-assistant__header">
        <div className="sidecar-assistant__header-title">
          <span className="sidecar-assistant__header-icon" aria-hidden="true">
            <SparkleIcon width={20} height={20} />
          </span>
          <span className="sidecar-assistant__header-label">Personal Assistant</span>
        </div>
        <div className="sidecar-assistant__header-actions">
          <div className="sidecar-assistant__menu" ref={menuRef}>
            <button
              type="button"
              className="sidecar-assistant__header-btn"
              aria-label="More options"
              aria-haspopup="menu"
              aria-expanded={isMenuOpen}
              onClick={() => setIsMenuOpen((open) => !open)}
            >
              <EllipsisVerticalIcon width={20} height={20} />
            </button>
            {isMenuOpen ? (
              <div className="sidecar-assistant__menu-popover" role="menu">
                <button
                  type="button"
                  className="sidecar-assistant__menu-item"
                  role="menuitem"
                  onClick={handleClearChat}
                >
                  <Trash2Icon width={16} height={16} aria-hidden="true" />
                  <span>Clear chat</span>
                </button>
                <button
                  type="button"
                  className="sidecar-assistant__menu-item"
                  role="menuitem"
                  onClick={handleSaveTranscript}
                >
                  <SaveIcon width={14} height={14} aria-hidden="true" />
                  <span>Save session transcript</span>
                </button>
              </div>
            ) : null}
          </div>
          <button
            type="button"
            className="sidecar-assistant__header-btn"
            aria-label={detached ? "Dock assistant" : "Expand"}
            aria-pressed={detached}
            onClick={onToggleDetach}
          >
            {detached ? (
              <ShrinkIcon width={16} height={16} />
            ) : (
              <ExpandIcon width={16} height={16} />
            )}
          </button>
          <button
            type="button"
            className="sidecar-assistant__header-btn"
            aria-label="Close assistant"
            onClick={handleCloseClick}
          >
            <CloseIcon width={20} height={20} />
          </button>
        </div>
      </header>

      {showContextIsland ? (
        <div className="sidecar-assistant__context-island">
          {contextProduct ? (
            <div className="sidecar-assistant__context-island-product">
              <img
                className="sidecar-assistant__context-island-thumb"
                src={contextProduct.imageUrl}
                alt={contextProduct.imageAlt}
              />
              <span className="sidecar-assistant__context-island-title">
                {contextProduct.title}
              </span>
            </div>
          ) : (
            <span />
          )}
          {cartItemCount > 0 ? (
            <button
              type="button"
              className="sidecar-assistant__context-island-cart"
              aria-label={`Cart: ${cartItemCount} item${cartItemCount === 1 ? "" : "s"}`}
              onClick={showCartCard}
            >
              <ShoppingCartIcon width={20} height={20} />
              <span className="sidecar-assistant__context-island-badge">
                {cartItemCount}
              </span>
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="sidecar-assistant__chat-area">
        <div className="sidecar-assistant__chat" ref={chatRef}>
          {renderedMessages}
        </div>
        {!contextIsland && cartItemCount > 0 ? (
          <button
            type="button"
            className="sidecar-assistant__cart-fab sidecar-assistant__context-island-cart"
            aria-label={`Cart: ${cartItemCount} item${cartItemCount === 1 ? "" : "s"}`}
            onClick={showCartCard}
          >
            <ShoppingCartIcon width={20} height={20} />
            <span className="sidecar-assistant__context-island-badge">
              {cartItemCount}
            </span>
          </button>
        ) : null}
      </div>

      <form className="sidecar-assistant__input-bar" onSubmit={handleSubmit}>
        {selectedSlugs.length > 0 ? (
          <div className="sidecar-assistant__selection-tray">
            <div className="sidecar-assistant__selection-header">
              <span className="sidecar-assistant__selection-count">
                {selectedSlugs.length} product
                {selectedSlugs.length === 1 ? "" : "s"} selected ({selectedSlugs.length}/
                {MAX_SELECTED_PRODUCTS})
              </span>
              <button
                type="button"
                className="sidecar-assistant__selection-clear"
                onClick={() => setSelectedSlugs([])}
              >
                Clear
              </button>
            </div>
            <div
              className="sidecar-assistant__selection-pills"
              role="list"
              aria-label="Selected products"
            >
              {selectedSlugs.map((slug) => {
                const product = getProductBySlug(slug);
                if (!product) return null;
                return (
                  <span
                    key={slug}
                    className="sidecar-assistant__selection-pill"
                    role="listitem"
                  >
                    <img
                      className="sidecar-assistant__selection-pill-thumb"
                      src={product.imageUrl}
                      alt={product.imageAlt}
                    />
                    <span className="sidecar-assistant__selection-pill-label">
                      {product.title}
                    </span>
                    <button
                      type="button"
                      className="sidecar-assistant__selection-pill-remove"
                      aria-label={`Remove ${product.title}`}
                      onClick={() => handleRemoveSelected(slug)}
                    >
                      <CloseIcon width={14} height={14} />
                    </button>
                  </span>
                );
              })}
            </div>
            {contextualThreadActive ? null : (
              <AgentNBAs
                nbas={contextualNbas}
                regenerateButton={false}
                onSelect={(nba) => {
                  handleContextualPill(nba.label);
                  setSelectedSlugs([]);
                }}
              />
            )}
          </div>
        ) : null}
        <div className="sidecar-assistant__input-shell">
          <input
            ref={inputRef}
            type="text"
            className="sidecar-assistant__input"
            placeholder={inputPlaceholder}
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
    </>
  );

  // Docked mode: fill the panel supplied by SidecarDockLayout. No floating
  // overlay, no backdrop, no self-owned FAB. The layout drives open/close and
  // the grid reflow, so we always render the panel body here.
  if (docked) {
    return (
      <aside
        ref={panelRef}
        className="sidecar-assistant sidecar-assistant--docked"
        role="complementary"
        aria-label="Personal Assistant"
      >
        {panelBody}
      </aside>
    );
  }

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
          glow with me
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
        {panelBody}
      </aside>
    </>
  );
}

export default SidecarAssistant;
