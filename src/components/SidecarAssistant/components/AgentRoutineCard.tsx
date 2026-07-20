import {
  AgentProductCarousel,
  type AgentCarouselProduct,
} from "./AgentProductCarousel";
import "./AgentMessageCards.css";

export type AgentRoutineSection = {
  /** Ordinal step label, e.g. "1. Cleanse". */
  stepLabel: string;
  /** Human category title, e.g. "Cleansers". */
  categoryTitle: string;
  /** Concern/skin-type aware description shown under the heading. */
  description: string;
  /** Products shown in this section's carousel. */
  products: AgentCarouselProduct[];
  /** When true, append the "Show more" tile to this section's carousel. */
  showMoreCard?: boolean;
};

export type AgentRoutineCardProps = {
  /** Empathetic opener shown at the top of the card. */
  acknowledgement: string;
  /** Ordered routine steps, each rendered as a section with its own carousel. */
  sections: AgentRoutineSection[];
  /** Invoked with the section index when that section's "Show more" is tapped. */
  onShowMore?: (sectionIndex: number) => void;
  /** Set of product ids currently selected (drives each card's checkbox). */
  selectedIds?: Set<string>;
  /** Toggle handler invoked with the product id when its checkbox is clicked. */
  onToggleSelect?: (id: string) => void;
  /** Add-to-cart handler invoked with the product id. */
  onAddToCart?: (id: string) => void;
  /** When true, unselected cards' checkboxes are disabled (selection cap hit). */
  selectionLimitReached?: boolean;
  /** Optional class name appended to the root element. */
  className?: string;
};

/**
 * AgentRoutineCard is the broad-intent "routine" card: a single card that
 * opens with an acknowledgement, then walks the shopper through the ordered
 * routine steps (Cleanse -> Soften -> Treat -> Moisturize -> Protect). Each
 * step shows a category title, a short description, and a product carousel
 * that reuses the shared `AgentProductCarousel` (including the 5 + "Show more"
 * paging behaviour).
 */
export function AgentRoutineCard({
  acknowledgement,
  sections,
  onShowMore,
  selectedIds,
  onToggleSelect,
  onAddToCart,
  selectionLimitReached,
  className,
}: AgentRoutineCardProps) {
  if (sections.length === 0) return null;

  const rootClass = "agent-routine__card" + (className ? " " + className : "");

  return (
    <article className={rootClass} data-component="agent-routine-card">
      <p className="agent-routine__acknowledgement">{acknowledgement}</p>

      {sections.map((section, index) => (
        <section key={section.categoryTitle} className="agent-routine__section">
          <header className="agent-routine__section-header">
            <h3 className="agent-routine__step">{section.stepLabel}</h3>
          </header>
          <p className="agent-routine__description">{section.description}</p>
          <AgentProductCarousel
            products={section.products}
            showMoreCard={Boolean(section.showMoreCard)}
            onShowMore={() => onShowMore?.(index)}
            selectedIds={selectedIds}
            onToggleSelect={onToggleSelect}
            onAddToCart={onAddToCart}
            selectionLimitReached={selectionLimitReached}
          />
        </section>
      ))}
    </article>
  );
}

export default AgentRoutineCard;
