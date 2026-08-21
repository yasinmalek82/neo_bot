# ADR 0009: Operator health, backup restore, and stale forum topic recovery

- Status: accepted
- Date: 2026-08-21

## Context

ADR 0005 requires deleted or invalid report topics to fail visibly and not retry as if checkout
failed. ADR 0006 recreates missing purpose topics only on startup. A live topic deletion could
strand notices until a restart. Production also needs a backup/restore path and operator-visible
queue depth without exposing order IDs, file IDs or secrets.

## Decision

- When Telegram reports a missing or closed forum topic, or a purpose has no stored thread, the
  application deletes that purpose binding if needed, records a redacted `system.failure`, recreates
  missing topics through the existing provisioner, and retries the same delivery. Permanent delivery
  failures also record one redacted operator notice per purpose and error code per UTC day. The bot
  still does not rename, close or delete topics.
- `GET /health` stays public and adds only integer `reports.pending` and `reports.failed` counts,
  a boolean `telegramReady`, and an allowlisted `telegramError` code. Identifiers, Telegram
  descriptions, tokens and timestamps stay out of the response. HTTP stays `200` when the database
  is reachable so a Telegram outage does not restart the container in a loop. Polling `telegramReady`
  is false after a sanitized transport error. Webhook `telegramReady` stays true when quiet with no
  error, and is false after an allowlisted error. A background `getWebhookInfo` timer (not
  `GET /health`) maps missing/mismatched URL to `TELEGRAM_WEBHOOK_UNSET` and a delivery error newer
  than the last successful webhook POST to `TELEGRAM_WEBHOOK_DELIVERY`. Unauthorized webhook POSTs
  do not mark intake down.
- Local and later production Postgres backups use `pg_dump` custom format via `pnpm db:backup`.
  When `DATABASE_URL` points at the compose network (`postgres:5432` or the local published port
  `55432`), dump and restore use `docker compose exec` before any host client. Host `postgres`
  selects `docker-compose.production.yml` unless `COMPOSE_FILE` is set. Restore requires
  `RESTORE_CONFIRM=yes` and an explicit dump path. Dump files are not committed.
  `pnpm db:restore-drill` restores a fresh dump onto a disposable Postgres on loopback and then
  destroys that instance. It must not target the live database.
  `docker-compose.production.yml` injects `bot-api` `DATABASE_URL` with host `postgres` so a
  loopback value in `.env` cannot strand the container.

`packages/domain` stays free of health, dump and forum-thread concepts. No database transaction
stays open across Telegram.

## Consequences

- A deleted receipts topic does not lose the payment-proof event; the next dispatch can post to a
  newly created topic.
- Operators can alert on failed report counts without scraping logs.
- A restore drill can be run against a disposable database. Production host, TLS and off-host
  backup storage remain owner-side. `docker-compose.production.yml` is the in-repo host shape;
  it is not a live deployment.
