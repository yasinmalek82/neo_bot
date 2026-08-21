# First host — what you type

This is the beginner path for one VPS. It is not evidence that production is ready.

Do not paste the BotFather token, SSH password, or `.env` into chat.

## Before the script

1. Point a DNS **A** record at the VPS public IP. Wait until it resolves.
2. Keep the BotFather token and your numeric Telegram user id ready to type **on the server**.
3. Optional: a private Telegram group with Topics enabled, bot added as admin with Manage Topics.
4. On the VPS, install Git, Docker, and Docker Compose v2. Node/pnpm are optional; the script can build static apps with a Node image.

## What you type

```bash
git clone https://github.com/yasinmalek82/neo_bot.git
cd neo_bot
bash deploy/install.sh
```

The script asks for:

- public hostname (no `https://`)
- BotFather token (hidden)
- numeric admin IDs
- report group chat ID (empty skips forum topics)
- PasarGuard URL and API key (empty keeps placeholders; checkout provisioning will wait until you edit host `.env`)

It writes a gitignored `.env`, keeps `PILOT_ENABLED=false`, builds Mini App `dist/client` and catalog-admin at `/console/`, then starts `docker-compose.production.yml` (Postgres unpublished, API on loopback, Caddy on 80/443 with automatic HTTPS).

When HTTPS answers, restart once:

```bash
docker compose -f docker-compose.production.yml restart bot-api
```

Then in Telegram tap `/start`. Customer Mini App is `/`. Catalog console is `/console/` opened from the admin hub Mini App button (verified admin `initData`). Do not publish catalog from Telegram keyboards.

Confirm `GET /health` over HTTPS yourself (status only). Leave `PILOT_ENABLED=false` until an isolated PasarGuard group is configured.

See `docs/runbooks/production.md` for backup, webhook, and rollback detail.
