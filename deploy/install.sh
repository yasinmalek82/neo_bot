#!/usr/bin/env bash
# First-host installer: writes a gitignored .env and builds customer static assets,
# then starts Postgres, bot-api, and Caddy with automatic HTTPS.
# Never run with `bash -x` or `set -x`; prompts include secrets.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ -e /proc/1/cgroup ]] && grep -qE 'docker|containerd|kubepods' /proc/1/cgroup 2>/dev/null; then
  printf '%s\n' 'Run this script on the VPS host, not inside a container.' >&2
  exit 1
fi

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'Missing command: %s\n' "$1" >&2
    exit 1
  fi
}

need_cmd docker
need_cmd openssl
if docker compose version >/dev/null 2>&1; then
  COMPOSE=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE=(docker-compose)
else
  printf '%s\n' 'Install Docker Compose v2 (docker compose).' >&2
  exit 1
fi

prompt() {
  local value=""
  printf '%s' "$1" >&2
  IFS= read -r value
  printf '%s' "$value"
}

prompt_secret() {
  local value=""
  printf '%s' "$1" >&2
  if [[ -t 0 ]]; then
    stty -echo
    IFS= read -r value
    stty echo
    printf '\n' >&2
  else
    IFS= read -r value
  fi
  printf '%s' "$value"
}

url_safe_secret() {
  openssl rand -hex 24
}

url_safe_password() {
  openssl rand -hex 16
}

