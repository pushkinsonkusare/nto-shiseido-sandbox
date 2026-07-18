/// <reference types="vite/client" />

declare module "*.csv?raw" {
  const content: string;
  export default content;
}

interface ImportMetaEnv {
  readonly VITE_OPENAI_API_KEY?: string;
  readonly VITE_OPENAI_MODEL?: string;
  /** Base URL of the LLM proxy worker (e.g. Cloudflare Workers).
   *  When set, the OpenAI SDK and direct fetch call sites route
   *  through `${VITE_LLM_PROXY_URL}/v1/...` and the worker injects
   *  the Authorization header server-side. Required for any public
   *  build (GitHub Pages) so the API key isn't shipped in the
   *  browser bundle. Leave unset for local dev with `.env.local`. */
  readonly VITE_LLM_PROXY_URL?: string;
  /** YouTube Data API v3 key used by the product reviews panel's
   *  "Videos" tab to search live review videos. Ships in the browser
   *  bundle, so restrict it by HTTP referrer in the Google Cloud
   *  console. When unset, the Videos tab shows a YouTube search link
   *  fallback instead of an embedded player. */
  readonly VITE_YOUTUBE_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/* ---------- Web Speech API ----------
 * Minimal ambient declarations — TypeScript's lib.dom.d.ts still doesn't
 * ship the SpeechRecognition surface (it's a Living Standard, not in DOM
 * Level 3). We only declare what `useSpeechRecognition.ts` actually
 * touches; if you need more callbacks (onaudiostart, onnomatch, etc.) add
 * them here rather than reaching for `any`. */

interface SpeechRecognitionAlternative {
  readonly transcript: string;
  readonly confidence: number;
}

interface SpeechRecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionResultList {
  readonly length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionEvent extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultList;
}

interface SpeechRecognitionErrorEvent extends Event {
  readonly error: string;
  readonly message: string;
}

interface SpeechRecognition extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}

interface SpeechRecognitionConstructor {
  new (): SpeechRecognition;
}

interface Window {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
}
