import type { BroadResultRow } from "../components/BroadResultCard";
import type { CompactResultProduct } from "../components/CompactResultCard";
import type { LatencyLoaderVariant } from "../components";
import type { NbaPill } from "../components/NbaPillRow";

export type SxsMessage =
  | {
      kind: "greeting";
      id: string;
      imageUrl: string;
      imageAlt: string;
      greeting: string;
      body: string;
    }
  | {
      kind: "shopper";
      id: string;
      text: string;
    }
  | {
      kind: "agent_text";
      id: string;
      body: string;
    }
  | {
      kind: "agent_loading";
      id: string;
      variant?: LatencyLoaderVariant;
    }
  | {
      kind: "agent_result_card";
      id: string;
      bodyText: string;
      title: string;
      products: CompactResultProduct[];
      productSlugs: string[];
      /** Full result count for the listing (may exceed `products.length` preview). */
      totalResultCount?: number;
      category?: string;
      /**
       * Canonical `useCaseTags` (`waterproof`, `compact`, `rugged`,
       * etc.) inferred from the shopper query. Threaded through so the
       * PLP applies the same AND-filter the card carousel did —
       * otherwise "osmo accessories for deep sea" would narrow to
       * waterproof in the card but show every Osmo accessory in the
       * PLP.
       */
      useCases?: string[];
      /**
       * Lowercased model token (e.g. `mavic 4 pro`) extracted from the
       * shopper query. Threaded through the See Results handoff so the
       * PLP receives the same compatibility filter the card used.
       */
      compatibleWith?: string;
      /**
       * Buyer tier inferred from the query ("Pro drones",
       * "Beginner action cam", etc.). Threaded so the PLP narrows
       * by tier and doesn't leak Mini/Neo SKUs into a "Pro" card.
       */
      tier?: "beginner" | "intermediate" | "pro";
      /**
       * Price ceiling extracted from the query ("under $200",
       * "less than $1000"). Threaded so the PLP applies the same
       * budget filter the card used.
       */
      priceMax?: number;
      /** Price floor (auto-set for pro-tier asks). */
      priceMin?: number;
      /**
       * v6 subtype hints from the query ("helmet mount" → mount_helmet).
       * Threaded so the PLP narrows to the same specific variant.
       */
      subtypes?: string[];
    }
  | {
      kind: "agent_broad_result_card";
      id: string;
      bodyText: string;
      rows: BroadResultRow[];
    }
  | {
      /**
       * Reply card scoped to a specific PDP, fired when the shopper
       * uses an "Ask Assistant" NBA pill. Renders a product-context
       * header (image + title + category) above the body, with an
       * optional external-link CTA — used today for hygiene
       * (return/warranty/shipping policies pointing at the DJI Help
       * Center), generic FAQs, and the "Ask me anything" intro.
       */
      kind: "agent_pdp_utterance";
      id: string;
      productSlug: string;
      body: string;
      cta?: { label: string; href: string };
    }
  | {
      kind: "agent_nbas";
      id: string;
      pills: NbaPill[];
    };
