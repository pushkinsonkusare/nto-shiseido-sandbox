import { useState } from "react";
import {
  ChevronDownIcon,
  ChevronUpIcon,
} from "../../icons/StorefrontIcons";
import type { AgentCartItem, AgentCartLineItem } from "./AgentCart";
import "./AgentMessageCards.css";

export type AgentOrderItem = AgentCartItem;
export type AgentOrderLineItem = AgentCartLineItem;

export type AgentOrderSummaryProps = {
  /** Optional confirmation banner copy (e.g. "Your order is confirmed!"). */
  acknowledgement?: string;
  /** Summary copy with delivery info (e.g. "Your new Roomba 705 will arrive…"). */
  summary: string;
  /** Order items rendered when the card is expanded. */
  items: AgentOrderItem[];
  /** Order line item totals rendered when the card is expanded. */
  lineItems: AgentOrderLineItem[];
  /** Initial expanded state. Defaults to `false`. */
  defaultExpanded?: boolean;
  /** Optional class name appended to the root element. */
  className?: string;
};

/**
 * AgentOrderSummary — agentic Order Summary card rendered inside the
 * SidecarAssistant chat panel.  Mirrors `Agent_Order_summary` (states:
 * collapsed + expanded) at node-id 32923:51817 / 32923:51826.
 *
 * Structurally similar to AgentCart, but omits the promo code input and
 * the trailing footnote — orders cannot be modified once placed.
 */
export function AgentOrderSummary({
  acknowledgement,
  summary,
  items,
  lineItems,
  defaultExpanded = false,
  className,
}: AgentOrderSummaryProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const rootClass = "agent-summary__card" + (className ? " " + className : "");

  return (
    <article className={rootClass} data-component="agent-order-summary">
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
                expanded ? "Collapse order details" : "Expand order details"
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
      </div>
    </article>
  );
}

export default AgentOrderSummary;
