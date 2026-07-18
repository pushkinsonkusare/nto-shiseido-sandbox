import {
  getOpenAIClient,
  getOpenAIModel,
  isLlmConfigured,
} from "../../lib/openaiClient";

/* =============================================================
 * LLM upgrade for the WingmanPlanPage hero headline.
 *
 * One-shot OpenAI call that converts a free-text shopper query
 * (e.g. "i am going camping, what do you suggest") into a punchy
 * 2-5 word hero headline (e.g. "equipment for camping"). The page
 * keeps showing the synchronous heuristic from `shortenQuery()`
 * while this resolves; on success the caller cross-fades to the
 * LLM result. On any failure the heuristic remains visible so the
 * shopper never sees an error.
 *
 * Design notes (mirrors `assistantSuggestionsLLM.ts`):
 *   - Backend selection (proxy vs direct key) is centralized in
 *     `lib/openaiClient`. Returns `null` when nothing is
 *     configured so the caller silently keeps the heuristic.
 *   - Per-query in-memory cache. A repeated query inside the
 *     same session never re-fires the network request.
 *   - Cancellable via AbortSignal — caller passes a signal that
 *     gets aborted on query change or unmount, so a stale
 *     response can't overwrite fresh state.
 *   - On any error (network, parse, schema, abort) returns
 *     `null`; never throws into the caller's render path.
 *   - Output is validated: non-empty, <= 6 words, no quote chars,
 *     no trailing punctuation. Anything else returns `null`.
 * ============================================================= */

/** In-memory cache scoped to the page session. Key is the lower-
 *  cased trimmed query so casing variations share a result. */
const cache = new Map<string, string>();

const SYSTEM_PROMPT = [
  "You convert a shopper's free-text query into a short hero headline for a gear shopping page.",
  "",
  "FORMAT (strict): a SINGLE noun phrase of 2-5 words, lowercase except proper nouns and product names.",
  '  Template: "{modifier} {thing} for {activity}" where {thing} is a generic shopping noun (equipment, gear, kit, tech).',
  "  - {modifier} is optional. Use it ONLY for explicit skill levels (beginner, pro, intermediate, advanced).",
  "  - {activity} should be a concrete activity or hobby — distill it from the query, don't echo place/time noise.",
  "",
  "HARD RULES:",
  "- Output EXACTLY ONE noun phrase. No sentences, no punctuation INSIDE the phrase, no period at the end.",
  '- Drop conversational and contextual filler: "i want / i need / help me / can you / what should i / im going to / next month / for my trip / to document".',
  "- Drop generic time references (\"next month\", \"in december\", \"this weekend\").",
  "- KEEP place names when they add meaningful context to the activity. Treat 'yosemite hike', 'iceland photography', 'alps moto', 'tokyo street photography' as one activity phrase. Capitalize proper nouns (Yosemite, Iceland, Tokyo, Alps).",
  "- NEVER include words like 'suggest', 'pack', 'should', 'recommend', 'help' — these are signs you're echoing the query instead of distilling it.",
  "- Output ONLY the headline. No quotes, no preamble, no markdown, no labels.",
  "",
  "Examples:",
  "shopper: i am going camping, what do you suggest",
  "headline: equipment for camping",
  "",
  "shopper: i am a beginner camera tech enthusiast going camping",
  "headline: beginner tech for camping",
  "",
  "shopper: what's the best drone for travel vlogging",
  "headline: kit for travel vlogging",
  "",
  "shopper: help me start drone photography",
  "headline: gear for drone photography",
  "",
  "shopper: i need a pro setup for wedding videography",
  "headline: pro kit for wedding videography",
  "",
  "shopper: im going to yosemite next month, what gear should i pack in my hiking backpack to document the trip",
  "headline: gear for yosemite hike",
  "",
  "shopper: heading to iceland in december with my partner, want to film the northern lights",
  "headline: kit for northern lights",
  "",
  "shopper: i'm a beginner and want to vlog while riding my motorcycle through the alps",
  "headline: beginner gear for moto vlogging",
].join("\n");

/* Tokens that signal the model echoed the query rather than
 * distilling it (the prompt explicitly forbids them). Any of these
 * appearing as a standalone word makes the result invalid.
 * Words like "trip" or "year" are deliberately NOT in the list
 * because they appear in legitimate headlines ("kit for road trip",
 * "best of the year"). */
