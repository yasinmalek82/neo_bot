# neo_bot

Private clean-room foundation for a modular Telegram VPN sales bot.

## Continue from another Codex account

`PROJECT_CONTEXT.md` is the canonical current status, complete roadmap and next-task handoff. A new
Codex session must read `AGENTS.md` and `PROJECT_CONTEXT.md`, inspect `git status`, then run:

```bash
pnpm context:check
```

The source fingerprint makes `pnpm check` fail when material project files change without refreshing
the handoff. After accurately updating the context and its handoff log, run `pnpm context:stamp` and
then the normal verification. Never stamp undocumented or unknown changes.

The repository now contains two tested vertical slices:

- PasarGuard provider health, group discovery, direct-service creation, read and renewal.
- A card-to-card commerce flow with hierarchical categories, sellable variants, Telegram customers,
  idempotent orders, payment-proof review and provisioning after administrator approval.

The customer store and administrator catalog management both run in Telegram chat. Products,
volume/duration/device combinations, prices, ordering and copy come from the published catalog.
Card-to-card details live only in published storefront settings and are shown in chat after checkout,
not on `GET /catalog`. Reseller wallets, legacy import and cutover are still out of scope.

## Local prerequisites

- Node.js 24 or newer
- pnpm 11
- Docker

Copy `.env.example` to `.env`, change only local values, then start PostgreSQL and run migrations.

## نصب سریع روی سرور / Quick install

Owner path for one Ubuntu/Debian VPS. Do not invent a hostname. Point a DNS **A** record at the
server first. Let’s Encrypt will not issue a certificate for a raw IP.

Prerequisites: Ubuntu 22.04/24.04-style host, Git, curl, Docker Engine, Docker Compose v2. The
menu can install those packages on Ubuntu/Debian if you type `yes`.

