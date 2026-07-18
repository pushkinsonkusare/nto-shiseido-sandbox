import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ArrowRight,
  ArrowUpRight,
  LoaderCircle,
  Mic,
  Plus,
  Square,
} from "lucide-react";
import { ImmersiveHeader } from "../../components/ImmersiveHeader/ImmersiveHeader";
import { useCatalog } from "../../catalog/CatalogContext";
import { RefreshCcwIcon } from "../../components/icons/StorefrontIcons";
import { ROUTES, usePrototypeNavigation } from "../../prototypeRoutes";
import {
  FALLBACK_HERO_FILE,
  activityBannerUrl,
} from "../WingmanPlanPage/buildPlan";
import { useSpeechRecognition } from "./useSpeechRecognition";
import "./WingmanPage.css";

/**
 * Wingman landing page (immersive-mode-only). Mirrors Figma node 54:30501
 * in the "NBA-brainstorm" file (IGx0URqo5hp3azh5Hs8ZZM):
 *
 *   - Same .ImmersiveHeader on top
 *   - Hero card (32px-rounded, full-width within 32px page padding) with
 *     DJI brand mark, "Wingman" title + sparkle, intro copy, the
 *     conversational input, and a row of suggestion chips.
 *   - Three lifestyle topic cards stacked horizontally below.
 *
 * v1 is visual + navigational only — submitting the input, clicking a
 * suggestion chip, or clicking a topic card is a no-op for now (the
 * downstream conversational surface doesn't exist yet). Each interactive
 * surface still uses real <button>/<input> elements with proper
 * aria-labels so wiring the handlers later is a one-line change.
 *
 * Background imagery: hero reuses the existing storefront-cover.jpg
 * (src/assets/); the three topic cards use intentional CSS gradients
 * (ski / running / hiking palettes). Swap to commit-local lifestyle
 * photos in a follow-up turn.
 */

type TopicCard = {
  id: string;
  title: string;
  description: string;
  query: string;
  /** Filename inside `public/Dji_product_images/marketing-assets/activity-type/`.
   * Resolved at render time against `import.meta.env.BASE_URL` so the same
   * paths work in dev (root-served) and in the GitHub Pages build (served
   * under the configured base prefix).
   *
   * Folder names are hyphen-cased / lowercase on purpose: Vite's static
   * middleware was returning the SPA fallback for paths containing
   * URL-encoded spaces (`Marketing%20assets/Activity%20type/...`).
   * Keeping the folder names URL-safe avoids that whole class of bug
   * for any future asset dropped in here. Spaces inside *filenames*
   * are still fine because we URL-encode them per-segment below. */
  imageFile: string;
};

const ACTIVITY_TYPE_BASE = `${
  (import.meta.env.BASE_URL || "/").replace(/\/+$/, "")
}/Dji_product_images/marketing-assets/activity-type`;

const topicImageUrl = (file: string) =>
  `${ACTIVITY_TYPE_BASE}/${encodeURIComponent(file)}`;

/* Landscape banner (2880×1280, ≈2.25:1) shared with the Wingman plan
 * page as its default fallback hero. The wide aspect lets the hero
 * fill 1699×853 with almost no crop, and the woman + drone subject on
 * the right sits opposite the welcome copy + prompt card on the left. */
const WINGMAN_HERO_IMAGE = activityBannerUrl(FALLBACK_HERO_FILE);

/* Pool of suggestion cards. We show `TOPIC_VISIBLE_COUNT` at a time;
 * the regenerate chip ("Show different suggestions") rotates the window
 * by that count so each click surfaces a fresh trio. Once the window
 * wraps past the end of the pool the cycle restarts — at 9 entries and
 * a window of 3 the user sees three distinct, non-overlapping trios
 * before any card repeats.
 *
 * Ordering matters: the first three entries match the original static
 * trio so first paint is visually unchanged. New activities sit after
 * index 3 and only appear once the user opts into a refresh. */
