import {
  ArrowRightIcon,
  CheckIcon,
  PlusIcon,
  StarIcon,
} from "../../icons/StorefrontIcons";
import "./AgentMessageCards.css";

export type AgentProductSwatch = {
  /** CSS color value rendered inside the swatch chip. */
  color: string;
  /** Optional human-readable name (e.g. "Midnight Black"). */
  name?: string;
};

export type AgentProductCardProps = {
  imageUrl: string;
  imageAlt: string;
  title: string;
  /** Formatted price string, e.g. "$15.00". */
  price: string;
  /** Optional formatted strike-through price, e.g. "$20.00". */
  comparePrice?: string;
  /** Optional product description shown beneath the rating row. */
  description?: string;
  /** Optional rating between 0 and 5. Star row is hidden when omitted. */
  rating?: number;
  /** Optional number of reviews shown next to the rating. */
  reviewCount?: number;
  /** Optional list of color swatches. The first is treated as selected. */
  swatches?: AgentProductSwatch[];
  /** Optional badge label rendered on top of the gallery (e.g. "Sale"). */
  badgeLabel?: string;
  /** Optional click handler for the card. */
  onSelect?: () => void;
  /** Optional click handler for the wishlist (heart) button. */
  onWishlist?: () => void;
  /** Optional click handler for the store / building button. */
  onStoreInfo?: () => void;
  /** When true, the card's checkbox control renders as selected. */
  selected?: boolean;
  /** Toggle handler for the card's selection checkbox. */
  onToggleSelect?: () => void;
  /** When true, the selection checkbox is disabled (selection cap hit). */
  selectDisabled?: boolean;
};

/** Compact rating row: numeric rating, a star, and the review count. */
function StarRow({ rating, reviewCount }: { rating: number; reviewCount?: number }) {
  const clamped = Math.max(0, Math.min(5, rating));
  const ratingLabel = clamped.toFixed(1);
  return (
    <div
      className="agent-stars"
      role="img"
      aria-label={
        typeof reviewCount === "number"
          ? `Rated ${ratingLabel} out of 5 stars from ${reviewCount} reviews`
          : `Rated ${ratingLabel} out of 5 stars`
      }
    >
      <span className="agent-stars__rating">{ratingLabel}</span>
      <StarIcon width={12} height={12} className="agent-stars__icon" />
      {typeof reviewCount === "number" ? (
        <span className="agent-stars__reviews">({reviewCount} reviews)</span>
      ) : null}
    </div>
  );
}

/** Renders up to 3 swatches plus a "+N" tile when more colors are available. */
function SwatchRow({ swatches }: { swatches: AgentProductSwatch[] }) {
  if (swatches.length === 0) return null;
  const visible = swatches.slice(0, 3);
  const hasMore = swatches.length > 3;
  return (
    <div className="agent-product-card__swatches" aria-hidden="true">
      {visible.map((swatch, index) => (
        <span
          key={`${swatch.color}-${index}`}
          className={
            "agent-swatch" + (index === 0 ? " agent-swatch--selected" : "")
          }
          style={{ ["--swatch-color" as string]: swatch.color }}
          title={swatch.name}
        />
      ))}
      {hasMore ? (
        <span className="agent-swatch agent-swatch--more">
          <PlusIcon width={10} height={10} />
        </span>
      ) : null}
    </div>
  );
}

/**
 * AgentProductCard — single product tile rendered inside the agentic
 * PLP carousel.  Mirrors `Agentic Product Card / Type=Product Card`
 * (node-id 32748:34714).
 */
export function AgentProductCard({
  imageUrl,
  imageAlt,
  title,
  price,
  comparePrice,
  rating,
  reviewCount,
  swatches,
  onSelect,
  selected,
  onToggleSelect,
  selectDisabled,
}: AgentProductCardProps) {
  return (
    <article
      className="agent-product-card"
      data-component="agent-product-card"
      onClick={onSelect}
    >
      <div className="agent-product-card__gallery">
        <img src={imageUrl} alt={imageAlt} />
        <button
          type="button"
          className={
            "agent-product-card__icon-btn agent-product-card__store-btn" +
            (selected ? " agent-product-card__store-btn--selected" : "") +
            (selectDisabled ? " agent-product-card__store-btn--disabled" : "")
          }
          aria-label={selected ? "Deselect product" : "Select product"}
          aria-pressed={selected}
          disabled={selectDisabled}
          onClick={(event) => {
            event.stopPropagation();
            if (selectDisabled) return;
            onToggleSelect?.();
          }}
        >
          <span className="agent-product-card__check" aria-hidden="true">
            <CheckIcon width={13} height={13} />
          </span>
        </button>
      </div>

      <div className="agent-product-card__content">
        {swatches && swatches.length > 0 ? <SwatchRow swatches={swatches} /> : null}

        <h4 className="agent-product-card__title">{title}</h4>

        {typeof rating === "number" ? (
          <StarRow rating={rating} reviewCount={reviewCount} />
        ) : null}

        <div className="agent-product-card__price-row">
          <p className="agent-product-card__price">{price.replace(/^From\s+/i, "")}</p>
          {comparePrice ? (
            <p className="agent-product-card__price--strike">{comparePrice}</p>
          ) : null}
        </div>
      </div>
    </article>
  );
}

export type AgentShowMoreCardProps = {
  /** Title shown beneath the plus icon. Defaults to "Show more". */
  title?: string;
  /** Body copy shown beneath the title. */
  body?: string;
  /** Click handler invoked when the card is pressed. */
  onSelect?: () => void;
};

/**
 * AgentShowMoreCard — terminal tile inside the PLP carousel.  Mirrors
 * `Agentic Product Card / Type=Show more card` (node-id 32748:34734).
 */
export function AgentShowMoreCard({
  title = "Show more",
  body = "See more similar products to these.",
  onSelect,
}: AgentShowMoreCardProps) {
  return (
    <article
      className="agent-product-card agent-product-card--show-more"
      data-component="agent-show-more-card"
      onClick={onSelect}
    >
      <span className="agent-product-card__show-more-icon" aria-hidden="true">
        <PlusIcon width={20} height={20} />
      </span>
      <p className="agent-product-card__show-more-title">{title}</p>
      <p className="agent-product-card__show-more-body">{body}</p>
    </article>
  );
}

/** Re-export the right-arrow used inside the PLP card carousel buttons. */
export { ArrowRightIcon };
