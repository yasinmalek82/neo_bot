<!--
context-schema: 1
last-updated: 2026-09-05T11:25:48.978Z
source-fingerprint: 42c982c4452e2a400a5c6a7d5e8b6aa0a78e4520fed1ef85e0f9cbd37742597e
current-phase: commercial-wave3
next-task: owner-authorized-isolated-pilot-gates
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
5. If the owner pasted Telegram bot copy, Grep that sentence in `apps/bot-api/src/telegram-menu.ts`
   first. Use Graphify only when the file path is unknown (`query` / `path` / `explain`, budget
   `600`, maximum `1200`). If `graphify-out/wiki/index.md` exists, start there for architecture
   questions. After changing `.graphifyignore`, rebuild with `graphify extract . --force --code-only`
   then `graphify update . --force`.
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
- `docs/adr/0011-representative-pricing-precedence.md`
- `docs/adr/0012-telegram-chat-catalog-administration.md`
- `docs/adr/0013-flexible-chat-storefront-presentation.md`
- `docs/adr/0014-role-aware-commerce-and-service-operations.md`
- `docs/adr/0021-durable-interaction-kernel.md`
- `docs/adr/0022-commercial-wave1.md`
- `docs/adr/0023-commercial-wave2.md`
- `docs/adr/0024-representative-prepaid-wallet.md`

Create a new ADR before materially changing one of these decisions.

## Current verified snapshot

