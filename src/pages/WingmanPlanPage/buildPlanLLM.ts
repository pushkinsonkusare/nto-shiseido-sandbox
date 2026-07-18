/* =============================================================
 * LLM enrichment for the Wingman plan.
 *
 * The deterministic planner (`buildPlan`) is now dataset-driven and
 * is the ROUTING AUTHORITY — it picks the family, the per-tier core,
 * the secondary product, and the accessories straight from the
 * training dataset + catalog. The LLM no longer re-derives product
 * picks (which risked re-introducing routing bugs). Its job here is
 * narrow and safe: act as the DJI product specialist and write the
 * Activity Summary + per-kit Reasoning prose for the kits the
 * deterministic planner already assembled.
 *
 * On any failure (no key, network, abort, invalid JSON) we return
 * the deterministic plan unchanged — it already carries templated
 * reasoning + summary, so the page never looks broken.
 * ============================================================= */

import {
  getOpenAIClient,
  getOpenAIModel,
  isLlmConfigured,
} from "../../lib/openaiClient";
import type { CatalogProduct } from "../../catalog/catalog";
import { buildPlan, type Combo, type PlanResult } from "./buildPlan";

export function isWingmanPlanLlmAvailable(): boolean {
  return isLlmConfigured();
}

/* The v2 specialist framework. Frames the model as a DJI product
 * specialist so the generated prose reads with domain authority.
 * The model only WRITES copy here — routing is locked upstream. */
const SPECIALIST_SYSTEM_PROMPT = [
  "You are a DJI product specialist helping a customer pick gear for their activity.",
  "",
  "You are given an activity and three already-assembled kits (Cost Effective, Ideal, Pro).",
  "Each kit lists a primary DJI product, optional secondary DJI products, and accessories.",
  "These product choices are FINAL — do NOT suggest different products, do NOT invent products.",
  "",
  "Your job: write concise, practical, confident copy explaining the kits.",
  "- An 'activitySummary': one sentence (max ~22 words) on why this product family fits the activity.",
  "- A 'reasoning' line for each kit (max ~28 words): why THIS kit's products suit the activity,",
  "  the environment, and the budget level. Lead with the benefit, not a product list.",
  "- Mention the secondary product's value when one is present (e.g. a mic for narration/audio).",
  "- Plain, specific language. No marketing fluff, no emojis, no markdown, no quotes inside strings.",
  "",
  'Return STRICT JSON only: {"activitySummary": "string", "kits": {"budget": "string", "ideal": "string", "top": "string"}}',
  "No other keys, no prose outside the JSON.",
].join("\n");

type LlmEnrichment = {
  activitySummary?: unknown;
  kits?: unknown;
};

function comboDigest(combo: Combo): Record<string, unknown> {
  const names = (list: CatalogProduct[] | undefined) =>
    (list ?? []).map((p) => p.title);
  const secondary = combo.secondary ?? [];
  const secondarySlugs = new Set(secondary.map((p) => p.slug));
  // accessories[] has secondary folded in for display — split it back
  // out so the model sees the distinction.
  const trueAccessories = combo.accessories.filter((p) => !secondarySlugs.has(p.slug));
  return {
    tier: combo.id,
    label: combo.label,
    primary: combo.core.title,
    secondary: names(secondary),
    accessories: names(trueAccessories),
  };
}

function buildEnrichmentPayload(query: string, plan: PlanResult): string {
  const kits = plan.combos.map(comboDigest);
  return [
    `Customer query: "${query}"`,
    "",
    "Kits (products are final):",
    JSON.stringify(kits, null, 2),
    "",
    "Write the activitySummary + one reasoning line per kit tier (budget/ideal/top).",
  ].join("\n");
}

/** Validate + clamp a model-authored copy string. Returns null when
 *  the value is unusable so the caller keeps the templated default. */
function cleanCopy(raw: unknown, maxLen: number): string | null {
  if (typeof raw !== "string") return null;
  let text = raw.trim().replace(/\s+/g, " ");
  if (!text) return null;
  // Strip wrapping quotes / stray markdown the model sometimes adds.
  text = text.replace(/^[`"'*_]+/, "").replace(/[`"'*_]+$/, "").trim();
  if (!text) return null;
  if (text.length > maxLen) {
    const slice = text.slice(0, maxLen);
    const lastSpace = slice.lastIndexOf(" ");
    text = (lastSpace > 0 ? slice.slice(0, lastSpace) : slice).trim();
  }
  return text || null;
}

function mergeProse(base: PlanResult, parsed: LlmEnrichment): PlanResult {
  const summary = cleanCopy(parsed.activitySummary, 160);
  const kits =
    parsed.kits && typeof parsed.kits === "object"
      ? (parsed.kits as Record<string, unknown>)
      : {};

  const combos: Combo[] = base.combos.map((combo) => {
    const reasoning = cleanCopy(kits[combo.id], 200);
    return reasoning ? { ...combo, reasoning } : combo;
  });

  return {
    ...base,
    combos,
    activitySummary: summary ?? base.activitySummary,
  };
}

/**
 * Enrich the deterministic plan's prose via the LLM. Returns the
 * deterministic plan unchanged on any failure. Returns null only
 * when there's nothing to render (no query / empty catalog) so the
 * caller can fall back to its synchronous local plan.
 */
export async function buildPlanWithLlm(
  query: string,
  catalog: CatalogProduct[],
  signal: AbortSignal,
): Promise<PlanResult | null> {
  const client = getOpenAIClient();
  const trimmed = query.trim();
  if (!client || !trimmed || catalog.length === 0) return null;

  const base = buildPlan(trimmed, catalog);
  if (!base.hasResults || base.combos.length === 0) return base;
  if (signal.aborted) return null;

  try {
    const response = await client.chat.completions.create(
      {
        model: getOpenAIModel(),
        temperature: 0.5,
        max_tokens: 600,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SPECIALIST_SYSTEM_PROMPT },
          { role: "user", content: buildEnrichmentPayload(trimmed, base) },
        ],
      },
      { signal },
    );

    if (signal.aborted) return null;
    const raw = response.choices[0]?.message?.content?.trim();
    if (!raw) return base;

    let parsed: LlmEnrichment;
    try {
      parsed = JSON.parse(raw) as LlmEnrichment;
    } catch {
      return base;
    }
    return mergeProse(base, parsed);
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
    console.warn("[wingman-plan-llm] prose enrichment failed; using local plan", error);
    return base;
  }
}
