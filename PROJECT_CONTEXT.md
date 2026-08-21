<!--
context-schema: 1
last-updated: 2026-08-21T21:18:59.155Z
source-fingerprint: f342469c6bd7bd12512a30c6547075845f0d0b032fdb8767042595046a345266
current-phase: production-foundation-and-real-customer-journey
next-task: vps-install-waiting-terminal-ssh
-->

# neo_bot Project Context

This is the canonical, account-independent handoff for `neo_bot`. It records the current truth, the
approved product direction, the delivery roadmap and the next implementation task. It must travel
with the repository and must be updated after every material change.

`README.md` explains how to run the software. ADRs under `docs/adr/` record durable architectural
decisions. This file is the single source of truth for current status and sequencing.

## How every Codex session must start

1. Confirm that the exact repository is `/Users/yasin_mst/Documents/neo_bot`.
2. Read the root `AGENTS.md`, this complete file and any nearer `AGENTS.md` for files in scope.
3. Inspect `git status` and preserve every existing change. Do not assume an untracked repository is
   empty.
4. Run `pnpm context:check`. If it reports a stale fingerprint, inspect the existing changes and bring
   this file up to date before starting new implementation. Never blindly stamp unknown changes.
5. Query the existing Graphify graph before broad code exploration. Prefer `graphify query`,
   `graphify path` and `graphify explain`. If `graphify-out/wiki/index.md` exists, start there. Use
   budget `600` by default and `1200` maximum. After changing `.graphifyignore`, rebuild with
   `graphify extract . --force --code-only` then `graphify update . --force`.
6. Verify the relevant current behavior before editing. Do not treat this snapshot as proof that a
   live dependency is still healthy.
7. Continue from **Current priority and next task** unless the user explicitly changes priority.
8. Do not deploy, migrate live users, modify production PasarGuard data, commit or push without
   explicit authorization.

## User and communication context

- The owner is Persian-speaking. User-facing reports should be clear, RTL-friendly Persian, with
  paths, code and English identifiers visually isolated.
- Prefer concrete outcomes and non-technical explanations, while retaining evidence and exact
  validation boundaries.
- The legacy sales bot stays in service until `neo_bot` passes a controlled production pilot.
- Never ask the owner to paste API keys, bot tokens, subscription URLs or other secrets into chat.

## Product vision

Build a maintainable Telegram VPN sales platform connected to PasarGuard, with a simple customer
journey and an administrator-managed catalog. The owner must be able to add products and arbitrary
values on the supported volume, duration and simultaneous-connection axes without a frontend code
change.

Initial payment is manual card-to-card. The intended catalog includes, but is not limited to:

- unlimited services;
- economic multi-connection services using direct connections;
- special multi-location services using tunnel-backed PasarGuard groups.

The first trustworthy production release is a single-owner MVP. Reseller wallets, debt management,
legacy migration and automated payment are later releases and must not delay the first safe pilot.

## Non-negotiable decisions

- This is a clean-room project. Do not copy AGPL implementation code, dumps, secrets or generated
  configuration from the legacy bot.
- `packages/domain` must remain independent of NestJS, PostgreSQL, Telegram and PasarGuard.
- PasarGuard users are identified and renewed by numeric remote user ID, not username.
- Every remote mutation is idempotent or reconciled with read-after-write after ambiguous failure.
- PostgreSQL is the source of truth for the published storefront catalog.
- A sellable variant is an exact volume, duration, device-limit, price and provider-group combination.
- Product categories are customer navigation, not panel instances.
- Provider codes and PasarGuard group IDs must not appear in the public catalog.
- The current unrestricted page-builder/EAV approach is intentionally rejected. Entirely new selector
  dimensions still require a deliberate schema and UI change.
- Never log Telegram tokens, API keys, subscription URLs, raw bank messages, receipt references,
  database dumps or migration journals.
- No database transaction may stay open across Telegram or PasarGuard network calls.

Authoritative decisions are recorded in:

- `docs/adr/0001-clean-room-modular-monorepo.md`
- `docs/adr/0002-idempotent-provisioning.md`
- `docs/adr/0003-card-to-card-order-lifecycle.md`
- `docs/adr/0004-admin-managed-storefront-catalog.md`
- `docs/adr/0005-admin-reporting-event-backbone.md`
- `docs/adr/0006-bot-provisioned-reporting-forum-topics.md`
- `docs/adr/0007-telegram-update-intake.md`
- `docs/adr/0008-catalog-card-and-miniapp-identity.md`
- `docs/adr/0009-ops-health-backup-topic-recovery.md`
- `docs/adr/0010-redacted-runtime-logs.md`

Create a new ADR before materially changing one of these decisions.

## Current verified snapshot

Last evidence refresh: `2026-08-22`, local development environment only.

