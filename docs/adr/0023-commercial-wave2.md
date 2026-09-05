# ADR 0023: Commercial Wave 2 (usage sync, referral, sales snapshot)

- Status: accepted
- Date: 2026-09-05

## Context

Wave 1 shipped expiry reminders and a low-traffic reminder that only fires when
`services.used_traffic_bytes` is known. That column stayed null because nothing
read PasarGuard usage. The Iranian shop also needs a personal invite path and a
Postgres-only sales snapshot in admin chat. Card-to-card plus wallet stay the
only payment rails. PasarGuard stays the only panel.

## Decision

- `UsageSyncUseCase` performs a read-only `getUserById` against PasarGuard and
  writes only `used_traffic_bytes` plus `usage_synced_at`. It never changes
  expiry, data limit, groups, or other entitlements. The HTTP read happens
  outside any database transaction. Tests and CI inject a mock or omit the
  reader so no live panel call runs. A missing remote user still advances
  `usage_synced_at` so the worker does not hammer the same target.
- Referral uses a personal Telegram start payload `r{telegramUserId}`.
  Attribution is write-once, refuses self-referral, and requires the referrer
  to already exist. A durable `referral_rewards` row plus an optional wallet
  ledger `kind=referral` is granted on the first successful **paid** fulfillment
  (`purchase` or `renewal` with `amount_irr > 0`). Trial-only fulfillment never
  rewards. One reward per referred customer. A per-referrer cap and a
  shop-blocked referrer yield a zero-credit marker so retries stay idempotent.
  An optional invitee discount may reduce the first paid purchase amount while
  keeping `amount_irr > 0`.
- Admin sales snapshot is a private-chat Postgres query for today and the last
  seven calendar days in `Asia/Tehran`: orders by status, approximate fulfilled
  revenue, new customers, open tickets, and pending receipt reviews. It does
  not call Telegram or PasarGuard.

## Consequences

- Migration `0016` is local until an authorized migrate.
- Low-traffic reminders become actionable only after usage sync has populated
  traffic on active services.
- Wave 2 does not add payment gateways, multi-panel, live provision, or deploy.
