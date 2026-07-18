import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useCatalog } from "../../catalog/CatalogContext";
import { formatPrice, toProductCardProps } from "../../catalog/catalog";
import ProductCard from "../../components/ProductCard/ProductCard";
import { UnifiedTopHeader } from "../../components/UnifiedTopHeader/UnifiedTopHeader";
import {
  buildRowProductsFromSpec,
  getRecipeSpecById,
} from "../../components/SideBySideAssistant/conversation/broadRecipes";
import { ArrowLeftIcon, ChevronRightIcon, DollarSignIcon, MinusIcon, PlusIcon } from "../../components/icons/StorefrontIcons";
import { useSearchOverlay } from "../../components/SearchOverlay/SearchOverlayContext";
import { ROUTES, usePrototypeNavigation } from "../../prototypeRoutes";
import { PRIMARY_NAV_ITEMS, SITE_BRAND, SITE_FOOTER_COPY } from "../../siteContent";
import {
  formatActivityLabel,
  formatSeriesLabel,
  getCategoryFacets,
  type FacetSpec,
} from "./categoryFacets";
import "./ProductListingPage.css";

type FilterGroupOption = {
  label: string;
  /** When provided, the option becomes a clickable single-select toggle. */
  onSelect?: () => void;
  isActive?: boolean;
};

type FilterGroup = {
  title: string;
  options: FilterGroupOption[];
  /**
   * `single-select` renders radios (e.g. price tier).
   * `multi-select` renders checkboxes (e.g. category — shoppers can
   * stack several at once).
   * `static` keeps the original cosmetic checkboxes (no behaviour
   * wired yet — used for placeholder filter groups).
   */
  kind?: "single-select" | "multi-select" | "static";
};

/**
 * Sidebar price buckets — kept as a fixed ladder so the filter UI stays
 * stable as the catalog evolves. Mirrors common e-com price tiers
 * (accessories under $100, entry / mid / prosumer / pro / enterprise).
 * Buckets with zero products in the active basis are dropped at render
 * time so we never show an empty filter row.
 */
const PRICE_BUCKETS: { min: number; max: number | null; label: string }[] = [
  { min: 0, max: 100, label: "Under $100" },
  { min: 100, max: 300, label: "$100 – $300" },
  { min: 300, max: 700, label: "$300 – $700" },
  { min: 700, max: 1500, label: "$700 – $1,500" },
  { min: 1500, max: 3000, label: "$1,500 – $3,000" },
  { min: 3000, max: null, label: "$3,000+" },
];

