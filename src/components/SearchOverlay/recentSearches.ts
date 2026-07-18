/**
 * Static demo "Recent Searches" list shown in the search-suggestions
 * overlay. Hand-curated for the DJI prototype so the dropdown reads as
 * if the shopper has been browsing for camera / drone gear.
 *
 * Each entry maps to one of two destinations:
 *
 *  - `assistant` → fires `agentic:ask-assistant` so the side-by-side
 *    panel picks the prompt up. Use for shopping-style queries the
 *    assistant can answer with a curated card (broad recipes, gear
 *    bundles, comparisons).
 *
 *  - `plp`       → navigates to the catalog PLP. Use for plain
 *    discovery-style queries that don't need conversational handling.
 */
export type RecentSearchKind = "assistant" | "plp";

export type RecentSearch = {
  /** Visible label rendered in the dropdown row. */
  label: string;
  /** Where the click leads — assistant prompt vs PLP nav. */
  kind: RecentSearchKind;
};

export const RECENT_SEARCHES: ReadonlyArray<RecentSearch> = [
  { label: "Ultimune Power Infusing Serum", kind: "assistant" },
  { label: "Serum for dark spots", kind: "assistant" },
  { label: "Vital Perfection eye cream", kind: "assistant" },
  { label: "Routine for dry skin", kind: "assistant" },
  { label: "Sunscreen for oily skin", kind: "assistant" },
  { label: "Anti-aging moisturizer under $90", kind: "assistant" },
  { label: "Benefiance day cream", kind: "assistant" },
  { label: "Cleanser for sensitive skin", kind: "assistant" },
  { label: "Future Solution LX", kind: "assistant" },
  { label: "Refillable skincare", kind: "assistant" },
];