const TOPIC_CARD_POOL: TopicCard[] = [
  {
    id: "mountain-biking",
    title: "Recommend gear for mountain biking",
    description: "Rugged gear to capture the trail",
    query: "Suggest gear for mountain biking",
    imageFile: "Mountain biking.jpeg",
  },
  {
    id: "yosemite",
    title: "What shall I pack for Yosemite?",
    description: "Ideal gear to capture hiking",
    query: "I am going to Yosemite next month. Suggest gear to help me make a movie",
    imageFile: "hiking.jpg",
  },
  {
    id: "lake-tahoe",
    title: "I'm going to Lake Tahoe, suggest gimbals",
    description: "Stabilized gear to record your journey",
    query: "I am going to Lake Tahoe, suggest gimbals",
    imageFile: "Ski.jpg",
  },
  {
    id: "scuba",
    title: "Help me film my next scuba dive",
    description: "Waterproof rigs built for deep blue",
    query: "I want to go scuba diving. Suggest me cameras.",
    imageFile: "Scuba.jpeg",
  },
  {
    id: "surfing",
    title: "Gear for chasing surf",
    description: "Rugged, waterproof capture for the lineup",
    query: "I want to go surfing. Suggest me waterproof cameras.",
    imageFile: "Surfing.jpg",
  },
  {
    id: "moto-vlog",
    title: "Plan my motorcycle road trip",
    description: "Stabilized vlog setups built for the saddle",
    query: "I want to start moto vlogging. Suggest me gear.",
    imageFile: "Moto Vlog.jpg",
  },
  {
    id: "filmmaking",
    title: "Recommend pro cinematic gear",
    description: "Cameras and lenses for short films",
    query: "I want to shoot cinematic films. Suggest me pro gear.",
    imageFile: "Film making.jpg",
  },
  {
    id: "fpv-drone",
    title: "Suggest an FPV drone for racing",
    description: "Cinewhoop and racing rigs for first-person shots",
    query: "Suggest an FPV drone for racing-style footage",
    imageFile: "FPV.jpg",
  },
  {
    id: "street-photo",
    title: "Compact gear for street photography",
    description: "Pocket-sized cameras for everyday shooting",
    query: "Suggest a compact camera for street photography",
    imageFile: "street photography.jpg",
  },
];
const TOPIC_VISIBLE_COUNT = 3;
/* Duration of the regenerate skeleton state (ms). Held at 2s so the
 * shimmer sweep makes a full pass across each card before the fresh
 * trio swaps in — long enough to read as "the assistant is generating
 * new suggestions" rather than a synchronous content flip. */
const REGENERATE_SHIMMER_MS = 2000;

const PROMPT_HINT_PATTERNS = [/^\s*i want\b/i, /^\s*suggest me\b/i, /^\s*can you suggest\b/i];
const PROMPT_HINT_LIMIT = 6;
const HEADER_SOLID_AT = 32;

/* Typewriter placeholder cycle. While the textarea is empty and not
 * mid-voice-capture, the placeholder types itself out one character at
 * a time, holds, deletes, and moves to the next prompt — a low-key
 * way to telegraph the breadth of asks Wingman can take without
 * cluttering the hero with a static list. First entry matches the
 * page's original static placeholder so first paint is unchanged.
 *
 * Timings (ms): TYPEWRITER_TYPE_MS per char while typing,
 * TYPEWRITER_DELETE_MS per char while deleting,
 * TYPEWRITER_HOLD_MS dwell once a prompt is fully typed,
 * TYPEWRITER_GAP_MS dwell once a prompt is fully deleted. */
const TYPEWRITER_PROMPTS = [
  "let me know about your adventure",
  "Plan my hiking trip to Yosemite",
  "What gear should I pack for scuba diving?",
  "Suggest a gimbal for my Lake Tahoe ski trip",
  "Help me start vlogging from scratch",
  "Recommend a drone for real-estate photography",
  "I want to capture my next motorcycle ride",
];
const TYPEWRITER_TYPE_MS = 55;
const TYPEWRITER_DELETE_MS = 24;
const TYPEWRITER_HOLD_MS = 2000;
const TYPEWRITER_GAP_MS = 350;
/* Pixels of scroll over which the hero image lags, blurs and dims.
 * Matches `HERO_PARALLAX_RANGE` on WingmanPlanPage so both surfaces
 * feel identical when shoppers move between them. */
