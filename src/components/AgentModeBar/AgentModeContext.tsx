import { createContext, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";

export type AgentMode =
  | "assistant-only"
  | "side-by-side"
  | "immersive"
  | "basic-website";

export const AGENT_MODES: { id: AgentMode; label: string }[] = [
  { id: "basic-website", label: "Native Storefront" },
  { id: "assistant-only", label: "Sidecar assistant" },
  { id: "side-by-side", label: "Side by side assistant" },
  { id: "immersive", label: "Immersive" },
];

export type DemoViewportMode = "desktop" | "mobile";

type AgentModeContextValue = {
  mode: AgentMode;
  setMode: (mode: AgentMode) => void;
  viewportMode: DemoViewportMode;
  setViewportMode: (mode: DemoViewportMode) => void;
};

const AgentModeContext = createContext<AgentModeContextValue | undefined>(undefined);

/* Hard defaults for every page load. By design, refreshing the
 * page ALWAYS resets the experience switcher to Immersive + Desktop
 * regardless of what the shopper picked in the previous session.
 * If you change these defaults, also update
 * `.cursor/rules/agent-mode-defaults.mdc` so future agents pick up
 * the new convention. */
const DEFAULT_AGENT_MODE: AgentMode = "immersive";
const DEFAULT_VIEWPORT_MODE: DemoViewportMode = "desktop";

export function AgentModeProvider({ children }: { children: ReactNode }) {
  /* No localStorage init for either piece of state: every refresh
   * starts from the hard defaults above. The mid-session setters
   * still work normally; they just don't survive a reload. */
  const [mode, setMode] = useState<AgentMode>(DEFAULT_AGENT_MODE);
  const [viewportMode, setViewportMode] = useState<DemoViewportMode>(DEFAULT_VIEWPORT_MODE);

  const value = useMemo(
    () => ({ mode, setMode, viewportMode, setViewportMode }),
    [mode, viewportMode],
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
