import {
  getOpenAIClient,
  getOpenAIModel,
  isLlmConfigured,
} from "../../lib/openaiClient";
import type { Combo } from "./buildPlan";
import type { KitRationale } from "./kitRationale";

/* =============================================================
 * LLM upgrade for the WingmanPlanPage kit-tile rationales.
 *
 * One batched OpenAI call per combo — sends the full kit composition
 * (core + accessories with title / category / role / subtypes) plus
 * the kit's primary activity, returns a JSON map of
 * `{ [slug]: "<10-15 word reason>" }` covering every product in the kit.
 *
 * Why batched (vs one call per tile):
 *   - 1 round-trip per combo instead of up to 7 → faster and cheaper.
 *   - Model sees the whole kit at once → can write rationales that
 *     don't repeat each other ("captures aerial shots…" three times
 *     across three accessories gets avoided).
 *   - Cleaner cancellation semantics — one AbortController, one
 *     in-flight request per combo.
 *
 * Design notes (mirrors `headlineLLM.ts`):
 *   - Reads `VITE_OPENAI_API_KEY` + `VITE_OPENAI_MODEL` from env.
 *     Returns `null` when the key is missing so the caller silently
 *     keeps the heuristic.
 *   - Per-kit in-memory cache. Cache key is the sorted slug list +
 *     primary activity, so the same kit composition shared across
 *     sessions hits the cache, and activity-tinted variants get
 *     their own entry.
 *   - Cancellable via AbortSignal — caller passes a signal that
 *     gets aborted on combo change or unmount, so a stale response
 *     can't overwrite fresh state.
 *   - On any error (network, parse, schema, abort) returns `null`;
 *     never throws into the caller's render path.
 *   - JSON-mode response (`response_format: { type: "json_object" }`)
 *     plus per-entry validation (8-20 words, ≤160 chars, no quote
 *     chars, no markdown). Invalid entries are dropped so the
 *     caller's heuristic fills the gap.
 * ============================================================= */

/** Per-kit in-memory cache scoped to the page session. Key includes
 *  the sorted slug list AND the primary activity so a battery in a
 *  travel kit can read different from a battery in a wedding kit. */
const cache = new Map<string, ReadonlyMap<string, KitRationale>>();

/* Sort the slug list before joining so callers don't need to worry
 * about consistent ordering — a kit assembled in any order hits the
 * same cache entry. */
function buildCacheKey(combo: Combo, primaryActivity: string | undefined): string {
  const slugs = [combo.core.slug, ...combo.accessories.map((a) => a.slug)]
    .slice()
    .sort();
  return `${slugs.join("|")}::${primaryActivity ?? ""}`;
}

const SYSTEM_PROMPT = [
  "You write 1-line reasons explaining why each product was picked for a curated camera-gear kit.",
  "Every product in the kit was bundled to support a specific creator goal — your job is to explain in ONE short line what role each product plays in this kit.",
  "",
  "INPUT shape: a JSON object with",
  "  - activity: the creator activity this kit was assembled for (may be empty)",
  "  - core: the anchor product the kit was built around",
  "  - accessories: the supporting products in the kit",
  "Each product carries: slug, title, category, productType, accessoryRole, subtypes.",
  "",
  "OUTPUT shape: a JSON object whose keys are EXACTLY the product slugs you received (core slug + every accessory slug). For each slug, the value is a single SHORT STRING (10-15 words, max 140 chars).",
  '  Example: { "dji-mini-4-pro": "Folding sub-249g drone for travel B-roll without the regulatory paperwork." }',
  "",
  "Style rules:",
  "- ONE line per slug. 10-15 words. No headline, no body — just the reason.",
  "- Lead with the function, not the features (\"Cuts midday glare…\" not \"Premium ND filter that…\").",
  "- Vary phrasing across the kit. Don't start every line with \"Captures\" or \"For\".",
  "- Sentence case. No emojis, no markdown, no quotes inside the strings.",
  "- Don't mention price, brand or model numbers. Don't say \"DJI\".",
  "- If the activity is provided, tint the rationale toward that use case (e.g. for a \"travel\" kit, mention plane-friendliness, lightweight carry, etc).",
  "- Return ONLY the JSON object. No surrounding prose, no preamble, no nesting under a wrapper key.",
].join("\n");

/* ---------- Per-entry validation ----------
 * Mirrors headlineLLM's "bias toward null" stance — if anything
 * looks off we drop that slug's entry and the heuristic stays. */
