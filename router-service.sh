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
RUNTIME_DIR="${ROUTER_RUNTIME_DIR:-$HOME/.local/share/gpt5.6-router}"
LOG_FILE="$RUNTIME_DIR/router.log"
ERROR_LOG_FILE="$RUNTIME_DIR/router-error.log"
PID_FILE="$RUNTIME_DIR/router.pid"
NODE_BIN="${NODE_BIN:-node}"

resolved_auth_json() {
  "$NODE_BIN" "$SCRIPT_DIR/auth-config-cli.mjs" --json
}

prepare_auth_environment() {
  local resolved
  resolved="$(resolved_auth_json)"
  ROUTER_CODEX_LOGIN_MODE="$("$NODE_BIN" -e 'console.log(JSON.parse(process.argv[1]).codexLoginMode)' "$resolved")"
  export ROUTER_CODEX_LOGIN_MODE
}

health_payload() {
  curl -fsS --max-time 2 "http://127.0.0.1:$PORT/health" 2>/dev/null || true
}

is_ready() {
  local health
  health="$(health_payload)"
  [[ -n "$health" ]] || return 1
  "$NODE_BIN" -e '
    const [healthJson, expectedScriptPath] = process.argv.slice(1);
    const health = JSON.parse(healthJson);
    process.exit(
      health.service === "gpt5.6-router" && health.scriptPath === expectedScriptPath
        ? 0
        : 1
    );
  ' "$health" "$SCRIPT_DIR/server.mjs" 2>/dev/null
}

configuration_matches() {
  local health expected
  health="$(health_payload)"
  [[ -n "$health" ]] || return 1
  expected="$(resolved_auth_json)" || return 1
  "$NODE_BIN" -e '
    const [healthJson, expectedJson, expectedScriptPath] = process.argv.slice(1);
    const health = JSON.parse(healthJson);
    const expected = JSON.parse(expectedJson);
    process.exit(
      health.service === "gpt5.6-router"
      && health.scriptPath === expectedScriptPath
      && health.authMode === expected.selectedMode
      && health.authSource === expected.authSource
      && health.codexLoginMode === expected.codexLoginMode
      && health.upstreamBase === expected.upstreamBase
        ? 0
        : 1
    );
  ' "$health" "$expected" "$SCRIPT_DIR/server.mjs"
}

read_pid() {
  [[ -f "$PID_FILE" ]] || return 1
  local pid
  pid="$(<"$PID_FILE")"
  [[ "$pid" =~ ^[0-9]+$ ]] || return 1
  printf '%s' "$pid"
}

read_health_pid() {
  local health
  health="$(health_payload)"
  [[ -n "$health" ]] || return 1
  "$NODE_BIN" -e '
    const [healthJson, expectedScriptPath] = process.argv.slice(1);
    const health = JSON.parse(healthJson);
    if (
      health.service === "gpt5.6-router"
      && health.scriptPath === expectedScriptPath
      && Number.isInteger(health.processId)
      && health.processId > 1
    ) process.stdout.write(String(health.processId));
    else process.exit(1);
  ' "$health" "$SCRIPT_DIR/server.mjs" 2>/dev/null
}

pid_belongs_to_service() {
  local pid="$1" command=""
  command="$(ps -p "$pid" -o command= 2>/dev/null || true)"
  [[ "$command" == *"$SCRIPT_DIR/server.mjs"* ]]
}

case "${1:-status}" in
  start)
    command -v "$NODE_BIN" >/dev/null 2>&1 || {
      echo "Node.js was not found. Set NODE_BIN or install Node.js 20+." >&2
      exit 1
    }
    prepare_auth_environment

    if configuration_matches; then
      echo "Router service is already running at http://127.0.0.1:$PORT"
      exit 0
    fi

    if [[ -n "$(health_payload)" ]] && ! is_ready; then
      echo "Router port $PORT is already used by a different local service." >&2
      exit 1
    fi

    if is_ready; then "$0" stop >/dev/null; fi

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
    pid="$(read_pid 2>/dev/null || read_health_pid 2>/dev/null || true)"
    if [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null && pid_belongs_to_service "$pid"; then
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
  ensure)
    command -v "$NODE_BIN" >/dev/null 2>&1 || {
      echo "Node.js was not found. Set NODE_BIN or install Node.js 20+." >&2
      exit 1
    }
    resolved_auth_json >/dev/null
    if configuration_matches; then
      echo "Router service configuration is current."
    else
      "$0" restart
    fi
    ;;
  status)
    if is_ready; then
      curl -fsS "http://127.0.0.1:$PORT/health"
      echo
    elif [[ -n "$(health_payload)" ]]; then
      echo "Router port $PORT is used by a different local service." >&2
      exit 1
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
    echo "Usage: $0 {start|stop|restart|ensure|status|logs}" >&2
    exit 2
    ;;
esac
