#!/usr/bin/env bash
set -euo pipefail

SOURCE_PATH="${BASH_SOURCE[0]}"
while [[ -L "$SOURCE_PATH" ]]; do
  SOURCE_DIR="$(cd -- "$(dirname -- "$SOURCE_PATH")" && pwd)"
  SOURCE_PATH="$(readlink "$SOURCE_PATH")"
  [[ "$SOURCE_PATH" = /* ]] || SOURCE_PATH="$SOURCE_DIR/$SOURCE_PATH"
done
SCRIPT_DIR="$(cd -- "$(dirname -- "$SOURCE_PATH")" && pwd)"

DEFAULT_APP_DIR="$HOME/.local/share/gpt5.6-router/app"
APP_DIR="${GPT56_ROUTER_INSTALL_DIR:-${GPT_ROUTER_INSTALL_DIR:-$DEFAULT_APP_DIR}}"
BIN_DIR="${GPT_ROUTER_BIN_DIR:-$HOME/.local/bin}"
RUNTIME_DIR="${ROUTER_RUNTIME_DIR:-$HOME/.local/share/gpt5.6-router}"

if [[ -f "$SCRIPT_DIR/.gpt5.6-router-install" ]]; then
  APP_DIR="$SCRIPT_DIR"
fi

APP_DIR="$(cd -- "$APP_DIR" 2>/dev/null && pwd || true)"
[[ -n "$APP_DIR" && -f "$APP_DIR/.gpt5.6-router-install" ]] || {
  echo "GPT5.6-Router installation marker was not found. Nothing was removed." >&2
  exit 1
}

case "$APP_DIR" in
  /|"$HOME")
    echo "Refusing to remove an unsafe application directory: $APP_DIR" >&2
    exit 1
    ;;
esac

[[ "$(<"$APP_DIR/.gpt5.6-router-install")" == "gpt5.6-router" ]] || {
  echo "GPT5.6-Router installation marker is invalid. Nothing was removed." >&2
  exit 1
}

remove_owned_link() {
  local path="$1" expected="$2"
  if [[ -L "$path" && "$(readlink "$path")" == "$expected" ]]; then
    rm -f "$path"
  fi
}

if [[ -x "$APP_DIR/router-service.sh" ]]; then
  "$APP_DIR/router-service.sh" stop >/dev/null 2>&1 || true
fi

remove_owned_link "$BIN_DIR/codex-router" "$APP_DIR/codex-router"
remove_owned_link "$BIN_DIR/codex-router-service" "$APP_DIR/router-service.sh"
remove_owned_link "$BIN_DIR/codex-router-uninstall" "$APP_DIR/uninstall.sh"

rm -rf "$APP_DIR"
if [[ "$RUNTIME_DIR" != "$APP_DIR" && -d "$RUNTIME_DIR" ]]; then
  rm -f "$RUNTIME_DIR/router.pid" "$RUNTIME_DIR/router.log" "$RUNTIME_DIR/router-error.log"
  rmdir "$RUNTIME_DIR" 2>/dev/null || true
fi

echo "GPT5.6-Router was removed. Your Codex CLI configuration and login were not changed."
