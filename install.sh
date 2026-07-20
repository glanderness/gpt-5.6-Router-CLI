#!/usr/bin/env bash
set -euo pipefail

SOURCE_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${GPT56_ROUTER_INSTALL_DIR:-${GPT_ROUTER_INSTALL_DIR:-$HOME/.local/share/gpt5.6-router/app}}"
BIN_DIR="${GPT_ROUTER_BIN_DIR:-$HOME/.local/bin}"
START_SERVICE=1
UPSTREAM_BASE="${ROUTER_UPSTREAM_BASE:-}"
AUTH_MODE_OPTION="${ROUTER_AUTH_MODE:-}"
API_KEY_ENV_OPTION="${ROUTER_API_KEY_ENV:-}"
PROVIDER_KEY_VALUE="${ROUTER_API_KEY:-}"
PROMPT_PROVIDER_KEY=0
LEGACY_RUNTIME_DIR="$HOME/.local/share/gpt-5.6-router-cli"

usage() {
  cat <<'EOF'
Usage: ./install.sh [--upstream-base URL] [--auth-mode MODE] [--provider-key] [--api-key-env NAME] [--no-start]

Options:
  --upstream-base URL  Set the Responses API base URL for the selected provider.
  --auth-mode MODE  Set auto, openai, or provider_key authentication.
  --provider-key  Prompt securely for a third-party provider key.
  --api-key-env NAME  Read a provider key from the named environment variable.
  --no-start  Install commands and configuration without starting the Router service.
  -h, --help  Show this help text.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --upstream-base)
      [[ $# -ge 2 ]] || {
        echo "--upstream-base requires a URL." >&2
        exit 2
      }
      UPSTREAM_BASE="$2"
      shift
      ;;
    --auth-mode)
      [[ $# -ge 2 ]] || {
        echo "--auth-mode requires auto, openai, or provider_key." >&2
        exit 2
      }
      AUTH_MODE_OPTION="$2"
      shift
      ;;
    --provider-key)
      PROMPT_PROVIDER_KEY=1
      ;;
    --api-key-env)
      [[ $# -ge 2 ]] || {
        echo "--api-key-env requires an environment variable name." >&2
        exit 2
      }
      API_KEY_ENV_OPTION="$2"
      shift
      ;;
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

if [[ "$APP_DIR" != "$LEGACY_RUNTIME_DIR/app" && -f "$LEGACY_RUNTIME_DIR/router.pid" ]]; then
  legacy_pid="$(<"$LEGACY_RUNTIME_DIR/router.pid")"
  if [[ "$legacy_pid" =~ ^[0-9]+$ ]] && kill -0 "$legacy_pid" 2>/dev/null; then
    legacy_command="$(ps -p "$legacy_pid" -o command= 2>/dev/null || true)"
    if [[ "$legacy_command" == *"server.mjs"* ]]; then
      kill "$legacy_pid"
      echo "Stopped the previous Router service during migration."
    fi
  fi
  rm -f "$LEGACY_RUNTIME_DIR/router.pid"
fi

if [[ "$SOURCE_DIR" != "$APP_DIR" ]]; then
  install -m 644 "$SOURCE_DIR/server.mjs" "$APP_DIR/server.mjs"
  install -m 644 "$SOURCE_DIR/router.mjs" "$APP_DIR/router.mjs"
  install -m 644 "$SOURCE_DIR/router-signals.mjs" "$APP_DIR/router-signals.mjs"
  install -m 644 "$SOURCE_DIR/router-policy.mjs" "$APP_DIR/router-policy.mjs"
  install -m 644 "$SOURCE_DIR/auth-config.mjs" "$APP_DIR/auth-config.mjs"
  install -m 644 "$SOURCE_DIR/auth-config-cli.mjs" "$APP_DIR/auth-config-cli.mjs"
  install -m 644 "$SOURCE_DIR/.env.example" "$APP_DIR/.env.example"
  install -m 644 "$SOURCE_DIR/models/router-models.json" "$APP_DIR/models/router-models.json"
  install -m 755 "$SOURCE_DIR/codex-router" "$APP_DIR/codex-router"
  install -m 755 "$SOURCE_DIR/router-service.sh" "$APP_DIR/router-service.sh"
fi

set_env_value() {
  local key="$1" value="$2" encoded
  [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || {
    echo "Invalid environment variable name: $key" >&2
    exit 1
  }
  printf -v encoded '%q' "$value"
  node -e '
    const fs = require("node:fs");
    const [file, key, encoded] = process.argv.slice(1);
    const line = `${key}=${encoded}`;
    const source = fs.readFileSync(file, "utf8");
    const pattern = new RegExp(`^${key}=.*$`, "m");
    const next = pattern.test(source)
      ? source.replace(pattern, line)
      : `${source.trimEnd()}\n${line}\n`;
    fs.writeFileSync(file, next, { mode: 0o600 });
  ' "$APP_DIR/.env" "$key" "$encoded"
}

if [[ ! -f "$APP_DIR/.env" ]]; then
  if [[ -f "$SOURCE_DIR/.env" && "$SOURCE_DIR" != "$APP_DIR" ]]; then
    install -m 600 "$SOURCE_DIR/.env" "$APP_DIR/.env"
  else
    install -m 600 "$SOURCE_DIR/.env.example" "$APP_DIR/.env"
  fi
fi

if [[ -n "$UPSTREAM_BASE" ]]; then
  set_env_value ROUTER_UPSTREAM_BASE "${UPSTREAM_BASE%/}"
fi

if [[ -n "$AUTH_MODE_OPTION" ]]; then
  set_env_value ROUTER_AUTH_MODE "$AUTH_MODE_OPTION"
fi

if [[ -n "$API_KEY_ENV_OPTION" ]]; then
  [[ "$API_KEY_ENV_OPTION" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || {
    echo "--api-key-env must be a valid environment variable name." >&2
    exit 1
  }
  set_env_value ROUTER_API_KEY_ENV "$API_KEY_ENV_OPTION"
fi

provider_key_env="${API_KEY_ENV_OPTION:-ROUTER_API_KEY}"
if [[ -z "$PROVIDER_KEY_VALUE" && "$provider_key_env" != "ROUTER_API_KEY" ]]; then
  PROVIDER_KEY_VALUE="${!provider_key_env:-}"
fi

if (( PROMPT_PROVIDER_KEY == 1 )); then
  [[ -t 0 ]] || {
    echo "--provider-key requires an interactive terminal." >&2
    exit 1
  }
  read -r -s -p "Provider API key: " PROVIDER_KEY_VALUE
  echo
  [[ -n "$PROVIDER_KEY_VALUE" ]] || {
    echo "Provider API key cannot be empty." >&2
    exit 1
  }
  if [[ -z "$AUTH_MODE_OPTION" ]]; then
    set_env_value ROUTER_AUTH_MODE provider_key
  fi
fi

if [[ -n "$PROVIDER_KEY_VALUE" ]]; then
  set_env_value ROUTER_API_KEY_ENV "$provider_key_env"
  set_env_value "$provider_key_env" "$PROVIDER_KEY_VALUE"
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

chmod 600 "$APP_DIR/.env"
auth_json="$("$APP_DIR/codex-router" --router-auth-status)"

ln -sfn "$APP_DIR/codex-router" "$BIN_DIR/codex-router"
ln -sfn "$APP_DIR/router-service.sh" "$BIN_DIR/codex-router-service"

if (( START_SERVICE == 1 )); then
  "$APP_DIR/router-service.sh" restart
fi

echo
echo "GPT5.6-Router is installed."
echo "Codex CLI: $codex_path"
echo "Application: $APP_DIR"
echo "Configuration: $APP_DIR/.env"
node -e '
  const config = JSON.parse(process.argv[1]);
  const auth = config.selectedMode === "provider_key"
    ? `provider key from ${config.providerKeyEnv}`
    : "current Codex login (ChatGPT/Plus or OpenAI API key)";
  console.log(`Authentication: ${auth}`);
  console.log(`Upstream: ${config.upstreamBase}`);
' "$auth_json"

case ":$PATH:" in
  *":$BIN_DIR:"*)
    echo "Run: codex-router"
    ;;
  *)
    echo "Add this directory to PATH: $BIN_DIR"
    echo "Then run: codex-router"
    ;;
esac
