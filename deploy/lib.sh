#!/usr/bin/env bash
# Shared host-install helpers for neo_bot.
# Never source this under `set -x` or `bash -x`. Prompts may include secrets.

if [[ -n "${NEO_LIB_LOADED:-}" ]]; then
  return 0 2>/dev/null || exit 0
fi
NEO_LIB_LOADED=1

NEO_DEFAULT_REF='main'
NEO_PLACEHOLDER_PANEL='https://panel.example.invalid'
NEO_PLACEHOLDER_KEY='replace-me-later'
NEO_COMPOSE_FILE='docker-compose.production.yml'
NEO_SECRET_KEYS='TELEGRAM_BOT_TOKEN TELEGRAM_WEBHOOK_SECRET PASARGUARD_API_KEY POSTGRES_PASSWORD DATABASE_URL'

neo_lib_dir() {
  (cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
}

if [[ -z "${NEO_ROOT:-}" ]]; then
  NEO_ROOT="$(cd "$(neo_lib_dir)/.." && pwd)"
fi

neo_say() {
  printf '%s\n' "$*"
}

neo_err() {
  printf '%s\n' "$*" >&2
}

neo_die() {
  neo_err "$*"
  exit 1
}

neo_is_tty() {
  [[ -t 0 && -t 1 ]]
}

neo_color() {
  local code="$1"
  shift
  if [[ -t 1 ]]; then
    printf '\033[%sm%s\033[0m' "$code" "$*"
  else
    printf '%s' "$*"
  fi
}

neo_title() {
  neo_say ''
  neo_say "$(neo_color '1;36' "=== $* ===")"
}

neo_need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    neo_die "Missing command: $1"
  fi
}

neo_refuse_container() {
  if [[ -e /proc/1/cgroup ]] && grep -qE 'docker|containerd|kubepods' /proc/1/cgroup 2>/dev/null; then
    neo_die 'Run this script on the VPS host, not inside a container.'
  fi
}

neo_is_secret_key() {
  local key="$1"
  local item
  for item in $NEO_SECRET_KEYS; do
    if [[ "$item" == "$key" ]]; then
      return 0
    fi
  done
  return 1
}

neo_valid_env_key() {
  [[ "$1" =~ ^[A-Z][A-Z0-9_]*$ ]]
}

# --- prompts -----------------------------------------------------------------

neo_prompt() {
  local value=""
  printf '%s' "$1" >&2
  IFS= read -r value || true
  printf '%s' "$value"
}

neo_prompt_secret() {
  local value=""
  printf '%s' "$1" >&2
  if [[ -t 0 ]]; then
    if ! stty -echo; then
      neo_err "Could not hide input on this terminal; aborting secret prompt."
      return 1
    fi
    trap "stty echo 2>/dev/null || true" INT TERM HUP
    IFS= read -r value || true
    stty echo
    trap - INT TERM HUP
    printf '\n' >&2
  else
    IFS= read -r value || true
  fi
  printf '%s' "$value"
}

neo_prompt_default() {
  local label="$1"
  local current="${2:-}"
  local value
  if [[ -n "$current" ]]; then
    value="$(neo_prompt "${label} [${current}]: ")"
    if [[ -z "$value" ]]; then
      printf '%s' "$current"
      return 0
    fi
    printf '%s' "$value"
    return 0
  fi
  neo_prompt "${label}: "
}

neo_confirm() {
  local answer
  answer="$(neo_prompt "$1")"
  [[ "$answer" == 'yes' ]]
}

# --- validation --------------------------------------------------------------

