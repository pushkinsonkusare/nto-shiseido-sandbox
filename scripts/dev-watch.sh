#!/usr/bin/env bash
# Supervised Vite dev server.
#
# Why this exists: bare `vite` would die silently (OOM SIGKILL, stale port
# holders, accidental Ctrl-C in the wrong terminal) and leave the user with
# ERR_CONNECTION_REFUSED on http://localhost:5173. This wrapper keeps Vite
# up: it pre-clears the port, runs Vite in the foreground with a generous
# heap, and re-spawns it on any non-clean exit. Use `npm run dev:once` if
# you want the old single-shot behavior for debugging.
#
# Resilience notes (all hard-won from real failures in this repo):
#   1. SIGHUP and SIGTERM are both ignored. Cursor recycles its terminal
#      panes when an agent task ends / chat is switched, which sends one
#      of these signals to whatever's running in the pane. Without these
#      traps the wrapper dies between agent turns and the user sees
#      ERR_CONNECTION_REFUSED in the browser preview after every CSS
#      change. Confirmed in real terminal logs where Vite happily served
#      HMR for an hour, then took a SIGTERM from outside and went away.
#   2. **Restart on exit_code 0, too.** The wrapper traps HUP/TERM so
#      it stays alive across pane recycles, but those signals still
#      reach the child Vite process — Vite handles them gracefully and
#      exits with code 0. An earlier version of this script treated
#      code 0 as "user wanted to stop" and shut down the watcher. That
#      reintroduced the exact ERR_CONNECTION_REFUSED-after-every-edit
#      symptom this wrapper exists to prevent (real recurrence: HMR
#      update → pane recycled → SIGTERM → Vite exits 0 → watcher quit).
#      The wrapper's intentional stop channels are SIGINT and SIGUSR1,
#      both handled by traps that `exit 0` from cleanup() *before* the
#      restart loop body sees the exit code. So if the loop body sees
#      code 0, it is unambiguously Vite dying on its own — restart.
#   3. SIGUSR1 is the *only* signal that gracefully tears the wrapper
#      down. `npm run dev:stop` sends it. This decouples "stop the dev
#      server" from "the editor pane closed".
#   4. SIGINT (Ctrl-C) still tears down cleanly so interactive use from
#      a real terminal feels normal.
#   5. PID lockfile (.dev-watch.pid). If a previous wrapper is still alive
#      we stop it first (via SIGUSR1, then SIGKILL fallback) so two
#      wrappers don't race for port 5173 and ping-pong each other to
#      death.
#   6. Crash-loop guard. If Vite itself dies 5+ times in 30s we bail
#      rather than burn CPU forever on a broken build. Code-0 exits
#      count too, so a real bug that makes Vite exit cleanly in a loop
#      doesn't hide behind the "graceful exit = restart" rule above.
#   7. Exit-code interpretation. 137/143/130/0 are decoded so the log
#      says "SIGKILL (likely `npm run kill:dev` from another terminal)"
#      rather than just "exited with code 137".

set -u

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

PORT="${VITE_PORT:-5173}"
HOST="${VITE_HOST:-0.0.0.0}"
HEAP_MB="${VITE_HEAP_MB:-8192}"
RESTART_DELAY="${VITE_RESTART_DELAY:-2}"
LOCK_FILE="$REPO_ROOT/.dev-watch.pid"

HOST_ARG_PRESENT=false
for arg in "$@"; do
  if [[ "$arg" == "--host" ]] || [[ "$arg" == --host=* ]]; then
    HOST_ARG_PRESENT=true
    break
  fi
done

# Cursor's pane recycling sends SIGHUP and/or SIGTERM. Ignore both so the
# dev server keeps running across agent task boundaries, chat switches,
# and pane closes. To actually stop the wrapper, use:
#   npm run dev:stop          (sends SIGUSR1, then SIGKILL fallback)
#   kill -USR1 <wrapper-pid>  (same thing, by hand)
#   kill -9 <wrapper-pid>     (last resort)
trap '' HUP TERM

cleanup() {
  local sig="$1"
  echo ""
  echo "[dev-watch] Caught SIG${sig} (wrapper pid=$$ ppid=$PPID). Shutting down Vite (pid=${VITE_PID:-none})..."
  if [[ -n "${VITE_PID:-}" ]] && kill -0 "$VITE_PID" 2>/dev/null; then
    kill -TERM "$VITE_PID" 2>/dev/null || true
    for _ in 1 2 3; do
      sleep 1
      kill -0 "$VITE_PID" 2>/dev/null || break
    done
    kill -KILL "$VITE_PID" 2>/dev/null || true
  fi
  rm -f "$LOCK_FILE"
  exit 0
}
# SIGINT (Ctrl-C in an interactive terminal) and SIGUSR1 (programmatic
# shutdown via `npm run dev:stop`) are the two real exit channels.
trap 'cleanup INT' INT
trap 'cleanup USR1' USR1

