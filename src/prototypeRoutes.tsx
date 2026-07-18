import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { PRIMARY_ACTIVITY_VALUES, SERIES_VALUES } from "./catalog/catalog";

export const ROUTES = {
  home: "/",
  productListing: "/products",
  productDetail: "/products/:slug",
  cart: "/cart",
  checkout: "/checkout",
  orderConfirmation: "/order-confirmation",
  login: "/login",
  account: "/account",
  about: "/about-us",
  /** Immersive-only landing page for the Wingman assistant. Defensively
   * renders as the default storefront in non-immersive modes (handled
   * in `App.tsx`), so the route is safe to expose globally. */
  wingman: "/wingman",
  /**
   * Immersive-only "Wingman plan" results page. Receives the shopper's
   * raw query through `?q=<text>` and renders a dynamically curated
   * page (hero banner + 3 combos + category accordions) on top of the
   * tagged catalog. Defensively renders as the storefront in
   * non-immersive modes — same fallback treatment as `/wingman`.
   */
  wingmanPlan: "/wingman/plan",
} as const;

export type AppRoute = (typeof ROUTES)[keyof typeof ROUTES];
type StaticRoute = Exclude<AppRoute, typeof ROUTES.productDetail>;

const staticRoutes = new Set<StaticRoute>(
  Object.values(ROUTES).filter((route) => route !== ROUTES.productDetail) as StaticRoute[],
);
const basePath = (() => {
  const normalizedBase = (import.meta.env.BASE_URL || "/").replace(/\/+$/, "");
  return normalizedBase === "" ? "" : normalizedBase;
})();

const CATEGORY_PARAM = "category";
const CATEGORIES_PARAM = "cats";
const USE_CASES_PARAM = "useCases";
const ROLE_PARAM = "role";
const RECIPE_PARAM = "recipe";
const COMPATIBLE_WITH_PARAM = "compat";
const TIER_PARAM = "tier";
const PRICE_MAX_PARAM = "priceMax";
const PRICE_MIN_PARAM = "priceMin";
const SUBTYPES_PARAM = "subs";
const SERIES_PARAM = "series";
const PRIMARY_ACTIVITIES_PARAM = "activities";
const SLUGS_PARAM = "slugs";
const SEARCH_QUERY_PARAM = "q";

const ALLOWED_TIERS = new Set(["beginner", "intermediate", "pro"]);