neo_validate_hostname() {
  local host="$1"
  if [[ -z "$host" || "$host" == *://* || "$host" == */* || "$host" == *$'\n'* ]]; then
    neo_err 'Enter only the DNS hostname. Do not invent one and do not include a URL scheme.'
    return 1
  fi
  if [[ "$host" =~ ^[0-9]+(\.[0-9]+){3}$ ]]; then
    neo_err "Let's Encrypt needs a DNS hostname, not a raw IP."
    return 1
  fi
  if [[ "$host" == *:* ]]; then
    neo_err "Let's Encrypt needs a DNS hostname, not a raw IP."
    return 1
  fi
  if [[ ! "$host" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$ ]]; then
    neo_err 'That hostname is not valid.'
    return 1
  fi
  return 0
}

neo_validate_bot_token() {
  local token="$1"
  if [[ ! "$token" =~ ^[0-9]{5,20}:[A-Za-z0-9_-]{20,}$ ]]; then
    neo_err 'That token does not look like a BotFather token.'
    return 1
  fi
  return 0
}

neo_normalize_admin_ids() {
  local raw="$1"
  raw="${raw// /}"
  printf '%s' "$raw"
}

neo_validate_admin_ids() {
  local ids
  ids="$(neo_normalize_admin_ids "$1")"
  if [[ -z "$ids" ]]; then
    neo_err 'At least one numeric admin ID is required.'
    return 1
  fi
  local admin_id
  local IFS=','
  for admin_id in $ids; do
    if [[ ! "$admin_id" =~ ^[0-9]{1,20}$ ]]; then
      neo_err 'Admin IDs must be numeric Telegram user IDs.'
      return 1
    fi
  done
  return 0
}

neo_validate_report_chat_id() {
  local chat_id="$1"
  if [[ -z "$chat_id" ]]; then
    return 0
  fi
  if [[ ! "$chat_id" =~ ^-?[0-9]{1,20}$ ]]; then
    neo_err 'Report group chat ID must be a Telegram chat id.'
    return 1
  fi
  return 0
}

neo_validate_https_url() {
  local url="$1"
  if [[ ! "$url" =~ ^https://[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:[0-9]{2,5})?(/.*)?$ ]]; then
    neo_err 'Enter an https URL without credentials.'
    return 1
  fi
  if [[ "$url" == *'@'* ]]; then
    neo_err 'Enter an https URL without credentials.'
    return 1
  fi
  return 0
}

neo_validate_pasarguard_key() {
  local key="$1"
  if [[ ${#key} -lt 8 ]]; then
    neo_err 'PasarGuard API key must be at least 8 characters.'
    return 1
  fi
  return 0
}

neo_validate_bool() {
  if [[ "$1" != 'true' && "$1" != 'false' ]]; then
    neo_err 'Enter true or false.'
    return 1
  fi
  return 0
}

neo_validate_provisioning_mode() {
  case "$1" in
    disabled | isolated | live) return 0 ;;
    *)
      neo_err 'Provisioning mode must be disabled, isolated, or live.'
      return 1
      ;;
  esac
}

neo_validate_positive_int() {
  if [[ ! "$1" =~ ^[1-9][0-9]{0,17}$ ]]; then
    neo_err 'Enter a positive integer.'
    return 1
  fi
  return 0
}

neo_validate_bot_username() {
  local name="$1"
  if [[ -z "$name" ]]; then
    return 0
  fi
  name="${name#@}"
  if [[ ! "$name" =~ ^[A-Za-z][A-Za-z0-9_]{4,31}$ ]]; then
    neo_err 'Bot username must be 5-32 characters, letters, digits, or underscore.'
    return 1
  fi
  return 0
}

# --- secrets / env file ------------------------------------------------------

neo_url_safe_secret() {
  openssl rand -hex 24
}

neo_url_safe_password() {
  openssl rand -hex 16
}

neo_validate_postgres_password() {
  if [[ -z "$1" || ! "$1" =~ ^[A-Za-z0-9._~-]+$ ]]; then
    neo_err "POSTGRES_PASSWORD must contain only URL-safe characters (letters, digits, . _ - ~)."
    return 1
  fi
  return 0
}

neo_mask() {
  printf "%s" "********"
}

neo_env_file() {
  printf '%s' "${NEO_ROOT}/.env"
}

neo_env_exists() {
  [[ -f "$(neo_env_file)" ]]
}

neo_env_is_complete() {
  local key value
  for key in TELEGRAM_PUBLIC_HOST TELEGRAM_BOT_TOKEN TELEGRAM_ADMIN_IDS POSTGRES_PASSWORD DATABASE_URL PASARGUARD_BASE_URL PASARGUARD_API_KEY TELEGRAM_WEBHOOK_SECRET WEB_ORIGINS; do
    value="$(neo_env_get "$key" || true)"
    [[ -n "$value" ]] || return 1
  done
  return 0
}

neo_env_get() {
  local key="$1"
  local file="${2:-$(neo_env_file)}"
  local line
  if [[ ! -f "$file" ]]; then
    return 1
  fi
  while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ "$line" == "${key}="* ]]; then
      printf '%s' "${line#"${key}="}"
      return 0
    fi
  done <"$file"
  return 1
}

neo_env_display() {
  local key="$1"
  local value=""
  value="$(neo_env_get "$key" || true)"
  if [[ -z "$value" ]]; then
    printf '%s' '(empty)'
    return 0
  fi
  if neo_is_secret_key "$key"; then
    neo_mask "$value"
    return 0
  fi
  printf '%s' "$value"
}

neo_env_set() {
  local key="$1"
  local value="$2"
  local file
  file="$(neo_env_file)"
  if ! neo_valid_env_key "$key"; then
    neo_die 'Internal error: invalid environment key.'
  fi
  if [[ "$value" == *$'\n'* ]]; then
    neo_die 'Environment values cannot contain newlines.'
  fi
  local tmp
  tmp="$(mktemp "${TMPDIR:-/tmp}/neo-env.XXXXXX")"
  local found=0
  local old_umask
  old_umask="$(umask)"
  umask 077
  if [[ -f "$file" ]]; then
    local line
    while IFS= read -r line || [[ -n "$line" ]]; do
      if [[ "$line" == "${key}="* ]]; then
        printf '%s=%s\n' "$key" "$value"
        found=1
      else
        printf '%s\n' "$line"
      fi
    done <"$file" >"$tmp"
  fi
  if [[ "$found" -eq 0 ]]; then
    printf '%s=%s\n' "$key" "$value" >>"$tmp"
  fi
  mv "$tmp" "$file"
  chmod 600 "$file"
  umask "$old_umask"
}

neo_env_unset() {
  local key="$1"
  local file
  file="$(neo_env_file)"
  if ! neo_valid_env_key "$key"; then
    neo_die 'Internal error: invalid environment key.'
  fi
  if [[ ! -f "$file" ]]; then
    return 0
  fi
  local tmp
  tmp="$(mktemp "${TMPDIR:-/tmp}/neo-env.XXXXXX")"
  local old_umask
  old_umask="$(umask)"
  umask 077
  local line
  while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ "$line" != "${key}="* ]]; then
      printf '%s\n' "$line"
    fi
  done <"$file" >"$tmp"
  mv "$tmp" "$file"
  chmod 600 "$file"
  umask "$old_umask"
}

# --- host tools --------------------------------------------------------------

neo_host_preflight() {
  if ! docker info >/dev/null 2>&1; then
    neo_die "Docker is installed but the daemon is not ready. Start Docker, then try again."
  fi
  local port
  for port in 80 443 3100; do
    if command -v lsof >/dev/null 2>&1 && lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
      neo_err "Warning: port ${port} is already occupied; Compose may not be able to start neo_bot."
    fi
  done
}

neo_detect_compose() {
  if docker compose version >/dev/null 2>&1; then
    NEO_COMPOSE=(docker compose)
    return 0
  fi
  if command -v docker-compose >/dev/null 2>&1; then
    NEO_COMPOSE=(docker-compose)
    return 0
  fi
  return 1
}

neo_os_family() {
  if [[ ! -f /etc/os-release ]]; then
    printf '%s' 'unknown'
    return 0
  fi
  # shellcheck disable=SC1091
  . /etc/os-release
  printf '%s' "${ID:-unknown}"
}

neo_install_host_packages() {
  local family
  family="$(neo_os_family)"
  case "$family" in
    ubuntu | debian) ;;
    *)
      neo_die 'Install git, curl, openssl, Docker, and Docker Compose v2, then re-run.'
      ;;
  esac
  if [[ "$(id -u)" -ne 0 ]]; then
    neo_die 'Package install needs root. Re-run with sudo or install Docker yourself.'
  fi
  neo_say 'Installing git, curl, openssl, Docker, and Compose v2…'
  apt-get update -y
  DEBIAN_FRONTEND=noninteractive apt-get install -y git curl ca-certificates openssl docker.io
  DEBIAN_FRONTEND=noninteractive apt-get install -y docker-compose-v2 \
    || DEBIAN_FRONTEND=noninteractive apt-get install -y docker-compose-plugin \
    || true
  if command -v systemctl >/dev/null 2>&1; then
    systemctl enable --now docker >/dev/null 2>&1 || true
  fi
}

