/**
 * Stub assistant-reply composer. Picks an "intent phrase" out of the
 * shopper's message and weaves it into a canned acknowledgement so the
 * reply names the same characteristic the shopper asked for. No real
 * LLM — keywords mapped to phrases harvested from the DJI catalog's
 * use-case + capability tags (see `data/dji_products_tagged_v6.csv`).
 *
 * The keyword list is intentionally small (≈18 entries). It's matched
 * left-to-right, first-match-wins, against the lowercased message.
 * Anything that doesn't match falls through to a generic "updated to
 * better fit your needs" reply, which still feels like the assistant
 * acknowledged the request.
 *
 * The Figma after-messages state shows: shopper says "Suggest me
 * drones that do well in wind", assistant replies "Sure i will update
 * your preference and update products accordingly. I have updated the
 * combos to fit wind resistant drone." This file produces the second
 * sentence of that reply with `{intent}` filled in based on the input.
 */

type Intent = {
  /** Pattern to match in the shopper's lowercased message. */
  match: RegExp;
  /** Phrase to splice into the canned reply (e.g. "wind-resistant"). */
  phrase: string;
};

/* Order matters — the first regex that hits decides the phrase. More
 * specific patterns sit above their generic neighbours so e.g.
 * "rainproof" beats a bare "rain" hit. */
const INTENTS: Intent[] = [
  { match: /\bwind(y|s)?\b/, phrase: "wind-resistant drones" },
  { match: /\brain(proof|y)?\b/, phrase: "rain-rated gear" },
  { match: /\b(low\s*light|night|dark)\b/, phrase: "low-light shooting" },
  { match: /\bcold|snow|winter\b/, phrase: "cold-weather kits" },
  { match: /\b(beach|desert|hot|warm)\b/, phrase: "warm-weather kits" },
  { match: /\b(travel|portable|compact|backpack|carry[\s-]?on)\b/, phrase: "compact travel-friendly gear" },
  { match: /\b(beginner|new\s*to|first[\s-]?time|starter)\b/, phrase: "beginner-friendly kits" },
  { match: /\b(pro(fessional)?|advanced|expert|cinema)\b/, phrase: "pro-grade gear" },
  { match: /\b(cheap(er)?|budget|affordable|value|under\s*\$?\d+)\b/, phrase: "budget-friendly options" },
  { match: /\b(premium|luxury|top[\s-]?tier|best)\b/, phrase: "premium picks" },
  { match: /\b(fpv|first[\s-]?person|racing|race)\b/, phrase: "FPV / racing setups" },
  { match: /\b(action|sports?|surf|ski|bike|skate|moto)\b/, phrase: "action-sports gear" },
  { match: /\b(vlog|youtube|content|creator|streamer)\b/, phrase: "creator-focused gear" },
  { match: /\b(family|kids|holiday|trip)\b/, phrase: "family-friendly options" },
  { match: /\b(real[\s-]?estate|architecture|inspect|survey|map)\b/, phrase: "survey & inspection drones" },
  { match: /\b(wedding|event|interview)\b/, phrase: "event-grade gear" },
  { match: /\b(long(er)?\s*range|distance|far|reach)\b/, phrase: "long-range drones" },
  { match: /\b(quiet|silent|low[\s-]?noise)\b/, phrase: "quiet-flying drones" },
];

const FALLBACK_PHRASE = "better fit your needs";

export function detectIntent(userText: string): string {
  const lower = userText.toLowerCase();
  for (const { match, phrase } of INTENTS) {
    if (match.test(lower)) return phrase;
  }
  return FALLBACK_PHRASE;
}

/**
 * Build the assistant reply for the given shopper message. Keeps the
 * exact two-sentence cadence of the Figma copy so the after-messages
 * state reads identically to the design when the shopper asks the
 * Figma example question ("…drones that do well in wind").
 */
export function composeAssistantReply(userText: string): string {
  const intent = detectIntent(userText);
  return `Sure, I'll update your preferences and refresh the products accordingly. I've updated the combos to focus on ${intent}.`;
}
