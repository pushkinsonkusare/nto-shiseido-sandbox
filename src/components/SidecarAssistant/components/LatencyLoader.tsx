import { LoaderCircleIcon } from "../../icons/StorefrontIcons";
import "./LatencyLoader.css";

export type LatencyLoaderVariant =
  | "thinking"
  | "answering"
  | "fetching_order"
  | "completing_order"
  | "fetching_payment";

const VARIANT_LABELS: Record<LatencyLoaderVariant, string> = {
  thinking: "Working on it…",
  answering: "Looking for answers…",
  fetching_order: "Fetching your order details…",
  completing_order: "Completing order…",
  fetching_payment: "Fetching your payment details…",
};

export type LatencyLoaderProps = {
  /** Pre-canned status message variants matching the Figma component. */
  variant?: LatencyLoaderVariant;
  /** Optional override label.  When provided, supersedes `variant`. */
  label?: string;
  /** Optional class name appended to the root element. */
  className?: string;
};

/**
 * LatencyLoader — agentic "the assistant is working" indicator rendered
 * inside the chat panel while a response is in flight.  Mirrors
 * `Latency Loader` (node-id 32933:112416 family) from Figma.
 */
export function LatencyLoader({
  variant = "thinking",
  label,
  className,
}: LatencyLoaderProps) {
  const text = label ?? VARIANT_LABELS[variant];
  const rootClass = "agent-loader" + (className ? " " + className : "");

  return (
    <div
      className={rootClass}
      role="status"
      aria-live="polite"
      data-component="latency-loader"
    >
      <span className="agent-loader__spinner" aria-hidden="true">
        <LoaderCircleIcon width={20} height={20} />
      </span>
      <span className="agent-loader__label">{text}</span>
    </div>
  );
}

export default LatencyLoader;
