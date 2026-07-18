#!/usr/bin/env bash
# Safer "fresh start" for the Vite dev server.
#
# The old `npm run dev:fresh` was `kill:dev && dev` — which `kill -9`s
# anything on port 5173 unconditionally. When two agent panes both ran
# `dev:fresh` they ping-ponged each other's Vite to death and the user
# was left with ERR_CONNECTION_REFUSED.
#
# This wrapper first checks whether a healthy Vite is already serving
# on 5173. If yes, it bails out (preserving the running server) and
# nudges the user to refresh the browser instead. If no, it falls
# through to the original kill-and-restart behavior.
#
# Override with FORCE=1 to skip the health check (e.g. when the running
# server is genuinely wedged and you want a clean restart).

set -u

PORT=5173
URL="http://localhost:${PORT}/"

if [[ "${FORCE:-0}" != "1" ]]; then
  if curl --silent --output /dev/null --max-time 2 --fail "$URL" \
      || curl --silent --output /dev/null --max-time 2 "$URL"; then
    # Either a 2xx (--fail succeeds) or any HTTP response at all
    # (Vite returning a 404 still proves the server is alive).
    echo "[dev:fresh] Vite already serving on :${PORT}. Skipping kill+restart."
    echo "[dev:fresh] Refresh the browser, or run with FORCE=1 to force a clean restart:"
    echo "[dev:fresh]   FORCE=1 npm run dev:fresh"
    exit 0
  fi
fi

echo "[dev:fresh] No live server detected on :${PORT}. Killing stragglers and starting fresh."
npm run kill:dev
exec npm run dev