const FORBIDDEN_FILLER_TOKENS = new Set([
  "suggest",
  "suggestions",
  "recommend",
  "recommendations",
  "pack",
  "packing",
  "should",
  "help",
  "please",
  "next",
  "month",
  "week",
  "document",
]);

/** Strict-but-tolerant validation on the model's response. We bias
 *  toward returning `null` (and letting the heuristic stand) rather
 *  than rendering something weird. */
function sanitize(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let text = raw.trim();
  if (!text) return null;

  // Strip a leading "headline:" label if the model echoes the example
  // format. Cheap to do; saves a re-prompt.
  text = text.replace(/^headline\s*:\s*/i, "").trim();

  // Drop wrapping quotes / backticks / asterisks if present.
  text = text.replace(/^[`"'*_]+/, "").replace(/[`"'*_]+$/, "").trim();

  // Reject any internal quote characters — implies the model went off
  // script and we'd render something janky.
  if (/["'`]/.test(text)) return null;

  // Strip trailing terminal punctuation that the prompt forbids but
  // models occasionally append anyway.
  text = text.replace(/[.!?,;:]+$/g, "").trim();

  if (!text) return null;

  /* INTERNAL sentence-ending punctuation = the model returned a
   * multi-clause sentence instead of a single noun phrase. The
   * trailing-punct strip above already removed end-of-string
   * `.!?`, so anything remaining is necessarily internal. Reject
   * outright (heuristic fallback is far safer than rendering
   * something like "Yosemite next month. Suggest gear to pack"). */
  if (/[.!?]/.test(text)) {
    return null;
  }

  // Word-count bound. Six is generous for the "{modifier} {thing}
  // for {activity}" template.
  const words = text.split(/\s+/);
  const wordCount = words.length;
  if (wordCount === 0 || wordCount > 6) return null;

  /* Echo-detection: any forbidden filler token (case-insensitive,
   * standalone word) means the model parroted the user's query. The
   * heuristic fallback is more useful than a half-distilled headline. */
  const lowerWords = words.map((w) => w.toLowerCase().replace(/[^a-z]/g, ""));
  for (const w of lowerWords) {
    if (FORBIDDEN_FILLER_TOKENS.has(w)) return null;
  }

  // Hard length cap as a second line of defense against runaway output.
  if (text.length > 64) return null;

  return text;
}

/**
 * Fetch an LLM-generated hero headline for the given shopper query.
 *
 * @returns Lower-cased headline phrase on success (caller is expected
 *          to capitalize the first letter for display), or `null`
 *          when no API key is configured / the request was aborted /
 *          the response failed validation. Caller should keep the
 *          heuristic fallback visible in the null case.
 */
export async function generateHeadline(
  query: string,
  signal: AbortSignal,
): Promise<string | null> {
  const trimmed = query.trim();
  if (!trimmed) return null;
  const client = getOpenAIClient();
  if (!client) return null;

  const cacheKey = trimmed.toLowerCase();
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  if (signal.aborted) return null;

  try {
    const response = await client.chat.completions.create(
      {
        model: getOpenAIModel(),
        // Low temperature — we want consistent, on-template phrasing.
        temperature: 0.2,
        // Headlines are tiny; cap the budget so a runaway response
        // can't burn tokens.
        max_tokens: 24,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: `shopper: ${trimmed}\nheadline:` },
        ],
      },
      { signal },
    );

    if (signal.aborted) return null;

    const headline = sanitize(response.choices[0]?.message?.content);
    if (!headline) return null;

    cache.set(cacheKey, headline);
    return headline;
  } catch (error) {
    // Abort errors are expected on every query change — don't pollute
    // the console. Log other failures once for debug parity with the
    // existing OpenAI integrations.
    if (
      error &&
      typeof error === "object" &&
      "name" in error &&
      (error as { name?: string }).name === "AbortError"
    ) {
      return null;
    }
    // eslint-disable-next-line no-console
    console.warn("[headlineLLM] fetch failed", error);
    return null;
  }
}

/** Whether an LLM backend is configured — caller can short-circuit
 *  the effect entirely when this is false. */
export function isHeadlineLlmAvailable(): boolean {
  return isLlmConfigured();
}