- Production-MVP readiness estimate: approximately `86-90%` of in-repo work; live Telegram, TLS host
  and seven-day pilot gates remain owner-side.
- Full envisioned product readiness estimate: approximately `45-50%`.
- `pnpm check` is the in-repo gate after this slice. Unit tests: `8` domain, `25` application, `4`
  PasarGuard, `65` bot API.
- Local `GET /health` on loopback is `ok` with Telegram `polling`, `telegramReady` `true`,
  `telegramError` `none`, `migrations` `6`, and zero pending or failed report deliveries. Webhook
  mode records `telegramReady` false on allowlisted errors and probes `getWebhookInfo` in the
  background. Public `GET /catalog` omits card numbers. Mini App checkout uses verified `initData`
  and `CommerceUseCase`. Receipt photos (and image documents) remain in the private bot chat.
- `pnpm db:restore-drill` restored a fresh dump onto a disposable Postgres on loopback
  (`schema_migrations=6`), then destroyed the instance and dump. The live local database was not
  overwritten. Restore onto a chosen target still requires `RESTORE_CONFIRM=yes`.
- CI `pnpm audit --audit-level=high` is required. One moderate `uuid` advisory remains in
  Testcontainers only.
- Live test forum: eight purpose topics exist. The local outbox delivered first-contact, returning
  activity, one `order.created`, and one `ops.daily_summary` (four deliveries, none failed). One
  sales order is `awaiting_receipt` with zero payment proofs. Receipt, approval and provisioning
  notices are still unconfirmed. Owner visual check of the daily-summaries topic is still required.
- Authorized Git baseline exists: `6c9bbe4` on `main`, remote `https://github.com/yasinmalek82/neo_bot`.
  `.env` was not committed. Shop, admin-hub, and first-host install changes are in this work unit.
- No live-user migration, production deployment, public HTTPS webhook or live forum-group delivery of
  the new Mini App/renewal/daily-summary paths has been validated. `deploy/install.sh` is in-repo only
  until the owner opens a terminal with VPS access.

Passing local checks proves the local code boundary only. It does not prove a real Telegram purchase,
off-host backup restoration or public security.

## Architecture map

### Applications

- `apps/bot-api`: NestJS + Fastify API, health/catalog endpoints, Telegram webhook and pilot CLI.
- `apps/admin-web`: customer Mini App visual/runtime project. The name is historical; it is not the
  catalog administration console.
- `apps/catalog-admin`: separate browser console for editing and atomically publishing the catalog.

### Packages

- `packages/domain`: framework-free product, provider, service, order and storefront rules.
- `packages/application`: use cases and infrastructure ports.
- `packages/database`: PostgreSQL repositories, migrations, seeds and integration tests.
- `packages/pasarguard`: validated PasarGuard HTTP adapter and response mapping.

### Database migrations

- `0001_foundation.sql`: providers, groups, variants, services and idempotent operations.
- `0002_commerce.sql`: Telegram customers, orders, payment proofs and Telegram update deduplication.
- `0003_admin_managed_catalog.sql`: administrator-managed storefront catalog.
- `0004_storefront_payment_settings.sql`: published card-to-card details on the storefront.
- `0005_admin_reporting.sql`: reporting events, outbox deliveries and forum destination/topic maps.
- `0006_ops_daily_summary.sql`: `ops.daily_summary` event type for the daily_summaries topic.

### Runtime boundaries

- `docker-compose.yml` provisions local PostgreSQL by default. Profile `app` builds `bot-api` from
  `Dockerfile` without embedding secrets. `docker-compose.production.yml` is the host shape (Postgres
  unpublished, API on loopback, `bot-api` `DATABASE_URL` injected with host `postgres` so a loopback
  `.env` value cannot strand the container, Caddy on 80/443 for Mini App `/` and catalog-admin
  `/console/`, TLS via `deploy/Caddyfile.example`); it is not deployed until `deploy/install.sh`
  runs on a host.
- In-repo CI is `.github/workflows/check.yml` (`pnpm check` and required high-severity `pnpm audit`).
  `pnpm db:backup`, `pnpm db:restore`, and `pnpm db:restore-drill` cover dump/restore. Compose-network
  URLs dump via `docker compose exec` (production file when the host is `postgres`). Dumps are
  gitignored. Secret rotation steps are in `docs/runbooks/secret-rotation.md`. `deploy/install.sh`
  plus compose Caddy are the in-repo first-host path; no production TLS certificate is installed
  until the owner runs that script on a VPS.
- `SECURITY.md` records the current threat model. `.env.example` contains placeholders only. Real
  `.env` values are local secrets and must never be committed or printed.
- Agent session skills, a Graphify explore subagent, and start/stop hooks live under `.cursor/`.

## Capability status

