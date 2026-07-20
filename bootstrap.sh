#!/usr/bin/env bash
set -euo pipefail

REPOSITORY="${GPT56_ROUTER_REPOSITORY:-glanderness/GPT5.6-Router}"
REF="${GPT56_ROUTER_REF:-main}"
TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/gpt5.6-router.XXXXXX")"

cleanup() {
  rm -rf "$TEMP_DIR"
}
trap cleanup EXIT

for command_name in bash curl find mktemp rm tar; do
  command -v "$command_name" >/dev/null 2>&1 || {
    echo "Required command was not found: $command_name" >&2
    exit 1
  }
done

archive="$TEMP_DIR/router.tar.gz"
archive_url="${GPT56_ROUTER_ARCHIVE_URL:-https://github.com/$REPOSITORY/archive/refs/heads/$REF.tar.gz}"
echo "Downloading GPT5.6-Router..."
curl -fsSL "$archive_url" -o "$archive"
tar -xzf "$archive" -C "$TEMP_DIR"

installer="$(find "$TEMP_DIR" -mindepth 2 -maxdepth 2 -name install.sh -type f -print -quit)"
[[ -n "$installer" ]] || {
  echo "The downloaded package does not contain install.sh." >&2
  exit 1
}

bash "$installer" "$@"
