import { ArrowRightIcon, EyeIcon } from "../../icons/StorefrontIcons";

export type CompactResultProduct = {
  id: string;
  imageUrl: string;
  imageAlt: string;
  title: string;
};

type Props = {
  bodyText: string;
  title: string;
  products: CompactResultProduct[];
  /**
   * Total matches for this result (e.g. PLP count). When omitted, uses `products.length`.
   * Surfaced in the lead row as `{n} items`.
   */
  totalResultCount?: number;
  /**
   * True when the storefront PLP currently reflects this card's scope.
   * Swaps the icon-only CTA from arrow-right to eye. The button stays
   * clickable so the shopper can re-trigger the same view.
   */
  isViewing?: boolean;
  onSeeResults: () => void;
};

export function CompactResultCard({
  bodyText,
  title,
  products,
  totalResultCount,
  isViewing = false,
  onSeeResults,
}: Props) {
  const total = totalResultCount ?? products.length;
  const lead = products[0];

  return (
    <article className="sxs-result-card" aria-label={title}>
      <div className="sxs-result-card__body">
        <p className="sxs-result-card__body-text">{bodyText}</p>
      </div>

      <div className="sxs-result-card__row-wrap">
        <button
          type="button"
          className={
            isViewing
              ? "sxs-result-card__row sxs-result-card__row--viewing"
              : "sxs-result-card__row"
          }
          aria-label={
            isViewing ? `Viewing ${title}` : `See results for ${title}`
          }
          aria-pressed={isViewing || undefined}
          onClick={onSeeResults}
        >
          <span className="sxs-result-card__lead">
            {lead ? (
              <span className="sxs-result-card__thumb" title={lead.title}>
                <img src={lead.imageUrl} alt={lead.imageAlt || lead.title} />
              </span>
            ) : null}
            <span className="sxs-result-card__lead-text">
              <span className="sxs-result-card__title">{title}</span>
              <span className="sxs-result-card__count">{total} items</span>
            </span>
          </span>

          <span className="sxs-result-card__cta-wrap" aria-hidden="true">
            <span
              className={
                isViewing
                  ? "sxs-result-card__cta sxs-result-card__cta--viewing"
                  : "sxs-result-card__cta"
              }
            >
              {isViewing ? (
                <EyeIcon width={16} height={16} aria-hidden="true" />
              ) : (
                <ArrowRightIcon width={16} height={16} aria-hidden="true" />
              )}
            </span>
          </span>
        </button>
      </div>
    </article>
  );
}

export default CompactResultCard;