| Capability                           | Status      | Verified boundary or gap                                                                                            |
| ------------------------------------ | ----------- | ------------------------------------------------------------------------------------------------------------------- |
| Modular pnpm/TypeScript foundation   | Implemented | Strict builds and architecture gate pass locally.                                                                   |
| PostgreSQL schema and migrations     | Implemented | Fresh Testcontainers lifecycle passes.                                                                              |
| PasarGuard health and group sync     | Implemented | Valid/invalid connectivity and group snapshots covered.                                                             |
| Direct service create/read/renew     | Implemented | Numeric IDs, idempotency and read-after-write covered.                                                              |
| Durable card-to-card order lifecycle | Implemented | Checkout, proof, approval/rejection, retry provisioning and catalog card source.                                    |
| Telegram chat purchase flow          | Partial     | Category HTML, nested back, empty-shop owner hint; one live order still awaiting a receipt photo.                   |
| Receipt review                       | Partial     | Admin private-chat review; image documents accepted; receipts topic gets a redacted text summary.                   |
| Admin reporting group and topics     | Partial     | Local outbox delivered first-contact, activity, order.created, and one daily summary; receipt/approval unconfirmed. |
| New-user `/start` reporting          | Partial     | First-contact and same-day activity notices were delivered to the new-users topic.                                  |
| Renewal customer journey             | Partial     | Failed renewals complete the Telegram update and keep the previous service; live PasarGuard renew unconfirmed.      |
| Data-driven catalog                  | Implemented | Products and supported selector values are database-driven and atomically published.                                |
| Catalog administration console       | Partial     | Dev bearer locally; production `/console/` same-origin API with admin `initData`; no Telegram catalog editor.       |
| Customer Mini App catalog UX         | Implemented | Loading/error/empty states and data-driven selection were browser-checked.                                          |
| Customer Mini App checkout           | Partial     | Same-origin Caddy Mini App + `/console/`; private-chat checkout copy; live receipt photo still outstanding.         |
| Telegram Mini App authentication     | Implemented | HMAC `initData` verification, expiry, and numeric `user.id` covered by unit tests.                                  |
| Production deployment and operations | Partial     | `deploy/install.sh` + compose Caddy TLS in-repo; no live host until owner SSH in a terminal.                        |
| Resellers, wallet and debt           | Not started | Explicitly deferred until after the first trustworthy release.                                                      |
| Legacy import and cutover            | Not started | Must begin read-only with backup, preflight, rollback and controlled cutover.                                       |

## Confirmed admin reporting requirement

The production product must support a private Telegram forum group used as an operator control and
reporting center. The owner values this as a production requirement, not optional polish.

Required event families include:

- first user `/start` and returning-user activity;
- checkout/order creation;
- payment receipt submission, approval and rejection;
- successful provisioning and delivery;
- renewal request and renewal result;
- reseller activity when the reseller module exists;
- PasarGuard, Telegram and reconciliation failures;
- daily sales and operational summaries.

Reports should route to purpose topics such as new users, orders, receipts, successful sales,
renewals, resellers, system errors and daily summaries. The owner selects the group and enables
Topics; the bot creates missing purpose topics, stores stable mappings, and sets related allowed
custom-emoji icons. It must not hard-code business reporting throughout the Telegram bot.

Security requirements:

- never post subscription URLs, API keys or tokens to the reporting group;
- minimize personal data and define retention for bank receipt images;
- authorize management actions by numeric administrator ID even inside the private group;
- deduplicate report delivery and persist delivery state so a restart does not silently lose events;
- retry transient Telegram failures without duplicating business actions;
- detect deleted/invalid topics and surface an actionable operator error.

## Production roadmap

### Phase 0 - Foundation and provider adapter

Status: complete for the current local scope.

Gate achieved: modular architecture, migrations, local health, PasarGuard adapter, isolated create,
read and renew, idempotency and automated tests.

### Phase 1 - Durable commerce and data-driven catalog

Status: mostly complete locally.

Remaining gate items:

- validate the Telegram flow on an isolated deployed webhook.

### Phase 2 - Admin reporting event backbone

Status: first-contact, returning-activity, order.created and one `ops.daily_summary` were delivered
on the live test forum outbox (counts only; no identifiers). Receipt, approval and provisioning
notices remain outstanding. Administrators can read pending/failed report counts and intake ready
state from Telegram status, and can enqueue today’s daily summary from the reports menu without
duplicating the occurrence key.

Gate remaining:

- confirm redacted receipt, approval and failure notices on the created topics;
- owner visual confirmation of the `daily_summaries` topic text.

### Phase 3 - Real Mini App transaction

Status: `initData` verification, customer order API, Persian status/error copy, checkout retry and
idempotent Mini App keys are in-repo. A Mini App order also sends the same checkout copy to the
customer private bot chat so the receipt photo can be submitted there. Caddy can serve
`admin-web` `dist/client` on the same public host as the API. File upload is intentionally
deferred. Catalog-without-card now fails before creating an order.

