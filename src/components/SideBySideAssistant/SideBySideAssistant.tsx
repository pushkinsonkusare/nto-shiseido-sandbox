import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ROUTES,
  usePrototypeNavigation,
  type AppRoute,
} from "../../prototypeRoutes";
import type { PdpNbaPillKind } from "../../pages/ProductDetailPage/pdpNbaPills";
import { classifyIntent } from "../SidecarAssistant/conversation/flow";
import {
  AgentPdpUtterance,
  AgentUtterance,
  AssistantHeader,
  BroadResultCard,
  CompactResultCard,
  FooterInput,
  GreetingCard,
  LatencyLoader,
  NbaPillRow,
  ShopperBubble,
  type SeeResultsScope,
} from "./components";
import { useSideBySideAgent } from "./conversation/useSideBySideAgent";
import { useSideBySidePanel } from "./SideBySidePanelContext";
import "./SideBySideAssistant.css";

const TALL_CARD_VIEWPORT_RATIO = 0.92;
const TALL_CARD_ANCHOR_RATIO = 0.6;
const TALL_CARD_TOP_INSET_PX = 16;
const TALL_CARD_SETTLE_TIMEOUT_MS = 140;

function normalizeTagList(tags: string[] | undefined): string[] {
  if (!tags || tags.length === 0) return [];
  return [...tags]
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)
    .sort();
}

/**
 * The PLP reflects a card's scope when route + filters line up. Used
 * to keep the "Viewing" label honest even when the shopper hops
 * between rows of a broad card or filters the storefront outside of
 * the assistant flow.
 *
 * For recipe-driven rows the comparison short-circuits on `recipeKey`:
 * if both URL and card carry the same id we trust them. Otherwise we
 * compare the legacy category + useCases + role triple.
 */
function isPlpShowingCardScope(
  route: AppRoute,
  urlCategory: string | null,
  urlUseCases: string[],
  urlAccessoryRole: string | null,
  urlRecipeKey: string | null,
  urlCompatibleWith: string | null,
  urlTier: string | null,
  urlPriceMax: number | null,
  urlPriceMin: number | null,
  urlSubtypes: string[],
  cardScope: SeeResultsScope,
): boolean {
  if (route !== ROUTES.productListing) return false;

  const cardRecipe = cardScope.recipeKey?.trim() ?? "";
  const urlRecipe = urlRecipeKey?.trim() ?? "";
  if (cardRecipe || urlRecipe) {
    return cardRecipe === urlRecipe;
  }

  const url = urlCategory?.trim().toLowerCase() ?? "";
  const card = cardScope.category?.trim().toLowerCase() ?? "";
  if (!card && url) return false;
  if (card && !url) return false;
  if (card && url && !(url === card || url.includes(card) || card.includes(url))) {
    return false;
  }

  const urlTags = normalizeTagList(urlUseCases);
  const cardTags = normalizeTagList(cardScope.capabilities);
  if (urlTags.length !== cardTags.length) return false;
  for (let i = 0; i < urlTags.length; i++) {
    if (urlTags[i] !== cardTags[i]) return false;
  }

  const urlRole = urlAccessoryRole?.trim().toLowerCase() ?? "";
  const cardRole = cardScope.accessoryRole?.trim().toLowerCase() ?? "";
  if (urlRole !== cardRole) return false;

  const urlCompat = urlCompatibleWith?.trim().toLowerCase() ?? "";
  const cardCompat = cardScope.compatibleWith?.trim().toLowerCase() ?? "";
  if (urlCompat !== cardCompat) return false;

  const urlTierLc = urlTier?.trim().toLowerCase() ?? "";
  const cardTierLc = cardScope.tier?.trim().toLowerCase() ?? "";
  if (urlTierLc !== cardTierLc) return false;

  const urlMax = urlPriceMax ?? null;
  const cardMax =
    typeof cardScope.priceMax === "number" ? cardScope.priceMax : null;
  if (urlMax !== cardMax) return false;

  const urlMin = urlPriceMin ?? null;
  const cardMin =
    typeof cardScope.priceMin === "number" ? cardScope.priceMin : null;
  if (urlMin !== cardMin) return false;

  const urlSubs = normalizeTagList(urlSubtypes);
  const cardSubs = normalizeTagList(cardScope.subtypes);
  if (urlSubs.length !== cardSubs.length) return false;
  for (let i = 0; i < urlSubs.length; i++) {
    if (urlSubs[i] !== cardSubs[i]) return false;
  }

  return true;
}

