import { useAgentMode } from "../AgentModeBar/AgentModeContext";
import { SparkleIcon } from "../icons/StorefrontIcons";
import "./OpenPersonalAssistantNavButton.css";

/** Dispatches `agentic:open-assistant` — Sidecar listens; SideBySideLayout opens the panel when collapsed. */
export function OpenPersonalAssistantNavButton() {
  const { mode } = useAgentMode();
  if (mode === "basic-website") return null;

  return (
    <button
      type="button"
      className="personal-assistant-nav-trigger"
      aria-label="Open Personal Assistant"
      onClick={() =>
        document.dispatchEvent(new CustomEvent("agentic:open-assistant"))
      }
    >
      <SparkleIcon width={16} height={16} />
    </button>
  );
}
