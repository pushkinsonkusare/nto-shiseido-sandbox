import OpenAI from "openai";

/* =============================================================
 * Shared OpenAI client factory.
 *
 * Two operating modes, decided at build time by Vite-inlined env:
 *
 *   1. Proxy mode  — `VITE_LLM_PROXY_URL` set. Requests go to a
 *      backend worker (Cloudflare Workers, etc.) that injects the
 *      real `Authorization: Bearer …` header server-side. The
 *      browser bundle never sees the secret. This is the only
 *      safe configuration for a public deploy (e.g. GitHub Pages).
 *
 *   2. Direct mode — `VITE_OPENAI_API_KEY` set, no proxy. The SDK
 *      hits api.openai.com from the browser with the key inlined
 *      in the bundle. Acceptable for local dev with a personal
 *      key in `.env.local`; NEVER use for a public build.
 *
 * If neither env var is set, every LLM call site short-circuits
 * to its heuristic fallback via `isLlmConfigured()`.
 * ============================================================= */

const PROXY_URL = (import.meta.env.VITE_LLM_PROXY_URL ?? "").trim();
const API_KEY = (import.meta.env.VITE_OPENAI_API_KEY ?? "").trim();
const MODEL = (import.meta.env.VITE_OPENAI_MODEL ?? "").trim() || "gpt-4o-mini";

/* Proxy mode requires SOMETHING in `apiKey` because the OpenAI SDK
 * refuses to construct without it, but the value is unused — the
 * Worker overwrites the Authorization header. */
const PROXY_API_KEY_PLACEHOLDER = "proxied-no-browser-key";

let clientSingleton: OpenAI | null = null;

function buildBaseURL(): string | undefined {
  if (!PROXY_URL) return undefined;
  // Strip trailing slashes so we don't end up with `…//v1/chat/completions`.
  return `${PROXY_URL.replace(/\/+$/, "")}/v1`;
}

/** Lazily-instantiated SDK singleton. Returns `null` when neither
 *  `VITE_LLM_PROXY_URL` nor `VITE_OPENAI_API_KEY` is configured.
 *  Callers MUST handle the null case (silently fall back to the
 *  heuristic). */
export function getOpenAIClient(): OpenAI | null {
  if (!isLlmConfigured()) return null;
  if (clientSingleton == null) {
    clientSingleton = new OpenAI({
      apiKey: PROXY_URL ? PROXY_API_KEY_PLACEHOLDER : API_KEY,
      baseURL: buildBaseURL(),
      // Required even in proxy mode — the SDK guards this flag.
      dangerouslyAllowBrowser: true,
    });
  }
  return clientSingleton;
}

/** Is any LLM backend configured (proxy OR direct key)? */
export function isLlmConfigured(): boolean {
  return Boolean(PROXY_URL || API_KEY);
}

/** Default chat model. Override per-call by passing `model` to the
 *  SDK if needed. */
export function getOpenAIModel(): string {
  return MODEL;
}

/** Whether the current build is talking to a backend proxy
 *  (vs. hitting the OpenAI API directly from the browser). Useful
 *  for diagnostics / dev banners — most call sites should not need
 *  this. */
export function isUsingProxy(): boolean {
  return Boolean(PROXY_URL);
}
