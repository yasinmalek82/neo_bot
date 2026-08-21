<!--
context-schema: 1
last-updated: 2026-08-21T18:52:39.235Z
source-fingerprint: 2e00c6cdb7c806c9a1e0657877d4526d0916a02805f0af82428ddb37777330ed
current-phase: production-foundation-and-real-customer-journey
next-task: live-receipt-forum-notices
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

Create a new ADR before materially changing one of these decisions.

## Current verified snapshot

Last evidence refresh: `2026-08-21`, local development environment only.

- Production-MVP readiness estimate: approximately `78-83%` of in-repo work; live Telegram and
  operations gates remain owner-side.
- Full envisioned product readiness estimate: approximately `45-50%`.
- `pnpm check` is the in-repo gate after this slice. Unit tests: `8` domain, `20` application, `4`
  PasarGuard, `43` bot API.
- Local Postgres is running. Public `GET /catalog` omits card numbers. Mini App checkout uses
  verified `initData` and `CommerceUseCase`. Receipt photos (and image documents) remain in the
  private bot chat. Health reports Telegram intake as `disabled`, `polling`, or `webhook`.
- Live test forum: eight purpose topics exist. Receipt, approval and provisioning notices are not
  confirmed yet. Daily-summary outbox events are implemented in code and not live-confirmed.
- The Git repository has no first commit yet; an authorized baseline is the next release action in
  this session. Creating that commit still happens only with owner authorization (now granted).
- No live-user migration, production deployment, public HTTPS webhook or live forum-group delivery of
  the new Mini App/renewal/daily-summary paths has been validated.

Passing local checks proves the local code boundary only. It does not prove a real Telegram purchase,
production recovery, backup restoration or public security.

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
  `Dockerfile` without embedding secrets.
- In-repo CI is `.github/workflows/check.yml` (`pnpm check`, optional `pnpm audit`). No production
  reverse proxy, TLS, or release pipeline is deployed.
- `SECURITY.md` records the current threat model. `.env.example` contains placeholders only. Real
  `.env` values are local secrets and must never be committed or printed.
- Agent session skills, a Graphify explore subagent, and start/stop hooks live under `.cursor/`.

## Capability status

| Capability                           | Status      | Verified boundary or gap                                                                                         |
| ------------------------------------ | ----------- | ---------------------------------------------------------------------------------------------------------------- |
| Modular pnpm/TypeScript foundation   | Implemented | Strict builds and architecture gate pass locally.                                                                |
| PostgreSQL schema and migrations     | Implemented | Fresh Testcontainers lifecycle passes.                                                                           |
| PasarGuard health and group sync     | Implemented | Valid/invalid connectivity and group snapshots covered.                                                          |
| Direct service create/read/renew     | Implemented | Numeric IDs, idempotency and read-after-write covered.                                                           |
| Durable card-to-card order lifecycle | Implemented | Checkout, proof, approval/rejection, retry provisioning and catalog card source.                                 |
| Telegram chat purchase flow          | Partial     | Mixed menus, image-document receipts, card-before-order, provisioning delay notice; public webhook unregistered. |
| Receipt review                       | Partial     | Admin private-chat review; image documents accepted; receipts topic gets a redacted text summary.                |
| Admin reporting group and topics     | Partial     | Start, returning-activity and order notices delivered; daily summary coded, not live.                            |
| New-user `/start` reporting          | Partial     | First-contact and same-day activity notices were delivered to the new-users topic.                               |
| Renewal customer journey             | Partial     | Bot menu renewal uses the latest fulfilled service; live PasarGuard renew not confirmed.                         |
| Data-driven catalog                  | Implemented | Products and supported selector values are database-driven and atomically published.                             |
| Catalog administration console       | Partial     | Dev bearer locally; production requires verified admin `initData` from the Mini App.                             |
| Customer Mini App catalog UX         | Implemented | Loading/error/empty states and data-driven selection were browser-checked.                                       |
| Customer Mini App checkout           | Partial     | Real orders, Persian status, error copy, polling, retry; live Telegram checkout unconfirmed.                     |
| Telegram Mini App authentication     | Implemented | HMAC `initData` verification, expiry, and numeric `user.id` covered by unit tests.                               |
| Production deployment and operations | Partial     | SECURITY.md, rate/body limits, Dockerfile healthcheck, compose restart+`app` profile, CI; no deploy.             |
| Resellers, wallet and debt           | Not started | Explicitly deferred until after the first trustworthy release.                                                   |
| Legacy import and cutover            | Not started | Must begin read-only with backup, preflight, rollback and controlled cutover.                                    |

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

Status: first-contact, returning-activity and order notices delivered on the live test forum;
receipt, provisioning, renewal and daily-summary notices remain outstanding. Receipt intake now
accepts photos and image documents and records first-contact on that path.

Gate remaining:

- confirm redacted receipt, approval and failure notices on the created topics;
- confirm live `ops.daily_summary` delivery to `daily_summaries`.

### Phase 3 - Real Mini App transaction

Status: `initData` verification, customer order API, Persian status/error copy, checkout retry and
idempotent Mini App keys are in-repo. File upload is intentionally deferred; receipts stay in the
bot chat. Catalog-without-card now fails before creating an order.

Gate remaining:

- live Mini App order from Telegram; receipt photo in the bot; shared order status;
- later: bounded receipt upload if the owner authorizes object storage.

### Phase 4 - Production security and operations

Status: in-repo hardening landed (health Telegram intake, graceful pool shutdown, webhook rate-limit
exclusion, compose restart/healthcheck, optional Mini App menu URL). Production host, TLS, backups
and secret rotation are not done.

Gate remaining:

- HTTPS webhook, monitoring, backup/restore drill, authorized Git baseline and dependency-scan
  cleanup without unresolved high-severity findings.

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

Current phase: **Phase 2 - Admin reporting event backbone**.

Next implementation slice: confirm redacted receipt, approval and provisioning notices on the test
forum. Local `getUpdates` intake is running, so the owner can send a receipt photo in the private
bot chat without a public webhook. In-repo production gaps for that path (image documents, card
validation, customer delay notice, webhook poison-update handling) are closed.

Expected sequence:

1. Send a card-to-card receipt image to the bot (do not paste file IDs or secrets in chat).
2. Confirm the receipts topic gets a redacted text summary, then approve or reject from the admin
   private-chat buttons.
3. Confirm sales or errors topic notices after the decision, without subscription URLs.

Owner-only remaining gates: public HTTPS webhook URL, first Git baseline (authorized this session),
live isolated PasarGuard group, TLS host, backup/restore drill, seven-day pilot.

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
