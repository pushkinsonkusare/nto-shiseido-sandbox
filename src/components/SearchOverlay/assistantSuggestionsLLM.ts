import {
  getOpenAIClient,
  getOpenAIModel,
  isLlmConfigured,
} from "../../lib/openaiClient";
import type { CatalogProduct } from "../../catalog/catalog";
import { isBundleTrippingPhrase } from "./assistantSuggestions";

/* =============================================================
 * LLM upgrade for the "Search with assistant" section.
 *
 * One-shot OpenAI call that takes the shopper's query plus the
 * top matched products' metadata and returns 3-4 short
 * conversational prompts the shopper might want to ask the
 * assistant. Output replaces the rule-based phrases that were
 * rendered instantly so the section feels responsive while
 * upgrading to more natural language once the user pauses long
 * enough for a network round-trip.
 *
 * Design notes:
 *   - Reads `VITE_OPENAI_API_KEY` from env. Returns `null` when
 *     unset so the caller can keep the rule-based output without
 *     surfacing an error.
 *   - Per-query in-memory cache. A repeated query inside the
 *     same session never re-fires the network request.
 *   - Cancellable via AbortSignal — caller passes a signal that
 *     gets aborted on every keystroke or unmount, so a stale
 *     response can't overwrite fresh state.
 *   - On any error (network, parse, schema, abort) returns
 *     `null`; never throws into the caller's render path.
 * ============================================================= */

/** In-memory cache scoped to the page session. */
const cache = new Map<string, string[]>();

/**
 * Compact metadata payload for the LLM. We deliberately pass
 * structured tokens (series, subtypes, primaryActivities) rather
 * than the full product description so the model has signal
 * without paying for description boilerplate per call.
 */
type ProductDigest = {
  title: string;
  category: string;
  series: string | null;
  subtypes: string[];
  primaryActivities: string[];
  capabilities: string[];
  tier: string;
};

function digest(product: CatalogProduct): ProductDigest {
  return {
    title: product.title,
    category: product.category,
    series: product.series,
    subtypes: product.subtypes,
    primaryActivities: product.primaryActivities,
    capabilities: product.capabilities,
    tier: product.tier,
  };
}

const SYSTEM_PROMPT = [
  "You generate short search-suggestion prompts for a DJI gear shopping assistant.",
  "Given a shopper's literal search query and the top product matches, return 3-4 conversational prompts the shopper might want to ask the assistant next.",
  "Style: 2-5 words each, lowercase except for proper nouns and product names.",
  "ROUTING RULE (critical): the downstream side-by-side classifier renders a curated multi-row recipe ONLY when a phrase matches `{verb} for {target}` where verb is one of: gear, equipment, kit, setup, essentials, accessories. Without the `for`, phrases ending in `kit` / `bundle` / `combo` (e.g. `Wedding videographer kit`, `Travel combo`) get misrouted to a 'Here are some bundle deals...' card the shopper didn't ask for. ALWAYS use the `{verb} for {target}` form for kit-style or setup-style suggestions.",
  "Allowed examples: 'Gear for moto vlogging', 'Accessories for Mavic 4 Pro', 'Setup for wedding videography', 'Kit for travel photography', 'Compare Mavic 4 Pro vs Air 3', 'Cinematic gimbals'.",
  "Forbidden examples: 'Wedding videographer kit', 'Travel combo', 'Professional film kit', 'Mavic ecosystem' (these would either trip the bundles classifier or fall through to a generic keyword search with no useful card).",
  "Avoid restating the literal query verbatim. Avoid generic prompts like 'Help me shop'. Prefer activity-, accessory-, or comparison-flavoured phrases.",
  'Return STRICTLY valid JSON of the shape {"prompts": ["...", "...", "..."]}. No prose, no markdown, no extra keys.',
].join(" ");

function buildUserMessage(query: string, products: ReadonlyArray<CatalogProduct>) {
  const digests = products.slice(0, 5).map(digest);
  return [
    `Shopper query: "${query}"`,
    "",
    "Top product matches (JSON):",
    JSON.stringify(digests, null, 2),
  ].join("\n");
}

/**
 * Fetch LLM-generated assistant suggestions for the given query.
 *
 * @returns Array of phrases on success, or `null` when no API key
 *          is configured / the request was aborted / the response
 *          couldn't be parsed. Caller should fall back to the
 *          rule-based output silently in the null case.
 */
export async function fetchAssistantSuggestionsLLM(
  query: string,
  products: ReadonlyArray<CatalogProduct>,
  signal: AbortSignal,
): Promise<string[] | null> {
  const trimmed = query.trim();
  if (!trimmed) return null;
  if (products.length === 0) return null;
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
        temperature: 0.4,
        max_tokens: 160,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildUserMessage(trimmed, products) },
        ],
      },
      { signal },
    );

    if (signal.aborted) return null;

    const raw = response.choices[0]?.message?.content?.trim();
    if (!raw) return null;

    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const promptsRaw = (parsed as { prompts?: unknown }).prompts;
    if (!Array.isArray(promptsRaw)) return null;

    const prompts = promptsRaw
      .filter((p): p is string => typeof p === "string")
      .map((p) => p.trim())
      .filter((p) => p.length > 0 && p.length <= 60)
      // Drop anything that would route to the bundle-deals branch.
      // Mirrors the defensive guard in `assistantSuggestions.ts` so
      // both rule-based and LLM paths can't surprise the shopper
      // with a bundles card.
      .filter((p) => !isBundleTrippingPhrase(p))
      .slice(0, 4);
    if (prompts.length === 0) return null;

    cache.set(cacheKey, prompts);
    return prompts;
  } catch (error) {
    // Abort errors are expected on every keystroke — don't pollute
    // the console. Log other failures once for debug parity with the
    // existing OpenAI integration.
    if (
      error &&
      typeof error === "object" &&
      "name" in error &&
      (error as { name?: string }).name === "AbortError"
    ) {
      return null;
    }
    // eslint-disable-next-line no-console
    console.warn("[assistantSuggestionsLLM] fetch failed", error);
    return null;
  }
}

/** Whether an LLM backend is configured — caller can short-circuit
 *  the effect entirely when this is false. */
export function isLlmAvailable(): boolean {
  return isLlmConfigured();
}
