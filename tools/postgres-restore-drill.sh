#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ -z "${DATABASE_URL:-}" ]]; then
  printf '%s\n' 'DATABASE_URL must be set in the environment.' >&2
  exit 1
fi

container='neo_bot_restore_drill'
password='local-restore-drill-only'
dump=''

cleanup() {
  docker rm -f "${container}" >/dev/null 2>&1 || true
  if [[ -n "${dump}" && -f "${dump}" ]]; then
    rm -f "${dump}"
  fi
}
trap cleanup EXIT

backup_line="$(bash tools/postgres-backup.sh)"
dump="${backup_line#Wrote }"
if [[ ! -f "${dump}" ]]; then
  printf '%s\n' 'Backup did not produce a dump file.' >&2
  exit 1
fi

docker rm -f "${container}" >/dev/null 2>&1 || true
docker run -d --name "${container}" \
  -e POSTGRES_DB=neo_bot_drill \
  -e POSTGRES_USER=neo_bot \
  -e POSTGRES_PASSWORD="${password}" \
  -p '127.0.0.1:55433:5432' \
  postgres:17-alpine >/dev/null

ready=0
for _ in $(seq 1 40); do
  if docker exec "${container}" pg_isready -U neo_bot -d neo_bot_drill >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done
if [[ "${ready}" -ne 1 ]]; then
  printf '%s\n' 'Disposable Postgres did not become ready.' >&2
  exit 1
fi

docker cp "${dump}" "${container}:/tmp/restore.dump"
docker exec "${container}" pg_restore --clean --if-exists --no-owner --no-acl \
  -U neo_bot -d neo_bot_drill /tmp/restore.dump >/dev/null

migrations="$(docker exec "${container}" psql -U neo_bot -d neo_bot_drill -tAc \
  'select count(*) from schema_migrations')"
migrations="${migrations//[[:space:]]/}"
if [[ ! "${migrations}" =~ ^[0-9]+$ ]] || [[ "${migrations}" -lt 6 ]]; then
  printf '%s\n' 'Restore drill did not reload schema_migrations.' >&2
  exit 1
fi

printf 'Restore drill ok (schema_migrations=%s)\n' "${migrations}"