neo_require_host_tools() {
  local missing=0
  local cmd
  for cmd in git curl openssl docker; do
    if ! command -v "$cmd" >/dev/null 2>&1; then
      neo_err "Missing command: ${cmd}"
      missing=1
    fi
  done
  if ! command -v docker >/dev/null 2>&1 || ! neo_detect_compose; then
    if command -v docker >/dev/null 2>&1; then
      neo_err 'Install Docker Compose v2 (docker compose).'
    fi
    missing=1
  fi
  if [[ "$missing" -eq 0 ]]; then
    neo_host_preflight
    return 0
  fi
  local family
  family="$(neo_os_family)"
  neo_err 'Ubuntu/Debian example: apt-get install -y git curl openssl docker.io docker-compose-v2'
  if [[ "$family" == 'ubuntu' || "$family" == 'debian' ]]; then
    if neo_confirm 'Install missing packages? Type yes / نصب بسته‌ها؟ yes: '; then
      neo_install_host_packages
      neo_need_cmd git
      neo_need_cmd curl
      neo_need_cmd openssl
      neo_need_cmd docker
      if ! neo_detect_compose; then
        neo_die 'Install Docker Compose v2 (docker compose).'
      fi
      neo_host_preflight
      return 0
    fi
  fi
  neo_die 'Install the missing commands, then re-run.'
}

neo_compose() {
  if [[ -z "${NEO_COMPOSE:-}" ]]; then
    if ! neo_detect_compose; then
      neo_die 'Install Docker Compose v2 (docker compose).'
    fi
  fi
  if ! docker info >/dev/null 2>&1; then
    neo_die 'Docker is installed but the daemon is not reachable. Start Docker, then try again.'
  fi
  (
    cd "$NEO_ROOT" || exit 1
    "${NEO_COMPOSE[@]}" -f "$NEO_COMPOSE_FILE" "$@"
  )
}

neo_link_cli() {
  local target='/usr/local/bin/neo'
  local source_path="${NEO_ROOT}/deploy/neo"
  if [[ ! -f "$source_path" ]]; then
    return 0
  fi
  if [[ -w /usr/local/bin ]]; then
    ln -sfn "$source_path" "$target"
    neo_say "Management command: ${target}"
    return 0
  fi
  neo_say "Re-open this menu later with: bash ${source_path}"
}

# --- build / runtime ---------------------------------------------------------

neo_build_static() {
  if [[ "${NEO_SKIP_BUILD:-}" == '1' ]]; then
    return 0
  fi
  neo_say 'Building static apps…'
  if command -v pnpm >/dev/null 2>&1; then
    (
      cd "$NEO_ROOT" || exit 1
      pnpm install --frozen-lockfile
      pnpm --filter admin-web run check:runtime
      pnpm --filter admin-web exec tsc
      pnpm --filter admin-web exec vite build
    )
  else
    docker run --rm \
      -v "${NEO_ROOT}:/app" \
      -w /app \
      -e COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
      node:24-bookworm \
      bash -lc 'corepack enable && corepack prepare pnpm@11 --activate && pnpm install --frozen-lockfile && pnpm --filter admin-web run check:runtime && pnpm --filter admin-web exec tsc && pnpm --filter admin-web exec vite build'
  fi
  if [[ ! -f "${NEO_ROOT}/apps/admin-web/dist/client/index.html" ]]; then
    neo_die 'Mini App dist/client is missing after the build.'
  fi
}

