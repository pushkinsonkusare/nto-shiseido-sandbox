/**
 * In-memory selection store for the Wingman plan page.
 *
 * Tracks which product tiles the shopper has ticked via the top-left
 * card checkbox. The selection surfaces as compact pills in the
 * WingmanChatBar (above the input), so the shopper can gather up to a
 * handful of products and then ask Wingman about them together.
 *
 * Pub/sub mirrors `wingmanChatStore` so both the checkbox
 * (`ProductTileImage`) and the pill rail (`WingmanChatBar`) can observe
 * the same source of truth via `useSyncExternalStore` without threading
 * props through the whole page tree.
 *
 * Deliberately NOT persisted: selections are an ephemeral "hold these
 * in my hand" gesture, not a saved list. A refresh starts clean.
 */

export type SelectedProduct = {
  slug: string;
  title: string;
  imageUrl: string;
};

/** Hard cap on how many products can be held at once. */
export const MAX_SELECTION = 3;

/* Identity-stable snapshot for useSyncExternalStore — only rebuilt when
 * the selection actually mutates so subscriber reads share one array. */
let snapshot: SelectedProduct[] = [];
const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((fn) => {
    try {
      fn();
    } catch {
      /* one bad subscriber shouldn't break the rest */
    }
  });
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSnapshot(): SelectedProduct[] {
  return snapshot;
}

export function isSelected(slug: string): boolean {
  return snapshot.some((p) => p.slug === slug);
}

/** Add a product to the selection. No-op when it's already selected or
 * when the selection is already at `MAX_SELECTION`. Returns true when
 * the product ended up selected (already-present counts as success). */
export function addSelection(product: SelectedProduct): boolean {
  if (snapshot.some((p) => p.slug === product.slug)) return true;
  if (snapshot.length >= MAX_SELECTION) return false;
  snapshot = [...snapshot, product];
  notify();
  return true;
}

export function removeSelection(slug: string): void {
  if (!snapshot.some((p) => p.slug === slug)) return;
  snapshot = snapshot.filter((p) => p.slug !== slug);
  notify();
}

/** Toggle a product in/out of the selection. Returns the resulting
 * selected state so the checkbox can reflect whether the add was
 * accepted (an add past the cap is refused and returns false). */
export function toggleSelection(product: SelectedProduct): boolean {
  if (snapshot.some((p) => p.slug === product.slug)) {
    removeSelection(product.slug);
    return false;
  }
  return addSelection(product);
}

export function clearSelection(): void {
  if (snapshot.length === 0) return;
  snapshot = [];
  notify();
}
