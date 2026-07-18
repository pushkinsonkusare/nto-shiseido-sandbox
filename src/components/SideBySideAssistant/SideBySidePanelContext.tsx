import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { PdpNbaPillKind } from "../../pages/ProductDetailPage/pdpNbaPills";

/**
 * A queued shopper utterance. The `token` makes each dispatch uniquely
 * identifiable so the consumer can dedupe synthetic re-invocations
 * (e.g. React 18 StrictMode's mount → cleanup → mount cycle, which
 * otherwise replays the consumer effect with the same prompt and
 * causes the turn to be dispatched twice).
 *
 * `productSlug` and `pillKind` are populated when the prompt originated
 * from a PDP NBA pill click — they let the assistant render the
 * product-context header inside the reply card and pick the right
 * utterance variant (hygiene/faq/open/…).
 */
export type PendingPrompt = {
  token: number;
  prompt: string;
  productSlug?: string;
  pillKind?: PdpNbaPillKind;
};

/**
 * Caller-facing payload for `setPendingPrompt`. Strings are accepted for
 * backward compatibility with non-PDP callers; objects let PDP surfaces
 * pass through `productSlug` and `pillKind` without losing them.
 */
export type PendingPromptInput =
  | string
  | {
      prompt: string;
      productSlug?: string;
      pillKind?: PdpNbaPillKind;
    };

export type SideBySidePanelContextValue = {
  panelOpen: boolean;
  openPanel: () => void;
  closePanel: () => void;
  /**
   * Prompt queued by an external surface (e.g. PDP NBA pill) that should be
   * dispatched as a shopper message once the panel mounts. Cleared by the
   * consumer immediately after dispatch.
   */
  pendingPrompt: PendingPrompt | null;
  /** Pass a string or rich payload to queue a new prompt, or `null` to clear. */
  setPendingPrompt: (prompt: PendingPromptInput | null) => void;
};

const SideBySidePanelContext =
  createContext<SideBySidePanelContextValue | null>(null);

export function SideBySidePanelProvider({ children }: { children: ReactNode }) {
  const [panelOpen, setPanelOpen] = useState(false);
  const [pendingPrompt, setPendingPromptState] = useState<PendingPrompt | null>(
    null,
  );
  const tokenRef = useRef(0);
  const openPanel = useCallback(() => setPanelOpen(true), []);
  const closePanel = useCallback(() => setPanelOpen(false), []);

  const setPendingPrompt = useCallback(
    (input: PendingPromptInput | null) => {
      if (input === null) {
        setPendingPromptState(null);
        return;
      }
      tokenRef.current += 1;
      if (typeof input === "string") {
        setPendingPromptState({ token: tokenRef.current, prompt: input });
        return;
      }
      setPendingPromptState({
        token: tokenRef.current,
        prompt: input.prompt,
        productSlug: input.productSlug,
        pillKind: input.pillKind,
      });
    },
    [],
  );

  const value = useMemo(
    () => ({
      panelOpen,
      openPanel,
      closePanel,
      pendingPrompt,
      setPendingPrompt,
    }),
    [panelOpen, openPanel, closePanel, pendingPrompt, setPendingPrompt],
  );

  return (
    <SideBySidePanelContext.Provider value={value}>
      {children}
    </SideBySidePanelContext.Provider>
  );
}

export function useSideBySidePanel(): SideBySidePanelContextValue {
  const ctx = useContext(SideBySidePanelContext);
  if (!ctx) {
    throw new Error(
      "useSideBySidePanel must be used within SideBySidePanelProvider",
    );
  }
  return ctx;
}
