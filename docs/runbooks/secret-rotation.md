# Secret rotation

Rotate host secrets without pasting values into chat, tickets, or logs. This procedure is not a
live rotation; it is the in-repo checklist for the first single-owner host.

## Rules

- Change one secret at a time, then confirm `GET /health` returns `status: ok`.
- Never commit `.env`. Never print the new value.
- Leave `PILOT_ENABLED=false` unless an isolated PasarGuard group is still the only target.
- After a Bot API token change, restart `bot-api` so in-memory clients drop the old token.

## Telegram bot token

1. Revoke or issue a new token in BotFather.
2. Replace `TELEGRAM_BOT_TOKEN` on the host `.env`.
3. Restart `bot-api`.
4. Confirm private `/start` still answers, and `GET /health` shows the expected intake mode.

## Telegram webhook secret

1. Generate a new high-entropy secret locally; put it in `TELEGRAM_WEBHOOK_SECRET`.
2. Restart `bot-api`. Startup registers `setWebhook` with the new secret when
   `TELEGRAM_WEBHOOK_URL` is set.
3. Confirm Telegram POSTs still return `200`. Unauthorized probes must not mark intake as down.

## PasarGuard API key

1. Issue a new key in the panel; replace the host value.
2. Restart `bot-api`.
3. Confirm provider health from the operator machine without pasting the key.
4. Keep using numeric target IDs; usernames are not the persistence key.

## Database password

1. Change the Postgres role password.
2. Update `DATABASE_URL` on the host (and compose `POSTGRES_PASSWORD` if that file is the source).
3. Restart Postgres then `bot-api`.
4. Run `pnpm db:backup` and copy the dump off-host.

## Catalog admin development token

The Bearer catalog token is development-only. Do not reuse it on a public host. Production catalog
edits use verified Mini App `initData` for administrators.

## After rotation

Watch `GET /health` `telegramReady` and `reports.failed`. A competing `getUpdates` session surfaces
as `telegramError: TELEGRAM_POLLING_CONFLICT` without webhook descriptions. If intake stays unready,
stop extra pollers; do not paste Telegram error bodies into chat.
