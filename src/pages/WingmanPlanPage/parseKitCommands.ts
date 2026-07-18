type KitAccessory = {
  slug: string;
  title: string;
};

type ResolveRemoveCommandResult = {
  isRemoveIntent: boolean;
  matched: KitAccessory[];
  unmatched: string[];
};

const UNDO_REMOVE_PATTERN =
  /\b(undo|restore|revert|bring\s+(?:it|them)\s+back|put\s+(?:it|them)\s+back|add\s+(?:it|them)\s+back)\b/i;

const REMOVE_VERB_PATTERN =
  /\b(remove|delete|drop|without|exclude|take\s+out)\b/i;

const LEADING_REMOVE_PATTERN =
  /^(?:please\s+)?(?:remove|delete|drop|without|exclude|take\s+out)\b/i;

const TRAILING_CONTEXT_PATTERN =
  /\b(?:from|in)\s+(?:the\s+)?(?:kit|combo|set)\b.*$/i;

const REQUEST_SPLIT_PATTERN = /\s*(?:,| and | & | plus )\s*/i;

const REQUEST_TRIM_PATTERN =
  /\b(?:the|a|an|my|our|this|that|item|items|accessory|accessories)\b/gi;

const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "my",
  "our",
  "this",
  "that",
  "from",
  "in",
  "kit",
  "combo",
  "set",
  "item",
  "items",
  "accessory",
  "accessories",
]);

const ALIAS_DEFINITIONS: Array<{
  canonical: string;
  triggers: string[];
  cues: string[];
}> = [
  {
    canonical: "nd filter",
    triggers: ["nd filter", "nd filters", "filter", "filters"],
    cues: ["filter", "freewell", "bright day", "nd"],
  },
  {
    canonical: "battery",
    triggers: ["battery", "batteries", "flight battery"],
    cues: ["battery", "flight battery", "intelligent flight battery"],
  },
  {
    canonical: "bag",
    triggers: ["bag", "case", "storage case", "pouch"],
    cues: ["bag", "case", "storage", "core unit", "padded"],
  },
];

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toTokens(text: string): string[] {
  return normalize(text)
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token && !STOPWORDS.has(token));
}

function parseRequestedItems(input: string): string[] {
  const normalized = input.trim();
  if (!REMOVE_VERB_PATTERN.test(normalized)) return [];
  const withoutVerb = normalized.replace(LEADING_REMOVE_PATTERN, "").trim();
  const withoutContext = withoutVerb.replace(TRAILING_CONTEXT_PATTERN, "").trim();
  const core = withoutContext || normalized;
  return core
    .split(REQUEST_SPLIT_PATTERN)
    .map((part) =>
      part
        .replace(REQUEST_TRIM_PATTERN, " ")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean);
}

function getAliasCues(request: string): string[] {
  const normalizedRequest = normalize(request);
  for (const alias of ALIAS_DEFINITIONS) {
    const matchedTrigger = alias.triggers.some((trigger) =>
      normalizedRequest.includes(normalize(trigger)),
    );
    if (matchedTrigger) {
      return [alias.canonical, ...alias.cues];
    }
  }
  return [];
}

function scoreAccessoryMatch(request: string, accessoryTitle: string): number {
  const query = normalize(request);
  const title = normalize(accessoryTitle);
  if (!query || !title) return 0;

  if (title === query) return 1;
  if (query.length >= 4 && title.includes(query)) return 0.95;

  const queryTokens = toTokens(query);
  const titleTokens = new Set(toTokens(title));
  if (queryTokens.length > 0) {
    const overlap = queryTokens.filter((token) => titleTokens.has(token)).length;
    const ratio = overlap / queryTokens.length;
    if (ratio === 1) return 0.9;
    if (ratio >= 0.6) return 0.72;
  }

  const aliasCues = getAliasCues(query);
  if (aliasCues.length > 0) {
    const cueMatches = aliasCues.filter((cue) => title.includes(normalize(cue)));
    if (cueMatches.length >= 2) return 0.8;
    if (cueMatches.length === 1) return 0.66;
  }

  return 0;
}

export function resolveRemoveCommand(
  input: string,
  accessories: KitAccessory[],
): ResolveRemoveCommandResult {
  const requests = parseRequestedItems(input);
  if (requests.length === 0) {
    return { isRemoveIntent: false, matched: [], unmatched: [] };
  }

  const matched: KitAccessory[] = [];
  const unmatched: string[] = [];
  const claimedSlugs = new Set<string>();

  for (const request of requests) {
    let best: { accessory: KitAccessory; score: number } | null = null;
    for (const accessory of accessories) {
      if (claimedSlugs.has(accessory.slug)) continue;
      const score = scoreAccessoryMatch(request, accessory.title);
      if (score < 0.65) continue;
      if (!best || score > best.score) {
        best = { accessory, score };
      }
    }
    if (best) {
      claimedSlugs.add(best.accessory.slug);
      matched.push(best.accessory);
    } else {
      unmatched.push(request);
    }
  }

  return { isRemoveIntent: true, matched, unmatched };
}

export function isUndoRemoveCommand(input: string): boolean {
  return UNDO_REMOVE_PATTERN.test(input.trim());
}

export type { KitAccessory, ResolveRemoveCommandResult };
