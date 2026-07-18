# sa26-llm-proxy

A tiny Cloudflare Worker that proxies OpenAI requests for the public
GitHub Pages build of the SA26 frontend. The OpenAI API key lives as
a Worker secret and is injected into outbound requests server-side, so
the browser bundle never sees it.

## What it does

- Allowlists exactly two upstream paths:
  - `POST /v1/chat/completions` (every chat caller in the app)
  - `POST /v1/audio/transcriptions` (Whisper, used by the Wingman mic)
- CORS-allowlists `https://pushkinsonkusare.github.io` plus `localhost:5173`
  for local dev. Requests from any other origin → 403.
- Forwards the request body unchanged (streaming-safe, so SSE chat
  responses work).
- Strips browser-supplied `Authorization` headers and replaces them with
  `Bearer ${OPENAI_API_KEY}` from the Worker secret.

## One-time deployment

You need a free Cloudflare account.

```bash
cd worker
npm install
npx wrangler login          # opens browser; sign in to Cloudflare
npx wrangler secret put OPENAI_API_KEY
                            # paste your sk-... key when prompted
npx wrangler deploy
```

The last command prints the deployed URL, e.g.:

```
https://sa26-llm-proxy.<your-subdomain>.workers.dev
```

Copy that URL — you'll feed it to the frontend build.

## Wire the frontend up

In the **frontend repo root** (one directory up from this `worker/` folder),
build with the proxy URL inlined:

```bash
VITE_LLM_PROXY_URL=https://sa26-llm-proxy.<your-subdomain>.workers.dev \
  npm run build
git add docs && git commit -m "deploy: wire frontend to LLM proxy" && git push
```

The Vite build resolves `import.meta.env.VITE_LLM_PROXY_URL` at compile
time, so the URL ends up baked into `docs/assets/index-*.js`. Pages
auto-rebuilds on push (~30 s) and the deployed site will start hitting
the Worker for every LLM call.

## Updating

- **Code changes:** edit `src/index.ts`, run `npx wrangler deploy`.
- **Rotate the key:** `npx wrangler secret put OPENAI_API_KEY` (overwrites).
- **Inspect logs:** `npx wrangler tail` (live request stream).
- **Add an origin:** edit `ALLOWED_ORIGINS` in `wrangler.toml`,
  redeploy. (No Worker code change needed.)

## Hardening checklist (when this stops being a prototype)

- [ ] Rate limit per-IP — Cloudflare Rules (free tier) or a KV-backed
      counter inside the Worker. Spike-protection is the main concern;
      one user shouldn't be able to drain your OpenAI budget.
- [ ] Restrict `Origin` header to your prod hostname only (drop
      `localhost` from the allowlist on a separate prod env).
- [ ] Tighten the upstream path allowlist if you stop using one of the
      endpoints. Smaller surface = fewer footguns.
- [ ] If you ever bind a custom domain, also enforce
      `Sec-Fetch-Site: same-site` to filter direct curl traffic.