Gate remaining:

- live Mini App order from Telegram; receipt photo in the bot; shared order status;
- later: bounded receipt upload if the owner authorizes object storage.

### Phase 4 - Production security and operations

Status: in-repo hardening landed (health Telegram intake mode plus ready/error, report-queue and
migration counts, graceful pool shutdown, webhook rate-limit exclusion, compose restart/healthcheck,
optional Mini App menu URL, dump/restore plus a disposable restore drill, production compose overlay
that injects `bot-api` `DATABASE_URL` with host `postgres`, compose-aware dump/restore, webhook
`getWebhookInfo` intake honesty, Caddy Mini App plus `/console/` catalog-admin, first-host
`deploy/install.sh`, runbook, secret-rotation checklist, redacted stdout and HTTP error codes).
Production host, TLS certificates, off-host backup storage and a live secret rotation are not done
until the owner provides VPS access in a terminal.

Gate remaining:

- HTTPS webhook on a reachable host, off-host dump storage, and TLS certificates. High-severity
  dependency audit is required in CI. The authorized Git baseline is done. In-repo secret-rotation
  steps exist; they are not a completed live rotation. `bash deploy/install.sh` waits for owner SSH.

### Phase 5 - Controlled pilot and release

Status: not started.

Gate:

- full deployed path succeeds: Telegram/Mini App identity -> checkout -> receipt -> admin decision ->
  PasarGuard provisioning -> customer delivery -> renewal;
- retries never create duplicate orders or provider users;
- rollback and recovery procedures are exercised;
- a small invited cohort runs for at least seven days without lost orders, duplicate services or
  unresolved critical alerts.

### Phase 6 - Later product scope

Status: intentionally deferred.

- reseller roles, wallets, debt and reporting;
- automated payment or bank-message integrations;
- legacy read-only import tooling, migration rehearsal and controlled cutover;
- richer customer service management and support workflows;
- entirely new catalog selector dimensions when justified by a real product need.

## Current priority and next task

Current phase: **Phase 4 - Production security and operations** (in-repo install ready; live host
blocked on owner SSH). Phase 2 live receipt confirmation is still outstanding.

Next implementation slice: owner opens a terminal with temporary VPS access (not chat) so
`bash deploy/install.sh` can run. Until then, local `getUpdates` still lets the owner send a
receipt photo in the private bot chat. In-repo shop HTML, admin failed-provisioning/catalog-health,
and first-host TLS/Mini App/`/console/` wiring are closed. One live order is waiting for a receipt
photo. Restart `bot-api` to pin the new shop and admin-hub keyboards.

Expected sequence:

1. Owner: DNS A record, then a terminal with SSH (not this chat).
2. On the host: `bash deploy/install.sh`, confirm HTTPS `/health` (status only), restart `bot-api`.
3. Send a card-to-card receipt image to the bot (do not paste file IDs or secrets in chat).
4. Confirm the receipts topic gets a redacted text summary, then approve or reject from the admin
   private-chat buttons.

Owner-only remaining gates: public HTTPS webhook URL, live isolated PasarGuard group, TLS host,
off-host backup storage, seven-day pilot.

Do not request group tokens or secrets in chat.

## Production definition of done

Do not call this project production-ready until all of the following are evidenced:

- real Telegram identity validation for customer and administrator surfaces;
- one real, recoverable purchase and renewal journey on an isolated provider group;
- idempotent orders, proofs, reports, provisioning and renewals under repeated updates;
- no secret or subscription URL exposure in logs, APIs or reporting topics;
- deployed HTTPS services with health checks, restart policy and controlled migrations;
- monitoring, actionable alerts, backup and a successful restore drill;
- full tests and security gates in CI;
- authorized Git baseline and versioned release;
- controlled pilot completed with documented rollback and no unresolved critical defect.

## Update protocol

Every material change to source, schema, configuration, architecture, product behavior, tests,
deployment or security must update this file in the same work unit.

The implementing Codex session must:

1. Update the relevant capability row from `Not started` to `Partial` or `Implemented` only when the
   stated evidence exists.
2. Update the current phase, remaining gate items and **Current priority and next task**.
3. Refresh **Current verified snapshot** with exact commands/results and a truthful validation
   boundary. Never describe unrun checks as passing.
4. Record new durable decisions in an ADR and link them here.
5. Add one concise entry to **Handoff log** describing outcome, validation and next action. Do not paste
   secrets, terminal dumps, source snippets or reasoning transcripts.
6. Run `pnpm context:stamp` after the content is accurate. This refreshes the timestamp and source
   fingerprint.
7. Run `pnpm check`. The context gate must pass with the rest of the project gates.

If `pnpm context:check` fails at the start of a session, assume there are undocumented existing
changes. Inspect them before editing this file. `pnpm context:stamp` is not a substitute for reviewing
and documenting the changes.

