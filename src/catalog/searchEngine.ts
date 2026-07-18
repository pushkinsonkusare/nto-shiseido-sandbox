/**
 * In-memory search engine for the DJI catalog (~250 products).
 *
 * Goals:
 *   1. Keyword search across name / category / brand / tags / description /
 *      compatible_with.
 *   2. Field weighting per the spec — name matches outrank tag matches
 *      outrank description matches.
 *   3. Synonym expansion ("vlog" -> "vlogging", "drone" -> "quadcopter",
 *      etc.) so casual queries surface the right gear.
 *   4. Fuzzy matching via Levenshtein distance (<= 2) to tolerate typos.
 *   5. Search suggestions: top-5 product names + top-3 categories.
 *   6. Performance: < 50ms for 250 products on a warm index.
 *
 * The engine is intentionally framework-agnostic — `buildSearchIndex` is
 * called once when the catalog loads (`catalog.ts`) and the resulting
 * `SearchIndex` is shared across the app via `catalogStore.searchIndex`.
 */

import type { CatalogProduct } from "./catalog";

/* -------------------------------------------------------------------------- */
/* Synonym dictionary                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Bidirectional-ish synonym table. The expander walks each query token
 * once and pushes every related term, so we list both directions
 * explicitly rather than relying on a graph traversal — keeps the
 * lookup an O(1) Map.get and avoids accidental over-expansion (e.g.
 * "audio" should NOT pull in every "mic" synonym chain).
 */
const SYNONYMS: Record<string, string[]> = {
  // Content / use-cases
  vlog: ["vlogging", "youtube", "vlogger"],
  vlogging: ["vlog", "youtube"],
  youtube: ["vlog", "vlogging"],
  // Audio
  mic: ["microphone", "audio"],
  microphone: ["mic", "audio"],
  audio: ["mic", "microphone", "sound"],
  podcast: ["podcasting", "interview"],
  // Drones
  drone: ["quadcopter", "uav", "aerial"],
  quadcopter: ["drone", "uav"],
  uav: ["drone", "quadcopter"],
  aerial: ["drone"],
  // Stabilization
  gimbal: ["stabilizer", "steadycam"],
  stabilizer: ["gimbal"],
  // Cameras
  cam: ["camera"],
  camera: ["cam"],
  action: ["sports", "sport"],
  sports: ["sport", "action"],
  // Water
  underwater: ["waterproof", "diving", "scuba"],
  waterproof: ["underwater", "water-resistant"],
  diving: ["underwater", "scuba"],
  scuba: ["underwater", "diving"],
  // Tier / price intent
  cheap: ["budget", "affordable"],
  budget: ["cheap", "affordable"],
  pro: ["professional", "expert"],
  professional: ["pro"],
  beginner: ["entry", "starter", "novice"],
  // FPV
  fpv: ["first-person-view", "racing"],
  racing: ["fpv", "race"],
  // Travel / size
  compact: ["portable", "lightweight", "mini"],
  portable: ["compact", "lightweight"],
  travel: ["compact", "portable"],
};

/* -------------------------------------------------------------------------- */
/* Text normalization                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Lowercase, strip punctuation/diacritics, collapse whitespace.
 * Keeps alphanumerics + spaces so model tokens like "rs2" stay intact.
 */
export function normalize(value: string): string {
  if (!value) return "";
  return value
    .toLowerCase()
    .replace(/[\u2018\u2019\u201C\u201D]/g, "'")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const STOPWORDS: ReadonlySet<string> = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "for",
  "with",
  "of",
  "to",
  "in",
  "on",
  "at",
  "by",
  "is",
  "are",
  "be",
  "from",
  "as",
]);

