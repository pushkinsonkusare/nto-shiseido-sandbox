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
  { label: "Mavic 4 Pro", kind: "assistant" },
  { label: "Wireless mic for podcasts", kind: "assistant" },
  { label: "Helmet mount", kind: "assistant" },
  { label: "Gear for moto vlogging", kind: "assistant" },
  { label: "Action camera for diving", kind: "assistant" },
  { label: "Beginner drone under $500", kind: "assistant" },
  { label: "Osmo Pocket 3", kind: "assistant" },
  { label: "FPV starter kit", kind: "assistant" },
  { label: "Mini 4 Pro Fly More Combo", kind: "assistant" },
  { label: "ND filter for Mavic 4 Pro", kind: "assistant" },
];
