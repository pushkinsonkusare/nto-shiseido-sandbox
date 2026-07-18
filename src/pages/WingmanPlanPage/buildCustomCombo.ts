import type { CatalogProduct } from "../../catalog/catalog";
import {
  buildAccessoryBundle,
  findAccessoriesFor,
  isAccessoryCompatibleWithAnyCoreStrict,
} from "../../components/SidecarAssistant/conversation/flow";
import type { Combo } from "./buildPlan";
import { detectIntent } from "./composeAssistantReply";

/* =============================================================
 * buildCustomCombo — chat-driven combo generator.
 *
 * Given the latest shopper message from the Wingman chat bar plus
 * the catalog products, returns a `Combo` shaped exactly like the
 * three wingman-curated combos but with `id: "custom"`. The page
 * concatenates this combo with `plan.combos`, surfacing a "Custom"
 * tab next to the budget/ideal/top trio. The tab stays hidden
 * entirely when this function returns null (no chat history yet,
 * or the catalog has no usable cores).
 *
 * Selection logic intentionally re-uses the small intent map from
 * `composeAssistantReply.ts` so the chat reply ("…focused on
 * cheaper alternatives.") and the surfaced combo's tagline stay
 * coordinated — the shopper sees the same characteristic named in
 * both places. We never call out to an LLM here; the prototype
 * stays catalog-pure.
 * ============================================================= */

const CUSTOM_COMBO_LABEL = "Custom Kit";
const CUSTOM_COMBO_TAGLINE = "TAILORED FOR YOU";

/* Number of accessories to bundle around the chat-picked core. We
 * stay near the wingman-ideal default of 4 — the custom combo is
 * shown in the same expanded mosaic as the others, so a different
 * count would look visually inconsistent. */
const CUSTOM_BUNDLE_SIZE = 4;

/* Intent → catalog selector. Each entry inspects an already-filtered
 * `drones` list (productTypeGroup === "drone") and returns the
 * winning core. Selectors short-circuit on the first hit; if none
 * matches the message we fall back to the `defaultPick`.
 *
 * Each selector returns `null` when its filter would leave the list
 * empty — that triggers the fallback rather than emitting a combo
 * built around no product at all. */
type CoreSelector = (drones: CatalogProduct[]) => CatalogProduct | null;

const cheapestSelector: CoreSelector = (drones) => {
  const priced = drones.filter((d) => typeof d.price === "number" && d.price! > 0);
  if (priced.length === 0) return null;
  return priced.reduce((cheapest, candidate) =>
    (candidate.price ?? Infinity) < (cheapest.price ?? Infinity)
      ? candidate
      : cheapest,
  );
};

const priciestSelector: CoreSelector = (drones) => {
  const priced = drones.filter((d) => typeof d.price === "number" && d.price! > 0);
  if (priced.length === 0) return null;
  return priced.reduce((max, candidate) =>
    (candidate.price ?? -Infinity) > (max.price ?? -Infinity) ? candidate : max,
  );
};

const tierSelector =
  (tier: "beginner" | "intermediate" | "pro"): CoreSelector =>
  (drones) => {
    const matches = drones.filter((d) => d.tier === tier);
    /* Within a tier, prefer cheaper picks for "beginner" (the shopper
     * ramp) and the priciest for "pro" so the curated combo feels
     * tier-appropriate rather than just "any random drone in the bucket". */
    if (matches.length === 0) return null;
    return tier === "pro"
      ? priciestSelector(matches)
      : cheapestSelector(matches);
  };

const subtypeSelector =
  (subtype: string): CoreSelector =>
  (drones) => {
    const target = subtype.toLowerCase();
    const matches = drones.filter((d) =>
      d.subtypes.some((s) => s.toLowerCase() === target),
    );
    return matches.length > 0 ? cheapestSelector(matches) ?? matches[0] : null;
  };

const useCaseSelector =
  (...tags: string[]): CoreSelector =>
  (drones) => {
    const lowered = tags.map((t) => t.toLowerCase());
    const matches = drones.filter((d) =>
      d.useCaseTags.some((tag) => lowered.includes(tag.toLowerCase())),
    );
    return matches.length > 0 ? cheapestSelector(matches) ?? matches[0] : null;
  };

/* The match table. Each row's regex is tested against the lowercased
 * shopper message — first hit wins. Order matters: more specific
 * patterns before looser neighbours, so e.g. "cinema" beats a bare
 * "pro" hit even though both could route to a high-tier drone. */
type IntentRule = {
  match: RegExp;
  selector: CoreSelector;
  /** Single-word descriptor used in the combo's tagline. */
  intentTag: string;
};

