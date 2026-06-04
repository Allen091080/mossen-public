#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_ENV_FILE="$ROOT_DIR/.mossensrc/custom-backend.env"
FEATURE_ENV_FILE="$ROOT_DIR/.mossensrc/feature-flags.env"
LAUNCH_CWD="${MOSSENSRC_LAUNCH_CWD:-$PWD}"
SETTINGS_FILE="${HOME}/.mossen/settings.json"
MIN_BUN_VERSION="1.3.0"

load_env_file() {
  local file="$1"
  if [[ -f "$file" ]]; then
    # shellcheck disable=SC1090
    source "$file"
  fi
}

normalize_features() {
  local raw="$1"
  if [[ -z "${raw//[[:space:],]/}" ]]; then
    return
  fi

  local normalized
  normalized="$(printf '%s' "$raw" | tr ',' '\n')"
  while IFS= read -r feature_name; do
    feature_name="${feature_name#"${feature_name%%[![:space:]]*}"}"
    feature_name="${feature_name%"${feature_name##*[![:space:]]}"}"
    if [[ -n "$feature_name" ]]; then
      printf '%s\n' "$feature_name"
    fi
  done <<<"$normalized"
}

load_env_file "$BACKEND_ENV_FILE"
load_env_file "$FEATURE_ENV_FILE"

set_launch_locale_from_settings() {
  if [[ ! -f "$SETTINGS_FILE" ]]; then
    return
  fi
  if ! command -v python3 >/dev/null 2>&1; then
    # Locale preloading is a startup nicety, not a hard dependency. Keep the
    # launcher usable on minimal machines that have Bun but no Python.
    return
  fi

  local interactive_language
  interactive_language="$(python3 - "$SETTINGS_FILE" <<'PY'
import json, sys
from pathlib import Path

try:
    raw = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
except Exception:
    print('')
    raise SystemExit(0)

language = raw.get('language')
if not isinstance(language, str):
    print('')
    raise SystemExit(0)

value = language.strip().lower()
if (
    value == 'zn'
    or value == 'cn'
    or value.startswith('zh')
    or '中文' in value
    or '汉语' in value
    or '漢語' in value
    or '简体' in value
    or '繁体' in value
    or '繁體' in value
    or 'chinese' in value
    or 'mandarin' in value
):
    print('zh')
elif value:
    print('en')
else:
    print('')
PY
)"

  if [[ -z "$interactive_language" ]]; then
    return
  fi

  export MOSSENSRC_INTERACTIVE_LANGUAGE="$interactive_language"
  export MOSSEN_UI_LANGUAGE="$interactive_language"

  if [[ "$interactive_language" == "zh" ]]; then
    export LANG="zh_CN.UTF-8"
    export LC_MESSAGES="zh_CN.UTF-8"
  else
    export LANG="en_US.UTF-8"
    export LC_MESSAGES="en_US.UTF-8"
  fi
}

set_launch_locale_from_settings

if ! command -v bun >/dev/null 2>&1; then
  cat >&2 <<'EOF'
Mossen cannot start because `bun` is not on PATH.

Install Bun:
  curl -fsSL https://bun.sh/install | bash

If Bun is already installed under ~/.bun, add it to your zsh profile:
  echo 'export BUN_INSTALL="$HOME/.bun"' >> ~/.zshrc
  echo 'export PATH="$BUN_INSTALL/bin:$PATH"' >> ~/.zshrc
  export BUN_INSTALL="$HOME/.bun"
  export PATH="$BUN_INSTALL/bin:$PATH"

Then open a new terminal and run:
  bun --version
  mossen
EOF
  exit 127
fi

version_part() {
  local version="$1"
  local index="$2"
  local clean="${version%%-*}"
  local value
  IFS='.' read -r major minor patch _ <<<"$clean"
  case "$index" in
    0) value="${major:-0}" ;;
    1) value="${minor:-0}" ;;
    *) value="${patch:-0}" ;;
  esac
  if [[ "$value" =~ ^[0-9]+$ ]]; then
    printf '%s' "$value"
  else
    printf '0'
  fi
}

bun_version_at_least() {
  local actual="$1"
  local required="$2"
  local i actual_part required_part
  for i in 0 1 2; do
    actual_part="$(version_part "$actual" "$i")"
    required_part="$(version_part "$required" "$i")"
    if (( actual_part > required_part )); then
      return 0
    fi
    if (( actual_part < required_part )); then
      return 1
    fi
  done
  return 0
}

BUN_VERSION="$(bun --version 2>/dev/null || true)"
if ! bun_version_at_least "$BUN_VERSION" "$MIN_BUN_VERSION"; then
  cat >&2 <<EOF
