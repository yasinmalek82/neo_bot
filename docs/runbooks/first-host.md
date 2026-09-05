# First host — what you type

This is the beginner path for one VPS. It is not evidence that production is ready.

Do not paste the BotFather token, SSH password, `.env`, webhook secret, or subscription URLs into
chat or GitHub issues.

## Before the script

1. Point a DNS **A** record at the VPS public IP. Wait until it resolves. Do not invent a name and
   do not use a raw IP; Let’s Encrypt needs a DNS hostname.
2. Keep the BotFather token and your numeric Telegram user id ready to type **on the server**.
3. Optional: a private Telegram group with Topics enabled, bot added as admin with Manage Topics.
4. Ubuntu 22.04/24.04-style VPS with Git, curl, Docker, and Docker Compose v2. Node/pnpm are
   optional; static apps can build in a Node image. Package installation needs root; use root or sudo. The menu can install host packages on
   Ubuntu/Debian if you type `yes`.

## One-line install

The supported one-liner is:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/yasinmalek82/neo_bot/main/deploy/neo-install.sh)
```

From an existing checkout:

```bash
git clone https://github.com/yasinmalek82/neo_bot.git
cd neo_bot
bash deploy/neo-install.sh
```

`deploy/neo-install.sh` clones the repo when needed (default `/opt/neo_bot` as root, otherwise
`$HOME/neo_bot`, override with `NEO_BOT_DIR`) and opens the persistent menu. Re-running the one-liner reuses the checkout and opens the menu; menu option 2 fetches updates, rebuilds, and restarts. Re-open it later with
`bash deploy/neo`, `bash deploy/menu.sh`, or `neo` if `/usr/local/bin/neo` was linked.

`bash deploy/install.sh` still performs first setup only.

## Menu

1. Install / first setup (re-run = keep checkout, open menu)
2. Update from git (fetch + fast-forward, rebuild, restart; asks for `yes`)
3. Change settings (token, admins, hostname, PasarGuard, env-backed commercial flags)
4. Start / stop / restart / status / logs
5. Backup database (`tools/postgres-backup.sh`)
6. Health check (loopback and public `/health`)
0. Exit

The install option asks for:

- public hostname (no `https://`)
- BotFather token (hidden)
- numeric admin IDs
- report group chat ID (empty skips forum topics)
- PasarGuard URL and API key (empty keeps placeholders; checkout provisioning waits until you
  edit host `.env` from the settings menu)
- optional public bot username

It writes a gitignored `.env`, keeps `PILOT_ENABLED=false` and `PROVISIONING_MODE=disabled`, leaves `TELEGRAM_WEBHOOK_URL` empty until loopback and public HTTPS health pass, then enables it and restarts `bot-api`, and builds
customer static assets, then starts `docker-compose.production.yml` (Postgres unpublished, API on
loopback, Caddy on 80/443 with automatic HTTPS). A second run detects `.env` and offers keep versus
reconfigure. Reconfigure keeps the existing database password and webhook secret.

The installer enables the webhook only after loopback and public HTTPS health pass; use menu option 4 to restart `bot-api` manually after later hostname changes.

Then in Telegram tap `/start`. The customer store is the chat. Use «مدیریت فروشگاه» only from the
private administrator chat to publish catalog changes.

Confirm `GET /health` over HTTPS yourself (status only; integer `reports.pending`, `reports.failed`,
`reports.retrying`, and `reports.due` counts with no identifiers). Leave `PILOT_ENABLED=false` until
an isolated PasarGuard group is configured. Settings that enable `live` provisioning or
`PILOT_ENABLED=true` ask for an extra `yes`.

See `docs/runbooks/production.md` for backup, webhook, and rollback detail.
