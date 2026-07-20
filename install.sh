#!/usr/bin/env bash
set -euo pipefail

SOURCE_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${GPT_ROUTER_INSTALL_DIR:-$HOME/.local/share/gpt-5.6-router-cli/app}"
BIN_DIR="${GPT_ROUTER_BIN_DIR:-$HOME/.local/bin}"
START_SERVICE=1

usage() {
  cat <<'EOF'
Usage: ./install.sh [--no-start]

Options:
  --no-start  Install commands and configuration without starting the Router service.
  -h, --help  Show this help text.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-start)
      START_SERVICE=0
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

for command_name in curl install ln node; do
  command -v "$command_name" >/dev/null 2>&1 || {
    echo "Required command was not found: $command_name" >&2
    exit 1
  }
done

node_major="$(node -p 'Number(process.versions.node.split(".")[0])')"
if [[ ! "$node_major" =~ ^[0-9]+$ ]] || (( node_major < 20 )); then
  echo "Node.js 20 or newer is required. Current major version: $node_major" >&2
  exit 1
fi

if [[ -n "${CODEX_BIN:-}" ]]; then
  [[ -x "$CODEX_BIN" ]] || {
    echo "CODEX_BIN is not executable: $CODEX_BIN" >&2
    exit 1
  }
  codex_path="$CODEX_BIN"
elif command -v codex >/dev/null 2>&1; then
  codex_path="$(command -v codex)"
elif [[ -x "/Applications/ChatGPT.app/Contents/Resources/codex" ]]; then
  codex_path="/Applications/ChatGPT.app/Contents/Resources/codex"
else
  echo "Codex CLI was not found. Install it or run this script with CODEX_BIN=/absolute/path/to/codex." >&2
  exit 1
fi

mkdir -p "$APP_DIR/models" "$BIN_DIR"
APP_DIR="$(cd "$APP_DIR" && pwd)"
BIN_DIR="$(cd "$BIN_DIR" && pwd)"

if [[ "$SOURCE_DIR" != "$APP_DIR" ]]; then
  install -m 644 "$SOURCE_DIR/server.mjs" "$APP_DIR/server.mjs"
  install -m 644 "$SOURCE_DIR/router.mjs" "$APP_DIR/router.mjs"
  install -m 644 "$SOURCE_DIR/router-signals.mjs" "$APP_DIR/router-signals.mjs"
  install -m 644 "$SOURCE_DIR/router-policy.mjs" "$APP_DIR/router-policy.mjs"
  install -m 644 "$SOURCE_DIR/.env.example" "$APP_DIR/.env.example"
  install -m 644 "$SOURCE_DIR/models/router-models.json" "$APP_DIR/models/router-models.json"
  install -m 755 "$SOURCE_DIR/codex-router" "$APP_DIR/codex-router"
  install -m 755 "$SOURCE_DIR/router-service.sh" "$APP_DIR/router-service.sh"
fi

if [[ ! -f "$APP_DIR/.env" ]]; then
  if [[ -f "$SOURCE_DIR/.env" && "$SOURCE_DIR" != "$APP_DIR" ]]; then
    install -m 600 "$SOURCE_DIR/.env" "$APP_DIR/.env"
  else
    install -m 600 "$SOURCE_DIR/.env.example" "$APP_DIR/.env"
  fi
fi

if [[ -n "${CODEX_BIN:-}" ]]; then
  codex_bin_configured=0
  while IFS= read -r line; do
    case "$line" in
      CODEX_BIN=*)
        codex_bin_configured=1
        break
        ;;
    esac
  done <"$APP_DIR/.env"

  if (( codex_bin_configured == 0 )); then
    printf '\nCODEX_BIN=%q\n' "$CODEX_BIN" >>"$APP_DIR/.env"
  fi
fi

ln -sfn "$APP_DIR/codex-router" "$BIN_DIR/codex-router"
ln -sfn "$APP_DIR/router-service.sh" "$BIN_DIR/codex-router-service"

if (( START_SERVICE == 1 )); then
  "$APP_DIR/router-service.sh" restart
fi

echo
echo "GPT-5.6 Router CLI is installed."
echo "Codex CLI: $codex_path"
echo "Application: $APP_DIR"
echo "Configuration: $APP_DIR/.env"

case ":$PATH:" in
  *":$BIN_DIR:"*)
    echo "Run: codex-router"
    ;;
  *)
    echo "Add this directory to PATH: $BIN_DIR"
    echo "Then run: codex-router"
    ;;
esac
