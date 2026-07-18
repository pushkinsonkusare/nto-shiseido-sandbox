import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { CSSProperties } from "react";
import { flushSync } from "react-dom";
import {
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  Plus,
  ShieldCheck,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import type { CatalogProduct } from "../../catalog/catalog";
import { useCatalog } from "../../catalog/CatalogContext";
import { ImmersiveHeader } from "../../components/ImmersiveHeader/ImmersiveHeader";
import {
  RefreshCcwIcon,
  SparkleIcon,
} from "../../components/icons/StorefrontIcons";
import { ROUTES, usePrototypeNavigation } from "../../prototypeRoutes";
import wingmanHeroImg from "../../assets/wingman-hero.webp";
import {
  activityBannerUrl,
  buildPlan,
  FALLBACK_HERO_FILE,
  formatPriceUsd,
  type CategoryAccordion,
  type Combo,
  type ComboTier,
  type PlanResult,
} from "./buildPlan";
import {
  buildPlanWithLlm,
  isWingmanPlanLlmAvailable,
} from "./buildPlanLLM";
import { useHeadline } from "./useHeadline";
import { useKitRationales } from "./useKitRationales";
import type { KitRationale } from "./kitRationale";
import { KitDetailsPanel } from "./KitDetailsPanel";
import { KitComparePanel } from "./KitComparePanel";
import { ProductReviewsPanel, type ReviewsTabId } from "./ProductReviewsPanel";
import { WingmanChatBar } from "./WingmanChatBar";
import { buildCustomCombo } from "./buildCustomCombo";
import {
  answerProductQuestion,
  buildProductFaqs,
  detectComparisonRequest,
  isProductQuestion,
  resolveSelectionNbas,
} from "./wingmanNba";
import {
  getAgentDockProductSlugSnapshot,
  subscribeAgentDock,
} from "./wingmanAgentDockStore";
import type { KitAccessory } from "./parseKitCommands";
import { buildAccessoryBundle } from "../../components/SidecarAssistant/conversation/flow";
import {
  appendMessage,
  clearPendingBundleSuggestion,
  clearThread,
  getSteeringPromptSnapshot,
  setSteeringPrompt,
  setPendingBundleSuggestion,
  subscribe,
} from "./wingmanChatStore";
import {
  getSnapshot as getSelectionSnapshot,
  subscribe as subscribeSelection,
  toggleSelection,
  removeSelection,
  MAX_SELECTION,
} from "./wingmanSelectionStore";
import "./WingmanPlanPage.css";

/**
 * Wingman Plan results page (immersive-mode only). Shoppers land here
 * after submitting a query on the Wingman landing page; the URL carries
 * `?q=<query>` (see `prototypeRoutes.tsx`).
 *
 * Layout follows Figma node 88:30837 — a hero band whose lifestyle
 * banner bleeds full-width and is overlapped by two stacked rounded
 * cards:
 *
 *   1. <WingmanPlanHero>      — full-bleed activity banner with the
 *                               headline + subhead floating on the
 *                               left half, white gradient masks
 *                               carrying the type column over the
 *                               imagery without losing legibility.
 *   2. <WingmanPlanCombos>    — "Choose your starting kit" card. A
 *                               4-tab pill toggles between tiers and
 *                               renders an asymmetric 4-column kit
 *                               grid alongside a right-hand sidebar
 *                               that summarises the active combo
 *                               (title, price, description, three
 *                               capability chips, View Details + Buy
 *                               now buttons).
 *   3. <WingmanPlanCategories>— "Create your own kit" card. The first
 *                               recipe row renders inline as a
 *                               horizontal tile rail; the rest sit
 *                               below as collapsed disclosure rows
 *                               separated by 1px hairlines. Native
 *                               <details>/<summary> drives expansion
 *                               so keyboard + AT semantics are free.
 *
 * The plan data itself comes from `buildPlan()` — a pure function over
 * the catalog. The page is therefore deterministic for any (query,
 * catalog) pair: refreshing the URL produces the same combos and
 * categories.
 *
 * Empty state: when the query is missing or yields no usable cores
 * (e.g. catalog hasn't loaded), the combos + categories blocks are
 * suppressed and a "tell us more" panel surfaces curated quick-start
 * prompts.
 */

/* Tab label, kit title, and description for the chat-derived
 * "Custom" combo. Authoring these here (alongside the three
 * wingman-curated tiers' copy) keeps every tier's surface text in
 * one place; `buildCustomCombo()` only owns the actual product
 * picks + the badge tagline. */
const CUSTOM_TIER_TAB_LABEL = "Custom";
const CUSTOM_TIER_KIT_TITLE = "Your Custom Kit";
const CUSTOM_TIER_KIT_DESCRIPTION =
  "Built on the fly from your latest Wingman chat. Tweak the prompt to swap the headline drone — the rest of the kit follows.";

/* The three capability chips that flank the right sidebar of the
 * active combo. Per Figma these read as soft, icon-led positioning
 * statements about the kit ("Beginner friendly", "Smart value",
 * "Room to grow") rather than per-product features. */
const KIT_CAPABILITY_CHIPS = [
  {
    Icon: ShieldCheck,
    label: "Beginner friendly",
  },
  {
    Icon: Zap,
    label: "Smart value",
  },
  {
    Icon: Plus,
    label: "Room to grow",
  },
] as const;

/* Tab labels for the tier pill. The first tier here is the one
 * surfaced as "active" by default. Order matches Figma: ideal first
 * (the recommended kit), then the budget + premium alternatives,
 * then a "Custom" placeholder that's wired up to scroll the shopper
 * down to the recipe-row builder below. */
const TIER_TAB_ORDER: ComboTier[] = ["ideal", "budget", "top"];

const TIER_TAB_LABEL: Record<ComboTier, string> = {
  ideal: "Ideal kit",
  budget: "Pocket friendly",
  top: "Pro kit",
  custom: CUSTOM_TIER_TAB_LABEL,
};

/* Adjective stamped between the tier label and "Kit" in the sidebar
 * title (e.g. "Ideal Beginner Kit"). Lets the kit name read as
 * tier + audience rather than a generic "Ideal Kit" — keeps the copy
 * close to the Figma without inventing per-combo strings. */
const TIER_KIT_TITLE: Record<ComboTier, string> = {
  ideal: "Ideal Beginner Kit",
  budget: "Pocket Friendly Kit",
  top: "Top of the Line Kit",
  custom: CUSTOM_TIER_KIT_TITLE,
};

/* Per-tier sidebar description — the longer paragraph under the
 * price. Not in the catalog (rows don't carry kit-level copy), so
 * lifted into the page layer. */
const TIER_KIT_DESCRIPTION: Record<ComboTier, string> = {
  ideal:
    "This kit allows you to take full advantage of DJI ecosystem and make the most of it. Kit contains enough gear to get you started on your drone journey with no compromise.",
  budget:
    "Compact essentials that keep the kit pocket-friendly without skimping on the everyday hero shots — perfect for first-time creators.",
  top: "Pro-grade hardware and accessories that unlock the full creative range, no compromises on capture or workflow.",
  custom: CUSTOM_TIER_KIT_DESCRIPTION,
};

const AUDIO_INTENT_QUERY_PATTERN =
  /\b(podcast\w*|interview\w*|livestream\w*|live\s*stream\w*|radio\s*show|microphone\w*|\bmic\b)\b/i;
const AUDIO_INTENT_ACTIVITIES = new Set(["podcast", "interview", "livestream"]);
const WATER_INTENT_QUERY_PATTERN =
  /\b(scuba|div\w*|snorkel\w*|underwater|waterproof|surf\w*|wet|rain)\b/i;
const LOADING_WAVE_DOTS = [
  { x: 0, y: 13, size: 8, delay: "0ms" },
  { x: 22, y: 13, size: 8, delay: "160ms" },
  { x: 44, y: 13, size: 8, delay: "320ms" },
  { x: 66, y: 13, size: 8, delay: "480ms" },
] as const;

function getTierKitTitle(tier: ComboTier, audioFirst: boolean): string {
  if (!audioFirst) return TIER_KIT_TITLE[tier];
  switch (tier) {
    case "ideal":
      return "Ideal Podcast Kit";
    case "budget":
      return "Pocket-Friendly Podcast Kit";
    case "top":
      return "Pro Podcast Kit";
    case "custom":
      return CUSTOM_TIER_KIT_TITLE;
    default:
      return TIER_KIT_TITLE[tier];
  }
}

function getTierKitDescription(tier: ComboTier, audioFirst: boolean): string {
  if (!audioFirst) return TIER_KIT_DESCRIPTION[tier];
  switch (tier) {
    case "ideal":
      return "Balanced audio-first setup with wireless mics, receiver accessories, and practical mounts for clean voice capture.";
    case "budget":
      return "Pocket-friendly podcast essentials focused on clear dialogue, quick setup, and reliable day-to-day recording.";
    case "top":
      return "Pro-grade audio workflow with multi-transmitter flexibility, monitoring-ready accessories, and redundancy for long sessions.";
    case "custom":
      return CUSTOM_TIER_KIT_DESCRIPTION;
    default:
      return TIER_KIT_DESCRIPTION[tier];
  }
}

function buildLoadingSteps(rawQuery: string, detectedActivities: string[]): string[] {
  const query = rawQuery.trim();
  const isWaterIntent =
    WATER_INTENT_QUERY_PATTERN.test(query) ||
    detectedActivities.some((activity) =>
      ["watersports", "surfing", "scuba_diving_snorkeling", "freediving"].includes(
        activity,
      ),
    );
  if (isWaterIntent) {
    return [
      "Finding truly waterproof picks",
      "Prioritizing water-ready gear",
      "Matching gear for wet conditions",
      "Building dive-ready combos",
    ];
  }

  if (detectedActivities.includes("cycling")) {
    return [
      "Finding trail-ready essentials",
      "Prioritizing grip and durability",
      "Matching gear for rough terrain",
      "Building all-day riding combos",
    ];
  }

  if (detectedActivities.includes("hiking_outdoor")) {
    return [
      "Finding trail-ready essentials",
      "Prioritizing weatherproof gear",
      "Matching gear for long routes",
      "Building all-day hiking combos",
    ];
  }

  if (detectedActivities.includes("travel")) {
    return [
      "Finding versatile travel picks",
      "Prioritizing pack-friendly gear",
      "Matching items for long days",
      "Building mix-and-match combos",
    ];
  }

  return [
    "Understanding your goal",
    "Prioritizing best-fit essentials",
    "Matching products that fit",
    "Building your starter combo",
  ];
}

/* Quick-start prompts for the empty state. Mirror the chips on the
 * Wingman landing page so the two surfaces feel coherent — clicking
 * any of them re-enters the plan flow with a known-good seed query. */
const EMPTY_STATE_SUGGESTIONS = [
  "I want to start drone photography",
  "Build me a travel vlogging kit",
  "Home podcast setup",
  "Gear for moto vlogging",
];

/* localStorage key for the "Don't ask again" preference on the kit
 * accessory remove confirmation. Persists across reloads so a shopper
 * who opted out of the prompt doesn't have to re-opt-out every visit. */
const REMOVE_CONFIRM_SKIP_KEY = "wingman-plan-skip-remove-confirm";

/* Duration of the tile fade-out (phase 1 of the remove animation). The
 * page-level handler waits this long before committing the state
 * mutation so the doomed tile is fully invisible before the View
 * Transitions reflow kicks in for the remaining tiles. Kept in sync
 * with the `wingman-plan-page__tile-out` keyframe in
 * WingmanPlanPage.css. */
const TILE_REMOVE_FADE_MS = 220;

/* How long a tile shows its skeleton loader while a "Suggest a better
 * version" swap is in flight, before the substituted product is
 * committed inside a View Transition. Long enough to read as a genuine
 * "fetching a better option" beat. Kept in sync with the
 * `wingman-plan-page__tile--swapping` shimmer in WingmanPlanPage.css. */
const TILE_SWAP_SKELETON_MS = 700;

/* Reset-kit restore animation tuning. The "Reset kit" button restores
 * shopper-removed accessories one-by-one with a staggered cascade:
 *
 *   STAGGER — gap between each tile's restore tick. Long enough that
 *     consecutive View Transitions don't overlap (the previous tile
 *     finishes morphing into the new layout before the next one is
 *     re-introduced) and the cascade reads as deliberate.
 *
 *   FADE — duration of each restored tile's fade-in animation. Kept in
 *     sync with the `wingman-plan-page__tile-in` keyframe in
 *     WingmanPlanPage.css; used to clear the `--restoring` modifier
 *     once the entrance has played out so subsequent removes don't
 *     accidentally re-trigger the entrance keyframe. */
const TILE_RESTORE_STAGGER_MS = 360;
const TILE_RESTORE_FADE_MS = 720;

/* Delay between appending the shopper's NBA question and the templated
 * Wingman answer, so the exchange reads as a real back-and-forth rather
 * than both bubbles popping in on the same frame. Mirrors the chat
 * bar's own REPLY_DELAY_MS cadence. */
const NBA_REPLY_DELAY_MS = 400;

/* ============================================================
 * Hero
 * ============================================================ */

type WingmanPlanHeroProps = {
  plan: PlanResult;
};

function WingmanPlanHero({ plan }: WingmanPlanHeroProps) {
  const { navigate } = usePrototypeNavigation();
  const forceHikingBanner = /\b(hik\w*|trek\w*|trail|outdoor(?:s)?|backpack\w*)\b/i
    .test(plan.rawQuery);
  const selectedHeroFile = forceHikingBanner
    ? "Hiking banner.jpeg"
    : plan.heroImageFile;
  /* Use the bundled wingman-hero only when the planner explicitly
   * declared "no banner". Every other activity ships from `public/`
   * via `activityBannerUrl()`. */
  const heroSrc =
    selectedHeroFile && selectedHeroFile !== FALLBACK_HERO_FILE
      ? activityBannerUrl(selectedHeroFile)
      : activityBannerUrl(FALLBACK_HERO_FILE);

  /* Heuristic from `shortenQuery()` renders synchronously; the LLM
   * upgrade fades in once the network round-trip resolves. The `key`
   * on the <h1> changes when the headline text changes, which retriggers
   * the CSS fade-in animation defined in WingmanPlanPage.css. */
  const headline = useHeadline(plan.rawQuery, plan.headline);

  return (
    <section className="wingman-plan-page__hero" aria-label="Plan summary">
      <div className="wingman-plan-page__hero-art" aria-hidden="true">
        <img
          src={heroSrc}
          alt=""
          loading="eager"
          onError={(event) => {
            /* If the activity banner 404s in dev (rare — mostly when
             * a new activity ships before its asset lands), swap in
             * the bundled wingman-hero so the hero never shows a
             * broken image. The handler self-detaches by clearing
             * onerror so it can't loop on a second failure. */
            const img = event.currentTarget;
            img.onerror = null;
            img.src = wingmanHeroImg;
          }}
        />
      </div>
      {/* Soft "back to Wingman" pill rendered above the hero copy
       * (Figma 94:31383). Routes the shopper back to the Wingman
       * landing page so they can refine their query. */}
      <button
        type="button"
        className="wingman-plan-page__hero-back"
        onClick={() => navigate(ROUTES.wingman)}
      >
        <ChevronLeft
          width={16}
          height={16}
          className="wingman-plan-page__hero-back-icon"
          aria-hidden="true"
        />
        Wingman
      </button>
      <div className="wingman-plan-page__hero-copy">
        <h1 key={headline} className="wingman-plan-page__hero-headline">
          {headline}
        </h1>
        <p className="wingman-plan-page__hero-subhead">{plan.subhead}</p>
      </div>
    </section>
  );
}

/* ============================================================
 * Combos
 * ============================================================ */

type WingmanPlanCombosProps = {
  combos: Combo[];
  active: ComboTier;
  onChange: (id: ComboTier) => void;
  /* First detected primary activity for the page's query — passed down
   * to `ExpandedCombo` so the kit-tile rationales (heuristic baseline +
   * LLM upgrade) can tint copy toward the shopper's intent. Empty
   * string when no activity was detected. */
  primaryActivity: string | undefined;
  isAudioFirstIntent: boolean;
  /* Activity-level summary (dataset/LLM-authored) shown under the
   * "Choose your starting kit" heading. Falls back to static copy
   * when absent. */
  activitySummary?: string;
  /* Triggered when the shopper hits the X on an accessory tile. The
   * page-level handler owns the "remove this slug from this tier"
   * mutation so the modification persists if the shopper switches
   * tabs and comes back. */
  onRemoveAccessory: (tier: ComboTier, slug: string, productTitle: string) => void;
  /* Slug of the tile that's currently mid-remove (phase 1 fade). The
   * matching tile in the active mosaic picks up a `--removing` class
   * so it visually exits before the layout reflow runs. */
  removingSlug: string | null;
  /* Slugs that are currently mid-restore (entrance fade-in driven by
   * the staggered "Reset kit" cascade). Each matching tile picks up
   * the `--restoring` modifier so CSS plays the in-place fade+scale
   * entrance, mirroring the remove animation. */
  restoringSlugs: Set<string>;
  /* Slug of the tile currently mid-swap (phase 1 skeleton). The
   * matching tile in the active mosaic picks up a `--swapping` class
   * that paints a shimmer while the "better version" is fetched. */
  swappingSlug: string | null;
  /* Map of shopper-removed slugs per tier. Threaded through so the
   * sidebar can decide whether to surface the "Reset kit" button on
   * the active combo (only shown when the active tier has at least
   * one removed accessory). */
  removedAccessories: Record<ComboTier, string[]>;
  /* Restore the active tier's kit back to the wingman-agent
   * generated combo by clearing every removed slug for that tier. */
  onResetKit: (tier: ComboTier) => void;
  /* Remove the custom bundle/tab entirely. */
  onDeleteCustom: () => void;
  /* Open the reviews panel for a product, on a given tab. Threaded into
   * the kit-details panel's reviews widget. */
  onViewReviews: (product: CatalogProduct, tab?: ReviewsTabId) => void;
};

function WingmanPlanCombos({
  combos,
  active,
  onChange,
  primaryActivity,
  isAudioFirstIntent,
  activitySummary,
  onRemoveAccessory,
  removingSlug,
  restoringSlugs,
  swappingSlug,
  removedAccessories,
  onResetKit,
  onDeleteCustom,
  onViewReviews,
}: WingmanPlanCombosProps) {
  const { navigate } = usePrototypeNavigation();
  const activeCombo = combos.find((c) => c.id === active) ?? combos[0];

  /* The "View Details" button on the active combo's sidebar opens an
   * in-page right-side overlay (KitDetailsPanel) instead of routing
   * the shopper away. `detailsCombo` doubles as both "is the panel
   * open" and "which combo is it bound to" — null means closed.
   * `detailsSelectedSlug` deep-links into a specific kit item when
   * the panel is opened by clicking a tile in the combo mosaic; when
   * null, the panel falls back to the combo's core product. */
  const [detailsCombo, setDetailsCombo] = useState<Combo | null>(null);
  const [detailsSelectedSlug, setDetailsSelectedSlug] = useState<string | null>(
    null,
  );

  if (!activeCombo) return null;

  const handleViewCombo = (combo: Combo, productSlug?: string) => {
    setDetailsCombo(combo);
    setDetailsSelectedSlug(productSlug ?? null);
  };

  /* The chat-derived "Custom" combo only appears once the shopper has
   * asked the Wingman chat bar to steer; before that, the Custom tab
   * stays hidden entirely so the tab strip mirrors the wingman-curated
   * trio the page first lands on. */
  const customCombo = combos.find((c) => c.id === "custom") ?? null;

  return (
    <>
      <section
        className="wingman-plan-page__combos"
        aria-label="Curated kits for your goal"
      >
        <div className="wingman-plan-page__combos-card">
          <header className="wingman-plan-page__combos-header">
            <h2 className="wingman-plan-page__combos-title">
              Choose your starting kit
            </h2>
            <p className="wingman-plan-page__combos-subtitle">
              {activitySummary
                ? activitySummary
                : isAudioFirstIntent
                  ? "Take a look at these audio-first kits we have created for your recording workflow"
                  : "Take a look at these custom combos we have created for your adventure"}
            </p>
          </header>

          <div
            className="wingman-plan-page__combos-tabs"
            role="tablist"
            aria-label="Combo tier"
          >
            {TIER_TAB_ORDER.map((tier) => {
              const tierCombo = combos.find((c) => c.id === tier);
              if (!tierCombo) return null;
              const isActive = tier === activeCombo.id;
              return (
                <button
                  key={tier}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  className={
                    "wingman-plan-page__combos-tab" +
                    (isActive ? " wingman-plan-page__combos-tab--active" : "")
                  }
                  onClick={() => onChange(tier)}
                >
                  {TIER_TAB_LABEL[tier]}
                </button>
              );
            })}
            {customCombo ? (
              <button
                key="custom"
                type="button"
                role="tab"
                aria-selected={activeCombo.id === "custom"}
                className={
                  "wingman-plan-page__combos-tab" +
                  (activeCombo.id === "custom"
                    ? " wingman-plan-page__combos-tab--active"
                    : "")
                }
                onClick={() => onChange("custom")}
              >
                {TIER_TAB_LABEL.custom}
              </button>
            ) : null}
          </div>

          <ExpandedCombo
            combo={activeCombo}
            isAudioFirstIntent={isAudioFirstIntent}
            onViewDetails={handleViewCombo}
            primaryActivity={primaryActivity}
            onRemoveAccessory={(slug, title) =>
              onRemoveAccessory(activeCombo.id, slug, title)
            }
            removingSlug={removingSlug}
            restoringSlugs={restoringSlugs}
            swappingSlug={swappingSlug}
            hasRemovedAccessories={
              (removedAccessories[activeCombo.id]?.length ?? 0) > 0
            }
            onResetKit={() => onResetKit(activeCombo.id)}
            onDeleteCustom={onDeleteCustom}
          />
        </div>
      </section>

      <KitDetailsPanel
        combo={detailsCombo}
        kitTitle={detailsCombo ? getTierKitTitle(detailsCombo.id, isAudioFirstIntent) : ""}
        kitDescription={
          detailsCombo ? getTierKitDescription(detailsCombo.id, isAudioFirstIntent) : ""
        }
        initialSelectedSlug={detailsSelectedSlug}
        onViewReviews={onViewReviews}
        onClose={() => {
          setDetailsCombo(null);
          setDetailsSelectedSlug(null);
        }}
      />
    </>
  );
}

type ExpandedComboProps = {
  combo: Combo;
  isAudioFirstIntent: boolean;
  /* Open the kit-details overlay. When `productSlug` is provided, the
   * panel deep-links to that item (e.g. a tile click in the mosaic);
   * when omitted, the sidebar's generic "View Details" button falls
   * back to the combo's core product. */
  onViewDetails: (combo: Combo, productSlug?: string) => void;
  /* Optional primary activity for the page's query. Threaded into
   * `useKitRationales` so the LLM upgrade can tint rationale copy
   * toward the shopper's intent (e.g. travel kit vs wedding kit). */
  primaryActivity: string | undefined;
  /* Fired when the shopper hits the X on an accessory tile. Bound to
   * a tier-aware closure in the parent so this component stays
   * agnostic of which combo is active. */
  onRemoveAccessory: (slug: string, productTitle: string) => void;
  /* Slug of the tile mid-fade (phase 1 of the remove animation). When
   * matched, the corresponding accessory tile gets a `--removing`
   * modifier so CSS can play the in-place fade-out before the layout
   * reflow happens in phase 2. */
  removingSlug: string | null;
  /* Slugs currently mid-restore (entrance fade-in driven by the
   * staggered "Reset kit" cascade). Tiles whose slug is in this set
   * get the `--restoring` modifier so CSS plays the fade+scale-in
   * entrance — mirror of the remove fade-out. */
  restoringSlugs: Set<string>;
  /* Slug of the tile mid-swap (phase 1 skeleton of the "Suggest a
   * better version" flow). The matching hero/accessory tile gets a
   * `--swapping` modifier that paints a shimmer while the upgrade is
   * fetched, before the substitution commits in a View Transition. */
  swappingSlug: string | null;
  /* True when the shopper has removed at least one accessory from
   * this active combo. Drives the conditional "Reset kit" button in
   * the right-rail sidebar. */
  hasRemovedAccessories: boolean;
  /* Restore this combo to the wingman-agent generated kit. Called
   * from the sidebar's "Reset kit" button. */
  onResetKit: () => void;
  /* Remove the custom bundle/tab. */
  onDeleteCustom: () => void;
};

function ExpandedCombo({
  combo,
  isAudioFirstIntent,
  onViewDetails,
  primaryActivity,
  onRemoveAccessory,
  removingSlug,
  restoringSlugs,
  swappingSlug,
  hasRemovedAccessories,
  onResetKit,
  onDeleteCustom,
}: ExpandedComboProps) {
  const { navigate } = usePrototypeNavigation();
  /* Resolve a per-tile rationale Map for this combo. The map is
   * populated synchronously from the heuristic templates so every
   * tile renders with hover copy on first paint; the batched LLM
   * upgrade swaps in richer, kit-aware lines once it resolves.
   * Aborts the in-flight LLM call on combo change / unmount. */
  const rationales = useKitRationales(combo, primaryActivity);

  /* Pinterest-style asymmetric mosaic.
   *
   * Beginner / ideal combos keep the original
   * 4-col x 4-row layout: hero anchors cols 1-2 / rows 1-4, accessory
   * tiles fill cols 3-4 / rows 1-4 in count-specific shapes
   * (--n1 / --n2 / --n3 / --n4) so the cluster is always packed.
   *   - n=4: tall + short stacked twice (asymmetric tall/short rhythm)
   *   - n=3: one wide tile across the top, two squares below
   *   - n=2: two wide tiles stacked
   *   - n=1: one square mirroring the hero
   *
   * Pro combos (id === "top") get an expanded 12-col x 6-row mosaic:
   * the existing top-half cluster (hero on the left, --a1/--a2/--a3
   * on the right matching the n=3 shape) plus a bottom row of three
   * landscape tiles (--a4 / --a5 / --a6) so up to 6 accessories
   * (7 total tiles) read as one packed kit. For n=7 we split the
   * bottom row into four equal tiles to support an 8-product cap.
   * Container aspect-ratio
   * shifts to 4/3 so the hero square stays right-sized while the new
   * row earns ~⅓ of the height — see the .--pro rules in
   * WingmanPlanPage.css. */
  const isPro = combo.id === "top";
  const accessories = combo.accessories.slice(0, isPro ? 7 : combo.id === "ideal" ? 4 : 3);
  const n = accessories.length;
  /* The expanded 12-col / 6-row mosaic only makes sense once we have
   * enough accessories to populate the bottom row (5+). When the
   * bundler returns fewer for a pro core, fall back to the standard
   * 4-col layout — otherwise the bottom row would render half-empty. */
  const usesProMosaic = isPro && n >= 5;

  return (
    <div className="wingman-plan-page__combo-layout">
      <div
        className={
          "wingman-plan-page__combo-grid wingman-plan-page__combo-grid--n" +
          n +
          (usesProMosaic ? " wingman-plan-page__combo-grid--pro" : "")
        }
      >
        <div
          className={
            "wingman-plan-page__combo-tile wingman-plan-page__combo-tile--hero" +
            (swappingSlug === combo.core.slug
              ? " wingman-plan-page__combo-tile--swapping"
              : "")
          }
          /* Opt the hero into the same View Transition flow the
           * accessory tiles use so when the last accessory is removed
           * (n=0 layout: hero spans the whole grid) — or the first
           * accessory is restored via "Reset kit" — the hero morphs
           * smoothly between the half-grid square and the full-grid
           * cinematic shape. Without the name it would just snap to
           * the new grid-area while neighbours animate around it. The
           * name is stable across renders (no slug suffix needed —
           * there is exactly one hero per combo). */
          style={{ viewTransitionName: "kit-tile-hero" }}
        >
          {/* Hero tile uses the PDP cut-out (same as the accessory
           * tiles) so the entire combo grid reads as one consistent
           * filmstrip of clean product silhouettes on white. We
           * previously layered a curated full-bleed marketing photo
           * on top of the cut-out (with a hover-swap to reveal the
           * cut-out underneath), but the lifestyle shots fought the
           * surrounding accessory tiles for visual weight and the
           * mosaic read as cluttered. The `imageUrlOverride` prop
           * survives on `ProductTileImage` in case we want to bring
           * the cover-style treatment back for a different surface. */}
          <ProductTileImage
            product={combo.core}
            onSelect={() => onViewDetails(combo, combo.core.slug)}
            rationale={rationales.get(combo.core.slug)}
          />
        </div>
        {accessories.map((acc, i) => {
          const isRemoving = removingSlug === acc.slug;
          const isRestoring = restoringSlugs.has(acc.slug);
          const isSwapping = swappingSlug === acc.slug;
          return (
            <div
              key={acc.slug}
              className={
                "wingman-plan-page__combo-tile wingman-plan-page__combo-tile--a" +
                (i + 1) +
                (isRemoving
                  ? " wingman-plan-page__combo-tile--removing"
                  : "") +
                (isRestoring
                  ? " wingman-plan-page__combo-tile--restoring"
                  : "") +
                (isSwapping
                  ? " wingman-plan-page__combo-tile--swapping"
                  : "")
              }
              /* `view-transition-name` opts each tile into the View
               * Transitions API so when an accessory is removed, the
               * remaining tiles morph from their old grid-areas into
               * their new ones smoothly (instead of snapping). The
               * fallback path (browsers without the API) just
               * re-layouts on the next paint.
               *
               * The doomed tile drops its name during the phase-1
               * fade-out so the View Transition (kicked off in phase
               * 2) doesn't try to morph an already-faded element —
               * leaving it as a plain DOM node lets the surrounding
               * tiles take it cleanly out of the captured snapshot.
               *
               * Restoring tiles also drop the name on the tick they're
               * re-introduced so they enter via the `--restoring`
               * fade-in keyframe instead of being captured as a
               * brand-new "from offscreen" View Transition node — the
               * latter looks like a snap rather than a graceful
               * appearance. */
              style={
                isRemoving || isRestoring
                  ? undefined
                  : { viewTransitionName: `kit-tile-${acc.slug}` }
              }
            >
              <ProductTileImage
                product={acc}
                onSelect={() => onViewDetails(combo, acc.slug)}
                rationale={rationales.get(acc.slug)}
                onRemove={() => onRemoveAccessory(acc.slug, acc.title)}
              />
            </div>
          );
        })}
      </div>

      <ComboSidebar
        combo={combo}
        isAudioFirstIntent={isAudioFirstIntent}
        onViewDetails={() => onViewDetails(combo)}
        onBuyNow={() =>
          navigate(ROUTES.productListing, {
            slugs: [combo.core.slug, ...combo.accessories.map((acc) => acc.slug)],
          })
        }
        hasRemovedAccessories={hasRemovedAccessories}
        onResetKit={onResetKit}
        canDeleteCustom={combo.id === "custom"}
        onDeleteCustom={onDeleteCustom}
      />
    </div>
  );
}

/* ============================================================
 * Combo sidebar (right rail of the active combo)
 * ============================================================ */

type ComboSidebarProps = {
  combo: Combo;
  isAudioFirstIntent: boolean;
  onViewDetails: () => void;
  onBuyNow: () => void;
  /* When true, the sidebar adds a "Reset kit" tertiary action above
   * the primary CTA row so the shopper can undo their accessory
   * deletions in a single click. */
  hasRemovedAccessories: boolean;
  /* Restore this combo back to the wingman-agent generated kit. */
  onResetKit: () => void;
  canDeleteCustom: boolean;
  onDeleteCustom: () => void;
};

function ComboSidebar({
  combo,
  isAudioFirstIntent,
  onViewDetails,
  onBuyNow,
  hasRemovedAccessories,
  onResetKit,
  canDeleteCustom,
  onDeleteCustom,
}: ComboSidebarProps) {
  /* Show the kit's "list price" as a strikethrough alongside the
   * actual price to telegraph value. The list price here is just a
   * fixed 15% markup — the catalog doesn't carry compare-at prices,
   * so this is a presentation-only flourish (matches Figma's
   * $449.99 / $449.99 strikethrough pattern). */
  const listPrice = combo.totalPrice * 1.15;

  return (
    <aside
      className="wingman-plan-page__sidebar"
      aria-label={`${combo.label} summary`}
    >
      {canDeleteCustom ? (
        <button
          type="button"
          className="wingman-plan-page__sidebar-remove"
          onClick={onDeleteCustom}
          aria-label="Remove custom bundle"
          title="Remove custom bundle"
        >
          <Trash2 width={14} height={14} strokeWidth={2} aria-hidden="true" />
        </button>
      ) : null}
      <div className="wingman-plan-page__sidebar-top">
        <div className="wingman-plan-page__sidebar-headline">
          <h3 className="wingman-plan-page__sidebar-title">
            {getTierKitTitle(combo.id, isAudioFirstIntent)}
          </h3>
          <div className="wingman-plan-page__sidebar-prices">
            <span className="wingman-plan-page__sidebar-price">
              {formatPriceUsd(combo.totalPrice)}
            </span>
            <span className="wingman-plan-page__sidebar-price-strike">
              {formatPriceUsd(listPrice)}
            </span>
          </div>
        </div>
        <p className="wingman-plan-page__sidebar-description">
          {combo.reasoning ?? getTierKitDescription(combo.id, isAudioFirstIntent)}
        </p>
      </div>

      {/* Only the pro tier renders the "What's in the box" list — its
       * expanded mosaic creates the extra vertical room the list needs
       * to breathe. Beginner / ideal combos keep the original compact
       * sidebar (description -> chips -> buttons) so they don't crowd
       * the chip row when the right rail is short. */}
      {combo.id === "top" && (
        <ul
          className="wingman-plan-page__sidebar-itembox"
          aria-label="What's in the box"
        >
          <li className="wingman-plan-page__sidebar-itembox-row">
            <span
              className="wingman-plan-page__sidebar-itembox-dot"
              aria-hidden="true"
            />
            <span className="wingman-plan-page__sidebar-itembox-label">
              {combo.core.title}
            </span>
          </li>
          {combo.accessories.map((acc) => (
            <li
              key={acc.slug}
              className="wingman-plan-page__sidebar-itembox-row"
            >
              <span
                className="wingman-plan-page__sidebar-itembox-dot"
                aria-hidden="true"
              />
              <span className="wingman-plan-page__sidebar-itembox-label">
                {acc.title}
              </span>
            </li>
          ))}
        </ul>
      )}

      <ul
        className="wingman-plan-page__sidebar-chips"
        aria-label="What this kit gets right"
      >
        {KIT_CAPABILITY_CHIPS.map(({ Icon, label }) => (
          <li key={label} className="wingman-plan-page__sidebar-chip">
            <span
              className="wingman-plan-page__sidebar-chip-icon"
              aria-hidden="true"
            >
              <Icon width={32} height={32} strokeWidth={1.6} />
            </span>
            <span className="wingman-plan-page__sidebar-chip-label">
              {label}
            </span>
          </li>
        ))}
      </ul>

      <div
        className={
          "wingman-plan-page__sidebar-actions" +
          (hasRemovedAccessories
            ? " wingman-plan-page__sidebar-actions--with-reset"
            : "")
        }
      >
        {/* "Reset kit" tertiary action — only present when the shopper
         * has removed at least one accessory. Sits to the left of the
         * primary action pair as a compact ghost button so it reads as
         * a secondary "undo" affordance and doesn't compete with Buy
         * now for visual priority. Restores the kit to the wingman
         * agent's original recommendation in one click. */}
        {hasRemovedAccessories && (
          <button
            type="button"
            className="wingman-plan-page__sidebar-button wingman-plan-page__sidebar-button--reset"
            onClick={onResetKit}
            aria-label={`Reset ${TIER_KIT_TITLE[combo.id]} to the original wingman recommendation`}
          >
            Reset kit
          </button>
        )}
        <button
          type="button"
          className="wingman-plan-page__sidebar-button wingman-plan-page__sidebar-button--secondary"
          onClick={onViewDetails}
        >
          View Details
        </button>
        <button
          type="button"
          className="wingman-plan-page__sidebar-button wingman-plan-page__sidebar-button--primary"
          onClick={onBuyNow}
        >
          Buy now
        </button>
      </div>
    </aside>
  );
}

/* ============================================================
 * Product tile (image-only, used in combo grid)
 * ============================================================ */

type ProductTileImageProps = {
  product: Combo["core"] | undefined;
  /* When provided, the tile renders as an interactive <button> that
   * opens the kit-details overlay focused on this product. Without
   * it the tile is a static <div> (used in places where the tile
   * isn't meant to be clickable, e.g. legacy callsites). */
  onSelect?: () => void;
  /* Optional override for the displayed image — used by the hero tile
   * to swap the default PDP cut-out for a curated marketing photo
   * (see `productTypeImageUrl` in buildPlan.ts). When undefined or
   * when resolution fails, the component falls back to
   * `product.imageUrl`. */
  imageUrlOverride?: string;
  /* Optional "why this is in your kit" copy. When provided, renders
   * an overlay layered over the tile image that fades in on hover /
   * focus and is wired to the button via `aria-describedby` so
   * screen readers narrate it without needing the hover. Resolved
   * by `useKitRationales` in `ExpandedCombo`. Tiles rendered outside
   * the kit grid (legacy callsites) leave this undefined and the
   * overlay is omitted entirely. */
  rationale?: KitRationale;
  /* When provided, surfaces a small "x" remove button in the top-right
   * of the tile on hover/focus. Clicking opens the page-level confirm
   * modal (or skips straight to removal when the shopper has opted out
   * of the prompt). Only the accessory tiles wire this up — the hero
   * core is pinned to the kit. */
  onRemove?: () => void;
};

function ProductTileImage({
  product,
  onSelect,
  imageUrlOverride,
  rationale,
  onRemove,
}: ProductTileImageProps) {
  /* Stable id for the rationale overlay — only used when both a
   * rationale and an `onSelect` (interactive variant) exist. Kept at
   * the top of the component so the React hooks order stays stable
   * across re-renders even when the early return below fires. */
  const rationaleId = useId();
  /* Subscribe to the shared selection store so the checkbox reflects
   * (and drives) whether this product is currently held in the chat-bar
   * pill rail. Reading the whole snapshot and deriving membership keeps
   * the store API tiny — the list never exceeds MAX_SELECTION items. */
  const selection = useSyncExternalStore(
    subscribeSelection,
    getSelectionSnapshot,
    getSelectionSnapshot,
  );
  if (!product) return null;
  const isChecked = selection.some((p) => p.slug === product.slug);
  const selectionFull = selection.length >= MAX_SELECTION;
  /* The marketing photos under `Product type/` are full-bleed lifestyle
   * shots — they should fill the tile (no inset frame, object-fit:
   * cover). The default PDP cut-outs are transparent thumbnails that
   * still want the original padded frame. We gate the full-bleed
   * variant on whether an override was supplied. */
  const isCoverImage = Boolean(imageUrlOverride);
  /* When BOTH a marketing photo and a PDP cut-out are available, we
   * render a hover-swap: the marketing photo sits on top by default
   * (lifestyle hook); on hover/focus it fades out to reveal the PDP
   * cut-out underneath (product clarity). Both images are present in
   * the DOM up front so the swap doesn't trigger a load flash. */
  const hasHoverSwap = isCoverImage && Boolean(product.imageUrl);

  let inner: JSX.Element;
  if (hasHoverSwap) {
    inner = (
      <>
        {/* Base layer: PDP cut-out, padded + contained, on white —
         * mirrors how the accessory tiles look. `aria-hidden` because
         * the marketing image (top layer) carries the alt text. */}
        <img
          src={product.imageUrl}
          alt=""
          aria-hidden="true"
          loading="lazy"
          className="wingman-plan-page__tile-img wingman-plan-page__tile-img--pdp"
        />
        {/* Top layer: full-bleed marketing photo. CSS fades this out
         * on the parent's :hover / :focus-visible. */}
        <img
          src={imageUrlOverride}
          alt={product.title}
          loading="lazy"
          className="wingman-plan-page__tile-img wingman-plan-page__tile-img--cover"
        />
      </>
    );
  } else {
    const src = imageUrlOverride ?? product.imageUrl;
    inner = src ? (
      <img
        src={src}
        alt={product.title}
        loading="lazy"
        className={
          isCoverImage
            ? "wingman-plan-page__tile-img wingman-plan-page__tile-img--cover"
            : "wingman-plan-page__tile-img"
        }
      />
    ) : (
      <div className="wingman-plan-page__tile-placeholder" aria-hidden="true" />
    );
  }

  const tileClass =
    "wingman-plan-page__tile" +
    (hasHoverSwap ? " wingman-plan-page__tile--has-hover-swap" : "");

  /* Hover/focus rationale overlay — only renders on the interactive
   * tile variant (the kit-grid tiles passed a `rationale` prop via
   * `useKitRationales`). Product title sits as a small label above
   * the rationale line so the shopper knows which product the
   * "why it's in your kit" copy is referring to (especially handy
   * on accessory tiles where the cut-out can be hard to ID at a
   * glance). Stays in the DOM at all times so it can be wired to
   * the button via `aria-describedby` for screen readers; CSS
   * toggles its visibility on `:hover` / `:focus-visible` of the
   * button. */
  const overlay = rationale ? (
    <div
      className="wingman-plan-page__tile-rationale"
      id={rationaleId}
      aria-hidden="true"
    >
      <span className="wingman-plan-page__tile-rationale-name">
        {product.title}
      </span>
      <span className="wingman-plan-page__tile-rationale-line">
        {rationale}
      </span>
    </div>
  ) : null;

  /* Small "x" affordance in the top-right of the tile that surfaces on
   * hover/focus. Sits as a sibling to the main interactive button (not
   * nested inside it) so we don't nest `<button>` elements — DOM rules
   * disallow that and screen readers get confused. The wrapping
   * `<div class="…__tile-shell">` becomes the new positioning context
   * so the X can absolute-position relative to the full tile area. */
  const removeButton = onRemove ? (
    <button
      type="button"
      className="wingman-plan-page__tile-remove"
      onClick={(event) => {
        /* Stop the click from bubbling into ancestors that might also
         * react to clicks (e.g. a future tile click handler) and from
         * accidentally activating the sibling tile <button>. */
        event.stopPropagation();
        onRemove();
      }}
      aria-label={`Remove ${product.title} from kit`}
    >
      <X
        width={14}
        height={14}
        strokeWidth={2}
        aria-hidden="true"
      />
    </button>
  ) : null;

  /* Selection checkbox pinned to the top-left of the card. Rendered as
   * a sibling of the main tile <button> (not nested inside it) so we
   * don't put interactive content inside a <button>, which is invalid
   * HTML. The label stops click propagation so toggling the checkbox
   * never triggers the tile's own onSelect. */
  const selectCheckbox = (
    <label
      className="wingman-plan-page__card-checkbox"
      onClick={(event) => event.stopPropagation()}
      title={
        !isChecked && selectionFull
          ? `You can select up to ${MAX_SELECTION} products`
          : undefined
      }
    >
      <input
        type="checkbox"
        checked={isChecked}
        disabled={!isChecked && selectionFull}
        onClick={(event) => event.stopPropagation()}
        onChange={() =>
          toggleSelection({
            slug: product.slug,
            title: product.title,
            imageUrl: product.imageUrl,
          })
        }
        aria-label={`Select ${product.title}`}
      />
    </label>
  );

  if (onSelect) {
    return (
      <div className="wingman-plan-page__tile-shell">
        {selectCheckbox}
        <button
          type="button"
          className={`${tileClass} wingman-plan-page__tile--interactive`}
          onClick={onSelect}
          aria-label={`View ${product.title} in kit details`}
          aria-describedby={rationale ? rationaleId : undefined}
        >
          {inner}
          {overlay}
        </button>
        {removeButton}
      </div>
    );
  }

  return <div className={tileClass}>{inner}</div>;
}

/* ============================================================
 * Categories — "Create your own kit"
 * ============================================================ */

type WingmanPlanCategoriesProps = {
  categories: CategoryAccordion[];
  onAddToCustomBundle: (product: CatalogProduct) => void;
  /* Open the reviews panel for a product, on a given tab. Threaded into
   * the kit-details panel's reviews widget. */
  onViewReviews: (product: CatalogProduct, tab?: ReviewsTabId) => void;
};

function WingmanPlanCategories({
  categories,
  onAddToCustomBundle,
  onViewReviews,
}: WingmanPlanCategoriesProps) {
  /* Single source of truth for which accordion is expanded — null
   * means all collapsed. Lifting state here (rather than using the
   * native `name=""` exclusive-accordion behaviour) is what lets the
   * closing row animate through the same ::details-content transition
   * as the opening row. With `name`, the browser force-closes the
   * sibling without firing the transition, which produces a hard
   * "snap then animate" glitch. */
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  /* When the shopper clicks a product card inside one of the
   * accordions, we open the same slide-in detail panel used by the
   * combo card — but in single-product mode (no kit summary, no
   * rail). `selectedProduct` doubles as both "is the panel open"
   * and "which product is on stage". */
  const [selectedProduct, setSelectedProduct] =
    useState<CatalogProduct | null>(null);

  if (categories.length === 0) return null;
  return (
    <section
      className="wingman-plan-page__categories"
      aria-label="Browse by category"
    >
      <div className="wingman-plan-page__categories-card">
        <header className="wingman-plan-page__categories-header">
          <h2 className="wingman-plan-page__categories-title">
            Curated for you
          </h2>
          <p className="wingman-plan-page__categories-subtitle">
            Custom curated items for your need. Select any of these items from
            below categories and you will be set for your adventure.
          </p>
        </header>

        {/* First recipe row is rendered inline (open by default) so
         * the card lands with content visible. The rest are stacked
         * below as collapsed <details> with a 1px hairline above
         * each, mirroring Figma 89:30751. */}
        <ul className="wingman-plan-page__categories-list">
          {categories.map((category, idx) => (
            <li key={category.id} className="wingman-plan-page__category-row">
              {idx > 0 ? (
                <hr
                  className="wingman-plan-page__category-divider"
                  aria-hidden="true"
                />
              ) : null}
              <CategoryRow
                category={category}
                isOpen={openIndex === idx}
                onToggle={(next) => setOpenIndex(next ? idx : null)}
                index={idx + 1}
                onSelectProduct={setSelectedProduct}
              />
            </li>
          ))}
        </ul>
      </div>

      <KitDetailsPanel
        product={selectedProduct}
        onAddToCustomBundle={onAddToCustomBundle}
        onViewReviews={onViewReviews}
        onClose={() => setSelectedProduct(null)}
      />
    </section>
  );
}

type CategoryRowProps = {
  category: CategoryAccordion;
  isOpen: boolean;
  onToggle: (open: boolean) => void;
  index: number;
  /** Open the single-product details panel for the clicked card. */
  onSelectProduct: (product: CatalogProduct) => void;
};

function CategoryRow({
  category,
  isOpen,
  onToggle,
  index,
  onSelectProduct,
}: CategoryRowProps) {
  /* Subscribe to the same shared selection store the combo tiles use so
   * ticking a product card's checkbox drives the chat-bar pill rail (and
   * reflects state set from anywhere else). */
  const selection = useSyncExternalStore(
    subscribeSelection,
    getSelectionSnapshot,
    getSelectionSnapshot,
  );
  const selectionFull = selection.length >= MAX_SELECTION;
  return (
    /* Native <details>/<summary> drives the expand/collapse so
     * keyboard + AT semantics come for free, but we control the
     * `open` state from React so an explicit close on the previously
     * expanded sibling can animate through the same CSS transition
     * (see WingmanPlanPage.css → ::details-content). The native
     * onToggle fires when the user clicks the summary; we fold its
     * intent back into the parent so only one row is ever open. */
    <details
      className="wingman-plan-page__accordion"
      open={isOpen}
      onToggle={(event) => {
        const wantsOpen = event.currentTarget.open;
        if (wantsOpen !== isOpen) onToggle(wantsOpen);
      }}
    >
      <summary className="wingman-plan-page__accordion-summary">
        <span
          className="wingman-plan-page__accordion-counter"
          aria-hidden="true"
        >
          {index}
        </span>
        <span className="wingman-plan-page__accordion-text">
          <span className="wingman-plan-page__accordion-title">
            {category.title}
          </span>
          <span className="wingman-plan-page__accordion-subtitle">
            {category.subtitle}
          </span>
        </span>
        <span
          className="wingman-plan-page__accordion-chevron"
          aria-hidden="true"
        >
          <ChevronDown
            width={32}
            height={32}
            className="wingman-plan-page__accordion-chevron-down"
          />
          <ChevronUp
            width={32}
            height={32}
            className="wingman-plan-page__accordion-chevron-up"
          />
        </span>
      </summary>
      <div className="wingman-plan-page__accordion-panel">
        <ul className="wingman-plan-page__accordion-products">
          {category.products.slice(0, 4).map((product) => {
            const isChecked = selection.some((p) => p.slug === product.slug);
            return (
            <li key={product.slug} className="wingman-plan-page__product-card-item">
              {/* Selection checkbox pinned top-left. Sits as a sibling of
               * the card <button> (nesting interactive content inside a
               * <button> is invalid HTML); the <li> is the positioning
               * context. Stops propagation so it never triggers the
               * card's onSelectProduct. */}
              <label
                className="wingman-plan-page__card-checkbox"
                onClick={(event) => event.stopPropagation()}
                title={
                  !isChecked && selectionFull
                    ? `You can select up to ${MAX_SELECTION} products`
                    : undefined
                }
              >
                <input
                  type="checkbox"
                  checked={isChecked}
                  disabled={!isChecked && selectionFull}
                  onClick={(event) => event.stopPropagation()}
                  onChange={() =>
                    toggleSelection({
                      slug: product.slug,
                      title: product.title,
                      imageUrl: product.imageUrl,
                    })
                  }
                  aria-label={`Select ${product.title}`}
                />
              </label>
              <button
                type="button"
                className="wingman-plan-page__product-card"
                onClick={() => onSelectProduct(product)}
                aria-label={`View ${product.title}`}
              >
                <span className="wingman-plan-page__product-card-image">
                  {product.imageUrl ? (
                    <img src={product.imageUrl} alt="" loading="lazy" />
                  ) : (
                    <span
                      className="wingman-plan-page__tile-placeholder"
                      aria-hidden="true"
                    />
                  )}
                </span>
                <span className="wingman-plan-page__product-card-title">
                  {product.title}
                </span>
                <span className="wingman-plan-page__product-card-price">
                  {product.priceFormatted}
                </span>
              </button>
            </li>
            );
          })}
        </ul>
      </div>
    </details>
  );
}

/* ============================================================
 * Empty state
 * ============================================================ */

type WingmanPlanEmptyStateProps = {
  rawQuery: string;
};

function WingmanPlanEmptyState({ rawQuery }: WingmanPlanEmptyStateProps) {
  const { navigate } = usePrototypeNavigation();

  const launchSuggestion = (prompt: string) => {
    navigate(ROUTES.wingmanPlan, { wingmanQuery: prompt });
  };
  const goHome = () => navigate(ROUTES.wingman);

  return (
    <section className="wingman-plan-page__empty" aria-live="polite">
      <SparkleIcon
        width={28}
        height={28}
        className="wingman-plan-page__empty-icon"
        aria-hidden="true"
      />
      <h2 className="wingman-plan-page__empty-title">
        We don&rsquo;t have a plan for that yet
      </h2>
      <p className="wingman-plan-page__empty-copy">
        {rawQuery
          ? `Wingman couldn't curate combos for "${rawQuery}". Try one of these starting points:`
          : "Tell Wingman a goal and we'll curate a plan. Try one of these to get started:"}
      </p>
      <div
        className="wingman-plan-page__empty-chips"
        role="group"
        aria-label="Suggested prompts"
      >
        {EMPTY_STATE_SUGGESTIONS.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            className="wingman-plan-page__empty-chip"
            onClick={() => launchSuggestion(suggestion)}
          >
            {suggestion}
          </button>
        ))}
        <button
          type="button"
          className="wingman-plan-page__empty-chip wingman-plan-page__empty-chip--reset"
          onClick={goHome}
          aria-label="Back to Wingman"
        >
          <RefreshCcwIcon width={16} height={16} aria-hidden="true" />
          Back to Wingman
        </button>
      </div>
    </section>
  );
}