function sanitizeEntry(raw: unknown): KitRationale | null {
  /* Tolerance shim: the prompt asks for a plain string per slug,
   * but models occasionally wrap it in `{ "body": "…" }` or
   * `{ "rationale": "…" }`. Accept those shapes too — pulling out
   * the first string we find. */
  let text: string | null = null;
  if (typeof raw === "string") {
    text = raw;
  } else if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    for (const key of ["body", "rationale", "reason", "text", "line"]) {
      const candidate = obj[key];
      if (typeof candidate === "string" && candidate.trim()) {
        text = candidate;
        break;
      }
    }
  }
  if (!text) return null;

  let cleaned = text.trim();
  if (!cleaned) return null;

  /* Reject quote / markdown / code-fence noise — implies the model
   * went off script. Heuristic will fill in for this slug. */
  if (/["`]/.test(cleaned) || /[*_]{2,}/.test(cleaned)) return null;

  /* Strip leading bullet/markdown noise + wrapping punctuation that
   * models occasionally tack on. Trailing period is fine — these are
   * full sentences. */
  cleaned = cleaned
    .replace(/^[\s>•\-*]+/, "")
    .replace(/^[`'"]+/, "")
    .replace(/[`'"]+$/, "")
    .trim();
  if (!cleaned) return null;

  /* Word count bound — 8-20 lets the model breathe past the strict
   * 10-15 target without overflowing the tile. Hard char cap as a
   * second line of defense. */
  const words = cleaned.split(/\s+/).filter(Boolean).length;
  if (words < 6 || words > 24) return null;
  if (cleaned.length > 160) return null;

  return cleaned;
}

/** Build the payload sent to the model — small, structured, and
 *  excludes the gallery / spec / featureBlocks bulk so we don't burn
 *  tokens on data the rationale doesn't need. */
function buildKitPayload(combo: Combo, primaryActivity: string | undefined) {
  const summarize = (
    p: Combo["core"] | Combo["accessories"][number],
  ) => ({
    slug: p.slug,
    title: p.title,
    category: p.category ?? "",
    productType: p.productType,
    accessoryRole: p.accessoryRole ?? "",
    subtypes: p.subtypes,
  });

  return {
    activity: primaryActivity ?? "",
    core: summarize(combo.core),
    accessories: combo.accessories.map(summarize),
  };
}

/**
 * Fetch LLM-generated rationales for every product in a kit.
 *
 * @returns A `ReadonlyMap<slug, KitRationale>` containing entries for
 *          the slugs the model returned valid copy for. The caller is
 *          expected to fall back to the heuristic for any slug missing
 *          from this map. Returns `null` when no API key is configured,
 *          the request was aborted, or the response failed validation
 *          across the board — caller keeps the heuristic in that case.
 */
export async function generateKitRationales(
  combo: Combo,
  primaryActivity: string | undefined,
  signal: AbortSignal,
): Promise<ReadonlyMap<string, KitRationale> | null> {
  const client = getOpenAIClient();
  if (!client) return null;

  const cacheKey = buildCacheKey(combo, primaryActivity);
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  if (signal.aborted) return null;

  const payload = buildKitPayload(combo, primaryActivity);

  try {
    const response = await client.chat.completions.create(
      {
        model: getOpenAIModel(),
        /* Slightly higher than the headline temperature so rationales
         * across the kit don't all rhyme — but still constrained
         * enough that the model stays on-template. */
        temperature: 0.4,
        /* Sized for up to 7 tiles × ~30 tokens per single-line
         * rationale, plus JSON syntax overhead. The hard char caps
         * in `sanitizeEntry` still trim any runaway lines. */
        max_tokens: 400,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: `kit:\n${JSON.stringify(payload)}\n\nReturn the JSON object now.`,
          },
        ],
      },
      { signal },
    );

    if (signal.aborted) return null;

    const raw = response.choices[0]?.message?.content;
    if (!raw) return null;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
    if (!parsed || typeof parsed !== "object") return null;

    /* Build the result map by validating each expected slug. The
     * model occasionally wraps the slug map under a top-level key
     * like `rationales` even though the prompt says otherwise — we
     * tolerate that by falling through to the wrapped object when
     * the top-level lookup misses every slug. */
    const expectedSlugs = new Set([
      combo.core.slug,
      ...combo.accessories.map((a) => a.slug),
    ]);

    const lookupSource = pickRationaleSource(parsed, expectedSlugs);
    if (!lookupSource) return null;

    const out = new Map<string, KitRationale>();
    for (const slug of expectedSlugs) {
      const entry = sanitizeEntry((lookupSource as Record<string, unknown>)[slug]);
      if (entry) out.set(slug, entry);
    }

    if (out.size === 0) return null;

    const frozen: ReadonlyMap<string, KitRationale> = out;
    cache.set(cacheKey, frozen);
    return frozen;
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "name" in error &&
      (error as { name?: string }).name === "AbortError"
    ) {
      return null;
    }
    // eslint-disable-next-line no-console
    console.warn("[kitRationaleLLM] fetch failed", error);
    return null;
  }
}

/** Whether an LLM backend is configured — caller can short-circuit
 *  the effect entirely when this is false. */
export function isKitRationaleLlmAvailable(): boolean {
  return isLlmConfigured();
}

/* Tolerance shim: the model usually returns the slug map at the top
 * level (per the prompt) but occasionally wraps it under a key like
 * `rationales` or `kit`. We accept either shape by checking which
 * level actually contains the expected slugs. */
function pickRationaleSource(
  parsed: unknown,
  expectedSlugs: Set<string>,
): Record<string, unknown> | null {
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;

  let topLevelHits = 0;
  for (const slug of expectedSlugs) {
    if (slug in obj) topLevelHits++;
  }
  if (topLevelHits > 0) return obj;

  /* Fall back: scan one level deep for any nested object that
   * carries the expected slugs as keys. */
  for (const value of Object.values(obj)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const nested = value as Record<string, unknown>;
      for (const slug of expectedSlugs) {
        if (slug in nested) return nested;
      }
    }
  }

  return null;
}
