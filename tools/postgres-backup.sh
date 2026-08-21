#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ -z "${DATABASE_URL:-}" ]]; then
  printf '%s\n' 'DATABASE_URL must be set in the environment.' >&2
  exit 1
fi

mkdir -p backups
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
outfile="backups/neo_bot-${stamp}.dump"

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

dump_with_client() {
  pg_dump --no-owner --format=custom --file="${outfile}" "${DATABASE_URL}"
}

dump_with_compose() {
  compose_cmd exec -T postgres pg_dump -U neo_bot -d neo_bot --no-owner --format=custom >"${outfile}"
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

dumped=0
if is_compose_network_url && command -v docker >/dev/null 2>&1; then
  if dump_with_compose; then
    dumped=1
  elif is_loopback_compose_url && command -v pg_dump >/dev/null 2>&1; then
    dump_with_client
    dumped=1
  else
    printf '%s\n' 'docker compose dump failed. For host postgres use docker-compose.production.yml.' >&2
    rm -f "${outfile}"
    exit 1
  fi
fi

if [[ "${dumped}" -eq 0 ]]; then
  if command -v pg_dump >/dev/null 2>&1; then
    dump_with_client
  else
    printf '%s\n' 'pg_dump is required (PostgreSQL client tools).' >&2
    exit 1
  fi
fi

if [[ ! -s "${outfile}" ]]; then
  printf '%s\n' 'Backup file was empty.' >&2
  rm -f "${outfile}"
  exit 1
fi

printf 'Wrote %s\n' "${outfile}"