HOST_NAME="$(prompt 'Public hostname (DNS A record must already point here, no https://): ')"
if [[ -z "$HOST_NAME" || "$HOST_NAME" == *://* || "$HOST_NAME" == */* || "$HOST_NAME" == *$'\n'* ]]; then
  printf '%s\n' 'Enter only the DNS hostname. Do not invent one and do not include a URL scheme.' >&2
  exit 1
fi
if [[ "$HOST_NAME" =~ ^[0-9]+(\.[0-9]+){3}$ ]]; then
  printf '%s\n' 'Let’s Encrypt needs a DNS hostname, not a raw IP.' >&2
  exit 1
fi
if [[ ! "$HOST_NAME" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$ ]]; then
  printf '%s\n' 'That hostname is not valid.' >&2
  exit 1
fi

BOT_TOKEN="$(prompt_secret 'BotFather token (input hidden): ')"
if [[ ! "$BOT_TOKEN" =~ ^[0-9]{5,20}:[A-Za-z0-9_-]{20,}$ ]]; then
  printf '%s\n' 'That token does not look like a BotFather token.' >&2
  exit 1
fi

ADMIN_IDS="$(prompt 'Numeric admin Telegram IDs (comma-separated): ')"
ADMIN_IDS="${ADMIN_IDS// /}"
if [[ -z "$ADMIN_IDS" ]]; then
  printf '%s\n' 'At least one numeric admin ID is required.' >&2
  exit 1
fi
IFS=',' read -r -a ADMIN_ID_LIST <<<"$ADMIN_IDS"
for admin_id in "${ADMIN_ID_LIST[@]}"; do
  if [[ ! "$admin_id" =~ ^[0-9]{1,20}$ ]]; then
    printf '%s\n' 'Admin IDs must be numeric Telegram user IDs.' >&2
    exit 1
  fi
done

REPORT_GROUP="$(prompt 'Report group chat ID (empty to skip forum topics): ')"
if [[ -n "$REPORT_GROUP" && ! "$REPORT_GROUP" =~ ^-?[0-9]{1,20}$ ]]; then
  printf '%s\n' 'Report group chat ID must be a Telegram chat id.' >&2
  exit 1
fi

PASARGUARD_URL="$(prompt 'PasarGuard base URL (empty keeps a placeholder until you edit .env): ')"
if [[ -z "$PASARGUARD_URL" ]]; then
  PASARGUARD_URL='https://panel.example.invalid'
fi
PASARGUARD_KEY="$(prompt_secret 'PasarGuard API key (hidden; empty keeps a placeholder): ')"
if [[ -z "$PASARGUARD_KEY" ]]; then
  PASARGUARD_KEY='replace-me-later'
fi
if [[ ${#PASARGUARD_KEY} -lt 8 ]]; then
  printf '%s\n' 'PasarGuard API key must be at least 8 characters.' >&2
  exit 1
fi

if [[ -f .env ]]; then
  OVERWRITE="$(prompt '.env already exists. Overwrite? type yes to continue: ')"
  if [[ "$OVERWRITE" != 'yes' ]]; then
    printf '%s\n' 'Stopped without changing .env.' >&2
    exit 1
  fi
fi

WEBHOOK_SECRET="$(url_safe_secret)"
POSTGRES_PASSWORD="$(url_safe_password)"

umask 077
{
  printf '%s\n' 'NODE_ENV=production'
  printf '%s\n' 'HOST=0.0.0.0'
  printf '%s\n' 'PORT=3100'
  printf '%s\n' 'LOG_LEVEL=info'
  printf 'TELEGRAM_PUBLIC_HOST=%s\n' "$HOST_NAME"
  printf 'WEB_ORIGINS=https://%s\n' "$HOST_NAME"
  printf 'POSTGRES_PASSWORD=%s\n' "$POSTGRES_PASSWORD"
  printf 'DATABASE_URL=postgres://neo_bot:%s@postgres:5432/neo_bot\n' "$POSTGRES_PASSWORD"
  printf 'PASARGUARD_BASE_URL=%s\n' "$PASARGUARD_URL"
  printf 'PASARGUARD_API_KEY=%s\n' "$PASARGUARD_KEY"
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
  printf '%s\n' 'TELEGRAM_ENABLED=true'
  printf 'TELEGRAM_BOT_TOKEN=%s\n' "$BOT_TOKEN"
  printf 'TELEGRAM_WEBHOOK_SECRET=%s\n' "$WEBHOOK_SECRET"
  printf 'TELEGRAM_WEBHOOK_URL=https://%s/telegram/webhook\n' "$HOST_NAME"
  printf 'TELEGRAM_ADMIN_IDS=%s\n' "$ADMIN_IDS"
  if [[ -n "$REPORT_GROUP" ]]; then
    printf 'TELEGRAM_REPORT_GROUP_CHAT_ID=%s\n' "$REPORT_GROUP"
  fi
} >.env
chmod 600 .env

printf '%s\n' 'Wrote host .env (gitignored). Building static apps…'

build_static() {
  pnpm install --frozen-lockfile
  pnpm --filter admin-web run check:runtime
  pnpm --filter admin-web exec tsc
  pnpm --filter admin-web exec vite build
}

if command -v pnpm >/dev/null 2>&1; then
  build_static
else
  docker run --rm \
    -v "$ROOT":/app \
    -w /app \
    -e COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    node:24-bookworm \
    bash -lc 'corepack enable && corepack prepare pnpm@11 --activate && pnpm install --frozen-lockfile && pnpm --filter admin-web run check:runtime && pnpm --filter admin-web exec tsc && pnpm --filter admin-web exec vite build'
fi

if [[ ! -f apps/admin-web/dist/client/index.html ]]; then
  printf '%s\n' 'Mini App dist/client is missing after the build.' >&2
  exit 1
fi

printf '%s\n' 'Starting Postgres, bot-api, and Caddy…'
"${COMPOSE[@]}" -f docker-compose.production.yml up -d --build

printf '%s\n' 'Waiting for loopback /health…'
ok=0
if command -v curl >/dev/null 2>&1; then
  for ((i = 0; i < 30; i += 1)); do
    if curl -fsS http://127.0.0.1:3100/health >/dev/null 2>&1; then
      ok=1
      break
    fi
    sleep 2
  done
  if [[ "$ok" -ne 1 ]]; then
    printf '%s\n' 'bot-api did not become healthy on loopback. Check compose logs on the host.' >&2
    exit 1
  fi
else
  printf '%s\n' 'curl is not installed; check `docker compose -f docker-compose.production.yml ps` yourself.'
fi

printf '%s\n' 'Install finished. Caddy will request TLS certificates for the hostname you typed.'
printf '%s\n' 'Restart bot-api once HTTPS works so the webhook is registered:'
printf '%s\n' '  docker compose -f docker-compose.production.yml restart bot-api'
printf '%s\n' 'Do not paste the BotFather token, .env, or webhook secret into chat.'
