import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, Check, Plus, Sparkles, Star, X } from "lucide-react";
import type { CatalogProduct } from "../../catalog/catalog";
import { useBodyScrollLock } from "../../hooks/useBodyScrollLock";
import { formatPriceUsd } from "./buildPlan";
import {
  getAgentDockSnapshot,
  subscribeAgentDock,
} from "./wingmanAgentDockStore";
import { KitDetailsPanel } from "./KitDetailsPanel";

/**
 * Side-by-side product comparison — a routine, non-chat surface.
 *
 * Reuses the KitDetailsPanel's slide-in chrome (`.wingman-kit-details`
 * container + backdrop, so the chat bar's `body:has(...)` dimming and
 * the body-scroll lock behave identically) but renders a tabular
 * comparison instead of a single-product detail:
 *
 *   ┌───────────┬──────────┬──────────┬──────────┐
 *   │           │ product  │ product  │ product  │  ← header row
 *   │           │ img/title│          │          │     (image, title,
 *   │           │ price ★  │          │          │      price, rating)
 *   ├───────────┼──────────┼──────────┼──────────┤
 *   │ Category  │  …       │  …       │  …       │  ← attribute rows
 *   │ Weight    │  …       │  …       │  …       │
 *   │  …        │          │          │          │
 *   ├───────────┼──────────┼──────────┼──────────┤
 *   │           │ View  +  │ View  +  │ View  +  │  ← action row
 *   └───────────┴──────────┴──────────┴──────────┘
 *
 * The compared attributes are derived from the products themselves
 * (see `buildComparisonRows`) rather than hard-coded, so the same
 * component works for cameras, drones, gimbals or a mixed selection.
 */

type KitComparePanelProps = {
  /** Products to compare. Panel is open when this has 2+ entries. */
  products: CatalogProduct[] | null;
  onClose: () => void;
  /** Add a product into the shopper's custom bundle (the "+" action). */
  onAddToBundle?: (product: CatalogProduct) => void;
};

type ComparisonRow = {
  label: string;
  values: string[];
  /** True when the products don't all share the same value — used to
   * subtly highlight the rows that actually differentiate the picks. */
  differs: boolean;
};

/** Max attribute rows surfaced so the table stays scannable. */
const MAX_ROWS = 10;