neo_wait_loopback_health() {
  if [[ "${NEO_SKIP_COMPOSE:-}" == '1' ]]; then
    return 0
  fi
  if ! command -v curl >/dev/null 2>&1; then
    neo_say 'curl is not installed; check `docker compose -f docker-compose.production.yml ps` yourself.'
    return 1
  fi
  neo_say 'Waiting for loopback /health…'
  local i
  for ((i = 0; i < 30; i += 1)); do
    if curl -fsS --connect-timeout 3 --max-time 10 http://127.0.0.1:3100/health >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  neo_err 'bot-api did not become healthy on loopback. Check compose logs on the host.'
  return 1
}

neo_require_static_dist() {
  if [[ ! -f "${NEO_ROOT}/apps/admin-web/dist/client/index.html" ]]; then
    neo_die 'Customer static assets are missing. Re-run install/update without NEO_SKIP_BUILD=1.'
  fi
}

neo_start_stack() {
  if [[ "${NEO_SKIP_COMPOSE:-}" == '1' ]]; then
    neo_say 'Skipping Compose start (NEO_SKIP_COMPOSE=1).'
    return 0
  fi
  neo_require_static_dist
  neo_say 'Starting Postgres, bot-api, and Caddy…'
  neo_compose up -d --build
  neo_wait_loopback_health
}

neo_write_production_env() {
  local host="$1"
  local token="$2"
  local admin_ids="$3"
  local report_group="$4"
  local panel_url="$5"
  local panel_key="$6"
  local reuse_secrets="${7:-0}"
  local webhook_secret=""
  local postgres_password=""
  local bot_username="${8:-}"
  local previous_pilot=""
  local previous_mode=""
  local previous_env=""
  if [[ "$reuse_secrets" == '1' ]] && neo_env_exists; then
    previous_env="$(mktemp "${TMPDIR:-/tmp}/neo-env-previous.XXXXXX")"
    cp "$(neo_env_file)" "$previous_env"
  fi

  if [[ "$reuse_secrets" == '1' ]] && neo_env_exists; then
    webhook_secret="$(neo_env_get TELEGRAM_WEBHOOK_SECRET || true)"
    postgres_password="$(neo_env_get POSTGRES_PASSWORD || true)"
    previous_pilot="$(neo_env_get PILOT_ENABLED || true)"
    previous_mode="$(neo_env_get PROVISIONING_MODE || true)"
  fi
  if [[ -z "$webhook_secret" ]]; then
    webhook_secret="$(neo_url_safe_secret)"
  fi
  if [[ -z "$postgres_password" ]]; then
    postgres_password="$(neo_url_safe_password)"
  fi
  if ! neo_validate_postgres_password "$postgres_password"; then
    neo_err "Existing PostgreSQL password is not URL-safe for DATABASE_URL."
    neo_err "Changing .env alone can break the live database; rotate the DB password first."
    if ! neo_confirm "DB password already rotated? Type yes / رمز DB چرخانده شده؟ yes: "; then


      return 1
    fi
    while true; do
      postgres_password="$(neo_prompt_secret "New URL-safe PostgreSQL password / رمز جدید (hidden): ")"
      if neo_validate_postgres_password "$postgres_password"; then
        break
      fi
    done
  fi
  bot_username="${bot_username#@}"

  local old_umask
  old_umask="$(umask)"
  umask 077
  {
    printf '%s\n' 'NODE_ENV=production'
    printf '%s\n' 'HOST=0.0.0.0'
    printf '%s\n' 'PORT=3100'
    printf '%s\n' 'LOG_LEVEL=info'
    printf 'TELEGRAM_PUBLIC_HOST=%s\n' "$host"
    printf 'WEB_ORIGINS=https://%s\n' "$host"
    printf 'POSTGRES_PASSWORD=%s\n' "$postgres_password"
    printf 'DATABASE_URL=postgres://neo_bot:%s@postgres:5432/neo_bot\n' "$postgres_password"
    printf 'PASARGUARD_BASE_URL=%s\n' "$panel_url"
    printf 'PASARGUARD_API_KEY=%s\n' "$panel_key"
    printf '%s\n' 'PASARGUARD_TIMEOUT_MS=5000'
    printf '%s\n' 'PASARGUARD_MAX_RETRIES=2'
    printf '%s\n' 'PILOT_PROVIDER_CODE=pilot-pasarguard'
    printf '%s\n' 'PILOT_VARIANT_CODE=pilot-direct-variant'
    printf '%s\n' 'PILOT_VARIANT_NAME=Pilot direct variant'
    printf '%s\n' 'PILOT_GROUP_ID=0'
    printf '%s\n' 'PILOT_DURATION_DAYS=30'
    printf '%s\n' 'PILOT_DATA_LIMIT_BYTES=10737418240'
    printf '%s\n' 'PILOT_DEVICE_LIMIT=1'
    printf '%s\n' 'PILOT_ENABLED=false'
    printf '%s\n' 'PROVISIONING_MODE=disabled'
    printf '%s\n' 'TELEGRAM_ENABLED=true'
    printf 'TELEGRAM_BOT_TOKEN=%s\n' "$token"
    printf 'TELEGRAM_WEBHOOK_SECRET=%s\n' "$webhook_secret"
    printf '%s\n' 'TELEGRAM_WEBHOOK_URL='
    printf 'TELEGRAM_ADMIN_IDS=%s\n' "$admin_ids"
    if [[ -n "$report_group" ]]; then
      printf 'TELEGRAM_REPORT_GROUP_CHAT_ID=%s\n' "$report_group"
    fi
    if [[ -n "$bot_username" ]]; then
      printf 'TELEGRAM_BOT_USERNAME=%s\n' "$bot_username"
    fi
  } >"$(neo_env_file)"
  chmod 600 "$(neo_env_file)"
  umask "$old_umask"
  if [[ -n "$previous_env" ]]; then
    while IFS= read -r line || [[ -n "$line" ]]; do
      [[ "$line" == *=* ]] || continue
      key="${line%%=*}"
      neo_valid_env_key "$key" || continue
      case "$key" in
        NODE_ENV|HOST|PORT|LOG_LEVEL|TELEGRAM_PUBLIC_HOST|WEB_ORIGINS|POSTGRES_PASSWORD|DATABASE_URL|PASARGUARD_BASE_URL|PASARGUARD_API_KEY|PASARGUARD_TIMEOUT_MS|PASARGUARD_MAX_RETRIES|PILOT_PROVIDER_CODE|PILOT_VARIANT_CODE|PILOT_VARIANT_NAME|PILOT_GROUP_ID|PILOT_DURATION_DAYS|PILOT_DATA_LIMIT_BYTES|PILOT_DEVICE_LIMIT|PILOT_ENABLED|PROVISIONING_MODE|TELEGRAM_ENABLED|TELEGRAM_BOT_TOKEN|TELEGRAM_WEBHOOK_SECRET|TELEGRAM_WEBHOOK_URL|TELEGRAM_ADMIN_IDS|TELEGRAM_REPORT_GROUP_CHAT_ID|TELEGRAM_BOT_USERNAME) ;;
        *) neo_env_set "$key" "${line#*=}" ;;
      esac
    done <"$previous_env"
    rm -f "$previous_env"
  fi
  if [[ "$reuse_secrets" == '1' ]]; then
    [[ -n "$previous_pilot" ]] && neo_env_set PILOT_ENABLED "$previous_pilot"
    [[ -n "$previous_mode" ]] && neo_env_set PROVISIONING_MODE "$previous_mode"
  fi
  neo_say 'Wrote host .env (gitignored).'
}