Read-only investigation or a status report that does not change project files does not require a new
handoff entry.

## Handoff log

Keep entries concise and newest first. This is an operational summary, not a transcript.

### 2026-08-22 - First-host install script, Caddy TLS, Mini App, `/console/`

- Outcome: `deploy/install.sh` asks for hostname and bot secrets on stdin, writes gitignored `.env`,
  keeps `PILOT_ENABLED=false`, builds Mini App `dist/client` and catalog-admin with Vite base
  `/console/`, and starts production compose including Caddy automatic HTTPS. Catalog-admin uses
  same-origin `/admin/catalog` off loopback. ADR 0008 amended. No public hostname was invented. No
  SSH and no live TLS host in this session.
- Validation: installer syntax-checked. `pnpm check` is the in-repo gate. VPS install waits for
  owner terminal SSH.
- Next: owner DNS A record, then SSH in a terminal (not chat).

### 2026-08-22 - Admin hub failed provisioning and catalog health

- Outcome: numeric-admin hub lists failed provisioning for retry, separate from the receipt queue.
  Catalog health shows published root-category count and whether the card is published, with no
  card digits. Catalog editing stays in catalog-admin.
- Validation: application tests `25`, bot-api tests `65`.
- Next: first-host install on the VPS after owner SSH.

### 2026-08-22 - Telegram shop category detail and nested back

- Outcome: category screens show escaped published description and parent name. Back goes to the
  parent category, not always shop root. Empty shop tells the owner to publish from the catalog
  console; customers see a later-return line.
- Validation: bot-api tests cover HTML description, nested `cat:` back, and admin vs customer empty
  copy. Original Persian. No AGPL copy.
- Next: admin hub failed-provisioning and catalog health (landed in the same work unit).

### 2026-08-22 - Customer-first chat menu and journey copy

- Outcome: `/start` is a store home (buy, order, renew, help). Operator status, reports and the
  review queue live inside the admin hub, not on the customer keyboard. Welcome, shop, checkout,
  receipt and help copy name the next tap. Old button labels still match. No Mini App button,
  wallet, or colored ReplyKeyboard (Telegram cannot color those keys).
- Validation: bot-api tests `60`. Owner must restart `bot-api` to refresh the persistent keyboard.
  No receipt photo, public webhook, or TLS host.
- Next: owner sends a receipt photo in the private bot chat to confirm receipts and sales/errors
  topics.

### 2026-08-21 - Caddy same-origin Mini App example

- Outcome: `deploy/Caddyfile.example` reverse-proxies API paths and serves `admin-web` `dist/client`.
  Catalog-admin is not mounted on `/admin` (that path is the catalog API). Mini App is not copied
  into the `bot-api` image. ADR 0008 amended. No public hostname was invented.
- Validation: inspection of `admin-web` Vite `dist/client` vs Sites worker `build`. No TLS host.
- Next: owner sends a receipt photo; later set `TELEGRAM_MINI_APP_URL` to the real `https` origin.

### 2026-08-21 - Honest webhook telegramReady and getWebhookInfo

- Outcome: quiet webhook stays ready; allowlisted webhook errors set `telegramReady` false. HTTP
  `/health` stays `200` when the database is up. A background `getWebhookInfo` maps unset URL and
  newer delivery errors to allowlisted codes. ADR 0009 amended. Unauthorized POSTs still do not
  mark intake down.
- Validation: bot-api tests `60`. No public webhook.
- Next: owner sends a receipt photo in the private bot chat to confirm receipts and sales/errors
  topics.

### 2026-08-21 - Production compose injects DATABASE_URL; dump uses compose exec

- Outcome: `docker-compose.production.yml` overrides `bot-api` `DATABASE_URL` to host `postgres`.
  `pnpm db:backup` / `pnpm db:restore` use `docker compose exec` for compose-network URLs and
  `-f docker-compose.production.yml` when the host is `postgres`. ADR 0009 amended. No live restore,
  off-host copy, or deploy.
- Validation: scripts syntax-checked. No receipt photo, public webhook, or TLS host.
- Next: owner sends a receipt photo in the private bot chat to confirm receipts and sales/errors
  topics. In-repo next: honest webhook `telegramReady`.

### 2026-08-21 - Mini App checkout also notifies the private bot chat

- Outcome: creating an order from the Mini App sends the card-to-card checkout copy to the customer
  private chat so the receipt photo can be sent there. HTTP checkout still succeeds if that notice
  fails. One live order remains `awaiting_receipt` with zero proofs.
- Validation: bot-api tests `57`. No receipt photo, public webhook, or TLS host.
- Next: owner sends a receipt photo in the private bot chat to confirm receipts and sales/errors
  topics.

### 2026-08-21 - Redacted runtime logs and HTTP error codes

