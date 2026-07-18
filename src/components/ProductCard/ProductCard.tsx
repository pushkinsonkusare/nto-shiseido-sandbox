import "./ProductCard.css";
import { ArrowRightIcon, BuildingIcon, HeartIcon } from "../icons/StorefrontIcons";

export type ProductCardProps = {
  imageUrl: string;
  imageAlt: string;
  brand: string;
  category: string;
  title: string;
  price: string;
  description: string;
  badgeLabel?: string;
  rating?: number | null;
  reviewCount?: number | null;
  swatches?: string[];
  selectedSwatch?: number;
  showStars?: boolean;
  onSelect?: () => void;
};

function renderStars(rating: number | null | undefined) {
  const filledStars = Math.max(0, Math.min(5, Math.round(rating ?? 0)));

  return Array.from({ length: 5 }).map((_, index) => (
    <span key={`star-${index}`} className={index < filledStars ? undefined : "figma-product-card__star-muted"}>
      ★
    </span>
  ));
}

export function ProductCard({
  imageUrl,
  imageAlt,
  brand,
  category,
  title,
  price,
  description,
  badgeLabel = "Featured",
  rating = null,
  reviewCount = null,
  swatches = [],
  selectedSwatch = 0,
  showStars = true,
  onSelect,
}: ProductCardProps) {
  const visibleSwatches = swatches.slice(0, 4);
  const extraSwatches = Math.max(0, swatches.length - visibleSwatches.length);

  return (
    <article
      className={`figma-product-card${onSelect ? " figma-product-card--interactive" : ""}`}
      onClick={onSelect}
      onKeyDown={
        onSelect
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelect();
              }
            }
          : undefined
      }
      role={onSelect ? "button" : undefined}
      tabIndex={onSelect ? 0 : undefined}
    >
      <div className="figma-product-card__gallery">
        <div className="figma-product-card__image-wrap">
          <img className="figma-product-card__image" src={imageUrl} alt={imageAlt} />
        </div>
        <div className="figma-product-card__badge-row" aria-hidden="true">
          {onSelect ? <span className="figma-product-card__hover-checkbox" /> : null}
          <div className="figma-product-card__badge">{badgeLabel}</div>
        </div>
        <div className="figma-product-card__actions" aria-hidden="true">
          <span className="figma-product-card__icon-btn">
            <BuildingIcon width={16} height={16} />
          </span>
          <span className="figma-product-card__icon-btn">
            <HeartIcon width={16} height={16} />
          </span>
        </div>
        {onSelect ? (
          <>
            <span className="figma-product-card__carousel-btn figma-product-card__carousel-btn--prev" aria-hidden="true">
              <ArrowRightIcon width={16} height={16} />
            </span>
            <span className="figma-product-card__carousel-btn figma-product-card__carousel-btn--next" aria-hidden="true">
              <ArrowRightIcon width={16} height={16} />
            </span>
            <div className="figma-product-card__hover-cta" aria-hidden="true">
              View details
            </div>
          </>
        ) : null}
      </div>

      <header className="figma-product-card__content">
        {swatches.length > 0 && (
          <div className="figma-product-card__swatches" aria-label="Color options">
            {visibleSwatches.map((color, index) => {
              const isSelected = index === selectedSwatch;
              return (
                <span
                  key={`${color}-${index}`}
                  className={`figma-product-card__swatch ${isSelected ? "is-selected" : ""}`}
                  style={{ ["--swatch-color" as string]: color }}
                  aria-hidden="true"
                />
              );
            })}
            {extraSwatches > 0 && (
              <span className="figma-product-card__swatch-more" aria-label={`${extraSwatches} more colors`}>
                +{extraSwatches}
              </span>
            )}
          </div>
        )}

        <div className="figma-product-card__meta">
          <p>{brand}</p>
          <p>{category}</p>
        </div>

        <h3 className="figma-product-card__title">{title}</h3>
        {showStars ? (
          <div className="figma-product-card__stars" aria-label={rating ? `${rating} out of 5 stars` : "Product rating"}>
            {renderStars(rating)}
            {reviewCount ? <span className="figma-product-card__reviews">({reviewCount})</span> : null}
          </div>
        ) : null}
        <p className="figma-product-card__price">{price}</p>
        <p className="figma-product-card__description">{description}</p>
      </header>
    </article>
  );
}

export default ProductCard;
