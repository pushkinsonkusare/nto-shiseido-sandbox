import { useEffect, useState } from "react";
import { generateHeadline, isHeadlineLlmAvailable } from "./headlineLLM";

/* =============================================================
 * Hook: useHeadline
 *
 * Returns the synchronous `fallback` (the heuristic produced by
 * `shortenQuery`) immediately so the hero never looks "loading",
 * then upgrades to an LLM-generated headline once the network
 * round-trip completes.
 *
 *   const headline = useHeadline(plan.rawQuery, plan.headline);
 *
 * Lifecycle:
 *   - The fallback shows on the first render and on every query
 *     change. This is the same string the page would have shown
 *     before this hook existed.
 *   - A request is fired in `useEffect` with an `AbortController`
 *     that is aborted on unmount or on a query change. A stale
 *     response can never overwrite fresh state.
 *   - If `VITE_OPENAI_API_KEY` is missing or the request fails /
 *     returns invalid output, the fallback stays. No error state.
 *   - Output is capitalized at the first character so the model can
 *     return lower-case (per the system prompt) and the h1 still
 *     reads correctly. Internal capitalization (proper nouns,
 *     product names) is preserved.
 * ============================================================= */

function capitalizeFirst(text: string): string {
  if (!text) return text;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function useHeadline(rawQuery: string, fallback: string): string {
  const [headline, setHeadline] = useState<string>(fallback);

  // Reset to the fallback whenever the query changes so the swap
  // sequence (fallback -> LLM) re-plays for the new query rather
  // than leaving the previous query's LLM result on screen.
  useEffect(() => {
    setHeadline(fallback);
  }, [rawQuery, fallback]);

  useEffect(() => {
    if (!isHeadlineLlmAvailable()) return;
    const trimmed = rawQuery.trim();
    if (!trimmed) return;

    const controller = new AbortController();
    let cancelled = false;

    generateHeadline(trimmed, controller.signal).then((result) => {
      if (cancelled) return;
      if (!result) return;
      setHeadline(capitalizeFirst(result));
    });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [rawQuery]);

  return headline;
}
