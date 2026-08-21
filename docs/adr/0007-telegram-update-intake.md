# ADR 0007: Telegram update intake for local and production

- Status: accepted
- Date: 2026-08-21

## Context

Operator forum topics exist, but Telegram cannot deliver customer updates to `127.0.0.1`. A public
HTTPS webhook is the production intake. Local confirmation of `/start` and checkout notices must not
wait on TLS, a reverse proxy, or a tunnel.

Telegram allows only one intake at a time: `getUpdates` long-polling works after `deleteWebhook`;
`setWebhook` disables polling.

## Decision

When the bot is enabled:

- If `TELEGRAM_WEBHOOK_URL` is unset, the process calls `deleteWebhook` and polls `getUpdates` with a
  short timeout so forum sends are not queued behind a long-held HTTP connection. Each update uses
  the same `handleUpdate` path as `POST /telegram/webhook`.
- If `TELEGRAM_WEBHOOK_URL` is set, it must be `https` with no credentials. The process calls
  `setWebhook` with the existing secret token and does not poll.

`packages/domain` stays free of Telegram intake. Failed updates are not skipped past; the poller
keeps the last unprocessed `update_id` so Telegram can redeliver. Duplicate `update_id` values remain
deduplicated in PostgreSQL. Malformed payloads that fail schema validation are marked completed
without a 500 so a poison update cannot stall webhook or polling intake.

## Consequences

- Local testers can talk to the bot without a public URL.
- Production still uses a webhook when an HTTPS URL is configured.
- A crash during polling may retry a failed update; completed updates are not processed twice.
- Registering a webhook URL on a machine that cannot receive Telegram traffic will starve intake
  until the URL is cleared.