neo_collect_setup_answers() {
  local reuse="${1:-0}"
  local current_host=""
  local current_admins=""
  local current_report=""
  local current_panel=""
  local current_username=""
  if [[ "$reuse" == '1' ]] && neo_env_exists; then
    current_host="$(neo_env_get TELEGRAM_PUBLIC_HOST || true)"
    current_admins="$(neo_env_get TELEGRAM_ADMIN_IDS || true)"
    current_report="$(neo_env_get TELEGRAM_REPORT_GROUP_CHAT_ID || true)"
    current_panel="$(neo_env_get PASARGUARD_BASE_URL || true)"
    current_username="$(neo_env_get TELEGRAM_BOT_USERNAME || true)"
  fi

  local host token admin_ids report_group panel_url panel_key bot_username
  while true; do
    host="$(neo_prompt_default 'Public hostname / نام دامنه عمومی (DNS A record; no https://)' "$current_host")"
    if neo_validate_hostname "$host"; then
      break
    fi
  done

  while true; do
    if [[ "$reuse" == '1' ]] && neo_env_get TELEGRAM_BOT_TOKEN >/dev/null; then
      token="$(neo_prompt_secret 'BotFather token / توکن BotFather (hidden; empty keeps current): ')"
      if [[ -z "$token" ]]; then
        token="$(neo_env_get TELEGRAM_BOT_TOKEN)"
      fi
    else
      token="$(neo_prompt_secret 'BotFather token / توکن BotFather (input hidden): ')"
    fi
    if neo_validate_bot_token "$token"; then
      break
    fi
  done

  while true; do
    admin_ids="$(neo_prompt_default 'Admin Telegram IDs / شناسه عددی مدیران (comma-separated)' "$current_admins")"
    admin_ids="$(neo_normalize_admin_ids "$admin_ids")"
    if neo_validate_admin_ids "$admin_ids"; then
      break
    fi
  done

  while true; do
    report_group="$(neo_prompt_default 'Report group chat ID / شناسه گروه گزارش (empty skips topics)' "$current_report")"
    if neo_validate_report_chat_id "$report_group"; then
      break
    fi
  done

  while true; do
    panel_url="$(neo_prompt_default 'PasarGuard URL / آدرس PasarGuard (empty keeps placeholder)' "$current_panel")"
    if [[ -z "$panel_url" ]]; then
      panel_url="$NEO_PLACEHOLDER_PANEL"
      break
    fi
    if neo_validate_https_url "$panel_url"; then
      break
    fi
  done

  while true; do
    if [[ "$reuse" == '1' ]] && neo_env_get PASARGUARD_API_KEY >/dev/null; then
      panel_key="$(neo_prompt_secret 'PasarGuard API key / کلید API (hidden; empty keeps current): ')"
      if [[ -z "$panel_key" ]]; then
        panel_key="$(neo_env_get PASARGUARD_API_KEY)"
      fi
    else
      panel_key="$(neo_prompt_secret 'PasarGuard API key / کلید API (hidden; empty keeps placeholder): ')"
      if [[ -z "$panel_key" ]]; then
        panel_key="$NEO_PLACEHOLDER_KEY"
      fi
    fi
    if neo_validate_pasarguard_key "$panel_key"; then
      break
    fi
  done

  while true; do
    bot_username="$(neo_prompt_default 'Public bot username / نام کاربری ربات بدون @ (empty skips invite links)' "$current_username")"
    bot_username="${bot_username#@}"
    if neo_validate_bot_username "$bot_username"; then
      break
    fi
  done

  NEO_SETUP_HOST="$host"
  NEO_SETUP_TOKEN="$token"
  NEO_SETUP_ADMINS="$admin_ids"
  NEO_SETUP_REPORT="$report_group"
  NEO_SETUP_PANEL="$panel_url"
  NEO_SETUP_KEY="$panel_key"
  NEO_SETUP_USERNAME="$bot_username"
}

