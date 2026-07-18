import { useEffect } from "react";

/* =============================================================
 * useBodyScrollLock — reference-counted body scroll lock.
 *
 * PROBLEM this solves:
 *   Multiple modal surfaces (KitDetailsPanel, ProductReviewsPanel,
 *   KitComparePanel, …) can be layered on top of each other. The
 *   naive per-component pattern —
 *
 *     const original = document.body.style.overflow;
 *     document.body.style.overflow = "hidden";
 *     return () => { document.body.style.overflow = original; };
 *
 *   breaks when panels overlap: the second panel to open captures
 *   `"hidden"` (set by the first) as its "original", so whichever
 *   panel cleans up LAST restores `overflow: hidden` and the page
 *   scroll stays frozen forever.
 *
 * FIX:
 *   A single module-level counter. The very first lock captures the
 *   body's real overflow and applies `hidden`; every subsequent lock
 *   just bumps the counter. Only when the counter returns to zero do
 *   we restore the original value. Open/close order no longer matters.
 * ============================================================= */

let lockCount = 0;
/** The body overflow value captured when the FIRST lock engaged.
 *  Restored only when the last lock releases. */
let restoreOverflow = "";

function acquireLock(): void {
  if (lockCount === 0) {
    restoreOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  lockCount += 1;
}

function releaseLock(): void {
  // Guard against an over-release (double cleanup) driving the count
  // negative, which would leave the body permanently locked.
  if (lockCount === 0) return;
  lockCount -= 1;
  if (lockCount === 0) {
    document.body.style.overflow = restoreOverflow;
    restoreOverflow = "";
  }
}

/**
 * Lock body scroll while `active` is true. Safe to nest across many
 * simultaneously-mounted components — the body only unlocks once every
 * active lock has released.
 *
 * @param active whether this consumer currently wants scroll locked.
 */
export function useBodyScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    acquireLock();
    return releaseLock;
  }, [active]);
}
