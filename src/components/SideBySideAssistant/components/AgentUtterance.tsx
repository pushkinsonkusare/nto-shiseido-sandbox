type Props = {
  /** Free-text agent reply. Renders as a single paragraph inside a card. */
  text: string;
};

/**
 * Free-text agent reply, rendered with the same `.sxs-result-card` chrome
 * (#fafafa surface, #d1d5db border, 24px vertical / 24px horizontal padding)
 * as the result cards so every assistant utterance — text or card — sits
 * inside a consistent component frame. Mirrors the Figma "Agent /
 * Simple_Utterance" node so we never fall back to a bare paragraph.
 */
export function AgentUtterance({ text }: Props) {
  return (
    <article className="sxs-result-card sxs-utterance" aria-label="Assistant message">
      <div className="sxs-result-card__body">
        <p className="sxs-utterance__text">{text}</p>
      </div>
    </article>
  );
}

export default AgentUtterance;