/** Normalize and split into stop-word-free tokens. */
export function tokenize(value: string): string[] {
  const norm = normalize(value);
  if (!norm) return [];
  const out: string[] = [];
  for (const t of norm.split(" ")) {
    if (!t) continue;
    if (STOPWORDS.has(t)) continue;
    // Single-character tokens are usually noise ("a", "b") — except for
    // digits, which carry real model-line meaning ("Mini 5" vs "Mini 3",
    // "RS 4", "Air 3"). Dropping them collapses distinct product lines
    // into a single bucket and lets older models out-rank the queried one.
    if (t.length < 2 && !/^[0-9]$/.test(t)) continue;
    out.push(t);
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Levenshtein distance (O(min(a,b)) memory)                                  */
/* -------------------------------------------------------------------------- */

/**
 * Iterative two-row Levenshtein. We don't need the full matrix — only
 * the previous row — so memory is O(n). Fast enough that we can afford
 * to call it ~thousands of times per query for fuzzy candidate
 * selection.
 */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;
  const m = a.length;
  const n = b.length;

  // Cheap early-out: if string-length difference exceeds the cap,
  // distance is at least that delta.
  if (Math.abs(m - n) > Math.max(m, n)) return Math.max(m, n);

  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    const ac = a.charCodeAt(i - 1);
    for (let j = 1; j <= n; j++) {
      const cost = ac === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1,
        prev[j] + 1,
        prev[j - 1] + cost,
      );
    }
    [prev, curr] = [curr, prev];
  }

  return prev[n];
}

/* -------------------------------------------------------------------------- */
/* Query expansion                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Expand a tokenized query with its synonyms. Order is preserved
 * (originals first, then expansions) and dedupe is exact-match.
 */
export function expandQueryTokens(tokens: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tokens) {
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  for (const t of tokens) {
    const expansions = SYNONYMS[t];
    if (!expansions) continue;
    for (const raw of expansions) {
      const exp = normalize(raw).replace(/\s+/g, " ");
      if (!exp || seen.has(exp)) continue;
      seen.add(exp);
      out.push(exp);
    }
  }
  return out;
}

export type QueryPlan = {
  /** Deduped non-stopword tokens in input order. */
  originalTokens: string[];
  /**
   * For each original token: the list of expansion tokens to probe (the
   * original itself first, then its synonyms). `search()` requires every
   * original token to be satisfied by at least one expansion in its
   * group before a doc enters the result set — synonyms count as
   * alternative spellings of the same intent, not as extra evidence.
   */
  expansionsByToken: Map<string, string[]>;
  /** Flat union of every expansion (originals + synonyms), preserving the
   * legacy `expandQueryTokens` ordering — surfaced on `SearchResult` for
   * debugging. */
  expandedTokens: string[];
};

/**
 * Build the per-token expansion groups + the flat legacy expansion list
 * in a single pass. Used by `search()` to enforce AND-token semantics
 * (every original token must hit, synonyms/fuzzy candidates count).
 */
export function buildQueryPlan(rawQuery: string): QueryPlan {
  const tokens = tokenize(rawQuery);
  const expansionsByToken = new Map<string, string[]>();
  const originalTokens: string[] = [];

  for (const tok of tokens) {
    if (expansionsByToken.has(tok)) continue;
    originalTokens.push(tok);

    const expansions: string[] = [tok];
    const seen = new Set<string>([tok]);
    const synonyms = SYNONYMS[tok];
    if (synonyms) {
      for (const raw of synonyms) {
        const exp = normalize(raw).replace(/\s+/g, " ");
        if (!exp || seen.has(exp)) continue;
        seen.add(exp);
        expansions.push(exp);
      }
    }
    expansionsByToken.set(tok, expansions);
  }

  return {
    originalTokens,
    expansionsByToken,
    expandedTokens: expandQueryTokens(originalTokens),
  };
}

/* -------------------------------------------------------------------------- */
/* Index types                                                                */
/* -------------------------------------------------------------------------- */

export type IndexedDoc = {
  product: CatalogProduct;
  /** Lowercased + punctuation-stripped product title (used for phrase match). */
  nameNormalized: string;
  /** Token sets per searchable field — Set lookup is O(1). */
  nameTokens: Set<string>;
  categoryTokens: Set<string>;
  brandTokens: Set<string>;
  tagTokens: Set<string>;
  descriptionTokens: Set<string>;
  compatibleTokens: Set<string>;
  /**
   * Ordered title tokens (same tokenization as `nameTokens` but
   * preserves position + duplicates). Backs the phrase-proximity gate
   * that requires model-line bigrams like "action 3" / "mini 5" to
   * appear near each other in the title rather than as independent
   * leaks across description / category / etc.
   */
  nameTokenSequence: string[];
  /**
   * Ordered tokens from `compatibleWithModels` ("dji osmo action 5
   * pro" → ["dji","osmo","action","5","pro"]). Lets accessories whose
   * compatibility list explicitly names the queried model satisfy the
   * phrase gate even when their own title doesn't repeat the model.
   */
  compatibleModelTokenSequence: string[];
  /** Union of every searchable token — backs fuzzy candidate scan. */
  allTokens: Set<string>;
};

