import {
  ArrowRightIcon,
  BuildingIcon,
  HeartIcon,
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
};

/** Five-star rating row matching the agentic PLP design. */
function StarRow({ rating }: { rating: number }) {
  const filled = Math.max(0, Math.min(5, Math.round(rating)));
  return (
    <div
      className="agent-stars"
      role="img"
      aria-label={`${filled} out of 5 stars`}
    >
      {Array.from({ length: 5 }).map((_, index) => (
        <StarIcon
          key={index}
          width={12}
          height={12}
          className={
            index < filled
              ? "agent-stars__icon"
              : "agent-stars__icon agent-stars__icon--empty"
          }
        />
      ))}
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
  description,
  rating,
  swatches,
  badgeLabel,
  onSelect,
  onWishlist,
  onStoreInfo,
}: AgentProductCardProps) {
  return (
    <article
      className="agent-product-card"
      data-component="agent-product-card"
      onClick={onSelect}
    >
      <div className="agent-product-card__gallery">
        <img src={imageUrl} alt={imageAlt} />
        {badgeLabel ? (
          <span className="agent-product-card__badge">{badgeLabel}</span>
        ) : null}
        <div className="agent-product-card__icon-stack">
          <button
            type="button"
            className="agent-product-card__icon-btn"
            aria-label="View store availability"
            onClick={(event) => {
              event.stopPropagation();
              onStoreInfo?.();
            }}
          >
            <BuildingIcon width={16} height={16} />
          </button>
          <button
            type="button"
            className="agent-product-card__icon-btn"
            aria-label="Add to wishlist"
            onClick={(event) => {
              event.stopPropagation();
              onWishlist?.();
            }}
          >
            <HeartIcon width={16} height={16} />
          </button>
        </div>
      </div>

      <div className="agent-product-card__content">
        {swatches && swatches.length > 0 ? <SwatchRow swatches={swatches} /> : null}

        <h4 className="agent-product-card__title">{title}</h4>

        {typeof rating === "number" ? <StarRow rating={rating} /> : null}

        <div className="agent-product-card__price-row">
          <p className="agent-product-card__price">{price}</p>
          {comparePrice ? (
            <p className="agent-product-card__price--strike">{comparePrice}</p>
          ) : null}
        </div>

        {description ? (
          <p className="agent-product-card__desc">{description}</p>
        ) : null}
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
