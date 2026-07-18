import { useEffect, useMemo, useState } from "react";
import type { Combo } from "./buildPlan";
import { getHeuristicRationale, type KitRationale } from "./kitRationale";
import {
  generateKitRationales,
  isKitRationaleLlmAvailable,
} from "./kitRationaleLLM";

/* =============================================================
 * Hook: useKitRationales
 *
 * Returns a `Map<slug, KitRationale>` covering every product in the
 * given combo (core + accessories). The map is populated synchronously
 * from `getHeuristicRationale` so the on-tile overlay can render
 * immediately on first paint, then upgraded per-slug as the batched
 * LLM round-trip resolves.
 *
 *   const rationales = useKitRationales(combo, primaryActivity);
 *   const heroRationale = rationales.get(combo.core.slug);
 *
 * Lifecycle (mirrors `useHeadline`):
 *   - First render returns the heuristic map. No loading state — the
 *     overlay always has copy to show.
 *   - A request is fired in `useEffect` with an `AbortController` that
 *     aborts on combo change or unmount, so a stale response can never
 *     overwrite fresh state.
 *   - When the LLM resolves with a partial map (some slugs may have
 *     been dropped by validation), we MERGE on top of the heuristic
 *     so any missing slugs keep their template line.
 *   - When `VITE_OPENAI_API_KEY` is unset OR the request fails / is
 *     aborted, the heuristic map stays. No error UI.
 *
 * The cache key for re-firing the effect is the combo's id + sorted
 * slug list + primaryActivity, NOT the combo object reference. This
 * lets the page re-render the active combo (e.g. on a kit-details
 * panel open/close) without re-firing the LLM call.
 * ============================================================= */

export function useKitRationales(
  combo: Combo,
  primaryActivity: string | undefined,
): ReadonlyMap<string, KitRationale> {
  /* Build the heuristic baseline. Memoized on the combo identity +
   * activity so the map reference is stable across re-renders that
   * don't actually change the kit composition. */
  const heuristic = useMemo<ReadonlyMap<string, KitRationale>>(() => {
    const map = new Map<string, KitRationale>();
    const context = { core: combo.core, primaryActivity };
    map.set(combo.core.slug, getHeuristicRationale(combo.core, context));
    for (const acc of combo.accessories) {
      map.set(acc.slug, getHeuristicRationale(acc, context));
    }
    return map;
  }, [combo, primaryActivity]);

  const [rationales, setRationales] =
    useState<ReadonlyMap<string, KitRationale>>(heuristic);

  /* Reset to the heuristic baseline whenever the kit composition or
   * activity changes, so the swap sequence (heuristic -> LLM) re-plays
   * for the new combo rather than leaving the previous combo's LLM
   * result on screen. */
  useEffect(() => {
    setRationales(heuristic);
  }, [heuristic]);

  /* Stable string key for the effect — ensures the LLM call only
   * re-fires when the kit composition or activity actually changes,
   * not on every parent re-render (e.g. kit-details panel toggling
   * shouldn't burn another network call). */
  const effectKey = useMemo(() => {
    const slugs = [combo.core.slug, ...combo.accessories.map((a) => a.slug)]
      .slice()
      .sort();
    return `${combo.id}::${slugs.join("|")}::${primaryActivity ?? ""}`;
  }, [combo, primaryActivity]);

  useEffect(() => {
    if (!isKitRationaleLlmAvailable()) return;

    const controller = new AbortController();
    let cancelled = false;

    generateKitRationales(combo, primaryActivity, controller.signal).then(
      (result) => {
        if (cancelled || !result) return;
        /* Merge LLM results on top of the heuristic baseline — any
         * slug the model failed to produce valid copy for keeps its
         * template line. */
        setRationales((prev) => {
          const merged = new Map(prev);
          for (const [slug, rationale] of result) {
            merged.set(slug, rationale);
          }
          return merged;
        });
      },
    );

    return () => {
      cancelled = true;
      controller.abort();
    };
    // `combo` and `primaryActivity` are folded into `effectKey` — re-firing on
    // their reference changes (without composition changes) would just hit the
    // module-level cache, but skipping the extra effect run keeps things tidy.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectKey]);

  return rationales;
}