const HERO_PARALLAX_RANGE = 600;
const ACTIVITY_HINTS: Array<{
  token: string;
  startsWith: string;
  prompt: string;
}> = [
  {
    token: "hiking_outdoor",
    startsWith: "hiking",
    prompt: "I want to go hiking. Suggest me gear.",
  },
  {
    token: "watersports",
    startsWith: "scuba",
    prompt: "I want to go scuba diving. Suggest me cameras.",
  },
  {
    token: "surfing",
    startsWith: "surf",
    prompt: "I want to go surfing. Suggest me waterproof cameras.",
  },
  {
    token: "skiing_snowboarding",
    startsWith: "ski",
    prompt: "I want to go skiing. Suggest me rugged gear.",
  },
  {
    token: "motorcycle",
    startsWith: "moto",
    prompt: "I want to start moto vlogging. Suggest me gear.",
  },
  {
    token: "travel",
    startsWith: "travel",
    prompt: "I want to travel light. Suggest me compact gear.",
  },
  {
    token: "podcast",
    startsWith: "podcast",
    prompt: "I want to start a podcast. Suggest me recording equipment.",
  },
  {
    token: "vlog",
    startsWith: "vlog",
    prompt: "I want to start vlogging. Suggest me beginner gear.",
  },
  {
    token: "real_estate_aerial",
    startsWith: "real",
    prompt: "I want to shoot real-estate videos. Suggest me drone gear.",
  },
  {
    token: "professional_filmmaker",
    startsWith: "film",
    prompt: "I want to shoot cinematic films. Suggest me pro gear.",
  },
];

