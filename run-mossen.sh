#!/usr/bin/env bash
set -euo pipefail

SCRIPT_PATH="${BASH_SOURCE[0]}"
while [[ -L "$SCRIPT_PATH" ]]; do
  SCRIPT_DIR="$(cd -P "$(dirname "$SCRIPT_PATH")" && pwd)"
  LINK_TARGET="$(readlink "$SCRIPT_PATH")"
  if [[ "$LINK_TARGET" != /* ]]; then
    SCRIPT_PATH="$SCRIPT_DIR/$LINK_TARGET"
  else
    SCRIPT_PATH="$LINK_TARGET"
  fi
done

ROOT_DIR="$(cd -P "$(dirname "$SCRIPT_PATH")" && pwd)"
exec "$ROOT_DIR/run-bun-featured.sh" entrypoints/cli.tsx "$@"
