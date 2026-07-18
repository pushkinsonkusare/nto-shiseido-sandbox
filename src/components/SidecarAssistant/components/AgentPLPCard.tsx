import { useRef } from "react";
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
  /** Optional class name appended to the root element. */
  className?: string;
};

const SCROLL_DELTA = 300;

/**
 * AgentPLPCard — agentic Product List Page card rendered inside the
 * SidecarAssistant chat panel.  Mirrors `Agent/PLP_Card` (node-id 32748:34667).
 */
export function AgentPLPCard({
  intro,
  products,
  showMoreCard = true,
  onShowMore,
  className,
}: AgentPLPCardProps) {
  const trackRef = useRef<HTMLDivElement>(null);

  const scroll = (direction: "left" | "right") => {
    const node = trackRef.current;
    if (!node) return;
    const delta = direction === "left" ? -SCROLL_DELTA : SCROLL_DELTA;
    node.scrollBy({ left: delta, behavior: "smooth" });
  };

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
        >
          <ArrowLeftIcon width={16} height={16} />
        </button>
        <button
          type="button"
          className="agent-plp__nav agent-plp__nav--next"
          aria-label="Next products"
          onClick={() => scroll("right")}
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
              swatches={product.swatches}
              badgeLabel={product.badgeLabel}
              onSelect={product.onSelect}
              onWishlist={product.onWishlist}
              onStoreInfo={product.onStoreInfo}
            />
          ))}
          {showMoreCard ? <AgentShowMoreCard onSelect={onShowMore} /> : null}
        </div>
      </div>
    </article>
  );
}

export default AgentPLPCard;
