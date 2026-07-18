import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { useCatalog } from "../../catalog/CatalogContext";
import { toProductCardProps } from "../../catalog/catalog";
import { suggestQueryCorrection, tokenize } from "../../catalog/searchEngine";
import { ROUTES, usePrototypeNavigation } from "../../prototypeRoutes";
import { ArrowRight as LucideArrowRight, Sparkle as LucideSparkle } from "lucide-react";
import {
  CloseIcon,
  HistoryIcon,
  SearchIcon,
  SparkleIcon,
} from "../icons/StorefrontIcons";
import ProductCard from "../ProductCard/ProductCard";
import PrototypeBrandLink from "../PrototypeBrandLink";
import { SITE_BRAND } from "../../siteContent";
import { RECENT_SEARCHES, type RecentSearch } from "./recentSearches";
import { useSearchOverlay } from "./SearchOverlayContext";
import { useAgentMode } from "../AgentModeBar/AgentModeContext";
import {
  buildAssistantSuggestionsRuleBased,
  type AssistantSuggestion,
} from "./assistantSuggestions";
import {
  fetchAssistantSuggestionsLLM,
  isLlmAvailable,
} from "./assistantSuggestionsLLM";
import "./SearchOverlay.css";

/**
 * Minimum trimmed length before we run the live search. Matches
 * common e-com behaviour — single-letter queries dump too many false
 * positives into the dropdown.
 */
const MIN_QUERY_LEN = 2;

/**
 * Debounce window between the last keystroke and the live search.
 * 150ms keeps the search feeling responsive at typing speed (a fast
 * typist hits ~80-120ms/key, so 300ms used to skip the first 2-3
 * characters worth of feedback and made the 2-char MIN_QUERY_LEN
 * feel like a 4-char gate). The engine is sub-millisecond at 250
 * docs so this window is purely about settling the UI, not CPU.
 * Best-Buy / Apple feel: snappy enough to keep up, slow enough that
 * a single keystroke storm doesn't visibly thrash the dropdown.
 */
const SEARCH_DEBOUNCE_MS = 150;

/**
 * Cap how many ranked products we render in the dropdown grid. The grid
 * lays out as 5x2 / 4x2 / 3x2 / 2x2 / 1x4 across breakpoints — we
 * always render 10 cards into the DOM and let CSS hide the trailing
 * ones via `:nth-child(n+N)` so the React tree stays resize-stable.
 */
const MAX_GRID_RESULTS = 10;
const MAX_BESTSELLERS = 10;

function dispatchOpenAssistant() {
  if (typeof document === "undefined") return;
  document.dispatchEvent(new CustomEvent("agentic:open-assistant"));
}

/** Escape a string for safe use in a `RegExp` constructor. */
function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Wrap every substring of `text` that matches one of the query tokens
 * in a `<mark>` so the suggestion list visually echoes what the user
 * typed. Matching is case-insensitive and uses the same `tokenize`
 * pipeline as the search engine so synonym expansion / stop-word
 * stripping stay consistent. Tokens are sorted longest-first so a
 * "mini5" query highlights "mini5" rather than only the leading "mini".
 */
