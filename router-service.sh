#!/usr/bin/env bash
set -euo pipefail

SOURCE_PATH="${BASH_SOURCE[0]}"
while [[ -L "$SOURCE_PATH" ]]; do
  SOURCE_DIR="$(cd -- "$(dirname -- "$SOURCE_PATH")" && pwd)"
  SOURCE_PATH="$(readlink "$SOURCE_PATH")"
  [[ "$SOURCE_PATH" = /* ]] || SOURCE_PATH="$SOURCE_DIR/$SOURCE_PATH"
done
SCRIPT_DIR="$(cd -- "$(dirname -- "$SOURCE_PATH")" && pwd)"

if [[ -f "$SCRIPT_DIR/.env" ]]; then
  set -a
  source "$SCRIPT_DIR/.env"
  set +a
fi

PORT="${ROUTER_PORT:-8788}"
RUNTIME_DIR="${ROUTER_RUNTIME_DIR:-$HOME/.local/share/gpt-5.6-router-cli}"
LOG_FILE="$RUNTIME_DIR/router.log"
ERROR_LOG_FILE="$RUNTIME_DIR/router-error.log"
PID_FILE="$RUNTIME_DIR/router.pid"
NODE_BIN="${NODE_BIN:-node}"

is_ready() {
  local health
  health="$(curl -fsS --max-time 2 "http://127.0.0.1:$PORT/health" 2>/dev/null || true)"
  [[ "$health" == *'"service":"gpt-5.6-router-cli"'* ]]
}

read_pid() {
  [[ -f "$PID_FILE" ]] || return 1
  local pid
  pid="$(<"$PID_FILE")"
  [[ "$pid" =~ ^[0-9]+$ ]] || return 1
  printf '%s' "$pid"
}

case "${1:-status}" in
  start)
    if is_ready; then
      echo "Router service is already running at http://127.0.0.1:$PORT"
      exit 0
    fi

    command -v "$NODE_BIN" >/dev/null 2>&1 || {
      echo "Node.js was not found. Set NODE_BIN or install Node.js 20+." >&2
      exit 1
    }

    mkdir -p "$RUNTIME_DIR"
    nohup "$NODE_BIN" "$SCRIPT_DIR/server.mjs" >>"$LOG_FILE" 2>>"$ERROR_LOG_FILE" &
    printf '%s\n' "$!" >"$PID_FILE"

    for _ in {1..50}; do
      if is_ready; then
        echo "Router service started at http://127.0.0.1:$PORT"
        exit 0
      fi
      sleep 0.1
    done

    echo "Router service did not start. See $ERROR_LOG_FILE" >&2
    exit 1
    ;;
  stop)
    if pid="$(read_pid 2>/dev/null)" && kill -0 "$pid" 2>/dev/null; then
      kill "$pid"
      for _ in {1..30}; do
        kill -0 "$pid" 2>/dev/null || break
        sleep 0.1
      done
    fi
    rm -f "$PID_FILE"
    echo "Router service stopped."
    ;;
  restart)
    "$0" stop
    "$0" start
    ;;
  status)
    if is_ready; then
      curl -fsS "http://127.0.0.1:$PORT/health"
      echo
    else
      echo "Router service is not running."
      exit 1
    fi
    ;;
  logs)
    tail -n 100 "$LOG_FILE" 2>/dev/null || true
    tail -n 100 "$ERROR_LOG_FILE" 2>/dev/null || true
    ;;
  *)
    echo "Usage: $0 {start|stop|restart|status|logs}" >&2
    exit 2
    ;;
esac
