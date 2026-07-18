import { useState } from "react";
import {
  AppleIcon,
  ChevronDownIcon,
  ChevronUpIcon,
} from "../../icons/StorefrontIcons";
import "./AgentMessageCards.css";

export type AgentCartItem = {
  id: string;
  imageUrl: string;
  imageAlt: string;
  title: string;
  /** Optional bullet metadata lines (e.g. ["Color: Blue", "Size: S"]). */
  meta?: string[];
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
  /** Display value, e.g. "$32.00" or "-$5.00". */
  value: string;
  /** When true, renders the row using the bold "total" style. */
  emphasis?: boolean;
};

export type AgentCartProps = {
  /** Optional acknowledgement banner copy shown above the summary. */
  acknowledgement?: string;
  /** Summary copy, e.g. "Your cart has 2 items with a total of $330.46…". */
  summary: string;
  /** Cart items rendered when the card is expanded. */
  items: AgentCartItem[];
  /** Cart line item totals rendered when the card is expanded. */
  lineItems: AgentCartLineItem[];
  /** Initial expanded state. Defaults to `false`. */
  defaultExpanded?: boolean;
  /** Called when a promo code is submitted via the input. */
  onApplyPromo?: (code: string) => void;
  /** Footnote rendered beneath the promo code field. */
  footnote?: string;
  /**
   * When provided, renders a primary "Checkout" button beneath the totals.
   * Receives no arguments — the host orchestrates the actual checkout step.
   */
  onCheckout?: () => void;
  /** Visible label of the primary checkout CTA. Defaults to "Checkout". */
  checkoutLabel?: string;
  /** When provided, renders an Apple Pay shortcut next to the checkout CTA. */
  onApplePay?: () => void;
  /** Optional class name appended to the root element. */
  className?: string;
};

/**
 * AgentCart — agentic Cart card rendered inside the SidecarAssistant chat
 * panel.  Matches the Figma `Agent_Cart_summary` component (states: collapsed
 * + expanded) at node-id 32923:51742 / 32923:51762.
 */
export function AgentCart({
  acknowledgement,
  summary,
  items,
  lineItems,
  defaultExpanded = false,
  onApplyPromo,
  footnote = "Shipping and taxes will be calculated at time of payment.",
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
    <article className={rootClass} data-component="agent-cart">
      <div className="agent-summary__card-content">
        {acknowledgement ? (
          <>
            <div className="agent-summary__row">
              <p className="agent-summary__acknowledgement">{acknowledgement}</p>
            </div>
            <div className="agent-summary__divider" role="presentation" />
          </>
        ) : null}

        <div className="agent-summary__row">
          <div className="agent-summary__head">
            <p>{summary}</p>
            <button
              type="button"
              className="agent-summary__expand-btn"
              aria-expanded={expanded}
              aria-label={
                expanded ? "Collapse cart details" : "Expand cart details"
              }
              onClick={() => setExpanded((current) => !current)}
            >
              {expanded ? (
                <ChevronUpIcon width={16} height={16} />
              ) : (
                <ChevronDownIcon width={16} height={16} />
              )}
            </button>
          </div>
        </div>

        {expanded ? (
          <div className="agent-summary__details">
            <div className="agent-summary__items">
              {items.map((item) => (
                <div key={item.id} className="agent-summary__item">
                  <div className="agent-summary__thumb">
                    <img src={item.imageUrl} alt={item.imageAlt} />
                  </div>
                  <div className="agent-summary__item-body">
                    <div className="agent-summary__item-info">
                      <h4 className="agent-summary__item-title">{item.title}</h4>
                      {item.meta && item.meta.length > 0 ? (
                        <div>
                          {item.meta.map((line) => (
                            <p key={line} className="agent-summary__item-meta">
                              {line}
                            </p>
                          ))}
                        </div>
                      ) : null}
                      <div className="agent-summary__item-pricing">
                        {item.comparePrice ? (
                          <span className="agent-summary__item-pricing--strike">
                            {item.comparePrice}
                          </span>
                        ) : null}
                        <span className="agent-summary__item-pricing--main">
                          {item.price}
                        </span>
                      </div>
                      <p className="agent-summary__item-meta">
                        Qty: {item.quantity}
                      </p>
                    </div>
                    {item.savedBadge ? (
                      <div className="agent-summary__item-aside">
                        <span className="agent-summary__badge">
                          {item.savedBadge}
                        </span>
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>

            <div className="agent-summary__lines">
              {lineItems.map((line, index) => (
                <div
                  key={`${line.label}-${index}`}
                  className={
                    "agent-summary__line" +
                    (line.emphasis ? " agent-summary__line--total" : "")
                  }
                >
                  <span>{line.label}</span>
                  <span>{line.value}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <form className="agent-summary__promo" onSubmit={handlePromoSubmit}>
          <input
            type="text"
            className="agent-summary__promo-input"
            placeholder="Promo Code…"
            value={promoCode}
            onChange={(event) => setPromoCode(event.target.value)}
            aria-label="Promo code"
          />
          <button
            type="submit"
            className="agent-msg__btn agent-msg__btn--secondary"
            disabled={!promoCode.trim()}
          >
            Apply
          </button>
        </form>

        {onCheckout || onApplePay ? (
          <div className="agent-pdp__ctas">
            {onCheckout ? (
              <button
                type="button"
                className="agent-msg__btn agent-msg__btn--primary agent-msg__btn--full agent-msg__btn--lg"
                onClick={onCheckout}
              >
                {checkoutLabel}
              </button>
            ) : null}
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
        ) : null}

        <div className="agent-summary__divider" role="presentation" />

        <div className="agent-summary__row">
          <p className="agent-summary__footnote">{footnote}</p>
        </div>
      </div>
    </article>
  );
}

export default AgentCart;