export default function WingmanPage() {
  const { navigate } = usePrototypeNavigation();
  const { products } = useCatalog();
  /* Empty default so the input lands in its "rest" visual state on
   * first paint — empty textarea + placeholder + the blinking fake
   * caret rendered by `.wingman-page__input-textarea-wrap::before`.
   * The moment the user clicks (or types) the shell transitions
   * through select/focus → text-entry; see WingmanPage.css. */
  const [inputValue, setInputValue] = useState("");
  /* The CSS placeholder caret rendered by `.wingman-page__input-shell::before`
   * is a "first impression" accent — it suggests the field is hot before
   * the autofocus effect lands on the textarea. Once the textarea has
   * been focused even once, we permanently retire the fake caret: if the
   * user later clicks elsewhere in the hero, the textarea blurs but we
   * don't want a blinking caret reappearing on a field that isn't
   * actually accepting keystrokes (it reads as "ready to type" but isn't,
   * which is the bug it caused). The shell click handler below grabs
   * focus back on any click in the pill, so the user can re-engage with
   * a single click instead of having to bullseye the textarea. */
  const [hasFocusedOnce, setHasFocusedOnce] = useState(false);
  const [activePromptHintIndex, setActivePromptHintIndex] = useState(-1);
  const [isScrolled, setIsScrolled] = useState(false);
  /* Live placeholder string driven by the typewriter effect below.
   * Seeded with the first (fully-typed) prompt so first paint is
   * indistinguishable from the previous static placeholder. */
  const [typedPlaceholder, setTypedPlaceholder] = useState(TYPEWRITER_PROMPTS[0]);
  /* Waveform jitter for the send-button's listening indicator. Same
   * 5-bar randomized pattern the floating WingmanChatBar uses, so the
   * voice affordance reads identically across both surfaces. */
  const [waveJitter, setWaveJitter] = useState<number[]>([1, 1, 1, 1, 1]);
  /* Index into TOPIC_CARD_POOL marking the first visible card. Starts
   * at 0 so first paint shows the original trio; the regenerate chip
   * advances by TOPIC_VISIBLE_COUNT to surface a fresh window. */
  const [topicCardOffset, setTopicCardOffset] = useState(0);
  /* While true, the suggestion row renders a shimmer overlay and the
   * refresh icon spins so the swap reads as "the assistant is thinking
   * up a new trio" rather than a cheap synchronous rotation. The flag
   * is cleared on the same tick we apply the new offset. */
  const [isRegenerating, setIsRegenerating] = useState(false);
  /* Holds the pending regenerate timer so we can cancel it on unmount
   * and reject overlapping clicks without leaking a stale setTimeout. */
  const regenerateTimerRef = useRef<number | null>(null);
  const speech = useSpeechRecognition();
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const promptHintsListId = useId();

  /* Auto-grow the textarea to fit its content. Reset to "auto" first
   * so `scrollHeight` reflects the current content (not the previously
   * pinned height). The CSS `max-height` clamps very long inputs and
   * lets `overflow-y: auto` kick in for scroll. useLayoutEffect runs
   * synchronously after DOM updates so the user never sees a 1-line
   * flash before the resize. Re-runs on every value change including
   * speech-driven mirroring. */
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [inputValue]);

  /* Autofocus the prompt input on mount. Wingman home is a
   * search-first landing — a single primary action where the input
   * IS the page — so the industry convention (Google homepage,
   * ChatGPT new-chat, Spotlight, Raycast, Algolia DocSearch, Linear
   * cmd-K) is to land the real typing caret in the field so the
   * shopper can start typing or dictating immediately without an
   * explicit click.
   *
   * Autofocus also fixes a double-caret bug: this surface previously
   * rendered a fake blinking CSS caret in the rest state to signal
   * "ready to type", which could appear alongside the real browser
   * caret during the brief window where focus state and CSS
   * suppression rules raced each other. With autofocus, the real
   * browser caret is in place from first paint and there's only
   * ever one caret on the page — same affordance, zero possibility
   * of a phantom blink.
   *
   * `preventScroll: true` stops the browser from yanking the hero
   * upward on focus when the page first paints — without it, very
   * tall viewports occasionally jolt to align the input with the
   * top of the viewport and the hero copy ends up clipped above
   * the fold. */
  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
  }, []);

  /* Cancel any in-flight regenerate timer if the page unmounts mid-
   * shimmer. Without this, a navigation away during the ~850ms window
   * would fire setState on an unmounted component. */
  useEffect(
    () => () => {
      if (regenerateTimerRef.current !== null) {
        window.clearTimeout(regenerateTimerRef.current);
        regenerateTimerRef.current = null;
      }
    },
    [],
  );

  /* Track whether the user has scrolled past the initial threshold
   * so we can swap the immersive header from transparent (over the
   * hero band) to opaque white (over the page bg). The same listener
   * also writes a normalised 0..1 parallax progress to a CSS custom
   * property on the page root so the hero image can lag, blur and
   * dim purely from CSS (see WingmanPage.css). One passive listener,
   * rAF-batched, so scrolling stays buttery. Mirrors the equivalent
   * effect in WingmanPlanPage.tsx. */
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

  /* While the user is talking, mirror the live interim transcript into
   * the input so they can see their words type themselves out. We don't
   * overwrite manual edits made before listening started — `start()`
   * resets `interim` to "" so this only fires once a fresh session
   * produces text. */
  useEffect(() => {
    if (speech.state === "listening" && speech.interim) {
      setInputValue(speech.interim);
    }
  }, [speech.interim, speech.state]);

  /* When recognition finalizes (Whisper or Web Speech), commit the
   * higher-quality final transcript over whatever interim text was
   * mirrored in. The dedicated send button is already next to the
   * mic so the captured prompt is one click away from submission. */
  useEffect(() => {
    if (speech.finalTranscript) {
      setInputValue(speech.finalTranscript);
    }
  }, [speech.finalTranscript]);

  /* Drive the listening waveform on the send button. Mirrors
   * `WingmanChatBar.tsx`'s identical 120ms interval so the two
   * surfaces are visually indistinguishable mid-utterance. */
  useEffect(() => {
    if (speech.state !== "listening" && speech.state !== "requesting") {
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
  }, [speech.state]);

  const isListening = speech.state === "listening" || speech.state === "requesting";
  const isTranscribing = speech.state === "transcribing";

  /* Typewriter placeholder driver. Cycles `TYPEWRITER_PROMPTS` only
   * while the placeholder is actually visible — i.e. the textarea is
   * empty and we aren't mid-voice-capture (the voice states swap in
   * a "Listening…" / transcribing placeholder of their own).
   *
   * Phases: hold (full prompt visible) → deleting (chars peel off
   * tail-first) → gap (blank pause) → typing (chars stream back in)
   * → hold (next prompt). A single recursive setTimeout drives the
   * whole machine so timings stay tunable from one place and we
   * never queue overlapping timers.
   *
   * The effect resets on cancel and on dependency change, so leaving
   * listening / returning to an empty field always restarts from the
   * seed prompt — a predictable "fresh impression" rather than
   * resuming mid-deletion. */
  const isPlaceholderActive =
    inputValue.length === 0 && !isListening && !isTranscribing;
  useEffect(() => {
    if (!isPlaceholderActive) return;
    let cancelled = false;
    let promptIndex = 0;
    let charIndex = TYPEWRITER_PROMPTS[0].length;
    let phase: "hold" | "deleting" | "gap" | "typing" = "hold";
    let timeoutId = 0;
    setTypedPlaceholder(TYPEWRITER_PROMPTS[0]);

    const tick = () => {
      if (cancelled) return;
      let delay = TYPEWRITER_TYPE_MS;
      if (phase === "hold") {
        phase = "deleting";
        delay = TYPEWRITER_HOLD_MS;
      } else if (phase === "deleting") {
        charIndex = Math.max(0, charIndex - 1);
        setTypedPlaceholder(TYPEWRITER_PROMPTS[promptIndex].slice(0, charIndex));
        if (charIndex === 0) {
          promptIndex = (promptIndex + 1) % TYPEWRITER_PROMPTS.length;
          phase = "gap";
          delay = TYPEWRITER_GAP_MS;
        } else {
          delay = TYPEWRITER_DELETE_MS;
        }
      } else if (phase === "gap") {
        phase = "typing";
        delay = TYPEWRITER_TYPE_MS;
      } else {
        const next = TYPEWRITER_PROMPTS[promptIndex];
        charIndex = Math.min(next.length, charIndex + 1);
        setTypedPlaceholder(next.slice(0, charIndex));
        if (charIndex === next.length) {
          phase = "hold";
          delay = TYPEWRITER_HOLD_MS;
        } else {
          delay = TYPEWRITER_TYPE_MS;
        }
      }
      timeoutId = window.setTimeout(tick, delay);
    };

    timeoutId = window.setTimeout(tick, TYPEWRITER_HOLD_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [isPlaceholderActive]);

  const showPromptHints = PROMPT_HINT_PATTERNS.some((pattern) =>
    pattern.test(inputValue),
  );
  const inputTail = inputValue
    .replace(/^\s*i want(?: to)?\s*/i, "")
    .replace(/^\s*suggest me\s*/i, "")
    .replace(/^\s*can you suggest\s*/i, "")
    .trim()
    .toLowerCase();
  const catalogActivitySet = new Set(
    products.flatMap((product) => product.primaryActivities),
  );
  const promptHints = ACTIVITY_HINTS.filter((item) => catalogActivitySet.has(item.token))
    .filter((item) =>
      inputTail ? item.prompt.toLowerCase().includes(inputTail) : true,
    )
    .sort((a, b) => {
      const aStarts = inputTail && a.startsWith.startsWith(inputTail) ? 1 : 0;
      const bStarts = inputTail && b.startsWith.startsWith(inputTail) ? 1 : 0;
      return bStarts - aStarts;
    })
    .slice(0, PROMPT_HINT_LIMIT)
    .map((item) => item.prompt);

  useEffect(() => {
    if (!showPromptHints || promptHints.length === 0) {
      setActivePromptHintIndex(-1);
      return;
    }
    setActivePromptHintIndex((prev) => {
      if (prev < 0) return -1;
      return Math.min(prev, promptHints.length - 1);
    });
  }, [showPromptHints, promptHints.length]);

  /* Submit flow: any non-empty prompt navigates to the Wingman plan
   * page. The plan page reads `?q=<text>` and runs `buildPlan` against
   * the catalog. We reset the local input state on the way out so a
   * back-navigation lands in a clean state, identical to how a real
   * chat input behaves after sending. */
  const handleSubmit = () => {
    const trimmed = inputValue.trim();
    setInputValue("");
    if (!trimmed) return;
    navigate(ROUTES.wingmanPlan, { wingmanQuery: trimmed });
  };
  /* Suggestion chip click ships the canned prompt straight into the
   * plan page rather than just pre-filling the input — matches the
   * "click and go" affordance shoppers expect from quick-reply chips. */
  const handleSuggestion = (prompt: string) => {
    setInputValue(prompt);
    navigate(ROUTES.wingmanPlan, { wingmanQuery: prompt });
  };
  /* Rotate the visible suggestion window by TOPIC_VISIBLE_COUNT so the
   * user sees a fully fresh trio on each click. The modulo wraps the
   * offset once it reaches the end of the pool so the chip always has
   * something new to show.
   *
   * Wrapped in a brief (REGENERATE_SHIMMER_MS) shimmer delay: while the
   * flag is up, the chips dim + sweep and the refresh icon spins, so
   * the rotation reads as the assistant generating fresh prompts rather
   * than an instant content swap. Overlapping clicks are ignored — the
   * effect fires once per cycle. */
  const handleRegenerate = () => {
    if (isRegenerating) return;
    setIsRegenerating(true);
    if (regenerateTimerRef.current !== null) {
      window.clearTimeout(regenerateTimerRef.current);
    }
    regenerateTimerRef.current = window.setTimeout(() => {
      setTopicCardOffset(
        (prev) => (prev + TOPIC_VISIBLE_COUNT) % TOPIC_CARD_POOL.length,
      );
      setIsRegenerating(false);
      regenerateTimerRef.current = null;
    }, REGENERATE_SHIMMER_MS);
  };
  /* Visible suggestion slice: 3 cards starting at `topicCardOffset`,
   * wrapping around the end of the pool so the window never goes empty
   * even if `TOPIC_CARD_POOL.length` isn't a multiple of the window
   * size. */
  const visibleTopicCards: TopicCard[] = [];
  for (let i = 0; i < TOPIC_VISIBLE_COUNT; i += 1) {
    visibleTopicCards.push(
      TOPIC_CARD_POOL[(topicCardOffset + i) % TOPIC_CARD_POOL.length],
    );
  }
  const handleTopicCard = (query: string) => {
    const seed = query.trim();
    if (!seed) return;
    navigate(ROUTES.wingmanPlan, { wingmanQuery: seed });
  };

  /* Mic button is now purely a voice-capture toggle — submission has
   * its own dedicated send button to the right of it. Matches the
   * floating WingmanChatBar's two-button input strip exactly. */
  const handleMicClick = () => {
    if (isListening) {
      speech.stop();
    } else if (isTranscribing) {
      /* Mid-Whisper-upload — let it finish; clicking again is a no-op. */
      return;
    } else {
      speech.start();
    }
  };

  let micLabel: string;
  if (isListening) micLabel = "Stop voice input";
  else if (isTranscribing) micLabel = "Transcribing\u2026";
  else if (!speech.isSupported)
    micLabel = "Voice input unsupported in this browser";
  else micLabel = "Start voice input";

  let micIcon: ReactNode;
  if (isTranscribing) {
    micIcon = (
      <LoaderCircle
        width={16}
        height={16}
        className="wingman-page__input-mic-spinner"
      />
    );
  } else if (isListening) {
    /* Filled square communicates "tap to stop" — matches the universal
     * recording-stop affordance used by voice memos / call apps. */
    micIcon = <Square width={14} height={14} fill="currentColor" />;
  } else {
    micIcon = <Mic width={16} height={16} />;
  }

  const sendDisabled = inputValue.trim().length === 0;
  const showVoiceWaveform = isListening;
  const clampedAudioLevel = Math.max(0, Math.min(1, speech.audioLevel));
  const waveformScale = 0.45 + clampedAudioLevel * 1.55;
  const waveformBaseProfile = [0.74, 0.58, 1.08, 0.9, 0.68];

  return (
    <div
      ref={rootRef}
      className={"wingman-page" + (isScrolled ? " wingman-page--scrolled" : "")}
    >
      <ImmersiveHeader />

      <main className="wingman-page__main">
        <section
          className="wingman-page__hero"
          aria-label="Wingman assistant intro"
        >
          <div className="wingman-page__hero-art" aria-hidden="true">
            <img src={WINGMAN_HERO_IMAGE} alt="" loading="eager" />
          </div>

          <div className="wingman-page__hero-content">
            <div className="wingman-page__hero-intro">
              <h1 className="wingman-page__hero-title">
                <span>Welcome to Wingman</span>
                <span>Pushkin.</span>
              </h1>
              <p className="wingman-page__hero-copy">
                Meet your new DJI Wingman. Tell Wingman about your goal, your
                next adventure and it will equip you with all the gear you need.
              </p>
            </div>

            <div className="wingman-page__prompt">
              <div className="wingman-page__prompt-ask">
                <h2 className="wingman-page__prompt-title">Tell me about your next adventure</h2>
                <div className="wingman-page__input-stack">
                <form
                  className={
                    "wingman-page__input-shell" +
                    (hasFocusedOnce ? " wingman-page__input-shell--touched" : "")
                  }
                  onMouseDown={(event) => {
                    /* Click on the pill chrome (padding, gap between icon
                     * buttons) refocuses the textarea so the user never
                     * has to bullseye the textarea itself to start typing.
                     * We only intercept clicks that landed directly on the
                     * form surface — clicks on a child (textarea, mic,
                     * send) already have correct default behavior. */
                    if (event.target === event.currentTarget) {
                      event.preventDefault();
                      inputRef.current?.focus();
                    }
                  }}
                  onSubmit={(event) => {
                    event.preventDefault();
                    handleSubmit();
                  }}
                >
                  <div className="wingman-page__input-textarea-wrap">
                  <textarea
                    ref={inputRef}
                    className="wingman-page__input"
                    placeholder={
                      isListening ? "Listening\u2026" : typedPlaceholder
                    }
                    aria-label="Tell Wingman what you dream of"
                    value={inputValue}
                    onFocus={() => setHasFocusedOnce(true)}
                    onChange={(event) => {
                      setInputValue(event.target.value);
                    }}
                    onKeyDown={(event) => {
                    if (showPromptHints && promptHints.length > 0) {
                      if (event.key === "ArrowDown") {
                        event.preventDefault();
                        setActivePromptHintIndex((prev) =>
                          prev < 0 ? 0 : (prev + 1) % promptHints.length,
                        );
                        return;
                      }
                      if (event.key === "ArrowUp") {
                        event.preventDefault();
                        setActivePromptHintIndex((prev) =>
                          prev < 0
                            ? promptHints.length - 1
                            : (prev - 1 + promptHints.length) % promptHints.length,
                        );
                        return;
                      }
                      if (
                        event.key === "Enter" &&
                        !event.shiftKey &&
                        activePromptHintIndex >= 0
                      ) {
                        event.preventDefault();
                        handleSuggestion(promptHints[activePromptHintIndex]);
                        return;
                      }
                      if (event.key === "Escape" && activePromptHintIndex >= 0) {
                        event.preventDefault();
                        setActivePromptHintIndex(-1);
                        return;
                      }
                    }
                    /* Chat-input convention: Enter submits, Shift+Enter
                     * inserts a newline. Don't intercept while speech
                     * recognition is mid-flight — the field is readOnly
                     * during that window so the user can't type anyway,
                     * but explicit guard keeps intent clear. */
                    if (
                      event.key === "Enter" &&
                      !event.shiftKey &&
                      !isListening &&
                      !isTranscribing
                    ) {
                      event.preventDefault();
                      handleSubmit();
                    }
                    }}
                    readOnly={isListening || isTranscribing}
                    rows={1}
                    aria-expanded={showPromptHints && promptHints.length > 0}
                    aria-controls={promptHintsListId}
                    aria-activedescendant={
                      showPromptHints &&
                      activePromptHintIndex >= 0 &&
                      promptHints[activePromptHintIndex]
                        ? `${promptHintsListId}-option-${activePromptHintIndex}`
                        : undefined
                    }
                  />
                  </div>

                  <div className="wingman-page__input-toolbar">
                  <button
                    type="button"
                    className="wingman-page__input-icon-button"
                    aria-label="Add attachment"
                    tabIndex={-1}
                    disabled
                    title="Attachments are not yet supported"
                  >
                    <Plus width={16} height={16} />
                  </button>

                  <div className="wingman-page__input-toolbar-trailing">
                  <button
                    type="button"
                    className="wingman-page__input-icon-button"
                    onClick={handleMicClick}
                    aria-label={micLabel}
                    aria-pressed={isListening}
                    title={micLabel}
                    disabled={!speech.isSupported}
                  >
                    {micIcon}
                  </button>

                  <button
                    type="submit"
                    className="wingman-page__input-send"
                    aria-label="Send message"
                    disabled={sendDisabled || isListening || isTranscribing}
                  >
                    {showVoiceWaveform ? (
                      <span
                        className="wingman-page__input-voice-waveform"
                        aria-hidden="true"
                      >
                        <span
                          className="wingman-page__input-voice-waveform-bar"
                          style={{
                            transform: `scaleY(${waveformScale * waveformBaseProfile[0] * waveJitter[0]})`,
                          }}
                        />
                        <span
                          className="wingman-page__input-voice-waveform-bar"
                          style={{
                            transform: `scaleY(${waveformScale * waveformBaseProfile[1] * waveJitter[1]})`,
                          }}
                        />
                        <span
                          className="wingman-page__input-voice-waveform-bar"
                          style={{
                            transform: `scaleY(${waveformScale * waveformBaseProfile[2] * waveJitter[2]})`,
                          }}
                        />
                        <span
                          className="wingman-page__input-voice-waveform-bar"
                          style={{
                            transform: `scaleY(${waveformScale * waveformBaseProfile[3] * waveJitter[3]})`,
                          }}
                        />
                        <span
                          className="wingman-page__input-voice-waveform-bar"
                          style={{
                            transform: `scaleY(${waveformScale * waveformBaseProfile[4] * waveJitter[4]})`,
                          }}
                        />
                      </span>
                    ) : (
                      <ArrowRight width={16} height={16} />
                    )}
                  </button>
                  </div>
                  </div>
                </form>

                {showPromptHints && promptHints.length > 0 ? (
                  <div
                    className="wingman-page__prompt-hints"
                    role="listbox"
                    aria-label="Prompt suggestions"
                    id={promptHintsListId}
                  >
                    {promptHints.map((hint, index) => (
                      <button
                        key={hint}
                        type="button"
                        className={
                          "wingman-page__prompt-hint" +
                          (index === activePromptHintIndex
                            ? " wingman-page__prompt-hint--active"
                            : "")
                        }
                        onClick={() => handleSuggestion(hint)}
                        id={`${promptHintsListId}-option-${index}`}
                        role="option"
                        aria-selected={index === activePromptHintIndex}
                        onMouseEnter={() => setActivePromptHintIndex(index)}
                      >
                        {hint}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              </div>

              {speech.error && (
                <p
                  className="wingman-page__prompt-error"
                  role="alert"
                  aria-live="polite"
                >
                  {speech.error}
                </p>
              )}

              <div className="wingman-page__continue">
                {/* `__continue-header` defaults to `display: contents`
                  * so it doesn't introduce a layout box on desktop —
                  * the title stays a direct flex child of `.__continue`
                  * and the new regenerate button is hidden via CSS.
                  * On mobile (container query) the wrapper switches to
                  * a real flex row so title + regen icon sit side-by
                  * side, and the original chip-row regenerate is
                  * hidden. */}
                <div className="wingman-page__continue-header">
                  <p className="wingman-page__continue-title">
                    Continue your search
                  </p>
                  <button
                    type="button"
                    className="wingman-page__continue-regenerate"
                    onClick={handleRegenerate}
                    aria-label="Show different suggestions"
                    aria-busy={isRegenerating}
                    disabled={isRegenerating}
                  >
                    <RefreshCcwIcon width={16} height={16} />
                  </button>
                </div>
                <div
                  className="wingman-page__chips"
                  role="group"
                  aria-label="Suggested prompts"
                  aria-busy={isRegenerating}
                >
                  {visibleTopicCards.map((card) => (
                    <button
                      key={card.id}
                      type="button"
                      className={`wingman-page__search-chip${
                        isRegenerating
                          ? " wingman-page__search-chip--loading"
                          : ""
                      }`}
                      onClick={() => handleTopicCard(card.query)}
                      aria-label={card.title}
                      disabled={isRegenerating}
                    >
                      {isRegenerating ? (
                        <>
                          {/* Grey skeleton tokens stand in for the
                           * image + 2-line title + 1-line description
                           * while a fresh trio is "being generated".
                           * Hidden from AT — the button's aria-label
                           * keeps screen-reader meaning stable. */}
                          <span
                            className="wingman-page__search-chip-skeleton-image"
                            aria-hidden="true"
                          />
                          <span className="wingman-page__search-chip-body">
                            <span
                              className="wingman-page__search-chip-skeleton wingman-page__search-chip-skeleton--title"
                              aria-hidden="true"
                            />
                            <span
                              className="wingman-page__search-chip-skeleton wingman-page__search-chip-skeleton--title-2"
                              aria-hidden="true"
                            />
                            <span
                              className="wingman-page__search-chip-skeleton wingman-page__search-chip-skeleton--copy"
                              aria-hidden="true"
                            />
                          </span>
                        </>
                      ) : (
                        <>
                          <img
                            className="wingman-page__search-chip-image"
                            src={topicImageUrl(card.imageFile)}
                            alt=""
                            loading="lazy"
                          />
                          <span className="wingman-page__search-chip-body">
                            <span className="wingman-page__search-chip-label">
                              {card.title}
                            </span>
                            <span className="wingman-page__search-chip-copy">
                              {card.description}
                            </span>
                          </span>
                        </>
                      )}
                      <span
                        className="wingman-page__search-chip-icon"
                        aria-hidden="true"
                      >
                        <ArrowUpRight width={12} height={12} />
                      </span>
                    </button>
                  ))}
                  <button
                    type="button"
                    className={`wingman-page__chip wingman-page__chip--regenerate${
                      isRegenerating ? " is-regenerating" : ""
                    }`}
                    onClick={handleRegenerate}
                    aria-label="Show different suggestions"
                    aria-busy={isRegenerating}
                    disabled={isRegenerating}
                  >
                    <RefreshCcwIcon width={20} height={20} />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