neo_install_or_reconfigure() {
  neo_refuse_container
  neo_require_host_tools
  neo_need_cmd openssl

  local mode='write'
  if neo_env_exists; then
    if ! neo_env_is_complete; then
      neo_say '.env exists but is incomplete / فایل .env ناقص است؛ continuing with reconfigure.'
    else
      neo_say '.env already exists / فایل .env از قبل وجود دارد.'
      neo_say '  [k] keep current values and rebuild/start / حفظ مقادیر'
      neo_say '  [r] reconfigure values / تغییر تنظیمات (secrets are preserved)'
      neo_say '  [q] quit without changes / خروج'
      local choice
      choice="$(neo_prompt 'Choose k, r, or q / انتخاب: ')"
      case "$choice" in
        k | K | keep) mode='keep' ;;
        r | R | reconfigure | yes) mode='write' ;;
        *) neo_die 'Stopped without changing .env / بدون تغییر متوقف شد.' ;;
      esac
    fi
  fi

  if [[ "$mode" == 'write' ]]; then
    local reuse=0
    if neo_env_exists; then
      reuse=1
    fi
    neo_collect_setup_answers "$reuse"
    neo_write_production_env \
      "$NEO_SETUP_HOST" \
      "$NEO_SETUP_TOKEN" \
      "$NEO_SETUP_ADMINS" \
      "$NEO_SETUP_REPORT" \
      "$NEO_SETUP_PANEL" \
      "$NEO_SETUP_KEY" \
      "$reuse" \
      "$NEO_SETUP_USERNAME"
    unset NEO_SETUP_TOKEN NEO_SETUP_KEY
  else
    neo_say 'Keeping existing .env.'
  fi

  neo_build_static
  neo_start_stack
  if [[ "${NEO_SKIP_COMPOSE:-}" != '1' ]]; then
    if ! neo_health_check; then
      neo_err 'Install incomplete: API or Caddy/TLS health failed; no success claim was made.'
      return 1
    fi
    neo_env_set TELEGRAM_WEBHOOK_URL "https://${NEO_SETUP_HOST}/telegram/webhook"
    if ! neo_compose restart bot-api; then
      neo_err 'Install incomplete: bot-api restart after webhook bootstrap failed.'
      return 1
    fi
    if ! neo_wait_loopback_health; then
      neo_err 'Install incomplete: bot-api failed loopback health after webhook bootstrap.'
      return 1
    fi
  else
    neo_say 'Setup written; Compose was skipped, so health remains unverified.'
  fi
  neo_link_cli
  if [[ "${NEO_SKIP_COMPOSE:-}" == '1' ]]; then
    neo_say 'Setup written; installation is not finished because Compose health was skipped.'
  else
    neo_say 'Install finished: API loopback and Caddy/TLS public health passed.'
    neo_say 'Webhook URL was enabled only after HTTPS health passed.'
  fi
  neo_say 'Do not paste the BotFather token, .env, or webhook secret into chat.'
}

# --- settings ----------------------------------------------------------------

neo_apply_hostname() {
  local host="$1"
  neo_validate_hostname "$host" || return 1
  neo_env_set TELEGRAM_PUBLIC_HOST "$host"
  neo_env_set WEB_ORIGINS "https://${host}"
  neo_env_set TELEGRAM_WEBHOOK_URL "https://${host}/telegram/webhook"
}

