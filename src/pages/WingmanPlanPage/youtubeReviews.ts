/**
 * Live YouTube Data API client for the product reviews panel's
 * "Videos" tab.
 *
 * Given a product query (e.g. "DJI Osmo Action 5 Pro review") this
 * fetches the top matching videos via the YouTube Data API v3 `search`
 * endpoint and returns a compact, render-ready shape.
 *
 * The API key is read from `import.meta.env.VITE_YOUTUBE_API_KEY`.
 * Same tradeoff as the existing `VITE_OPENAI_API_KEY` path — the key
 * ships in the browser bundle, so it should be HTTP-referrer
 * restricted in the Google Cloud console. When the key is missing we
 * throw a typed `YouTubeConfigError` so the panel can fall back to a
 * plain "search on YouTube" link instead of rendering a broken player.
 *
 * Results are memoised per query for the session so reopening the same
 * product doesn't burn extra quota.
 */

export type YouTubeReview = {
  videoId: string;
  title: string;
  channelTitle: string;
  publishedAt: string;
  thumbnailUrl: string;
};

/** Thrown when no API key is configured — lets the UI degrade to a
 * search link rather than surfacing a generic fetch failure. */
export class YouTubeConfigError extends Error {
  constructor() {
    super("VITE_YOUTUBE_API_KEY is not configured");
    this.name = "YouTubeConfigError";
  }
}

const SEARCH_ENDPOINT = "https://www.googleapis.com/youtube/v3/search";
const MAX_RESULTS = 8;

/* Session cache keyed by the exact query string. */
const cache = new Map<string, YouTubeReview[]>();

type YouTubeSearchItem = {
  id?: { videoId?: string };
  snippet?: {
    title?: string;
    channelTitle?: string;
    publishedAt?: string;
    thumbnails?: {
      medium?: { url?: string };
      high?: { url?: string };
      default?: { url?: string };
    };
  };
};

/* Title-based negativity heuristic. The Search API exposes no
 * sentiment, so we scan the title for phrases that signal a critical /
 * "don't buy" review. Used only to DEMOTE such videos to the bottom of
 * the list (never to hide them) — this is a storefront surface, so we
 * don't want a "DON'T BUY THIS" clip auto-playing on a product we're
 * trying to sell, but we also don't hide dissenting opinions. */
const NEGATIVE_TITLE_PATTERNS: RegExp[] = [
  /\bdon'?t\s+buy\b/i,
  /\bdo\s+not\s+buy\b/i,
  /\bnot\s+(for\s+you|worth|buying)\b/i,
  /\bavoid\b/i,
  /\b(worst|terrible|awful|garbage|trash)\b/i,
  /\b(scam|ripoff|rip-?off|waste)\b/i,
  /\b(problem|problems|issue|issues|flaw|flaws|fail|failure)\b/i,
  /\b(disappoint|disappointing|disappointed)\b/i,
  /\b(regret|returned|refund)\b/i,
  /\b(overrated|overpriced|stop)\b/i,
  /\b(before\s+you\s+buy)\b/i,
  /\bwhy\s+(i|you).*(not|shouldn'?t|won'?t)\b/i,
];

function isNegativeTitle(title: string): boolean {
  return NEGATIVE_TITLE_PATTERNS.some((re) => re.test(title));
}

function mapItem(item: YouTubeSearchItem): YouTubeReview | null {
  const videoId = item.id?.videoId;
  if (!videoId) return null;
  const snippet = item.snippet ?? {};
  const thumb =
    snippet.thumbnails?.medium?.url ??
    snippet.thumbnails?.high?.url ??
    snippet.thumbnails?.default?.url ??
    `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
  return {
    videoId,
    title: snippet.title ?? "Untitled video",
    channelTitle: snippet.channelTitle ?? "YouTube",
    publishedAt: snippet.publishedAt ?? "",
    thumbnailUrl: thumb,
  };
}

/**
 * Fetch up to {@link MAX_RESULTS} review videos for `query`. Throws
 * `YouTubeConfigError` when the key is missing and a generic `Error`
 * on a non-2xx response.
 */
export async function fetchYouTubeReviews(
  query: string,
  signal?: AbortSignal,
): Promise<YouTubeReview[]> {
  const cached = cache.get(query);
  if (cached) return cached;

  const key = import.meta.env.VITE_YOUTUBE_API_KEY;
  if (!key) throw new YouTubeConfigError();

  const url = new URL(SEARCH_ENDPOINT);
  url.searchParams.set("part", "snippet");
  url.searchParams.set("type", "video");
  url.searchParams.set("maxResults", String(MAX_RESULTS));
  url.searchParams.set("q", query);
  url.searchParams.set("key", key);

  const response = await fetch(url.toString(), { signal });
  if (!response.ok) {
    throw new Error(
      `YouTube search failed (${response.status} ${response.statusText})`,
    );
  }
  const data: { items?: YouTubeSearchItem[] } = await response.json();
  const reviews = (data.items ?? [])
    .map(mapItem)
    .filter((r): r is YouTubeReview => r !== null);

  /* Demote negative-titled reviews to the bottom while preserving
   * YouTube's relevance order within each group (Array.prototype.sort
   * is stable). This keeps a positive/neutral video as the first item,
   * so the auto-played clip never leads with a "don't buy" message. */
  const ranked = reviews
    .slice()
    .sort(
      (a, b) =>
        Number(isNegativeTitle(a.title)) - Number(isNegativeTitle(b.title)),
    );

  cache.set(query, ranked);
  return ranked;
}

/** Build a plain YouTube search URL — the fallback when the API key is
 * absent or the request fails, so the shopper can still find reviews. */
export function youtubeSearchUrl(query: string): string {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
}
