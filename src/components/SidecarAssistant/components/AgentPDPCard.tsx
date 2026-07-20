import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  MinusIcon,
  PlusIcon,
  ShoppingCartIcon,
  StarIcon,
} from "../../icons/StorefrontIcons";
import applePayMark from "../../../assets/apple-pay.jpg";
import "./AgentMessageCards.css";

export type AgentPDPColorOption = {
  /** Stable id used for selection. */
  id: string;
  /** Display label, e.g. "Black". */
  label: string;
  /** CSS color rendered as the swatch chip. */
  color: string;
};

export type AgentPDPSizeOption = {
  /** Stable id used for selection. */
  id: string;
  /** Display label, e.g. "XS". */
  label: string;
  /** When true, renders the option in a disabled state. */
  disabled?: boolean;
};

export type AgentPDPCardProps = {
  /** Hero gallery images shown inside the carousel. */
  images: { url: string; alt: string }[];
  title: string;
  /** Formatted price string, e.g. "$15.00". */
  price: string;
  /** Optional formatted strike-through price, e.g. "$20.00". */
  comparePrice?: string;
  /** Body / marketing copy rendered between pricing and pickers. */
  description?: string;
  /** Optional average rating between 0 and 5. Star row is hidden when omitted. */
  rating?: number;
  /** Optional review count rendered beside the star row. */
  reviewCount?: number;
  /** Color variants. The first option is selected by default. */
  colors?: AgentPDPColorOption[];
  /** Size variants. The first option is selected by default. */
  sizes?: AgentPDPSizeOption[];
  /** Initial quantity. Defaults to 1. */
  initialQuantity?: number;
  /** Maximum allowed quantity. Defaults to 99. */
  maxQuantity?: number;
  /** Click handler for the primary CTA. */
  onAddToCart?: (selection: {
    quantity: number;
    colorId?: string;
    sizeId?: string;
  }) => void;
  /** Click handler for the Apple Pay CTA. Hidden when not provided. */
  onApplePay?: () => void;
  /** Optional class name appended to the root element. */
  className?: string;
};

/**
 * Five-star rating row with fractional (half-star) fill. Each position
 * renders an empty star with a filled star clipped to the remaining fill
 * fraction, so a 4.5 rating shows four full stars and one half star.
 */
function StarRating({
  rating,
  reviewCount,
}: {
  rating: number;
  reviewCount?: number;
}) {
  const clamped = Math.max(0, Math.min(5, rating));
  return (
    <div className="agent-pdp__rating">
      <span className="agent-pdp__rating-value">{clamped.toFixed(1)}</span>
      <span
        className="agent-pdp__stars"
        role="img"
        aria-label={`${clamped.toFixed(1)} out of 5 stars`}
      >
        {Array.from({ length: 5 }).map((_, index) => {
          const fill = Math.max(0, Math.min(1, clamped - index));
          return (
            <span key={index} className="agent-pdp__star">
              <StarIcon width={14} height={14} />
              <span
                className="agent-pdp__star-fill"
                style={{ width: `${fill * 100}%` }}
              >
                <StarIcon width={14} height={14} />
              </span>
            </span>
          );
        })}
      </span>
      {typeof reviewCount === "number" ? (
        <span className="agent-pdp__rating-count">
          ({reviewCount.toLocaleString()} reviews)
        </span>
      ) : null}
    </div>
  );
}

/**
 * AgentPDPCard is the agentic Product Detail Page card rendered inside the
 * SidecarAssistant chat panel.  Mirrors `Agent/PDP_Card` (node-id 32748:34755).
 */