neo_settings_menu() {
  if ! neo_env_exists; then
    neo_err 'No .env yet. Run install / first setup first.'
    return 1
  fi
  while true; do
    neo_title 'Change settings / تغییر تنظیمات'
    neo_say "1) Hostname          $(neo_env_display TELEGRAM_PUBLIC_HOST)"
    neo_say "2) BotFather token   $(neo_env_display TELEGRAM_BOT_TOKEN)"
    neo_say "3) Admin IDs         $(neo_env_display TELEGRAM_ADMIN_IDS)"
    neo_say "4) Report forum ID   $(neo_env_display TELEGRAM_REPORT_GROUP_CHAT_ID)"
    neo_say "5) PasarGuard URL    $(neo_env_display PASARGUARD_BASE_URL)"
    neo_say "6) PasarGuard key    $(neo_env_display PASARGUARD_API_KEY)"
    neo_say "7) Telegram enabled  $(neo_env_display TELEGRAM_ENABLED)"
    neo_say "8) Bot username      $(neo_env_display TELEGRAM_BOT_USERNAME)"
    neo_say "9) Provisioning mode $(neo_env_display PROVISIONING_MODE)"
    neo_say "10) Isolated group   $(neo_env_display PROVISIONING_ISOLATED_GROUP_ID)"
    neo_say "11) PILOT_ENABLED    $(neo_env_display PILOT_ENABLED)"
    neo_say '0) Back / بازگشت'
    local choice
    choice="$(neo_prompt 'Settings choice / انتخاب تنظیمات: ')"
    case "$choice" in
      1)
        local host
        host="$(neo_prompt 'New public hostname / نام دامنه جدید (DNS only): ')"
        if neo_apply_hostname "$host"; then
          neo_say 'Updated hostname, WEB_ORIGINS, and webhook URL.'
        fi
        ;;
      2)
        local token
        token="$(neo_prompt_secret 'New BotFather token (hidden): ')"
        if neo_validate_bot_token "$token"; then
          neo_env_set TELEGRAM_BOT_TOKEN "$token"
          neo_say 'Updated token.'
        fi
        ;;
      3)
        local ids
        ids="$(neo_normalize_admin_ids "$(neo_prompt 'Admin Telegram IDs / شناسه عددی مدیران (comma-separated): ')")"
        if neo_validate_admin_ids "$ids"; then
          neo_env_set TELEGRAM_ADMIN_IDS "$ids"
          neo_say 'Updated admin IDs.'
        fi
        ;;
      4)
        local chat
        chat="$(neo_prompt 'Report group chat ID (empty clears it): ')"
        if neo_validate_report_chat_id "$chat"; then
          if [[ -z "$chat" ]]; then
            neo_env_unset TELEGRAM_REPORT_GROUP_CHAT_ID
            neo_say 'Cleared report group chat ID.'
          else
            neo_env_set TELEGRAM_REPORT_GROUP_CHAT_ID "$chat"
            neo_say 'Updated report group chat ID.'
          fi
        fi
        ;;
      5)
        local url
        url="$(neo_prompt 'PasarGuard https URL: ')"
        if neo_validate_https_url "$url"; then
          neo_env_set PASARGUARD_BASE_URL "$url"
          neo_say 'Updated PasarGuard URL.'
        fi
        ;;
      6)
        local key
        key="$(neo_prompt_secret 'PasarGuard API key (hidden): ')"
        if neo_validate_pasarguard_key "$key"; then
          neo_env_set PASARGUARD_API_KEY "$key"
          neo_say 'Updated PasarGuard API key.'
        fi
        ;;
      7)
        local enabled
        enabled="$(neo_prompt 'TELEGRAM_ENABLED (true/false): ')"
        if neo_validate_bool "$enabled"; then
          neo_env_set TELEGRAM_ENABLED "$enabled"
          neo_say 'Updated TELEGRAM_ENABLED.'
        fi
        ;;
      8)
        local username
        username="$(neo_prompt 'Public bot username without @: ')"
        username="${username#@}"
        if neo_validate_bot_username "$username"; then
          if [[ -z "$username" ]]; then
            neo_env_unset TELEGRAM_BOT_USERNAME
            neo_say 'Cleared bot username.'
          else
            neo_env_set TELEGRAM_BOT_USERNAME "$username"
            neo_say 'Updated bot username.'
          fi
        fi
        ;;
      9)
        local mode
        mode="$(neo_prompt 'PROVISIONING_MODE (disabled/isolated/live): ')"
        if neo_validate_provisioning_mode "$mode"; then
          if [[ "$mode" == 'live' ]]; then
            if ! neo_confirm 'Live mode mutates PasarGuard. Type yes / حالت live تغییر می‌دهد؛ yes: '; then
              neo_err 'Kept previous provisioning mode.'
              continue
            fi
          fi
          if [[ "$mode" == 'isolated' ]]; then
            local existing_group
            existing_group="$(neo_env_get PROVISIONING_ISOLATED_GROUP_ID || true)"
            if [[ -z "$existing_group" ]]; then
              neo_err 'Set the isolated group ID (option 10) before isolated mode will boot.'
            fi
          fi
          neo_env_set PROVISIONING_MODE "$mode"
          neo_say 'Updated PROVISIONING_MODE.'
        fi
        ;;
      10)
        local group
        group="$(neo_prompt 'Prepared PasarGuard isolated group ID (positive integer): ')"
        if neo_validate_positive_int "$group"; then
          neo_env_set PROVISIONING_ISOLATED_GROUP_ID "$group"
          neo_say 'Updated isolated group ID.'
        fi
        ;;
      11)
        local pilot
        pilot="$(neo_prompt 'PILOT_ENABLED (true/false): ')"
        if neo_validate_bool "$pilot"; then
          if [[ "$pilot" == 'true' ]]; then
            if ! neo_confirm 'Pilot mutations require an isolated group. Type yes / نیازمند گروه isolated؛ yes: '; then
              neo_err 'Kept PILOT_ENABLED unchanged.'
              continue
            fi
          fi
          neo_env_set PILOT_ENABLED "$pilot"
          neo_say 'Updated PILOT_ENABLED.'
        fi
        ;;
      0 | q | Q)
        if neo_confirm 'Restart bot-api to apply .env? Type yes / راه‌اندازی مجدد؟ yes: '; then
          neo_compose restart bot-api || true
        fi
        return 0
        ;;
      *)
        neo_err 'Unknown choice.'
        ;;
    esac
  done
}

