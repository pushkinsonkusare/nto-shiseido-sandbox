import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  ArrowRight,
  LoaderCircle,
  Mic,
  Plus,
  Sparkle,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { useSpeechRecognition } from "../WingmanPage/useSpeechRecognition";
import { ROUTES, usePrototypeNavigation } from "../../prototypeRoutes";
import { guardChatContext } from "./chatContextGuard";
import { composeAssistantReply } from "./composeAssistantReply";
import {
  isUndoRemoveCommand,
  resolveRemoveCommand,
  type KitAccessory,
} from "./parseKitCommands";
import type { WingmanNbaItem } from "./wingmanNba";
import {
  appendMessage,
  clearPendingBundleSuggestion,
  clearPendingSwitchProposal,
  getPendingBundleSuggestionSnapshot,
  clearThread,
  getPendingSwitchSnapshot,
  getSnapshot,
  setPendingSwitchProposal,
  setSteeringPrompt,
  latestExchange,
  subscribe,
} from "./wingmanChatStore";
import {
  clearSelection,
  getSnapshot as getSelectionSnapshot,
  removeSelection,
  subscribe as subscribeSelection,
} from "./wingmanSelectionStore";
import {
  getAgentDockLabelSnapshot,
  getAgentDockSnapshot,
  subscribeAgentDock,
} from "./wingmanAgentDockStore";
import "./WingmanChatBar.css";

/**
 * Floating chat bar for the Wingman plan page (immersive mode).
 *
 * Renders four visual states pulled straight from Figma frames
 * 127:33390 / 128:31402 / 128:31455 / 128:31692:
 *
 *   • rest      — translucent gray pill, no border, no shadow.
 *                 Pure affordance, blends into the page.
 *   • hover     — solid white pill with a 1px gray border. Lifts
 *                 the bar out of the background on pointer-enter.
 *   • active    — same chrome as hover; the inner input gets keyboard
 *                 focus and the textarea highlights.
 *   • thread    — adds a soft drop shadow and renders the latest
 *                 user / assistant exchange above the input. Older
 *                 messages aren't surfaced (Figma only shows the
 *                 most recent pair, no scrollback).
 *
 * The "real steering" submit flow appends the user message + a stub
 * assistant reply to the chat thread, then navigates to the plan page
 * with an augmented query (`<old query> <chat input>`). That triggers
 * the page's `key={currentWingmanQuery}` remount, so `buildPlan` runs
 * fresh against the augmented query and the visible combos shift.
 *
 * The chat thread itself lives in sessionStorage (see
 * `wingmanChatStore.ts`) so it survives the remount visually — when
 * the page mounts again the bar reads the thread back from storage
 * and renders the latest exchange above its input without skipping a
 * frame.
 */

/** Hide the bar entirely when there's no plan to steer. The empty
 * state already owns its own "tell us more" CTA. */
type WingmanChatBarProps = {
  /** When false, the bar is hidden — typically because the plan has
   * no results and a competing "tell us more" panel is on screen. */
  visible: boolean;
  currentWingmanQuery: string;
  activeKitLabel: string;
  activeKitAccessories: KitAccessory[];
  onRemoveFromActiveKit: (slugs: string[]) => void;
  onRestoreInActiveKit: (slugs: string[]) => void;
  onAcceptBundleSuggestions: (productSlug: string) => void;
  onDeclineBundleSuggestions: () => void;
  /** Answer a free-text question about the current product selection,
   * built from catalog data. Returns the answer string when the message
   * is a product question and there's a selection, or null to let the
   * message flow to the normal steering path. */
  onAskAboutSelection?: (question: string) => string | null;
  /** Context-aware Next Best Actions for the current pill selection.
   * Rendered as a row of chips directly below the pills. Empty when
   * nothing is selected. */
  nbas: WingmanNbaItem[];
};

/* Small artificial delay before the assistant reply appears, so the
 * thread renders user → assistant in a perceptible cadence rather
 * than both bubbles popping in on the same frame. The plan navigation
 * happens AFTER this so the page rebuild lines up with the assistant
 * acknowledging the request. */
const REPLY_DELAY_MS = 400;

