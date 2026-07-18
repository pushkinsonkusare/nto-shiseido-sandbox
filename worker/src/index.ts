/* =============================================================
 * Cloudflare Worker — OpenAI proxy for the SA26 GitHub Pages site.
 *
 * Goal: keep the OpenAI API key OUT of the public browser bundle.
 * The frontend is built with `VITE_LLM_PROXY_URL=<this worker>` and
 * sends every LLM request here; the Worker rewrites the
 * `Authorization` header with the secret key before forwarding to
 * `api.openai.com`. The browser never sees the key.
 *
 * Surface (allowlist; everything else 404s):
 *   POST /v1/chat/completions       — JSON, used by every chat caller
 *   POST /v1/audio/transcriptions   — multipart/form-data, used by
 *                                      Whisper in useSpeechRecognition
 *
 * CORS:
 *   Origin allowlist is configured via the `ALLOWED_ORIGINS`
 *   wrangler var (comma-separated). Requests from any other origin
 *   get a 403. OPTIONS preflight gets the standard CORS headers.
 *
 * Streaming:
 *   The upstream response body is piped back unmodified, so SSE
 *   stream responses (`stream: true`) work end-to-end. Headers are
 *   copied verbatim except for CORS, which we inject.
 *
 * Hardening (intentionally minimal — extend as you need):
 *   - Method allowlist (POST only on data routes; OPTIONS for
 *     preflight).
 *   - Path allowlist (closed set; 404 anything else).
 *   - Header allowlist on the upstream request (we don't forward
 *     arbitrary headers from the browser).
 *   - 1 MiB body cap on JSON (Whisper audio is exempt — Whisper
 *     accepts up to ~25 MiB per request).
 *
 * Things this Worker does NOT do (yet):
 *   - Per-IP rate limiting (use Cloudflare's built-in rules or a
 *     KV-backed counter if abuse becomes a problem).
 *   - User auth (the prototype has no notion of users).
 *   - Request logging beyond what `[observability]` already gives.
 * ============================================================= */

export interface Env {
  /** Secret. Set via `wrangler secret put OPENAI_API_KEY`. */
  OPENAI_API_KEY: string;
  /** Comma-separated list of allowed Origin header values. Set in
   *  wrangler.toml `[vars]` so it can be edited without redeploy
   *  on a per-environment basis. */
  ALLOWED_ORIGINS: string;
}

const ALLOWED_PATHS = new Set([
  "/v1/chat/completions",
  "/v1/audio/transcriptions",
]);

/* Forwarded to upstream verbatim. Anything else from the browser
 * is dropped — keeps the surface area small and removes an attack
 * vector for header injection. */
const FORWARDABLE_HEADERS = new Set([
  "content-type",
  "accept",
  "openai-beta",
  "openai-organization",
]);

/* Headers the browser is allowed to send on requests to us. Must
 * be a SUPERSET of FORWARDABLE_HEADERS plus any "decorative" headers
 * the SDK sets that we don't actually forward but the browser still
 * needs the server to acknowledge during the CORS preflight.
 *
 * `authorization`: the OpenAI JS SDK always sets this (with a
 * placeholder value in proxy mode) and the browser's preflight will
 * fail unless the server says it's allowed. The Worker still
 * overwrites it with the real key from the OPENAI_API_KEY secret
 * before forwarding upstream — this allowlist exists purely so the
 * preflight passes. */
const CORS_ALLOWED_REQUEST_HEADERS = new Set([
  ...FORWARDABLE_HEADERS,
  "authorization",
]);

const JSON_BODY_LIMIT_BYTES = 1 * 1024 * 1024; // 1 MiB
const AUDIO_BODY_LIMIT_BYTES = 26 * 1024 * 1024; // 26 MiB (Whisper hard-caps near 25)

function parseOriginAllowlist(raw: string): Set<string> {
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

function buildCorsHeaders(origin: string, allowed: Set<string>): Record<string, string> {
  /* Echo the request Origin only when it's allowlisted. Browsers
   * reject responses where the echoed Origin doesn't match the
   * request, so a wildcard fallback would just produce confusing
   * errors. Empty string when not allowed → caller returns 403. */
  const allowOrigin = allowed.has(origin) ? origin : "";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": [...CORS_ALLOWED_REQUEST_HEADERS].join(", "),
    /* Short-ish preflight cache so any future change to the
     * allowlist propagates within minutes instead of staying
     * stuck for 24 hours on every browser that previously hit
     * us. The chat completions endpoint is idempotent enough
     * that re-issuing a preflight every 10 min costs nothing. */
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

function jsonError(
  status: number,
  message: string,
  corsHeaders: Record<string, string>,
): Response {
  return new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: {
      "content-type": "application/json",
      ...corsHeaders,
    },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") ?? "";
    const allowedOrigins = parseOriginAllowlist(env.ALLOWED_ORIGINS ?? "");
    const corsHeaders = buildCorsHeaders(origin, allowedOrigins);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (!allowedOrigins.has(origin)) {
      return jsonError(403, "Origin not allowed", corsHeaders);
    }

    if (request.method !== "POST") {
      return jsonError(405, "Method not allowed", corsHeaders);
    }

    if (!ALLOWED_PATHS.has(url.pathname)) {
      return jsonError(404, "Not found", corsHeaders);
    }

    if (!env.OPENAI_API_KEY) {
      return jsonError(500, "Proxy missing OPENAI_API_KEY secret", corsHeaders);
    }

    /* Body-size guard. We could stream and count bytes, but the
     * Content-Length header is sufficient for Workers (the runtime
     * rejects oversized requests at the edge anyway). */
    const contentLength = Number(request.headers.get("content-length") ?? "0");
    const isAudio = url.pathname === "/v1/audio/transcriptions";
    const limit = isAudio ? AUDIO_BODY_LIMIT_BYTES : JSON_BODY_LIMIT_BYTES;
    if (contentLength > limit) {
      return jsonError(413, "Payload too large", corsHeaders);
    }

    /* Build upstream headers from a strict allowlist so the browser
     * can't smuggle e.g. an `Authorization` override. We always
     * inject our own Authorization last. */
    const upstreamHeaders = new Headers();
    for (const [name, value] of request.headers) {
      if (FORWARDABLE_HEADERS.has(name.toLowerCase())) {
        upstreamHeaders.set(name, value);
      }
    }
    upstreamHeaders.set("Authorization", `Bearer ${env.OPENAI_API_KEY}`);

    const upstreamUrl = `https://api.openai.com${url.pathname}${url.search}`;

    let upstreamResponse: Response;
    try {
      upstreamResponse = await fetch(upstreamUrl, {
        method: "POST",
        headers: upstreamHeaders,
        body: request.body,
        /* Workers fetch requires `duplex: "half"` whenever the body
         * is a stream (which it is for multipart Whisper uploads).
         * Harmless for JSON bodies. Cast through unknown because the
         * RequestInit type in the Workers types lib doesn't yet
         * expose `duplex`. */
        ...({ duplex: "half" } as unknown as RequestInit),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Upstream fetch failed";
      return jsonError(502, message, corsHeaders);
    }

    /* Stream the response body back to the browser. Copy upstream
     * headers, then overwrite CORS so the browser accepts the
     * response. Drop hop-by-hop headers (Workers handles this for
     * us, but being explicit is cheap). */
    const respHeaders = new Headers(upstreamResponse.headers);
    for (const [k, v] of Object.entries(corsHeaders)) {
      respHeaders.set(k, v);
    }

    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: respHeaders,
    });
  },
};
