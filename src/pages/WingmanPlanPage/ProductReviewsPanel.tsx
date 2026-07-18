import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  LoaderCircle,
  Star,
  X,
} from "lucide-react";
import type { CatalogProduct } from "../../catalog/catalog";
import { useBodyScrollLock } from "../../hooks/useBodyScrollLock";
import {
  getAgentDockSnapshot,
  subscribeAgentDock,
} from "./wingmanAgentDockStore";
import { KitDetailsPanel } from "./KitDetailsPanel";
import {
  buildMockReviews,
  summarizeReviews,
  summarizeReviewsText,
  type MockReview,
} from "./buildMockReviews";
import {
  fetchYouTubeReviews,
  YouTubeConfigError,
  youtubeSearchUrl,
  type YouTubeReview,
} from "./youtubeReviews";

/**
 * Reviews panel — a routine, non-chat surface opened by the "View
 * reviews" selection NBA.
 *
 * Reuses the KitDetailsPanel / KitComparePanel slide-in chrome (the
 * `.wingman-kit-details` container + `__backdrop`, so the chat bar's
 * `body:has(...)` dimming and the body-scroll lock behave identically)
 * and hosts two tabs:
 *
 *   • Videos (default) — an embedded YouTube player plus a list of
 *     review videos fetched live from the YouTube Data API. Degrades
 *     to a "search on YouTube" link when no API key is configured or
 *     the request fails.
 *   • Product reviews — deterministic mock text reviews (the catalog
 *     only carries aggregate rating/reviewCount) with a rating summary.
 */

/** Which reviews tab opens first. Exported so callers (e.g. the details
 * panel's reviews widget) can deep-link straight to text or video
 * reviews. */
export type ReviewsTabId = "videos" | "reviews";

type ProductReviewsPanelProps = {
  /** Product to show reviews for. Panel is open when non-null. */
  product: CatalogProduct | null;
  onClose: () => void;
  /** Tab to open on. Defaults to "videos". Re-applied every time a fresh
   * product opens the panel. */
  initialTab?: ReviewsTabId;
  /** Optional hook for the in-panel PDP's "Add to custom bundle"
   * button (opened via the product header's arrow). */
  onAddToCustomBundle?: (product: CatalogProduct) => void;
};

type TabId = ReviewsTabId;

function StarRow({ rating, size = 14 }: { rating: number; size?: number }) {
  const rounded = Math.round(rating);
  return (
    <span className="wingman-product-reviews__stars" aria-hidden="true">
      {Array.from({ length: 5 }, (_, i) => (
        <Star
          key={i}
          width={size}
          height={size}
          className="wingman-product-reviews__star"
          fill={i < rounded ? "currentColor" : "none"}
          strokeWidth={i < rounded ? 0 : 1.5}
        />
      ))}
    </span>
  );
}