- Outcome: `bot-api` logs through `SafeLogger` and returns allowlisted HTTP error codes. PasarGuard
  failures no longer attach provider JSON as `Error.cause`. One live order is `awaiting_receipt`
  with zero proofs.
- Validation: bot-api tests `56`. No receipt photo, public webhook, or TLS host.
- Next: owner sends a receipt photo in the private bot chat to confirm receipts and sales/errors
  topics.

### 2026-08-21 - Admin status shows report queue; daily summary is operator-triggered

- Outcome: Telegram admin status shows intake ready/error and pending/failed report counts without
  identifiers. Reports menu can enqueue today’s `ops.daily_summary` (idempotent). Local live outbox
  already delivered four events including one daily summary.
- Validation: application tests `23`, bot-api tests `54`. Aggregate DB counts only. No receipt
  photo yet. Owner visual check of the daily-summaries topic still required.
- Next: owner sends a receipt photo in the private bot chat to confirm receipts and sales/errors
  topics.

### 2026-08-21 - Intake health ready flag and secret-rotation runbook

- Outcome: `GET /health` now reports `telegramReady` and an allowlisted `telegramError` so a stuck
  `getUpdates` session is visible without leaking Telegram descriptions. HTTP stays `200` when the
  database is up. `docs/runbooks/secret-rotation.md` is the in-repo rotation checklist.
- Validation: bot-api tests `52`. No live secret rotation, public webhook, or TLS host.
- Next: owner sends a receipt photo in the private bot chat to confirm receipts and sales/errors
  topics.

### 2026-08-21 - Renewal failure completes the Telegram update

- Outcome: if customer renewal against the provider fails, the chat shows a delay message, the
  previous service stays in place, and the Telegram update is completed so the renew button is not
  retried in a loop. `NO_ACTIVE_SERVICE` has its own copy.
- Validation: bot-api tests `48`. No deploy, public webhook, or live PasarGuard renew.
- Next: owner sends a receipt photo in the private bot chat to confirm receipts and sales/errors
  topics.

### 2026-08-21 - Approval completes after provisioning miss

- Outcome: if PasarGuard create fails after receipt approval, the customer gets the delay notice,
  the admin is told to retry from the queue, and the Telegram update is completed so the button is
  not retried in a loop. Competing `getUpdates` sessions map to `TELEGRAM_POLLING_CONFLICT`. Live
  loopback health is `ok` with polling intake.
- Validation: bot-api tests `47`. `GET /health` reports polling, six migrations, and empty report
  queues. No deploy or public webhook.
- Next: owner sends a receipt photo in the private bot chat to confirm receipts and sales/errors
  topics.

### 2026-08-21 - Receipt conflict copy and unmapped topic retry

- Outcome: a second receipt while an order is under review tells the customer the order is already
  being reviewed instead of claiming there is no open order. Unmapped report purposes now create the
  missing topic and retry the same notice when a provisioner is present. Permanent delivery failures
  record one redacted `system.failure` per purpose and error code per UTC day. Fastify request
  logging stays off so webhook bodies are not written to logs.
- Validation: application tests `23`, bot-api tests `45`. No deploy, public webhook, or live receipt
  confirmation.
- Next: owner sends a receipt photo in the private bot chat to confirm receipts and sales/errors
  topics.

### 2026-08-21 - Disposable restore drill and production host runbook

- Outcome: `pnpm db:restore-drill` restores a fresh dump onto loopback Postgres, checks
  `schema_migrations`, then destroys the instance and dump. Health reports a migration count.
  `docker-compose.production.yml`, `deploy/Caddyfile.example`, and `docs/runbooks/production.md`
  document the first host. CI high-severity audit is required. No deploy or public webhook.
- Validation: restore drill printed `schema_migrations=6`. `pnpm audit --audit-level=high` passed.
  One moderate `uuid` advisory remains in Testcontainers.
- Next: owner sends a receipt photo in the private bot chat to confirm receipts and sales/errors
  topics.

### 2026-08-21 - Ops health, backup scripts, stale topic recovery

- Outcome: missing/closed forum topics clear their binding, recreate the purpose topic, retry the
  same notice, and record a redacted `system.failure`. `GET /health` adds pending/failed report
  counts. `pnpm db:backup` / `pnpm db:restore` landed; restore requires `RESTORE_CONFIRM=yes`.
  ADR 0009. No deploy, public webhook, or `PILOT_ENABLED`.
- Validation: application tests `21`, bot-api tests `44`. Local compose dump wrote a non-empty custom
  file then was discarded. Restore guard refused without confirmation.
- Next: owner sends a receipt photo in the private bot chat to confirm receipts and sales/errors
  topics.

### 2026-08-21 - Authorized Git baseline pushed