export type SearchIndex = {
  docs: IndexedDoc[];
  /**
   * Distinct universe of tokens across every doc/field. Pre-grouped by
   * length so fuzzy lookups can skip candidates with a length delta
   * already exceeding the distance cap (huge speedup vs scanning the
   * whole vocab).
   */
  tokensByLength: Map<number, string[]>;
  /** Inverted index: token -> doc indices that contain it. */
  postings: Map<string, number[]>;
};

/* -------------------------------------------------------------------------- */
/* Index construction                                                         */
/* -------------------------------------------------------------------------- */

/** Combine the catalog's tag-like fields into a single bag of tag tokens. */
function collectTagText(p: CatalogProduct): string {
  const parts: string[] = [
    ...p.useCaseTags,
    ...p.capabilities,
    ...p.subtypes,
    ...p.primaryActivities,
    p.series ?? "",
    p.accessoryRole ?? "",
  ];
  // Underscores in tags ("first_person_view") would otherwise survive
  // tokenization and never match a user query — turn them into spaces.
  return parts.join(" ").replace(/_/g, " ");
}

function collectCompatibleText(p: CatalogProduct): string {
  // Models are real multi-word names ("DJI Mini 5 Pro") and benefit
  // from word-level tokenization — searching "mini 5" should hit any
  // accessory whose `compatible_with_models` lists that model.
  const modelText = p.compatibleWithModels.join(" ").replace(/_/g, " ");

  // Compatibility *types* are categorical buckets ("action_camera",
  // "drone", "osmo_action"). Splitting them on `_` causes spurious
  // matches — e.g. a Mini 5 Pro flight battery tagged with
  // `compatible_with_type=["drone","action_camera"]` would otherwise
  // surface for the query "action 5 accessories" because the loose
  // "action" token from `action_camera` clears the AND-gate. Collapse
  // the underscore so each type stays a single atomic token; word-level
  // searches must hit the accessory through name/category/tags instead.
  const typeText = p.compatibleWithType.map((t) => t.replace(/_/g, "")).join(" ");

  return `${modelText} ${typeText}`;
}

function collectDescriptionText(p: CatalogProduct): string {
  return [p.shortDescription, ...p.featureBlocks].join(" ");
}

export function buildSearchIndex(products: CatalogProduct[]): SearchIndex {
  const docs: IndexedDoc[] = products.map((product) => {
    const nameTokenSequence = tokenize(product.title);
    const nameTokens = new Set(nameTokenSequence);
    const categoryTokens = new Set(tokenize(product.category));
    const brandTokens = new Set(tokenize(product.brand));
    const tagTokens = new Set(tokenize(collectTagText(product)));
    const descriptionTokens = new Set(
      tokenize(collectDescriptionText(product)),
    );
    const compatibleTokens = new Set(
      tokenize(collectCompatibleText(product)),
    );
    const compatibleModelTokenSequence = tokenize(
      product.compatibleWithModels.join(" ").replace(/_/g, " "),
    );

    const allTokens = new Set<string>();
    nameTokens.forEach((t) => allTokens.add(t));
    categoryTokens.forEach((t) => allTokens.add(t));
    brandTokens.forEach((t) => allTokens.add(t));
    tagTokens.forEach((t) => allTokens.add(t));
    descriptionTokens.forEach((t) => allTokens.add(t));
    compatibleTokens.forEach((t) => allTokens.add(t));

    return {
      product,
      nameNormalized: normalize(product.title),
      nameTokens,
      categoryTokens,
      brandTokens,
      tagTokens,
      descriptionTokens,
      compatibleTokens,
      nameTokenSequence,
      compatibleModelTokenSequence,
      allTokens,
    };
  });

  const postings = new Map<string, number[]>();
  const tokensByLength = new Map<number, string[]>();
  const seenInVocab = new Set<string>();

  for (let i = 0; i < docs.length; i++) {
    for (const tok of docs[i].allTokens) {
      let list = postings.get(tok);
      if (!list) {
        list = [];
        postings.set(tok, list);
      }
      list.push(i);

      if (!seenInVocab.has(tok)) {
        seenInVocab.add(tok);
        const bucket = tokensByLength.get(tok.length);
        if (bucket) bucket.push(tok);
        else tokensByLength.set(tok.length, [tok]);
      }
    }
  }

  return { docs, tokensByLength, postings };
}

