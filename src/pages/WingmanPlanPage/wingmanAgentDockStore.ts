/**
 * "Follow-the-focus" dock store for the Wingman agent (chat bar).
 *
 * The Wingman chat bar normally floats at the bottom-center of the
 * viewport. When the shopper opens a surface that deserves the agent's
 * attention — currently the `KitDetailsPanel` product/kit overlay — that
 * surface registers a DOM node here as the agent's "dock". The single
 * `WingmanChatBar` instance observes this store and, whenever a dock is
 * present, portals itself into that node (rendered in a docked layout at
 * the bottom of the panel) instead of the viewport. Closing the panel
 * unregisters the dock and the bar snaps back to its floating position.
 *
 * Modelled on `wingmanSelectionStore` — a tiny pub/sub singleton read via
 * `useSyncExternalStore` so we don't have to thread the (many) chat
 * handlers through the panel component tree just to relocate the agent.
 *
 * Only ONE dock can be active at a time. The last registrant wins; the
 * `KitDetailsPanel` returns `null` when closed, so at most one open panel
 * ever holds the dock.
 */

let dockElement: HTMLElement | null = null;
/* Human-readable name of whatever the docked surface is currently
 * focused on (e.g. the product/kit title). Lets the agent tailor its
 * input placeholder — "Ask me anything about <name>" — to the thing the
 * shopper is looking at. Null when nothing specific is in focus. */
let dockLabel: string | null = null;
/* Catalog slug of the product currently on stage in the docked surface.
 * Alongside the label (which drives the placeholder copy) this lets the
 * page derive contextual Next Best Actions — e.g. the product's FAQs —
 * for whatever the shopper is looking at. Null when nothing specific is
 * in focus. */
let dockProductSlug: string | null = null;
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

export function subscribeAgentDock(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getAgentDockSnapshot(): HTMLElement | null {
  return dockElement;
}

export function getAgentDockLabelSnapshot(): string | null {
  return dockLabel;
}

export function getAgentDockProductSlugSnapshot(): string | null {
  return dockProductSlug;
}

/** Register (or clear, when passed `null`) the node the agent should
 * dock into. Safe to call repeatedly — it only notifies subscribers when
 * the target actually changes. */
export function setAgentDock(node: HTMLElement | null): void {
  if (dockElement === node) return;
  dockElement = node;
  notify();
}

/** Set (or clear) the context label describing what the docked surface
 * is focused on. Only notifies when it actually changes. */
export function setAgentDockLabel(label: string | null): void {
  if (dockLabel === label) return;
  dockLabel = label;
  notify();
}

/** Set (or clear) the catalog slug of the product on stage in the docked
 * surface. Only notifies when it actually changes. */
export function setAgentDockProductSlug(slug: string | null): void {
  if (dockProductSlug === slug) return;
  dockProductSlug = slug;
  notify();
}