export type NavigateOptions = {
  /** When navigating to the product listing route, scopes the listing to a category token. */
  category?: string | null;
  /**
   * Multi-select category list. Used by the PLP sidebar so shoppers can
   * combine `Action cameras + Drone accessories`. OR-semantics across
   * the list. Coexists with the singular `category` param — entry
   * points like the top-nav and chat handoffs continue to use the
   * singular form for clean deep-links.
   */
  categories?: string[];
  /**
   * AND-filter on `CatalogProduct.useCaseTags`. Lets the side-by-side
   * assistant scope a PLP to e.g. `360`-tagged action cameras when the
   * shopper picks the "360 cameras" row of a broad result card.
   */
  capabilities?: string[];
  /**
   * Filter on `CatalogProduct.accessoryRole`. Used by accessory-only
   * broad rows ("Mounting accessories", "Travel cases").
   */
  accessoryRole?: string;
  /**
   * Recipe spec id (e.g. `vlogging-action-cams`). When set, the PLP
   * looks the spec up and applies its full filter (incl. title
   * patterns the URL can't carry cleanly), falling back to category +
   * useCases + role when the spec is missing.
   */
  recipeKey?: string;
  /**
   * Lowercased model token (e.g. `mavic 4 pro`, `osmo pocket 3`).
   * When set, the PLP filters accessory results to SKUs whose
   * `compatibleWithModels` or `title` contain this token — so an
   * "ND filter for Mavic 4 Pro" carousel hands off to a PLP showing
   * the same Mavic 4 Pro filter set, not the full lens-filter
   * catalog.
   */
  compatibleWith?: string;
  /**
   * Buyer tier (`beginner` / `intermediate` / `pro`). Threaded so a
   * "Pro drones" carousel narrows the PLP to flagship drones rather
   * than including Mini/Neo/Flip beginner-tier SKUs.
   */
  tier?: "beginner" | "intermediate" | "pro";
  /** Price ceiling in USD. */
  priceMax?: number;
  /** Price floor in USD. */
  priceMin?: number;
  /**
   * v6 subtype narrowing — `["mount_helmet"]` for "helmet mount"
   * queries, `["acc_filter_nd"]` for "ND filter" queries. Threaded so
   * the PLP shows only those subtypes (e.g. helmet mounts only, not
   * all 12 mount variants).
   */
  subtypes?: string[];
  /**
   * v6.1 product-series narrowing (`["mavic", "avata"]`). OR-semantics
   * across the list. Powers the per-category PLP drill-down sidebar's
   * "Drone series" / "Camera series" / "Gimbal series" facets.
   */
  series?: string[];
  /**
   * v6 primary-activity narrowing (`["wedding", "professional_filmmaker"]`).
   * OR-semantics across the list, AND across other filters. Powers the
   * per-category PLP drill-down sidebar's "Use case" facet.
   */
  primaryActivities?: string[];
  /**
   * Explicit slug union. When set, the PLP narrows to ONLY these
   * slugs — bypassing every other filter. Used by the Broad result
   * card's "Show all" button to surface the union of every row's
   * recommended products as a single curated PLP, rather than the
   * full storefront catalog.
   */
  slugs?: string[];
  /**
   * Free-text search query — basic e-com hygiene. When set, the PLP
   * runs the catalog search engine and shows the ranked results as
   * the listing. Mutually independent from category/useCases/etc.
   * (search wins).
   */
  searchQuery?: string;
  /**
   * Free-text Wingman query carried as `?q=<text>` on the
   * `/wingman/plan` route. Independent from the PLP `searchQuery`
   * because the two routes resolve very different things — PLP runs
   * the search index, Wingman plan runs the recipe + accessory-bundle
   * pipeline against the same query.
   */
  wingmanQuery?: string;
};

type NavigationContextValue = {
  currentRoute: AppRoute;
  currentProductSlug: string | null;
  currentCategory: string | null;
  /** Active multi-select category list parsed from the URL `cats` param. */
  currentCategories: string[];
  /** Active `useCases` filter parsed from the URL (empty when absent). */
  currentUseCases: string[];
  /** Active accessory-role filter parsed from the URL (null when absent). */
  currentAccessoryRole: string | null;
  /** Active recipe spec id parsed from the URL (null when absent). */
  currentRecipeKey: string | null;
  /** Active model-compat token parsed from the URL (null when absent). */
  currentCompatibleWith: string | null;
  /** Active buyer tier filter parsed from the URL (null when absent). */
  currentTier: "beginner" | "intermediate" | "pro" | null;
  /** Active price ceiling parsed from the URL (null when absent). */
  currentPriceMax: number | null;
  /** Active price floor parsed from the URL (null when absent). */
  currentPriceMin: number | null;
  /** Active v6 subtype narrowing parsed from the URL. */
  currentSubtypes: string[];
  /** Active v6.1 product-series narrowing parsed from the URL. */
  currentSeries: string[];
  /** Active v6 primary-activity narrowing parsed from the URL. */
  currentPrimaryActivities: string[];
  /**
   * Active explicit slug list parsed from the URL (empty when
   * absent). When non-empty the PLP narrows to ONLY these slugs,
   * ignoring all other filters — used by the Broad card's
   * "Show all" handoff.
   */
  currentSlugs: string[];
  /**
   * Active free-text search query parsed from the URL (`?q=`).
   * Empty string when absent.
   */
  currentSearchQuery: string;
  /**
   * Active Wingman query parsed from `?q=` when on `/wingman/plan`.
   * Empty string on every other route or when the param is missing.
   */
  currentWingmanQuery: string;
  navigate: (route: StaticRoute, options?: NavigateOptions) => void;
  navigateToProduct: (slug: string) => void;
};

const NavigationContext = createContext<NavigationContextValue | null>(null);