/* -------------------------------------------------------------------------- */
/* Fuzzy matching                                                             */
/* -------------------------------------------------------------------------- */

// Lowered from 4 to 3 so typo correction kicks in one keystroke
// earlier — `mvc` -> `mavic`, `asmo` -> `osmo`, `osmp` -> `osmo` all
// resolve at 3 chars instead of waiting for the 4th. At 3 chars the
// length-bucket prune (within +/- FUZZY_MAX_DISTANCE) keeps the
// candidate set small enough that the Levenshtein cost stays
// negligible at 250 docs.
const FUZZY_MIN_LEN = 3;
const FUZZY_MAX_DISTANCE = 2;

/**
 * Cap on prefix candidates per short query token. Prevents a one-letter
 * prefix that matches dozens of vocab tokens from blowing up the AND-
 * gate's per-doc work. 12 is more than enough to surface every Mavic /
 * Osmo / Avata family member from a 2-char prefix.
 */
const PREFIX_CANDIDATE_LIMIT = 12;

/**
 * Find vocab tokens within `FUZZY_MAX_DISTANCE` of `token`. Skips short
 * tokens (where edit distance is too lax to be useful) and prunes by
 * length difference before paying for a Levenshtein call.
 */
function fuzzyCandidates(token: string, index: SearchIndex): string[] {
  if (token.length < FUZZY_MIN_LEN) return [];
  const out: string[] = [];
  for (
    let len = token.length - FUZZY_MAX_DISTANCE;
    len <= token.length + FUZZY_MAX_DISTANCE;
    len++
  ) {
    if (len < 2) continue;
    const bucket = index.tokensByLength.get(len);
    if (!bucket) continue;
    for (const candidate of bucket) {
      if (candidate === token) continue;
      const d = levenshtein(token, candidate);
      if (d <= FUZZY_MAX_DISTANCE) out.push(candidate);
    }
  }
  return out;
}

/**
 * Prefix-expand a short query token against the indexed vocab. Used as
 * a complement to `fuzzyCandidates` for tokens too short for fuzzy
 * matching (below `FUZZY_MIN_LEN`) — without this, a 2-char query like
 * `os` can never match `osmo` because the inverted index keys on full
 * normalized tokens, not prefixes, and Levenshtein on a 2-char input
 * is too noisy to be useful.
 *
 * Walks `tokensByLength` for buckets of length >= the query token's
 * length, in ascending length order so shorter (more specific) matches
 * surface first. Returns up to `PREFIX_CANDIDATE_LIMIT` candidates so
 * a one-letter prefix can't blow up the per-doc AND-gate work.
 */
