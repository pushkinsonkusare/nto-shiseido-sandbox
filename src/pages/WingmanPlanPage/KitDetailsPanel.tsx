import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ChevronLeft,
  ChevronRight,
  Maximize2,
  MessageSquareText,
  Minimize2,
  Play,
  Sparkle,
  Star,
  X,
} from "lucide-react";
import type { CatalogProduct } from "../../catalog/catalog";
import { useBodyScrollLock } from "../../hooks/useBodyScrollLock";
import { ROUTES, usePrototypeNavigation } from "../../prototypeRoutes";
import { formatPriceUsd, type Combo } from "./buildPlan";
import {
  buildMockReviews,
  summarizeReviews,
  summarizeReviewsText,
} from "./buildMockReviews";
import type { ReviewsTabId } from "./ProductReviewsPanel";
import {
  setAgentDock,
  setAgentDockLabel,
  setAgentDockProductSlug,
} from "./wingmanAgentDockStore";

/**
 * Slide-in right panel surfacing a kit's contents — or a single
 * standalone product — in detail.
 *
 * Two modes:
 *   • Kit mode (combo prop) — opened from the combo sidebar's
 *     "View Details" button or by clicking a tile in the combo
 *     mosaic. Renders the full Figma 106:31808 layout: header, kit
 *     summary block (title + struck-through total), horizontal rail
 *     of every item in the kit (core + accessories), a large hero
 *     card with prev/next chevrons that cycle the selected item plus
 *     a thumb row from `selected.gallery`, the selected product's
 *     detail block, and a three-button action row (Remove, More
 *     details, Buy now).
 *   • Product mode (product prop) — opened from a product card in
 *     the "Create your own kit" categories accordion. Reuses the
 *     same hero + product + action chrome but drops the kit summary
 *     and rail (there's no kit context to surface), retitles the
 *     header as "Details", and removes the "Remove" action since
 *     there's nothing to remove from.
 *
 * State is intentionally minimal — `selectedSlug` defaults to the
 * core (kit mode) or the lone product (product mode), and resets
 * every time the panel is re-opened with a different combo/product.
 * The panel is in-memory only; refreshing the URL closes it.
 *
 * The "Remove from combo" button is a Phase-1 stub. The planner is
 * pure-functional from the URL query (see `buildPlan`), so there's no
 * place to record a per-shopper removal yet — wiring it up requires
 * lifting an override map into the page, which is out of scope here.
 */

type KitDetailsPanelProps = {
  /** When non-null, the panel is open in kit mode and bound to this
   * combo. Mutually exclusive with `product` — `combo` wins when both
   * are provided. */
  combo?: Combo | null;
  /** When non-null (and `combo` is null), the panel is open in
   * product mode showing only this single product — no kit summary
   * or rail. Used by the categories accordion. */
  product?: CatalogProduct | null;
  /** Headline for the kit summary, e.g. "Ideal Beginner Kit". Only
   * rendered in kit mode; ignored in product mode. */
  kitTitle?: string;
  /** Optional long-form kit description shown above the rail in kit mode. */
  kitDescription?: string;
  /* Slug of the kit item that should be pre-selected when the panel
   * opens. When omitted (or unknown for this combo) the core product
   * is selected — same behaviour as the sidebar's "View Details"
   * button. Lets callers deep-link directly into a specific accessory
   * (e.g. clicking an accessory tile in the combo mosaic). */
  initialSelectedSlug?: string | null;
  /** Optional hook for product mode's "Add to custom bundle" button. */
  onAddToCustomBundle?: (product: CatalogProduct) => void;
  /** Open the reviews panel for the on-stage product on a specific tab.
   * When provided, a compact reviews widget renders under the product
   * description with "user reviews" / "video reviews" shortcuts. Omitted
   * for nested instances (inside the reviews / compare panels) so the
   * widget doesn't recurse back into itself. */
  onViewReviews?: (product: CatalogProduct, tab?: ReviewsTabId) => void;
  /** When provided, the header shows a back button (◀) instead of just
   * the title. Used when the panel is opened on top of another surface
   * (e.g. the compare panel's "View" action) so the shopper can return
   * to where they came from rather than closing outright. */
  onBack?: () => void;
  onClose: () => void;
};

