#!/usr/bin/env bash
# Public one-line VPS entry: clone or update the repo, then open the menu.
#
# After merge to main:
#   bash <(curl -fsSL https://raw.githubusercontent.com/yasinmalek82/neo_bot/main/deploy/neo-install.sh)
#
# From a local checkout:
#   bash deploy/neo-install.sh
#
# Override clone target / branch:
#   NEO_BOT_DIR=/opt/neo_bot NEO_BOT_REF=main bash deploy/neo-install.sh
#
# Never run with `bash -x` or `set -x`; the menu prompts include secrets.

set -euo pipefail

NEO_DEFAULT_REPO='https://github.com/yasinmalek82/neo_bot.git'
NEO_DEFAULT_REF='main'

neo_err() {
  printf '%s\n' "$*" >&2
}

neo_die() {
  neo_err "$*"
  exit 1
}

neo_say() {
  printf '%s\n' "$*"
}

neo_prompt() {
  local value=""
  printf '%s' "$1" >&2
  IFS= read -r value || true
  printf '%s' "$value"
}

neo_is_checkout() {
  local dir="$1"
  [[ -f "${dir}/deploy/neo" && -f "${dir}/deploy/lib.sh" && -f "${dir}/docker-compose.production.yml" ]]
}

neo_source_path() {
  printf '%s' "${BASH_SOURCE[0]:-}"
}

neo_running_from_curl() {
  local src
  src="$(neo_source_path)"
  case "$src" in
    '' | /dev/fd/* | /proc/self/fd/*) return 0 ;;
    *) return 1 ;;
  esac
}

neo_default_dir() {
  if [[ -n "${NEO_BOT_DIR:-}" ]]; then
    printf '%s' "$NEO_BOT_DIR"
    return 0
  fi
  if [[ "$(id -u)" -eq 0 ]]; then
    printf '%s' '/opt/neo_bot'
    return 0
  fi
  printf '%s' "${HOME}/neo_bot"
}

neo_find_checkout() {
  local candidate
  if ! neo_running_from_curl; then
    local self
    self="$(cd "$(dirname "$(neo_source_path)")/.." && pwd)"
    if neo_is_checkout "$self"; then
      printf '%s' "$self"
      return 0
    fi
  fi
  for candidate in \
    "${NEO_BOT_DIR:-}" \
    /opt/neo_bot \
    /root/neo_bot \
    "${HOME}/neo_bot" \
    "$PWD"; do
    if [[ -n "$candidate" ]] && neo_is_checkout "$candidate"; then
      printf '%s' "$candidate"
      return 0
    fi
  done
  return 1
}

if [[ -e /proc/1/cgroup ]] && grep -qE 'docker|containerd|kubepods' /proc/1/cgroup 2>/dev/null; then
  neo_die 'Run this script on the VPS host, not inside a container.'
fi

if ! command -v git >/dev/null 2>&1; then
  neo_err 'git is required to clone or update neo_bot.'
  neo_err 'Ubuntu/Debian: apt-get install -y git curl openssl docker.io docker-compose-v2'
  if [[ -f /etc/os-release ]]; then
    # shellcheck disable=SC1091
    . /etc/os-release
    if [[ "${ID:-}" == 'ubuntu' || "${ID:-}" == 'debian' ]]; then
      answer="$(neo_prompt 'Install git and curl now? type yes: ')"
      if [[ "$answer" == 'yes' ]]; then
        if [[ "$(id -u)" -ne 0 ]]; then
          neo_die 'Package install needs root. Re-run with sudo.'
        fi
        apt-get update -y
        DEBIAN_FRONTEND=noninteractive apt-get install -y git curl ca-certificates
      fi
    fi
  fi
  if ! command -v git >/dev/null 2>&1; then
    exit 1
  fi
fi

ROOT="$(neo_find_checkout || true)"
REPO="${NEO_BOT_REPO:-$NEO_DEFAULT_REPO}"
REF="${NEO_BOT_REF:-$NEO_DEFAULT_REF}"

if [[ -z "$ROOT" ]]; then
  ROOT="$(neo_default_dir)"
  if [[ -e "$ROOT" && ! -d "$ROOT" ]]; then
    neo_die "Install path exists and is not a directory: ${ROOT}"
  fi
  if [[ -d "$ROOT" && -n "$(ls -A "$ROOT" 2>/dev/null)" && ! -d "${ROOT}/.git" ]]; then
    neo_die "Install path is not empty and is not a git checkout: ${ROOT}"
  fi
  if [[ ! -d "${ROOT}/.git" ]]; then
    neo_say "Cloning ${REPO} (${REF}) into ${ROOT}"
    mkdir -p "$(dirname "$ROOT")"
    if git ls-remote --exit-code --heads "$REPO" "$REF" >/dev/null 2>&1; then
      git clone --branch "$REF" --single-branch "$REPO" "$ROOT"
    else
      neo_say "Remote branch ${REF} is not available yet; cloning default branch."
      git clone "$REPO" "$ROOT"
    fi
  fi
fi

if [[ ! -d "${ROOT}/.git" ]]; then
  neo_die "Expected a git checkout at ${ROOT}."
fi

if [[ -n "${NEO_BOT_REF:-}" ]]; then
  git -C "$ROOT" fetch --tags origin
  if git -C "$ROOT" show-ref --verify --quiet "refs/remotes/origin/${REF}"; then
    git -C "$ROOT" checkout "$REF"
    git -C "$ROOT" merge --ff-only "origin/${REF}" || true
  else
    neo_err "Remote does not have ref ${REF} yet. Using the current checkout."
  fi
fi

if ! neo_is_checkout "$ROOT"; then
  neo_die "Checkout at ${ROOT} is missing deploy/neo. Wrong repository?"
fi

if [[ -t 1 ]]; then
  neo_say "Opening neo_bot menu from ${ROOT}"
fi
exec bash "${ROOT}/deploy/neo" "$@"
