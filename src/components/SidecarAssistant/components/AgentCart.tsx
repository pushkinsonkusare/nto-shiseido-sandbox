import { useState } from "react";
import {
  ArrowRightIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  CloseIcon,
  ExternalLinkIcon,
  MinusIcon,
  PlusIcon,
  TagIcon,
} from "../../icons/StorefrontIcons";
import applePayMark from "../../../assets/apple-pay.jpg";
import "./AgentMessageCards.css";

export type AgentCartItem = {
  id: string;
  imageUrl: string;
  imageAlt: string;
  title: string;
  /** Optional bullet metadata lines (e.g. ["Color: Blue", "Size: S"]). */
  meta?: string[];
  /** Optional promotion label, e.g. "BLAZERSAVE". Rendered as "Promotion: …". */
  promotion?: string;
  /** Optional item-level coupon codes rendered as removable chips. */
  couponTags?: string[];
  /** Formatted active price, e.g. "$15.00". */
  price: string;
  /** Optional formatted strike-through price, e.g. "$20.00". */
  comparePrice?: string;
  quantity: number;
  /** Optional badge label rendered to the right of the row (e.g. "Saved $5.00"). */
  savedBadge?: string;
};

export type AgentCartLineItem = {
  /** Display label, e.g. "Subtotal". */
  label: string;
  /** Optional emphasised note rendered next to the label, e.g. "Sitewide10". */
  note?: string;
  /** Display value, e.g. "$32.00" or "-$5.00". */
  value: string;
  /** When true, renders the row using the bold "total" style. */
  emphasis?: boolean;
};

export type AgentCartProps = {
  /** Optional acknowledgement copy shown above the card. */
  acknowledgement?: string;
  /** Summary copy, e.g. "Your cart has 2 items with a total of $330.46…". */
  summary: string;
  /** Cart items rendered when the card is expanded. */
  items: AgentCartItem[];
  /** Cart line item totals rendered when the card is expanded. */
  lineItems: AgentCartLineItem[];
  /** Cart-level coupon codes rendered as removable chips when expanded. */
  cartCoupons?: string[];
  /** Initial expanded state. Defaults to `false`. */
  defaultExpanded?: boolean;
  /** Called when a promo/coupon code is submitted via the input. */
  onApplyPromo?: (code: string) => void;
  /** Called when a cart-level coupon chip's remove control is clicked. */
  onRemoveCoupon?: (code: string) => void;
  /** Called when an item-level coupon chip's remove control is clicked. */
  onRemoveItemCoupon?: (itemId: string, code: string) => void;
  /** Called when an item's quantity stepper changes. */
  onQuantityChange?: (itemId: string, quantity: number) => void;
  /** Called when an item's "Remove" control is clicked. */
  onRemoveItem?: (itemId: string) => void;
  /** Footnote rendered beneath the CTAs. */
  footnote?: string;
  /**
   * When provided, renders a primary "Checkout" button beneath the totals.
   * Receives no arguments — the host orchestrates the actual checkout step.
   */
  onCheckout?: () => void;
  /** Visible label of the primary checkout CTA. Defaults to "Checkout". */
  checkoutLabel?: string;
  /** When provided, renders an Apple Pay shortcut above the checkout CTA. */
  onApplePay?: () => void;
  /** Optional class name appended to the root element. */
  className?: string;
};

/**
 * AgentCart — agentic Cart card rendered inside the SidecarAssistant chat
 * panel. The acknowledgement sits above a bordered accordion card whose header
 * (summary + chevron) toggles a detailed review of line items, per-item
 * quantity/remove controls, promotions and coupon chips, followed by the promo
 * field and stacked Apple Pay / Checkout CTAs.
 */
