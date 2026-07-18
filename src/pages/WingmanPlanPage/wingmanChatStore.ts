/**
 * sessionStorage-backed message thread for the Wingman chat bar.
 *
 * Why sessionStorage: scoping the thread to the current tab means
 * refreshing the URL (or opening Wingman in another tab) starts
 * clean, while same-tab navigations / temporary unmounts can read
 * the thread back without losing it. Using localStorage would leak
 * yesterday's conversation into today's session — wrong default for
 * a prototype demo.
 *
 * Pub/sub: WingmanPlanPage and WingmanChatBar both observe the
 * thread, so writes go through a tiny subscriber list. Consumers
 * pair `subscribe(listener)` with `getSnapshot()` (or build directly
 * on top of `useSyncExternalStore`) to stay in sync without prop
 * plumbing across the page.
 */

const STORAGE_KEY = "wingman-chat-thread";

export type ChatRole = "user" | "assistant";

export type ChatMessage = {
  id: string;
  role: ChatRole;
  text: string;
  /** Epoch ms — used only for stable sort + React keys. */
  createdAt: number;
};

export type PendingSwitchProposal = {
  id: string;
  proposedQuery: string;
  reason: string;
  message: string;
  createdAt: number;
};

export type PendingBundleSuggestion = {
  id: string;
  productSlug: string;
  message: string;
  createdAt: number;
};

function safeRead(): ChatMessage[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (m): m is ChatMessage =>
        !!m &&
        typeof m === "object" &&
        typeof (m as ChatMessage).id === "string" &&
        ((m as ChatMessage).role === "user" ||
          (m as ChatMessage).role === "assistant") &&
        typeof (m as ChatMessage).text === "string" &&
        typeof (m as ChatMessage).createdAt === "number",
    );
  } catch {
    /* JSON corruption / quota exception / privacy mode all land here.
     * Treat as empty thread — losing one prototype chat is fine, but
     * throwing here would break the entire plan page. */
    return [];
  }
}

function safeWrite(messages: ChatMessage[]): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
  } catch {
    /* Quota exceeded or storage disabled — silently drop. The chat
     * still renders for the current session via React state; only the
     * remount survival is impacted, which is a graceful degradation. */
  }
}

/* In-memory mirror so getSnapshot() can return a STABLE reference
 * across calls — `useSyncExternalStore` requires an identity-stable
 * snapshot or it loops forever on re-renders. The mirror is rebuilt
 * only when something actually mutates the thread (append / clear),
 * which means consecutive subscriber reads share the same array. */
let snapshot: ChatMessage[] = safeRead();
let steeringPromptSnapshot = "";
let pendingSwitchSnapshot: PendingSwitchProposal | null = null;
let pendingBundleSuggestionSnapshot: PendingBundleSuggestion | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((fn) => {
    try {
      fn();
    } catch {
      /* one badly-behaved subscriber shouldn't break the rest */
    }
  });
}

export function loadThread(): ChatMessage[] {
  return snapshot;
}

export function getSnapshot(): ChatMessage[] {
  return snapshot;
}

export function getSteeringPromptSnapshot(): string {
  return steeringPromptSnapshot;
}

export function getPendingSwitchSnapshot(): PendingSwitchProposal | null {
  return pendingSwitchSnapshot;
}

export function getPendingBundleSuggestionSnapshot(): PendingBundleSuggestion | null {
  return pendingBundleSuggestionSnapshot;
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function appendMessage(
  role: ChatRole,
  text: string,
): ChatMessage {
  const trimmed = text.trim();
  const message: ChatMessage = {
    id: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role,
    text: trimmed,
    createdAt: Date.now(),
  };
  snapshot = [...snapshot, message];
  safeWrite(snapshot);
  notify();
  return message;
}

export function setSteeringPrompt(text: string): void {
  const trimmed = text.trim();
  if (steeringPromptSnapshot === trimmed) return;
  steeringPromptSnapshot = trimmed;
  notify();
}

export function setPendingSwitchProposal(
  proposedQuery: string,
  reason: string,
  message: string,
): PendingSwitchProposal {
  pendingSwitchSnapshot = {
    id: `switch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    proposedQuery: proposedQuery.trim(),
    reason: reason.trim(),
    message: message.trim(),
    createdAt: Date.now(),
  };
  notify();
  return pendingSwitchSnapshot;
}

export function clearPendingSwitchProposal(): void {
  if (!pendingSwitchSnapshot) return;
  pendingSwitchSnapshot = null;
  notify();
}

export function setPendingBundleSuggestion(
  productSlug: string,
  message: string,
): PendingBundleSuggestion {
  pendingBundleSuggestionSnapshot = {
    id: `bundle-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    productSlug: productSlug.trim(),
    message: message.trim(),
    createdAt: Date.now(),
  };
  notify();
  return pendingBundleSuggestionSnapshot;
}

export function clearPendingBundleSuggestion(): void {
  if (!pendingBundleSuggestionSnapshot) return;
  pendingBundleSuggestionSnapshot = null;
  notify();
}

export function clearThread(): void {
  const hadThread = snapshot.length > 0;
  const hadPending = pendingSwitchSnapshot !== null;
  const hadPendingBundle = pendingBundleSuggestionSnapshot !== null;
  const hadSteeringPrompt = steeringPromptSnapshot.length > 0;
  snapshot = [];
  steeringPromptSnapshot = "";
  pendingSwitchSnapshot = null;
  pendingBundleSuggestionSnapshot = null;
  if (typeof window !== "undefined") {
    try {
      window.sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      /* same rationale as safeWrite — non-fatal */
    }
  }
  if (hadThread || hadPending || hadPendingBundle || hadSteeringPrompt) notify();
}

/** Returns the most recent user/assistant pair (last user msg + the
 * assistant reply that came right after it, if any). The Figma
 * after-messages state shows only this one exchange — older messages
 * scroll out of view rather than stack. */
export function latestExchange(messages: ChatMessage[]): {
  user: ChatMessage | null;
  assistant: ChatMessage | null;
} {
  let user: ChatMessage | null = null;
  let assistant: ChatMessage | null = null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!assistant && m.role === "assistant") {
      assistant = m;
      continue;
    }
    if (m.role === "user") {
      user = m;
      break;
    }
  }
  return { user, assistant };
}