- Outcome: first commit `6c9bbe4` on `main` pushed to `https://github.com/yasinmalek82/neo_bot`.
  `.env` stayed untracked. No force-push.
- Validation: `pnpm check` passed before the baseline commit. Push created a new private remote.
- Next: owner sends a receipt photo in the private bot chat to confirm receipts and sales/errors
  topics.

### 2026-08-21 - In-repo production-MVP hardening

- Outcome: receipt path accepts photos and image documents, records activity, validates published
  card details before creating an order, and notifies the customer if provisioning fails. Mini App
  checkout has Persian status, mapped errors, retry, per-attempt idempotency, and does not continue
  without a successful order. Catalog-admin production copy uses initData; empty provider groups are
  visible. Health reports Telegram intake; the pool closes on shutdown; webhook traffic is not
  IP-rate-limited; compose/Dockerfile gained restart and health checks. Optional `TELEGRAM_MINI_APP_URL`
  sets the chat menu button. ADR 0007 now completes malformed updates. Git baseline not written yet.
- Validation: bot-api tests `43`, application tests `20`. `pnpm check` and Graphify refresh close
  this slice. No deploy, public webhook, or `PILOT_ENABLED`.
- Next: authorized Git baseline, then owner sends a receipt photo to confirm receipts and sales/errors
  topics.

### 2026-08-21 - Live bot-api restart

- Outcome: `bot-api` is running locally with Telegram `getUpdates` polling. Nested migrate race
  on startup was fixed by migrating once from the database pool factory. Public catalog omits
  cards; unauthenticated Mini App order posts return `INIT_DATA_REQUIRED`.
- Validation: `GET /health` ok; `GET /catalog` has no card fields; customer order POST without
  initData is 401. Live Telegram visual check still needs `/start` in the private chat.
- Next: owner opens the bot, taps `/start`, then sends a receipt photo.

### 2026-08-21 - In-repo MVP phases 1-4

- Outcome: published catalog is the only card source; public catalog omits cards; admins can retry
  failed provisioning; Mini App `initData` HMAC plus customer order API; Mini App checkout polls
  status and keeps receipts in the bot chat; customer renewal and `ops.daily_summary` outbox;
  catalog-admin production uses Telegram admin identity; SECURITY.md, rate/body limits, Dockerfile,
  compose profile `app`, and CI workflow landed. ADR 0008 records card source and Mini App identity.
- Validation: application tests `20`, bot-api tests `40`. `pnpm check` and Graphify refresh close
  this slice. No commit, push, deploy, or public webhook.
- Next: owner sends a receipt photo in the private bot chat to confirm receipts and sales/errors
  topics.

### 2026-08-21 - Production-style mixed Telegram menus

- Outcome: customer and administrator private chats now use the mixed full-width / paired-row
  layout. The same labels sit on the message as inline buttons and as a persistent bottom keyboard.
  Administrators get system status, report routing, a review queue, and an admin hub. Legacy channel
  / web-panel / optimization items were not copied.
- Validation: bot-api tests `33` and application tests `16`, including admin queue and mixed-row
  layout. Live Telegram visual check still needs a process restart. Public webhook, Mini App auth,
  and production ops remain open.
- Next: owner sends a receipt photo in the bot chat, then confirm receipts and sales/errors topics.

### 2026-08-21 - Inline-keyboard customer menu

- Outcome: private-chat UX is button-first. `/start` opens a home menu (shop, order status, help).
  Catalog navigation edits the same message. Card-to-card details stay copyable in the payment card.
  Typed `/buy` is no longer required.
- Validation: bot-api unit tests `31` for home keyboard, shop callback edit, HTML send/edit, and
  command menu registration. Live visual check on Telegram is still needed after restart.
- Next: owner sends a receipt photo in the bot chat, then confirm receipts and sales/errors topics.

### 2026-08-21 - Local Telegram intake and live start/order notices

- Outcome: ADR 0007. Unset `TELEGRAM_WEBHOOK_URL` uses `deleteWebhook` plus short `getUpdates`
  polling through the same `handleUpdate` path. HTTPS webhook URL remains the production intake.
  Redacted first-contact, returning-activity and order-created notices were delivered on the test
  forum.
- Validation: bot-api unit tests `28`. Health `ok`. Deliveries for those three event types are
  `delivered`. Receipt/approval/provisioning notices were not confirmed.
- Next: owner sends a receipt photo in the bot chat, then confirm receipts and sales/errors topics.

### 2026-08-21 - Agent skills, rules, and hooks

- Outcome: installed lean project/user skills, an efficiency rule, a Graphify explore subagent, and
  hooks that inject the next task on session start and remind if the context fingerprint is stale.
  Destructive git force/reset now asks before running. Product next-task is unchanged.
- Validation: hook scripts parse JSON; personal Cursor rule added. `pnpm check` after stamp.
- Next: live-forum-notice-delivery — receive a real `/start` and confirm redacted topic notices.