/** Compact 5-star row for the reviews widget summary. */
function ReviewStars({ rating }: { rating: number }) {
  const rounded = Math.round(rating);
  return (
    <span className="wingman-kit-details__reviews-stars" aria-hidden="true">
      {Array.from({ length: 5 }, (_, i) => (
        <Star
          key={i}
          width={13}
          height={13}
          className="wingman-kit-details__reviews-star"
          fill={i < rounded ? "currentColor" : "none"}
          strokeWidth={i < rounded ? 0 : 1.5}
        />
      ))}
    </span>
  );
}

export function KitDetailsPanel({
  combo,
  product,
  kitTitle,
  kitDescription,
  initialSelectedSlug,
  onAddToCustomBundle,
  onViewReviews,
  onBack,
  onClose,
}: KitDetailsPanelProps) {
  const { navigate } = usePrototypeNavigation();

  /* Mode is derived from which prop is populated. `combo` wins when
   * both are provided so callers can't accidentally render a stale
   * single product alongside a fresh kit. */
  const mode: "kit" | "product" | "closed" = combo
    ? "kit"
    : product
      ? "product"
      : "closed";

  const items = useMemo<CatalogProduct[]>(() => {
    if (combo) return [combo.core, ...combo.accessories];
    if (product) return [product];
    return [];
  }, [combo, product]);

  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  /* Index into the currently-selected product's `gallery`. The hero
   * image and the hero-nav chevrons operate on this index — chevrons
   * cycle through the same product's gallery instead of switching
   * which kit item is on stage. Switching products is reserved for
   * the rail tiles above the hero. */
  const [galleryIndex, setGalleryIndex] = useState(0);
  /* Whether the hero image is expanded into the full-screen lightbox.
   * A ref mirror lets the panel's Esc handler close the lightbox first
   * (one Esc closes the lightbox, the next closes the panel) without
   * re-running the body-scroll-lock effect. */
  const [isFullscreen, setIsFullscreen] = useState(false);
  const isFullscreenRef = useRef(false);
  useEffect(() => {
    isFullscreenRef.current = isFullscreen;
  }, [isFullscreen]);

  /* Reset selection whenever the panel is opened with a fresh combo
   * or product — otherwise re-opening on a different tier would
   * leave the user staring at whatever accessory they last clicked.
   * Honour the caller-provided `initialSelectedSlug` when it matches
   * an item in the kit (e.g. opening from a tile click), and fall
   * back to the core product for the sidebar's "View Details" path.
   * In product mode there's only one item, so we always select it. */
  useEffect(() => {
    if (combo) {
      const hasRequested =
        !!initialSelectedSlug &&
        (combo.core.slug === initialSelectedSlug ||
          combo.accessories.some((a) => a.slug === initialSelectedSlug));
      setSelectedSlug(hasRequested ? initialSelectedSlug! : combo.core.slug);
      return;
    }
    if (product) {
      setSelectedSlug(product.slug);
    }
  }, [combo, product, initialSelectedSlug]);

  /* Reset the gallery position whenever the shopper switches to a
   * different kit item. Without this the new product would open at
   * whatever index the previous one was on, which is jarring and can
   * land on an invalid index when galleries differ in length. */
  useEffect(() => {
    setGalleryIndex(0);
    setIsFullscreen(false);
  }, [selectedSlug]);

  /* Ref to the gallery <ul> so we can scroll the active thumb into
   * view as the shopper cycles through hero images. Galleries with
   * more thumbs than the centered strip can show would otherwise clip
   * past-edge thumbs and hide the active one. */
  const galleryRef = useRef<HTMLUListElement>(null);

  /* Register the panel's footer node as the Wingman agent's "dock" so
   * the floating chat bar teleports in here (see wingmanAgentDockStore).
   * A callback ref fires with the node on mount and `null` on unmount —
   * including when the panel closes and the component returns null — so
   * the agent snaps back to the viewport automatically. */
  const agentDockRef = useCallback((node: HTMLDivElement | null) => {
    setAgentDock(node);
  }, []);

  /* Keep the active thumb visible inside the (potentially overflowing)
   * gallery strip. We deliberately AVOID `Element.scrollIntoView` here —
   * even with `block: 'nearest'` it walks up every scroll-container
   * ancestor and can nudge the panel body / document horizontally,
   * which manifests as the whole panel "jumping left" when the next
   * chevron is clicked. Computing the target scrollLeft and applying
   * it to just the gallery <ul> keeps the side-effect strictly local
   * to the strip. Reads the `.--active` thumb from the DOM rather than
   * threading another ref so adding/removing thumbs doesn't require
   * bookkeeping a parallel ref array. */
  useEffect(() => {
    const ul = galleryRef.current;
    if (!ul) return;
    const activeThumb = ul.querySelector<HTMLElement>(
      ".wingman-kit-details__gallery-thumb--active",
    );
    if (!activeThumb) return;
    const ulRect = ul.getBoundingClientRect();
    const thumbRect = activeThumb.getBoundingClientRect();
    const targetLeft =
      ul.scrollLeft +
      (thumbRect.left - ulRect.left) -
      (ulRect.width - thumbRect.width) / 2;
    ul.scrollTo({ left: targetLeft, behavior: "smooth" });
  }, [galleryIndex, selectedSlug]);

  /* Body scroll lock — reference-counted so overlapping panels
   * (reviews / compare opened on top of this one) can't leave the
   * page scroll frozen depending on close order. */
  useBodyScrollLock(mode !== "closed");

  /* Esc to close. */
  useEffect(() => {
    if (mode === "closed") return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      /* First Esc collapses the full-screen image; only close the whole
       * panel once the lightbox is already dismissed. */
      if (isFullscreenRef.current) {
        setIsFullscreen(false);
        return;
      }
      onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
    };
  }, [mode, onClose]);

  /* Keep the agent's context label in step with whatever product is on
   * stage so the docked chat placeholder reads "Ask me anything about
   * <that product>". Clears on close/unmount. */
  useEffect(() => {
    if (mode === "closed" || items.length === 0) {
      setAgentDockLabel(null);
      setAgentDockProductSlug(null);
      return;
    }
    const current = items.find((p) => p.slug === selectedSlug) ?? items[0];
    setAgentDockLabel(current?.title ?? null);
    setAgentDockProductSlug(current?.slug ?? null);
    return () => {
      setAgentDockLabel(null);
      setAgentDockProductSlug(null);
    };
  }, [mode, items, selectedSlug]);

  if (mode === "closed" || items.length === 0) return null;

  const selected =
    items.find((p) => p.slug === selectedSlug) ?? items[0];

  /* Build the hero gallery from the selected product. We prefer the
   * explicit `gallery` array but fall back to the headline `imageUrl`
   * so single-image products still render a hero. The chevron nav
   * only appears when there's more than one image to cycle through. */
  const heroGallery =
    selected.gallery && selected.gallery.length > 0
      ? selected.gallery
      : selected.imageUrl
        ? [selected.imageUrl]
        : [];
  const safeGalleryIndex =
    heroGallery.length > 0
      ? ((galleryIndex % heroGallery.length) + heroGallery.length) %
        heroGallery.length
      : 0;
  const heroSrc = heroGallery[safeGalleryIndex] ?? selected.imageUrl;
  const cycleHeroImage = (delta: number) => {
    if (heroGallery.length <= 1) return;
    setGalleryIndex(
      (current) =>
        ((current + delta) % heroGallery.length + heroGallery.length) %
        heroGallery.length,
    );
  };

  const headerTitle = isFullscreen ? selected.title : "Details";
  const closeLabel =
    mode === "kit" ? "Close kit details" : "Close product details";
  const dialogLabel = mode === "kit" ? "Kit details" : "Product details";

  const galleryThumbs = selected.gallery.slice(0, 8);
  const productPrice =
    selected.priceFormatted ||
    (selected.price != null ? formatPriceUsd(selected.price) : "");
  const productListPrice =
    selected.price != null ? formatPriceUsd(selected.price * 1.15) : "";
  const buyNowLabelPrice =
    mode === "kit" && combo ? formatPriceUsd(combo.totalPrice) : productPrice;

  /* Compact review summary for the widget under the description. Built
   * from the same deterministic mock set the full reviews panel uses, so
   * the headline number + blurb stay consistent with what opens when the
   * shopper taps through. Cheap enough (≈6 synthesized reviews) to derive
   * inline on render. Only needed when the reviews shortcut is wired up. */
  const mockReviews = onViewReviews ? buildMockReviews(selected) : [];
  const reviewStats = onViewReviews
    ? summarizeReviews(mockReviews, selected)
    : null;
  const reviewBlurb = onViewReviews
    ? summarizeReviewsText(mockReviews, selected)
    : "";

  /* Render via portal to document.body so the panel + backdrop escape
   * the page's stacking contexts. `.wingman-plan-page__cards` (a
   * grandparent in the React tree) sets `position: relative; z-index: 2`,
   * which would otherwise trap our fixed-positioned panel beneath the
   * sticky ImmersiveHeader (z-index 50) regardless of our own z-index. */
  return createPortal(
    <>
      <div
        className="wingman-kit-details__backdrop"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className={
          "wingman-kit-details" +
          (isFullscreen ? " wingman-kit-details--image" : "")
        }
        role="dialog"
        aria-modal="true"
        aria-label={dialogLabel}
      >
        <header className="wingman-kit-details__header">
          {onBack && !isFullscreen ? (
            <button
              type="button"
              className="wingman-kit-details__back"
              onClick={onBack}
              aria-label="Back to comparison"
            >
              <ChevronLeft width={16} height={16} aria-hidden="true" />
            </button>
          ) : null}
          {isFullscreen ? (
            <button
              type="button"
              className="wingman-kit-details__back"
              onClick={() => setIsFullscreen(false)}
              aria-label="Back to details"
            >
              <ChevronLeft width={16} height={16} aria-hidden="true" />
            </button>
          ) : null}
          <h2 className="wingman-kit-details__header-title">{headerTitle}</h2>
          <div className="wingman-kit-details__header-actions">
            {isFullscreen ? (
              <button
                type="button"
                className="wingman-kit-details__close"
                onClick={() => setIsFullscreen(false)}
                aria-label="Collapse image"
                title="Collapse image"
              >
                <Minimize2 width={16} height={16} aria-hidden="true" />
              </button>
            ) : null}
            <button
              type="button"
              className="wingman-kit-details__close"
              onClick={onClose}
              aria-label={closeLabel}
            >
              <X width={16} height={16} aria-hidden="true" />
            </button>
          </div>
        </header>

        <div
          className={
            "wingman-kit-details__body" +
            (isFullscreen ? " wingman-kit-details__body--image" : "")
          }
        >
          {isFullscreen && heroSrc ? (
            <div className="wingman-kit-details__image-stage">
              <img
                src={heroSrc}
                alt={selected.title}
                className="wingman-kit-details__image-full"
              />
              {heroGallery.length > 1 ? (
                <>
                  <button
                    type="button"
                    className="wingman-kit-details__image-nav wingman-kit-details__image-nav--prev"
                    onClick={() => cycleHeroImage(-1)}
                    aria-label={`Previous image of ${selected.title}`}
                  >
                    <ChevronLeft width={22} height={22} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="wingman-kit-details__image-nav wingman-kit-details__image-nav--next"
                    onClick={() => cycleHeroImage(1)}
                    aria-label={`Next image of ${selected.title}`}
                  >
                    <ChevronRight width={22} height={22} aria-hidden="true" />
                  </button>
                </>
              ) : null}
            </div>
          ) : null}

          {mode === "kit" && combo ? (
            <section className="wingman-kit-details__summary">
              <div className="wingman-kit-details__summary-row">
                <div className="wingman-kit-details__summary-head">
                  <h3 className="wingman-kit-details__kit-title">{kitTitle}</h3>
                </div>
                <button
                  type="button"
                  className="wingman-plan-page__sidebar-button wingman-plan-page__sidebar-button--primary"
                  onClick={() => {
                    navigate(ROUTES.productListing, { slugs: [selected.slug] });
                    onClose();
                  }}
                >
                  {buyNowLabelPrice ? `Buy for ${buyNowLabelPrice}` : "Buy"}
                </button>
              </div>
              {kitDescription ? (
                <p className="wingman-kit-details__summary-description">
                  {kitDescription}
                </p>
              ) : null}
              <ul
                className="wingman-kit-details__rail"
                aria-label="Items in this kit"
              >
                {items.map((item) => {
                  const isSelected = item.slug === selected.slug;
                  return (
                    <li
                      key={item.slug}
                      className="wingman-kit-details__rail-cell"
                    >
                      <button
                        type="button"
                        className={
                          "wingman-kit-details__rail-tile" +
                          (isSelected
                            ? " wingman-kit-details__rail-tile--selected"
                            : "")
                        }
                        onClick={() => setSelectedSlug(item.slug)}
                        aria-pressed={isSelected}
                        aria-label={item.title}
                      >
                        <span className="wingman-kit-details__rail-thumb">
                          {item.imageUrl ? (
                            <img
                              src={item.imageUrl}
                              alt=""
                              loading="lazy"
                              className="wingman-kit-details__rail-img"
                            />
                          ) : null}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}

          <section
            className="wingman-kit-details__hero-block"
            aria-label={`${selected.title} preview`}
          >
            <div className="wingman-kit-details__hero">
              <div className="wingman-kit-details__hero-image">
                {heroSrc ? (
                  <img
                    src={heroSrc}
                    alt={selected.title}
                    className="wingman-kit-details__hero-img"
                  />
                ) : null}
              </div>
              {heroSrc ? (
                <button
                  type="button"
                  className="wingman-kit-details__hero-expand"
                  onClick={() => setIsFullscreen(true)}
                  aria-label={`View ${selected.title} full screen`}
                  title="View full screen"
                >
                  <Maximize2 width={16} height={16} aria-hidden="true" />
                </button>
              ) : null}
              {heroGallery.length > 1 ? (
                <>
                  <button
                    type="button"
                    className="wingman-kit-details__hero-nav wingman-kit-details__hero-nav--prev"
                    onClick={() => cycleHeroImage(-1)}
                    aria-label={`Previous image of ${selected.title}`}
                  >
                    <ChevronLeft width={16} height={16} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="wingman-kit-details__hero-nav wingman-kit-details__hero-nav--next"
                    onClick={() => cycleHeroImage(1)}
                    aria-label={`Next image of ${selected.title}`}
                  >
                    <ChevronRight width={16} height={16} aria-hidden="true" />
                  </button>
                </>
              ) : null}
              {galleryThumbs.length > 0 ? (
                <ul
                  ref={galleryRef}
                  className="wingman-kit-details__gallery"
                  aria-label={`${selected.title} gallery`}
                >
                  {galleryThumbs.map((src, i) => {
                    const isActiveThumb = i === safeGalleryIndex;
                    return (
                      <li
                        key={`${src}-${i}`}
                        className="wingman-kit-details__gallery-cell"
                        aria-current={isActiveThumb ? "true" : undefined}
                      >
                        <button
                          type="button"
                          className={
                            "wingman-kit-details__gallery-thumb" +
                            (isActiveThumb
                              ? " wingman-kit-details__gallery-thumb--active"
                              : "")
                          }
                          onClick={() => setGalleryIndex(i)}
                          aria-pressed={isActiveThumb}
                          aria-label={`Show image ${i + 1} of ${galleryThumbs.length}`}
                        >
                          <img
                            src={src}
                            alt=""
                            loading="lazy"
                            className="wingman-kit-details__gallery-img"
                          />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </div>
          </section>

          <section className="wingman-kit-details__product">
            <header className="wingman-kit-details__product-head">
              <div className="wingman-kit-details__product-headline">
                <h3 className="wingman-kit-details__product-title">
                  {selected.title}
                </h3>
                {productPrice ? (
                  <div className="wingman-kit-details__product-prices">
                    <span className="wingman-kit-details__product-price">
                      {productPrice}
                    </span>
                    {productListPrice ? (
                      <span className="wingman-kit-details__product-price-strike">
                        {productListPrice}
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </div>
              {mode === "product" ? (
                <div className="wingman-kit-details__product-actions">
                  <button
                    type="button"
                    className="wingman-plan-page__sidebar-button wingman-plan-page__sidebar-button--secondary wingman-kit-details__bundle-cta"
                    onClick={() => {
                      onAddToCustomBundle?.(selected);
                      onClose();
                    }}
                  >
                    <Sparkle
                      width={16}
                      height={16}
                      strokeWidth={1.5}
                      aria-hidden="true"
                    />
                    Create custom bundle
                  </button>
                  <button
                    type="button"
                    className="wingman-plan-page__sidebar-button wingman-plan-page__sidebar-button--secondary"
                    onClick={() => {
                      navigate(ROUTES.cart);
                      onClose();
                    }}
                  >
                    Add to cart
                  </button>
                  <button
                    type="button"
                    className="wingman-plan-page__sidebar-button wingman-plan-page__sidebar-button--primary"
                    onClick={() => {
                      navigate(ROUTES.productListing, { slugs: [selected.slug] });
                      onClose();
                    }}
                  >
                    Buy now
                  </button>
                </div>
              ) : null}
            </header>
            {selected.shortDescription ? (
              <p className="wingman-kit-details__product-description">
                {selected.shortDescription}
              </p>
            ) : null}

            {/* Reviews widget — a small summary plus quick jumps into the
             * full reviews panel (text reviews or video reviews). Only
             * rendered when the caller wired the reviews shortcut. */}
            {onViewReviews && reviewStats ? (
              <div className="wingman-kit-details__reviews">
                <div className="wingman-kit-details__reviews-summary">
                  <div className="wingman-kit-details__reviews-score">
                    <span className="wingman-kit-details__reviews-average">
                      {reviewStats.average.toFixed(1)}
                    </span>
                    <ReviewStars rating={reviewStats.average} />
                    <span className="wingman-kit-details__reviews-count">
                      {reviewStats.count} review
                      {reviewStats.count === 1 ? "" : "s"}
                    </span>
                  </div>
                  {reviewBlurb ? (
                    <p className="wingman-kit-details__reviews-blurb">
                      {reviewBlurb}
                    </p>
                  ) : null}
                </div>
                <div className="wingman-kit-details__reviews-actions">
                  <button
                    type="button"
                    className="wingman-kit-details__reviews-button"
                    onClick={() => onViewReviews(selected, "reviews")}
                  >
                    <MessageSquareText
                      width={15}
                      height={15}
                      aria-hidden="true"
                    />
                    User reviews
                  </button>
                  <button
                    type="button"
                    className="wingman-kit-details__reviews-button"
                    onClick={() => onViewReviews(selected, "videos")}
                  >
                    <Play width={15} height={15} aria-hidden="true" />
                    Video reviews
                  </button>
                </div>
              </div>
            ) : null}

            {/* Tech details — labelled spec pairs from the catalog row.
             * Rendered as a <dl> so screen readers announce each row as
             * a term/definition pair, and so the visual two-column grid
             * (label left, value right) maps to the underlying semantic
             * relationship rather than being a styling-only convention. */}
            {selected.specs.length > 0 ? (
              <div className="wingman-kit-details__product-section">
                <h4 className="wingman-kit-details__product-section-title">
                  Tech details
                </h4>
                <dl className="wingman-kit-details__specs">
                  {selected.specs.map((spec, i) => (
                    <div
                      key={`${spec.label}-${i}`}
                      className="wingman-kit-details__specs-row"
                    >
                      <dt className="wingman-kit-details__specs-label">
                        {spec.label}
                      </dt>
                      <dd className="wingman-kit-details__specs-value">
                        {spec.value}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            ) : null}

            {/* What's in the box — verbatim list from the JB Hi-Fi PDP.
             * Useful right next to specs because the buying decision is
             * often "do I get the battery / cable / case I need", which
             * specs alone don't answer. */}
            {selected.inTheBox.length > 0 ? (
              <div className="wingman-kit-details__product-section">
                <h4 className="wingman-kit-details__product-section-title">
                  What's in the box
                </h4>
                <ul className="wingman-kit-details__in-the-box">
                  {selected.inTheBox.map((item, i) => (
                    <li
                      key={`${item}-${i}`}
                      className="wingman-kit-details__in-the-box-item"
                    >
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>

        </div>

        {/* Dock for the Wingman agent. The floating chat bar portals in
         * here so the assistant "follows" the shopper into the details
         * panel. Positioned as an overlay at the bottom of the card via
         * `.wingman-kit-details__agent-dock` (see WingmanPlanPage.css). */}
        <div className="wingman-kit-details__agent-dock" ref={agentDockRef} />
      </div>
    </>,
    document.body,
  );
}