/* How long the latest exchange stays visible after the assistant has
 * acknowledged + the underlying plan page has rebuilt with the new
 * combos. The chat is a steering tool, not a persistent log — once
 * the shopper has read the reply, the bar collapses back to its
 * resting input-only chrome so it doesn't keep eating screen real
 * estate. The timer only runs when the user isn't actively engaging
 * with the bar (no hover, no focus). 4s is enough to read the canned
 * two-sentence reply at a comfortable pace. */
const AUTO_COLLAPSE_MS = 4000;

/* Duration of the collapse fade-out. Has to match the CSS transition
 * on `.wingman-chat-bar__thread` so React unmounts the bubbles once
 * the visual collapse has actually finished — clearing earlier would
 * snap the height closed without animation. */
const COLLAPSE_ANIMATION_MS = 280;

const PLACEHOLDER = "Ask me anything or tell me what to update...";

export function WingmanChatBar({
  visible,
  currentWingmanQuery,
  activeKitLabel,
  activeKitAccessories,
  onRemoveFromActiveKit,
  onRestoreInActiveKit,
  onAcceptBundleSuggestions,
  onDeclineBundleSuggestions,
  onAskAboutSelection,
  nbas,
}: WingmanChatBarProps) {
  const { navigate } = usePrototypeNavigation();
  const speech = useSpeechRecognition();

  /* Hover tracks pointer-enter on the outer chrome. We avoid the CSS
   * `:hover` pseudo for this because we also want to suppress hover
   * styling once the bar is in `active` or `thread` state — both
   * already use the white-chrome look and JS state lets us key on
   * them explicitly. */
  const [isHovered, setIsHovered] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [inputValue, setInputValue] = useState("");
  /* Read the chat thread directly from the shared store. The page
   * subscribes to the same store to derive its `customCombo`, so the
   * two surfaces stay in lockstep without prop plumbing — and we
   * never need to keep a duplicate React-state mirror in sync with
   * sessionStorage by hand. */
  const thread = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const pendingSwitch = useSyncExternalStore(
    subscribe,
    getPendingSwitchSnapshot,
    getPendingSwitchSnapshot,
  );
  const pendingBundleSuggestion = useSyncExternalStore(
    subscribe,
    getPendingBundleSuggestionSnapshot,
    getPendingBundleSuggestionSnapshot,
  );
  /* Products the shopper has ticked via the tile checkboxes. Surfaced
   * as compact pills directly above the input so they can gather a
   * few items and then ask Wingman about them together. */
  const selectedProducts = useSyncExternalStore(
    subscribeSelection,
    getSelectionSnapshot,
    getSelectionSnapshot,
  );
  /* When a surface (currently KitDetailsPanel) registers a dock, the bar
   * teleports into it so the agent "follows the shopper's focus". Null
   * when nothing is docked → the bar renders in its floating viewport
   * position as usual. */
  const dockElement = useSyncExternalStore(
    subscribeAgentDock,
    getAgentDockSnapshot,
    getAgentDockSnapshot,
  );
  /* Name of the product/kit the docked surface is focused on, used to
   * make the input placeholder contextual while docked. */
  const dockLabel = useSyncExternalStore(
    subscribeAgentDock,
    getAgentDockLabelSnapshot,
    getAgentDockLabelSnapshot,
  );
  /* Brief window between user-message append and assistant-reply
   * append, used to render a "thinking…" indicator in the assistant
   * slot so the thread doesn't blink. */
  const [isReplying, setIsReplying] = useState(false);
  /* Mid-collapse window — the auto-dismiss timer has fired, the
   * thread block is animating out, but we haven't hidden the
   * bubbles yet so they can fade rather than snap. The chat is
   * "leaving the thread state" but visually still in it for
   * COLLAPSE_ANIMATION_MS. */
  const [isCollapsing, setIsCollapsing] = useState(false);
  /* Set once the auto-collapse animation finishes. Hides the chat
   * bubbles WITHOUT wiping the underlying store — the latest user
   * message is the steering signal for the page's `customCombo`, so
   * clearing it here would also remove the Custom tab the chat just
   * created. The flag flips back to false the moment the shopper
   * sends a follow-up message (so the new exchange replaces the
   * stale one) and is wiped entirely by the explicit "Clear chat"
   * button (which also clears the Custom tab on purpose). */
  const [threadCollapsed, setThreadCollapsed] = useState(false);
  const [waveJitter, setWaveJitter] = useState<number[]>([
    1, 1, 1, 1, 1,
  ]);

  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);
  const lastChatRemovalRef = useRef<{
    kitLabel: string;
    slugs: string[];
    titles: string[];
  } | null>(null);

  /* Auto-grow the textarea exactly the way the landing-page hero
   * input does (see WingmanPage.tsx:155-160). Resetting to "auto"
   * before measuring scrollHeight is the trick that lets the height
   * shrink as the user deletes text. */
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [inputValue]);

  /* Mirror the live interim transcript while the user is talking, and
   * commit the higher-quality final transcript when recognition ends.
   * Pattern lifted verbatim from WingmanPage so voice behaviour is
   * identical between the landing input and the floating chat. */
  useEffect(() => {
    if (speech.state === "listening" && speech.interim) {
      setInputValue(speech.interim);
    }
  }, [speech.interim, speech.state]);

  useEffect(() => {
    if (speech.finalTranscript) {
      setInputValue(speech.finalTranscript);
    }
  }, [speech.finalTranscript]);

  const isListening =
    speech.state === "listening" || speech.state === "requesting";
  const isTranscribing = speech.state === "transcribing";

  /* Auto-collapse the thread once the page has acknowledged the
   * shopper's request. This effect schedules the fade-out timer; a
   * second effect below handles the actual unmount once the fade
   * animation has played.
   *
   * Pause guards: hover (the shopper's mouse is on the bar — likely
   * reading), mid-reply (the assistant is still composing), live
   * voice capture (mid-utterance), and an in-progress mid-write
   * follow-up (focused with non-empty draft). We DON'T pause on
   * empty-but-focused, because pressing Enter naturally leaves the
   * textarea focused even though the shopper has already shipped
   * their message and is now reading the result — pausing there
   * would mean the chat never collapses without an explicit blur. */
  useEffect(() => {
    if (thread.length === 0) return;
    if (isCollapsing) return;
    /* When we're waiting on an explicit context-switch choice, keep
     * the assistant bubble pinned open until the shopper clicks one
     * of the CTAs ("Stay" / "Create new plan"). */
    if (pendingSwitch) return;
    if (pendingBundleSuggestion) return;
    /* If the thread already auto-collapsed once and the bubbles are
     * hidden, don't re-arm the timer — `isCollapsing` flips back to
     * false at the end of the animation, which would otherwise let
     * this effect re-fire immediately and start the cycle over even
     * though there's nothing left to hide. The flag clears the next
     * time the shopper sends a fresh message. */
    if (threadCollapsed) return;
    if (isReplying) return;
    if (isHovered) return;
    if (isListening || isTranscribing) return;
    if (isFocused && inputValue.trim().length > 0) return;
    const id = window.setTimeout(() => {
      setIsCollapsing(true);
    }, AUTO_COLLAPSE_MS);
    return () => window.clearTimeout(id);
  }, [
    thread.length,
    isReplying,
    isCollapsing,
    threadCollapsed,
    isHovered,
    isFocused,
    inputValue,
    isListening,
    isTranscribing,
    pendingSwitch,
    pendingBundleSuggestion,
  ]);

  /* Defensive latch: if a collapse had already started and then a
   * pending switch proposal appears, re-open immediately so the CTA
   * never disappears before the shopper chooses an action. */
  useEffect(() => {
    if (!pendingSwitch) return;
    setIsCollapsing(false);
    setThreadCollapsed(false);
  }, [pendingSwitch]);

  /* Proactive bundle-suggestion prompts are appended from outside this
   * component (WingmanPlanPage after "Add to custom bundle"). If the
   * bar had already auto-collapsed, the new assistant message exists in
   * the thread store but would remain hidden behind `threadCollapsed`.
   * Re-open immediately whenever a pending bundle suggestion appears so
   * the shopper always sees the question + CTAs. */
  useEffect(() => {
    if (!pendingBundleSuggestion) return;
    setIsCollapsing(false);
    setThreadCollapsed(false);
  }, [pendingBundleSuggestion]);

  /* Stage two of the collapse — once `isCollapsing` flips on, the
   * thread block animates to `opacity: 0; max-height: 0` via CSS.
   * Wait for the animation to finish, then hide the bubbles via the
   * `threadCollapsed` flag.
   *
   * IMPORTANT: we do NOT call `clearThread()` here. The page's
   * `customCombo` is derived from the latest user message in the
   * store, and clearing the store would yank the Custom tab away
   * the moment the chat folded. Hiding via local state keeps the
   * data alive for the page while letting the bar return to its
   * resting input-only chrome. The explicit "Clear chat" button is
   * the only path that actually wipes the store. */
  useEffect(() => {
    if (!isCollapsing) return;
    const id = window.setTimeout(() => {
      setThreadCollapsed(true);
      setIsCollapsing(false);
    }, COLLAPSE_ANIMATION_MS);
    return () => window.clearTimeout(id);
  }, [isCollapsing]);

  useEffect(() => {
    if (!isListening) {
      setWaveJitter([1, 1, 1, 1, 1]);
      return;
    }
    const id = window.setInterval(() => {
      setWaveJitter([
        0.84 + Math.random() * 0.44,
        0.84 + Math.random() * 0.44,
        0.84 + Math.random() * 0.44,
        0.84 + Math.random() * 0.44,
        0.84 + Math.random() * 0.44,
      ]);
    }, 120);
    return () => window.clearInterval(id);
  }, [isListening]);

  const handleSubmit = useCallback(() => {
    const text = inputValue.trim();
    if (!text) return;

    /* A new send re-opens the thread display in case the previous
     * exchange had auto-collapsed away — the bubbles for the new
     * user message + assistant reply should be visible immediately. */
    setThreadCollapsed(false);
    setIsCollapsing(false);

    const contextCheck = guardChatContext(currentWingmanQuery, text);
    appendMessage("user", text);
    setInputValue("");

    if (isUndoRemoveCommand(text)) {
      clearPendingSwitchProposal();
      const lastRemoval = lastChatRemovalRef.current;
      const sameKit =
        lastRemoval &&
        lastRemoval.kitLabel.toLowerCase() === activeKitLabel.toLowerCase();
      let replyText = "";
      if (sameKit && lastRemoval.slugs.length > 0) {
        onRestoreInActiveKit(lastRemoval.slugs);
        replyText =
          lastRemoval.titles.length === 1
            ? `Done — I restored ${lastRemoval.titles[0]} to the ${activeKitLabel.toLowerCase()}.`
            : `Done — I restored ${lastRemoval.titles.join(", ")} to the ${activeKitLabel.toLowerCase()}.`;
        lastChatRemovalRef.current = null;
      } else {
        replyText = `I don't have a recent chat removal to undo in the ${activeKitLabel.toLowerCase()}.`;
      }
      setIsReplying(true);
      window.setTimeout(() => {
        appendMessage("assistant", replyText);
        setIsReplying(false);
      }, REPLY_DELAY_MS);
      return;
    }

    const removeIntent = resolveRemoveCommand(text, activeKitAccessories);
    if (removeIntent.isRemoveIntent) {
      clearPendingSwitchProposal();
      if (removeIntent.matched.length > 0) {
        onRemoveFromActiveKit(removeIntent.matched.map((item) => item.slug));
        lastChatRemovalRef.current = {
          kitLabel: activeKitLabel,
          slugs: removeIntent.matched.map((item) => item.slug),
          titles: removeIntent.matched.map((item) => item.title),
        };
      }
      const removedTitles = removeIntent.matched.map((item) => item.title);
      let replyText = "";
      if (removedTitles.length > 0) {
        replyText =
          removedTitles.length === 1
            ? `Done — I removed ${removedTitles[0]} from the ${activeKitLabel.toLowerCase()}.`
            : `Done — I removed ${removedTitles.join(", ")} from the ${activeKitLabel.toLowerCase()}.`;
      } else {
        replyText = `I couldn't find those items in the ${activeKitLabel.toLowerCase()}. Try the item name shown in the tile.`;
      }
      if (removeIntent.unmatched.length > 0) {
        replyText += ` I couldn't match: ${removeIntent.unmatched.join(", ")}.`;
      }
      setIsReplying(true);
      window.setTimeout(() => {
        appendMessage("assistant", replyText);
        setIsReplying(false);
      }, REPLY_DELAY_MS);
      return;
    }

    /* Contextual product Q&A. When the shopper has product(s) selected
     * and typed a question, answer it from catalog data instead of
     * steering the plan. A non-null answer short-circuits before the
     * context guard so a question never trips the "create a new plan?"
     * prompt. */
    const selectionAnswer = onAskAboutSelection?.(text);
    if (selectionAnswer) {
      clearPendingSwitchProposal();
      setIsReplying(true);
      window.setTimeout(() => {
        appendMessage("assistant", selectionAnswer);
        setIsReplying(false);
      }, REPLY_DELAY_MS);
      return;
    }

    if (contextCheck.kind === "switch_required") {
      const confirmMessage =
        "This sounds outside the current plan. Want me to create a new plan for it?";
      appendMessage("assistant", confirmMessage);
      setPendingSwitchProposal(text, contextCheck.reason, confirmMessage);
      setIsReplying(false);
      return;
    }

    clearPendingSwitchProposal();
    setSteeringPrompt(text);
    setIsReplying(true);

    /* Compose and append the stub assistant reply on a short delay so
     * the user → assistant cadence reads as a real exchange (instead
     * of both bubbles popping in on the same frame). The reply names
     * the same intent the chat-derived combo just steered the page
     * toward, so the spoken acknowledgement and the surfaced combo
     * tagline stay in sync. */
    const replyText = composeAssistantReply(text);
    window.setTimeout(() => {
      appendMessage("assistant", replyText);
      setIsReplying(false);
    }, REPLY_DELAY_MS);
  }, [
    inputValue,
    currentWingmanQuery,
    activeKitAccessories,
    activeKitLabel,
    onRemoveFromActiveKit,
    onRestoreInActiveKit,
    onAskAboutSelection,
  ]);

  const handleClearThread = useCallback(() => {
    /* Explicit "Clear chat" — wipe everything: thread, the in-flight
     * reply window, the auto-collapse latch, and the page's
     * customCombo (which the page recomputes from the now-empty
     * store on its next render). */
    clearThread();
    setIsReplying(false);
    setIsCollapsing(false);
    setThreadCollapsed(false);
  }, []);

  const handleCollapseToRestState = useCallback(() => {
    setIsCollapsing(false);
    setThreadCollapsed(true);
  }, []);

  const handleStayOnPage = useCallback(() => {
    clearPendingSwitchProposal();
  }, []);

  const handleCreateNewPlan = useCallback(() => {
    if (!pendingSwitch) return;
    const proposed = pendingSwitch.proposedQuery.trim();
    clearPendingSwitchProposal();
    if (!proposed) return;
    navigate(ROUTES.wingmanPlan, { wingmanQuery: proposed });
  }, [navigate, pendingSwitch]);

  const handleDeclineBundleSuggestion = useCallback(() => {
    clearPendingBundleSuggestion();
    onDeclineBundleSuggestions();
  }, [onDeclineBundleSuggestions]);

  const handleAcceptBundleSuggestion = useCallback(() => {
    if (!pendingBundleSuggestion) return;
    onAcceptBundleSuggestions(pendingBundleSuggestion.productSlug);
    clearPendingBundleSuggestion();
  }, [pendingBundleSuggestion, onAcceptBundleSuggestions]);

  /* Fire a selection Next Best Action. Reopen the thread first so the
   * question + answer the action appends are visible immediately even
   * if the previous exchange had auto-collapsed away. */
  const handleNbaClick = useCallback((item: WingmanNbaItem) => {
    setThreadCollapsed(false);
    setIsCollapsing(false);
    item.run();
  }, []);

  const handleMicClick = useCallback(() => {
    if (isListening) {
      speech.stop();
    } else if (isTranscribing) {
      /* Mid-Whisper-upload — clicking again is a no-op until it lands. */
      return;
    } else {
      speech.start();
    }
  }, [isListening, isTranscribing, speech]);

  /* Hide only when there's nothing to steer AND we're not docked. When a
   * panel registers a dock the agent should follow the shopper in even if
   * the underlying page bar would otherwise be suppressed. */
  const isDocked = dockElement != null;
  if (!visible && !isDocked) return null;

  /* Show bubbles only when there's a thread AND the auto-collapse
   * hasn't latched it shut. Sending a new message resets
   * `threadCollapsed` so the chat reopens for the next exchange. */
  const hasThread = thread.length > 0 && !threadCollapsed;
  const exchange = latestExchange(thread);
  /* The Figma "thread" state shows ONE exchange above the input. If
   * the assistant reply is still composing (the 400ms gap), surface
   * a thinking indicator in its slot instead of leaving the bubble
   * empty. */
  const showAssistantBubble = !!exchange.assistant || isReplying;

  /* Drive the outer chrome's appearance. `thread` wins over `active`
   * wins over `hover` wins over `rest`. Using a single `data-state`
   * attribute keeps the CSS rule list flat.
   *
   * Ticking a product checkbox surfaces selection pills above the
   * input; treat that as an implicit engagement so the bar lifts into
   * the solid-white `hover` chrome (matching the focus look) instead
   * of staying in the translucent resting state while pills sit on it. */
  const hasSelection = selectedProducts.length > 0;
  let visualState: "rest" | "hover" | "active" | "thread";
  if (hasThread) visualState = "thread";
  else if (isFocused) visualState = "active";
  else if (isHovered || hasSelection) visualState = "hover";
  else visualState = "rest";

  /* Suggested next actions (NBA chips) are an on-demand affordance: keep
   * them collapsed while the bar rests, and only reveal them once the
   * shopper engages the bar (hover, focus/click, an active selection, or
   * an open thread). Everything but the resting state counts as engaged. */
  const showNbas = nbas.length > 0 && visualState !== "rest";

  let micIcon: ReactNode;
  let micLabel: string;
  if (isTranscribing) {
    micIcon = (
      <LoaderCircle
        width={16}
        height={16}
        className="wingman-chat-bar__mic-spinner"
      />
    );
    micLabel = "Transcribing voice input";
  } else if (isListening) {
    micIcon = <Square width={14} height={14} fill="currentColor" />;
    micLabel = "Stop voice input";
  } else {
    micIcon = <Mic width={16} height={16} />;
    micLabel = speech.isSupported
      ? "Start voice input"
      : "Voice input unsupported in this browser";
  }

  /* When a selection exists, hint that the input is now contextual to
   * the picked product(s) so the shopper knows they can ask about them
   * in natural language. Falls back to the default prompt otherwise.
   *
   * When docked inside a details panel, the product on stage there wins
   * — the agent has followed the shopper's focus, so its prompt should
   * name exactly what they're looking at. */
  let contextualPlaceholder = PLACEHOLDER;
  if (isDocked && dockLabel) {
    contextualPlaceholder = `Ask me anything about ${dockLabel}\u2026`;
  } else if (selectedProducts.length === 1) {
    contextualPlaceholder = `Ask about ${selectedProducts[0].title}\u2026`;
  } else if (selectedProducts.length > 1) {
    contextualPlaceholder = `Ask about your ${selectedProducts.length} selected products\u2026`;
  }

  const sendDisabled = inputValue.trim().length === 0;
  const showVoiceWaveform = isListening;
  const clampedAudioLevel = Math.max(0, Math.min(1, speech.audioLevel));
  const waveformScale = 0.45 + clampedAudioLevel * 1.55;
  const waveformBaseProfile = [0.74, 0.58, 1.08, 0.9, 0.68];

  const content = (
    <>
      {/* Skip the full-viewport thread backdrop when docked inside a
       * panel — dimming the whole page (including the panel itself)
       * would fight the panel's own modal treatment. */}
      {hasThread && !isDocked ? (
        <div
          className={
            "wingman-chat-bar__backdrop" +
            (isCollapsing
              ? " wingman-chat-bar__backdrop--collapsing"
              : "")
          }
          aria-hidden="true"
        />
      ) : null}
      <aside
        className={
          "wingman-chat-bar" + (isDocked ? " wingman-chat-bar--docked" : "")
        }
        data-state={visualState}
        data-collapsing={isCollapsing ? "true" : undefined}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        aria-label="Wingman assistant chat"
      >
        {hasThread ? (
          <button
            type="button"
            className="wingman-chat-bar__dismiss"
            onClick={handleCollapseToRestState}
            aria-label="Collapse chat"
            title="Collapse chat"
          >
            <X width={14} height={14} />
          </button>
        ) : null}
        {hasThread ? (
          <div
            className={
              "wingman-chat-bar__thread" +
              (isCollapsing
                ? " wingman-chat-bar__thread--collapsing"
                : "")
            }
            role="log"
            aria-live="polite"
            aria-relevant="additions"
          >
            {/* Chat pattern: the shopper's question sits above the
             * assistant's answer (question first, reply below). */}
            {exchange.user ? (
              <div className="wingman-chat-bar__bubble-row wingman-chat-bar__bubble-row--user">
                <div
                  className="wingman-chat-bar__bubble wingman-chat-bar__bubble--user"
                >
                  <p className="wingman-chat-bar__bubble-text">
                    {exchange.user.text}
                  </p>
                </div>
              </div>
            ) : null}
            {showAssistantBubble ? (
              <div
                className="wingman-chat-bar__bubble wingman-chat-bar__bubble--assistant"
              >
                <span
                  className="wingman-chat-bar__bubble-icon"
                  aria-hidden="true"
                >
                  <Sparkle width={16} height={16} />
                </span>
                <p className="wingman-chat-bar__bubble-text">
                  {exchange.assistant ? (
                    exchange.assistant.text
                  ) : (
                    <span className="wingman-chat-bar__bubble-thinking">
                      <span className="wingman-chat-bar__bubble-dot" />
                      <span className="wingman-chat-bar__bubble-dot" />
                      <span className="wingman-chat-bar__bubble-dot" />
                    </span>
                  )}
                </p>
                {pendingSwitch ? (
                  <div className="wingman-chat-bar__confirm-actions">
                    <button
                      type="button"
                      className="wingman-chat-bar__confirm-button wingman-chat-bar__confirm-button--secondary"
                      onClick={handleStayOnPage}
                    >
                      Stay on this page
                    </button>
                    <button
                      type="button"
                      className="wingman-chat-bar__confirm-button wingman-chat-bar__confirm-button--primary"
                      onClick={handleCreateNewPlan}
                    >
                      Create new plan
                    </button>
                  </div>
                ) : null}
                {pendingBundleSuggestion ? (
                  <div className="wingman-chat-bar__confirm-actions">
                    <button
                      type="button"
                      className="wingman-chat-bar__confirm-button wingman-chat-bar__confirm-button--secondary"
                      onClick={handleDeclineBundleSuggestion}
                    >
                      I will add manually
                    </button>
                    <button
                      type="button"
                      className="wingman-chat-bar__confirm-button wingman-chat-bar__confirm-button--primary"
                      onClick={handleAcceptBundleSuggestion}
                    >
                      Yes
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
            <button
              type="button"
              className="wingman-chat-bar__clear"
              onClick={handleClearThread}
              aria-label="Clear chat"
            >
              Clear chat
            </button>
          </div>
        ) : null}

        {selectedProducts.length > 0 ? (
          <div
            className="wingman-chat-bar__pills"
            role="list"
            aria-label="Selected products"
          >
            {selectedProducts.map((product) => (
              <span
                key={product.slug}
                className="wingman-chat-bar__pill"
                role="listitem"
              >
                {product.imageUrl ? (
                  <img
                    className="wingman-chat-bar__pill-img"
                    src={product.imageUrl}
                    alt=""
                    aria-hidden="true"
                    loading="lazy"
                  />
                ) : (
                  <span
                    className="wingman-chat-bar__pill-img wingman-chat-bar__pill-img--placeholder"
                    aria-hidden="true"
                  />
                )}
                <span className="wingman-chat-bar__pill-name">
                  {product.title}
                </span>
                <button
                  type="button"
                  className="wingman-chat-bar__pill-remove"
                  onClick={() => removeSelection(product.slug)}
                  aria-label={`Remove ${product.title} from selection`}
                  title={`Remove ${product.title}`}
                >
                  <X width={14} height={14} strokeWidth={2.5} />
                </button>
              </span>
            ))}
            <button
              type="button"
              className="wingman-chat-bar__pill wingman-chat-bar__pill-clear"
              onClick={() => clearSelection()}
              aria-label="Clear all selected products"
              title="Clear all selections"
            >
              <Trash2 width={16} height={16} strokeWidth={2} aria-hidden="true" />
            </button>
          </div>
        ) : null}

        {showNbas ? (
          <div
            className="wingman-chat-bar__nba"
            role="group"
            aria-label="Suggested next actions"
          >
            {nbas.map((item) => (
              <button
                key={item.id}
                type="button"
                className="wingman-chat-bar__nba-chip"
                onClick={() => handleNbaClick(item)}
              >
                {item.label}
              </button>
            ))}
          </div>
        ) : null}

        <form
          ref={formRef}
          className="wingman-chat-bar__input"
          onSubmit={(event) => {
            event.preventDefault();
            handleSubmit();
          }}
          onMouseDown={(event) => {
            /* Click in the chrome around the textarea (icons row gap,
             * padding) refocuses the input — same affordance as the
             * landing hero pill. We only intercept clicks landed on
             * the form surface itself, not its children. */
            if (event.target === event.currentTarget) {
              event.preventDefault();
              inputRef.current?.focus();
            }
          }}
        >
          {/* Attachment affordance is hidden in the docked (panel) agent
           * to reduce clutter — only shown in the full viewport bar. */}
          {!isDocked ? (
            <button
              type="button"
              className="wingman-chat-bar__icon-button"
              aria-label="Add attachment"
              tabIndex={-1}
              disabled
              title="Attachments are not yet supported"
            >
              <Plus width={16} height={16} />
            </button>
          ) : null}

          <div className="wingman-chat-bar__textarea-wrap">
            <textarea
              ref={inputRef}
              className="wingman-chat-bar__textarea"
              placeholder={isListening ? "Listening\u2026" : contextualPlaceholder}
              aria-label="Message Wingman"
              value={inputValue}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
              onChange={(event) => setInputValue(event.target.value)}
              onKeyDown={(event) => {
                /* Enter submits, Shift+Enter inserts a newline — same
                 * cadence as ChatGPT / Slack / the Wingman landing
                 * input. Skip the keystroke during voice capture so
                 * a stray Enter doesn't truncate dictation. */
                if (
                  event.key === "Enter" &&
                  !event.shiftKey &&
                  !isListening &&
                  !isTranscribing
                ) {
                  event.preventDefault();
                  handleSubmit();
                }
                if (event.key === "Escape") {
                  setInputValue("");
                  inputRef.current?.blur();
                }
              }}
              readOnly={isListening || isTranscribing}
              rows={1}
            />
          </div>

          <button
            type="button"
            className="wingman-chat-bar__icon-button"
            onClick={handleMicClick}
            aria-label={micLabel}
            disabled={!speech.isSupported}
          >
            {micIcon}
          </button>

          <button
            type="submit"
            className="wingman-chat-bar__send"
            aria-label="Send message"
            disabled={sendDisabled || isListening || isTranscribing}
          >
            {showVoiceWaveform ? (
              <span className="wingman-chat-bar__voice-waveform" aria-hidden="true">
                <span
                  className="wingman-chat-bar__voice-waveform-bar"
                  style={{
                    transform: `scaleY(${waveformScale * waveformBaseProfile[0] * waveJitter[0]})`,
                  }}
                />
                <span
                  className="wingman-chat-bar__voice-waveform-bar"
                  style={{
                    transform: `scaleY(${waveformScale * waveformBaseProfile[1] * waveJitter[1]})`,
                  }}
                />
                <span
                  className="wingman-chat-bar__voice-waveform-bar"
                  style={{
                    transform: `scaleY(${waveformScale * waveformBaseProfile[2] * waveJitter[2]})`,
                  }}
                />
                <span
                  className="wingman-chat-bar__voice-waveform-bar"
                  style={{
                    transform: `scaleY(${waveformScale * waveformBaseProfile[3] * waveJitter[3]})`,
                  }}
                />
                <span
                  className="wingman-chat-bar__voice-waveform-bar"
                  style={{
                    transform: `scaleY(${waveformScale * waveformBaseProfile[4] * waveJitter[4]})`,
                  }}
                />
              </span>
            ) : (
              <ArrowRight width={16} height={16} />
            )}
          </button>
        </form>
      </aside>
    </>
  );

  /* Docked: render into the panel's dock node so the agent floats at the
   * bottom of the details panel. Otherwise render in place (fixed,
   * bottom-center of the viewport). */
  return isDocked ? createPortal(content, dockElement) : content;
}
