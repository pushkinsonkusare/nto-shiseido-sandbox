import { useState } from "react";
import {
  AppleIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  MinusIcon,
  PlusIcon,
} from "../../icons/StorefrontIcons";
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
 * AgentPDPCard — agentic Product Detail Page card rendered inside the
 * SidecarAssistant chat panel.  Mirrors `Agent/PDP_Card` (node-id 32748:34755).
 */
export function AgentPDPCard({
  images,
  title,
  price,
  comparePrice,
  description,
  colors,
  sizes,
  initialQuantity = 1,
  maxQuantity = 99,
  onAddToCart,
  onApplePay,
  className,
}: AgentPDPCardProps) {
  const [imageIndex, setImageIndex] = useState(0);
  const [colorId, setColorId] = useState(colors?.[0]?.id);
  const [sizeId, setSizeId] = useState(sizes?.[0]?.id);
  const [quantity, setQuantity] = useState(
    Math.max(1, Math.min(initialQuantity, maxQuantity)),
  );

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

        <div className="agent-pdp__price-row">
          <p className="agent-pdp__price">{price}</p>
          {comparePrice ? (
            <p className="agent-pdp__price--strike">{comparePrice}</p>
          ) : null}
        </div>

        {description ? <p className="agent-pdp__desc">{description}</p> : null}

        {colors && colors.length > 0 ? (
          <div className="agent-pdp__group" role="radiogroup" aria-label="Color">
            <p className="agent-pdp__group-label">
              Color:{" "}
              <span style={{ fontWeight: 400 }}>{colorLabel ?? "—"}</span>
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
              Size: <span style={{ fontWeight: 400 }}>{sizeLabel ?? "—"}</span>
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
          <p className="agent-pdp__group-label">
            Qty: <span style={{ fontWeight: 400 }}>{quantity}</span>
          </p>
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
          <button
            type="button"
            className="agent-msg__btn agent-msg__btn--primary agent-msg__btn--full agent-msg__btn--lg"
            onClick={() => onAddToCart?.({ quantity, colorId, sizeId })}
          >
            Add to Cart
          </button>
          {onApplePay ? (
            <button
              type="button"
              className="agent-msg__btn agent-msg__btn--apple"
              aria-label="Pay with Apple Pay"
              onClick={onApplePay}
            >
              <AppleIcon width={16} height={16} />
              Pay
            </button>
          ) : null}
        </div>
      </div>
    </article>
  );
}

export default AgentPDPCard;
