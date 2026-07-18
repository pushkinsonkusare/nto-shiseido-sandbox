import { ArrowUpRightIcon, RefreshCcwIcon } from "../../icons/StorefrontIcons";
import "./AgentMessageCards.css";

export type AgentNBA = {
  /** Stable id used as the React key. */
  id: string;
  /** Visible label of the NBA pill. */
  label: string;
  /** Optional override for the click handler (otherwise `onSelect` fires). */
  onClick?: () => void;
};

export type AgentNBAsProps = {
  /** Set of NBA pills rendered inline.  Up to 4 are shown by design. */
  nbas: AgentNBA[];
  /** Whether to render the regenerate (refresh) icon button. Defaults to true. */
  regenerateButton?: boolean;
  /** Click handler invoked when an NBA pill is activated. */
  onSelect?: (nba: AgentNBA) => void;
  /** Click handler invoked when the regenerate button is pressed. */
  onRegenerate?: () => void;
  /** Optional class name appended to the root element. */
  className?: string;
};

/**
 * AgentNBAs — "Next Best Actions" pill set rendered after each agent
 * utterance.  Mirrors `NBA Pill Set` (node-id 32923:51870 family) — a wrap
 * of secondary-styled pills followed by an optional refresh icon button.
 */
export function AgentNBAs({
  nbas,
  regenerateButton = true,
  onSelect,
  onRegenerate,
  className,
}: AgentNBAsProps) {
  const rootClass = "agent-nba__set" + (className ? " " + className : "");

  return (
    <div
      className={rootClass}
      role="toolbar"
      aria-label="Next best actions"
      data-component="agent-nbas"
    >
      {nbas.map((nba) => (
        <button
          key={nba.id}
          type="button"
          className="agent-nba__pill"
          onClick={() => {
            if (nba.onClick) {
              nba.onClick();
              return;
            }
            onSelect?.(nba);
          }}
        >
          <span className="agent-nba__pill-label">{nba.label}</span>
          <ArrowUpRightIcon
            className="agent-nba__pill-icon"
            width={16}
            height={16}
          />
        </button>
      ))}
      {regenerateButton ? (
        <button
          type="button"
          className="agent-nba__regen"
          aria-label="Regenerate suggestions"
          onClick={onRegenerate}
        >
          <RefreshCcwIcon width={16} height={16} />
        </button>
      ) : null}
    </div>
  );
}

export default AgentNBAs;