### 2026-08-21 - Related custom-emoji icons for forum topics

- Outcome: Telegram only allows forum-topic icons from `getForumTopicIconStickers`. Each purpose now
  maps to related allowed emojis and a color. New topics get the icon on create; existing stored
  topics get `editForumTopic` on startup. Titles stay Persian. ADR 0006 still forbids rename, close
  and delete.
- Validation: application and bot-api unit tests for matching stickers, create-with-icon, and
  edit-existing. Product next-task is still live notice delivery.
- Next: restart or rebuild so the running API applies icons, then confirm redacted notices on topics.

### 2026-08-21 - Local Postgres, API, and live forum topics

- Outcome: started Docker Postgres, ran migrations, and started `bot-api`. Startup created all eight
  purpose topics on the configured test forum and stored the thread IDs. Health check passed.
- Validation: `GET /health` returned `ok`. `pnpm test:integration` passed `4` tests after the
  reporting case stopped using a dispatch clock earlier than SQL `now()`. No public webhook, so live
  journey notices were not confirmed.
- Next: deliver a `/start` and checkout through a reachable webhook and confirm redacted topic
  messages.

### 2026-08-21 - Bot-provisioned reporting forum topics

- Outcome: ADR 0006. The owner supplies only the forum group chat ID. On startup the bot verifies
  Topics are enabled, creates missing purpose topics, and persists thread IDs. It still does not
  rename or delete topics. Optional env thread IDs remain overrides.
- Validation: unit tests for create-once, reuse, forum-disabled, and Telegram `createForumTopic` /
  `getChat` parsing. Live Telegram and Testcontainers were not run.
- Next: isolated test group with Topics and Manage Topics for the bot, then live delivery checks.

### 2026-08-21 - Idle reporting outbox dispatcher

- Outcome: when the Telegram bot is enabled, an overlap-safe in-process timer flushes due report
  deliveries even if the webhook is idle. Interval `0` keeps webhook-only flushing. No extra Telegram
  send path was added.
- Validation: bot-api unit tests `20` passed, including overlap, failure-continue and stop cases.
  Docker/Testcontainers and live forum delivery were not available.
- Next: owner-authorized isolated test forum mapping, then Docker-backed integration and live topic
  checks.

### 2026-08-21 - Graphify corpus focused on product structure

- Outcome: redesigned `.graphifyignore` per Graphify docs so tsconfig/package.json hubs, Mini App
  device runtime and static assets no longer dominate the graph. God nodes are now repositories,
  `CommerceUseCase`, `TelegramCommerceBot` and `PasarGuardClient`. Wiki export added for agent
  navigation. Product next-task is unchanged.
- Validation: full code-only extract then update rebuilt `681` nodes and `1111` edges with `41`
  communities; diagnose showed no duplicate/dangling edges.
- Next: owner-authorized isolated test forum mapping, then Docker-backed integration and live topic
  checks.

### 2026-08-21 - Durable admin reporting outbox and forum topic routing

- Outcome: added ADR 0005, application reporting events, PostgreSQL outbox/delivery, owner-mapped
  forum topics, first-contact persistence on `/start`, and redacted reports for checkout, receipt,
  approval, rejection and provisioning. The bot does not create Telegram topics.
- Validation: `pnpm check` passed with unit tests `39`. Graphify rebuilt `1204` nodes and `1726`
  edges. Testcontainers and live forum delivery were not run in this session.
- Next: owner-authorized isolated test forum mapping, then Docker-backed integration and live topic
  checks.

### 2026-08-21 - Account-independent continuity established

- Outcome: added this canonical state/roadmap handoff and an automated source fingerprint gate.
- Validation: `pnpm check`, `pnpm test:integration` and `pnpm deadcode` passed; a controlled source
  edit was correctly rejected as stale; Graphify rebuilt `1106` nodes and `1540` edges with no
  dangling or duplicate edges and one known self-loop.
- Next: ADR and implementation plan for durable admin reporting and Telegram forum topic routing.

### 2026-08-21 - Admin-managed catalog and customer selector flexibility

- Outcome: catalog values, supported volume/duration/device combinations, prices, copy and card
  presentation became database-backed and editable from the separate catalog console.
- Validation: atomic publication, browser flow, public response redaction and a new 75 GB option were
  checked locally.
- Next at that point: replace simulated Mini App checkout and temporary admin authentication.

### 2026-08-20 - Foundation and first vertical slices

- Outcome: established the clean-room monorepo, PostgreSQL lifecycle, PasarGuard adapter, idempotent
  service operations and durable Telegram card-to-card commerce state machine.
- Validation: unit and Testcontainers integration tests passed locally; isolated PasarGuard pilot was
  used without migrating production users.
- Next at that point: customer/admin interfaces and production-facing integrations.