export function AgentCart({
  acknowledgement,
  summary,
  items,
  lineItems,
  cartCoupons,
  defaultExpanded = false,
  onApplyPromo,
  onRemoveCoupon,
  onRemoveItemCoupon,
  onQuantityChange,
  onRemoveItem,
  footnote = "Shipping and taxes calculated at checkout.",
  onCheckout,
  checkoutLabel = "Checkout",
  onApplePay,
  className,
}: AgentCartProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [promoCode, setPromoCode] = useState("");

  const rootClass = "agent-summary__card" + (className ? " " + className : "");

  const handlePromoSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!promoCode.trim()) return;
    onApplyPromo?.(promoCode.trim());
    setPromoCode("");
  };

  return (
    <div className="agent-cart" data-component="agent-cart">
      <article className={rootClass}>
        <div className="agent-summary__card-content">
          {acknowledgement ? (
            <div className="agent-summary__row">
              <p className="agent-summary__acknowledgement">
                {acknowledgement}
              </p>
            </div>
          ) : null}

          <div className="agent-summary__row">
            <div className="agent-summary__box">
              <button
                type="button"
                className="agent-summary__box-header"
                aria-expanded={expanded}
                aria-label={
                  expanded ? "Collapse cart details" : "Expand cart details"
                }
                onClick={() => setExpanded((current) => !current)}
              >
                <p className="agent-summary__box-summary">{summary}</p>
                <span className="agent-summary__toggle">
                  {expanded ? (
                    <ChevronUpIcon width={18} height={18} />
                  ) : (
                    <ChevronDownIcon width={18} height={18} />
                  )}
                </span>
              </button>

              {expanded ? (
                <div className="agent-summary__details">
                  <div className="agent-summary__items">
                    {items.map((item) => (
                      <div key={item.id} className="agent-summary__item">
                        <div className="agent-summary__thumb">
                          <img src={item.imageUrl} alt={item.imageAlt} />
                        </div>
                        <div className="agent-summary__item-info">
                          <h4
                            className="agent-summary__item-title"
                            title={item.title}
                          >
                            {item.title}
                          </h4>

                          {item.meta && item.meta.length > 0 ? (
                            <div className="agent-summary__item-meta-group">
                              {item.meta.map((line) => (
                                <p
                                  key={line}
                                  className="agent-summary__item-meta"
                                >
                                  {line}
                                </p>
                              ))}
                            </div>
                          ) : null}

                          {item.promotion ? (
                            <p className="agent-summary__item-meta">
                              Promotion: {item.promotion}
                            </p>
                          ) : null}

                          {item.couponTags && item.couponTags.length > 0 ? (
                            <div className="agent-summary__chips">
                              {item.couponTags.map((code) => (
                                <span
                                  key={code}
                                  className="agent-summary__chip"
                                >
                                  <TagIcon
                                    className="agent-summary__chip-icon"
                                    width={12}
                                    height={12}
                                  />
                                  <span className="agent-summary__chip-label">
                                    {code}
                                  </span>
                                  <button
                                    type="button"
                                    className="agent-summary__chip-remove"
                                    aria-label={`Remove coupon ${code}`}
                                    onClick={() =>
                                      onRemoveItemCoupon?.(item.id, code)
                                    }
                                  >
                                    <CloseIcon width={12} height={12} />
                                  </button>
                                </span>
                              ))}
                            </div>
                          ) : null}

                          <div className="agent-summary__item-pricing">
                            <span className="agent-summary__item-pricing--main">
                              {item.price.replace(/^From\s+/i, "")}
                            </span>
                            {item.comparePrice ? (
                              <span className="agent-summary__item-pricing--strike">
                                {item.comparePrice}
                              </span>
                            ) : null}
                          </div>

                          <div className="agent-summary__qty">
                            <span className="agent-summary__qty-label">
                              Quantity
                            </span>
                            <div
                              className="agent-summary__stepper"
                              role="group"
                              aria-label={`Quantity for ${item.title}`}
                            >
                              <button
                                type="button"
                                className="agent-summary__stepper-btn"
                                aria-label="Decrease quantity"
                                disabled={item.quantity <= 1}
                                onClick={() =>
                                  onQuantityChange?.(
                                    item.id,
                                    Math.max(1, item.quantity - 1),
                                  )
                                }
                              >
                                <MinusIcon width={14} height={14} />
                              </button>
                              <span className="agent-summary__stepper-value">
                                {item.quantity}
                              </span>
                              <button
                                type="button"
                                className="agent-summary__stepper-btn"
                                aria-label="Increase quantity"
                                onClick={() =>
                                  onQuantityChange?.(item.id, item.quantity + 1)
                                }
                              >
                                <PlusIcon width={14} height={14} />
                              </button>
                            </div>
                          </div>

                          <button
                            type="button"
                            className="agent-summary__remove"
                            onClick={() => onRemoveItem?.(item.id)}
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  {cartCoupons && cartCoupons.length > 0 ? (
                    <div className="agent-summary__chips agent-summary__chips--cart">
                      {cartCoupons.map((code) => (
                        <span key={code} className="agent-summary__chip">
                          <TagIcon
                            className="agent-summary__chip-icon"
                            width={12}
                            height={12}
                          />
                          <span className="agent-summary__chip-label">
                            {code}
                          </span>
                          <button
                            type="button"
                            className="agent-summary__chip-remove"
                            aria-label={`Remove coupon ${code}`}
                            onClick={() => onRemoveCoupon?.(code)}
                          >
                            <CloseIcon width={12} height={12} />
                          </button>
                        </span>
                      ))}
                    </div>
                  ) : null}

                  <div className="agent-summary__lines">
                    {lineItems.map((line, index) => (
                      <div
                        key={`${line.label}-${index}`}
                        className={
                          "agent-summary__line" +
                          (line.emphasis ? " agent-summary__line--total" : "")
                        }
                      >
                        <span className="agent-summary__line-label">
                          {line.label}
                          {line.note ? (
                            <span className="agent-summary__line-note">
                              {line.note}
                            </span>
                          ) : null}
                        </span>
                        <span className="agent-summary__line-value">
                          {line.value}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          <form className="agent-summary__promo" onSubmit={handlePromoSubmit}>
            <input
              type="text"
              className="agent-summary__promo-input"
              placeholder="Enter coupon code"
              value={promoCode}
              onChange={(event) => setPromoCode(event.target.value)}
              aria-label="Coupon code"
            />
            <button
              type="submit"
              className="agent-summary__promo-submit"
              aria-label="Apply coupon code"
              disabled={!promoCode.trim()}
            >
              <ArrowRightIcon width={16} height={16} />
            </button>
          </form>

          {onCheckout || onApplePay ? (
            <div className="agent-summary__ctas">
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
              {onCheckout ? (
                <button
                  type="button"
                  className="agent-msg__btn agent-msg__btn--secondary agent-msg__btn--full agent-msg__btn--lg"
                  onClick={onCheckout}
                >
                  <ExternalLinkIcon width={16} height={16} />
                  {checkoutLabel}
                </button>
              ) : null}
            </div>
          ) : null}

          <div className="agent-summary__row">
            <p className="agent-summary__footnote">{footnote}</p>
          </div>
        </div>
      </article>
    </div>
  );
}

export default AgentCart;
