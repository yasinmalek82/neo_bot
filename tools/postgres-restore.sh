#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

file="${1:-}"
if [[ -z "${file}" ]]; then
  printf '%s\n' 'Usage: pnpm db:restore -- backups/<file>.dump' >&2
  exit 1
fi
if [[ ! -f "${file}" ]]; then
  printf '%s\n' 'Dump file not found.' >&2
  exit 1
fi

if [[ "${RESTORE_CONFIRM:-}" != "yes" ]]; then
  printf '%s\n' 'Set RESTORE_CONFIRM=yes to replace the target database.' >&2
  exit 1
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  printf '%s\n' 'DATABASE_URL must be set in the environment.' >&2
  exit 1
fi

compose_cmd() {
  if [[ -n "${COMPOSE_FILE:-}" ]]; then
    docker compose "$@"
    return
  fi
  case "${DATABASE_URL}" in
    *@postgres:5432/*)
      docker compose -f docker-compose.production.yml "$@"
      ;;
    *)
      docker compose "$@"
      ;;
  esac
}

restore_with_client() {
  pg_restore --clean --if-exists --no-owner --no-acl --dbname="${DATABASE_URL}" "${file}"
}

restore_with_compose() {
  compose_cmd cp "${file}" postgres:/tmp/neo_bot-restore.dump
  compose_cmd exec -T postgres pg_restore --clean --if-exists --no-owner --no-acl -U neo_bot -d neo_bot /tmp/neo_bot-restore.dump
  compose_cmd exec -T postgres rm -f /tmp/neo_bot-restore.dump
}

is_compose_network_url() {
  case "${DATABASE_URL}" in
    *@127.0.0.1:55432/* | *@localhost:55432/* | *@postgres:5432/*) return 0 ;;
    *) return 1 ;;
  esac
}

is_loopback_compose_url() {
  case "${DATABASE_URL}" in
    *@127.0.0.1:55432/* | *@localhost:55432/*) return 0 ;;
    *) return 1 ;;
  esac
}

restored=0
if is_compose_network_url && command -v docker >/dev/null 2>&1; then
  if restore_with_compose; then
    restored=1
  elif is_loopback_compose_url && command -v pg_restore >/dev/null 2>&1; then
    restore_with_client
    restored=1
  else
    printf '%s\n' 'docker compose restore failed. For host postgres use docker-compose.production.yml.' >&2
    exit 1
  fi
fi

if [[ "${restored}" -eq 0 ]]; then
  if command -v pg_restore >/dev/null 2>&1; then
    restore_with_client
  else
    printf '%s\n' 'pg_restore is required (PostgreSQL client tools).' >&2
    exit 1
  fi
fi

printf 'Restored %s\n' "${file}"
