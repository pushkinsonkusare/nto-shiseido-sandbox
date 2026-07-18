import { ArrowRightIcon, EyeIcon } from "../../icons/StorefrontIcons";
import type { CompactResultProduct } from "./CompactResultCard";

export type BroadResultRow = {
  id: string;
  title: string;
  thumb: CompactResultProduct;
  productSlugs: string[];
  totalResultCount: number;
  category?: string;
  /** Use-case tags (AND-filter on `useCaseTags`) propagated to the PLP. */
  capabilities?: string[];
  /** Accessory role filter (`mounting`, `power`, …) propagated to the PLP. */
  accessoryRole?: string;
  /**
   * Recipe spec id — opaque token that lets the PLP look up the same
   * sub-topic spec the card used (incl. title patterns the URL can't
   * encode cleanly). Set by the rule-based recipe engine; left
   * undefined for OpenAI-driven rows.
   */
  recipeKey?: string;
};

/**
 * Full filter shape carried from a row click out to the PLP. Mirrors the
 * navigation options so the See Results handoff can scope the listing to
 * the same curated subset shown in the card.
 */
export type SeeResultsScope = {
  category?: string;
  capabilities?: string[];
  accessoryRole?: string;
  recipeKey?: string;
  /** Model-compat token for accessory queries ("mavic 4 pro", etc). */
  compatibleWith?: string;
  /** Buyer tier filter ("pro" / "beginner" / "intermediate"). */
  tier?: "beginner" | "intermediate" | "pro";
  /** Price ceiling in USD. */
  priceMax?: number;
  /** Price floor in USD. */
  priceMin?: number;
  /** v6 subtype narrowing ("helmet mount" → ["mount_helmet"]). */
  subtypes?: string[];
};

type Props = {
  bodyText: string;
  rows: BroadResultRow[];
  /** Row id whose scope the PLP currently reflects (eye icon instead of arrow). */
  viewingRowId?: string | null;
  onSeeRowResults: (rowId: string, scope: SeeResultsScope) => void;
  onShowAll: () => void;
};

export function BroadResultCard({
  bodyText,
  rows,
  viewingRowId = null,
  onSeeRowResults,
  onShowAll,
}: Props) {
  return (
    <article className="sxs-result-card sxs-broad-card" aria-label="Curated suggestions">
      <div className="sxs-result-card__body">
        <p className="sxs-result-card__body-text">{bodyText}</p>
      </div>

      <div className="sxs-broad-card__rows-group">
        <div className="sxs-broad-card__rows">
          {rows.map((row) => {
            const isViewing = row.id === viewingRowId;
            return (
              <div key={row.id} className="sxs-result-card__row-wrap">
                <button
                  type="button"
                  className={
                    isViewing
                      ? "sxs-result-card__row sxs-result-card__row--viewing"
                      : "sxs-result-card__row"
                  }
                  aria-label={
                    isViewing
                      ? `Viewing ${row.title}`
                      : `See results for ${row.title}`
                  }
                  aria-pressed={isViewing || undefined}
                  onClick={() =>
                    onSeeRowResults(row.id, {
                      category: row.category,
                      capabilities: row.capabilities,
                      accessoryRole: row.accessoryRole,
                      recipeKey: row.recipeKey,
                    })
                  }
                >
                  <span className="sxs-result-card__lead">
                    <span className="sxs-result-card__thumb" title={row.thumb.title}>
                      <img
                        src={row.thumb.imageUrl}
                        alt={row.thumb.imageAlt || row.thumb.title}
                      />
                    </span>
                    <span className="sxs-result-card__lead-text">
                      <span className="sxs-result-card__title">{row.title}</span>
                      <span className="sxs-result-card__count">
                        {row.totalResultCount} items
                      </span>
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
            );
          })}
        </div>

        <div className="sxs-broad-card__show-all">
          <button
            type="button"
            className="sxs-broad-card__show-all-link"
            onClick={onShowAll}
          >
            <span>Show all</span>
            <span className="sxs-broad-card__show-all-link__icon" aria-hidden="true">
              <ArrowRightIcon width={16} height={16} />
            </span>
          </button>
        </div>
      </div>
    </article>
  );
}

export default BroadResultCard;
