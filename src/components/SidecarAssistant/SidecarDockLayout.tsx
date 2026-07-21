import { useEffect, useRef, useState, type ReactNode } from "react";
import { SparkleIcon } from "../icons/StorefrontIcons";
import { useAgentMode } from "../AgentModeBar/AgentModeContext";
import { SidecarAssistant } from "./SidecarAssistant";
// Reuse the proven SideBySide docking shell so the Sidecar docks *exactly*
// like the SideBySide assistant: a CSS grid (1fr | panel) that reflows the
// storefront and a `position: sticky` full-height column pinned under the
// storefront header, rather than a floating fixed overlay card.
import "../SideBySideAssistant/SideBySideLayout.css";

type Props = {
  children: ReactNode;
};

// Stagger the FAB so it doesn't pop in over the closing panel. Matches the
// keyframe / transition durations in SideBySideLayout.css.
const FAB_REVEAL_DELAY_MS = 280;

export function SidecarDockLayout({ children }: Props) {
  const { viewportMode } = useAgentMode();
  const isMobileViewport = viewportMode === "mobile";

  const [panelOpen, setPanelOpen] = useState(false);
  // When detached the assistant floats as a centered modal and the storefront
  // reflows to full width. Desktop-only; mobile keeps the overlay sheet.
  const [detached, setDetached] = useState(false);
  // Once the assistant mounts we keep it in the tree for the rest of the
  // session so the chat history survives a close -> reopen. The close
  // transition is driven entirely by CSS (grid collapses to 0px and the panel
  // slides out via `--closing`).
  const [panelMounted, setPanelMounted] = useState(false);
  const [fabVisible, setFabVisible] = useState(true);

  const panelRef = useRef<HTMLElement | null>(null);
  const swipeStartXRef = useRef<number | null>(null);
  const swipeStartYRef = useRef<number | null>(null);

  const openPanel = () => setPanelOpen(true);
  const closePanel = () => setPanelOpen(false);
  const toggleDetach = () => setDetached((value) => !value);

  // Re-dock whenever the panel closes or we drop into mobile, so the modal
  // state never lingers when the docked shell isn't visible.
  useEffect(() => {
    if (!panelOpen || isMobileViewport) setDetached(false);
  }, [panelOpen, isMobileViewport]);

  const isDetached = detached && !isMobileViewport;

  useEffect(() => {
    if (panelOpen) {
      setPanelMounted(true);
      setFabVisible(false);
      return;
    }
    const fabTimer = window.setTimeout(
      () => setFabVisible(true),
      FAB_REVEAL_DELAY_MS,
    );
    return () => window.clearTimeout(fabTimer);
  }, [panelOpen]);

  // Open on the same storefront events the sidecar/SxS assistants listen for.
  // The `agentic:ask-assistant` prompt itself is seeded by SidecarAssistant's
  // own listener; here we only need to open the panel so the grid reflows.
  useEffect(() => {
    const onOpen = () => openPanel();
    document.addEventListener("agentic:open-assistant", onOpen);
    document.addEventListener("agentic:ask-assistant", onOpen);
    return () => {
      document.removeEventListener("agentic:open-assistant", onOpen);
      document.removeEventListener("agentic:ask-assistant", onOpen);
    };
  }, []);

  useEffect(() => {
    if (!isMobileViewport) return;
    const root = document.documentElement;
    const vv = window.visualViewport;
    const syncViewport = () => {
      const viewportHeight = vv?.height ?? window.innerHeight;
      root.style.setProperty("--sxs-mobile-vh", `${Math.round(viewportHeight)}px`);
    };
    syncViewport();
    vv?.addEventListener("resize", syncViewport);
    window.addEventListener("resize", syncViewport);
    return () => {
      vv?.removeEventListener("resize", syncViewport);
      window.removeEventListener("resize", syncViewport);
      root.style.removeProperty("--sxs-mobile-vh");
    };
  }, [isMobileViewport]);

  const resetSwipeTransform = () => {
    const panel = panelRef.current;
    if (!panel) return;
    panel.style.transition = "";
    panel.style.transform = "";
  };

  useEffect(() => {
    if (panelOpen) resetSwipeTransform();
  }, [panelOpen]);

  return (
    <div className="sxs-shell">
      {isDetached ? (
        <button
          type="button"
          className="sxs-layout__detach-backdrop"
          aria-label="Dock assistant panel"
          onClick={() => setDetached(false)}
        />
      ) : null}
      <div
        className={
          (panelOpen ? "sxs-layout" : "sxs-layout sxs-layout--panel-collapsed") +
          (isMobileViewport ? " sxs-layout--mobile" : "") +
          (isDetached ? " sxs-layout--detached" : "")
        }
      >
        <div className="sxs-layout__main">{children}</div>
        {panelMounted ? (
          <aside
            ref={panelRef}
            className={
              (panelOpen
                ? "sxs-layout__panel sxs-layout__panel--open"
                : "sxs-layout__panel sxs-layout__panel--closing") +
              (isMobileViewport ? " sxs-layout__panel--mobile" : "") +
              (isDetached ? " sxs-layout__panel--detached" : "")
            }
            aria-label="Personal Assistant"
            aria-hidden={!panelOpen}
            onTouchStart={(event) => {
              if (!isMobileViewport || !panelOpen) return;
              const touch = event.touches[0];
              if (!touch) return;
              swipeStartXRef.current = touch.clientX;
              swipeStartYRef.current = touch.clientY;
            }}
            onTouchMove={(event) => {
              if (!isMobileViewport || !panelOpen) return;
              const panel = panelRef.current;
              const startX = swipeStartXRef.current;
              const startY = swipeStartYRef.current;
              const touch = event.touches[0];
              if (!panel || startX === null || startY === null || !touch) return;
              const dx = touch.clientX - startX;
              const dy = touch.clientY - startY;
              // Bottom sheet: only engage a downward, vertically-dominant drag.
              if (dy <= 0 || Math.abs(dy) < Math.abs(dx)) return;
              panel.style.transition = "none";
              panel.style.transform = `translate3d(0, ${Math.min(dy, 220)}px, 0)`;
            }}
            onTouchEnd={(event) => {
              if (!isMobileViewport || !panelOpen) return;
              const startX = swipeStartXRef.current;
              const startY = swipeStartYRef.current;
              const touch = event.changedTouches[0];
              swipeStartXRef.current = null;
              swipeStartYRef.current = null;
              if (startX === null || startY === null || !touch) {
                resetSwipeTransform();
                return;
              }
              const dx = touch.clientX - startX;
              const dy = touch.clientY - startY;
              // Swipe down far enough (and vertically) dismisses the sheet.
              if (dy > 120 && Math.abs(dy) > Math.abs(dx)) {
                closePanel();
                return;
              }
              const panel = panelRef.current;
              if (!panel) return;
              panel.style.transition = "transform 180ms ease";
              panel.style.transform = "translate3d(0, 0, 0)";
              window.setTimeout(() => resetSwipeTransform(), 190);
            }}
          >
            <SidecarAssistant
              docked
              open={panelOpen}
              onRequestClose={closePanel}
              detached={isDetached}
              onToggleDetach={toggleDetach}
            />
          </aside>
        ) : null}
      </div>
      {fabVisible ? (
        <button
          type="button"
          className="sxs-layout__fab"
          aria-label="Open Personal Assistant"
          onClick={openPanel}
        >
          <SparkleIcon width={22} height={22} className="sxs-layout__fab-icon" />
          <span className="sxs-layout__fab-label" aria-hidden="true">
            glow with me
          </span>
        </button>
      ) : null}
    </div>
  );
}

export default SidecarDockLayout;
