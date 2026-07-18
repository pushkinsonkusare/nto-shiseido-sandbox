import type { ReactNode } from "react";
import "./AgentMessageCards.css";

export type AgentSimpleUtteranceCTA = {
  /** Visible label of the CTA. */
  label: string;
  /** Visual rank of the CTA. Defaults to "primary". */
  variant?: "primary" | "secondary";
  /** Optional click handler invoked when the CTA is pressed. */
  onClick?: () => void;
  /** Optional `aria-label` if the label alone is not descriptive enough. */
  ariaLabel?: string;
};

export type AgentSimpleUtteranceProps = {
  /** Optional title (e.g. "Hello!") rendered above the body copy. */
  title?: string;
  /** Body copy rendered as the primary message of the utterance. */
  body: ReactNode;
  /** Optional hero image rendered at the top of the card. */
  imageUrl?: string;
  /** Alt text for the hero image. Defaults to an empty string for decorative use. */
  imageAlt?: string;
  /** Optional list of CTAs rendered beneath the body copy. */
  ctas?: AgentSimpleUtteranceCTA[];
  /** Optional class name appended to the root element. */
  className?: string;
};

/**
 * AgentSimpleUtterance — the canonical agent message card used inside the
 * SidecarAssistant chat panel.  Renders an optional hero image, an optional
 * title, the agent's body copy and an optional stack of CTAs.
 *
 * Mirrors `Agent/Simple_Utterance` from Figma
 * (node-id 32748:34637 in the Storefront Future Components file).
 */
export function AgentSimpleUtterance({
  title,
  body,
  imageUrl,
  imageAlt = "",
  ctas,
  className,
}: AgentSimpleUtteranceProps) {
  const rootClass =
    "agent-msg__card agent-msg__card--padded" + (className ? " " + className : "");

  return (
    <article className={rootClass} data-component="agent-simple-utterance">
      {imageUrl ? (
        <div className="agent-msg__hero">
          <img src={imageUrl} alt={imageAlt} />
        </div>
      ) : null}

      <div className="agent-msg__content">
        {title ? (
          <div className="agent-msg__row">
            <h3 className="agent-msg__title">{title}</h3>
          </div>
        ) : null}

        <div className="agent-msg__row">
          {typeof body === "string" ? (
            <p className="agent-msg__body">{body}</p>
          ) : (
            body
          )}
        </div>

        {ctas && ctas.length > 0 ? (
          <div className="agent-msg__ctas">
            {ctas.map((cta, index) => {
              const variant = cta.variant ?? "primary";
              return (
                <button
                  key={`${cta.label}-${index}`}
                  type="button"
                  className={
                    "agent-msg__btn agent-msg__btn--full" +
                    (variant === "primary"
                      ? " agent-msg__btn--primary"
                      : " agent-msg__btn--secondary")
                  }
                  aria-label={cta.ariaLabel ?? cta.label}
                  onClick={cta.onClick}
                >
                  {cta.label}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    </article>
  );
}

export default AgentSimpleUtterance;