After this branch is merged to `main`:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/yasinmalek82/neo_bot/main/deploy/neo-install.sh)
```

Until merge, pin the PR branch (replace the ref if you checked out a different name):

```bash
NEO_BOT_REF=cursor/vps-installer-menu-59e1 bash <(curl -fsSL https://raw.githubusercontent.com/yasinmalek82/neo_bot/cursor/vps-installer-menu-59e1/deploy/neo-install.sh)
```

Or clone first, then open the same menu:

```bash
git clone https://github.com/yasinmalek82/neo_bot.git
cd neo_bot
bash deploy/neo-install.sh
```

The bootstrap clones or updates `/opt/neo_bot` (or `$HOME/neo_bot`), then opens `deploy/neo`.
Type values only on the server:

- public DNS hostname (no `https://`)
- BotFather token (hidden)
- numeric admin Telegram IDs
- optional report forum chat ID
- optional PasarGuard URL and API key (placeholders are fine until checkout provisioning)
- optional public bot username for invite links

It writes a gitignored `.env`, generates database and webhook secrets, keeps `PILOT_ENABLED=false`
and `PROVISIONING_MODE=disabled`, builds customer static assets, and starts
`docker-compose.production.yml` (Postgres unpublished, API on loopback, Caddy on 80/443).
Running install again detects an existing `.env` and offers keep-and-rebuild versus reconfigure
(reconfigure keeps the database password and webhook secret).

After HTTPS answers, use the menu (`bash deploy/neo` or `neo` when the symlink exists) to restart
`bot-api`, then confirm `GET https://<hostname>/health` and tap `/start` in Telegram. The customer
store is the chat. Details: `docs/runbooks/first-host.md`.
Never commit `.env` or paste tokens, webhook secrets, or subscription URLs into chat or GitHub
issues. `bash deploy/install.sh` still runs first setup only, without the management menu.

## Local verification

```bash
pnpm install
docker compose up -d postgres
pnpm --filter @neo-bot/database migrate
pnpm check
pnpm test:integration
```

Start the local API on port `3100` and request `GET /health`:

```bash
pnpm --filter @neo-bot/bot-api dev
```

Optional in-process app container (secrets come from `.env`, not the compose file):

```bash
docker compose --profile app up --build
```

## Isolated local test profile

Use this profile instead of a VPS or Mini App test host. It always uses the fixed Compose project
name `neo_bot_local_test`, so its containers, network, and named PostgreSQL volume are separate from
the default local Compose project.

```bash
pnpm local-test:up
pnpm local-test:status
pnpm local-test:logs
pnpm local-test:down
```

The default startup forces `PROVISIONING_MODE=disabled`, `PILOT_ENABLED=false`, an empty
`TELEGRAM_WEBHOOK_URL`, no Telegram reporting group, and `TELEGRAM_ENABLED=false`; it cannot call
Telegram or provision through PasarGuard. `local-test:down` intentionally preserves the isolated
PostgreSQL volume. There is no reset or volume-deletion command in this workflow.

The profile keeps the existing `127.0.0.1:55432` and `127.0.0.1:3100` bindings. It therefore cannot
run concurrently with another local Compose stack that already owns either port.

To intentionally test a dedicated bot with local polling, enable it only while this is the sole
intended intake for that bot:

```bash
LOCAL_TELEGRAM_ENABLED=true pnpm local-test:up
```

This clears the configured webhook with `drop_pending_updates=false` and then uses `getUpdates`
polling, so it can take over the bot's Telegram intake while preserving queued updates. Never use it
while a production webhook, another poller, or any other intended bot intake is active.

Start the optional customer static interface:

```bash
pnpm --filter admin-web dev -- --host 127.0.0.1 --port 4173
```

- Customer static interface: `http://127.0.0.1:4173/` (talks to `http://127.0.0.1:3100` unless `VITE_API_BASE_URL` is set)
- Public catalog API: `GET /catalog`

## Managing products without code changes

1. Open «مدیریت فروشگاه» in the private administrator chat.
2. Edit customer-facing copy or a product.
3. Add one matrix row for each valid combination of volume, duration, simultaneous connections and
   price.
4. Select one or more available PasarGuard groups. Keep experimental products on an isolated group.
5. Mark valid rows sellable, keep the product visible, then use **Save and publish**.
6. In Telegram tap `/start` and use «خرید سرویس». Selectors and exact prices come from the published rows.

The publish is atomic. Invalid prices, duplicate codes or unavailable groups reject the entire change
instead of exposing a partially edited catalog.

## Telegram customer bot

The webhook endpoint is `POST /telegram/webhook`. It accepts updates only when
`TELEGRAM_ENABLED=true` and the `X-Telegram-Bot-Api-Secret-Token` header matches the configured
secret. Keep it disabled until the BotFather token and administrator Telegram IDs are present in the
local `.env`. Card numbers are published from private administrator chat, not from Telegram env vars.

Leave `TELEGRAM_WEBHOOK_URL` unset for local use: the process deletes any webhook and long-polls
`getUpdates`. Set an `https` URL only when Telegram can POST to this process. Buy, pay, and send the
receipt photo in the private bot chat.

The first purchase journey is:

1. `/start` opens a mixed inline menu (full-width buy row, then paired order/renew) and pins the
   same buttons at the bottom of the chat. Administrators get the same customer home plus an
   extra admin-hub row; operator status, reports and the review queue live inside that hub.
2. choose a category and plan from the buttons; the same message is updated as a menu
3. receive the exact amount and card details
4. send a receipt photo
5. administrator approves or rejects the receipt
6. approval provisions the PasarGuard service with an order-scoped idempotency key

Telegram update IDs, order creation, payment-proof submission and provisioning retries are all
deduplicated. Receipt file references and subscription URLs are never written to application logs.

When the bot is enabled, an idle outbox dispatcher also flushes pending operator reports on a timer
so quiet webhook traffic cannot strand notices. Set `TELEGRAM_REPORT_DISPATCH_INTERVAL_MS=0` to keep
webhook-only report flushing. Durable customer delivery has its own always-on timer, configured with
`TELEGRAM_DELIVERY_DISPATCH_INTERVAL_MS`, so a quiet webhook cannot strand a fulfilled order.

Operator reports go to a private Telegram forum. Create the group, enable Topics, add the bot as
administrator with Manage Topics, then set `TELEGRAM_REPORT_GROUP_CHAT_ID`. On startup the bot
creates the purpose topics (new users, orders, receipts, sales, renewals, resellers, errors, daily
summaries) and stores their thread IDs. It does not rename or delete topics. If Telegram later
reports a topic missing, the bot clears that mapping, recreates the purpose topic, retries the same
notice, and posts a redacted error to the errors topic. Do not paste the group ID, bot token or
topic IDs into chat.

`GET /health` reports whether the database is reachable, whether Telegram intake is disabled,
polling, or webhook, whether intake is ready (`telegramReady`: polling has a recent successful
`getUpdates`, webhook has no allowlisted error and a matching `getWebhookInfo`), an allowlisted
`telegramError` code, how many schema migrations are applied, and how many report deliveries are
pending or failed. It does not include order identifiers or Telegram descriptions.

## Database backup and restore

Dump the configured Postgres database without committing the file:

```bash
pnpm db:backup
```

Prove restore without touching the live database:

```bash
pnpm db:restore-drill
```

Restore onto a chosen disposable target still requires `RESTORE_CONFIRM=yes`:

```bash
RESTORE_CONFIRM=yes pnpm db:restore -- backups/neo_bot-20260821T120000Z.dump
```

Keep dump files off the git tree. Copy production dumps off the host. See
`docs/runbooks/production.md` for TLS, webhook registration, and rollback.

## Isolated PasarGuard pilot

Use only a dedicated non-production group. Keep `PILOT_ENABLED=false` for read-only commands and set it
to `true` only for an intentional pilot mutation.

```bash
pnpm --filter @neo-bot/bot-api pilot provider-health
pnpm --filter @neo-bot/bot-api pilot sync-groups
pnpm --filter @neo-bot/bot-api pilot seed-variant
pnpm --filter @neo-bot/bot-api pilot create <variant-id> <idempotency-key>
pnpm --filter @neo-bot/bot-api pilot get <service-id>
pnpm --filter @neo-bot/bot-api pilot renew <service-id> <idempotency-key>
```

Pilot output never prints the API key or full subscription URL. The create and renew commands are
blocked unless `PILOT_ENABLED=true`.

## Current validation boundary

The PasarGuard contract, purchase flow and PostgreSQL commerce lifecycle are automated. Local enabled
bots receive Telegram updates with `getUpdates` unless `TELEGRAM_WEBHOOK_URL` is set. Live user
migration and production deployment are intentionally not part of the default test commands.