function WingmanPlanLoadingSkeleton({
  rawQuery,
  detectedActivities,
}: {
  rawQuery: string;
  detectedActivities: string[];
}) {
  const loadingSteps = useMemo(
    () => buildLoadingSteps(rawQuery, detectedActivities),
    [rawQuery, detectedActivities],
  );
  const [activeStepIndex, setActiveStepIndex] = useState(0);

  useEffect(() => {
    const timerId = window.setInterval(() => {
      setActiveStepIndex((current) => (current + 1) % loadingSteps.length);
    }, 4200);
    return () => window.clearInterval(timerId);
  }, [loadingSteps.length]);

  const activeStep = loadingSteps[activeStepIndex] ?? loadingSteps[0];

  return (
    <section
      className="wingman-plan-page__loading"
      aria-label="Building your immersive plan"
      aria-live="polite"
    >
      <div className="wingman-plan-page__loading-hero">
        <div className="wingman-plan-page__loading-hero-back" aria-hidden="true">
          {LOADING_WAVE_DOTS.map((dot, index) => (
            <span
              key={`${dot.x}-${dot.y}-${index}`}
              className="wingman-plan-page__loading-hero-dot"
              style={
                {
                  "--dot-x": `${dot.x}px`,
                  "--dot-y": `${dot.y}px`,
                  "--dot-size": `${dot.size}px`,
                  "--dot-delay": dot.delay,
                } as CSSProperties
              }
            />
          ))}
        </div>
        <div className="wingman-plan-page__loading-hero-copy" aria-atomic="true">
          <p
            className={
              "wingman-plan-page__loading-status-line wingman-plan-page__loading-status-line--shimmer"
            }
          >
            {activeStep}
          </p>
        </div>
      </div>
      <div className="wingman-plan-page__loading-card">
        <div className="wingman-plan-page__loading-line wingman-plan-page__loading-line--title" />
        <div className="wingman-plan-page__loading-line wingman-plan-page__loading-line--caption" />
        <div className="wingman-plan-page__loading-combo-layout">
          <div className="wingman-plan-page__loading-combo-grid">
            <div className="wingman-plan-page__loading-tile wingman-plan-page__loading-tile--hero" />
            <div className="wingman-plan-page__loading-tile wingman-plan-page__loading-tile--a1" />
            <div className="wingman-plan-page__loading-tile wingman-plan-page__loading-tile--a2" />
            <div className="wingman-plan-page__loading-tile wingman-plan-page__loading-tile--a3" />
            <div className="wingman-plan-page__loading-tile wingman-plan-page__loading-tile--a4" />
          </div>
          <div className="wingman-plan-page__loading-sidebar">
            <div className="wingman-plan-page__loading-line wingman-plan-page__loading-line--sm" />
            <div className="wingman-plan-page__loading-line wingman-plan-page__loading-line--sm" />
            <div className="wingman-plan-page__loading-line wingman-plan-page__loading-line--xs" />
            <div className="wingman-plan-page__loading-actions">
              <div className="wingman-plan-page__loading-pill" />
              <div className="wingman-plan-page__loading-pill wingman-plan-page__loading-pill--dark" />
            </div>
          </div>
        </div>
      </div>
      <div className="wingman-plan-page__loading-card wingman-plan-page__loading-card--products">
        <div className="wingman-plan-page__loading-line wingman-plan-page__loading-line--title" />
        <div className="wingman-plan-page__loading-line wingman-plan-page__loading-line--caption" />
        <div className="wingman-plan-page__loading-product-row">
          <div className="wingman-plan-page__loading-product-card" />
          <div className="wingman-plan-page__loading-product-card" />
          <div className="wingman-plan-page__loading-product-card" />
          <div className="wingman-plan-page__loading-product-card" />
        </div>
      </div>
    </section>
  );
}