export function ProductListingPage() {
  const { products: allProducts, categories, searchProducts } = useCatalog();
  const {
    currentCategory,
    currentCategories,
    currentUseCases,
    currentAccessoryRole,
    currentRecipeKey,
    currentCompatibleWith,
    currentTier,
    currentPriceMax,
    currentPriceMin,
    currentSubtypes,
    currentSeries,
    currentPrimaryActivities,
    currentSlugs,
    currentSearchQuery,
    navigate,
    navigateToProduct,
  } = usePrototypeNavigation();
  const { openSearchOverlay } = useSearchOverlay();

  // Collapse/expand state for sidebar filter groups. Every group
  // defaults to expanded; the header button toggles a group's title
  // in/out of this set. The icon follows the standard accordion
  // convention: `+` when collapsed (click to expand), `-` when
  // expanded (click to collapse). The Figma source had this inverted
  // but the convention reads more naturally for shoppers.
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
    () => new Set(),
  );
  const toggleGroupCollapsed = (title: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(title)) next.delete(title);
      else next.add(title);
      return next;
    });
  };
  const hasInitializedMobileCollapseRef = useRef(false);

  // Free-form Min/Max inputs for the price filter. Drafts mirror the
  // active URL params (so a fresh page load with `?priceMin=200` shows
  // 200 in the field) and commit on blur or Enter — typing without
  // triggering a navigation per keystroke avoids hammering the URL
  // history with intermediate values.
  const [minDraft, setMinDraft] = useState<string>(
    typeof currentPriceMin === "number" ? String(currentPriceMin) : "",
  );
  const [maxDraft, setMaxDraft] = useState<string>(
    typeof currentPriceMax === "number" ? String(currentPriceMax) : "",
  );
  useEffect(() => {
    setMinDraft(typeof currentPriceMin === "number" ? String(currentPriceMin) : "");
  }, [currentPriceMin]);
  useEffect(() => {
    setMaxDraft(typeof currentPriceMax === "number" ? String(currentPriceMax) : "");
  }, [currentPriceMax]);

  const activeCategory = currentCategory?.trim() || null;
  // Combined list of every active category (singular `category` URL param +
  // multi-select `cats` URL param). Deduped case-insensitively while
  // preserving the original casing for display. Used by the product
  // filter (OR-semantics across the list) and the sidebar checkboxes.
  const activeCategories = (() => {
    const out: string[] = [];
    const seen = new Set<string>();
    const add = (raw: string | null | undefined) => {
      if (!raw) return;
      const trimmed = raw.trim();
      if (!trimmed) return;
      const key = trimmed.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      out.push(trimmed);
    };
    add(activeCategory);
    for (const cat of currentCategories) add(cat);
    return out;
  })();
  const activeUseCases = currentUseCases;
  const activeAccessoryRole = currentAccessoryRole;
  const activeCompatibleWith = currentCompatibleWith?.trim().toLowerCase() || null;
  const activeTier = currentTier;
  const activePriceMax = currentPriceMax;
  const activePriceMin = currentPriceMin;
  const activeSubtypes = currentSubtypes;
  const activeSeries = currentSeries;
  const activePrimaryActivities = currentPrimaryActivities;
  const activeSlugs = currentSlugs;
  const activeSearchQuery = currentSearchQuery.trim();
  // Run the keyword search when the URL carries `?q=`. The engine is
  // memoized on the catalog store, so this is just a hash-map walk.
  const searchResultPayload = activeSearchQuery
    ? searchProducts(activeSearchQuery)
    : null;
  const searchResultProducts = searchResultPayload?.results ?? null;
  // When the URL carries a `recipe=<id>` and we can resolve the spec,
  // mirror the broad result card's curated subset 1:1 (incl. the title
  // patterns the URL can't represent). When the spec is missing — e.g.
  // the recipe was renamed since the user bookmarked the URL — fall
  // back to the loose category + useCases + role filter so the page
  // still renders something reasonable.
  const recipeSpec = currentRecipeKey ? getRecipeSpecById(currentRecipeKey) : null;
  // Whether the price filter has any active narrowing — used to decide
  // whether to surface the "Clear" link inside the price group.
  const isPriceFilterActive =
    typeof activePriceMin === "number" || typeof activePriceMax === "number";
  // Drop bundles when ANY narrowing filter is active (tier, useCases,
  // accessoryRole, compat). Aligns the PLP with the chat-side card
  // (which already drops bundles by default). Direct category-only
  // navigation (e.g. clicking "4K drones" in the nav) keeps bundles
  // so the storefront UX stays unchanged when not handed off from
  // chat.
  const isFilteredHandoff =
    Boolean(activeTier) ||
    activeUseCases.length > 0 ||
    Boolean(activeAccessoryRole) ||
    Boolean(activeCompatibleWith) ||
    typeof activePriceMax === "number" ||
    typeof activePriceMin === "number" ||
    activeSubtypes.length > 0 ||
    activeSeries.length > 0 ||
    activePrimaryActivities.length > 0;
  // Detect whether the URL explicitly indicates an accessory query.
  // Mirrors the rule-based path's askedForAccessories check so the PLP
  // drops isAccessory items from flagship-category queries (e.g.
  // "Action cam under $300" shouldn't surface Osmo Nano ND Filters
  // and adapter mounts that sit in the "Action cameras" CSV bucket).
  const ACC_CATEGORY_RE =
    /accessor|mount|filter|batter|cable|case|microphone|charger|strap|tripod|monopod|adapter|propeller|landing\s*gear|remote|lens|grip|stick|backpack|bag/i;
  const ACC_SUBTYPE_PREFIXES = ["acc_", "mount_", "mic_"];
  const isAccessoryHandoff =
    Boolean(activeAccessoryRole) ||
    Boolean(activeCompatibleWith) ||
    activeCategories.some((c) => ACC_CATEGORY_RE.test(c)) ||
    activeSubtypes.some((s) =>
      ACC_SUBTYPE_PREFIXES.some((prefix) => s.startsWith(prefix)),
    );
  // Generic-accessories-for-model handoff: URL carries a compat token
  // but no category and no subtypes (e.g. "Accessories for Mavic 4 Pro"
  // → ?compat=mavic+4+pro). The shopper wants ACCESSORIES across every
  // category — we must drop the device itself (its title contains the
  // compat token, so the compat filter would otherwise let it through).
  const isGenericAccessoriesHandoff =
    Boolean(activeCompatibleWith) &&
    activeCategories.length === 0 &&
    !activeAccessoryRole &&
    activeSubtypes.length === 0;
  // Explicit slug union takes precedence over every other filter —
  // used by the Broad result card's "Show all" handoff so the PLP
  // surfaces the union of every row's products rather than the full
  // 252-row catalog. Order matches the URL so a stable scan order
  // mirrors the chat-side card ordering.
  const slugFilteredProducts = (() => {
    if (activeSlugs.length === 0) return null;
    const wanted = new Set(activeSlugs);
    const order = new Map(activeSlugs.map((slug, idx) => [slug, idx]));
    return allProducts
      .filter((product) => wanted.has(product.slug))
      .sort(
        (a, b) =>
          (order.get(a.slug) ?? Number.MAX_SAFE_INTEGER) -
          (order.get(b.slug) ?? Number.MAX_SAFE_INTEGER),
      );
  })();

  const baseProducts = searchResultProducts
    ? searchResultProducts
    : slugFilteredProducts
    ? slugFilteredProducts
    : recipeSpec
    ? buildRowProductsFromSpec(recipeSpec, allProducts)
    : allProducts.filter((product) => {
        if (isFilteredHandoff && product.isBundle) return false;
        if (isGenericAccessoriesHandoff && !product.isAccessory) {
          return false;
        }
        // Drop accessories from flagship-category handoffs. Direct
        // category browsing (no narrowing filter) keeps accessories
        // so the standalone PLP UX doesn't change.
        if (
          isFilteredHandoff &&
          !isAccessoryHandoff &&
          product.isAccessory
        ) {
          return false;
        }
        if (
          activeCategories.length > 0 &&
          !activeCategories.some((c) =>
            product.category.toLowerCase().includes(c.toLowerCase()),
          )
        ) {
          return false;
        }
        if (
          activeUseCases.length > 0 &&
          !activeUseCases.every((tag) => product.useCaseTags.includes(tag))
        ) {
          return false;
        }
        if (activeAccessoryRole && product.accessoryRole !== activeAccessoryRole) {
          return false;
        }
        if (activeTier && product.tier !== activeTier) {
          return false;
        }
        if (
          typeof activePriceMax === "number" &&
          (product.price == null || product.price > activePriceMax)
        ) {
          return false;
        }
        if (
          typeof activePriceMin === "number" &&
          (product.price == null || product.price < activePriceMin)
        ) {
          return false;
        }
        if (
          activeSubtypes.length > 0 &&
          !product.subtypes.some((s) => activeSubtypes.includes(s))
        ) {
          return false;
        }
        if (
          activeSeries.length > 0 &&
          (!product.series || !activeSeries.includes(product.series))
        ) {
          return false;
        }
        if (
          activePrimaryActivities.length > 0 &&
          !activePrimaryActivities.some((a) =>
            product.primaryActivities.includes(a),
          )
        ) {
          return false;
        }
        return true;
      });
  // Compatibility narrowing — when the URL carries `?compat=mavic 4 pro`,
  // restrict to SKUs whose `compatibleWithModels` or `title` contain
  // the model token. Mirrors the filterProducts logic in the rule-based
  // path so card and PLP show the same subset. Soft filter: if no SKU
  // matches we keep the broader pool so the page never renders empty.
  // Skipped when an explicit slug union is active — the broad-card
  // "Show all" handoff is already a curated subset; further compat
  // narrowing would only drop legitimate picks.
  const products = (() => {
    if (searchResultProducts) return baseProducts;
    if (slugFilteredProducts) return baseProducts;
    if (!activeCompatibleWith) return baseProducts;
    const target = activeCompatibleWith;
    const compat = baseProducts.filter((p) => {
      if (
        p.compatibleWithModels.some((model) =>
          model.toLowerCase().includes(target),
        )
      ) {
        return true;
      }
      return p.title.toLowerCase().includes(target);
    });
    return compat.length > 0 ? compat : baseProducts;
  })();

  const matchingNavItem = activeCategory
    ? PRIMARY_NAV_ITEMS.find(
        (item) => item.category && item.category.toLowerCase() === activeCategory.toLowerCase(),
      )
    : undefined;
  const headingLabel = (() => {
    const compatSuffix = activeCompatibleWith
      ? activeCompatibleWith
          .split(" ")
          .map((w) =>
            !w
              ? w
              : /^\d/.test(w) || w.length <= 2
                ? w.toUpperCase()
                : w.charAt(0).toUpperCase() + w.slice(1),
          )
          .join(" ")
      : null;
    const tierSuffix = activeTier
      ? activeTier.charAt(0).toUpperCase() + activeTier.slice(1)
      : null;
    const priceSuffix = (() => {
      if (typeof activePriceMax === "number" && typeof activePriceMin === "number") {
        return `${formatPrice(activePriceMin)}–${formatPrice(activePriceMax)}`;
      }
      if (typeof activePriceMax === "number") {
        return `Under ${formatPrice(activePriceMax)}`;
      }
      if (typeof activePriceMin === "number") {
        return `From ${formatPrice(activePriceMin)}`;
      }
      return null;
    })();
    if (searchResultProducts) {
      // Search-mode heading should show only the search term.
      return activeSearchQuery;
    }
    if (slugFilteredProducts) {
      // Explicit slug union from the broad card's "Show all" — keep
      // the heading neutral and let the count badge carry the meaning.
      return "Curated picks";
    }
    if (recipeSpec) {
      const extras = [
        ...(tierSuffix ? [tierSuffix] : []),
        ...(priceSuffix ? [priceSuffix] : []),
        ...(compatSuffix ? [compatSuffix] : []),
      ];
      return extras.length > 0
        ? `${recipeSpec.title} · ${extras.join(" · ")}`
        : recipeSpec.title;
    }
    // When the user has selected several categories from the sidebar
    // we can't summarise with a single nav-item label — fall back to
    // the catalog heading and let the active categories surface in the
    // suffix list below.
    const singleActiveCategory =
      activeCategories.length === 1 ? activeCategories[0] : null;
    const multiCategorySuffix =
      activeCategories.length > 1 ? activeCategories.join(" + ") : null;
    const baseHeading =
      (singleActiveCategory ? matchingNavItem?.label : null) ??
      singleActiveCategory ??
      (isGenericAccessoriesHandoff ? "Accessories" : "DJI Catalog");
    const filterSuffix = [
      ...(multiCategorySuffix ? [multiCategorySuffix] : []),
      ...(tierSuffix ? [tierSuffix] : []),
      ...activeUseCases,
      ...(activeAccessoryRole ? [activeAccessoryRole.replace(/_/g, " ")] : []),
      ...(priceSuffix ? [priceSuffix] : []),
      ...(compatSuffix ? [compatSuffix] : []),
      ...activeSeries.map((s) => formatSeriesLabel(s)),
      ...activePrimaryActivities.map((a) => formatActivityLabel(a)),
    ];
    return filterSuffix.length > 0
      ? `${baseHeading} · ${filterSuffix.join(" · ")}`
      : baseHeading;
  })();

  // Build a navigation payload that preserves every currently-active
  // facet — sidebar clicks should narrow the result set, not reset it.
  // Individual options pass overrides for the single facet they touch
  // (e.g. price clicks override priceMin/priceMax only).
  const buildNavOptions = (
    overrides: Parameters<typeof navigate>[1] = {},
  ): Parameters<typeof navigate>[1] => ({
    category: activeCategory ?? undefined,
    categories: currentCategories.length > 0 ? currentCategories : undefined,
    capabilities: activeUseCases.length > 0 ? activeUseCases : undefined,
    accessoryRole: activeAccessoryRole ?? undefined,
    recipeKey: currentRecipeKey ?? undefined,
    compatibleWith: activeCompatibleWith ?? undefined,
    tier: activeTier ?? undefined,
    priceMax: activePriceMax ?? undefined,
    priceMin: activePriceMin ?? undefined,
    subtypes: activeSubtypes.length > 0 ? activeSubtypes : undefined,
    series: activeSeries.length > 0 ? activeSeries : undefined,
    primaryActivities:
      activePrimaryActivities.length > 0 ? activePrimaryActivities : undefined,
    searchQuery: activeSearchQuery || undefined,
    ...overrides,
  });

  // Commit the Min/Max draft inputs into the URL. Empty strings clear
  // the corresponding bound; non-numeric input is ignored (the field
  // resets to the last committed value via the syncing useEffect).
  const commitPriceRange = () => {
    const parseDraft = (raw: string): number | undefined => {
      const trimmed = raw.trim();
      if (!trimmed) return undefined;
      const n = Number(trimmed);
      return Number.isFinite(n) && n >= 0 ? n : undefined;
    };
    const nextMin = parseDraft(minDraft);
    const nextMax = parseDraft(maxDraft);
    if (nextMin === activePriceMin && nextMax === activePriceMax) return;
    navigate(
      ROUTES.productListing,
      buildNavOptions({ priceMin: nextMin, priceMax: nextMax }),
    );
  };
  const handlePriceKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commitPriceRange();
    }
  };

  // Drop empty price buckets relative to the *unfiltered* catalog so the
  // ladder stays stable — using `products` here would collapse every
  // bucket except the active one once a price is selected.
  const priceBuckets = PRICE_BUCKETS.map((bucket) => {
    const count = allProducts.filter(
      (p) =>
        typeof p.price === "number" &&
        p.price >= bucket.min &&
        (bucket.max == null || p.price < bucket.max),
    ).length;
    return { ...bucket, count };
  }).filter((bucket) => bucket.count > 0);

  const isPriceBucketActive = (bucket: { min: number; max: number | null }) =>
    activePriceMin === bucket.min &&
    (bucket.max == null ? activePriceMax == null : activePriceMax === bucket.max);

  const priceOptions: FilterGroupOption[] = priceBuckets.map((bucket) => {
    const isActive = isPriceBucketActive(bucket);
    return {
      label: bucket.label,
      isActive,
      onSelect: () =>
        navigate(
          ROUTES.productListing,
          buildNavOptions(
            isActive
              ? { priceMin: undefined, priceMax: undefined }
              : { priceMin: bucket.min, priceMax: bucket.max ?? undefined },
          ),
        ),
    };
  });

  // Category sidebar is multi-select. Each click toggles the clicked
  // value in/out of the combined active list, then promotes the result
  // into the plural `categories` URL param. We deliberately drop the
  // singular `category` once the user touches the sidebar — keeping
  // both populated would let stale top-nav state shadow the user's
  // checkbox choices.
  const categoryOptions: FilterGroupOption[] = categories.slice(0, 6).map((cat) => {
    const lcCat = cat.toLowerCase();
    const isActive = activeCategories.some((c) => c.toLowerCase() === lcCat);
    return {
      label: cat,
      isActive,
      onSelect: () => {
        const next = isActive
          ? activeCategories.filter((c) => c.toLowerCase() !== lcCat)
          : [...activeCategories, cat];
        navigate(
          ROUTES.productListing,
          buildNavOptions({
            category: undefined,
            categories: next.length > 0 ? next : undefined,
          }),
        );
      },
    };
  });

  // Drill-down sidebar: when the shopper has narrowed to exactly one
  // category and we have a facet config for it, swap the cross-category
  // "Shop by Category" multi-select for category-specific facets
  // (series, subtype, tier, activity). Otherwise keep today's flat
  // top-level multi-select so cross-category browsing still works.
  const drillDownFacets: FacetSpec[] | null =
    activeCategories.length === 1 ? getCategoryFacets(activeCategories[0]) : null;
  const isDrilledIn = drillDownFacets != null;

  // Each drill-down facet builds its own FilterGroup. Active state and
  // click handlers are derived from the corresponding `active*` list;
  // clicks toggle the value in/out and route through `buildNavOptions`
  // so every other active facet is preserved.
  const buildFacetGroup = (facet: FacetSpec): FilterGroup => {
    const isMulti = facet.kind === "multi-select";
    const options: FilterGroupOption[] = facet.options.map((opt) => {
      const isActive = (() => {
        switch (facet.paramKey) {
          case "series":
            return activeSeries.includes(opt.value);
          case "subtypes":
            return activeSubtypes.includes(opt.value);
          case "primaryActivities":
            return activePrimaryActivities.includes(opt.value);
          case "tier":
            return activeTier === opt.value;
        }
      })();
      return {
        label: opt.label,
        isActive,
        onSelect: () => {
          // Build the next-state for this facet and pass as an override
          // to buildNavOptions so all other facets are preserved.
          const overrides: Parameters<typeof navigate>[1] = {};
          if (facet.paramKey === "series") {
            const next = isActive
              ? activeSeries.filter((s) => s !== opt.value)
              : isMulti
                ? [...activeSeries, opt.value]
                : [opt.value];
            overrides.series = next.length > 0 ? next : undefined;
          } else if (facet.paramKey === "subtypes") {
            const next = isActive
              ? activeSubtypes.filter((s) => s !== opt.value)
              : isMulti
                ? [...activeSubtypes, opt.value]
                : [opt.value];
            overrides.subtypes = next.length > 0 ? next : undefined;
          } else if (facet.paramKey === "primaryActivities") {
            const next = isActive
              ? activePrimaryActivities.filter((a) => a !== opt.value)
              : isMulti
                ? [...activePrimaryActivities, opt.value]
                : [opt.value];
            overrides.primaryActivities = next.length > 0 ? next : undefined;
          } else if (facet.paramKey === "tier") {
            // Tier is single-select — clicking the active row clears it,
            // clicking a different row replaces.
            overrides.tier = isActive
              ? undefined
              : (opt.value as "beginner" | "intermediate" | "pro");
          }
          navigate(ROUTES.productListing, buildNavOptions(overrides));
        },
      };
    });
    return {
      title: facet.title,
      kind: facet.kind,
      options,
    };
  };

  const filters: FilterGroup[] = isDrilledIn
    ? [
        {
          title: "Shop by Availability",
          kind: "static",
          options: ["In stock", "Creator bundles", "Top rated"].map((label) => ({ label })),
        },
        {
          title: "Shop by Price",
          kind: "single-select",
          options: priceOptions,
        },
        ...drillDownFacets!.map(buildFacetGroup),
      ]
    : [
        {
          title: "Shop by Availability",
          kind: "static",
          options: ["In stock", "Creator bundles", "Top rated"].map((label) => ({ label })),
        },
        {
          title: "Shop by Price",
          kind: "single-select",
          options: priceOptions,
        },
        {
          title: "Shop by Category",
          kind: "multi-select",
          options: categoryOptions,
        },
      ];

  useEffect(() => {
    if (hasInitializedMobileCollapseRef.current) return;
    const isViewportMobile = window.matchMedia("(max-width: 767px)").matches;
    const isDemoMobile =
      document.documentElement.getAttribute("data-demo-viewport") === "mobile";
    if (!isViewportMobile && !isDemoMobile) return;
    setCollapsedGroups(new Set(filters.map((group) => group.title)));
    hasInitializedMobileCollapseRef.current = true;
  }, [filters]);

  return (
    <div className="figma-plp">
      <UnifiedTopHeader navigate={navigate} openSearchOverlay={openSearchOverlay} />

      <div className="figma-plp__page-inner">
        <header className="figma-plp__header">
          <nav className="figma-plp__breadcrumbs" aria-label="Breadcrumb">
            <span>Home</span>
            <span className="figma-plp__sep"><ChevronRightIcon width={14} height={14} /></span>
            {activeCategories.length > 0 || isGenericAccessoriesHandoff || searchResultProducts ? (
              <>
                <a
                  href={ROUTES.productListing}
                  className="figma-plp__breadcrumb-link"
                  onClick={(event) => {
                    event.preventDefault();
                    navigate(ROUTES.productListing);
                  }}
                >
                  Products
                </a>
                <span className="figma-plp__sep"><ChevronRightIcon width={14} height={14} /></span>
                <span>{headingLabel}</span>
              </>
            ) : (
              <>
                <span>Products</span>
                <span className="figma-plp__sep"><ChevronRightIcon width={14} height={14} /></span>
                <span>DJI Catalog</span>
              </>
            )}
          </nav>
          <h1 className="figma-plp__title">{headingLabel} ({products.length})</h1>
        </header>

        <main className="figma-plp__main">
          <aside className="figma-plp__filters" aria-label="Product filters">
            {isDrilledIn && (
              <button
                type="button"
                className="figma-plp__filter-escape"
                onClick={() => navigate(ROUTES.productListing)}
                aria-label="Browse all categories"
              >
                <ArrowLeftIcon width={14} height={14} aria-hidden="true" />
                <span>Browse all categories</span>
              </button>
            )}
            {filters.map((group) => {
              const isSingleSelect = group.kind === "single-select";
              const isMultiSelect = group.kind === "multi-select";
              const isCollapsed = collapsedGroups.has(group.title);
              const isPriceGroup = group.title === "Shop by Price";
              return (
                <section
                  className={
                    isCollapsed
                      ? "figma-plp__filter-group figma-plp__filter-group--collapsed"
                      : "figma-plp__filter-group"
                  }
                  key={group.title}
                >
                  <h2>
                    <span>{group.title}</span>
                    <button
                      type="button"
                      className="figma-plp__filter-toggle"
                      onClick={() => toggleGroupCollapsed(group.title)}
                      aria-expanded={!isCollapsed}
                      aria-label={
                        isCollapsed
                          ? `Expand ${group.title}`
                          : `Collapse ${group.title}`
                      }
                    >
                      {isCollapsed ? (
                        <PlusIcon width={14} height={14} aria-hidden="true" />
                      ) : (
                        <MinusIcon width={14} height={14} aria-hidden="true" />
                      )}
                    </button>
                  </h2>
                  {!isCollapsed && isPriceGroup && (
                    <div className="figma-plp__price-range">
                      <label className="figma-plp__price-field">
                        <span className="figma-plp__price-field-icon" aria-hidden="true">
                          <DollarSignIcon width={14} height={14} />
                        </span>
                        <input
                          type="number"
                          inputMode="numeric"
                          min={0}
                          placeholder="Min"
                          value={minDraft}
                          onChange={(event) => setMinDraft(event.target.value)}
                          onBlur={commitPriceRange}
                          onKeyDown={handlePriceKeyDown}
                          aria-label="Minimum price"
                        />
                      </label>
                      <span className="figma-plp__price-range-sep" aria-hidden="true">
                        to
                      </span>
                      <label className="figma-plp__price-field">
                        <span className="figma-plp__price-field-icon" aria-hidden="true">
                          <DollarSignIcon width={14} height={14} />
                        </span>
                        <input
                          type="number"
                          inputMode="numeric"
                          min={0}
                          placeholder="Max"
                          value={maxDraft}
                          onChange={(event) => setMaxDraft(event.target.value)}
                          onBlur={commitPriceRange}
                          onKeyDown={handlePriceKeyDown}
                          aria-label="Maximum price"
                        />
                      </label>
                    </div>
                  )}
                  {!isCollapsed && (
                    <ul>
                      {group.options.map((option) => {
                        if (isSingleSelect && option.onSelect) {
                          return (
                            <li key={option.label}>
                              <label>
                                <input
                                  type="radio"
                                  name={`figma-plp-${group.title}`}
                                  checked={Boolean(option.isActive)}
                                  onChange={option.onSelect}
                                />
                                <span>{option.label}</span>
                              </label>
                            </li>
                          );
                        }
                        if (isMultiSelect && option.onSelect) {
                          return (
                            <li key={option.label}>
                              <label>
                                <input
                                  type="checkbox"
                                  checked={Boolean(option.isActive)}
                                  onChange={option.onSelect}
                                />
                                <span>{option.label}</span>
                              </label>
                            </li>
                          );
                        }
                        return (
                          <li key={option.label}>
                            <label>
                              <input type="checkbox" />
                              <span>{option.label}</span>
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {!isCollapsed && isPriceGroup && isPriceFilterActive && (
                    <button
                      type="button"
                      className="figma-plp__filter-clear"
                      onClick={() =>
                        navigate(
                          ROUTES.productListing,
                          buildNavOptions({
                            priceMin: undefined,
                            priceMax: undefined,
                          }),
                        )
                      }
                    >
                      Clear
                    </button>
                  )}
                </section>
              );
            })}
          </aside>

          <section className="figma-plp__grid" aria-label="Product results">
            {products.length > 0 ? (
              products.map((product) => (
                <article key={product.slug} className="figma-plp__card-wrap">
                  <ProductCard
                    {...toProductCardProps(product)}
                    onSelect={() => navigateToProduct(product.slug)}
                  />
                </article>
              ))
            ) : (
              <div className="figma-plp__empty">
                <p>No {headingLabel.toLowerCase()} match this filter.</p>
                <button
                  type="button"
                  className="figma-plp__empty-reset"
                  onClick={() => navigate(ROUTES.productListing)}
                >
                  View all products
                </button>
              </div>
            )}
          </section>
        </main>

        <footer className="figma-plp__footer">
          <div className="figma-plp__footer-left">
            <strong>{SITE_BRAND}</strong>
            <div className="figma-plp__footer-links">
              <a href="#">DJI Care Refresh</a>
              <a href="#">Privacy Policy</a>
              <a href="#">Support</a>
            </div>
            <p className="figma-plp__footer-copy">{SITE_FOOTER_COPY}</p>
          </div>
          <div className="figma-plp__footer-right">
            <a href="#">Privacy Policy</a>
            <a href="#">Terms of Use</a>
          </div>
        </footer>
      </div>
    </div>
  );
}

export default ProductListingPage;