function formatPublished(iso: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

function VideosTab({ product }: { product: CatalogProduct }) {
  const query = `${product.title} review`;
  const [videos, setVideos] = useState<YouTubeReview[]>([]);
  const [selectedVideoId, setSelectedVideoId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<"config" | "fetch" | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setVideos([]);
    setSelectedVideoId(null);

    fetchYouTubeReviews(query, controller.signal)
      .then((results) => {
        setVideos(results);
        setSelectedVideoId(results[0]?.videoId ?? null);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err instanceof YouTubeConfigError ? "config" : "fetch");
        setLoading(false);
      });

    return () => controller.abort();
  }, [query]);

  if (loading) {
    return (
      <div className="wingman-product-reviews__state">
        <LoaderCircle
          width={22}
          height={22}
          className="wingman-product-reviews__spinner"
          aria-hidden="true"
        />
        <p>Finding reviews on YouTube…</p>
      </div>
    );
  }

  if (error || videos.length === 0) {
    const message =
      error === "config"
        ? "Live video reviews aren't configured in this build."
        : error === "fetch"
          ? "Couldn't load video reviews right now."
          : "No video reviews found for this product yet.";
    return (
      <div className="wingman-product-reviews__state">
        <p>{message}</p>
        <a
          className="wingman-product-reviews__search-link"
          href={youtubeSearchUrl(query)}
          target="_blank"
          rel="noreferrer"
        >
          Search on YouTube
          <ExternalLink width={14} height={14} aria-hidden="true" />
        </a>
      </div>
    );
  }

  return (
    <div className="wingman-product-reviews__videos">
      {selectedVideoId ? (
        <div className="wingman-product-reviews__video-frame">
          <iframe
            key={selectedVideoId}
            src={`https://www.youtube.com/embed/${selectedVideoId}`}
            title="Product review video"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        </div>
      ) : null}
      <ul className="wingman-product-reviews__video-list">
        {videos.map((video) => {
          const isActive = video.videoId === selectedVideoId;
          return (
            <li key={video.videoId}>
              <button
                type="button"
                className={
                  "wingman-product-reviews__video-card" +
                  (isActive
                    ? " wingman-product-reviews__video-card--active"
                    : "")
                }
                onClick={() => setSelectedVideoId(video.videoId)}
                aria-pressed={isActive}
              >
                <span className="wingman-product-reviews__video-thumb">
                  <img src={video.thumbnailUrl} alt="" loading="lazy" />
                </span>
                <span className="wingman-product-reviews__video-meta">
                  <span className="wingman-product-reviews__video-title">
                    {video.title}
                  </span>
                  <span className="wingman-product-reviews__video-sub">
                    {video.channelTitle}
                    {formatPublished(video.publishedAt)
                      ? ` · ${formatPublished(video.publishedAt)}`
                      : ""}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ReviewsTab({ product }: { product: CatalogProduct }) {
  const reviews = useMemo<MockReview[]>(
    () => buildMockReviews(product),
    [product],
  );
  const summary = useMemo(
    () => summarizeReviews(reviews, product),
    [reviews, product],
  );
  const summaryText = useMemo(
    () => summarizeReviewsText(reviews, product),
    [reviews, product],
  );
  const maxCount = Math.max(1, ...summary.distribution);

  return (
    <div className="wingman-product-reviews__reviews">
      <div className="wingman-product-reviews__summary">
        <h4 className="wingman-product-reviews__summary-title">Quick summary</h4>
        <p className="wingman-product-reviews__summary-text">{summaryText}</p>
        <div className="wingman-product-reviews__summary-metrics">
          <div className="wingman-product-reviews__summary-score">
            <span className="wingman-product-reviews__summary-average">
              {summary.average.toFixed(1)}
            </span>
            <StarRow rating={summary.average} size={16} />
            <span className="wingman-product-reviews__summary-count">
              {summary.count} rating{summary.count === 1 ? "" : "s"}
            </span>
          </div>
          <ul className="wingman-product-reviews__dist">
            {[5, 4, 3, 2, 1].map((star) => {
              const value = summary.distribution[star - 1];
              const pct = Math.round((value / maxCount) * 100);
              return (
                <li key={star} className="wingman-product-reviews__dist-row">
                  <span className="wingman-product-reviews__dist-label">
                    {star}★
                  </span>
                  <span
                    className="wingman-product-reviews__dist-track"
                    aria-hidden="true"
                  >
                    <span
                      className="wingman-product-reviews__dist-bar"
                      style={{ width: `${pct}%` }}
                    />
                  </span>
                  <span className="wingman-product-reviews__dist-value">
                    {value}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      <ul className="wingman-product-reviews__review-list">
        {reviews.map((review) => (
          <li key={review.id} className="wingman-product-reviews__review">
            <div className="wingman-product-reviews__review-head">
              <StarRow rating={review.rating} />
              <span className="wingman-product-reviews__review-title">
                {review.title}
              </span>
            </div>
            <p className="wingman-product-reviews__review-body">{review.body}</p>
            <p className="wingman-product-reviews__review-byline">
              {review.author} · {review.date}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ProductReviewsPanel({
  product,
  onClose,
  initialTab = "videos",
  onAddToCustomBundle,
}: ProductReviewsPanelProps) {
  const [activeTab, setActiveTab] = useState<TabId>(initialTab);
  /* When true, the product's PDP is shown on top of this panel (opened
   * via the header arrow). Backing out returns to the reviews. */
  const [showPdp, setShowPdp] = useState(false);

  const isOpen = !!product;

  /* Whether a KitDetailsPanel is currently open beneath this panel. The
   * details panel registers a dock node for its whole open lifetime, so a
   * non-null dock means we're layered on top of it (opened from the
   * details panel's "Video reviews" widget, or via the docked chat). When
   * stacked we reuse the details panel's backdrop for the single dim and
   * swap our Close (X) for a Back arrow that returns to it. */
  const detailsOpen = useSyncExternalStore(
    subscribeAgentDock,
    () => getAgentDockSnapshot() !== null,
    () => false,
  );
  const stacked = isOpen && detailsOpen;

  /* Reset to the requested tab (and close any PDP overlay) whenever a
   * fresh product opens. */
  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab);
      setShowPdp(false);
    }
  }, [isOpen, product, initialTab]);

  /* Body scroll lock — reference-counted (see useBodyScrollLock) so
   * layering this over KitDetailsPanel can't freeze page scroll. */
  useBodyScrollLock(isOpen);

  /* Esc to close — mirrors the sibling panels. */
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

  if (!isOpen || !product) return null;

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
        className="wingman-kit-details wingman-product-reviews"
        role="dialog"
        aria-modal="true"
        aria-label={`Reviews for ${product.title}`}
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
          <h2 className="wingman-kit-details__header-title">Reviews</h2>
          <div className="wingman-kit-details__header-actions">
            {stacked ? null : (
              <button
                type="button"
                className="wingman-kit-details__close"
                onClick={onClose}
                aria-label="Close reviews"
              >
                <X width={16} height={16} aria-hidden="true" />
              </button>
            )}
          </div>
        </header>

        <div
          className="wingman-product-reviews__tabs"
          role="tablist"
          aria-label="Reviews"
        >
          <button
            type="button"
            role="tab"
            id="wingman-reviews-tab-videos"
            aria-selected={activeTab === "videos"}
            aria-controls="wingman-reviews-panel-videos"
            className={
              "wingman-product-reviews__tab" +
              (activeTab === "videos"
                ? " wingman-product-reviews__tab--active"
                : "")
            }
            onClick={() => setActiveTab("videos")}
          >
            Video reviews
          </button>
          <button
            type="button"
            role="tab"
            id="wingman-reviews-tab-reviews"
            aria-selected={activeTab === "reviews"}
            aria-controls="wingman-reviews-panel-reviews"
            className={
              "wingman-product-reviews__tab" +
              (activeTab === "reviews"
                ? " wingman-product-reviews__tab--active"
                : "")
            }
            onClick={() => setActiveTab("reviews")}
          >
            Product reviews
          </button>
        </div>

        <div className="wingman-kit-details__body wingman-product-reviews__body">
          <div className="wingman-product-reviews__subject">
            <span className="wingman-product-reviews__subject-thumb">
              {product.imageUrl ? (
                <img src={product.imageUrl} alt="" loading="lazy" />
              ) : null}
            </span>
            <span className="wingman-product-reviews__subject-info">
              <span className="wingman-product-reviews__subject-name">
                {product.title}
              </span>
              <span className="wingman-product-reviews__subject-meta">
                {product.category}
                {product.priceFormatted
                  ? ` · ${product.priceFormatted}`
                  : ""}
              </span>
            </span>
            <button
              type="button"
              className="wingman-product-reviews__subject-open"
              onClick={() => setShowPdp(true)}
              aria-label={`View ${product.title} details`}
              title="View product details"
            >
              <ArrowRight width={18} height={18} aria-hidden="true" />
            </button>
          </div>
          {activeTab === "videos" ? (
            <div
              role="tabpanel"
              id="wingman-reviews-panel-videos"
              aria-labelledby="wingman-reviews-tab-videos"
            >
              <VideosTab product={product} />
            </div>
          ) : (
            <div
              role="tabpanel"
              id="wingman-reviews-panel-reviews"
              aria-labelledby="wingman-reviews-tab-reviews"
            >
              <ReviewsTab product={product} />
            </div>
          )}
        </div>
      </div>
      {showPdp ? (
        <KitDetailsPanel
          product={product}
          onAddToCustomBundle={onAddToCustomBundle}
          onBack={() => setShowPdp(false)}
          onClose={() => {
            setShowPdp(false);
            onClose();
          }}
        />
      ) : null}
    </>,
    document.body,
  );
}
