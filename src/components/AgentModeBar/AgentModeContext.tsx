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
};

const AgentModeContext = createContext<AgentModeContextValue | undefined>(undefined);

/* Hard defaults for every page load. By design, refreshing the
 * page ALWAYS resets the experience switcher to Sidecar assistant +
 * Desktop regardless of what the shopper picked in the previous
 * session. */
const DEFAULT_AGENT_MODE: AgentMode = "assistant-only";
const DEFAULT_VIEWPORT_MODE: DemoViewportMode = "desktop";
const DEFAULT_ACCORDION_RECOMMENDATIONS = true;
const DEFAULT_CONTEXT_ISLAND = false;

export function AgentModeProvider({ children }: { children: ReactNode }) {
  /* No localStorage init for either piece of state: every refresh
   * starts from the hard defaults above. The mid-session setters
   * still work normally; they just don't survive a reload. */
  const [mode, setMode] = useState<AgentMode>(DEFAULT_AGENT_MODE);
  const [viewportMode, setViewportMode] = useState<DemoViewportMode>(DEFAULT_VIEWPORT_MODE);
  const [accordionRecommendations, setAccordionRecommendations] = useState<boolean>(
    DEFAULT_ACCORDION_RECOMMENDATIONS,
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