function highlightMatches(text: string, query: string): ReactNode {
  if (!text) return text;
  const tokens = tokenize(query)
    .map(escapeRegex)
    .filter(Boolean);
  if (tokens.length === 0) return text;
  tokens.sort((a, b) => b.length - a.length);
  const re = new RegExp(`(${tokens.join("|")})`, "gi");
  const parts = text.split(re);
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <mark key={i} className="search-overlay__highlight">
        {part}
      </mark>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

const PROMO_TITLE = "Shop with your personal Assistant";
const PROMO_SUB =
  "I can help you find the right gear, compare specs, and bundle accessories. Shop with me.";

/**
 * Pick the "Bestsellers" pool rendered into the search overlay grid.
 * Filters out accessories and bundles so we surface flagship single-SKU
 * products (drones, action cameras, gimbals, mics), then orders by
 * rating descending with reviewCount as a tiebreaker. Returns up to
 * `MAX_BESTSELLERS` cards — the responsive grid (5x2 / 4x2 / 3x2 /
 * 2x2 / 1x4) hides the trailing ones via CSS at narrower viewports.
 */
function pickBestsellers(
  products: ReturnType<typeof useCatalog>["products"],
  fallback: ReturnType<typeof useCatalog>["featuredProducts"],
) {
  const pool = products.filter((p) => !p.isAccessory && !p.isBundle);
  const sorted = [...pool].sort(
    (a, b) =>
      (b.rating ?? 0) - (a.rating ?? 0) ||
      (b.reviewCount ?? 0) - (a.reviewCount ?? 0),
  );
  if (sorted.length >= MAX_BESTSELLERS) return sorted.slice(0, MAX_BESTSELLERS);
  // Top up with featured if the catalog hasn't loaded enough rated SKUs.
  const seen = new Set(sorted.map((p) => p.slug));
  for (const fp of fallback) {
    if (sorted.length >= MAX_BESTSELLERS) break;
    if (seen.has(fp.slug)) continue;
    sorted.push(fp);
    seen.add(fp.slug);
  }
  return sorted.slice(0, MAX_BESTSELLERS);
}

export function SearchOverlay() {
  const { isOpen, closeSearchOverlay } = useSearchOverlay();
  const { products, featuredProducts, searchProducts, searchIndex } = useCatalog();
  const { navigate, navigateToProduct } = usePrototypeNavigation();
  const { mode } = useAgentMode();
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Gates AI touch points inside the search overlay — the "Shop with
  // your personal Assistant" promo strip and the "Search with
  // assistant" suggestion list. Both should only surface in the
  // assistant-enabled experiences. The Native Storefront
  // (basic-website) mode is meant to represent a baseline e-com flow
  // with no agent affordances.
  const showAssistantPromo = mode !== "basic-website";

  const bestsellers = useMemo(
    () => pickBestsellers(products, featuredProducts),
    [products, featuredProducts],
  );

  /* Live suggestions. The engine itself is sub-millisecond at 250
   * docs, but we debounce to `SEARCH_DEBOUNCE_MS` anyway so the result
   * grid + suggestion list don't visibly thrash while the user is
   * mid-word. `query` is what the input shows; `debouncedQuery` is
   * what actually drives the search. */
  useEffect(() => {
    const id = window.setTimeout(() => {
      setDebouncedQuery(query.trim());
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [query]);

  // Snap the debounced query to empty the moment the user clears the
  // input — clearing should feel instant rather than waiting out the
  // 300ms tail of the previous keystroke.
  useEffect(() => {
    if (query.length === 0) setDebouncedQuery("");
  }, [query]);

  const trimmedQuery = debouncedQuery;
  const isQuerying = trimmedQuery.length >= MIN_QUERY_LEN;
  const searchResult = useMemo(() => {
    if (!isQuerying) return null;
    return searchProducts(trimmedQuery);
  }, [isQuerying, trimmedQuery, searchProducts]);
  // Stable reference per query. The previous `.slice()` here returned
  // a new array on every render, which churned every downstream
  // `useMemo`/`useEffect` that depends on `gridProducts` — most
  // importantly the LLM upgrade effect, whose cleanup aborts the
  // in-flight OpenAI call on every render. Without this memo the
  // assistant suggestions never get to swap from rule-based to LLM.
  const gridProducts = useMemo(() => {
    return isQuerying
      ? (searchResult?.results ?? []).slice(0, MAX_GRID_RESULTS)
      : bestsellers;
  }, [isQuerying, searchResult, bestsellers]);
  const productSuggestions = searchResult?.suggestions.products ?? [];
  const categorySuggestions = searchResult?.suggestions.categories ?? [];

  // Rule-based "Search with assistant" phrases. Computed synchronously
  // on every render so the section appears the moment the dropdown
  // opens with results — no network, no debounce. The LLM upgrade
  // effect below replaces these once the user pauses (when an API
  // key is configured).
  const ruleBasedAssistantSuggestions = useMemo<AssistantSuggestion[]>(() => {
    if (!isQuerying) return [];
    if (gridProducts.length === 0) return [];
    return buildAssistantSuggestionsRuleBased(trimmedQuery, gridProducts);
  }, [isQuerying, trimmedQuery, gridProducts]);

  const [assistantSuggestions, setAssistantSuggestions] = useState<
    AssistantSuggestion[]
  >([]);

  // Sync state to the rule-based output every time the inputs change.
  // The LLM upgrade effect below overrides this with `source: "llm"`
  // entries when a network response lands.
  useEffect(() => {
    setAssistantSuggestions(ruleBasedAssistantSuggestions);
  }, [ruleBasedAssistantSuggestions]);

  // LLM upgrade. Fires after the debounced query stabilises and the
  // grid has matched products. Aborted on every keystroke via the
  // effect cleanup so a stale response can't overwrite fresh state.
  // Gated behind `isLlmAvailable()` so dev environments without an
  // API key silently keep the rule-based phrases.
  useEffect(() => {
    if (!isQuerying) return;
    if (gridProducts.length === 0) return;
    if (trimmedQuery.length < 3) return;
    if (!isLlmAvailable()) return;

    const controller = new AbortController();
    fetchAssistantSuggestionsLLM(trimmedQuery, gridProducts, controller.signal)
      .then((prompts) => {
        if (controller.signal.aborted) return;
        if (!prompts || prompts.length === 0) return;
        setAssistantSuggestions(
          prompts.map((label) => ({ label, source: "llm" as const })),
        );
      })
      .catch(() => {
        // Network / parse errors are already swallowed inside the
        // module; nothing to do here.
      });
    return () => controller.abort();
  }, [isQuerying, trimmedQuery, gridProducts]);

  // Did-you-mean: only computed when the live search returned nothing.
  // Pipes the corrected query back through the engine to confirm it
  // actually yields hits — we don't want to suggest a "fix" that's
  // also empty.
  const didYouMean = useMemo(() => {
    if (!isQuerying) return null;
    if ((searchResult?.results.length ?? 0) > 0) return null;
    const correction = suggestQueryCorrection(searchIndex, trimmedQuery);
    if (!correction || correction === trimmedQuery.toLowerCase()) return null;
    const verified = searchProducts(correction);
    if (verified.results.length === 0) return null;
    return correction;
  }, [isQuerying, searchResult, searchIndex, searchProducts, trimmedQuery]);

  /* Auto-focus the input every time the overlay opens. */
  useEffect(() => {
    if (!isOpen) return;
    const id = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(id);
  }, [isOpen]);

  /* Reset the query each time we re-open so a stale prompt doesn't
   * pre-fill the next session. The debounced shadow is wiped too so
   * the next open starts in the bestseller view, not the prior search. */
  useEffect(() => {
    if (!isOpen) {
      setQuery("");
      setDebouncedQuery("");
    }
  }, [isOpen]);

  /* Escape closes — installed on `document` so it works regardless of
   * which descendant has focus. */
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        closeSearchOverlay();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen, closeSearchOverlay]);

  /* Lock body scroll while open so the page underneath doesn't jitter
   * when the user scrolls inside the overlay. */
  useEffect(() => {
    if (!isOpen) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = original;
    };
  }, [isOpen]);

  /**
   * Submit the typed query. Basic e-com hygiene: navigate to the PLP
   * with `?q=<query>`. The PLP runs the same search engine and renders
   * the ranked results page. We deliberately bypass the assistant on
   * the keyword path — the assistant is still reachable via the
   * dedicated promo strip below.
   */
  const submitSearch = useCallback(
    (rawQuery: string) => {
      const trimmed = rawQuery.trim();
      if (!trimmed) return;
      navigate(ROUTES.productListing, { searchQuery: trimmed });
      closeSearchOverlay();
    },
    [navigate, closeSearchOverlay],
  );

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      submitSearch(query);
    },
    [query, submitSearch],
  );

  const handleRecent = useCallback(
    (item: RecentSearch) => {
      // Recent searches now seed a real keyword search rather than
      // dispatching to the assistant. Keeps the basic search hygienic
      // (Enter/click on a recent search consistently lands on a PLP).
      submitSearch(item.label);
    },
    [submitSearch],
  );

  const handleCategorySuggestion = useCallback(
    (category: string) => {
      navigate(ROUTES.productListing, { category });
      closeSearchOverlay();
    },
    [navigate, closeSearchOverlay],
  );

  const handleAssistantPromo = useCallback(() => {
    dispatchOpenAssistant();
    closeSearchOverlay();
  }, [closeSearchOverlay]);

  /**
   * Clicking a "Search with assistant" phrase fires the same
   * cross-cutting `agentic:ask-assistant` event the PDP NBAs and the
   * legacy recent-search assistant rows use. Side-by-side layout
   * picks it up, opens the panel, and seeds the prompt as a shopper
   * turn. Closes the overlay so the assistant gets focus.
   */
  const handleAssistantSuggestion = useCallback(
    (phrase: string) => {
      if (typeof document === "undefined") return;
      document.dispatchEvent(
        new CustomEvent("agentic:ask-assistant", {
          detail: { prompt: phrase },
        }),
      );
      closeSearchOverlay();
    },
    [closeSearchOverlay],
  );

  const handleProductSelect = useCallback(
    (slug: string) => {
      navigateToProduct(slug);
      closeSearchOverlay();
    },
    [navigateToProduct, closeSearchOverlay],
  );

  /**
   * Apply a "Did you mean" suggestion. Re-populates the input so the
   * user sees the corrected query (and can edit it further) and skips
   * the debounce on the way in by snapping `debouncedQuery` directly.
   */
  const handleDidYouMean = useCallback((correction: string) => {
    setQuery(correction);
    setDebouncedQuery(correction);
  }, []);

  if (!isOpen) return null;

  return (
    <div className="search-overlay" role="dialog" aria-label="Search" aria-modal="true">
      <button
        type="button"
        className="search-overlay__backdrop"
        aria-label="Close search"
        onClick={closeSearchOverlay}
        tabIndex={-1}
      />
      <div className="search-overlay__panel" role="document">
        {/*
         * Search-mode header: replaces the page's top-nav while the
         * overlay is open. Visual matches Figma node 33354:69743 —
         * dark bg, brand wordmark on the left, dark input field in
         * the centre, close X on the right. The header sits flush at
         * the top of the panel so when the overlay is open it
         * literally replaces the storefront / PLP / PDP top-nav.
         */}
        <form className="search-overlay__input-row" onSubmit={handleSubmit}>
          <PrototypeBrandLink className="search-overlay__brand">
            {SITE_BRAND}
          </PrototypeBrandLink>
          <label className="search-overlay__field" aria-label="Search input">
            <span className="search-overlay__input-icon" aria-hidden="true">
              <SearchIcon width={16} height={16} />
            </span>
            <input
              ref={inputRef}
              type="text"
              className="search-overlay__input"
              placeholder="Search or tell what your goal"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="Search products"
            />
            {query.length > 0 && (
              <button
                type="button"
                className="search-overlay__clear"
                onClick={() => {
                  setQuery("");
                  setDebouncedQuery("");
                  inputRef.current?.focus();
                }}
                aria-label="Clear search"
              >
                Clear
              </button>
            )}
          </label>
          <button
            type="button"
            className="search-overlay__close"
            aria-label="Close search"
            onClick={closeSearchOverlay}
          >
            <CloseIcon width={18} height={18} />
          </button>
        </form>

        <div className="search-overlay__body">
          <section
            className="search-overlay__col search-overlay__col--recent"
            aria-labelledby="search-overlay-recent-heading"
          >
            <h3
              id="search-overlay-recent-heading"
              className="search-overlay__heading"
            >
              {isQuerying
                ? categorySuggestions.length > 0
                  ? "Suggested Searches"
                  : "Suggestions"
                : "Recent Searches"}
            </h3>
            {isQuerying ? (
              <ul className="search-overlay__recent-list">
                {/* Empty state. When we have a fuzzy correction that
                 * actually yields hits, surface it as a clickable
                 * "Did you mean: …" prompt; otherwise fall back to a
                 * neutral no-matches line. */}
                {productSuggestions.length === 0 &&
                  categorySuggestions.length === 0 && (
                    <>
                      <li className="search-overlay__empty-suggestion">
                        No matches for "{trimmedQuery}".
                      </li>
                      {didYouMean && (
                        <li>
                          <button
                            type="button"
                            className="search-overlay__did-you-mean"
                            onClick={() => handleDidYouMean(didYouMean)}
                          >
                            <span className="search-overlay__did-you-mean-prefix">
                              Did you mean:
                            </span>{" "}
                            <span className="search-overlay__did-you-mean-term">
                              {didYouMean}
                            </span>
                            ?
                          </button>
                        </li>
                      )}
                    </>
                  )}
                {productSuggestions.map((sugg) => (
                  <li key={`p-${sugg.slug}`}>
                    <button
                      type="button"
                      className="search-overlay__recent-item"
                      onClick={() => handleProductSelect(sugg.slug)}
                    >
                      <SearchIcon
                        className="search-overlay__recent-icon"
                        width={16}
                        height={16}
                      />
                      <span className="search-overlay__recent-label">
                        {highlightMatches(sugg.title, trimmedQuery)}
                      </span>
                    </button>
                  </li>
                ))}
                {/* Distinct categories from the result set. */}
                {categorySuggestions.map((category) => (
                  <li key={`c-${category}`}>
                    <button
                      type="button"
                      className="search-overlay__recent-item"
                      onClick={() => handleCategorySuggestion(category)}
                    >
                      <SearchIcon
                        className="search-overlay__recent-icon"
                        width={16}
                        height={16}
                      />
                      <span className="search-overlay__recent-label">
                        in {highlightMatches(category, trimmedQuery)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <ul className="search-overlay__recent-list">
                {RECENT_SEARCHES.map((item) => (
                  <li key={item.label}>
                    <button
                      type="button"
                      className="search-overlay__recent-item"
                      onClick={() => handleRecent(item)}
                    >
                      <HistoryIcon
                        className="search-overlay__recent-icon"
                        width={16}
                        height={16}
                      />
                      <span className="search-overlay__recent-label">
                        {item.label}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {showAssistantPromo && isQuerying && assistantSuggestions.length > 0 && (
              <div className="search-overlay__assistant-section">
                <h3 className="search-overlay__heading search-overlay__heading--assistant">
                  Search with assistant
                </h3>
                <ul className="search-overlay__assistant-list">
                  {assistantSuggestions.map((sugg) => (
                    <li key={sugg.label}>
                      <button
                        type="button"
                        className="search-overlay__assistant-row"
                        onClick={() => handleAssistantSuggestion(sugg.label)}
                      >
                        <LucideSparkle
                          className="search-overlay__assistant-row-icon"
                          width={16}
                          height={16}
                          aria-hidden="true"
                        />
                        <span className="search-overlay__assistant-row-label">
                          {sugg.label}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          <section
            className="search-overlay__col search-overlay__col--bestsellers"
            aria-labelledby="search-overlay-bestsellers-heading"
          >
            <h3
              id="search-overlay-bestsellers-heading"
              className="search-overlay__heading"
            >
              {isQuerying
                ? gridProducts.length > 0
                  ? `Top results for "${trimmedQuery}"`
                  : "No matching products"
                : "Bestsellers"}
            </h3>
            <div className="search-overlay__grid">
              {gridProducts.map((product) => (
                <ProductCard
                  key={product.slug}
                  {...toProductCardProps(product)}
                  showStars={false}
                  onSelect={() => handleProductSelect(product.slug)}
                />
              ))}
            </div>
            {isQuerying && gridProducts.length === 0 && didYouMean && (
              <div className="search-overlay__no-results">
                <p className="search-overlay__no-results-line">
                  We couldn't find products matching{" "}
                  <strong>"{trimmedQuery}"</strong>.
                </p>
                <button
                  type="button"
                  className="search-overlay__did-you-mean search-overlay__did-you-mean--inline"
                  onClick={() => handleDidYouMean(didYouMean)}
                >
                  <span className="search-overlay__did-you-mean-prefix">
                    Did you mean:
                  </span>{" "}
                  <span className="search-overlay__did-you-mean-term">
                    {didYouMean}
                  </span>
                  ?
                </button>
              </div>
            )}
            {isQuerying && (searchResult?.results.length ?? 0) > 0 && (
              <div className="search-overlay__view-all">
                <button
                  type="button"
                  className="search-overlay__view-all-btn"
                  onClick={() => submitSearch(trimmedQuery)}
                >
                  View all {searchResult?.results.length} results
                  <LucideArrowRight size={16} strokeWidth={2} />
                </button>
              </div>
            )}
          </section>
        </div>

        {showAssistantPromo && (
          <button
            type="button"
            className="search-overlay__promo"
            onClick={handleAssistantPromo}
          >
            <span className="search-overlay__promo-icon" aria-hidden="true">
              <SparkleIcon width={20} height={20} />
            </span>
            <span className="search-overlay__promo-text">
              <span className="search-overlay__promo-title">{PROMO_TITLE}</span>
              <span className="search-overlay__promo-sub">{PROMO_SUB}</span>
            </span>
            <span className="search-overlay__promo-close" aria-hidden="true">
              <LucideArrowRight size={16} strokeWidth={2} />
            </span>
          </button>
        )}
      </div>
    </div>
  );
}

export default SearchOverlay;
