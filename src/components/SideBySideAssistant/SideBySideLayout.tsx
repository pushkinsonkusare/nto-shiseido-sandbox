import { useEffect, useRef, useState, type ReactNode } from "react";
import { SparkleIcon } from "../icons/StorefrontIcons";
import { useAgentMode } from "../AgentModeBar/AgentModeContext";
import { SideBySideAssistant } from "./SideBySideAssistant";
import {
  SideBySidePanelProvider,
  useSideBySidePanel,
} from "./SideBySidePanelContext";
import type { AskAssistantEventDetail } from "../../pages/ProductDetailPage/PdpNbaPanel";
import "./SideBySideLayout.css";

type Props = {
  children: ReactNode;
};

// Stagger the FAB so it doesn't pop in over the closing panel. Tuned to
// match the keyframe / transition durations in SideBySideLayout.css.
const FAB_REVEAL_DELAY_MS = 280;

function SideBySideLayoutInner({ children }: Props) {
  const { panelOpen, openPanel, closePanel, setPendingPrompt } = useSideBySidePanel();
  const { viewportMode } = useAgentMode();
  const isMobileViewport = viewportMode === "mobile";
  const panelRef = useRef<HTMLElement | null>(null);
  const swipeStartXRef = useRef<number | null>(null);
  const swipeStartYRef = useRef<number | null>(null);
  // Once the assistant mounts we keep it in the tree for the rest of the
  // session so the chat history (owned by useSideBySideAgent inside it)
  // survives a close → reopen. The close transition is driven entirely by
  // CSS — the grid collapses to 0px and the panel slides out via the
  // `--closing` class, so an unmounted assistant is not required to hide it.
  const [panelMounted, setPanelMounted] = useState(panelOpen);
  const [fabVisible, setFabVisible] = useState(!panelOpen);

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
    return () => {
      window.clearTimeout(fabTimer);
    };
  }, [panelOpen]);

  useEffect(() => {
    const onOpenAssistant = () => {
      openPanel();
    };
    document.addEventListener("agentic:open-assistant", onOpenAssistant);
    return () =>
      document.removeEventListener("agentic:open-assistant", onOpenAssistant);
  }, [openPanel]);

  useEffect(() => {
    const onAskAssistant = (event: Event) => {
      const detail = (event as CustomEvent<AskAssistantEventDetail>).detail;
      const prompt = detail?.prompt?.trim();
      if (!prompt) return;
      // Stash the prompt so the SxS assistant can dispatch it as soon as it
      // mounts (the assistant is unmounted while the panel is collapsed),
      // then open the panel. The PDP forwards `productSlug` + `pillKind`
      // when a NBA pill fires the event so the assistant can render the
      // product-context header and route to the matching utterance variant.
      setPendingPrompt({
        prompt,
        productSlug: detail?.productSlug,
        pillKind: detail?.pillKind,
      });
      openPanel();
    };
    document.addEventListener("agentic:ask-assistant", onAskAssistant);
    return () =>
      document.removeEventListener("agentic:ask-assistant", onAskAssistant);
  }, [openPanel, setPendingPrompt]);

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
      {isMobileViewport && panelOpen ? (
        <button
          type="button"
          className="sxs-layout__backdrop"
          aria-label="Close assistant panel"
          onClick={closePanel}
        />
      ) : null}
      <div
        className={
          (panelOpen ? "sxs-layout" : "sxs-layout sxs-layout--panel-collapsed") +
          (isMobileViewport ? " sxs-layout--mobile" : "")
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
              (isMobileViewport ? " sxs-layout__panel--mobile" : "")
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
              if (dx <= 0 || Math.abs(dx) < Math.abs(dy)) return;
              panel.style.transition = "none";
              panel.style.transform = `translate3d(${Math.min(dx, 140)}px, 0, 0)`;
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
              if (dx > 88 && Math.abs(dx) > Math.abs(dy)) {
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
            <SideBySideAssistant />
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
          <SparkleIcon
            width={22}
            height={22}
            className="sxs-layout__fab-icon"
          />
          <span className="sxs-layout__fab-label" aria-hidden="true">
            fly with me
          </span>
        </button>
      ) : null}
    </div>
  );
}

export function SideBySideLayout({ children }: Props) {
  return (
    <SideBySidePanelProvider>
      <SideBySideLayoutInner>{children}</SideBySideLayoutInner>
    </SideBySidePanelProvider>
  );
}

export default SideBySideLayout;
