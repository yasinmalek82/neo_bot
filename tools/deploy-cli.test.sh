#!/usr/bin/env bash
# Fast, Docker-free checks for the host installer helpers.
# Never run with `set -x`; the fixtures include fake secrets.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/neo-deploy-test.XXXXXX")"
cleanup() {
  rm -rf "$TMP"
}
trap cleanup EXIT

export NEO_ROOT="$TMP"
# shellcheck source=../deploy/lib.sh
source "${ROOT}/deploy/lib.sh"

fail() {
  printf 'FAIL: %s\n' "$*" >&2
  exit 1
}

pass() {
  printf 'ok %s\n' "$*"
}

expect_fail() {
  local label="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    fail "$label should have been rejected"
  fi
  pass "$label rejected"
}

expect_ok() {
  local label="$1"
  shift
  if ! "$@" >/dev/null 2>&1; then
    fail "$label should have been accepted"
  fi
  pass "$label accepted"
}

expect_fail 'empty hostname' neo_validate_hostname ''
expect_fail 'url hostname' neo_validate_hostname 'https://bot.example.com'
expect_fail 'path hostname' neo_validate_hostname 'bot.example.com/path'
expect_fail 'ipv4 hostname' neo_validate_hostname '203.0.113.10'
expect_fail 'ipv6 hostname' neo_validate_hostname '2001:db8::1'
expect_ok 'dns hostname' neo_validate_hostname 'bot.example.com'

expect_fail 'short token' neo_validate_bot_token '123:short'
expect_fail 'empty token' neo_validate_bot_token ''
expect_ok 'botfather token' neo_validate_bot_token '123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZ12'

expect_fail 'empty admins' neo_validate_admin_ids ''
expect_fail 'named admins' neo_validate_admin_ids 'alice,2'
expect_ok 'numeric admins' neo_validate_admin_ids '10001, 20002'

expect_fail 'bad report id' neo_validate_report_chat_id 'forum'
expect_ok 'empty report id' neo_validate_report_chat_id ''
expect_ok 'negative report id' neo_validate_report_chat_id '-1001234567890'

expect_fail 'http panel' neo_validate_https_url 'http://panel.example.com'
expect_fail 'credential panel' neo_validate_https_url 'https://user:pass@panel.example.com'
expect_ok 'https panel' neo_validate_https_url 'https://panel.example.com'

expect_fail 'short panel key' neo_validate_pasarguard_key 'short'
expect_ok 'panel key' neo_validate_pasarguard_key 'replace-me-later'

expect_fail 'bad bool' neo_validate_bool 'YES'
expect_ok 'true bool' neo_validate_bool 'true'
expect_fail 'bad mode' neo_validate_provisioning_mode 'pilot'
expect_ok 'disabled mode' neo_validate_provisioning_mode 'disabled'
expect_fail 'zero group' neo_validate_positive_int '0'
expect_ok 'group id' neo_validate_positive_int '42'
expect_fail 'bad username' neo_validate_bot_username 'ab'
expect_ok 'bot username' neo_validate_bot_username 'NeoNetworkBot'

neo_write_production_env \
  'bot.example.com' \
  '123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZ12' \
  '10001,20002' \
  '-1001234567890' \
  'https://panel.example.com' \
  'replace-me-later' \
  '0' \
  'NeoNetworkBot'

[[ "$(neo_env_get TELEGRAM_PUBLIC_HOST)" == 'bot.example.com' ]] || fail 'hostname was not written'
[[ "$(neo_env_get TELEGRAM_ADMIN_IDS)" == '10001,20002' ]] || fail 'admin ids were not written'
[[ "$(neo_env_get TELEGRAM_WEBHOOK_URL)" == 'https://bot.example.com/telegram/webhook' ]] || fail 'webhook url was not written'
[[ "$(neo_env_get PILOT_ENABLED)" == 'false' ]] || fail 'pilot must stay false on first write'
[[ "$(neo_env_get PROVISIONING_MODE)" == 'disabled' ]] || fail 'provisioning must start disabled'
[[ "$(neo_env_get TELEGRAM_BOT_USERNAME)" == 'NeoNetworkBot' ]] || fail 'bot username was not written'
first_password="$(neo_env_get POSTGRES_PASSWORD)"
first_webhook="$(neo_env_get TELEGRAM_WEBHOOK_SECRET)"
[[ ${#first_password} -ge 16 ]] || fail 'postgres password was not generated'
[[ ${#first_webhook} -ge 16 ]] || fail 'webhook secret was not generated'
[[ "$(stat -c '%a' "$(neo_env_file)")" == '600' ]] || fail '.env mode must be 600'

masked="$(neo_env_display TELEGRAM_BOT_TOKEN)"
[[ "$masked" != *'ABCDEFGHIJKLMNOPQRSTUVWXYZ12'* ]] || fail 'token must stay masked'
[[ "$masked" == *'YZ12' ]] || fail 'mask should keep a short suffix'

neo_write_production_env \
  'bot.example.com' \
  '123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZ12' \
  '10001' \
  '' \
  'https://panel.example.com' \
  'replace-me-later' \
  '1' \
  ''
[[ "$(neo_env_get POSTGRES_PASSWORD)" == "$first_password" ]] || fail 'reconfigure must keep the database password'
[[ "$(neo_env_get TELEGRAM_WEBHOOK_SECRET)" == "$first_webhook" ]] || fail 'reconfigure must keep the webhook secret'
if neo_env_get TELEGRAM_REPORT_GROUP_CHAT_ID >/dev/null; then
  fail 'cleared report group should be omitted'
fi

neo_apply_hostname 'shop.example.com'
[[ "$(neo_env_get TELEGRAM_PUBLIC_HOST)" == 'shop.example.com' ]] || fail 'hostname apply failed'
[[ "$(neo_env_get WEB_ORIGINS)" == 'https://shop.example.com' ]] || fail 'web origins were not rewritten'
[[ "$(neo_env_get TELEGRAM_WEBHOOK_URL)" == 'https://shop.example.com/telegram/webhook' ]] || fail 'webhook url was not rewritten'

neo_env_set TELEGRAM_ENABLED 'false'
[[ "$(neo_env_get TELEGRAM_ENABLED)" == 'false' ]] || fail 'env set failed'
neo_env_unset TELEGRAM_ENABLED
if neo_env_get TELEGRAM_ENABLED >/dev/null; then
  fail 'env unset failed'
fi

output="$(
  neo_env_display TELEGRAM_BOT_TOKEN
  neo_env_display PASARGUARD_API_KEY
  neo_env_display POSTGRES_PASSWORD
)"
if [[ "$output" == *'ABCDEFGHIJKLMNOPQRSTUVWXYZ12'* || "$output" == *"$first_password"* ]]; then
  fail 'display helpers leaked a secret'
fi
pass 'secrets stay masked'

for script in deploy/lib.sh deploy/install.sh deploy/neo deploy/menu.sh deploy/neo-install.sh; do
  bash -n "${ROOT}/${script}"
  pass "syntax ${script}"
done

if command -v shellcheck >/dev/null 2>&1; then
  shellcheck --severity=warning \
    "${ROOT}/deploy/lib.sh" \
    "${ROOT}/deploy/install.sh" \
    "${ROOT}/deploy/neo" \
    "${ROOT}/deploy/menu.sh" \
    "${ROOT}/deploy/neo-install.sh" \
    "${ROOT}/tools/deploy-cli.test.sh"
  pass 'shellcheck warning-clean'
else
  pass 'shellcheck not installed; syntax-only'
fi