function extractPathname(pathname: string) {
  const pathWithoutBase =
    basePath && pathname.startsWith(basePath) ? pathname.slice(basePath.length) || "/" : pathname;
  return pathWithoutBase.replace(/\/+$/, "") || "/";
}

function toBrowserPath(route: string): string {
  return `${basePath}${route === "/" ? "/" : route}`;
}

function normalizeCapabilities(capabilities: string[] | undefined): string[] {
  if (!capabilities || capabilities.length === 0) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of capabilities) {
    const tag = String(raw).trim().toLowerCase();
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
  }
  return out;
}

function parseCapabilitiesParam(value: string | null): string[] {
  if (!value) return [];
  return normalizeCapabilities(value.split(","));
}

function buildBrowserUrl(route: StaticRoute, options?: NavigateOptions) {
  const path = toBrowserPath(route);
  if (route === ROUTES.wingmanPlan) {
    // Wingman plan only carries `?q=<query>`. Reusing the same
    // URLSearchParams plumbing as the PLP keeps the encoding rules
    // (`+` for space, `%`-escaped specials) consistent across routes.
    const wingmanQuery = options?.wingmanQuery?.trim();
    if (!wingmanQuery) return path;
    const params = new URLSearchParams();
    params.set(SEARCH_QUERY_PARAM, wingmanQuery);
    return `${path}?${params.toString()}`;
  }
  if (route !== ROUTES.productListing) return path;
  const params = new URLSearchParams();
  if (options?.category) params.set(CATEGORY_PARAM, options.category);
  const categoryList = (options?.categories ?? [])
    .map((c) => c.trim())
    .filter(Boolean);
  if (categoryList.length > 0) {
    params.set(CATEGORIES_PARAM, Array.from(new Set(categoryList)).join("|"));
  }
  const capabilities = normalizeCapabilities(options?.capabilities);
  if (capabilities.length > 0) params.set(USE_CASES_PARAM, capabilities.join(","));
  const role = options?.accessoryRole?.trim();
  if (role) params.set(ROLE_PARAM, role);
  const recipe = options?.recipeKey?.trim();
  if (recipe) params.set(RECIPE_PARAM, recipe);
  const compat = options?.compatibleWith?.trim();
  if (compat) params.set(COMPATIBLE_WITH_PARAM, compat);
  const tier = options?.tier?.trim();
  if (tier && ALLOWED_TIERS.has(tier)) params.set(TIER_PARAM, tier);
  if (typeof options?.priceMax === "number" && Number.isFinite(options.priceMax)) {
    params.set(PRICE_MAX_PARAM, String(Math.max(0, options.priceMax)));
  }
  if (typeof options?.priceMin === "number" && Number.isFinite(options.priceMin)) {
    params.set(PRICE_MIN_PARAM, String(Math.max(0, options.priceMin)));
  }
  const subs = (options?.subtypes ?? [])
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (subs.length > 0) {
    params.set(SUBTYPES_PARAM, Array.from(new Set(subs)).join(","));
  }
  const seriesList = (options?.series ?? [])
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s && SERIES_VALUES.has(s));
  if (seriesList.length > 0) {
    params.set(SERIES_PARAM, Array.from(new Set(seriesList)).join(","));
  }
  const activitiesList = (options?.primaryActivities ?? [])
    .map((a) => a.trim().toLowerCase())
    .filter((a) => a && PRIMARY_ACTIVITY_VALUES.has(a));
  if (activitiesList.length > 0) {
    params.set(PRIMARY_ACTIVITIES_PARAM, Array.from(new Set(activitiesList)).join(","));
  }
  const slugList = (options?.slugs ?? [])
    .map((s) => s.trim())
    .filter(Boolean);
  if (slugList.length > 0) {
    // Keep the URL compact — the slug union for a 4-row recipe is
    // typically <40 slugs total, well under any sane URL-length cap.
    params.set(SLUGS_PARAM, Array.from(new Set(slugList)).join(","));
  }
  const searchQuery = options?.searchQuery?.trim();
  if (searchQuery) params.set(SEARCH_QUERY_PARAM, searchQuery);
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

