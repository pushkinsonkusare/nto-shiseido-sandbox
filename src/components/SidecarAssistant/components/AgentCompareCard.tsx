import type { ReactNode } from "react";
import { ShoppingCartIcon, StarIcon } from "../../icons/StorefrontIcons";
import "./AgentMessageCards.css";

export type AgentCompareColumn = {
  /** Stable id used as the React key. */
  id: string;
  /** Product slug, used to open the PDP when the column header is tapped. */
  slug: string;
  imageUrl: string;
  imageAlt: string;
  title: string;
  /** Formatted price string, e.g. "$199". */
  price: string;
  /** Optional formatted strike-through compare-at price, e.g. "$239". */
  comparePrice?: string;
  /** Optional rating between 0 and 5. The star row is hidden when omitted. */
  rating?: number;
  /** Optional number of reviews shown next to the rating. */
  reviewCount?: number;
};

export type AgentCompareRow = {
  /** Attribute label shown in the leading column, e.g. "Fabric". */
  label: string;
  /** Values aligned to the `columns` order. `null` renders as "N/A". */
  values: (string | null)[];
};

export type AgentCompareCardProps = {
  /** Body copy rendered above the table (the agent's message). */
  intro: string;
  /** Products compared, one per table column. */
  columns: AgentCompareColumn[];
  /** Attribute rows, each with one value per column. */
  rows: AgentCompareRow[];
  /** Optional closing recommendation shown beneath the table. */
  recommendation?: string;
  /** Slug of the recommended product, bolded inside the recommendation copy. */
  recommendedSlug?: string;
  /** Invoked with a product slug when its column header is tapped. */
  onSelect?: (slug: string) => void;
  /** Invoked with a product slug when its "Add to cart" button is tapped. */
  onAddToCart?: (slug: string) => void;
};

/** Attribute (legend) column width in px. */
const COMPARE_LEGEND_WIDTH = 100;
/** Each product column width in px. */
const COMPARE_COLUMN_WIDTH = 180;

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

/** Renders the recommendation copy, bolding the recommended product's title
 * where it appears inline (matching the Figma design). */
function renderRecommendation(text: string, boldTitle?: string): ReactNode {
  if (!boldTitle) return text;
  const index = text.indexOf(boldTitle);
  if (index === -1) return text;
  return (
    <>
      {text.slice(0, index)}
      <strong>{boldTitle}</strong>
      {text.slice(index + boldTitle.length)}
    </>
  );
}

/**
 * AgentCompareCard is the side-by-side comparison table rendered inside the
 * SidecarAssistant chat panel. Columns are the selected products (each header
 * shows image, title, price, and rating); rows are catalog-grounded attributes,
 * followed by a per-column "Add to cart" action row and a closing
 * recommendation. Mirrors the Storefront Future Components compare design.
 */
export function AgentCompareCard({
  intro,
  columns,
  rows,
  recommendation,
  recommendedSlug,
  onSelect,
  onAddToCart,
}: AgentCompareCardProps) {
  if (columns.length === 0) return null;

  const recommendedTitle = recommendedSlug
    ? columns.find((column) => column.slug === recommendedSlug)?.title
    : undefined;

  const tableWidth =
    COMPARE_LEGEND_WIDTH + columns.length * COMPARE_COLUMN_WIDTH;

  return (
    <article className="agent-compare" data-component="agent-compare-card">
      <p className="agent-compare__intro">{intro}</p>

      <div className="agent-compare__scroll">
        <table className="agent-compare__table" style={{ width: tableWidth }}>
          <thead>
            <tr>
              <th
                className="agent-compare__corner"
                scope="col"
                aria-label="Attribute"
              />
              {columns.map((column) => (
                <th key={column.id} className="agent-compare__col-head" scope="col">
                  <button
                    type="button"
                    className="agent-compare__product"
                    onClick={() => onSelect?.(column.slug)}
                  >
                    <img
                      className="agent-compare__thumb"
                      src={column.imageUrl}
                      alt={column.imageAlt}
                    />
                    <span className="agent-compare__product-title">
                      {column.title}
                    </span>
                    <span className="agent-compare__price-row">
                      <span className="agent-compare__price">
                        {column.price.replace(/^From\s+/i, "")}
                      </span>
                      {column.comparePrice ? (
                        <span className="agent-compare__price--strike">
                          {column.comparePrice}
                        </span>
                      ) : null}
                    </span>
                    {typeof column.rating === "number" ? (
                      <StarRow
                        rating={column.rating}
                        reviewCount={column.reviewCount}
                      />
                    ) : null}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label}>
                <th className="agent-compare__row-head" scope="row">
                  {row.label}
                </th>
                {columns.map((column, index) => (
                  <td key={column.id} className="agent-compare__cell">
                    <span className="agent-compare__cell-text">
                      {row.values[index] ?? "N/A"}
                    </span>
                  </td>
                ))}
              </tr>
            ))}
            {onAddToCart ? (
              <tr>
                <th className="agent-compare__action-head" scope="row" aria-hidden />
                {columns.map((column) => (
                  <td key={column.id} className="agent-compare__action-cell">
                    <button
                      type="button"
                      className="agent-compare__cart-btn"
                      onClick={() => onAddToCart(column.slug)}
                    >
                      <ShoppingCartIcon width={15} height={15} />
                      Add to cart
                    </button>
                  </td>
                ))}
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {recommendation ? (
        <p className="agent-compare__recommendation">
          {renderRecommendation(recommendation, recommendedTitle)}
        </p>
      ) : null}
    </article>
  );
}

export default AgentCompareCard;
