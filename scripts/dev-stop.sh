#!/usr/bin/env bash
# Stop the supervised Vite dev server started by `npm run dev`.
#
# Why this exists: dev-watch.sh now intentionally ignores SIGHUP and
# SIGTERM so it survives Cursor recycling its terminal panes between
# agent turns (without that, every CSS/JSX edit ended with the user
# staring at ERR_CONNECTION_REFUSED in the browser preview). The
# trade-off is that the wrapper no longer exits when its launching
# pane closes — you need an explicit "stop" command to take it down.
#
# This script:
#   1. Reads the wrapper PID from .dev-watch.pid.
#   2. Sends SIGUSR1 — the wrapper's documented graceful-shutdown
#      channel. The wrapper tears down Vite, removes the lock file,
#      and exits cleanly.
#   3. Falls back to SIGKILL after ~5s if the wrapper is wedged.
#   4. As a final safety net, frees port 5173 of any straggler Vite
#      that survived the wrapper.

set -u

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCK_FILE="$REPO_ROOT/.dev-watch.pid"
PORT="${VITE_PORT:-5173}"

stopped_anything=0

if [[ -f "$LOCK_FILE" ]]; then
  wrapper_pid="$(cat "$LOCK_FILE" 2>/dev/null || true)"
  if [[ -n "$wrapper_pid" ]] && kill -0 "$wrapper_pid" 2>/dev/null; then
    echo "[dev:stop] Sending SIGUSR1 to dev-watch wrapper (pid=$wrapper_pid)..."
    kill -USR1 "$wrapper_pid" 2>/dev/null || true
    for _ in 1 2 3 4 5; do
      sleep 1
      kill -0 "$wrapper_pid" 2>/dev/null || break
    done
    if kill -0 "$wrapper_pid" 2>/dev/null; then
      echo "[dev:stop] Wrapper didn't exit on SIGUSR1, escalating to SIGKILL."
      kill -KILL "$wrapper_pid" 2>/dev/null || true
    fi
    stopped_anything=1
  else
    # Lockfile exists but the pid in it is dead — clean it up so the
    # next `npm run dev` doesn't think a wrapper is still alive.
    rm -f "$LOCK_FILE"
  fi
else
  echo "[dev:stop] No .dev-watch.pid found (no wrapper appears to be running)."
fi

# Even if the wrapper is gone, a Vite child can occasionally outlive it
# (e.g. if it was started bare via `npm run dev:once` or a previous
# version of the scripts). Free the port either way.
holders="$(lsof -ti tcp:"$PORT" 2>/dev/null || true)"
if [[ -n "$holders" ]]; then
  echo "[dev:stop] Freeing port $PORT (pids: $holders)..."
  echo "$holders" | xargs kill -9 2>/dev/null || true
  stopped_anything=1
fi

rm -f "$LOCK_FILE"

if [[ "$stopped_anything" -eq 1 ]]; then
  echo "[dev:stop] Dev server stopped."
else
  echo "[dev:stop] Nothing was running."
fi