const INTENT_RULES: IntentRule[] = [
  {
    match: /\b(cheap(er|est)?|budget|affordable|value|under\s*\$?\d+)\b/,
    selector: cheapestSelector,
    intentTag: "BUDGET-FRIENDLY",
  },
  {
    match: /\b(premium|luxury|top[\s-]?tier|best|highest)\b/,
    selector: priciestSelector,
    intentTag: "TOP PICK",
  },
  {
    match: /\b(cinema|cinematic|film)\b/,
    selector: tierSelector("pro"),
    intentTag: "CINEMA-READY",
  },
  {
    match: /\b(pro(fessional)?|advanced|expert)\b/,
    selector: tierSelector("pro"),
    intentTag: "PRO-GRADE",
  },
  {
    match: /\b(beginner|new\s*to|first[\s-]?time|starter|easy)\b/,
    selector: tierSelector("beginner"),
    intentTag: "BEGINNER-FRIENDLY",
  },
  {
    match: /\b(travel|portable|compact|backpack|carry[\s-]?on)\b/,
    selector: subtypeSelector("drone_compact"),
    intentTag: "COMPACT TRAVEL",
  },
  {
    match: /\b(fpv|first[\s-]?person|racing|race)\b/,
    selector: useCaseSelector("fpv", "racing"),
    intentTag: "FPV / RACING",
  },
  {
    match: /\b(action|sports?|surf|ski|bike|skate|moto)\b/,
    selector: useCaseSelector("sports", "action"),
    intentTag: "ACTION-SPORTS",
  },
  {
    match: /\b(long(er)?\s*range|distance|far|reach)\b/,
    selector: priciestSelector,
    intentTag: "LONG-RANGE",
  },
];

function pickCore(
  message: string,
  drones: CatalogProduct[],
): { core: CatalogProduct; intentTag: string } | null {
  if (drones.length === 0) return null;
  const lower = message.toLowerCase();
  for (const { match, selector, intentTag } of INTENT_RULES) {
    if (!match.test(lower)) continue;
    const pick = selector(drones);
    if (pick) return { core: pick, intentTag };
  }
  /* Nothing matched — pick a sensible default. The cheapest drone is
   * the safest fallback because the chat box's most common steering
   * ask is "make this cheaper"; the assistant reply already echoes a
   * generic "better fit your needs" in this case so the combo stays
   * coherent with the spoken acknowledgement. */
  const fallback = cheapestSelector(drones);
  if (!fallback) return null;
  return { core: fallback, intentTag: "TAILORED" };
}

/**
 * Build the chat-driven custom combo from the latest shopper message.
 * Returns null when the message is empty, the catalog has no drones,
 * or no priced drone could anchor the combo.
 */
export function buildCustomCombo(
  shopperMessage: string,
  catalog: CatalogProduct[],
): Combo | null {
  const trimmed = shopperMessage.trim();
  if (!trimmed) return null;

  /* Restrict the core search to drones — the prototype's combos are
   * drone-anchored everywhere else, so introducing a non-drone core
   * here would break the surrounding mosaic + sidebar copy that
   * assume "the kit's headline product is a drone". */
  const drones = catalog.filter((p) => p.productTypeGroup === "drone");
  const picked = pickCore(trimmed, drones);
  if (!picked) return null;

  const displayedCores: CatalogProduct[] = [picked.core];
  const bundled = buildAccessoryBundle(
    picked.core,
    catalog,
    CUSTOM_BUNDLE_SIZE,
  );
  const compatible = bundled.filter((accessory) =>
    isAccessoryCompatibleWithAnyCoreStrict(accessory, displayedCores),
  );
  const accessories = [...compatible];
  if (accessories.length < CUSTOM_BUNDLE_SIZE) {
    const strictRefill = findAccessoriesFor(picked.core, catalog, {
      limit: Math.max(10, CUSTOM_BUNDLE_SIZE * 4),
      requireModelMatch: true,
    }).filter((accessory) =>
      isAccessoryCompatibleWithAnyCoreStrict(accessory, displayedCores),
    );
    for (const candidate of strictRefill) {
      if (accessories.length >= CUSTOM_BUNDLE_SIZE) break;
      if (accessories.some((acc) => acc.slug === candidate.slug)) continue;
      accessories.push(candidate);
    }
  }
  const totalPrice =
    (picked.core.price ?? 0) +
    accessories.reduce((sum, accessory) => sum + (accessory.price ?? 0), 0);

  /* The intent tag from the rule table doubles as the badge tagline,
   * so the chip on the Custom tab reads as "BUDGET-FRIENDLY" /
   * "PRO-GRADE" / "ACTION-SPORTS" — naming the same characteristic
   * the chat assistant just acknowledged. */
  return {
    id: "custom",
    label: CUSTOM_COMBO_LABEL,
    tagline: picked.intentTag || CUSTOM_COMBO_TAGLINE,
    badgeTone: "amber",
    core: picked.core,
    accessories,
    totalPrice,
  };
}

/** Re-exported so callers (the page) can use the same intent labeling
 * the chat reply uses without importing two modules. */
export { detectIntent };