# --- update / backup / health / services ------------------------------------

neo_git_ref() {
  printf '%s' "${NEO_BOT_REF:-$(git -C "$NEO_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || printf '%s' "$NEO_DEFAULT_REF")}"
}

neo_update_from_git() {
  neo_need_cmd git
  if [[ ! -d "${NEO_ROOT}/.git" ]]; then
    neo_die 'This directory is not a git checkout.'
  fi
  local ref
  ref="$(neo_git_ref)"
  neo_say "Current checkout: ${NEO_ROOT}"
  neo_say "Requested ref: ${ref}"
  if ! neo_confirm 'Fetch, fast-forward, rebuild? Type yes / دریافت و بازسازی؟ yes: '; then
    neo_say 'Update cancelled.'
    return 0
  fi
  local dirty
  dirty="$(git -C "$NEO_ROOT" status --porcelain --untracked-files=no)"
  if [[ -n "$dirty" ]]; then
    neo_err 'Tracked files have local changes. Refusing automatic reset.'
    neo_err 'Commit or stash them on the host, then run update again.'
    return 1
  fi
  git -C "$NEO_ROOT" fetch --tags origin
  if git -C "$NEO_ROOT" show-ref --verify --quiet "refs/remotes/origin/${ref}"; then
    git -C "$NEO_ROOT" checkout "$ref"
    git -C "$NEO_ROOT" merge --ff-only "origin/${ref}"
  else
    neo_die "Remote does not have ref ${ref}. Set NEO_BOT_REF to a real branch."
  fi
  if ! neo_env_exists; then
    neo_err 'No .env yet. Run install / first setup after the update.'
    return 0
  fi
  neo_require_host_tools
  neo_build_static
  neo_start_stack
  neo_say 'Update finished. Confirm GET /health yourself. Do not paste secrets.'
}

neo_service_menu() {
  if ! neo_env_exists; then
    neo_err 'No .env yet. Run install / first setup first.'
    return 1
  fi
  neo_require_host_tools
  while true; do
    neo_title 'Services'
    neo_say '1) Start / شروع'
    neo_say '2) Stop (keeps volumes) / توقف (حجم‌ها حفظ می‌شوند)'
    neo_say '3) Restart / راه‌اندازی مجدد'
    neo_say '4) Status / وضعیت'
    neo_say '5) Logs (last 80 lines) / گزارش‌ها'
    neo_say '0) Back / بازگشت'
    local choice
    choice="$(neo_prompt 'Service choice / انتخاب سرویس: ')"
    case "$choice" in
      1) neo_compose up -d ;;
      2) neo_compose stop ;;
      3) neo_compose restart ;;
      4) neo_compose ps ;;
      5) neo_compose logs --tail=80 --no-color bot-api caddy postgres ;;
      0 | q | Q) return 0 ;;
      *) neo_err 'Unknown choice.' ;;
    esac
  done
}

neo_backup_db() {
  if ! neo_env_exists; then
    neo_die 'No .env yet. Run install / first setup first.'
  fi
  neo_require_host_tools
  local password url
  password="$(neo_env_get POSTGRES_PASSWORD || true)"
  url="$(neo_env_get DATABASE_URL || true)"
  if [[ -z "$url" && -n "$password" ]]; then
    url="postgres://neo_bot:${password}@postgres:5432/neo_bot"
  fi
  if [[ -z "$url" ]]; then
    neo_die 'DATABASE_URL or POSTGRES_PASSWORD is missing from .env.'
  fi
  neo_say 'Writing a local dump under backups/. Copy it off the host afterwards.'
  (
    cd "$NEO_ROOT" || exit 1
    DATABASE_URL="$url" COMPOSE_FILE="$NEO_COMPOSE_FILE" bash tools/postgres-backup.sh
  )
}

neo_health_check() {
  if ! command -v curl >/dev/null 2>&1; then
    neo_err 'curl is required for the health check.'
    return 1
  fi
  local failed=0
  neo_say 'Loopback GET /health:'
  if curl -fsS --connect-timeout 3 --max-time 10 http://127.0.0.1:3100/health; then
    printf '\n'
  else
    neo_err 'API health failed on loopback. Is bot-api running?'
    failed=1
  fi
  local host=""
  if neo_env_exists; then
    host="$(neo_env_get TELEGRAM_PUBLIC_HOST || true)"
  fi
  if [[ -n "$host" ]]; then
    neo_say "Public HTTPS GET /health on ${host}:"
    if curl -fsS --connect-timeout 5 --max-time 15 "https://${host}/health"; then
      printf '\n'
      neo_say 'If Telegram should use the webhook, restart bot-api after HTTPS works.'
    else
      neo_err 'Caddy/TLS public HTTPS health failed. Check DNS, ports 80/443, and Caddy logs.'
      failed=1
    fi
  else
    neo_err 'Public HTTPS health was not checked: TELEGRAM_PUBLIC_HOST is missing.'
    failed=1
  fi
  if command -v docker >/dev/null 2>&1 && neo_detect_compose && neo_env_exists; then
    neo_compose ps || true
  fi
  neo_say 'Do not paste tokens, .env, or webhook secrets into chat.'
  return "$failed"
}