function prefixCandidates(token: string, index: SearchIndex): string[] {
  if (!token) return [];
  const out: string[] = [];
  const lengths = Array.from(index.tokensByLength.keys()).sort((a, b) => a - b);
  for (const len of lengths) {
    if (len < token.length) continue;
    const bucket = index.tokensByLength.get(len);
    if (!bucket) continue;
    for (const candidate of bucket) {
      if (candidate === token) continue;
      if (candidate.startsWith(token)) {
        out.push(candidate);
        if (out.length >= PREFIX_CANDIDATE_LIMIT) return out;
      }
    }
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Scoring                                                                    */
/* -------------------------------------------------------------------------- */

/** Per-field weights — kept aligned with the spec in the task description. */
const SCORE = {
  exactNamePhrase: 10,
  partialName: 6,
  category: 5,
  tag: 4,
  brand: 3,
  compatible: 3,
  description: 2,
} as const;

/** Fuzzy hits are real but lower-confidence; halve their contribution. */
const FUZZY_MULTIPLIER = 0.5;

type FieldHit = {
  weight: number;
  fuzzy: boolean;
};

/**
 * Numeric tokens carry real signal in product names ("Mini 5", "Action 5",
 * "RS 4") — they identify a specific model line. They are NOT signal in
 * description text, where they appear as footnote markers ("[5]"),
 * spec fragments ("11.5 Wh", "5° to 40° C"), or counts ("5-axis"). If a
 * doc's only hit for a digit token is the description, that's noise —
 * surfacing it lets queries like "action 5 accessories" leak Action 3 /
 * Mic 3 / Neo 2 products whose copy happens to mention a "5" anywhere.
 *
 * Brand is also excluded because no DJI brand token contains a digit;
 * keeping the rule conservative here just means digit tokens must hit
 * the title, the category, a curated tag, or a compatibility token.
 */
function isNumericToken(token: string): boolean {
  return /^\d+$/.test(token);
}

/**
 * Score a single (token, doc) pair. Returns the highest-weight field hit
 * the token produced — we don't double-count "drone" appearing in both
 * the name and the description, the strongest field wins.
 */
function scoreTokenAgainstDoc(
  token: string,
  doc: IndexedDoc,
  fuzzy: boolean,
): FieldHit | null {
  let best: FieldHit | null = null;
  const consider = (weight: number) => {
    if (best == null || weight > best.weight) best = { weight, fuzzy };
  };

  const numeric = isNumericToken(token);

  if (doc.nameTokens.has(token)) consider(SCORE.partialName);
  if (doc.categoryTokens.has(token)) consider(SCORE.category);
  if (doc.tagTokens.has(token)) consider(SCORE.tag);
  if (!numeric && doc.brandTokens.has(token)) consider(SCORE.brand);
  if (doc.compatibleTokens.has(token)) consider(SCORE.compatible);
  if (!numeric && doc.descriptionTokens.has(token)) consider(SCORE.description);

  return best;
}

/* -------------------------------------------------------------------------- */
/* Phrase / proximity gate                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Matches purely-numeric or alphanumeric-leading-with-digits tokens
 * (e.g. "3", "5", "4k", "2s") — the right-hand side of model-line
 * bigrams DJI uses ("Action 3", "Mavic 4", "Mini 5", "Air 2S").
 */
function looksLikeModelDigit(token: string): boolean {
  return /^\d+[a-z]*$/.test(token);
}

/**
 * Generous so list-style titles like "Osmo Action 5 Pro / 4 / 3"
 * (which tokenize to "osmo action 5 pro 4 3" — gap of 4 between
 * "action" and "3") still satisfy a phrase requirement for "action 3".
 * Anything beyond ~4 starts pulling in incidental co-occurrences
 * across long descriptive titles.
 */
const PHRASE_MAX_GAP = 4;

type PhraseRequirement = {
  /** Original left token (for debugging only — not used to match). */
  left: string;
  /** Original right token. */
  right: string;
  /** Tokens that may stand in for the left position (synonym expansions). */
  leftExpansions: string[];
  /** Tokens that may stand in for the right position. */
  rightExpansions: string[];
};

/**
 * Detect model-line phrases in the original query token sequence.
 *
 * A consecutive pair `(left, right)` is promoted to a phrase
 * requirement when the right token looks like a model-line digit
 * ("3", "4", "5", "4k", "2s"). The gate then enforces that the doc's
 * title OR `compatibleWithModels` list contains both tokens close
 * together — without this, the per-token AND-gate happily admits
 * "Mavic 3" / "Pocket 3" / "Mic 3" docs into "action 3" results
 * because each individual token (action, 3) hits *some* field.
 *
 * Two cases are deliberately skipped:
 *   1. Both tokens numeric ("4 3" — ambiguous, rarely a model).
 *   2. The query has only one token total (no bigrams to form).
 */
function detectModelPhrases(
  originalTokens: string[],
  expansionsByToken: Map<string, string[]>,
): PhraseRequirement[] {
  const phrases: PhraseRequirement[] = [];
  for (let i = 0; i < originalTokens.length - 1; i++) {
    const left = originalTokens[i];
    const right = originalTokens[i + 1];
    if (!looksLikeModelDigit(right)) continue;
    if (looksLikeModelDigit(left)) continue;
    phrases.push({
      left,
      right,
      leftExpansions: expansionsByToken.get(left) ?? [left],
      rightExpansions: expansionsByToken.get(right) ?? [right],
    });
  }
  return phrases;
}

/**
 * True iff `seq` contains `left` followed by `right` with at most
 * `maxGap` intervening tokens. `right` must come AFTER `left` —
 * model names are written in a fixed order ("Action 3", never
 * "3 Action") so order-preservation is the right semantic.
 */
function hasOrderedPair(
  seq: string[],
  left: string,
  right: string,
  maxGap: number,
): boolean {
  for (let i = 0; i < seq.length; i++) {
    if (seq[i] !== left) continue;
    const limit = Math.min(seq.length - 1, i + 1 + maxGap);
    for (let j = i + 1; j <= limit; j++) {
      if (seq[j] === right) return true;
    }
  }
  return false;
}

/**
 * A doc satisfies a phrase requirement when at least one
 * (leftExpansion, rightExpansion) pair occurs in proximity in either
 * the title or the compatibility-models list. We check both because
 * accessories often only repeat the host model in their compatibility
 * column ("compatibleWithModels: ['DJI Mini 5 Pro']") rather than in
 * their own title.
 */
function docSatisfiesPhrase(
  doc: IndexedDoc,
  phrase: PhraseRequirement,
): boolean {
  for (const left of phrase.leftExpansions) {
    for (const right of phrase.rightExpansions) {
      if (
        hasOrderedPair(doc.nameTokenSequence, left, right, PHRASE_MAX_GAP) ||
        hasOrderedPair(
          doc.compatibleModelTokenSequence,
          left,
          right,
          PHRASE_MAX_GAP,
        )
      ) {
        return true;
      }
    }
  }
  return false;
}

/* -------------------------------------------------------------------------- */
/* Public search API                                                          */
/* -------------------------------------------------------------------------- */

export type SearchSuggestions = {
  /** Top product names — suitable for an autocomplete dropdown. */
  products: { slug: string; title: string; score: number }[];
  /** Distinct categories present in the top results. */
  categories: string[];
};

export type SearchResult = {
  query: string;
  normalizedQuery: string;
  /** Tokens after stop-word removal + synonym expansion. Useful for debugging. */
  expandedTokens: string[];
  /** Products ranked by score (descending). Score-zero products are excluded. */
  results: CatalogProduct[];
  suggestions: SearchSuggestions;
};

/**
 * Ranking tier used as a tied-score tie-breaker. Lower = surfaces
 * earlier. Cores are the bare flagship SKU ("DJI Mavic 4 Pro"),
 * bundles are combo/kit packages built around a core ("...Fly More
 * Combo"), and accessories are peripherals (cases, batteries, mounts,
 * filters). Without this layer, queries like "mavic" — where every
 * Mavic SKU ties at name+phrase=16 — fell back to rating, which let
 * an Air 2S accessory case outrank the Mavic 4 Pro itself.
 *
 * `isAccessory` is checked first so accessory-flagged kits (e.g.
 * "DJI Mic Kit") don't accidentally promote into the bundle tier.
 */
function rankingTier(product: CatalogProduct): 0 | 1 | 2 {
  if (product.isAccessory) return 2;
  if (product.isBundle) return 1;
  return 0;
}

/**
 * Run a search against an index. Stable ordering: score desc, then
 * tier asc (core < bundle < accessory), then rating desc, then review
 * count desc — guarantees deterministic output for equally-scored
 * products and keeps the flagship SKU above its bundles / accessories
 * when nothing in the query disambiguates them.
 */
export function search(index: SearchIndex, rawQuery: string): SearchResult {
  const normalizedQuery = normalize(rawQuery);
  if (!normalizedQuery) {
    return {
      query: rawQuery,
      normalizedQuery: "",
      expandedTokens: [],
      results: [],
      suggestions: { products: [], categories: [] },
    };
  }

  const { originalTokens, expansionsByToken, expandedTokens } =
    buildQueryPlan(rawQuery);
  if (originalTokens.length === 0) {
    return {
      query: rawQuery,
      normalizedQuery,
      expandedTokens: [],
      results: [],
      suggestions: { products: [], categories: [] },
    };
  }

  // Resolve fuzzy fallbacks once per expansion (not once per doc) across
  // every token group. Pulling from the flat `expandedTokens` list
  // dedupes naturally — the same expansion shared by two originals only
  // pays for one Levenshtein scan.
  //
  // When fuzzy returns nothing (because the token is too short for
  // Levenshtein to be useful, < FUZZY_MIN_LEN) we fall back to prefix
  // expansion against the vocab. Without this, a 2-char query like
  // `os` can never match `osmo` because the inverted index keys on
  // full tokens. Prefix candidates ride the same fuzzy fallback rail
  // in the scoring loop below, so they already get the
  // FUZZY_MULTIPLIER weight reduction (0.5x) — exact matches still
  // outrank them.
  const fuzzyByToken = new Map<string, string[]>();
  for (const t of expandedTokens) {
    if (index.postings.has(t)) continue;
    const fuzzy = fuzzyCandidates(t, index);
    if (fuzzy.length > 0) {
      fuzzyByToken.set(t, fuzzy);
    } else {
      fuzzyByToken.set(t, prefixCandidates(t, index));
    }
  }

  // Phrase-proximity gate. Model-line bigrams in the query ("action 3",
  // "mavic 4", "mini 5") must co-occur in the doc's title or
  // compatibility-models list — otherwise the per-token AND-gate below
  // happily admits Mavic 3 / Pocket 3 / Mic 3 into "action 3" results
  // (each token hits *some* field independently). Computed once per
  // query, then checked per doc inside the main scoring loop.
  const phraseRequirements = detectModelPhrases(
    originalTokens,
    expansionsByToken,
  );

  const scores = new Float64Array(index.docs.length);
  // Parallel inclusion array — only docs whose every original token was
  // satisfied by at least one expansion (or its fuzzy fallback) qualify.
  // Avoids the historical OR-leak where a single weak token hit (e.g.
  // category="Accessories" alone) could float unrelated products into
  // the result list.
  const included = new Uint8Array(index.docs.length);

  for (let i = 0; i < index.docs.length; i++) {
    const doc = index.docs[i];

    // Phrase gate runs before per-token scoring — cheap rejection lets
    // us skip the heavier AND-gate work for the majority of docs that
    // don't carry the queried model anywhere near each other.
    if (phraseRequirements.length > 0) {
      let phrasesOk = true;
      for (const phrase of phraseRequirements) {
        if (!docSatisfiesPhrase(doc, phrase)) {
          phrasesOk = false;
          break;
        }
      }
      if (!phrasesOk) continue;
    }

    let docScore = 0;
    let allSatisfied = true;

    // Per-original-token scoring. Each group contributes its single
    // best field hit — synonyms are alternative spellings of the same
    // intent, not additive evidence, so we don't double-count a doc
    // that happens to mention "drone" *and* "quadcopter".
    for (const original of originalTokens) {
      const expansions = expansionsByToken.get(original)!;
      let bestHit: FieldHit | null = null;

      for (const exp of expansions) {
        const exact = scoreTokenAgainstDoc(exp, doc, false);
        if (exact && (bestHit == null || exact.weight > bestHit.weight)) {
          bestHit = exact;
        }
      }

      // Fall back to fuzzy candidates only when no exact expansion hit
      // landed for this token group. Halve the weight per FUZZY_MULTIPLIER.
      if (bestHit == null) {
        for (const exp of expansions) {
          const fuzz = fuzzyByToken.get(exp);
          if (!fuzz || fuzz.length === 0) continue;
          for (const candidate of fuzz) {
            const fuzzyHit = scoreTokenAgainstDoc(candidate, doc, true);
            if (!fuzzyHit) continue;
            const weighted = fuzzyHit.weight * FUZZY_MULTIPLIER;
            if (bestHit == null || weighted > bestHit.weight) {
              bestHit = { weight: weighted, fuzzy: true };
            }
          }
        }
      }

      if (bestHit == null) {
        allSatisfied = false;
        break;
      }
      docScore += bestHit.weight;
    }

    if (!allSatisfied) continue;

    // Exact phrase bonus stacks on top of the per-token sum and only
    // fires when the full normalized query appears in the product name.
    // Safe to add after the AND gate — a phrase match implies every
    // token already hit the name field anyway.
    if (
      normalizedQuery.length >= 3 &&
      doc.nameNormalized.includes(normalizedQuery)
    ) {
      docScore += SCORE.exactNamePhrase;
    }

    scores[i] = docScore;
    included[i] = 1;
  }

  type Ranked = { idx: number; score: number };
  const ranked: Ranked[] = [];
  for (let i = 0; i < scores.length; i++) {
    if (included[i] && scores[i] > 0) ranked.push({ idx: i, score: scores[i] });
  }

  ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const pa = index.docs[a.idx].product;
    const pb = index.docs[b.idx].product;
    // Tier tie-breaker: core (0) < bundle (1) < accessory (2). Only
    // fires when raw scores are equal — strong accessory matches
    // ("mavic case", "mini battery") still win on score alone.
    const tierDelta = rankingTier(pa) - rankingTier(pb);
    if (tierDelta !== 0) return tierDelta;
    const ratingDelta = (pb.rating ?? 0) - (pa.rating ?? 0);
    if (ratingDelta !== 0) return ratingDelta;
    return (pb.reviewCount ?? 0) - (pa.reviewCount ?? 0);
  });

  const results = ranked.map((r) => index.docs[r.idx].product);

  // Suggestions — top 5 product names + top 3 distinct categories,
  // both pulled from the same ranked pool so they stay consistent
  // with the result set.
  const productSuggestions = ranked.slice(0, 5).map((r) => ({
    slug: index.docs[r.idx].product.slug,
    title: index.docs[r.idx].product.title,
    score: r.score,
  }));

  const categories: string[] = [];
  const seenCategories = new Set<string>();
  for (const r of ranked) {
    const cat = index.docs[r.idx].product.category;
    if (!cat || seenCategories.has(cat)) continue;
    seenCategories.add(cat);
    categories.push(cat);
    if (categories.length >= 3) break;
  }

  return {
    query: rawQuery,
    normalizedQuery,
    expandedTokens,
    results,
    suggestions: {
      products: productSuggestions,
      categories,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Did-you-mean suggestions                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Best-effort spelling correction. For a query whose `search()` call
 * returned zero results — typically because the user mistyped a model
 * name or product term — try to replace each missing token with the
 * closest vocab match (Levenshtein distance ≤ {@link FUZZY_MAX_DISTANCE}).
 *
 * Returns the corrected query as a plain string when at least one
 * token was actually swapped and the rebuilt query differs from the
 * input. Returns `null` when every token already exists in the vocab
 * or no fuzzy candidate exists for the unknown ones (so callers can
 * decide whether to render a "Did you mean: …" prompt).
 *
 * Tokens already present in `index.postings` are kept verbatim — they
 * exist in the catalog, so the user wasn't typing a typo for them.
 * Among multiple equidistant candidates we prefer the one with the
 * highest posting-list size (more frequent in the catalog → more
 * likely the user's intent).
 */
export function suggestQueryCorrection(
  index: SearchIndex,
  rawQuery: string,
): string | null {
  const tokens = tokenize(rawQuery);
  if (tokens.length === 0) return null;

  let changed = false;
  const corrected: string[] = [];

  for (const token of tokens) {
    if (index.postings.has(token)) {
      corrected.push(token);
      continue;
    }
    const candidates = fuzzyCandidates(token, index);
    if (candidates.length === 0) {
      corrected.push(token);
      continue;
    }

    let best = candidates[0];
    let bestDist = levenshtein(token, best);
    let bestFreq = index.postings.get(best)?.length ?? 0;
    for (let i = 1; i < candidates.length; i++) {
      const cand = candidates[i];
      const dist = levenshtein(token, cand);
      const freq = index.postings.get(cand)?.length ?? 0;
      if (dist < bestDist || (dist === bestDist && freq > bestFreq)) {
        best = cand;
        bestDist = dist;
        bestFreq = freq;
      }
    }
    corrected.push(best);
    changed = true;
  }

  if (!changed) return null;
  const out = corrected.join(" ");
  return out !== normalize(rawQuery) ? out : null;
}
