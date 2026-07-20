/**
 * Text sanitization helpers applied to agent-authored copy.
 *
 * These run at the conversation boundary (every `appendMessage` call) so the
 * rule holds sitewide for BOTH deterministic copy builders and free-form LLM
 * output — nothing an agent "says" reaches the UI without passing through here.
 */

/** Em dash (U+2014) and horizontal bar (U+2015). En dashes are intentionally
 * left alone since they legitimately appear in numeric/size ranges. */
const EM_DASH_PATTERN = /\s*[\u2014\u2015]\s*/g;

/**
 * Replace em dashes with a comma so agent utterances read in a natural, spoken
 * store-associate voice instead of the stylized dash the model/copy tends to
 * reach for. Also tidies the punctuation/whitespace the swap can leave behind.
 */
export function stripEmDashes(text: string): string {
  if (!text) return text;
  return text
    .replace(EM_DASH_PATTERN, ", ")
    .replace(/\s*,\s*,\s*/g, ", ") // collapse accidental double commas
    .replace(/\s+,/g, ",") // no space before a comma
    .replace(/\s{2,}/g, " ") // collapse runs of spaces
    .replace(/^\s*,\s*/, "") // no leading comma
    .replace(/\s*,\s*$/, "") // no trailing comma
    .trim();
}
