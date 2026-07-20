import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeftIcon, ArrowRightIcon } from "../../icons/StorefrontIcons";
import {
  AgentProductCard,
  AgentShowMoreCard,
  type AgentProductCardProps,
} from "./AgentProductCard";
import "./AgentMessageCards.css";

export type AgentPLPProduct = AgentProductCardProps & {
  /** Stable id used as the React key. */
  id: string;
};

export type AgentPLPCardProps = {
  /** Body copy rendered above the carousel (the agent's message). */
  intro: string;
  /** Products rendered inside the horizontal carousel. */
  products: AgentPLPProduct[];
  /** When true, appends the "Show more" terminal card to the carousel. */
  showMoreCard?: boolean;
  /** Click handler invoked when the user activates the "Show more" card. */
  onShowMore?: () => void;
  /** Set of product ids currently selected (drives each card's checkbox). */
  selectedIds?: Set<string>;
  /** Toggle handler invoked with the product id when its checkbox is clicked. */
  onToggleSelect?: (id: string) => void;
  /** Add-to-cart handler invoked with the product id when a card's cart icon
   * button is clicked. Cart button is hidden when omitted. */
  onAddToCart?: (id: string) => void;
  /** When true, unselected cards' checkboxes are disabled (selection cap hit). */
  selectionLimitReached?: boolean;
  /** Optional class name appended to the root element. */
  className?: string;
};

/** Fallback used only when the rendered gap cannot be measured. */
const FALLBACK_GAP = 12;

/**
 * AgentPLPCard is the agentic Product List Page card rendered inside the
 * SidecarAssistant chat panel.  Mirrors `Agent/PLP_Card` (node-id 32748:34667).
 */
export function AgentPLPCard({
  intro,
  products,
  showMoreCard = true,
  onShowMore,
  selectedIds,
  onToggleSelect,
  onAddToCart,
  selectionLimitReached,
  className,
}: AgentPLPCardProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);

  const updateEdges = useCallback(() => {
    const node = trackRef.current;
    if (!node) return;
    const maxScroll = node.scrollWidth - node.clientWidth;
    setAtStart(node.scrollLeft <= 1);
    setAtEnd(node.scrollLeft >= maxScroll - 1);
  }, []);

  const scroll = (direction: "left" | "right") => {
    const node = trackRef.current;
    if (!node) return;
    const firstCard = node.children[0] as HTMLElement | undefined;
    const cardWidth = firstCard?.getBoundingClientRect().width ?? node.clientWidth;
    const gap = parseFloat(getComputedStyle(node).columnGap) || FALLBACK_GAP;
    const step = cardWidth + gap;
    node.scrollBy({
      left: direction === "left" ? -step : step,
      behavior: "smooth",
    });
  };

  useEffect(() => {
    updateEdges();
    const node = trackRef.current;
    if (!node) return;
    node.addEventListener("scroll", updateEdges, { passive: true });
    window.addEventListener("resize", updateEdges);
    return () => {
      node.removeEventListener("scroll", updateEdges);
      window.removeEventListener("resize", updateEdges);
    };
  }, [updateEdges, products]);

  const rootClass = "agent-plp__card" + (className ? " " + className : "");

  return (
    <article className={rootClass} data-component="agent-plp-card">
      <p className="agent-plp__intro">{intro}</p>

      <div className="agent-plp__carousel">
        <button
          type="button"
          className="agent-plp__nav agent-plp__nav--prev"
          aria-label="Previous products"
          onClick={() => scroll("left")}
          disabled={atStart}
        >
          <ArrowLeftIcon width={16} height={16} />
        </button>
        <button
          type="button"
          className="agent-plp__nav agent-plp__nav--next"
          aria-label="Next products"
          onClick={() => scroll("right")}
          disabled={atEnd}
        >
          <ArrowRightIcon width={16} height={16} />
        </button>

        <div className="agent-plp__track" ref={trackRef}>
          {products.map((product) => (
            <AgentProductCard
              key={product.id}
              imageUrl={product.imageUrl}
              imageAlt={product.imageAlt}
              title={product.title}
              price={product.price}
              comparePrice={product.comparePrice}
              description={product.description}
              rating={product.rating}
              reviewCount={product.reviewCount}
              swatches={product.swatches}
              badgeLabel={product.badgeLabel}
              onSelect={product.onSelect}
              onAddToCart={
                onAddToCart ? () => onAddToCart(product.id) : undefined
              }
              onWishlist={product.onWishlist}
              selected={selectedIds?.has(product.id)}
              onToggleSelect={() => onToggleSelect?.(product.id)}
              selectDisabled={
                selectionLimitReached && !selectedIds?.has(product.id)
              }
            />
          ))}
          {showMoreCard ? <AgentShowMoreCard onSelect={onShowMore} /> : null}
        </div>
      </div>
    </article>
  );
}

export default AgentPLPCard;