Mossen cannot start because Bun $MIN_BUN_VERSION or newer is required.

Detected:
  ${BUN_VERSION:-unknown}

Upgrade Bun:
  bun upgrade

Then verify:
  bun --version
  mossen
EOF
  exit 127
fi

if [[ ! -d "$ROOT_DIR/node_modules" ]]; then
  cat >&2 <<EOF
Mossen dependencies are missing at:
  $ROOT_DIR/node_modules

Run:
  cd "$ROOT_DIR"
  bun install --frozen-lockfile
  mossen
EOF
  exit 127
fi

declare -a bun_args
bun_args=(bun)

# Personal-edition default features: always compiled in for the source launch
# (`mossen`), independent of whether the user set MOSSENSRC_BUN_FEATURES. These
# are the capabilities the personal edition ships ON by default. User-supplied
# MOSSENSRC_BUN_FEATURES are merged on top (the dedup check below avoids dupes).
# Override an individual default off by NOT being possible here — to disable a
# default, comment it out in this list.
MOSSEN_DEFAULT_FEATURES="WORKFLOW_SCRIPTS"

while IFS= read -r feature_name; do
  if [[ " ${bun_args[*]} " == *" --feature=$feature_name "* ]]; then
    continue
  fi
  bun_args+=("--feature=$feature_name")
done < <(normalize_features "${MOSSEN_DEFAULT_FEATURES},${MOSSENSRC_BUN_FEATURES:-}")

declare -a exec_args
exec_args=("$@")

if [[ ${#exec_args[@]} -gt 0 ]]; then
  first_arg="${exec_args[0]}"
  if [[ "$first_arg" != /* && -e "$ROOT_DIR/$first_arg" ]]; then
    exec_args[0]="$ROOT_DIR/$first_arg"
  fi
fi

# Wave 7 Door Lock — CLI shell entrypoint sanitizer.
# Locks USER_TYPE before Bun loads any module so top-level conditional
# requires (e.g. tools.ts internal-only require) see the public value. Active only
# for the real CLI entrypoint (entrypoints/cli.tsx); other Bun invocations
# (`bun -e`, `--eval`, custom entries) pass through so test/dev paths can
# still exercise raw USER_TYPE values.
# Rules mirror utils/userTypeRuntimeLock.ts:
#   unset/empty/external/unknown                                 -> external
#   MOSSEN_INTERNAL_USER_MODE=internal with unlock                -> ant compat
#   ant|mossen with MOSSEN_CODE_ALLOW_INTERNAL_USER_TYPE = "1"   -> raw compat
#   ant|mossen otherwise                                          -> external
if [[ ${#exec_args[@]} -gt 0 ]] && {
  [[ "${exec_args[0]}" == "entrypoints/cli.tsx" ]] ||
  [[ "${exec_args[0]}" == "$ROOT_DIR/entrypoints/cli.tsx" ]]
}; then
  _mossen_raw_user_type="${USER_TYPE:-}"
  _mossen_internal_user_mode="${MOSSEN_INTERNAL_USER_MODE:-}"
  _mossen_unlock_user_type="${MOSSEN_CODE_ALLOW_INTERNAL_USER_TYPE:-}"
  _mossen_operator_compat="internal"
  if [[ "$_mossen_unlock_user_type" == "1" ]] && [[ "$_mossen_internal_user_mode" == "internal" ]]; then
    export USER_TYPE="$_mossen_operator_compat"
    export MOSSEN_INTERNAL_USER_MODE="internal"
  elif [[ "$_mossen_unlock_user_type" == "1" ]] && {
    [[ "$_mossen_raw_user_type" == "$_mossen_operator_compat" ]] ||
    [[ "$_mossen_raw_user_type" == "mossen" ]]
  }; then
    export USER_TYPE="$_mossen_raw_user_type"
    if [[ "$_mossen_raw_user_type" == "$_mossen_operator_compat" ]]; then
      export MOSSEN_INTERNAL_USER_MODE="internal"
    else
      export MOSSEN_INTERNAL_USER_MODE="mossen"
    fi
  else
    export USER_TYPE="external"
    export MOSSEN_INTERNAL_USER_MODE="external"
  fi
  unset _mossen_raw_user_type _mossen_internal_user_mode _mossen_unlock_user_type _mossen_operator_compat
fi

export MOSSENSRC_LAUNCH_CWD="$LAUNCH_CWD"
cd "$ROOT_DIR"

exec "${bun_args[@]}" "${exec_args[@]}"
