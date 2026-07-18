import { useEffect, useState } from "react";
import { Settings, X } from "lucide-react";
import "./AgentModeBar.css";
import { ROUTES, usePrototypeNavigation } from "../../prototypeRoutes";
import { AGENT_MODES, useAgentMode } from "./AgentModeContext";
import type { AgentMode } from "./AgentModeContext";

type DemoTheme = "sf-next" | "consumer-electronics" | "cosmetics";

const DEMO_THEMES: { id: DemoTheme; label: string }[] = [
  { id: "sf-next", label: "SF Next" },
  { id: "consumer-electronics", label: "Consumer electronics" },
  { id: "cosmetics", label: "Cosmetics" },
];

export function AgentModeBar() {
  const { mode, setMode, viewportMode, setViewportMode } = useAgentMode();
  const { navigate } = usePrototypeNavigation();
  const [isSwitcherOpen, setIsSwitcherOpen] = useState(false);
  const [theme, setTheme] = useState<DemoTheme>(() => {
    if (typeof window === "undefined") return "sf-next";
    const saved = window.localStorage.getItem("agent-demo-theme");
    return saved === "consumer-electronics" || saved === "cosmetics"
      ? saved
      : "sf-next";
  });

  const handleModeClick = (nextMode: AgentMode) => {
    if (nextMode === mode) return;
    setMode(nextMode);
    if (nextMode === "immersive") {
      navigate(ROUTES.home);
    }
  };

  useEffect(() => {
    if (!isSwitcherOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsSwitcherOpen(false);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isSwitcherOpen]);

  useEffect(() => {
    /* Reflect the active viewport on the documentElement so CSS
     * media-query-equivalents can scope to it. We deliberately
     * DON'T persist this to localStorage anymore — every page
     * refresh resets the experience switcher to its defaults
     * (see `AgentModeContext.tsx`). One-time cleanup of any stale
     * value left by a previous build keeps the storage tidy. */
    const root = document.documentElement;
    root.setAttribute("data-demo-viewport", viewportMode);
    try {
      window.localStorage.removeItem("agent-demo-viewport-mode");
    } catch {
      /* localStorage can fail in private mode; ignore gracefully. */
    }
  }, [viewportMode]);

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-demo-theme", theme);
    try {
      window.localStorage.setItem("agent-demo-theme", theme);
    } catch {
      /* localStorage can fail in private mode; ignore gracefully. */
    }
  }, [theme]);

  return (
    <div className="agent-mode-bar" role="banner" aria-label="Experience switcher">
      <button
        type="button"
        className="agent-mode-bar__fab"
        onClick={() => setIsSwitcherOpen((open) => !open)}
        aria-expanded={isSwitcherOpen}
        aria-controls="agent-mode-switcher-modal"
        aria-label={isSwitcherOpen ? "Close experience switcher" : "Open experience switcher"}
        title={isSwitcherOpen ? "Close switcher" : "Open switcher"}
      >
        <Settings width={16} height={16} aria-hidden="true" />
      </button>
      {isSwitcherOpen && (
        <div
          className="agent-mode-bar__modal-overlay"
          role="presentation"
          onClick={() => setIsSwitcherOpen(false)}
        >
          <div
            id="agent-mode-switcher-modal"
            className="agent-mode-bar__modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="agent-mode-switcher-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="agent-mode-bar__modal-header">
              <h2 id="agent-mode-switcher-title" className="agent-mode-bar__modal-title">
                Agentic Commerce
              </h2>
              <button
                type="button"
                className="agent-mode-bar__modal-close"
                onClick={() => setIsSwitcherOpen(false)}
                aria-label="Close experience switcher"
              >
                <X width={16} height={16} aria-hidden="true" />
              </button>
            </div>

            <div className="agent-mode-bar__section">
              <h3 className="agent-mode-bar__section-title">Concept switcher</h3>
              <div className="agent-mode-bar__option-grid" role="group" aria-label="Concept switcher">
                {AGENT_MODES.map(({ id, label }) => (
                  <button
                    key={id}
                    type="button"
                    className={
                      "agent-mode-bar__option-button" +
                      (mode === id ? " agent-mode-bar__option-button--active" : "")
                    }
                    onClick={() => handleModeClick(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="agent-mode-bar__section">
              <h3 className="agent-mode-bar__section-title">Platform switcher</h3>
              <div className="agent-mode-bar__option-grid" role="group" aria-label="Platform switcher">
                <button
                  type="button"
                  className={
                    "agent-mode-bar__option-button" +
                    (viewportMode === "desktop" ? " agent-mode-bar__option-button--active" : "")
                  }
                  onClick={() => setViewportMode("desktop")}
                >
                  Desktop
                </button>
                <button
                  type="button"
                  className={
                    "agent-mode-bar__option-button" +
                    (viewportMode === "mobile" ? " agent-mode-bar__option-button--active" : "")
                  }
                  onClick={() => setViewportMode("mobile")}
                >
                  Mobile
                </button>
              </div>
            </div>

            <div className="agent-mode-bar__section">
              <h3 className="agent-mode-bar__section-title">Theme switcher</h3>
              <div className="agent-mode-bar__option-grid" role="group" aria-label="Theme switcher">
                {DEMO_THEMES.map(({ id, label }) => (
                  <button
                    key={id}
                    type="button"
                    className={
                      "agent-mode-bar__option-button" +
                      (theme === id ? " agent-mode-bar__option-button--active" : "")
                    }
                    onClick={() => setTheme(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default AgentModeBar;