Last evidence refresh: `2026-09-05`, Commercial Wave 2 (read-only PasarGuard used-traffic sync,
referral/invite, admin sales snapshot) is implemented on `cursor/wave2-commercial-848a` from the
Wave 1 commercial-pilot baseline. ADR 0023 and migration `0016` record the durable decisions.
A Mirza-style one-line host installer and interactive menu landed on
`cursor/vps-installer-menu-59e1` (`deploy/neo-install.sh`, `deploy/neo`, evolved
`deploy/install.sh`). Local `pnpm check` is green on this branch, including `pnpm test:deploy-cli`
and shellcheck. Installer hardening landed on `ops/install-harden-vps` (PR #9): safer reconfigure, webhook setup after HTTPS, health failures are nonzero, bilingual prompts, backup `umask`, and a docs one-liner. This agent did not install on a VPS. Isolated/live evidence is unchanged. Isolated local Slice 1 runtime and first-host evidence
remain unchanged historical records, not a new live check. Feature `004-telegram-home-concept`
artifacts are not on this remote; the visual baseline used was ADR 0013 ReplyKeyboard home plus
the existing `telegram-menu` mixed layout.

- Production-MVP readiness estimate: the customer store and catalog administration are both chat
  paths; live administrator publication, live purchase, and the seven-day pilot remain owner-side.
- Full envisioned product readiness estimate: approximately `45-50%`.
- Slice 1 is locally integrated in `main` through `f982086`. The integrated source passes `212` unit
  tests: domain `24`, application `64`, PasarGuard `10`, database `2`, bot API `107`, and retained
  admin-web `5`. Its PostgreSQL integration suite passes `15` tests, including the incremental
  `0012` -> `0013` upgrade path. Migration `0010` remains the latest deployed code; migrations
  `0011`-`0013` and all new runtime behavior are still local at this point.
- The fixed Compose project `neo_bot_local_test` now provides the active test runtime on the local
  Mac instead of the retired Mini App VPS path. Its fresh named PostgreSQL volume is separate from
  the preserved default local volume. Loopback `GET /health` is `ok`, the database is `reachable`,
  Telegram is `disabled`, `telegramReady=true`, `telegramError=none`, all `13` migrations are
  applied, and orders, provisioning operations, delivery jobs and report queues are empty. The
  profile forces `PROVISIONING_MODE=disabled`, `PILOT_ENABLED=false`, an empty webhook URL and
  reporting destination, and Telegram disabled unless the owner explicitly opts into sole-intake
  local polling.
- The previous default local PostgreSQL volume remains intact and stopped. It contains an older
  six-migration snapshot with one fulfilled order, so it was not upgraded, reset or reused: applying
  migration `0012` there could backfill a customer-delivery job. No old order was delivered and no
  Telegram or PasarGuard request was made during isolated runtime setup.
- The 2026-08-25 local baseline passes `pnpm check` (`178` unit tests), `pnpm deadcode`,
  `git diff --check`, and all `10` PostgreSQL integration tests after Docker Desktop was made
  available. The integration session test now reads the PostgreSQL clock instead of a stale fixed
  date; production repository and schema behavior were unchanged. No server, Telegram, payment, or
  PasarGuard mutation was performed for this baseline refresh.
- OpenCode/OX Alpha completed both Slice 1 phases in commit `0f7a922` inside the isolated writer
  worktree, but created that local commit despite the task's no-commit boundary. Sol preserved it,
  audited all `33` changed artifacts, and later integrated and pushed it after explicit owner
  approval; it has not been deployed. Independent Luna review
  confirmed the original candidate-identity and ambiguous-mutation fixes, then identified one
  incremental-migration blocker in the follow-up delivery patch. That blocker is fixed with additive
  migration `0013`; follow-up commit `f982086` adds autonomous delivery wake-up, monotonic claim
  fencing and truthful post-fulfillment reporting behavior.
- The reviewed integrated source passes build, typecheck, lint, formatting, architecture, dead-code,
  `git diff --check`, `212` unit tests and all `15` PostgreSQL integration tests. Graphify was updated
  to `1541` nodes and `3052` edges. The integration suite passed twice consecutively after replacing
  one host-clock test race with the PostgreSQL clock. This is local evidence, not production or live
  Telegram/PasarGuard proof.
- The first Docker-backed integration run after local-runtime setup exposed a narrower precision
  race in the retry test: PostgreSQL retained sub-millisecond `timestamptz` precision that `pg`
  truncated in a JavaScript `Date`, so the newest delivery could miss the first due claim. The
  test-only clock now advances one second past the database boundary. An independent Luna probe
  reproduced the precision loss; five targeted retry runs and the complete PostgreSQL suite then
  passed (`15/15`). Product retry behavior was not changed.
- Read-only deployment review is conditional NO-GO until production counts are known and fresh source,
  environment, database and rollback-image artifacts exist. Migration `0011` reclassifies old pending
  operations for reconciliation, while `0012` backfills delivery jobs for fulfilled orders and may
  trigger immediate Telegram delivery. Production approval/retry actions must remain idle during the
  disabled-mode rollout.
- The existing first-host SSH target and `/root/neo_bot` checkout were rediscovered from prior
  authorized local session evidence with strict known-host verification. Connection details remain
  machine-local and are not committed. A read-only preflight connection attempt then timed out on
  ports `22`, `80` and `443`; no remote command ran and current production data/runtime state remains
  unverified.
- Host `bot-api` health is `ok` after the authorized chat-store redesign build and targeted recreate.
  Loopback and public HTTPS health report `telegramReady=true`, `migrations=10`, and zero pending,
  failed, retrying or due report deliveries. The production read model retains one category, one
  product and two variants; the new attribute table and fulfilled-sales index exist. Both approved
  welcome/delivery Telegram photo IDs remain loaded; `PILOT_ENABLED` stayed false. Owner still needs
  to validate the customer comparison and administrator edit/review screens on a phone; delivery
  media remains unproven until an authorized real order reaches successful delivery.
- `pnpm db:restore-drill` restored a fresh dump onto a disposable Postgres on loopback
  (`schema_migrations=6`), then destroyed the instance and dump. The live local database was not
  overwritten. Restore onto a chosen target still requires `RESTORE_CONFIRM=yes`.
- Reviewed `main` is pushed through blocked-preflight record `d53366d`; Spec Kit integration is
  `741c670`. The prior run `33092034399` had stopped before install because the pre-existing workflow
  and `package.json` both supplied pnpm versions.
  The redundant workflow version is removed and GitHub Actions run `33169092504` passes frozen
  install, the complete `pnpm check` gate and the required high-severity audit. Follow-up run
  `33170559019` passes the same complete gate for the integrated Spec Kit commit, and follow-up run
  `33171228559` passes after the truthful blocked-preflight context update.
- Official GitHub Spec Kit `v1.0.1` is installed locally for Codex with ten project-local skills,
  pinned CLI metadata, Bash workflow scripts and templates. The project constitution derives from
  `AGENTS.md`, `PROJECT_CONTEXT.md` and ADRs; generated feature artifacts cannot override those
  authorities. `.specify/`, `.agents/skills/` and future `specs/` are included in the context
  fingerprint together with ignore-policy files, while managed Spec Kit files are excluded from
  Prettier mutation and Graphify noise. The local full-cycle workflow adds mandatory Analyze and
  Converge stages with review gates, and root governance explicitly constrains Converge intent to the
  canonical project authorities. `specify check`, script/JSON validation, `pnpm check` (`212` unit
  tests), dead-code, high-severity audit and diff checks pass. Graphify was fully re-extracted and
  updated after the ignore change (`1545` nodes, `3056` edges). This is tooling validation, not
  production evidence.
- CI `pnpm audit --audit-level=high` is required. Transitive `fast-uri` is pinned to patched
  3.1.6 / 4.1.3 in `pnpm-workspace.yaml`. One moderate `uuid` advisory remains in
  Testcontainers only.
- Live test forum: eight purpose topics exist. The local outbox delivered first-contact, returning
  activity, one `order.created`, and one `ops.daily_summary` (four deliveries, none failed). One
  sales order is `awaiting_receipt` with zero payment proofs. Receipt, approval and provisioning
  notices are still unconfirmed. Owner visual check of the daily-summaries topic is still required.
- Authorized Git history is pushed through `d53366d` on `main`, remote
  `https://github.com/yasinmalek82/neo_bot`. `.env` was not committed. Spec Kit changes development
  governance only, not application runtime or production state.
- The owner reported first-host install completed. Public HTTPS Mini App purchase and receipt photo
  still need live evidence. No live-user migration or isolated PasarGuard pilot.

Passing local checks proves the local code boundary only. It does not prove a real Telegram purchase,
off-host backup restoration or public security.

## Architecture map

### Applications

- `apps/bot-api`: NestJS + Fastify API, health/catalog endpoints, Telegram webhook and pilot CLI.
- `apps/admin-web`: retained customer WebApp statics. It is not the customer store or an administrator
  catalog console.
- Catalog administration is a private Telegram chat workflow in `apps/bot-api`, backed by typed
  application commands and PostgreSQL repositories.

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
- `0007_reseller_pricing_and_ops.sql`: representatives, variant access, base and override prices, order pricing source, and `reseller.*` event types.
- `0008_order_service_username_base.sql`: validated nullable order username base for provisioning-time
  `base_random4` generation.
- `0009_catalog_chat_admin_core.sql`: catalog revision compare-and-swap, durable administrator wizard
  sessions, and redacted publish audit records.
- `0010_storefront_variant_attributes.sql`: up to four ordered variant display attributes and an
  index supporting trailing-thirty-day fulfilled-sales evidence.
- `0011_paid_renewal_and_provisioning_recovery.sql`: local Slice 1 candidate for paid renewal,
  durable provisioning identity/postconditions and reconciliation state; not deployed.
- `0012_customer_delivery_jobs_and_proof_media.sql`: local Slice 1 candidate for proof media kind and
  durable fulfilled-order delivery jobs; not deployed.
- `0013_customer_delivery_claim_fencing.sql`: additive claim-version upgrade for existing `0012`
  installations so stale delivery workers cannot publish a second secret-bearing anchor; not deployed.
- `0014_durable_customer_flows.sql`: local candidate for versioned customer conversation sessions,
  optional discount codes, a non-negative prepaid wallet ledger, and Telegram-update-scoped support
  tickets; not deployed.
- `0015_commercial_wave1.sql`: local candidate for shop-block, trial orders/claims, ops settings,
  reminder deliveries, broadcast outbox, and Wave 1 reporting types; not deployed.
- `0016_commercial_wave2.sql`: local candidate for usage-sync watermark, referral attribution and
  reward ledger, wallet `referral` credits, invitee checkout discount, and `referral.rewarded`
  reporting; not deployed.

### Runtime boundaries

- `docker-compose.yml` provisions local PostgreSQL by default. Profile `app` builds `bot-api` from
  `Dockerfile` without embedding secrets. `docker-compose.local-test.yml` plus the
  `pnpm local-test:*` scripts use the fixed `neo_bot_local_test` project and a separate retained
  volume, force provider mutation off and keep Telegram disabled by default. Polling is an explicit
  sole-intake opt-in; the local reporting destination is cleared and the down command preserves
  data. `docker-compose.production.yml` is the host shape (Postgres unpublished, API on loopback,
  `bot-api` `DATABASE_URL` injected with host `postgres` so a loopback `.env` value cannot strand the
  container, Caddy on 80/443 for retained customer statics and API routes, TLS via
  `deploy/Caddyfile.example`, JSON access logs to Caddy stdout); it is not deployed until
  `deploy/install.sh` runs on a host.
- In-repo CI is `.github/workflows/check.yml` (`pnpm check` and required high-severity `pnpm audit`).
  `pnpm db:backup`, `pnpm db:restore`, and `pnpm db:restore-drill` cover dump/restore. Compose-network
  URLs dump via `docker compose exec` (production file when the host is `postgres`). Dumps are
  gitignored. Secret rotation steps are in `docs/runbooks/secret-rotation.md`. `deploy/install.sh`
  plus compose Caddy are the in-repo first-host path; no production TLS certificate is installed
  until the owner runs that script on a VPS.
- `SECURITY.md` records the current threat model. `.env.example` contains placeholders only. Real
  `.env` values are local secrets and must never be committed or printed.
- Cursor tooling and `.cursor/**` have been deleted locally and from first-host. They are not part of
  the project and must not be recreated or used without explicit owner authorization.

## Capability status

| Capability                           | Status      | Verified boundary or gap                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------ | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Modular pnpm/TypeScript foundation   | Implemented | Strict builds and architecture gate pass locally.                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| PostgreSQL schema and migrations     | Implemented | Fresh Testcontainers lifecycle passes.                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| PasarGuard health and group sync     | Implemented | Valid/invalid connectivity and group snapshots covered.                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Direct service create/read/renew     | Implemented | Numeric IDs, idempotency and read-after-write covered.                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Durable card-to-card order lifecycle | Implemented | Checkout, proof, approval/rejection, retry provisioning and catalog card source.                                                                                                                                                                                                                                                                                                                                                                                                                |
| Telegram chat purchase flow          | Partial     | Customer ReplyKeyboard restored to compact hubs (order/wallet and guide/support) after Wave 1/2 overcrowding; trial remains a conditional row. Category -> product -> plan comparison -> detail -> payment -> receipt stays chat-only. Durable sessions still release on Home/Cancel/shop-back. Live phone proof outstanding.                                                                                                                                                                   |
| Customer visual identity             | Partial     | Versioned master, welcome and successful-delivery PNGs use the approved charcoal/ivory/signal-orange `NN / NEO NETWORK / PRIVATE ACCESS` direction. Welcome and delivery assets were uploaded privately to Telegram, their file IDs are configured on first-host, and runtime presence is verified; phone `/start` and real successful-delivery rendering are not both proven yet.                                                                                                              |
| Receipt review                       | Partial     | Admin private-chat review queue labeled صف رسید (legacy open-orders alias kept). Image documents accepted; receipts topic redacted. Hub copy lists commercial tools. SLA tracking still absent.                                                                                                                                                                                                                                                                                                 |
| Admin reporting group and topics     | Partial     | Local outbox delivered first-contact, activity, order.created, and one daily summary; receipt/approval unconfirmed.                                                                                                                                                                                                                                                                                                                                                                             |
| New-user `/start` reporting          | Partial     | First-contact and same-day activity notices were delivered to the new-users topic.                                                                                                                                                                                                                                                                                                                                                                                                              |
| Renewal customer journey             | Partial     | Renewal now requires a preview and explicit final confirmation; back/menu causes no provider mutation. Failed renewals complete the Telegram update and keep the previous service; live PasarGuard renew remains unconfirmed.                                                                                                                                                                                                                                                                   |
| Data-driven catalog                  | Implemented | Products and supported selector values are database-driven and atomically published. Variants support free display title/copy plus four ordered presentation attributes while volume, duration, device limit, effective price and provider binding remain typed. Migration `0010` is applied on first-host.                                                                                                                                                                                     |
| Telegram chat catalog administration | Partial     | Private allowlisted administration remains hierarchical. Menu labels during an open wizard now navigate instead of writing a field; Home leaves the draft resumable. Store hub/wizard/list/picker screens expose Home, and the picker page indicator no longer cancels the session. Phone validation remains separate evidence.                                                                                                                                                                 |
| Customer Mini App catalog UX         | Abandoned   | Not the store. Copy tells the customer to buy in chat.                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Customer Mini App checkout           | Abandoned   | `POST /customer/orders` and `POST /customer/renew` return gone. Chat menu button is commands.                                                                                                                                                                                                                                                                                                                                                                                                   |
| Telegram WebApp customer identity    | Implemented | Retained customer statics validate Telegram `initData`; catalog administrator authorization is numeric allowlist plus private-chat enforcement inside the bot.                                                                                                                                                                                                                                                                                                                                  |
| Production deployment and operations | Partial     | In-repo one-line `deploy/neo-install.sh` plus `deploy/neo` menu (install, git update, settings, compose, backup, health) wrap the existing first-host installer. Validator/shellcheck evidence only; no VPS run from this change. Historical first-host `bot-api` rebuild still stands: migration `0010`, public/loopback health, webhook readiness, report queues, and disabled pilot were verified then. Caddy/Postgres were not recreated; no purchase or PasarGuard mutation was performed. |
| Resellers, wallet and debt           | Partial     | Schema, listing, checkout snapshot, customer assignment, and current-price audit exist. Override then base then public. A non-negative customer wallet top-up ledger and restart-safe amount/coupon input exist locally; representative debt, admin price UI, and `reseller.*` notices are not published.                                                                                                                                                                                       |
| Legacy import and cutover            | Not started | Must begin read-only with backup, preflight, rollback and controlled cutover.                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Free trial / test service            | Partial     | One write-once claim plus `order_kind=trial` amount 0. Admin ops settings choose enable + catalog variant (duration/traffic/devices/groups). Home shows the trial key only when eligible. Repeats refuse idempotently. Fulfillment reuses the paid create path and still honors `PROVISIONING_MODE` / `PILOT_ENABLED`. Local unit evidence only; live provision remains gated.                                                                                                                  |
| Forced channel join                  | Partial     | Owner configures channel IDs/usernames on ops settings. Shop/trial/checkout fail closed on Telegram membership errors with join + refresh copy. Allowlisted admins bypass. Local unit evidence only; live `getChatMember` on a real channel is unproven.                                                                                                                                                                                                                                        |
| Expiry / low-traffic reminders       | Partial     | Outbox-style `service_reminder_deliveries` with idempotent window keys. Persian copy, no subscription URL. Shop-blocked customers skipped. Low-traffic enqueues only when `used_traffic_bytes` is known. Wave 2 adds a read-only PasarGuard `UsageSyncUseCase` that writes only that column plus `usage_synced_at`; no entitlement mutation; mocked/gated in tests. Dispatcher is in-process like reports. Local unit evidence only; live GET remains unproven.                                 |
| Referral / invite                    | Partial     | Personal `/start r{telegramUserId}` deep-link, write-once attribution, no self-referral, one reward per referred user, per-referrer cap. Wallet credit and optional first-purchase discount fire on first paid fulfillment only (not trial). Durable `referral_rewards` plus wallet `kind=referral`. Admin ops settings in chat. Local unit evidence only; live invite/pay remains unproven.                                                                                                    |
| Admin sales snapshot                 | Partial     | Private-chat Postgres snapshot for today and 7d in `Asia/Tehran`: orders by status, approximate fulfilled revenue, new customers, open tickets, pending receipt reviews. No Telegram or PasarGuard I/O. Local unit evidence only.                                                                                                                                                                                                                                                               |
| My-services deliverability           | Partial     | «سرویس‌های من» lists local fulfilled bindings, resends the access link, offers iOS/Android/Windows guides, and can send an in-memory QR. URLs stay off list screens, jobs, reports and logs. QR needs `sendPhotoBuffer`; otherwise the link is resent. Local unit evidence only.                                                                                                                                                                                                                |
| Admin broadcast                      | Partial     | Allowlisted admin queues a one-shot durable job with paginated/rate-limited dispatch and cancel. Reports store hash + counts, not the body. Durable `admin.broadcast` session never stores the body. Local unit evidence only; no live Telegram send.                                                                                                                                                                                                                                           |
| Commercial pilot hardening           | Partial     | Health exposes `provisioning.mode` / `pilotEnabled` and commercial queue counts without bodies or URLs. Missing Wave 1 tables do not fail `/health`. Runbook notes owner-only gates: webhook TLS, isolated PasarGuard group, backups, phone smoke. No deploy, no live PasarGuard mutation, no real Telegram in CI.                                                                                                                                                                              |

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

### Phase 3 - Real chat purchase

Status: customer store and catalog administration are private Telegram chat paths. The administrator
Mini App and `/console/` are removed. File upload is not in scope.

Gate remaining:

- owner creates or reviews a category, product and variant in «مدیریت فروشگاه» and publishes one
  sellable variant after the live `0009` migration;
- live chat order from `/start`; receipt photo in the same chat; shared order status;
- later: bounded receipt upload only if the owner authorizes object storage.

### Phase 4 - Production security and operations

Status: in-repo hardening landed (health Telegram intake mode plus ready/error, report-queue and
migration counts, graceful pool shutdown, webhook rate-limit exclusion, compose restart/healthcheck,
dump/restore plus a disposable restore drill, production compose overlay
that injects `bot-api` `DATABASE_URL` with host `postgres`, compose-aware dump/restore, webhook
`getWebhookInfo` intake honesty, Caddy routing for retained customer statics and APIs, first-host
`deploy/neo-install.sh` / `deploy/neo` menu wrapping `deploy/install.sh`, runbook, secret-rotation
checklist, redacted stdout and HTTP error codes).
Production host, TLS certificates, off-host backup storage and a live secret rotation are not done
until the owner provides VPS access in a terminal.

Gate remaining:

- HTTPS webhook on a reachable host, off-host dump storage, and TLS certificates. High-severity
  dependency audit is required in CI. The authorized Git baseline is done. In-repo secret-rotation
  steps exist; they are not a completed live rotation. `bash deploy/neo-install.sh` waits for owner
  SSH.

### Phase 5 - Controlled pilot and release

Status: in-repo commercial blockers for an Iranian card-to-card shop are locally implemented
(Wave 1). The live seven-day cohort is not started.

Gate:

- full deployed path succeeds: Telegram chat identity -> checkout -> receipt -> admin decision ->
  PasarGuard provisioning -> customer delivery -> renewal;
- retries never create duplicate orders or provider users;
- rollback and recovery procedures are exercised;
- a small invited cohort runs for at least seven days without lost orders, duplicate services or
  unresolved critical alerts.

### Phase 6 - Role-aware revival roadmap

Status: approved on 2026-08-25 and active after the local checkpoint.

- Slice 1 closes unpaid renewal, unstable provisioning identity and missing runtime mutation gates.
- Slice 2 adds multi-service customer self-service, paid renew/top-up/controlled-upgrade operations,
  manual-payment attempts, support tickets and bounded secret delivery.
- Slice 3 adds staff RBAC, exception queues, hierarchical operations, SLA and removal of the unused
  customer web prototype after live-consumer proof.
- Slice 4 adds representative-owned customers, non-negative prepaid wallets, append-only ledger and
  tenant-isolated service operations.
- Automated bank-message matching, extra payment providers, marketing features, bulk reseller
  creation, white-label and legacy import remain later scope.

## Current priority and next task

Current phase: **commercial-wave2**. Wave 1 commercial blockers plus Wave 2 usage sync,
referral/invite, and admin sales snapshot are in source on `cursor/wave2-commercial-848a`.
ADR 0022 and ADR 0023. Not deployed.

Next task: owner-authorized isolated-database apply of migrations `0014`+`0015`+`0016`, then
owner-only live gates (public HTTPS webhook + TLS, prepared PasarGuard group, off-host backups,
phone smoke of `/start` → shop or trial → receipt → delivery, plus invite and sales-snapshot
chat checks). Do not treat local unit evidence as phone or production proof. Isolated or live
PasarGuard mutation remains a separate product-risk decision. Remaining operator/staff
memory-only Telegram input can return after those gates.

Expected sequence:

1. Keep customer purchase naming/coupon, renewal coupon, wallet top-up, ticket, broadcast,
   ops-settings and referral-setting flows on durable sessions; do not reintroduce process-local
   Maps for those inputs.
2. Apply migrations `0014`, `0015` and `0016` only with explicit authorization on an isolated
   database.
3. Owner configures trial variant, forced-join channels, reminder thresholds, and referral
   credit/discount/cap in chat.
4. Continue Slice 1 local polling smoke and later slices as separately authorized work.
5. Android/iPhone evidence remains mandatory before customer-facing visual completion.

Owner-only remaining gates: public HTTPS webhook URL, live isolated PasarGuard group, TLS host,
off-host backup storage, phone smoke, seven-day pilot.

Do not request group tokens or secrets in chat.

## Cross-cutting Codex execution governance

`AGENTS.md` is canonical for Codex orchestration. The preferred flow is Sol supervisor -> Luna or
Terra executor -> independent verifier -> Sol close. Keep at most two subagents active and one
writer; preserve the dirty-worktree baseline. Sol owns final authority, ADR/context truthfulness,
stamping and completion. A role-equivalent fallback must disclose `requested_role`, `actual_model`,
and `fallback_reason`. OX Alpha through OpenCode is an auxiliary external executor for bounded
inventory, Graphify triage, test matrices and mechanical low-risk work in an isolated worktree. Its
output is untrusted candidate work, it is never the independent verifier, and it has no commit,
ADR/context, security-decision, deploy or live-mutation authority. Cursor tooling is absent from the
project and must not be recreated or used unless the owner explicitly authorizes it.
This execution rule does not change the current phase or next product task.

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

### 2026-09-05 - Telegram home hubs and admin receipt-queue copy

- Outcome: restored compact customer ReplyKeyboard hubs after Wave 1/2 overcrowding; admin review queue renamed to صف رسید; admin hub copy refreshed for commercial tools. No deploy.
- Validation: bot-api unit 151/151 on PR branch; CI stamp follow-up.
- Next: owner-authorized isolated migrate 0014+0015+0016, webhook TLS, phone smoke.

### 2026-09-05 - One-line VPS installer and interactive host menu

- Outcome: added `deploy/neo-install.sh` (clone/update then menu), persistent `deploy/neo` /
  `deploy/menu.sh`, and keep-or-reconfigure first setup in `deploy/install.sh`. README and
  `docs/runbooks/first-host.md` document the curl|bash command for `main` after merge and the
  PR-branch pin. No AGPL copy. No live host install, Telegram call, or PasarGuard mutation.
- Validation: `pnpm check` passed locally and on GitHub Actions (build, typecheck, lint, format,
  architecture, unit tests, `pnpm test:deploy-cli`). Unit suites: domain `37`, application `88`,
  PasarGuard `10`, database `2`, bot-api `151`, admin-web `5` (`293` total) plus installer
  validators/shellcheck. CI then failed the required high-severity audit on transitive `fast-uri`;
  patched pins 3.1.6 / 4.1.3 are in `pnpm-workspace.yaml` and `pnpm audit --audit-level=high` is
  now clean except the known moderate Testcontainers `uuid`. No VPS install, Telegram send, or
  PasarGuard mutation.
- Next: unchanged owner-authorized isolated apply of `0014`+`0015`+`0016`, then webhook TLS,
  isolated PasarGuard group, backups, and phone smoke. Owner can run the one-liner on a VPS.

### 2026-09-05 - Commercial Wave 2 usage sync, referral, and sales snapshot

- Outcome: implemented Wave 2 on the Wave 1 commercial-pilot baseline: read-only PasarGuard
  used-traffic sync, personal start-link referral with paid-fulfillment wallet/discount rewards,
  and a Postgres admin sales snapshot. ADR 0023 and migration `0016`. Card-to-card + wallet stay
  the only rails. PasarGuard stays the only panel. No AGPL copy, no live provision, no deploy.
- Validation: `pnpm check` passed (build, typecheck, lint, format, architecture, tests).
  Unit suites: domain `37`, application `88`, PasarGuard `10`, database `2`, bot-api `151`,
  admin-web `5` (`293` total). No production migrate, Telegram send, or PasarGuard
  mutation. No phone or production proof.
- Next: owner-authorized isolated apply of `0014`+`0015`+`0016`, then webhook TLS, isolated
  PasarGuard group, backups, and phone smoke.

### 2026-09-05 - Commercial Wave 1 for an Iranian Telegram shop

- Outcome: implemented the missing commercial blockers on the durable-customer-flows + menu UX
  baseline: one free trial per customer, forced channel join, expiry/low-traffic reminder
  outbox, my-services resend/guides/QR, cancelable admin broadcast, and pilot health/runbook
  notes. ADR 0022 and migration `0015`. Card-to-card + wallet stay the only rails. PasarGuard
  stays the only panel. No AGPL copy, no live provision, no deploy.
- Validation: `pnpm check` passed (build, typecheck, lint, format, architecture, tests).
  Unit suites: domain `32`, application `78`, PasarGuard `10`, database `2`, bot-api `147`,
  admin-web `5` (`274` total). No production migrate, Telegram send, or PasarGuard
  mutation. No phone or production proof. Low-traffic reminders stay Partial until
  `used_traffic_bytes` is populated.
- Next: owner-authorized isolated apply of `0014`+`0015`, then webhook TLS, isolated
  PasarGuard group, backups, and phone smoke.

### 2026-09-05 - Telegram customer and admin menu UX navigation pass

- Outcome: investigated customer and admin chat menus against ADR 0013/0021. Home, Cancel,
  shop-back and other menu actions now release durable customer sessions instead of treating
  reply-keyboard labels as username/coupon/ticket/amount input. `/start` during a flow returns
  Home. Stale renewal confirm after Home no longer creates an order. Wallet and tickets sit on
  the persistent home keyboard. Admin wizard text no longer swallows menu labels; picker page
  indicators no longer cancel; admin screens consistently offer hub + Home. Feature `004`
  artifacts were absent on this remote.
- Validation: `pnpm check` passed. Unit suites: domain `26`, application `69`, PasarGuard
  `10`, database `2`, bot-api `139`, admin-web `5` (`251` total). No production migrate,
  Telegram send, or PasarGuard mutation. No phone or production proof.
- Next: keep remaining operator input off process-local Maps; apply `0014` only with explicit
  isolated-database authorization. Deeper catalog-admin BotScreenModel consolidation is later.

### 2026-09-05 - Feature 005 Phase 4 customer restart-safe flows

- Outcome: customer purchase naming/coupon, renewal coupon, wallet top-up amount/coupon, and
  ticket create/follow-up now use a versioned conversation-session kernel. Ticket bodies stay
  out of session history and are written only with Telegram-update idempotency. ADR 0021 and
  migration `0014` record the durable decision. This remote had no earlier 005 artifacts.
- Validation: `pnpm check` gates through architecture plus unit suites: domain `26`,
  application `69`, PasarGuard `10`, database `2`, bot-api `132`, admin-web `5`
  (`244` total). No production migrate, Telegram send, or PasarGuard mutation.
- Next: keep remaining operator input off process-local Maps; apply `0014` only with explicit
  isolated-database authorization.

### 2026-08-28 - Isolated local test runtime replaces the Mini App VPS path

- Outcome: added a fixed `neo_bot_local_test` Compose profile and package commands for a fresh local
  PostgreSQL volume plus `bot-api`. The default profile forces Telegram and provisioning off; its
  down command preserves data. The older default volume was stopped and preserved rather than
  migrated because its fulfilled order could enter the new delivery backfill.
- Validation: both default and polling-opt-in Compose renders have the intended safety controls. The
  running default profile is healthy on loopback with `13` migrations and zero orders,
  provisioning operations or delivery jobs. Luna independently verified the disabled-call boundary
  and the integration-test timestamp race; five targeted retries and the complete PostgreSQL suite
  pass after the test-only precision margin. No Telegram or PasarGuard request was made.
- Next: finish the repository gates and push the profile, then make local polling the sole test-bot
  intake and run the bounded Slice 1 chat smoke path with provisioning still disabled.

### 2026-08-28 - CI green; production preflight blocked before remote execution

- Outcome: pushed Spec Kit integration commit `741c670`; GitHub Actions run `33170559019` passed
  frozen install, `pnpm check` and high-severity audit. The known first-host target and checkout were
  recovered from prior authorized local evidence without committing connection details.
- Validation: strict-known-host SSH timed out before authentication, and bounded TCP checks also
  timed out on ports `80` and `443`. No compose, database, environment, Telegram or PasarGuard command
  ran remotely; current migrations, backfill size and runtime mode therefore remain unverified.
- Next: owner restores the known VPS/network path or confirms the current host address; rerun the
  read-only preflight before backups, migration or disabled-mode deploy.

### 2026-08-28 - Spec Kit adopted for bounded Codex feature delivery

- Outcome: installed official pinned Spec Kit `v1.0.1` with Codex skills mode and no extensions or
  presets. Root rules define strict precedence over generated feature artifacts, explicitly bound
  Converge to feature-local intent, and the local full-cycle workflow now includes Analyze and
  Converge review gates. The seeded constitution mirrors the existing clean-room, mutation-safety,
  secret and evidence boundaries.
- Validation: isolated preview and two independent read-only reviews confirmed the generated scope.
  A final independent Luna review then found and closed the missing Analyze/Converge stages, the
  Converge authority ambiguity and ignore-policy fingerprint gap. All `22` installer-manifested
  upstream files retain exact hashes; `specify check`, workflow inspection, Bash/JSON validation,
  full `pnpm check` (`212` tests), dead-code, high-severity audit and diff checks pass. Graphify was
  fully rebuilt after excluding managed workflow assets and reports `1545` nodes and `3056` edges.
  No application, database, Telegram, PasarGuard or production behavior changed.
- Next: run the production read-only preflight as the unchanged product priority. Do not start a
  feature spec until its scope is reconciled with this context.

### 2026-08-28 - GitHub Actions setup repaired and green

- Outcome: deployment was paused after the owner reported failed GitHub jobs. Run `33092034399`
  failed before dependency installation because both `.github/workflows/check.yml` and
  `package.json` supplied pnpm versions. The minimal local repair removes the redundant broad
  workflow version and keeps exact `pnpm@11.19.0` authoritative in package metadata; commit
  `3a3f9d1` is pushed.
- Validation: GitHub job `98587114990` identifies `pnpm/action-setup@v4` as the only failed step;
  checkout passed and install/check/audit were skipped. Independent Luna traced both declarations to
  baseline commit `6c9bbe4`, so this is not a Slice 1 regression. Locally, frozen install, the full
  `212`-test gate, high-severity audit, dead-code, diff and Graphify checks pass. GitHub Actions run
  `33169092504` then passed install, `pnpm check` and audit in `1m2s`.
- Next: run the production read-only data/runtime preflight; create fresh rollback artifacts before
  any disabled-mode deployment.

### 2026-08-27 - Slice 1 locally integrated with rollout authority

- Outcome: after explicit owner authorization, Sol committed the reviewed delivery-fencing follow-up
  as `f982086` and fast-forwarded `main` across OX Alpha's preserved `0f7a922` implementation. The
  previously dirty governance/context/handoff files had no overlap and were preserved. The owner also
  granted Sol standing authority to choose safe commit, push and deploy checkpoints; this does not
  authorize PasarGuard mutation outside disabled mode.
- Validation: the writer branch is clean and `main` now contains migrations `0011`-`0013` plus the
  complete paid-renewal, recovery, reporting and delivery implementation. `pnpm check` passes all
  `212` unit tests; integration passes `15/15` twice after commit `57214d6` bound retry timing to the
  PostgreSQL clock. Dead-code, diff and Graphify (`1541` nodes, `3052` edges) pass. Independent Luna
  marked deployment conditional NO-GO until production counts and fresh rollback artifacts exist.
- Next: commit/push the truthful documentation, run the read-only production data/runtime preflight,
  then create backups and deploy with `PROVISIONING_MODE=disabled` only if every gate is safe.

### 2026-08-27 - Slice 1 candidate recovery, fencing and independent close

- Outcome: Sol audited OX Alpha's local `0f7a922` commit rather than trusting the transfer report.
  OX had completed paid renewal, provisioning recovery/mutation modes, durable proof reporting and
  customer delivery, but violated its no-commit instruction; the commit remains isolated and was not
  merged. Sol then closed idle-delivery, stale-lease and post-fulfillment error-classification gaps.
  Delivery now has an independent scheduler, monotonic claim fencing and an additive `0013` upgrade;
  subscription URLs remain dispatch-time only. Requested writer role was Terra, actual writer for the
  follow-up was Sol, and `fallback_reason=Terra usage limit after a partial uncommitted patch`.
- Validation: independent Luna accepted the two original security remediations, found only the
  modified-`0012` upgrade blocker in the follow-up, and found no other actionable bypass. After moving
  fencing to `0013`, build, typecheck, lint, formatting, architecture, dead-code, diff check, `212`
  unit tests and `15` PostgreSQL integration tests pass; Graphify reports `1520` nodes and `3032`
  edges. No push, deploy, production migration, Telegram call or PasarGuard mutation occurred.
- Next: obtain explicit authorization for a local candidate commit/integration, rerun the gates in
  main, then separately authorize a backed-up disabled-mode deployment. OX Alpha is retained only as
  a bounded external executor under Luna verification and Sol final authority.

### 2026-08-25 - Codex stop and OpenCode OX Alpha transfer

- Outcome: at the owner's explicit request, all active Codex work stopped and the independent final
  review was interrupted. The Slice 1 writer worktree is preserved uncommitted. The complete security
  scan covered 29 source items plus `.env.example`, validated two findings, and both remediations are
  present: write-once durable create candidates and ambiguous classification for unreadable successful
  POST/PUT bodies. A detailed OpenCode/OX Alpha continuation prompt now records the exact worktrees,
  hashes, gates and remaining delivery-reliability scope. Prompt Perfect was used for two refinement
  passes; final supervisory quality control retained its continuation structure while restoring the
  exact operational evidence and writer-worktree paths it had compressed.
- Validation: the remediation candidate passed build, typecheck, lint, formatting, architecture,
  dead-code, diff check, 192 unit tests and all 12 PostgreSQL integration tests. Final independent
  source-to-sink PASS/FAIL was not returned before the stop. No commit, push, deploy, live migration,
  Telegram action or PasarGuard mutation occurred.
- Next: OpenCode/OX Alpha recomputes the recorded hashes, independently verifies both fixes, then
  finishes durable receipt retrieval and customer-delivery jobs in the existing writer worktree.

### 2026-08-25 - Revival baseline and decision checkpoint

- Outcome: the owner approved the four-slice role-aware revival, manual-card payment adapter,
  paid service operations, staff RBAC, prepaid representative wallet and removal of the unused web
  prototype after proof. ADR 0014 records the clean-room architecture. Luna diagnosed a stale
  integration-test clock; Terra aligned that test with PostgreSQL time without changing production
  behavior. Requested and actual roles were Luna and Terra; no model fallback occurred.
- Validation: `pnpm check` passes with `178` unit tests, `pnpm deadcode` and `git diff --check` pass,
  and Docker-backed `pnpm test:integration` passes all `10` tests. No deploy, Telegram message,
  payment, migration, or PasarGuard mutation occurred.
- Next: use the authorized local checkpoint without push and implement Slice 1 in a dedicated writer
  worktree with independent read-only verification.

### 2026-08-22 - First-host hierarchical chat-store redesign deployment

- Outcome: after explicit owner authorization, Sol backed up first-host source, host-only environment
  and PostgreSQL, synchronized the reviewed redesign, built a new image and force-recreated only
  `bot-api`. Startup applied additive migration `0010`; Caddy, Postgres, Telegram messages, purchases
  and PasarGuard were not mutated. Luna independently reviewed the runbook and acceptance boundary;
  no model fallback occurred.
- Validation: backup `/var/backups/neo_bot/chat-store-redesign-20260822T200444Z` and rollback image
  `neo-bot-chat-store-pre:20260822T200444Z` exist. Loopback and public HTTPS health are `ok` with
  `telegramReady=true`, `migrations=10` and zero report backlog. The attribute table and fulfilled-sales
  index exist; the read model retains one category, one product and two variants; runtime source hashes
  match local; all three Compose services run, retired admin HTTP/console paths stay `404`, pilot is
  disabled and no recent runtime error remains. A signed empty webhook probe restored readiness after
  the controlled restart without storing an update or sending a Telegram message. Post-deploy
  `pnpm check`, dead-code, diff and Graphify refresh pass (`1400` nodes, `2809` edges). A redundant
  integration rerun was infrastructure-blocked because the local Docker runtime was unavailable; the
  previously passing `10` integration tests plus the live transactional migration/schema/read-model
  checks remain the evidence for this deployment.
- Next: owner validates customer comparison plus administrator edit/review/publish on a phone and
  supplies Android/iPhone screenshots before any separately authorized real purchase or provisioning.

### 2026-08-22 - Flexible hierarchical chat storefront redesign

- Outcome: Terra implemented the approved ReplyKeyboard-only home, category-to-product customer
  navigation, bounded three-plan comparisons, free plan title/copy, four normalized display
  attributes, factual evidence badges, hierarchical administrator navigation, selective working-copy
  drafts, reviewed reorder and atomic guided category+product+variant publication. Sol corrected home
  duplication, badge assignment and all customer/admin Telegram length boundaries; Luna independently
  found the original comparison-length risk. ADR 0013 records the durable presentation and changeset
  decisions. Models used were Terra writer, Luna verifier and Sol close; no fallback occurred.
- Validation: domain `24`, application `43`, PasarGuard `4`, database unit `2`, retained customer-web
  `5`, bot API `100` and PostgreSQL integration `10` tests pass. Build, typecheck, lint, formatting,
  architecture, dead-code and diff gates pass. No deployment, production migration, live Telegram
  message or PasarGuard mutation occurred. Root `design-qa.md` is blocked because no source/current
  Telegram screenshots were available for same-state Android/iPhone comparison.
- Next: obtain explicit owner authorization for backup, migration `0010` and deployment, then capture
  real customer comparison and administrator edit/review screens before the live purchase gate.

### 2026-08-22 - Production catalog read-model repair and Cursor removal

- Outcome: after the owner reported systemic inline-button failure, Sol refreshed Graphify and traced
  the store path from `handleCallback` through fourteen `getReadModel` consumers. A read-only query
  inside the production container exposed PostgreSQL `42703`: the new read model selected nonexistent
  `products.position` instead of the authoritative `product_category_assignments.position`. Terra
  corrected the query without adding a redundant migration and added a production-shaped regression;
  Luna independently accepted the schema mapping. At the owner's explicit direction, all `.cursor/**`
  files were deleted locally and from first-host rather than retained as an archive, and active policy
  and quality-tool references were removed. No model fallback occurred.
- Validation: database integration passes `9/9`, including a nonzero assignment position through both
  repository and `CatalogChatAdminUseCase`; application tests pass `42/42`, with typecheck, lint,
  formatting and diff checks passing. Sol deployed only the corrected repository after backup
  `/var/backups/neo_bot/catalog-readmodel-fix-20260822T170331Z`. The live container read model now
  succeeds with one category, one product and two variants; health is `ok`, `telegramReady=true`,
  `migrations=9`, report queues are zero and pilot provisioning remains disabled. Graphify was rebuilt
  after corpus shrink (`100` indexed code files). A fresh Telegram store-entry button was accepted;
  the owner's tap remains the final live UX proof.
- Next: owner taps the latest «ورود به مدیریت فروشگاه» button. If it renders, validate category,
  product and variant navigation before any publish or PasarGuard mutation.

### 2026-08-22 - Production store-management opener hotfix

- Outcome: production evidence showed nine recent Telegram updates failed with
  `TELEGRAM_HTTP_400` while opening the administrator store. Terra made callback acknowledgement
  best-effort so an expired acknowledgement cannot fail and replay completed work, and routed both
  the current reply-keyboard label and legacy «مدیریت فروشگاه» text to the private allowlisted store
  hub. Sol deployed only the two runtime source files after a recoverable source/image snapshot and
  sent the administrator one fresh direct-entry button. Luna performed the read-only route audit;
  no model fallback occurred.
- Validation: Bot API tests pass (`93`) with exact-label, non-admin, expired-acknowledgement and
  original-error coverage; Bot API typecheck, lint, formatting and diff checks pass. First-host
  health is `ok` with `telegramReady=true`, `migrations=9`, zero report backlog and pilot
  provisioning still disabled. Backup:
  `/var/backups/neo_bot/store-open-hotfix-20260822T164508Z`. The direct message was accepted by
  Telegram; the owner's tap and rendered phone screen remain the final live UX evidence.
- Next: owner taps the newly sent «باز کردن مدیریت فروشگاه» button and confirms the hub renders;
  then validate create, preview and publish without a real purchase or PasarGuard mutation.

### 2026-08-22 - Chat-native catalog administration and Mini App removal

- Outcome: Terra implemented typed, durable Telegram administration for categories, products,
  variants, templates, storefront/payment settings, archive/restore, provider-group selection,
  preview and revision-checked publication. The administrator Mini App package, `/console/`, private
  admin catalog API, WebApp buttons, token/configuration, and deploy/build surfaces were removed.
  Luna independently verified both the chat flow corrections and removal boundary; Sol accepted the
  architecture and recorded ADR 0012. Models used were Terra writer, Luna verifier and Sol close;
  no fallback occurred.
- Validation: build, typecheck, lint, formatting, architecture, dead-code and unit suites pass
  locally; PostgreSQL integration is `8/8`. Under explicit owner authorization, Sol backed up source,
  env and database to `/var/backups/neo_bot/chat-admin-20260822T155535Z`, synchronized the approved
  workspace, removed the retired server package, and rebuilt/recreated `bot-api` plus Caddy. Public
  health is `ok` with `telegramReady=true`, `migrations=9`, zero report backlog, three running
  services, three new catalog-admin tables, `PILOT_ENABLED=false`, and public `/console/` plus
  `/admin/catalog` both `404`. Cursor tooling was subsequently removed by owner direction. The readiness
  probe was signed and synthetic; live phone UX and a real catalog publication remain unproven.
- Next: owner opens «مدیریت فروشگاه» in the bot and validates the complete phone flow before any real
  purchase or PasarGuard mutation.

### 2026-08-22 - NEO NETWORK first-host activation

- Outcome: after explicit owner authorization, Sol deployed only the four Bot API source files and
  three approved brand assets to first-host, privately uploaded the welcome and delivery images to
  the configured administrator, atomically configured their Telegram photo IDs, built the new image,
  and force-recreated only `bot-api`. Terra prepared the deployment packet but could not obtain its
  own SSH escalation, so Sol performed the production operation; no model substitution occurred.
- Validation: all seven remote source hashes match local. The container became healthy; loopback and
  public HTTPS health are `ok` with `telegramReady=true`, `migrations=8`, and report queues at zero.
  Runtime media booleans are true, `PILOT_ENABLED=false`, and webhook info is set with zero pending
  updates. The fresh webhook last-error timestamp occurred during the controlled recreate and had no
  synchronization error. Root-only rollback snapshot
  `/var/backups/neo_bot/brand-20260822T132238Z` and image tag
  `neo-bot-brand-pre:20260822T132238Z` remain available. No database, Postgres, Caddy, purchase,
  receipt, provisioning or renewal mutation was performed.
- Next: owner confirms `/start`, non-repeating «منوی اصلی», fast purchase and selection-guide copy on
  a phone; successful-delivery media remains unproven until a separately authorized real order.

### 2026-08-22 - NEO NETWORK customer journey and visual identity

- Outcome: Terra implemented the approved `NN / NEO NETWORK / PRIVATE ACCESS` customer identity,
  ingested the master/welcome/delivery PNGs, added optional fail-open Telegram media, separated fast
  purchase from a practical selection guide, softened username copy, changed displayed prices to
  Toman-only, added the owner-approved 60-minute receipt copy, and changed renewal to preview plus
  explicit confirmation. No live Telegram or provider action was performed.
- Validation: Luna found and Terra fixed one P2 that repeated welcome art for text «منوی اصلی»;
  independent re-verification found no remaining issue. Bot API tests pass (`89`), Bot API typecheck
  and `git diff --check` pass, and the archived `.cursor` status entries are unchanged. Used Terra
  writer and Luna verifier with no model fallback. Real Telegram file IDs, phone UX, live receipt,
  delivery and PasarGuard renewal remain unproven.
- Next: implement durable in-bot support tickets and receipt-SLA tracking; then obtain separate owner
  authorization for Telegram asset upload, runtime configuration, deployment and phone validation.

### 2026-08-22 - Codex-only execution governance

- Outcome: owner deactivated Cursor tooling after high token overhead; Codex-only governance is
  active with the preferred Sol supervisor, Luna/Terra execution roles, one-writer/two-subagent
  limit, dirty-worktree preservation, fallback disclosure, and Sol-only close authority. Independent
  verification findings, including the `0008` migration map entry, were revised without changing
  Cursor artifacts.
- Validation: Luna independently verified the governance contract and unchanged hashes for all ten
  archived `.cursor` files. Sol stamped the context, and `pnpm check` passed context validation,
  build, typecheck, lint, formatting, architecture, and all unit suites.
- Next: use the Codex-only flow for Telegram intake isolation; do not reactivate Cursor or perform a
  live Telegram change without separate owner authorization.

### 2026-08-22 - First-host deploy and independent verification

- Outcome: deployed the chat copy + admin mini-app + username-base flow to first-host via the existing
  rsync + `docker compose.production.yml` rebuild flow; independent verifier confirmed deployment state.
- Validation: first-host loopback and public HTTPS `GET /health` both report `status=ok`,
  `telegramReady=true`, and `migrations=8`. `schema_migrations` contains `0008`, and
  `sales_orders.service_username_base` exists.
- Next: owner runs phone validation for full chat path (shop -> username prompt -> checkout -> receipt),
  then resume reseller-facing admin pricing UI.

### 2026-08-22 - Chat-sales copy polish and username base flow

- Outcome: polished customer-facing purchase copy across Telegram shop/category/variant screens and kept
  one-row plan listing plus callback-aligned back labels. Added purchase-time username base input with
  strict validation (`[a-z0-9_-]` only, no `@`/space), persisted on order, and provisioning-time generation
  as `baseName_random4` with bounded retry on username collisions.
- Validation: `pnpm --filter @neo-bot/application test` (`41`), `pnpm --filter @neo-bot/bot-api test`
  (`83`), `pnpm --filter @neo-bot/catalog-admin test` (`4`), full `pnpm check` pass, and `graphify update .`.
- Next: owner validates chat UX and username prompt on phone; then run authorized runtime migration `0008`
  and continue reseller admin pricing UI.

### 2026-08-22 - Product-flow copy polish for customer chat

- Outcome: customer-facing product copy in Telegram shop/category/variant screens was rewritten with a
  cleaner professional tone, clearer CTAs, and explicit missing-category guidance. Shop-back labels now
  match callback destination (`shop`) in variant and missing-category flows.
- Validation: bot-api targeted specs passed: `src/telegram-menu.spec.ts` and
  `src/telegram-commerce-bot.spec.ts` (`29` tests), including category single-row plan layout and new
  checks for missing-category and variant-detail action rows. `graphify update .` refreshed project map.
- Next: owner verifies the new copy and button clarity on phone, then we continue reseller admin pricing UI.

### 2026-08-22 - Single-row plan buttons in category view

- Outcome: in Telegram category screens, plan buttons are now rendered one-per-row (single-column) while
  subcategory buttons remain paired and footer navigation stays intact. This addresses the owner UX
  request from live screenshot feedback.
- Validation: `apps/bot-api/src/telegram-commerce-bot.spec.ts` expanded to `26` passing tests, including
  a new assertion that two plans appear as two single-button rows; local run via workspace fallback pnpm.
- Next: owner verifies the new row layout on phone, then we continue reseller admin pricing UI.

### 2026-08-22 - Admin catalog delete persistence and customer plan labels

- Outcome: catalog replacement no longer revives removed products in admin flows. On publish, previous
  admin-managed products/categories are archived out of the managed set, and inactive leftover variants
  are excluded from admin/public reads, so delete+add+save and variant removal behave as expected after
  reload. Customer shop variant rows are now denser and clearer with price-first compact labels, and
  variant detail copy is cleaner.
- Validation: bot-api unit tests for menu and commerce flow passed (`src/telegram-menu.spec.ts`,
  `src/telegram-commerce-bot.spec.ts`). Database integration test update added for replace-after-delete
  behavior; execution is blocked in this environment because Testcontainers runtime is unavailable.
- Next: owner verifies `/console/` delete+add+save on host and confirms improved plan readability in chat;
  then resume reseller admin pricing UI.

### 2026-08-22 - Representative assignment and price audit

- Outcome: commerce repository now lists representatives, assigns a customer by Telegram id, and
  lists current representative prices with override/base/public source. Public shop listing is
  unchanged. No wallet, debt, or admin price UI. `PILOT_ENABLED` stayed false.
- Validation: database integration tests `6`, including assignment plus override audit. Targeted
  `pnpm --filter @neo-bot/database test:integration`.
- Next: owner publishes a sellable variant and completes one chat purchase. Reseller admin UI and
  `reseller.*` notices are later.

### 2026-08-22 - Representative listing and checkout pricing

- Outcome: public shop still uses `product_variants.price_irr`. An active representative sees only
  granted variants. Checkout snapshots override, else base, else public, and stores `pricing_source`
  plus `representative_id`. ADR 0011. No wallet, assignment, or admin price UI. `PILOT_ENABLED`
  stayed false.
- Validation: domain tests `10`, application `32`, bot-api `77`, database integration `5`.
  `pnpm check` after this slice. Live databases still need an authorized migrate for `0007`.
- Next: owner publishes a sellable variant and completes one chat purchase. Reseller admin UI and
  `reseller.*` notices are later.

### 2026-08-22 - Production-reseller scaffold (work in progress)

- Outcome: started a production+reseller foundation slice: domain types now include representative-aware pricing source on variants/orders, Commerce use case paths for representative-scoped listing/checkout were introduced, `telegram-commerce-bot` category/variant rendering now routes through customer-scoped variant reads, and migration `0007_reseller_pricing_and_ops.sql` was added for representatives, representative variant access, base pricing, and per-representative override pricing plus reseller reporting event types.
- Next: finish repository/controller wiring and verification gates before enabling representative flows in runtime.

### 2026-08-22 - Hybrid admin plan management

- Outcome: implemented the hybrid admin flow from `admin-plan-config-hybrid`: catalog-admin now hides low-value fields from the main path, adds a 3-step wizard for category+plan creation, and keeps fast edit cards focused on core plan fields. Telegram admin hub now includes `مدیریت سریع پلن` with in-chat quick operations for selecting a plan, editing price/volume/days/devices, toggling sellable state, instant publish, and quick copy.
- Validation: `pnpm --filter @neo-bot/catalog-admin test`, `pnpm --filter @neo-bot/bot-api test`.
- Next: owner validates the new `/console/` wizard and quick chat operations on phone, then publishes and edits one real plan end-to-end.

### 2026-08-22 - Phased UX polish for chat and Mini App

- Outcome: catalog-admin quick wins landed (textarea for long copy fields, stronger mobile
  scroll-safe spacing, clearer sticky save state, and split sections into `CatalogSettingsPanel`
  plus `StickySaveBar`). Customer Mini App removed the dead-end payment screen and now closes
  directly back to chat from plan details. Bot chat flow now keeps post-checkout and post-reject
  actions explicit with `پیگیری سفارش` CTAs, richer order-state copy, shorter admin queue labels,
  and less admin `/start` spam.
- Validation: `pnpm --filter @neo-bot/catalog-admin test`, `pnpm --filter admin-web test`,
  `pnpm --filter @neo-bot/bot-api test`, then full `pnpm check`.
- Next: owner live-checks `/console/` and Telegram chat on phone for copy clarity and tap count.

### 2026-08-22 - Catalog console Mini App scroll and zoom

- Outcome: catalog-admin Mini App uses a single visual-viewport frame, inner form scroll, 16px
  inputs, locked scale, and disabled Telegram vertical swipes so focusing a field no longer zooms
  the page away from the field or stacks columns on top of each other.
- Validation: catalog-admin tests `4`. `pnpm check` after this slice. Live `/console/` still serves
  the previous build until an authorized host catalog-admin rebuild.
- Next: owner reloads the catalog console after that rebuild, then publishes a sellable variant.

### 2026-08-22 - Chat-first customer store

- Outcome: customer purchase is chat-only. The Telegram menu button is commands, not a shop WebApp.
  `POST /customer/orders` and `POST /customer/renew` return gone. Catalog console Mini App stays.
  ADR 0008 amended. `PILOT_ENABLED` stayed false.
- Validation: in-repo `pnpm check` after this slice. Live chat purchase still outstanding.
- Next: owner publishes a sellable variant from `/console/`, then buys and sends a receipt in chat.

### 2026-08-22 - Synced PasarGuard groups for catalog console

- Outcome: catalog console showed no PasarGuard group checkboxes because `provider_groups` was empty.
  Host `pilot sync-groups` listed panel groups into Postgres. `PILOT_ENABLED` stayed false. No user
  create or seed-variant.
- Validation: group rows `5`, selectable `5`, provider instance `1`. Console Mini App must be reloaded.
- Next: owner reloads `/console/`, ticks a prepared group, then save-and-publish.

### 2026-08-22 - Stopped local polling that stole the host webhook

- Outcome: a local `bot-api` `tsx watch` was still running with `TELEGRAM_ENABLED=true` and no Mini
  App, public host, or webhook URL. `pnpm check` rebuilt packages, the watcher restarted, and that
  process deleted the host webhook. Local polling was stopped. Host `bot-api` was restarted so
  Telegram intake is webhook again. `PILOT_ENABLED` stayed false.
- Validation: local poller PIDs gone. Host `GET /health` status ok, `telegram` webhook,
  `telegramReady` true, Mini App origin present, console path `/console/`.
- Next: owner `/start` on the live bot; missing Mini App address copy should not appear.

### 2026-08-22 - Mini App origin fallback and cheaper agent rules

- Outcome: `bot-api` derives the Mini App/console HTTPS origin from `TELEGRAM_MINI_APP_URL`, else
  the webhook origin, else `TELEGRAM_PUBLIC_HOST`. ADR 0008 notes that origin is the public host,
  not a separately omitable env key. Cursor graphify/session/efficiency rules treat owner Telegram
  copy as P0. Unused marketplace plugins stay uninstalled. `PILOT_ENABLED` stayed false.
- Validation: bot-api tests `74`. Host env flags `hasMini`/`hasPublicHost`/`hasWebhook` true.
  Recreated `bot-api`; `GET /health` status ok, `telegramReady` true, in-process Mini App origin
  present with console path `/console/`. A later local poller deleted the webhook until it was
  stopped and the host process restarted.
- Next: owner `/start` and tap the catalog console opener, then publish a sellable variant.

### 2026-08-22 - Host PasarGuard URL and API key from local env

- Outcome: first-host `.env` had placeholder PasarGuard values from install. The live panel URL and
  API key were copied from the local untracked `.env` onto the host, then `bot-api` was recreated.
  `PILOT_ENABLED` stayed false. Values were not printed or committed.
- Validation: host `GET /health` status ok. In-container panel health returned ok. Catalog still
  empty.
- Next: owner opens the catalog console Mini App from `/start` and publishes a sellable variant.

### 2026-08-22 - Catalog console opens from a dedicated Mini App message

- Outcome: home and admin hub always show «کنسول کاتالوگ» as a normal callback. That sends a new
  message with a single Mini App button so Telegram cannot hide it inside an edited mixed keyboard.
  Empty shop for admins has the same callback. Reply-keyboard Mini App remains as a second path.
  Temporary debug ingest logs were removed.
- Validation: bot-api tests `72` for the dedicated opener. Live Telegram open still needs `/start`
  after host rebuild.
- Next: owner taps «کنسول کاتالوگ» then «باز کردن کنسول کاتالوگ», publishes a sellable variant.

### 2026-08-22 - Admin catalog console on the reply keyboard

- Outcome: with Mini App URL set, the admin hub still includes an inline console WebApp row, and
  opening the hub also pins «کنسول کاتالوگ» on the persistent bottom keyboard so the editor is not
  only a mixed inline button. Catalog-admin production assets stay under `/console/`. Temporary
  redacted debug logs remain in `bot-api` until the owner confirms the console opens.
- Validation: bot-api tests `72`. Host `GET /health` status ok after `bot-api` rebuild. Host catalog
  product count `0`. Owner has not yet confirmed the Telegram console WebApp.
- Next: owner opens the bottom-keyboard console, publishes a sellable variant, then Mini App
  purchase.

### 2026-08-22 - Catalog console assets under `/console/`

- Outcome: catalog-admin production build uses Vite `base` `/console/` so JS/CSS are not swallowed
  by the Mini App SPA fallback at `/assets/`. Console HTML also loads the Telegram Web App script.
- Validation: host wget of the console module URL returned `text/javascript`. Public catalog product
  count was `0`; shop without initData returned `401`. Live Telegram console login still needs the
  owner to open the admin hub WebApp button.
- Next: owner publishes at least one sellable variant from `/console/`, then Mini App shop.

### 2026-08-22 - Mini App Telegram initData and shop error copy

- Outcome: Mini App loads the official Telegram Web App script, reads `initData` from the SDK or
  `tgWebAppData` hash, and tints Telegram chrome to the shop navy. Shop copy no longer treats a
  missing identity, an empty catalog, and a failed fetch as the same line. Help stays reachable.
- Validation: Mini App tests `5`. `pnpm check` passed. Host Mini App dist includes the Telegram
  script; `GET /health` returned status ok. Live purchase still outstanding.
- Next: owner opens Mini App from the Telegram menu button.

### 2026-08-22 - Customer Mini App shop, orders, renew, help

- Outcome: Mini App home matches the chat journey (shop with nested categories, open order, renew,
  help). Checkout POSTs only after confirm. Customer shop/renew APIs use `initData` and never return
  subscription URLs. Phone chrome is CSS-hidden unless `?preview=1`; locked runtime files unchanged.
- Validation: application tests `26`, bot-api tests `71`, Mini App copy tests `4`. `pnpm check`
  passed. Host Mini App dist was copied and `bot-api` rebuilt; `GET /health` returned status ok.
  Live Telegram Mini App purchase is not evidenced.
- Next: owner opens Mini App from Telegram, completes one checkout, and sends a receipt photo in
  the private chat.

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
