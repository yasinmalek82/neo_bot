# Production host runbook

This is the in-repo procedure for the first single-owner host. It is not evidence that production
is already deployed. Beginners should start with `docs/runbooks/first-host.md` and
`bash deploy/install.sh`.

## Before DNS and TLS

1. Keep the legacy sales bot in service.
2. Copy `.env.example` to a host-only `.env`. Never commit it. Never paste values into chat.
3. Set `TELEGRAM_ENABLED=true`, a BotFather token, webhook secret, and numeric admin IDs.
4. Leave `TELEGRAM_WEBHOOK_URL` unset until HTTPS actually reaches this process.
5. Keep `PILOT_ENABLED=false` until an isolated PasarGuard group ID is configured.
6. Publish card details from private administrator chat, not from environment variables.
7. `POSTGRES_PASSWORD` must be URL-safe (no `@`, `:`, `/`, or `%`). Compose injects
   `DATABASE_URL` for `bot-api` as `postgres://neo_bot:${POSTGRES_PASSWORD}@postgres:5432/neo_bot`,
   which overrides a loopback `DATABASE_URL` in `.env`. Do not publish Postgres.

## Bring the process up

Prefer `bash deploy/install.sh` so `.env`, customer static assets, Compose, and Caddy TLS
are created together. Manual equivalent:

```bash
docker compose -f docker-compose.production.yml up -d --build
```

Postgres is not published. `bot-api` listens on `127.0.0.1:3100`. Compose Caddy terminates TLS on
80/443 using `deploy/Caddyfile.example`. Set `TELEGRAM_PUBLIC_HOST` to the public hostname (no
scheme). Confirm `GET /health` returns `status: ok` through HTTPS. The JSON includes integer report-queue
counts only: `reports.pending`, `reports.failed`, `reports.retrying` (pending deliveries already
retried at least once), and `reports.due` (pending deliveries whose next attempt time has passed).
No order IDs, file IDs, or secrets appear in the response. Alert when `reports.due` stays above
zero for several minutes (dispatch lag) or when `reports.retrying` climbs while `reports.failed`
remains zero (transient Telegram pressure).

## Customer static assets on the same host

`apps/admin-web` Vite output may still sit at `/` for Caddy, but it is not the customer store. Buy,
pay, and send the receipt in Telegram chat. `POST /customer/orders` and `POST /customer/renew` are
gone. Do not copy this tree into the `bot-api` image: `pnpm --filter admin-web build` also prepares an
OpenAI Sites worker. For Caddy, build only the static client:

```bash
pnpm --filter admin-web run check:runtime
pnpm --filter admin-web exec tsc
pnpm --filter admin-web exec vite build
```

Point `MINI_APP_DIST` at that `dist/client` directory (absolute path on the host). Catalog management
runs only in the private administrator chat; no web console or private catalog administration HTTP API
is served.

## Register the Telegram webhook

Set `TELEGRAM_WEBHOOK_URL` to the public `https` webhook path `/telegram/webhook` on that same
host (no credentials in the URL) and restart `bot-api`. Telegram must be able to POST that URL. A
webhook on a host that cannot receive Telegram traffic starves intake until the URL is cleared.

## Backup and restore

On the host, export a `DATABASE_URL` whose host is `postgres` (the compose service name) so
`pnpm db:backup` uses `docker compose -f docker-compose.production.yml exec`. A loopback
`DATABASE_URL` in `.env` is for local compose only. `COMPOSE_FILE` overrides file selection.

```bash
DATABASE_URL=postgres://neo_bot:${POSTGRES_PASSWORD}@postgres:5432/neo_bot pnpm db:backup
```

Copy dump files off the host. To prove restore without touching the live database:

```bash
pnpm db:restore-drill
```

`pnpm db:restore` still requires `RESTORE_CONFIRM=yes` and must only target a disposable database.

## Secret rotation

Follow `docs/runbooks/secret-rotation.md`. Rotate one host secret at a time, restart `bot-api`, and
confirm `GET /health` without pasting values into chat.

## Rollback

1. Stop `bot-api`.
2. Restore a known dump onto a disposable database and verify `GET /health` against that copy, or
   restore onto the live database only after an explicit owner decision.
3. Start the previous container image if the new image is the defect.
4. Leave `PILOT_ENABLED=false` unless the isolated group is still the only target.

## Do not call this production yet

A public HTTPS webhook, one real purchase and renewal on an isolated provider group, off-host dump
storage, and a seven-day invited cohort are still required.