function titleCase(value: string): string {
  if (!value) return "";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * Decide which attributes to compare. Category + tier lead (always
 * meaningful across any product kind), followed by the spec labels the
 * products share — ranked so rows present in more of the picks, and
 * rows whose values actually differ, float to the top. A "Best for"
 * row derived from use-case tags rounds things out when available.
 */
export function buildComparisonRows(products: CatalogProduct[]): ComparisonRow[] {
  const rows: ComparisonRow[] = [];

  const makeRow = (label: string, rawValues: string[]): ComparisonRow | null => {
    const values = rawValues.map((v) => (v && v.trim() ? v.trim() : "—"));
    if (!values.some((v) => v !== "—")) return null;
    const present = values.filter((v) => v !== "—");
    const differs = new Set(present.map((v) => v.toLowerCase())).size > 1;
    return { label, values, differs };
  };

  const pushRow = (label: string, rawValues: string[]) => {
    const row = makeRow(label, rawValues);
    if (row) rows.push(row);
  };

  /* Leading curated rows — universally comparable regardless of kind. */
  pushRow("Category", products.map((p) => p.category));
  pushRow("Tier", products.map((p) => titleCase(p.tier)));

  /* Spec rows. Fold each product's specs into a case-insensitive map so
   * "Battery life" / "Battery Life" collapse to one row, preserving the
   * first display label + first-seen order. */
  const specMap = new Map<
    string,
    { display: string; values: string[] }
  >();
  products.forEach((product, index) => {
    for (const spec of product.specs) {
      const key = spec.label.trim().toLowerCase();
      if (!key) continue;
      let entry = specMap.get(key);
      if (!entry) {
        entry = {
          display: spec.label.trim(),
          values: Array.from({ length: products.length }, () => ""),
        };
        specMap.set(key, entry);
      }
      if (!entry.values[index]) entry.values[index] = spec.value;
    }
  });

  const specRows = [...specMap.values()]
    .map((entry) => makeRow(entry.display, entry.values))
    .filter((row): row is ComparisonRow => row !== null);

  /* Rank specs: more products covered first, then differentiating rows,
   * keeping first-seen order for ties (stable sort). */
  specRows
    .map((row, i) => ({ row, i }))
    .sort((a, b) => {
      const coverA = a.row.values.filter((v) => v !== "—").length;
      const coverB = b.row.values.filter((v) => v !== "—").length;
      if (coverA !== coverB) return coverB - coverA;
      if (a.row.differs !== b.row.differs) return a.row.differs ? -1 : 1;
      return a.i - b.i;
    })
    .forEach(({ row }) => {
      if (rows.length >= MAX_ROWS - 1) return;
      rows.push(row);
    });

  /* Trailing "Best for" from use-case tags — a friendly plain-language
   * summary that complements the raw specs. */
  pushRow(
    "Best for",
    products.map((p) => p.useCaseTags.slice(0, 3).map(titleCase).join(", ")),
  );

  return rows.slice(0, MAX_ROWS);
}

function StarRating({ rating }: { rating: number }) {
  const rounded = Math.round(rating);
  return (
    <span className="wingman-kit-compare__stars" aria-hidden="true">
      {Array.from({ length: 5 }, (_, i) => (
        <Star
          key={i}
          width={12}
          height={12}
          className="wingman-kit-compare__star"
          fill={i < rounded ? "currentColor" : "none"}
          strokeWidth={i < rounded ? 0 : 1.5}
        />
      ))}
    </span>
  );
}

/**
 * Shimmering placeholder shown while the comparison "builds". Mirrors
 * the real table's geometry (a narrow label column + one column per
 * compared product, a media/title/price/rating header block, N attribute
 * rows, and an action footer) so the reveal doesn't shift layout — the
 * skeleton simply dissolves into the populated table.
 */
function ComparisonSkeleton({
  columns,
  rows,
}: {
  columns: number;
  rows: number;
}) {
  const cols = Array.from({ length: columns });
  const attrRows = Array.from({ length: rows });
  return (
    <div
      className="wingman-kit-compare__skeleton"
      style={{ ["--sk-cols" as string]: String(columns) }}
      aria-hidden="true"
    >
      <div className="wingman-kit-compare__sk-head">
        <span className="wingman-kit-compare__sk-corner" />
        {cols.map((_, i) => (
          <div key={i} className="wingman-kit-compare__sk-col">
            <span className="wingman-kit-compare__sk wingman-kit-compare__sk--img" />
            <span className="wingman-kit-compare__sk wingman-kit-compare__sk--title" />
            <span className="wingman-kit-compare__sk wingman-kit-compare__sk--price" />
            <span className="wingman-kit-compare__sk wingman-kit-compare__sk--rating" />
          </div>
        ))}
      </div>
      {attrRows.map((_, r) => (
        <div key={r} className="wingman-kit-compare__sk-row">
          <span className="wingman-kit-compare__sk wingman-kit-compare__sk--label" />
          {cols.map((_, c) => (
            <span
              key={c}
              className="wingman-kit-compare__sk wingman-kit-compare__sk--cell"
            />
          ))}
        </div>
      ))}
      <div className="wingman-kit-compare__sk-foot">
        <span className="wingman-kit-compare__sk-corner" />
        {cols.map((_, i) => (
          <div key={i} className="wingman-kit-compare__sk-foot-cell">
            <span className="wingman-kit-compare__sk wingman-kit-compare__sk--btn" />
            <span className="wingman-kit-compare__sk wingman-kit-compare__sk--icon" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function KitComparePanel({
  products,
  onClose,
  onAddToBundle,
}: KitComparePanelProps) {
  /* Slugs the shopper has added to their bundle from within the compare
   * table this session — flips the "+" affordance to a "added" check so
   * they can gather several picks without the panel closing on them. */
  const [addedSlugs, setAddedSlugs] = useState<Set<string>>(() => new Set());

  /* Product whose PDP is being viewed inline, on top of the compare
   * table. Clicking "View" sets this rather than navigating away, so
   * the shopper stays in the comparison flow and can back out to the
   * table via the detail panel's header back button. */
  const [viewProduct, setViewProduct] = useState<CatalogProduct | null>(null);

  /* "Agent is assembling the comparison" phase. Every time a fresh
   * comparison opens we hold the real table back behind a shimmering
   * skeleton for a beat so the panel reads as Wingman actively building
   * the side-by-side rather than the data snapping in instantly. */
  const [isBuilding, setIsBuilding] = useState(false);

  const isOpen = !!products && products.length >= 2;

  /* Whether a KitDetailsPanel is open beneath this panel (it registers a
   * dock node for its whole open lifetime). When stacked we reuse the
   * details panel's backdrop for the single dim and swap our Close (X)
   * for a Back arrow that returns to it. */
  const detailsOpen = useSyncExternalStore(
    subscribeAgentDock,
    () => getAgentDockSnapshot() !== null,
    () => false,
  );
  const stacked = isOpen && detailsOpen;

  /* Reset the added-affordance state whenever a fresh comparison opens. */
  useEffect(() => {
    if (isOpen) {
      setAddedSlugs(new Set());
      setViewProduct(null);
    }
  }, [isOpen, products]);

  /* Drive the build-up skeleton. Fires on each fresh open (keyed on the
   * product set) so re-comparing a new selection replays the beat. */
  useEffect(() => {
    if (!isOpen) {
      setIsBuilding(false);
      return;
    }
    setIsBuilding(true);
    const timer = window.setTimeout(() => setIsBuilding(false), 1400);
    return () => window.clearTimeout(timer);
  }, [isOpen, products]);

  /* Body scroll lock — reference-counted (see useBodyScrollLock) so the
   * two modal surfaces can overlap without freezing page scroll. */
  useBodyScrollLock(isOpen);

  /* Esc to close — mirrors KitDetailsPanel so the two modal surfaces
   * behave identically. */
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
    };
  }, [isOpen, onClose]);

  const rows = useMemo(
    () => (isOpen && products ? buildComparisonRows(products) : []),
    [isOpen, products],
  );

  if (!isOpen || !products) return null;

  const handleAdd = (product: CatalogProduct) => {
    onAddToBundle?.(product);
    setAddedSlugs((prev) => {
      const next = new Set(prev);
      next.add(product.slug);
      return next;
    });
  };

  return createPortal(
    <>
      <div
        className={
          "wingman-kit-details__backdrop" +
          (stacked ? " wingman-kit-details__backdrop--nested" : "")
        }
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className="wingman-kit-details wingman-kit-compare"
        role="dialog"
        aria-modal="true"
        aria-label="Compare products"
      >
        <header className="wingman-kit-details__header">
          {stacked ? (
            <button
              type="button"
              className="wingman-kit-details__back"
              onClick={onClose}
              aria-label="Back to details"
            >
              <ArrowLeft width={16} height={16} aria-hidden="true" />
            </button>
          ) : null}
          <h2 className="wingman-kit-details__header-title">
            {isBuilding ? (
              <span
                className="wingman-kit-compare__building"
                aria-live="polite"
              >
                <Sparkles
                  width={16}
                  height={16}
                  className="wingman-kit-compare__building-icon"
                  aria-hidden="true"
                />
                Building comparison…
              </span>
            ) : (
              `Compare ${products.length} products`
            )}
          </h2>
          <div className="wingman-kit-details__header-actions">
            {stacked ? null : (
              <button
                type="button"
                className="wingman-kit-details__close"
                onClick={onClose}
                aria-label="Close comparison"
              >
                <X width={16} height={16} aria-hidden="true" />
              </button>
            )}
          </div>
        </header>

        <div className="wingman-kit-details__body wingman-kit-compare__body">
          {isBuilding ? (
            <ComparisonSkeleton
              columns={products.length}
              rows={Math.max(rows.length, 6)}
            />
          ) : (
          <table className="wingman-kit-compare__table">
            <caption className="wingman-kit-compare__caption">
              Side-by-side comparison of your selected products
            </caption>
            <thead>
              <tr>
                <th
                  scope="col"
                  className="wingman-kit-compare__corner"
                  aria-hidden="true"
                />
                {products.map((product) => {
                  const listPrice =
                    product.price != null
                      ? formatPriceUsd(product.price * 1.15)
                      : "";
                  const price =
                    product.priceFormatted ||
                    (product.price != null
                      ? formatPriceUsd(product.price)
                      : "");
                  return (
                    <th
                      key={product.slug}
                      scope="col"
                      className="wingman-kit-compare__col-head"
                    >
                      <span className="wingman-kit-compare__head-media">
                        {product.imageUrl ? (
                          <img
                            src={product.imageUrl}
                            alt=""
                            loading="lazy"
                            className="wingman-kit-compare__head-img"
                          />
                        ) : null}
                      </span>
                      <button
                        type="button"
                        className="wingman-kit-compare__head-title"
                        onClick={() => setViewProduct(product)}
                        title={product.title}
                      >
                        {product.title}
                      </button>
                      {price ? (
                        <span className="wingman-kit-compare__head-prices">
                          <span className="wingman-kit-compare__head-price">
                            {price}
                          </span>
                          {listPrice ? (
                            <span className="wingman-kit-compare__head-price-strike">
                              {listPrice}
                            </span>
                          ) : null}
                        </span>
                      ) : null}
                      {product.rating != null ? (
                        <span className="wingman-kit-compare__head-rating">
                          <span className="wingman-kit-compare__rating-value">
                            {product.rating.toFixed(1)}
                          </span>
                          <StarRating rating={product.rating} />
                          {product.reviewCount != null ? (
                            <span className="wingman-kit-compare__reviews">
                              {product.reviewCount}
                            </span>
                          ) : null}
                        </span>
                      ) : null}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.label}
                  className={
                    "wingman-kit-compare__row" +
                    (row.differs ? " wingman-kit-compare__row--differs" : "")
                  }
                >
                  <th scope="row" className="wingman-kit-compare__row-label">
                    {row.label}
                  </th>
                  {row.values.map((value, i) => (
                    <td
                      key={products[i].slug}
                      className="wingman-kit-compare__cell"
                    >
                      {value}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td
                  className="wingman-kit-compare__corner wingman-kit-compare__corner--foot"
                  aria-hidden="true"
                />
                {products.map((product) => {
                  const isAdded = addedSlugs.has(product.slug);
                  return (
                    <td
                      key={product.slug}
                      className="wingman-kit-compare__foot-cell"
                    >
                      <div className="wingman-kit-compare__foot-actions">
                        <button
                          type="button"
                          className="wingman-kit-compare__view-btn"
                          onClick={() => setViewProduct(product)}
                        >
                          View
                        </button>
                        <button
                          type="button"
                          className={
                            "wingman-kit-compare__add-btn" +
                            (isAdded
                              ? " wingman-kit-compare__add-btn--added"
                              : "")
                          }
                          onClick={() => handleAdd(product)}
                          disabled={isAdded}
                          aria-label={
                            isAdded
                              ? `${product.title} added to your kit`
                              : `Add ${product.title} to your kit`
                          }
                          title={isAdded ? "Added" : "Add to your kit"}
                        >
                          {isAdded ? (
                            <Check width={18} height={18} aria-hidden="true" />
                          ) : (
                            <Plus width={18} height={18} aria-hidden="true" />
                          )}
                        </button>
                      </div>
                    </td>
                  );
                })}
              </tr>
            </tfoot>
          </table>
          )}
        </div>
      </div>
      {viewProduct ? (
        <KitDetailsPanel
          product={viewProduct}
          onAddToCustomBundle={onAddToBundle}
          onBack={() => setViewProduct(null)}
          onClose={() => {
            setViewProduct(null);
            onClose();
          }}
        />
      ) : null}
    </>,
    document.body,
  );
}