export function SideBySideAssistant() {
  const { closePanel, pendingPrompt, setPendingPrompt } = useSideBySidePanel();
  const {
    navigate,
    currentRoute,
    currentProductSlug,
    currentCategory,
    currentUseCases,
    currentAccessoryRole,
    currentRecipeKey,
    currentCompatibleWith,
    currentTier,
    currentPriceMax,
    currentPriceMin,
    currentSubtypes,
    currentSlugs,
  } = usePrototypeNavigation();
  const {
    messages,
    isResponding,
    dispatchShopperMessage,
    clearChat,
    saveChat,
  } = useSideBySideAgent();

  const chatRef = useRef<HTMLDivElement>(null);
  const previousMessageIdsRef = useRef<string[]>([]);

  /* ---------- which result card is currently driving the PLP ---------- */
  // Exactly one card at a time owns the "Viewing" label: the card whose
  // `See Results` button (or `Show all` footer, for broad cards) the
  // shopper most recently clicked. New result cards no longer auto-push
  // their scope onto the PLP — the assistant stays in the chat surface
  // until the shopper explicitly hands off.
  const [viewingCardId, setViewingCardId] = useState<string | null>(null);

  /* ---------- "See Results" handoff ---------- */

  const handleSeeResults = useCallback(
    (cardId: string, scope: SeeResultsScope) => {
      setViewingCardId(cardId);
      const hasScope =
        Boolean(scope.category) ||
        (scope.capabilities && scope.capabilities.length > 0) ||
        Boolean(scope.accessoryRole) ||
        Boolean(scope.recipeKey) ||
        Boolean(scope.compatibleWith) ||
        Boolean(scope.tier) ||
        typeof scope.priceMax === "number" ||
        typeof scope.priceMin === "number" ||
        (scope.subtypes && scope.subtypes.length > 0);
      navigate(ROUTES.productListing, hasScope ? scope : undefined);
    },
    [navigate],
  );

  /* ---------- clear "Viewing" when the PLP no longer matches ---------- */
  // If the shopper navigates away from the PLP, or filters the storefront
  // outside of the assistant flow, the active card is no longer "what
  // you're viewing" — drop the label so every card reverts to `See Results`.
  // The viewing id can refer to either an `agent_result_card` (specific
  // search) or a row inside an `agent_broad_result_card` (broad search).
  useEffect(() => {
    if (!viewingCardId) return;
    let activeScope: SeeResultsScope | undefined;
    let isShowAllCard = false;
    const showAllUnion: string[] = [];
    for (const m of messages) {
      if (m.kind === "agent_result_card" && m.id === viewingCardId) {
        activeScope = {
          category: m.category,
          capabilities: m.useCases,
          compatibleWith: m.compatibleWith,
          tier: m.tier,
          priceMax: m.priceMax,
          priceMin: m.priceMin,
          subtypes: m.subtypes,
        };
        break;
      }
      if (m.kind === "agent_broad_result_card") {
        // The broad card itself owns the viewing label only when the
        // shopper clicked its "Show all" button — otherwise the row
        // owns it. Detect by id match on the outer card.
        if (m.id === viewingCardId) {
          isShowAllCard = true;
          const seen = new Set<string>();
          for (const row of m.rows) {
            for (const slug of row.productSlugs) {
              if (seen.has(slug)) continue;
              seen.add(slug);
              showAllUnion.push(slug);
            }
          }
          break;
        }
        const row = m.rows.find((r) => r.id === viewingCardId);
        if (row) {
          activeScope = {
            category: row.category,
            capabilities: row.capabilities,
            accessoryRole: row.accessoryRole,
            recipeKey: row.recipeKey,
          };
          break;
        }
      }
    }
    if (isShowAllCard) {
      // The PLP is "showing" this broad card iff the URL carries the
      // exact slug union we sent. Cheaper than the legacy filter
      // comparison and exactly matches the navigate() call we made.
      if (currentRoute !== ROUTES.productListing) {
        setViewingCardId(null);
        return;
      }
      if (currentSlugs.length === 0 || currentSlugs.length !== showAllUnion.length) {
        setViewingCardId(null);
        return;
      }
      const wanted = new Set(showAllUnion);
      for (const s of currentSlugs) {
        if (!wanted.has(s)) {
          setViewingCardId(null);
          return;
        }
      }
      return;
    }
    if (!activeScope) {
      setViewingCardId(null);
      return;
    }
    if (
      !isPlpShowingCardScope(
        currentRoute,
        currentCategory,
        currentUseCases,
        currentAccessoryRole,
        currentRecipeKey,
        currentCompatibleWith,
        currentTier,
        currentPriceMax,
        currentPriceMin,
        currentSubtypes,
        activeScope,
      )
    ) {
      setViewingCardId(null);
    }
  }, [
    viewingCardId,
    messages,
    currentRoute,
    currentCategory,
    currentUseCases,
    currentAccessoryRole,
    currentRecipeKey,
    currentCompatibleWith,
    currentTier,
    currentPriceMax,
    currentPriceMin,
    currentSubtypes,
    currentSlugs,
  ]);

  /* ---------- PDP-aware dispatch wrapper ---------- */
  // When the shopper is on a PDP, free-typed input (FooterInput) and chip
  // taps (NbaPillRow) should ground on the active product — but ONLY for
  // questions that look like product FAQs ("what's in the box", "is this
  // beginner-friendly", "battery life?"). Shopping / discovery prompts
  // ("gear for moto vlogging", "show me cinema drones", "compare to X",
  // "what's the return policy") must keep flowing through the regular
  // broad / direct intent classifier so they land on a multi-row recipe
  // card or category PLP carousel, regardless of which PDP is on screen.
  //
  // We use `classifyIntent` (already powering the rule-based agent) as
  // the gate: `broad` and `direct` queries → plain dispatch; `empty`
  // (no shopping signal) on a PDP → PDP-faq routing.
  //
  // External callers that already pass an explicit ctx (the
  // `pendingPrompt` consumer below for PDP NBA pills) keep their
  // pill-specific kind (`open`/`hygiene`/`upsell`/…) untouched.
  const dispatchOnPage = useCallback(
    (
      text: string,
      ctx?: { productSlug?: string; pillKind?: PdpNbaPillKind },
    ) => {
      if (ctx) {
        dispatchShopperMessage(text, ctx);
        return;
      }
      const onPdp =
        currentRoute === ROUTES.productDetail && Boolean(currentProductSlug);
      const isShoppingQuery = classifyIntent(text).kind !== "empty";
      if (onPdp && !isShoppingQuery) {
        dispatchShopperMessage(text, {
          productSlug: currentProductSlug!,
          pillKind: "faq",
        });
        return;
      }
      dispatchShopperMessage(text);
    },
    [dispatchShopperMessage, currentRoute, currentProductSlug],
  );

  /* ---------- consume external prompt (e.g. PDP NBA pills) ---------- */
  // The PDP fires `agentic:ask-assistant` with a prompt. The layout opens the
  // panel and stashes the prompt; we dispatch it here once the assistant has
  // mounted so the chat picks up exactly one shopper turn for the click.
  //
  // The token guard makes the consumer idempotent: React 18 StrictMode
  // intentionally re-runs effects after a synthetic remount on first mount,
  // which otherwise replays this effect with the same `pendingPrompt`
  // closure and produces a duplicate shopper turn + agent response.
  const consumedPromptTokenRef = useRef<number | null>(null);
  useEffect(() => {
    if (!pendingPrompt) return;
    if (consumedPromptTokenRef.current === pendingPrompt.token) return;
    consumedPromptTokenRef.current = pendingPrompt.token;
    dispatchShopperMessage(pendingPrompt.prompt, {
      productSlug: pendingPrompt.productSlug,
      pillKind: pendingPrompt.pillKind,
    });
    setPendingPrompt(null);
  }, [pendingPrompt, dispatchShopperMessage, setPendingPrompt]);

  /* ---------- hybrid auto-scroll for fresh card blocks ---------- */

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

    const stack = node.firstElementChild as HTMLElement | null;
    if (!stack) {
      previousMessageIdsRef.current = currentIds;
      return;
    }

    const appendedCount = currentIds.length - commonPrefix;
    if (appendedCount <= 0) {
      previousMessageIdsRef.current = currentIds;
      return;
    }

    const children = Array.from(stack.children) as HTMLElement[];
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

  /* ---------- collapse repeated PDP context headers ---------- */
  // The mini product card on `AgentPdpUtterance` is helpful the FIRST
  // time we land on a product, but repetitive when the shopper asks
  // multiple follow-ups about the same SKU. Walk the message list and
  // record only the ids that should display the context header:
  //
  //   - First `agent_pdp_utterance` for a given productSlug → show.
  //   - Subsequent same-slug utterances → hide (inherit visual context).
  //   - Flow scaffolding (shopper / loader / nba pills) keeps the streak.
  //   - Any content message that signals the conversation moved off the
  //     current product (greeting, agent_text, result cards, broad
  //     cards) resets the streak so the next PDP utterance re-anchors.
  const pdpContextHeaderIds = useMemo(() => {
    const ids = new Set<string>();
    let lastSlug: string | null = null;
    for (const m of messages) {
      switch (m.kind) {
        case "agent_pdp_utterance":
          if (m.productSlug !== lastSlug) {
            ids.add(m.id);
            lastSlug = m.productSlug;
          }
          break;
        case "shopper":
        case "agent_loading":
        case "agent_nbas":
          break;
        default:
          lastSlug = null;
      }
    }
    return ids;
  }, [messages]);

  return (
    <div className="sxs-assistant" role="complementary">
      <AssistantHeader
        onCloseClick={closePanel}
        onClearChat={clearChat}
        onSaveChat={saveChat}
      />

      <div className="sxs-assistant__chat" ref={chatRef}>
        <div className="sxs-assistant__chat-stack">
          {messages.map((message) => {
            switch (message.kind) {
              case "greeting":
                return (
                  <GreetingCard
                    key={message.id}
                    imageUrl={message.imageUrl}
                    imageAlt={message.imageAlt}
                    greeting={message.greeting}
                    body={message.body}
                  />
                );
              case "shopper":
                return <ShopperBubble key={message.id} text={message.text} />;
              case "agent_text":
                return (
                  <AgentUtterance key={message.id} text={message.body} />
                );
              case "agent_pdp_utterance":
                return (
                  <AgentPdpUtterance
                    key={message.id}
                    productSlug={message.productSlug}
                    body={message.body}
                    cta={message.cta}
                    showContext={pdpContextHeaderIds.has(message.id)}
                  />
                );
              case "agent_loading":
                return (
                  <LatencyLoader
                    key={message.id}
                    variant={message.variant ?? "thinking"}
                  />
                );
              case "agent_result_card":
                return (
                  <CompactResultCard
                    key={message.id}
                    bodyText={message.bodyText}
                    title={message.title}
                    products={message.products}
                    totalResultCount={message.totalResultCount}
                    isViewing={message.id === viewingCardId}
                    onSeeResults={() =>
                      handleSeeResults(message.id, {
                        category: message.category,
                        capabilities: message.useCases,
                        compatibleWith: message.compatibleWith,
                        tier: message.tier,
                        priceMax: message.priceMax,
                        priceMin: message.priceMin,
                        subtypes: message.subtypes,
                      })
                    }
                  />
                );
              case "agent_broad_result_card":
                return (
                  <BroadResultCard
                    key={message.id}
                    bodyText={message.bodyText}
                    rows={message.rows}
                    viewingRowId={viewingCardId}
                    onSeeRowResults={(rowId, scope) =>
                      handleSeeResults(rowId, scope)
                    }
                    onShowAll={() => {
                      // Aggregate the union of every row's slugs and
                      // hand that to the PLP — preserves card order
                      // (FPV drones first, then batteries, etc.) and
                      // de-dupes any product that appears in two rows.
                      const seen = new Set<string>();
                      const unionSlugs: string[] = [];
                      for (const row of message.rows) {
                        for (const slug of row.productSlugs) {
                          if (seen.has(slug)) continue;
                          seen.add(slug);
                          unionSlugs.push(slug);
                        }
                      }
                      if (unionSlugs.length === 0) {
                        navigate(ROUTES.productListing);
                        return;
                      }
                      setViewingCardId(message.id);
                      navigate(ROUTES.productListing, {
                        slugs: unionSlugs,
                      });
                    }}
                  />
                );
              case "agent_nbas":
                return (
                  <NbaPillRow
                    key={message.id}
                    pills={message.pills}
                    onSelect={(pill) => dispatchOnPage(pill.label)}
                  />
                );
              default:
                return null;
            }
          })}
        </div>
      </div>

      <FooterInput
        disabled={isResponding}
        onSubmit={dispatchOnPage}
      />
    </div>
  );
}

export default SideBySideAssistant;
