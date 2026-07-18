import { Fragment, type ReactNode } from "react";
import { useCatalog } from "../../../catalog/CatalogContext";
import { usePrototypeNavigation } from "../../../prototypeRoutes";
import { ExternalLinkIcon } from "../../icons/StorefrontIcons";

/**
 * Render the agent's free-text body as inline JSX, converting the small
 * subset of Markdown the LLM tends to emit into actual HTML. The
 * underlying `<p>` is a plain text node otherwise, so things like
 * `**DJI Neo Drone**` or numbered lists with embedded newlines would
 * read as raw asterisks and get collapsed onto a single line — looks
 * like code, not prose.
 *
 * Supported today:
 * - `**bold**` → <strong>bold</strong>
 * - `\n` (and `\r\n`) → <br />
 *
 * Anything outside this whitelist (italics, headings, bullets, links)
 * is left as literal text — by design. The prompt also asks the model
 * to respond in plain prose, so this renderer is the host-side
 * insurance, not the primary surface.
 */
function renderInlineBody(body: string): ReactNode {
  const lines = body.split(/\r?\n/);
  return lines.map((line, lineIdx) => {
    const parts = line.split(/(\*\*[^*\n]+\*\*)/g).filter((part) => part !== "");
    const lineNodes = parts.map((part, partIdx) => {
      const boldMatch = part.match(/^\*\*([^*\n]+)\*\*$/);
      if (boldMatch) {
        return <strong key={partIdx}>{boldMatch[1]}</strong>;
      }
      return <Fragment key={partIdx}>{part}</Fragment>;
    });
    return (
      <Fragment key={lineIdx}>
        {lineIdx > 0 ? <br /> : null}
        {lineNodes}
      </Fragment>
    );
  });
}

export type AgentPdpUtteranceCta = {
  /** Visible label of the CTA chip. */
  label: string;
  /** Destination URL — opened in a new tab. */
  href: string;
};

type Props = {
  /** Catalog slug of the PDP that originated the prompt. */
  productSlug: string;
  /** Free-text agent answer rendered below the product context header. */
  body: string;
  /** Optional external-link CTA (e.g. "Detailed return policy"). */
  cta?: AgentPdpUtteranceCta;
  /**
   * When false, hide the product context header (thumbnail + title +
   * category). Used by the chat container to suppress repeated headers
   * across consecutive same-product utterances so the streak only
   * anchors once. Defaults to true to preserve the standalone-card
   * behavior for non-streaked callers.
   */
  showContext?: boolean;
};

/**
 * Reply card scoped to a specific PDP — fired when the shopper uses an
 * "Ask Assistant" NBA pill on a product page. Renders a 64×64 product
 * thumbnail + title + category as a context header inside the same
 * `sxs-result-card` chrome used for result cards, with the agent's
 * answer below and an optional external-link CTA. Mirrors the four
 * Figma utterance variants (nodes 33250:60409 / 60410 / 60475 /
 * 33266:60638) so every PDP-originated turn lands in a consistent
 * frame regardless of variant.
 */
export function AgentPdpUtterance({
  productSlug,
  body,
  cta,
  showContext = true,
}: Props) {
  const { getProductBySlug } = useCatalog();
  const { navigateToProduct } = usePrototypeNavigation();
  const product = getProductBySlug(productSlug);

  return (
    <article
      className="sxs-result-card sxs-pdp-utterance"
      aria-label={
        product ? `Reply about ${product.title}` : "Assistant message"
      }
    >
      {product && showContext ? (
        <div className="sxs-result-card__row-wrap">
          <button
            type="button"
            className="sxs-pdp-utterance__context"
            onClick={() => navigateToProduct(product.slug)}
            aria-label={`Open the ${product.title} product page`}
          >
            <span
              className="sxs-pdp-utterance__thumb"
              title={product.title}
              aria-hidden="true"
            >
              <img
                src={product.imageUrl}
                alt={product.imageAlt || product.title}
              />
            </span>
            <span className="sxs-pdp-utterance__lead-text">
              <span className="sxs-pdp-utterance__title">{product.title}</span>
              <span className="sxs-pdp-utterance__category">
                {product.category}
              </span>
            </span>
          </button>
        </div>
      ) : null}

      <div className="sxs-result-card__body">
        <p className="sxs-result-card__body-text">{renderInlineBody(body)}</p>
      </div>

      {cta ? (
        <div className="sxs-pdp-utterance__cta-wrap">
          <a
            className="sxs-pdp-utterance__cta"
            href={cta.href}
            target="_blank"
            rel="noopener noreferrer"
          >
            <span className="sxs-pdp-utterance__cta-label">{cta.label}</span>
            <ExternalLinkIcon
              className="sxs-pdp-utterance__cta-icon"
              width={16}
              height={16}
              aria-hidden="true"
            />
          </a>
        </div>
      ) : null}
    </article>
  );
}

export default AgentPdpUtterance;
