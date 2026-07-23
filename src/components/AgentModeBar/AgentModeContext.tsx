import { createContext, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";

export type AgentMode =
  | "assistant-only"
  | "side-by-side"
  | "basic-website";

export const AGENT_MODES: { id: AgentMode; label: string }[] = [
  { id: "basic-website", label: "Native Storefront" },
  { id: "assistant-only", label: "Sidecar assistant" },
  { id: "side-by-side", label: "Side by side assistant" },
];

export type DemoViewportMode = "desktop" | "mobile";

/** Fixed seed for UserTesting A/B oily-skin studies. Overridable via ?prompt=. */
export const UT_DEFAULT_PROMPT = "best skincare for oily skin";

export type UserTestingVariant = "a" | "b";

type UserTestingBootstrap = {
  variant: UserTestingVariant | null;
  userTestingLock: boolean;
  accordionRecommendations: boolean;
  viewportMode: DemoViewportMode;
  seedPrompt: string;
};

type AgentModeContextValue = {
  mode: AgentMode;
  setMode: (mode: AgentMode) => void;
  viewportMode: DemoViewportMode;
  setViewportMode: (mode: DemoViewportMode) => void;
  /** When true, routine category recommendations render as a single-open accordion. */
  accordionRecommendations: boolean;
  setAccordionRecommendations: (enabled: boolean) => void;
  /** Context island feature toggle (behavior TBD). */
  contextIsland: boolean;
  setContextIsland: (enabled: boolean) => void;
  /**
   * True when the page was opened with `?ut=a` or `?ut=b`. Locks the
   * experience for UserTesting (hides AgentModeBar, seeds the oily-skin prompt).
   */
  userTestingLock: boolean;
  /** Seed prompt used when `userTestingLock` is active. */
  utSeedPrompt: string;
};

const AgentModeContext = createContext<AgentModeContextValue | undefined>(undefined);

/* Hard defaults for every page load. By design, refreshing the
 * page ALWAYS resets the experience switcher to Sidecar assistant +
 * Desktop regardless of what the shopper picked in the previous
 * session — unless a UserTesting `?ut=` lock is present. */
const DEFAULT_AGENT_MODE: AgentMode = "assistant-only";
const DEFAULT_VIEWPORT_MODE: DemoViewportMode = "desktop";
const DEFAULT_ACCORDION_RECOMMENDATIONS = true;
const DEFAULT_CONTEXT_ISLAND = false;

function readUserTestingBootstrap(): UserTestingBootstrap {
  if (typeof window === "undefined") {
    return {
      variant: null,
      userTestingLock: false,
      accordionRecommendations: DEFAULT_ACCORDION_RECOMMENDATIONS,
      viewportMode: DEFAULT_VIEWPORT_MODE,
      seedPrompt: UT_DEFAULT_PROMPT,
    };
  }

  const params = new URLSearchParams(window.location.search);
  const utRaw = (params.get("ut") || "").trim().toLowerCase();
  const variant: UserTestingVariant | null =
    utRaw === "a" || utRaw === "b" ? utRaw : null;
  const userTestingLock = variant !== null;

  const viewportRaw = (params.get("viewport") || "").trim().toLowerCase();
  const viewportOverride: DemoViewportMode | null =
    viewportRaw === "mobile" || viewportRaw === "desktop" ? viewportRaw : null;

  const promptRaw = params.get("prompt")?.trim();
  const seedPrompt = promptRaw || UT_DEFAULT_PROMPT;

  if (!userTestingLock) {
    return {
      variant: null,
      userTestingLock: false,
      accordionRecommendations: DEFAULT_ACCORDION_RECOMMENDATIONS,
      viewportMode: DEFAULT_VIEWPORT_MODE,
      seedPrompt,
    };
  }

  return {
    variant,
    userTestingLock: true,
    // A = accordion on (one fold open); B = all sections open
    accordionRecommendations: variant === "a",
    viewportMode: viewportOverride ?? "mobile",
    seedPrompt,
  };
}

const UT_BOOTSTRAP = readUserTestingBootstrap();

export function AgentModeProvider({ children }: { children: ReactNode }) {
  /* No localStorage init for either piece of state: every refresh
   * starts from the hard defaults above (or UT lock from the URL).
   * The mid-session setters still work normally; they just don't
   * survive a reload. */
  const [mode, setMode] = useState<AgentMode>(DEFAULT_AGENT_MODE);
  const [viewportMode, setViewportMode] = useState<DemoViewportMode>(
    UT_BOOTSTRAP.viewportMode,
  );
  const [accordionRecommendations, setAccordionRecommendations] = useState<boolean>(
    UT_BOOTSTRAP.accordionRecommendations,
  );
  const [contextIsland, setContextIsland] = useState<boolean>(DEFAULT_CONTEXT_ISLAND);

  const value = useMemo(
    () => ({
      mode,
      setMode,
      viewportMode,
      setViewportMode,
      accordionRecommendations,
      setAccordionRecommendations,
      contextIsland,
      setContextIsland,
      userTestingLock: UT_BOOTSTRAP.userTestingLock,
      utSeedPrompt: UT_BOOTSTRAP.seedPrompt,
    }),
    [mode, viewportMode, accordionRecommendations, contextIsland],
  );

  return <AgentModeContext.Provider value={value}>{children}</AgentModeContext.Provider>;
}

export function useAgentMode(): AgentModeContextValue {
  const ctx = useContext(AgentModeContext);
  if (!ctx) {
    throw new Error("useAgentMode must be used within an AgentModeProvider");
  }
  return ctx;
}