type RouteState = {
  currentRoute: AppRoute;
  currentProductSlug: string | null;
  currentCategory: string | null;
  currentCategories: string[];
  currentUseCases: string[];
  currentAccessoryRole: string | null;
  currentRecipeKey: string | null;
  currentCompatibleWith: string | null;
  currentTier: "beginner" | "intermediate" | "pro" | null;
  currentPriceMax: number | null;
  currentPriceMin: number | null;
  currentSubtypes: string[];
  currentSeries: string[];
  currentPrimaryActivities: string[];
  currentSlugs: string[];
  currentSearchQuery: string;
  currentWingmanQuery: string;
};

const EMPTY_ROUTE_STATE: RouteState = {
  currentRoute: ROUTES.home,
  currentProductSlug: null,
  currentCategory: null,
  currentCategories: [],
  currentUseCases: [],
  currentAccessoryRole: null,
  currentRecipeKey: null,
  currentCompatibleWith: null,
  currentTier: null,
  currentPriceMax: null,
  currentPriceMin: null,
  currentSubtypes: [],
  currentSeries: [],
  currentPrimaryActivities: [],
  currentSlugs: [],
  currentSearchQuery: "",
  currentWingmanQuery: "",
};

function getRouteState(pathname: string, search: string): RouteState {
  const normalizedPath = extractPathname(pathname);

  if (normalizedPath.startsWith("/products/") && normalizedPath !== ROUTES.productListing) {
    return {
      ...EMPTY_ROUTE_STATE,
      currentRoute: ROUTES.productDetail,
      currentProductSlug: normalizedPath.slice("/products/".length),
    };
  }

  const route = staticRoutes.has(normalizedPath as StaticRoute)
    ? (normalizedPath as StaticRoute)
    : ROUTES.home;

  const params = new URLSearchParams(search);
  const isPlp = route === ROUTES.productListing;
  const category = isPlp ? (params.get(CATEGORY_PARAM)?.trim() || null) : null;
  const categoriesRaw = isPlp ? params.get(CATEGORIES_PARAM) : null;
  const categories = categoriesRaw
    ? Array.from(
        new Set(
          categoriesRaw
            .split("|")
            .map((c) => c.trim())
            .filter(Boolean),
        ),
      )
    : [];
  const useCases = isPlp ? parseCapabilitiesParam(params.get(USE_CASES_PARAM)) : [];
  const role = isPlp ? (params.get(ROLE_PARAM)?.trim() || null) : null;
  const recipe = isPlp ? (params.get(RECIPE_PARAM)?.trim() || null) : null;
  const compat = isPlp ? (params.get(COMPATIBLE_WITH_PARAM)?.trim() || null) : null;
  const tierRaw = isPlp ? (params.get(TIER_PARAM)?.trim().toLowerCase() || null) : null;
  const tier = tierRaw && ALLOWED_TIERS.has(tierRaw)
    ? (tierRaw as "beginner" | "intermediate" | "pro")
    : null;
  const parsePrice = (raw: string | null): number | null => {
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  const priceMax = isPlp ? parsePrice(params.get(PRICE_MAX_PARAM)) : null;
  const priceMin = isPlp ? parsePrice(params.get(PRICE_MIN_PARAM)) : null;
  const subtypesRaw = isPlp ? params.get(SUBTYPES_PARAM) : null;
  const subtypes = subtypesRaw
    ? Array.from(
        new Set(
          subtypesRaw
            .split(",")
            .map((s) => s.trim().toLowerCase())
            .filter(Boolean),
        ),
      )
    : [];
  const seriesRaw = isPlp ? params.get(SERIES_PARAM) : null;
  const series = seriesRaw
    ? Array.from(
        new Set(
          seriesRaw
            .split(",")
            .map((s) => s.trim().toLowerCase())
            .filter((s) => s && SERIES_VALUES.has(s)),
        ),
      )
    : [];
  const activitiesRaw = isPlp ? params.get(PRIMARY_ACTIVITIES_PARAM) : null;
  const primaryActivities = activitiesRaw
    ? Array.from(
        new Set(
          activitiesRaw
            .split(",")
            .map((a) => a.trim().toLowerCase())
            .filter((a) => a && PRIMARY_ACTIVITY_VALUES.has(a)),
        ),
      )
    : [];
  const slugsRaw = isPlp ? params.get(SLUGS_PARAM) : null;
  const slugs = slugsRaw
    ? Array.from(
        new Set(
          slugsRaw
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        ),
      )
    : [];
  const searchQuery = isPlp
    ? (params.get(SEARCH_QUERY_PARAM)?.trim() || "")
    : "";
  const isWingmanPlan = route === ROUTES.wingmanPlan;
  const wingmanQuery = isWingmanPlan
    ? (params.get(SEARCH_QUERY_PARAM)?.trim() || "")
    : "";

  return {
    currentRoute: route,
    currentProductSlug: null,
    currentCategory: category,
    currentCategories: categories,
    currentUseCases: useCases,
    currentAccessoryRole: role,
    currentRecipeKey: recipe,
    currentCompatibleWith: compat,
    currentTier: tier,
    currentPriceMax: priceMax,
    currentPriceMin: priceMin,
    currentSubtypes: subtypes,
    currentSeries: series,
    currentPrimaryActivities: primaryActivities,
    currentSlugs: slugs,
    currentSearchQuery: searchQuery,
    currentWingmanQuery: wingmanQuery,
  };
}

export function PrototypeNavigationProvider({ children }: { children: ReactNode }) {
  const [routeState, setRouteState] = useState<RouteState>(() => {
    if (typeof window === "undefined") return EMPTY_ROUTE_STATE;
    const initial = getRouteState(window.location.pathname, window.location.search);
    /* Hard refresh-default: every reload that lands on the
     * home/storefront route gets rerouted to /wingman. The Wingman
     * landing page is the canonical entry point for the immersive
     * demo; the storefront stays reachable via the DJI brand link
     * in the header. Implemented as `replaceState` (not `pushState`)
     * so the back button doesn't bounce the shopper to the empty
     * "/" they never visited. See
     * `.cursor/rules/refresh-defaults.mdc` for the broader rule. */
    if (initial.currentRoute === ROUTES.home) {
      const wingmanUrl = toBrowserPath(ROUTES.wingman);
      window.history.replaceState({}, "", wingmanUrl);
      return getRouteState(wingmanUrl, "");
    }
    return initial;
  });

  useEffect(() => {
    const handlePopState = () => {
      setRouteState(getRouteState(window.location.pathname, window.location.search));
      window.scrollTo(0, 0);
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const value = useMemo<NavigationContextValue>(
    () => ({
      currentRoute: routeState.currentRoute,
      currentProductSlug: routeState.currentProductSlug,
      currentCategory: routeState.currentCategory,
      currentCategories: routeState.currentCategories,
      currentUseCases: routeState.currentUseCases,
      currentAccessoryRole: routeState.currentAccessoryRole,
      currentRecipeKey: routeState.currentRecipeKey,
      currentCompatibleWith: routeState.currentCompatibleWith,
      currentTier: routeState.currentTier,
      currentPriceMax: routeState.currentPriceMax,
      currentPriceMin: routeState.currentPriceMin,
      currentSubtypes: routeState.currentSubtypes,
      currentSeries: routeState.currentSeries,
      currentPrimaryActivities: routeState.currentPrimaryActivities,
      currentSlugs: routeState.currentSlugs,
      currentSearchQuery: routeState.currentSearchQuery,
      currentWingmanQuery: routeState.currentWingmanQuery,
      navigate: (route, options) => {
        const nextBrowserUrl = buildBrowserUrl(route, options);
        const currentBrowserUrl = `${window.location.pathname}${window.location.search}`;
        if (currentBrowserUrl !== nextBrowserUrl) {
          window.history.pushState({}, "", nextBrowserUrl);
        }
        const isPlp = route === ROUTES.productListing;
        const tierRaw = isPlp ? options?.tier?.trim().toLowerCase() : undefined;
        const nextTier =
          tierRaw && ALLOWED_TIERS.has(tierRaw)
            ? (tierRaw as "beginner" | "intermediate" | "pro")
            : null;
        const cleanPrice = (n: number | undefined): number | null =>
          isPlp && typeof n === "number" && Number.isFinite(n) && n >= 0
            ? n
            : null;
        const cleanSubtypes = isPlp
          ? Array.from(
              new Set(
                (options?.subtypes ?? [])
                  .map((s) => s.trim().toLowerCase())
                  .filter(Boolean),
              ),
            )
          : [];
        const cleanSeries = isPlp
          ? Array.from(
              new Set(
                (options?.series ?? [])
                  .map((s) => s.trim().toLowerCase())
                  .filter((s) => s && SERIES_VALUES.has(s)),
              ),
            )
          : [];
        const cleanPrimaryActivities = isPlp
          ? Array.from(
              new Set(
                (options?.primaryActivities ?? [])
                  .map((a) => a.trim().toLowerCase())
                  .filter((a) => a && PRIMARY_ACTIVITY_VALUES.has(a)),
              ),
            )
          : [];
        const cleanCategories = isPlp
          ? Array.from(
              new Set(
                (options?.categories ?? [])
                  .map((c) => c.trim())
                  .filter(Boolean),
              ),
            )
          : [];
        const cleanSlugs = isPlp
          ? Array.from(
              new Set(
                (options?.slugs ?? []).map((s) => s.trim()).filter(Boolean),
              ),
            )
          : [];
        const cleanSearchQuery = isPlp
          ? options?.searchQuery?.trim() || ""
          : "";
        const isWingmanPlanRoute = route === ROUTES.wingmanPlan;
        const cleanWingmanQuery = isWingmanPlanRoute
          ? options?.wingmanQuery?.trim() || ""
          : "";
        setRouteState({
          currentRoute: route,
          currentProductSlug: null,
          currentCategory: isPlp ? options?.category?.trim() || null : null,
          currentCategories: cleanCategories,
          currentUseCases: isPlp ? normalizeCapabilities(options?.capabilities) : [],
          currentAccessoryRole: isPlp ? options?.accessoryRole?.trim() || null : null,
          currentRecipeKey: isPlp ? options?.recipeKey?.trim() || null : null,
          currentCompatibleWith: isPlp ? options?.compatibleWith?.trim() || null : null,
          currentTier: nextTier,
          currentPriceMax: cleanPrice(options?.priceMax),
          currentPriceMin: cleanPrice(options?.priceMin),
          currentSubtypes: cleanSubtypes,
          currentSeries: cleanSeries,
          currentPrimaryActivities: cleanPrimaryActivities,
          currentSlugs: cleanSlugs,
          currentSearchQuery: cleanSearchQuery,
          currentWingmanQuery: cleanWingmanQuery,
        });
        window.scrollTo(0, 0);
      },
      navigateToProduct: (slug) => {
        const nextRoute = `/products/${slug}`;
        const nextBrowserPath = toBrowserPath(nextRoute);
        if (window.location.pathname !== nextBrowserPath) {
          window.history.pushState({}, "", nextBrowserPath);
        }
        setRouteState({
          ...EMPTY_ROUTE_STATE,
          currentRoute: ROUTES.productDetail,
          currentProductSlug: slug,
        });
        window.scrollTo(0, 0);
      },
    }),
    [
      routeState.currentRoute,
      routeState.currentProductSlug,
      routeState.currentCategory,
      routeState.currentCategories,
      routeState.currentUseCases,
      routeState.currentAccessoryRole,
      routeState.currentRecipeKey,
      routeState.currentCompatibleWith,
      routeState.currentTier,
      routeState.currentPriceMax,
      routeState.currentPriceMin,
      routeState.currentSubtypes,
      routeState.currentSeries,
      routeState.currentPrimaryActivities,
      routeState.currentSlugs,
      routeState.currentSearchQuery,
      routeState.currentWingmanQuery,
    ],
  );

  return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>;
}

export function usePrototypeNavigation() {
  const context = useContext(NavigationContext);

  if (!context) {
    throw new Error("usePrototypeNavigation must be used within PrototypeNavigationProvider");
  }

  return context;
}
