import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowUpRightIcon,
  RefreshCcwIcon,
  SparkleIcon,
} from "../../components/icons/StorefrontIcons";
import type { CatalogProduct } from "../../catalog/catalog";
import {
  PDP_NBA_PILL_SET_COUNT,
  buildPdpNbaPills,
  type PdpNbaPill,
  type PdpNbaPillKind,
} from "./pdpNbaPills";

export type AskAssistantEventDetail = {
  /** The text the assistant should treat as a shopper utterance. */
  prompt: string;
  /** Slug of the PDP that originated the prompt — used for telemetry and to render the product context header. */
  productSlug?: string;
  /**
   * Kind of NBA pill that fired the prompt. Routes the assistant to the
   * matching utterance variant (hygiene → policy + doc CTA, faq →
   * agentic answer, open → "ask me anything" intro, …). Omitted when the
   * dispatch is not pill-driven.
   */
  pillKind?: PdpNbaPillKind;
};

/** Fire the cross-cutting event both Sidecar and SxS assistants listen for. */
function dispatchAskAssistant(detail: AskAssistantEventDetail) {
  if (typeof document === "undefined") return;
  document.dispatchEvent(
    new CustomEvent<AskAssistantEventDetail>("agentic:ask-assistant", {
      detail,
    }),
  );
}

function emitTelemetry(event: string, payload: Record<string, unknown>) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("agentic:assistant-telemetry", {
      detail: { event, payload, ts: Date.now() },
    }),
  );
}

type Props = {
  product: CatalogProduct;
  catalog: CatalogProduct[];
};

/**
 * "Ask Assistant" NBA module rendered on the PDP — Figma node 33250:50536.
 *
 * Surfaces five contextual pills covering product FAQs, bundling/upsell, and
 * hygiene questions. Clicking any pill fires `agentic:ask-assistant`, which
 * opens the active assistant (Sidecar or SxS) and dispatches the prompt as
 * a shopper turn. The refresh icon cycles through curated alternative sets.
 */
export function PdpNbaPanel({ product, catalog }: Props) {
  const [setIndex, setSetIndex] = useState(0);

  const pills = useMemo(
    () => buildPdpNbaPills(product, catalog, setIndex),
    [product, catalog, setIndex],
  );

  // Reset the rotation whenever the shopper navigates between PDPs so they
  // always land on the curated default set first.
  useEffect(() => {
    setSetIndex(0);
  }, [product.slug]);

  // Fire an impression event each time a new pill set lands in front of the
  // shopper — mirrors the assistant-side telemetry shape.
  useEffect(() => {
    emitTelemetry("pdp_nba_impression", {
      productSlug: product.slug,
      setIndex,
      labels: pills.map((pill) => pill.label),
      kinds: pills.map((pill) => pill.kind),
    });
  }, [product.slug, setIndex, pills]);

  const handlePillClick = useCallback(
    (pill: PdpNbaPill) => {
      emitTelemetry("pdp_nba_click", {
        productSlug: product.slug,
        setIndex,
        kind: pill.kind,
        label: pill.label,
      });
      dispatchAskAssistant({
        prompt: pill.prompt ?? pill.label,
        productSlug: product.slug,
        pillKind: pill.kind,
      });
    },
    [product.slug, setIndex],
  );

  const handleRegenerate = useCallback(() => {
    setSetIndex((current) => (current + 1) % PDP_NBA_PILL_SET_COUNT);
  }, []);

  return (
    <section className="pdp-nba" aria-label="Ask the personal assistant">
      <header className="pdp-nba__header">
        <span className="pdp-nba__header-icon" aria-hidden="true">
          <SparkleIcon width={16} height={16} />
        </span>
        <h2 className="pdp-nba__header-title">Ask Assistant</h2>
        <span className="pdp-nba__badge" aria-label="New feature">
          New
        </span>
      </header>

      <div className="pdp-nba__pill-set" role="toolbar" aria-label="Suggested questions">
        {pills.map((pill) => {
          const showArrow = pill.kind !== "open";
          return (
            <button
              key={pill.id}
              type="button"
              className="pdp-nba__pill"
              data-kind={pill.kind}
              onClick={() => handlePillClick(pill)}
            >
              <span className="pdp-nba__pill-label">{pill.label}</span>
              {showArrow ? (
                <ArrowUpRightIcon
                  className="pdp-nba__pill-icon"
                  width={16}
                  height={16}
                />
              ) : null}
            </button>
          );
        })}
        <button
          type="button"
          className="pdp-nba__regen"
          aria-label="Show different questions"
          onClick={handleRegenerate}
        >
          <RefreshCcwIcon width={16} height={16} />
        </button>
      </div>
    </section>
  );
}

export default PdpNbaPanel;