/* ============================================================
 * Remove-from-kit confirmation modal
 * ============================================================ */

type RemoveAccessoryConfirmModalProps = {
  /* Title of the product about to be removed — surfaced in the modal
   * body so the shopper can verify what's being pulled from the kit. */
  productTitle: string;
  onCancel: () => void;
  onConfirm: (skipFutureConfirmations: boolean) => void;
};

function RemoveAccessoryConfirmModal({
  productTitle,
  onCancel,
  onConfirm,
}: RemoveAccessoryConfirmModalProps) {
  const [skipFuture, setSkipFuture] = useState(false);
  const titleId = useId();
  const descriptionId = useId();

  /* Esc dismisses the modal as a baseline keyboard escape route — the
   * overlay click handles mouse, the Cancel button handles deliberate
   * dismissal, and Esc covers fast keyboard users. */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  return (
    <div
      className="wingman-plan-page__confirm-overlay"
      role="presentation"
      onClick={onCancel}
    >
      <div
        className="wingman-plan-page__confirm"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onClick={(event) => event.stopPropagation()}
      >
        <h3 id={titleId} className="wingman-plan-page__confirm-title">
          Remove product from kit
        </h3>
        <p
          id={descriptionId}
          className="wingman-plan-page__confirm-description"
        >
          {`Remove "${productTitle}" from this kit? You can rebuild your kit anytime from the categories below.`}
        </p>

        <label className="wingman-plan-page__confirm-skip">
          <input
            type="checkbox"
            checked={skipFuture}
            onChange={(event) => setSkipFuture(event.target.checked)}
          />
          <span>Don&rsquo;t ask for confirmation again</span>
        </label>

        <div className="wingman-plan-page__confirm-actions">
          <button
            type="button"
            className="wingman-plan-page__confirm-button wingman-plan-page__confirm-button--secondary"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="wingman-plan-page__confirm-button wingman-plan-page__confirm-button--primary"
            onClick={() => onConfirm(skipFuture)}
            autoFocus
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
 * Page root
 * ============================================================ */

/* Scroll threshold (in CSS px) past which the immersive header
 * fades from transparent to opaque white. The hero band starts
 * fully visible at the top of the page; once the shopper scrolls
 * past a small initial slice the header switches to a solid
 * surface so its dark text stays legible against the white card
 * stack scrolling underneath. */
const HEADER_SOLID_AT = 32;

/* Pixel range over which the hero parallax + blur effect ramps from
 * 0 (resting) to 1 (fully receded). Picked to roughly match the
 * distance the shopper scrolls before the cards have eaten the hero
 * band (~600px feels right against the 853px hero). */
const HERO_PARALLAX_RANGE = 600;

export default function WingmanPlanPage() {
  const { currentWingmanQuery } = usePrototypeNavigation();
  const { products } = useCatalog();
  const localPlan = useMemo(
    () => buildPlan(currentWingmanQuery, products),
    [currentWingmanQuery, products],
  );
  const [llmPlan, setLlmPlan] = useState<PlanResult | null>(null);
  const [isPlanLoading, setIsPlanLoading] = useState(false);

  useEffect(() => {
    const query = currentWingmanQuery.trim();
    if (!query || products.length === 0) {
      setLlmPlan(localPlan);
      setIsPlanLoading(false);
      return;
    }
    if (!isWingmanPlanLlmAvailable()) {
      setLlmPlan(localPlan);
      setIsPlanLoading(false);
      return;
    }
    const controller = new AbortController();
    setIsPlanLoading(true);
    setLlmPlan(null);
    buildPlanWithLlm(query, products, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setLlmPlan(result ?? localPlan);
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsPlanLoading(false);
      });
    return () => controller.abort();
  }, [currentWingmanQuery, localPlan, products]);

  const plan = llmPlan ?? localPlan;
  const isAudioFirstIntent = useMemo(() => {
    const queryAudio = AUDIO_INTENT_QUERY_PATTERN.test(plan.rawQuery);
    const activityAudio = plan.detectedActivities.some((activity) =>
      AUDIO_INTENT_ACTIVITIES.has(activity),
    );
    return queryAudio || activityAudio;
  }, [plan.rawQuery, plan.detectedActivities]);

  /* Wipe any chat thread carried over from a previous plan journey
   * BEFORE we read the store below. The chat lives in sessionStorage
   * (so it can survive incidental in-page re-renders), but the
   * `key={currentWingmanQuery}` wrapper on this component means a
   * NEW value of `currentWingmanQuery` always remounts the page —
   * exactly the moment a leaked thread would silently surface a
   * stale "Custom" tab on a brand-new query. The ref ensures we
   * clear at most once per mount; running clearThread inside a
   * useEffect would be too late (the first render would already
   * read the leaked thread, briefly flashing the Custom tab before
   * the post-paint effect wiped it). */
  const chatClearedRef = useRef(false);
  if (!chatClearedRef.current) {
    chatClearedRef.current = true;
    clearThread();
  }

  /* The Custom tab should react only to in-context steering asks.
   * Out-of-context requests still show in the chat thread, but they
   * do not update this prompt unless the guard accepts them. */
  const latestSteeringPrompt = useSyncExternalStore(
    subscribe,
    getSteeringPromptSnapshot,
    getSteeringPromptSnapshot,
  );

  /* Build the chat-derived combo from the latest user message. Stays
   * null when the shopper hasn't asked the chat to steer yet — which
   * is exactly the signal the combos UI uses to keep the "Custom"
   * tab hidden. The dependency on `products` ensures we rebuild if
   * the catalog hot-reloads in dev. */
  const chatCustomCombo = useMemo(
    () => buildCustomCombo(latestSteeringPrompt, products),
    [latestSteeringPrompt, products],
  );
  /* Product slugs the shopper manually added via the product details
   * panel's "Add to custom bundle" CTA. This powers the custom tab
   * even before chat steering exists, and augments chat-generated
   * custom combos with explicit shopper picks. */
  const [manualCustomProductSlugs, setManualCustomProductSlugs] = useState<
    string[]
  >([]);
  const proactivePromptTimerRef = useRef<number | null>(null);

  const customCombo = useMemo<Combo | null>(() => {
    const manualProducts = manualCustomProductSlugs
      .map((slug) => products.find((p) => p.slug === slug))
      .filter((product): product is CatalogProduct => Boolean(product));

    if (!chatCustomCombo && manualProducts.length === 0) return null;

    if (chatCustomCombo) {
      const mergedAccessories = [...chatCustomCombo.accessories];
      for (const product of manualProducts) {
        if (product.slug === chatCustomCombo.core.slug) continue;
        if (mergedAccessories.some((acc) => acc.slug === product.slug)) continue;
        mergedAccessories.push(product);
      }
      const totalPrice = mergedAccessories.reduce(
        (sum, acc) => sum + (acc.price ?? 0),
        chatCustomCombo.core.price ?? 0,
      );
      return {
        ...chatCustomCombo,
        accessories: mergedAccessories,
        totalPrice,
      };
    }

    const [core, ...accessories] = manualProducts;
    const totalPrice = accessories.reduce(
      (sum, acc) => sum + (acc.price ?? 0),
      core.price ?? 0,
    );
    return {
      id: "custom",
      label: "Custom Kit",
      tagline: "TAILORED FOR YOU",
      badgeTone: "amber",
      core,
      accessories,
      totalPrice,
    };
  }, [chatCustomCombo, manualCustomProductSlugs, products]);

  /* Default to the "ideal" combo so the visually richest tier expands
   * first (matches Figma's emphasis on the middle option). Re-key on
   * the query so navigating to a different plan resets the tab. */
  const [activeCombo, setActiveCombo] = useState<ComboTier>("ideal");

  /* When the chat has just produced (or replaced) a custom combo,
   * snap the active tab over to it so the shopper immediately sees
   * the kit Wingman just composed for them. We key the auto-switch
   * on the chat-picked core's slug so a *new* chat reply updating
   * the custom combo flips back to the Custom tab even if the
   * shopper had wandered to another tier in between. */
  const customCoreSlug = customCombo?.core.slug ?? null;
  useEffect(() => {
    if (customCoreSlug) setActiveCombo("custom");
  }, [customCoreSlug]);

  /* Inverse direction: when the custom combo evaporates (chat thread
   * was cleared) and the active tab is still pointing at it, bounce
   * back to the curated default so the combos surface doesn't render
   * an empty active state. */
  useEffect(() => {
    if (!customCombo && activeCombo === "custom") {
      setActiveCombo("ideal");
    }
  }, [customCombo, activeCombo]);

  const handleAddToCustomBundle = useCallback((product: CatalogProduct) => {
    setManualCustomProductSlugs((prev) =>
      prev.includes(product.slug) ? prev : [...prev, product.slug],
    );
    setActiveCombo("custom");
    clearPendingBundleSuggestion();
    if (proactivePromptTimerRef.current) {
      window.clearTimeout(proactivePromptTimerRef.current);
    }
    proactivePromptTimerRef.current = window.setTimeout(() => {
      const promptMessage =
        "Great choice, should I suggest gear that will go along with this?";
      appendMessage("assistant", promptMessage);
      setPendingBundleSuggestion(product.slug, promptMessage);
      proactivePromptTimerRef.current = null;
    }, 2000);
  }, []);

  useEffect(() => {
    return () => {
      if (proactivePromptTimerRef.current) {
        window.clearTimeout(proactivePromptTimerRef.current);
      }
    };
  }, []);

  const handleAcceptProactiveSuggestions = useCallback(
    (productSlug: string) => {
      const picked = products.find((p) => p.slug === productSlug);
      if (!picked) return;
      setManualCustomProductSlugs((prev) => {
        const seeded = prev.includes(picked.slug) ? prev : [...prev, picked.slug];
        const seededProducts = seeded
          .map((slug) => products.find((p) => p.slug === slug))
          .filter((p): p is CatalogProduct => Boolean(p));
        const anchor =
          (picked.productTypeGroup === "drone" ? picked : null) ??
          seededProducts.find((p) => p.productTypeGroup === "drone") ??
          products.find((p) => p.productTypeGroup === "drone") ??
          null;
        if (!anchor) return seeded;
        const suggested = buildAccessoryBundle(anchor, products, 4);
        const next = [...seeded];
        for (const suggestion of suggested) {
          if (suggestion.slug === anchor.slug) continue;
          if (next.includes(suggestion.slug)) continue;
          next.push(suggestion.slug);
        }
        return next;
      });
      setActiveCombo("custom");
    },
    [products],
  );

  const handleDeclineProactiveSuggestions = useCallback(() => {
    if (proactivePromptTimerRef.current) {
      window.clearTimeout(proactivePromptTimerRef.current);
      proactivePromptTimerRef.current = null;
    }
  }, []);

  const handleDeleteCustomBundle = useCallback(() => {
    setManualCustomProductSlugs([]);
    setRemovedAccessories((prev) => ({ ...prev, custom: [] }));
    clearPendingBundleSuggestion();
    setSteeringPrompt("");
    if (proactivePromptTimerRef.current) {
      window.clearTimeout(proactivePromptTimerRef.current);
      proactivePromptTimerRef.current = null;
    }
    if (activeCombo === "custom") {
      setActiveCombo("ideal");
    }
  }, [activeCombo]);

  /* Per-tier set of accessory slugs the shopper has manually removed
   * from the kit. Stored at the page level (instead of inside
   * ExpandedCombo) so the modification persists when the shopper
   * switches between budget/ideal/top tabs and comes back. The combos
   * computed below filter their accessory list against this map and
   * recompute `totalPrice` so the sidebar's headline price tracks
   * the live kit. */
  const [removedAccessories, setRemovedAccessories] = useState<
    Record<ComboTier, string[]>
  >({ budget: [], ideal: [], top: [], custom: [] });

  /* Per-tier substitution map: originalSlug -> replacementSlug. Powers
   * the "Suggest a better version" NBA, which swaps an in-kit product
   * for a higher-tier alternative in place. Applied in the
   * `displayCombos` projection alongside `removedAccessories` so the
   * swap persists across tab switches and feeds the live sidebar
   * price. Kept separate from removals so a swapped-then-reset kit can
   * restore cleanly. */
  const [swappedAccessories, setSwappedAccessories] = useState<
    Record<ComboTier, Record<string, string>>
  >({ budget: {}, ideal: {}, top: {}, custom: {} });

  /* Slug of the tile currently showing its swap skeleton (phase 1 of
   * the swap animation). Mirrors `removingSlug`; the active mosaic adds
   * a `--swapping` modifier to the matching tile. */
  const [swappingSlug, setSwappingSlug] = useState<string | null>(null);

  /* Pending confirmation prompt — null when no remove is in flight,
   * otherwise carries the tier+slug+title so the modal can render
   * descriptive copy and the page can complete the removal on
   * accept. */
  const [pendingRemove, setPendingRemove] = useState<{
    tier: ComboTier;
    slug: string;
    title: string;
  } | null>(null);

  /* Slug that is mid-removal — set the moment the shopper confirms
   * (or clicks the X with the prompt suppressed) and cleared when the
   * tile has fully faded and the layout has morphed. The active
   * combo's tile carrying this slug picks up a `--removing` modifier
   * that runs an opacity+scale fade-out CSS animation IN PLACE before
   * the View Transition is kicked off — that's what gives the
   * "delete first, reflow second" sequencing. Also used to guard
   * against a second click while a remove is already in flight. */
  const [removingSlug, setRemovingSlug] = useState<string | null>(null);

  /* Slugs that were just brought back by "Reset kit" and are currently
   * mid-entrance (phase 2 of the restore animation). Held in a Set
   * because the staggered cascade can have multiple tiles overlapping
   * in their fade-in window. The active mosaic adds the
   * `--restoring` modifier to any tile whose slug is in this set so
   * CSS plays the in-place fade-in (mirror of the remove fade-out).
   * Cleared per-slug after `TILE_RESTORE_FADE_MS` so the modifier
   * doesn't linger on the DOM and accidentally re-trigger the
   * keyframe on a future re-render. */
  const [restoringSlugs, setRestoringSlugs] = useState<Set<string>>(
    () => new Set(),
  );

  /* Whether the shopper opted out of the confirm prompt (per session/
   * device). Hydrated from localStorage on mount so the preference
   * survives reloads. We update both state + storage in lockstep when
   * the modal checkbox is checked on accept. */
  const [skipRemoveConfirm, setSkipRemoveConfirm] = useState(false);
  useEffect(() => {
    try {
      if (window.localStorage.getItem(REMOVE_CONFIRM_SKIP_KEY) === "1") {
        setSkipRemoveConfirm(true);
      }
    } catch {
      /* localStorage can throw in private mode / sandboxed iframes —
       * fall back silently to the default ("always show prompt"). */
    }
  }, []);

  /* Two-phase removal animation:
   *
   *   Phase 1 — "delete":
   *     `setRemovingSlug(slug)` paints the doomed tile with the
   *     `--removing` modifier. CSS animates opacity → 0 and scale
   *     → 0.92 IN PLACE (the tile still occupies its grid cell, so
   *     the surrounding tiles stay put). Pointer events are killed
   *     on the fading tile so the X can't be re-clicked mid-anim.
   *
   *   Phase 2 — "reflow":
   *     Once the fade-out has played (TILE_REMOVE_FADE_MS), commit
   *     the state mutation that actually removes the slug. We wrap
   *     this in `document.startViewTransition()` (where supported)
   *     so the remaining tiles morph from their old grid-areas into
   *     their new ones (n=4 → n=3 reshapes). `flushSync` keeps the
   *     state commit synchronous inside the transition callback so
   *     the API captures the correct "after" snapshot. Browsers
   *     without the API (Firefox <144) skip straight to the layout
   *     swap; phase 1 still plays as a regular CSS animation.
   *
   * The split is what gives the motion its "tightness": the user
   * clearly sees the product disappear before the others rush in
   * to fill the gap, instead of everything happening at once. */
  const commitRemoveAccessory = useCallback(
    (tier: ComboTier, slug: string) => {
      setRemovingSlug((current) => current ?? slug);

      window.setTimeout(() => {
        const update = () => {
          setRemovedAccessories((prev) => {
            const currentList = prev[tier] ?? [];
            if (currentList.includes(slug)) return prev;
            return { ...prev, [tier]: [...currentList, slug] };
          });
          setRemovingSlug(null);
        };
        const doc = document as Document & {
          startViewTransition?: (cb: () => void) => unknown;
        };
        if (typeof doc.startViewTransition === "function") {
          doc.startViewTransition(() => {
            flushSync(update);
          });
        } else {
          update();
        }
      }, TILE_REMOVE_FADE_MS);
    },
    [],
  );

  const handleRemoveRequest = useCallback(
    (tier: ComboTier, slug: string, productTitle: string) => {
      if (skipRemoveConfirm) {
        commitRemoveAccessory(tier, slug);
        return;
      }
      setPendingRemove({ tier, slug, title: productTitle });
    },
    [skipRemoveConfirm, commitRemoveAccessory],
  );

  const handleConfirmRemove = useCallback(
    (skipFuture: boolean) => {
      if (!pendingRemove) return;
      const { tier, slug } = pendingRemove;
      if (skipFuture) {
        setSkipRemoveConfirm(true);
        try {
          window.localStorage.setItem(REMOVE_CONFIRM_SKIP_KEY, "1");
        } catch {
          /* localStorage unavailable — preference still applies for
           * the rest of the session via the in-memory flag. */
        }
      }
      setPendingRemove(null);
      commitRemoveAccessory(tier, slug);
    },
    [pendingRemove, commitRemoveAccessory],
  );

  /* Restore a tier back to the wingman-agent-generated kit one tile at
   * a time. Mirrors `commitRemoveAccessory` in reverse, with two
   * twists:
   *
   *   1. Restore order follows the original combo's accessory order
   *      (catalog/agent intent), not the removal stack — so the first
   *      tile to reappear is the one the agent placed first, giving
   *      the cascade a natural left-to-right read regardless of which
   *      order the shopper deleted things.
   *
   *   2. Each tile is re-introduced on its own stagger tick wrapped in
   *      `document.startViewTransition()`. The transition handles the
   *      grid morph (existing tiles slide to make room for the
   *      returning one); the `--restoring` class on the freshly added
   *      tile plays an in-place fade+scale entrance. Stagger is wide
   *      enough that consecutive transitions don't stomp on each
   *      other.
   *
   * Browsers without View Transitions still get the per-slug entrance
   * via the `--restoring` class — they just skip the layout morph and
   * snap straight to the new grid-area. */
  const handleResetKit = useCallback(
    (tier: ComboTier) => {
      const removed = removedAccessories[tier];
      if (!removed || removed.length === 0) return;

      /* Sort the removed slugs by their position in the agent's
       * original accessory list so the cascade plays in catalog order
       * rather than reverse-removal order. */
      const originalCombo = plan.combos.find((c) => c.id === tier);
      const originalOrder =
        originalCombo?.accessories.map((acc) => acc.slug) ?? [];
      const restoreOrder = [...removed].sort(
        (a, b) => originalOrder.indexOf(a) - originalOrder.indexOf(b),
      );

      restoreOrder.forEach((slug, index) => {
        window.setTimeout(() => {
          const update = () => {
            setRestoringSlugs((prev) => {
              if (prev.has(slug)) return prev;
              const next = new Set(prev);
              next.add(slug);
              return next;
            });
            setRemovedAccessories((prev) => {
              const list = prev[tier] ?? [];
              if (!list.includes(slug)) return prev;
              return { ...prev, [tier]: list.filter((s) => s !== slug) };
            });
          };
          const doc = document as Document & {
            startViewTransition?: (cb: () => void) => unknown;
          };
          if (typeof doc.startViewTransition === "function") {
            doc.startViewTransition(() => {
              flushSync(update);
            });
          } else {
            update();
          }

          /* Clear the `--restoring` marker once the entrance keyframe
           * has finished playing so the class doesn't linger on the
           * DOM (would otherwise re-trigger the fade-in on any
           * subsequent re-render of the tile). */
          window.setTimeout(() => {
            setRestoringSlugs((prev) => {
              if (!prev.has(slug)) return prev;
              const next = new Set(prev);
              next.delete(slug);
              return next;
            });
          }, TILE_RESTORE_FADE_MS);
        }, index * TILE_RESTORE_STAGGER_MS);
      });
    },
    [plan.combos, removedAccessories],
  );

  /* Project the catalog-built combos through the removed-accessory
   * map: filter accessories the shopper pulled, then recompute the
   * displayed `totalPrice` so the sidebar headline tracks the live
   * kit. When no removals have been made for a tier, the original
   * combo flows through unchanged.
   *
   * The chat-derived custom combo is concatenated last so that
   * `WingmanPlanCombos` can find it via `combos.find(c => c.id ===
   * "custom")` and render its tab beside the wingman-curated three. */
  const displayCombos = useMemo<Combo[]>(() => {
    /* Project a combo through the shopper's live modifications: first
     * apply per-tier swaps (originalSlug -> replacementSlug), then
     * filter removed slugs, then recompute the headline price. Shared
     * by the curated tiers and the custom combo so both react to the
     * same NBA-driven edits. */
    const projectCombo = (combo: Combo): Combo => {
      const swaps = swappedAccessories[combo.id] ?? {};
      const removed = removedAccessories[combo.id] ?? [];
      const hasSwaps = Object.keys(swaps).length > 0;
      if (!hasSwaps && removed.length === 0) return combo;

      const substitute = (p: CatalogProduct): CatalogProduct => {
        /* Follow swap chains (a tile swapped, then swapped again) until
         * we reach the final replacement slug, guarding against cycles. */
        let slug = p.slug;
        const guard = new Set<string>();
        while (swaps[slug] && !guard.has(slug)) {
          guard.add(slug);
          slug = swaps[slug];
        }
        if (slug === p.slug) return p;
        return products.find((cp) => cp.slug === slug) ?? p;
      };

      const core = substitute(combo.core);
      const seen = new Set<string>([core.slug]);
      const accessories = combo.accessories
        .map(substitute)
        .filter((acc) => {
          if (removed.includes(acc.slug)) return false;
          if (seen.has(acc.slug)) return false;
          seen.add(acc.slug);
          return true;
        });
      const totalPrice = accessories.reduce(
        (sum, acc) => sum + (acc.price ?? 0),
        core.price ?? 0,
      );
      return { ...combo, core, accessories, totalPrice };
    };

    const projected = plan.combos.map(projectCombo);
    if (!customCombo) return projected;
    return [...projected, projectCombo(customCombo)];
  }, [plan.combos, removedAccessories, swappedAccessories, customCombo, products]);

  const activeDisplayCombo = useMemo(
    () => displayCombos.find((combo) => combo.id === activeCombo) ?? null,
    [displayCombos, activeCombo],
  );

  const activeKitAccessories = useMemo<KitAccessory[]>(
    () =>
      (activeDisplayCombo?.accessories ?? []).map((acc) => ({
        slug: acc.slug,
        title: acc.title,
      })),
    [activeDisplayCombo],
  );

  /* Products the shopper has ticked via the tile / category-card
   * checkboxes. Subscribing here (the same store the chat-bar pill rail
   * reads) lets the page resolve full catalog entries for the selection
   * and derive context-aware Next Best Actions. */
  const selectedProducts = useSyncExternalStore(
    subscribeSelection,
    getSelectionSnapshot,
    getSelectionSnapshot,
  );

  /* Products currently shown in the side-by-side comparison panel.
   * Null when the panel is closed. Opened by the "Compare these"
   * selection NBA — comparison is a routine feature, so it surfaces in
   * a dedicated tabular panel (KitComparePanel) rather than the chat. */
  const [compareProducts, setCompareProducts] = useState<
    CatalogProduct[] | null
  >(null);

  /* Product whose reviews panel (YouTube videos + text reviews) is
   * open. Null when the panel is closed. Opened by the "View reviews"
   * selection NBA and by the details panel's reviews widget. */
  const [reviewsProduct, setReviewsProduct] = useState<CatalogProduct | null>(
    null,
  );
  /* Which tab the reviews panel opens on. The details-panel widget deep
   * links to "reviews" (text) or "videos"; the NBA keeps the default. */
  const [reviewsTab, setReviewsTab] = useState<ReviewsTabId>("videos");
  const openReviews = useCallback(
    (product: CatalogProduct, tab: ReviewsTabId = "videos") => {
      setReviewsTab(tab);
      setReviewsProduct(product);
    },
    [],
  );

  /* Append the shopper's NBA question immediately, then the templated
   * Wingman answer on a short delay so the exchange reads as a genuine
   * back-and-forth. The chat bar reopens its thread on the same click,
   * so both bubbles surface without extra plumbing. */
  const askInChat = useCallback((question: string, answer: string) => {
    appendMessage("user", question);
    window.setTimeout(() => {
      appendMessage("assistant", answer);
    }, NBA_REPLY_DELAY_MS);
  }, []);

  /* Free-text product Q&A. When the shopper has product(s) selected and
   * types a question-like message, answer it from the selected
   * product(s)' catalog data instead of steering the plan. Returns null
   * to let the chat bar fall through to its existing steering path
   * (non-question text, or no selection). With multiple picks, produce
   * one combined reply with a labeled answer per product. */
  const resolveSelectionAnswer = useCallback(
    (question: string): string | null => {
      /* Resolve the product(s) the shopper is focused on: the docked
       * details-panel product wins (it's what they're looking at), else
       * the checkbox selection. Read the dock slug at call time so it
       * always reflects the currently open panel. */
      const dockedSlug = getAgentDockProductSlugSnapshot();
      const dockedProduct = dockedSlug
        ? products.find((p) => p.slug === dockedSlug) ?? null
        : null;
      const selectionResolved = selectedProducts
        .map((p) => products.find((cp) => cp.slug === p.slug))
        .filter((p): p is CatalogProduct => Boolean(p));
      const focusProducts = dockedProduct ? [dockedProduct] : selectionResolved;

      /* Comparison intent ("compare this with the action 5", "osmo 6 vs
       * pocket 3"). Checked BEFORE the question gate so imperative
       * phrasings ("compare with action 5") still trigger it. When we can
       * resolve the named competitor, open the side-by-side table with the
       * focus product + that competitor and acknowledge in chat. */
      const comparison = detectComparisonRequest(
        question,
        focusProducts,
        products,
      );
      if (comparison.products) {
        setCompareProducts(comparison.products);
        const [anchor, ...others] = comparison.products;
        const otherNames =
          others.length === 1
            ? `the ${others[0].title}`
            : others.map((p) => p.title).join(", ");
        return `Opening a side-by-side comparison of the ${anchor.title} and ${otherNames}.`;
      }
      if (comparison.unresolved) {
        const anchorName = focusProducts[0]?.title ?? "this product";
        return `I can compare the ${anchorName} against another product — which one would you like to see it next to?`;
      }

      if (!isProductQuestion(question)) return null;
      if (focusProducts.length === 0) return null;
      if (focusProducts.length === 1) {
        return answerProductQuestion(focusProducts[0], question);
      }
      return focusProducts
        .map((p) => `${p.title}: ${answerProductQuestion(p, question)}`)
        .join("\n\n");
    },
    [selectedProducts, products],
  );

  /* NBA "Remove this/these": drop the slug(s) from the active kit (via
   * the shared remove animation) AND untick them from the selection so
   * the chat-bar pill + NBA row clear in one gesture. */
  const handleRemoveFromKitAndUntick = useCallback(
    (slugs: string[]) => {
      if (slugs.length === 0) return;
      for (const slug of slugs) {
        commitRemoveAccessory(activeCombo, slug);
        removeSelection(slug);
      }
    },
    [activeCombo, commitRemoveAccessory],
  );

  /* NBA "Add to kit": route a browsed product into the custom kit,
   * reusing the existing custom-bundle path (which switches to the
   * Custom tab). Untick it afterward so the pill/NBA row resets. */
  const handleAddToKit = useCallback(
    (slug: string) => {
      const product = products.find((p) => p.slug === slug);
      if (!product) return;
      handleAddToCustomBundle(product);
      removeSelection(slug);
    },
    [products, handleAddToCustomBundle],
  );

  /* NBA "Suggest a better version": swap an in-kit product for a
   * higher-tier alternative in place. Phase 1 paints the tile with a
   * skeleton (`swappingSlug`); phase 2 commits the substitution inside
   * a View Transition so the tile morphs into the upgrade, then unticks
   * the original and drops a chat notice describing the swap. */
  const handleSwapForBetter = useCallback(
    (oldSlug: string, newSlug: string) => {
      const oldProduct = products.find((p) => p.slug === oldSlug);
      const newProduct = products.find((p) => p.slug === newSlug);
      if (!newProduct) return;
      const tier = activeCombo;
      setSwappingSlug((current) => current ?? oldSlug);

      window.setTimeout(() => {
        const update = () => {
          setSwappedAccessories((prev) => {
            const current = prev[tier] ?? {};
            return { ...prev, [tier]: { ...current, [oldSlug]: newSlug } };
          });
          setSwappingSlug((current) => (current === oldSlug ? null : current));
        };
        const doc = document as Document & {
          startViewTransition?: (cb: () => void) => unknown;
        };
        if (typeof doc.startViewTransition === "function") {
          doc.startViewTransition(() => {
            flushSync(update);
          });
        } else {
          update();
        }
        removeSelection(oldSlug);
        const fromLabel = oldProduct ? oldProduct.title : "that pick";
        const priceNote = newProduct.priceFormatted
          ? ` at ${newProduct.priceFormatted}`
          : "";
        appendMessage(
          "assistant",
          `I swapped your ${fromLabel} for the ${newProduct.title} — a step up to the ${newProduct.tier} tier${priceNote}.`,
        );
      }, TILE_SWAP_SKELETON_MS);
    },
    [activeCombo, products],
  );

  const selectionNbas = useMemo(() => {
    const resolved = selectedProducts
      .map((p) => products.find((cp) => cp.slug === p.slug))
      .filter((p): p is CatalogProduct => Boolean(p));
    const activeKitSlugs = new Set<string>();
    if (activeDisplayCombo) {
      activeKitSlugs.add(activeDisplayCombo.core.slug);
      for (const acc of activeDisplayCombo.accessories) {
        activeKitSlugs.add(acc.slug);
      }
    }
    return resolveSelectionNbas(
      resolved,
      {
        activeKitSlugs,
        coreSlug: activeDisplayCombo?.core.slug ?? null,
        catalog: products,
      },
      {
        askInChat,
        removeFromKit: handleRemoveFromKitAndUntick,
        addToKit: handleAddToKit,
        swapForBetter: handleSwapForBetter,
        compareProducts: setCompareProducts,
        viewReviews: openReviews,
      },
    );
  }, [
    selectedProducts,
    products,
    activeDisplayCombo,
    askInChat,
    handleRemoveFromKitAndUntick,
    handleAddToKit,
    handleSwapForBetter,
    openReviews,
  ]);

  /* Slug of the product currently on stage in the docked surface
   * (KitDetailsPanel). When set, the chat bar is docked and focused on a
   * single product, so its NBA row should surface that product's own
   * contextual FAQs rather than the (checkbox) selection actions. */
  const dockProductSlug = useSyncExternalStore(
    subscribeAgentDock,
    getAgentDockProductSlugSnapshot,
    getAgentDockProductSlugSnapshot,
  );

  /* Contextual FAQ chips for the docked product — the first three rules
   * that apply, each tapping through to a templated Wingman answer in the
   * chat thread. Empty when nothing is docked. */
  const dockedProductNbas = useMemo(() => {
    if (!dockProductSlug) return [];
    const product = products.find((p) => p.slug === dockProductSlug);
    if (!product) return [];
    return buildProductFaqs(product)
      .slice(0, 3)
      .map((faq) => ({
        id: `dock-faq-${product.slug}-${faq.id}`,
        label: faq.question,
        run: () => askInChat(faq.question, faq.answer),
      }));
  }, [dockProductSlug, products, askInChat]);

  /* When docked on a product, the product's FAQs take precedence over the
   * selection NBAs so the agent stays contextual to what the shopper is
   * looking at in the panel. */
  const chatBarNbas =
    dockedProductNbas.length > 0 ? dockedProductNbas : selectionNbas;

  const handleImmediateChatRemove = useCallback(
    (slugs: string[]) => {
      if (slugs.length === 0) return;
      for (const slug of slugs) {
        commitRemoveAccessory(activeCombo, slug);
      }
    },
    [activeCombo, commitRemoveAccessory],
  );

  const handleImmediateChatRestore = useCallback(
    (slugs: string[]) => {
      if (slugs.length === 0) return;
      const doc = document as Document & {
        startViewTransition?: (cb: () => void) => unknown;
      };
      const update = () => {
        setRemovedAccessories((prev) => {
          const removed = prev[activeCombo] ?? [];
          if (removed.length === 0) return prev;
          const requested = new Set(slugs);
          const nextRemoved = removed.filter((slug) => !requested.has(slug));
          if (nextRemoved.length === removed.length) return prev;
          return { ...prev, [activeCombo]: nextRemoved };
        });
      };
      if (typeof doc.startViewTransition === "function") {
        doc.startViewTransition(() => {
          flushSync(update);
        });
      } else {
        update();
      }
    },
    [activeCombo],
  );

  /* Track whether the user has scrolled past the initial threshold
   * so we can swap the immersive header from transparent (over the
   * hero band) to opaque white (over the cards stack). The same
   * listener also writes a normalised 0..1 parallax progress to a
   * CSS custom property on the page root so the hero image can lag,
   * blur and dim purely from CSS (see WingmanPlanPage.css). One
   * passive listener, rAF-batched, so scrolling stays buttery. */
  const rootRef = useRef<HTMLDivElement>(null);
  const [isScrolled, setIsScrolled] = useState(false);
  useEffect(() => {
    let frame = 0;
    const sync = () => {
      frame = 0;
      const y = window.scrollY;
      setIsScrolled(y > HEADER_SOLID_AT);
      const root = rootRef.current;
      if (root) {
        const p = Math.min(1, Math.max(0, y / HERO_PARALLAX_RANGE));
        root.style.setProperty("--hero-scroll-progress", String(p));
      }
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(sync);
    };
    sync();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div
      ref={rootRef}
      className={
        "wingman-plan-page" +
        (isScrolled ? " wingman-plan-page--scrolled" : "")
      }
      key={currentWingmanQuery}
    >
      <ImmersiveHeader />
      <main className="wingman-plan-page__main">
        {isPlanLoading ? (
          <WingmanPlanLoadingSkeleton
            rawQuery={plan.rawQuery}
            detectedActivities={plan.detectedActivities}
          />
        ) : (
          <>
            <WingmanPlanHero plan={plan} />
            {plan.hasResults ? (
              <div className="wingman-plan-page__cards">
                <WingmanPlanCombos
                  combos={displayCombos}
                  active={activeCombo}
                  onChange={setActiveCombo}
                  primaryActivity={plan.detectedActivities[0]}
                  isAudioFirstIntent={isAudioFirstIntent}
                  activitySummary={plan.activitySummary}
                  onRemoveAccessory={handleRemoveRequest}
                  removingSlug={removingSlug}
                  restoringSlugs={restoringSlugs}
                  swappingSlug={swappingSlug}
                  removedAccessories={removedAccessories}
                  onResetKit={handleResetKit}
                  onDeleteCustom={handleDeleteCustomBundle}
                  onViewReviews={openReviews}
                />
                <WingmanPlanCategories
                  categories={plan.categories}
                  onAddToCustomBundle={handleAddToCustomBundle}
                  onViewReviews={openReviews}
                />
              </div>
            ) : (
              <WingmanPlanEmptyState rawQuery={plan.rawQuery} />
            )}
          </>
        )}
      </main>
      {pendingRemove && (
        <RemoveAccessoryConfirmModal
          productTitle={pendingRemove.title}
          onCancel={() => setPendingRemove(null)}
          onConfirm={handleConfirmRemove}
        />
      )}
      {/* Floating chat bar — only meaningful when there's a plan to
       * steer. The empty state already owns its own "tell us more"
       * CTA, so suppress the bar there to avoid two competing inputs.
       * Modal-aware dimming (KitDetailsPanel + RemoveAccessoryConfirmModal)
       * is handled in CSS via `body:has(...)` so we don't need to
       * thread modal-open state through props. */}
      <WingmanChatBar
        visible={plan.hasResults && !isPlanLoading}
        currentWingmanQuery={currentWingmanQuery}
        activeKitLabel={activeDisplayCombo?.label ?? "Current kit"}
        activeKitAccessories={activeKitAccessories}
        onRemoveFromActiveKit={handleImmediateChatRemove}
        onRestoreInActiveKit={handleImmediateChatRestore}
        onAcceptBundleSuggestions={handleAcceptProactiveSuggestions}
        onDeclineBundleSuggestions={handleDeclineProactiveSuggestions}
        onAskAboutSelection={resolveSelectionAnswer}
        nbas={chatBarNbas}
      />
      {/* Side-by-side comparison — a routine, non-chat surface opened by
       * the "Compare these" selection NBA. Reuses the KitDetailsPanel
       * slide-in chrome (and its backdrop class, so the chat bar dims
       * via the shared `body:has(.wingman-kit-details__backdrop)` rule).
       * "+" routes the product into the custom bundle. */}
      <KitComparePanel
        products={compareProducts}
        onClose={() => setCompareProducts(null)}
        onAddToBundle={handleAddToCustomBundle}
      />
      {/* Reviews — a routine, non-chat surface opened by the "View
       * reviews" selection NBA. Reuses the KitDetailsPanel slide-in
       * chrome (and its backdrop class, so the chat bar dims via the
       * shared body:has(...) rule). YouTube videos + text reviews. */}
      <ProductReviewsPanel
        product={reviewsProduct}
        initialTab={reviewsTab}
        onClose={() => setReviewsProduct(null)}
        onAddToCustomBundle={handleAddToCustomBundle}
      />
    </div>
  );
}