export function AgentPDPCard({
  images,
  title,
  price,
  comparePrice,
  description,
  rating,
  reviewCount,
  colors,
  sizes,
  initialQuantity = 1,
  maxQuantity = 99,
  onAddToCart,
  onApplePay,
  className,
}: AgentPDPCardProps) {
  const [imageIndex, setImageIndex] = useState(0);
  const [descExpanded, setDescExpanded] = useState(false);
  const [descClamped, setDescClamped] = useState(false);
  const descRef = useRef<HTMLParagraphElement | null>(null);
  const [colorId, setColorId] = useState(colors?.[0]?.id);
  const [sizeId, setSizeId] = useState(sizes?.[0]?.id);
  const [quantity, setQuantity] = useState(
    Math.max(1, Math.min(initialQuantity, maxQuantity)),
  );

  // Detect whether the description overflows the 4-line clamp so we only
  // render the "Read more" affordance when there's actually hidden copy.
  useLayoutEffect(() => {
    setDescExpanded(false);
    const measure = () => {
      const node = descRef.current;
      if (!node) return;
      setDescClamped(node.scrollHeight - node.clientHeight > 1);
    };
    measure();
  }, [description]);

  useEffect(() => {
    const onResize = () => {
      const node = descRef.current;
      if (!node || descExpanded) return;
      setDescClamped(node.scrollHeight - node.clientHeight > 1);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [descExpanded]);

  const total = images.length;
  const goPrev = () =>
    setImageIndex((current) => (current - 1 + total) % Math.max(1, total));
  const goNext = () =>
    setImageIndex((current) => (current + 1) % Math.max(1, total));

  const decrement = () => setQuantity((q) => Math.max(1, q - 1));
  const increment = () => setQuantity((q) => Math.min(maxQuantity, q + 1));

  const colorLabel = colors?.find((c) => c.id === colorId)?.label;
  const sizeLabel = sizes?.find((s) => s.id === sizeId)?.label;

  const rootClass = "agent-pdp__card" + (className ? " " + className : "");

  return (
    <article className={rootClass} data-component="agent-pdp-card">
      <div className="agent-pdp__gallery">
        {images.length > 0 ? (
          <img src={images[imageIndex].url} alt={images[imageIndex].alt} />
        ) : null}
        {images.length > 1 ? (
          <>
            <button
              type="button"
              className="agent-pdp__nav agent-pdp__nav--prev"
              aria-label="Previous image"
              onClick={goPrev}
            >
              <ArrowLeftIcon width={16} height={16} />
            </button>
            <button
              type="button"
              className="agent-pdp__nav agent-pdp__nav--next"
              aria-label="Next image"
              onClick={goNext}
            >
              <ArrowRightIcon width={16} height={16} />
            </button>
          </>
        ) : null}
      </div>

      <div className="agent-pdp__content">
        <h3 className="agent-pdp__title">{title}</h3>

        {typeof rating === "number" ? (
          <StarRating rating={rating} reviewCount={reviewCount} />
        ) : null}

        <div className="agent-pdp__price-row">
          <p className="agent-pdp__price">{price.replace(/^From\s+/i, "")}</p>
          {comparePrice ? (
            <p className="agent-pdp__price--strike">{comparePrice}</p>
          ) : null}
        </div>

        {description ? (
          <div className="agent-pdp__desc-wrap">
            <p
              ref={descRef}
              className={
                "agent-pdp__desc" +
                (descExpanded ? "" : " agent-pdp__desc--clamped")
              }
            >
              {description}
              {descClamped && descExpanded ? (
                <>
                  {" "}
                  <button
                    type="button"
                    className="agent-pdp__desc-toggle agent-pdp__desc-toggle--inline"
                    onClick={() => setDescExpanded(false)}
                  >
                    Show less
                  </button>
                </>
              ) : null}
            </p>
            {descClamped && !descExpanded ? (
              <button
                type="button"
                className="agent-pdp__desc-toggle"
                onClick={() => setDescExpanded(true)}
              >
                Read more
              </button>
            ) : null}
          </div>
        ) : null}

        {colors && colors.length > 0 ? (
          <div className="agent-pdp__group" role="radiogroup" aria-label="Color">
            <p className="agent-pdp__group-label">
              Color:{" "}
              <span style={{ fontWeight: 400 }}>{colorLabel ?? "N/A"}</span>
            </p>
            <div className="agent-pdp__group-options">
              {colors.map((option) => {
                const selected = option.id === colorId;
                return (
                  <button
                    key={option.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    className={
                      "agent-pdp__option agent-pdp__option--swatch" +
                      (selected ? " agent-pdp__option--selected" : "")
                    }
                    onClick={() => setColorId(option.id)}
                  >
                    <span
                      className="agent-pdp__option-swatch"
                      style={{ ["--swatch-color" as string]: option.color }}
                    />
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        {sizes && sizes.length > 0 ? (
          <div className="agent-pdp__group" role="radiogroup" aria-label="Size">
            <p className="agent-pdp__group-label">
              Size: <span style={{ fontWeight: 400 }}>{sizeLabel ?? "N/A"}</span>
            </p>
            <div className="agent-pdp__group-options">
              {sizes.map((option) => {
                const selected = option.id === sizeId;
                return (
                  <button
                    key={option.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    disabled={option.disabled}
                    className={
                      "agent-pdp__option" +
                      (selected ? " agent-pdp__option--selected" : "")
                    }
                    onClick={() => setSizeId(option.id)}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        <div className="agent-pdp__group">
          <p className="agent-pdp__group-label">Quantity</p>
          <div className="agent-pdp__qty">
            <button
              type="button"
              className="agent-pdp__qty-btn"
              aria-label="Decrease quantity"
              onClick={decrement}
              disabled={quantity <= 1}
            >
              <MinusIcon width={16} height={16} />
            </button>
            <span className="agent-pdp__qty-value" aria-live="polite">
              {quantity}
            </span>
            <button
              type="button"
              className="agent-pdp__qty-btn"
              aria-label="Increase quantity"
              onClick={increment}
              disabled={quantity >= maxQuantity}
            >
              <PlusIcon width={16} height={16} />
            </button>
          </div>
        </div>

        <div className="agent-pdp__ctas">
          {onApplePay ? (
            <button
              type="button"
              className="agent-msg__btn agent-msg__btn--apple"
              aria-label="Pay with Apple Pay"
              onClick={onApplePay}
            >
              <img
                className="agent-msg__apple-pay-mark"
                src={applePayMark}
                alt="Apple Pay"
              />
            </button>
          ) : null}
          <button
            type="button"
            className="agent-msg__btn agent-msg__btn--secondary agent-msg__btn--full agent-msg__btn--lg"
            onClick={() => onAddToCart?.({ quantity, colorId, sizeId })}
          >
            <ShoppingCartIcon width={16} height={16} />
            Add to Cart
          </button>
        </div>
      </div>
    </article>
  );
}

export default AgentPDPCard;
