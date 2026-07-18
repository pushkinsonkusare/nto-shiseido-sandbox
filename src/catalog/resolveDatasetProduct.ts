/* =============================================================
 * Dataset product-name resolver.
 *
 * The training dataset names products in friendly shorthand
 * ("Neo", "Osmo Action 5 Pro Adventure Combo", "Mic 2 TX Kit").
 * This module maps each name onto a concrete `CatalogProduct`,
 * honouring three rules from the spec:
 *   - "Prefer newer products" -> Mini 4 Pro (absent) resolves to
 *     the Mini 5 Pro.
 *   - "Only recommend products that exist" -> returns null (and
 *     dev-warns) when nothing matches, so callers can skip cleanly.
 *   - Whitespace tolerance -> the catalog has irregular titles like
 *     "DJI Osmo Action 5  Pro" (double space).
 * ============================================================= */

import type { CatalogProduct } from "./catalog";
import type { PrimaryFamily, SecondaryFamily } from "./activityDataset";

/** Family the resolved product should belong to. Drives the core
 *  predicate so a bare "Osmo Action 5 Pro" resolves to the camera
 *  combo, never a SmallRig cage that happens to match the tokens. */
export type ResolveFamily = PrimaryFamily | SecondaryFamily;

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/^dji\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Subtype/group predicates per family — used to keep the resolver
 *  anchored to the right product class. */
function familyPredicate(family: ResolveFamily): (p: CatalogProduct) => boolean {
  switch (family) {
    case "Drone":
      return (p) =>
        p.productTypeGroup === "drone" ||
        p.subtypes.some((s) => s.startsWith("drone_"));
    case "Action":
      return (p) => p.subtypes.includes("cam_action");
    case "Pocket":
      return (p) => p.subtypes.includes("cam_pocket");
    case "Audio":
      return (p) => p.subtypes.some((s) => s.startsWith("mic_"));
    default:
      /* Unknown/empty family — accept anything that isn't a pure
       * accessory so we still bias toward a sensible core. */
      return () => true;
  }
}

/**
 * Ordered title-substring candidates per friendly name. First entry
 * that yields a family-matching product wins. Newer-preferred
 * entries come first (Mini 5 Pro before Mini 4 Pro). Names absent
 * from this table fall back to a normalized-substring match on the
 * name itself.
 */
const PRODUCT_ALIASES: Record<string, string[]> = {
  // Drones
  neo: ["neo drone", "neo fly more", "neo"],
  // Mini 4 Pro is not in the catalog -> prefer the newer Mini 5 Pro.
  "mini 4 pro": ["mini 5 pro drone", "mini 4 pro drone", "mini 5 pro", "mini 4 pro"],
  "air 3s": ["air 3s fly more", "air 3s"],
  "mavic 3 pro": ["mavic 3 pro drone fly more", "mavic 3 pro"],

  // Action cameras
  "osmo action 4": [
    "osmo action 4 standard combo",
    "osmo action 4 adventure combo",
    "osmo action 4",
  ],
  "osmo action 5 pro": [
    "osmo action 5 pro standard combo",
    "osmo action 5 pro",
  ],
  "osmo action 5 pro adventure combo": ["osmo action 5 pro adventure combo"],

  // Pocket cameras
  "pocket 3": ["osmo pocket 3 4k 3 axis gimbal camera", "pocket 3"],
  "pocket 3 creator combo": [
    "osmo pocket 3 4k 3 axis gimbal camera combo",
    "osmo pocket 3 4k 3 axis gimbal camera",
    "pocket 3",
  ],

  // Audio
  "mic 2": ["mic 2 digital wireless microphone kit", "mic 2"],
  "mic mini": ["mic mini"],
  "mic 2 tx kit": ["mic 2 transmitter", "mic 2 tx", "mic 2"],
};

/* Premium-variant keywords. A bare name ("Osmo Action 5 Pro") should
 * NOT resolve to an "Adventure Combo" when a plainer SKU exists, so
 * titles carrying these words get penalised unless the requested
 * name explicitly asks for them. */
const PREMIUM_VARIANT_WORDS = ["adventure", "creator", "fly more", "cine", "premium", "512gb"];

/** Strip a combined "X + Y" name down to its head ("Pocket 3 + Mic 2"
 *  -> "Pocket 3"). The trailing product is handled separately as the
 *  row's secondary. */
function headOf(name: string): string {
  const plus = name.indexOf("+");
  return plus >= 0 ? name.slice(0, plus).trim() : name.trim();
}

function scoreCandidate(
  product: CatalogProduct,
  wantsPremiumWord: (w: string) => boolean,
): number {
  const title = normalize(product.title);
  let score = 0;
  // Prefer non-bundle cores unless a premium/combo variant was asked for.
  if (!product.isBundle) score += 30;
  // Penalise unrequested premium-variant words.
  for (const w of PREMIUM_VARIANT_WORDS) {
    if (title.includes(w) && !wantsPremiumWord(w)) score -= 40;
  }
  // Quality tiebreakers.
  score += (product.rating ?? 0) * 2;
  score += Math.min(product.reviewCount ?? 0, 500) * 0.01;
  // Prefer shorter titles (tighter matches) marginally.
  score -= title.length * 0.02;
  return score;
}

/**
 * Resolve a friendly dataset product name to a catalog product.
 *
 * @param name    Friendly name from the dataset (e.g. "Mini 4 Pro").
 * @param catalog The live catalog.
 * @param family  Family the product should belong to (constrains the
 *                core class). Pass the dataset's primaryFamily /
 *                secondaryFamily.
 * @returns The best matching `CatalogProduct`, or null when nothing
 *          matches (caller should skip + the dev-warn fires).
 */
export function resolveDatasetProduct(
  name: string,
  catalog: CatalogProduct[],
  family: ResolveFamily,
): CatalogProduct | null {
  const cleaned = normalize(headOf(name));
  if (!cleaned) return null;

  const aliases = PRODUCT_ALIASES[cleaned] ?? [cleaned];
  const wantsPremiumWord = (w: string) => cleaned.includes(w);
  const predicate = familyPredicate(family);

  const tryAliases = (withFamily: boolean): CatalogProduct | null => {
    for (const alias of aliases) {
      const matches = catalog.filter((p) => {
        if (!normalize(p.title).includes(alias)) return false;
        if (withFamily && !predicate(p)) return false;
        return true;
      });
      if (matches.length === 0) continue;
      matches.sort(
        (a, b) => scoreCandidate(b, wantsPremiumWord) - scoreCandidate(a, wantsPremiumWord),
      );
      return matches[0];
    }
    return null;
  };

  // First pass: family-constrained. Second pass: relax the family
  // predicate (last resort) so a tagging gap doesn't drop the product
  // entirely.
  const resolved = tryAliases(true) ?? tryAliases(false);

  if (!resolved && import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.warn(
      `[resolveDatasetProduct] no catalog match for "${name}" (family=${family})`,
    );
  }
  return resolved;
}