# If a previous wrapper is still alive (orphaned by a SIGHUP/SIGTERM we
# now ignore, or just left over from a previous Cursor session), take it
# over instead of letting two wrappers fight over port 5173. We send
# SIGUSR1 (the wrapper's documented graceful-shutdown signal), then fall
# back to SIGKILL if it doesn't go away within ~5s.
if [[ -f "$LOCK_FILE" ]]; then
  prev_pid="$(cat "$LOCK_FILE" 2>/dev/null || true)"
  if [[ -n "$prev_pid" ]] && kill -0 "$prev_pid" 2>/dev/null && [[ "$prev_pid" != "$$" ]]; then
    echo "[dev-watch] Another wrapper is running (pid=$prev_pid). Stopping it first."
    kill -USR1 "$prev_pid" 2>/dev/null || true
    for _ in 1 2 3 4 5; do
      sleep 1
      kill -0 "$prev_pid" 2>/dev/null || break
    done
    kill -KILL "$prev_pid" 2>/dev/null || true
  fi
fi
echo "$$" > "$LOCK_FILE"

# Crash-loop detector. Each entry is a unix timestamp; we keep only the
# last 30s of crashes and bail if there are 5+.
CRASH_TIMES=()

attempt=0
while true; do
  attempt=$((attempt + 1))

  # Free the port. Anything still bound here is a stale Vite (or a stray
  # `npm run dev` from another terminal) — kill it so strictPort doesn't
  # bounce us.
  holders="$(lsof -ti tcp:"$PORT" 2>/dev/null || true)"
  if [[ -n "$holders" ]]; then
    echo "[dev-watch] Port $PORT busy (pids: $holders) — killing."
    echo "$holders" | xargs kill -9 2>/dev/null || true
    sleep 1
  fi

  echo "[dev-watch] Attempt #${attempt} — starting Vite ($(date '+%H:%M:%S')) heap=${HEAP_MB}MB host=${HOST} port=${PORT} wrapper_pid=$$"

  if [[ "$HOST_ARG_PRESENT" == "true" ]]; then
    node --max-old-space-size="$HEAP_MB" ./node_modules/vite/bin/vite.js "$@" &
  else
    node --max-old-space-size="$HEAP_MB" ./node_modules/vite/bin/vite.js --host "$HOST" "$@" &
  fi
  VITE_PID=$!
  wait "$VITE_PID"
  exit_code=$?
  unset VITE_PID

  # IMPORTANT: do NOT stop the watcher on exit_code 0.
  #
  # The wrapper traps HUP/TERM (above) so Cursor pane recycling can't
  # take it down — but those signals still reach the *child* Vite
  # process, which handles them gracefully and exits with code 0.
  # Treating code 0 as "user wanted to stop" was the literal cause of
  # the ERR_CONNECTION_REFUSED-after-every-edit bug this wrapper was
  # built to prevent. The wrapper's intentional stop channels are
  # SIGINT and SIGUSR1, both handled by `trap`s that `exit 0` from
  # cleanup() before this branch can run. So if we see exit_code 0
  # *here*, it is by definition Vite dying on its own — restart it.
  case "$exit_code" in
    0)   reason="clean exit (code 0, almost certainly SIGTERM/SIGHUP from pane recycling — restarting)";;
    130) reason="SIGINT (Ctrl-C)";;
    137) reason="SIGKILL (likely \`npm run kill:dev\` from another terminal, or OOM)";;
    143) reason="SIGTERM";;
    *)   reason="exit code $exit_code";;
  esac
  echo "[dev-watch] Vite died: ${reason} at $(date '+%H:%M:%S')."

  now=$(date +%s)
  CRASH_TIMES+=("$now")
  # Drop crash timestamps older than 30s.
  while (( ${#CRASH_TIMES[@]} > 0 )) && (( now - CRASH_TIMES[0] > 30 )); do
    CRASH_TIMES=("${CRASH_TIMES[@]:1}")
  done
  if (( ${#CRASH_TIMES[@]} >= 5 )); then
    echo "[dev-watch] Vite died ${#CRASH_TIMES[@]} times in <30s — giving up so this stops looking like a hang."
    echo "[dev-watch] Investigate the last error above, then re-run \`npm run dev:fresh\`."
    rm -f "$LOCK_FILE"
    exit 1
  fi

  echo "[dev-watch] Restarting in ${RESTART_DELAY}s... (Ctrl-C to stop)"
  sleep "$RESTART_DELAY"
done
