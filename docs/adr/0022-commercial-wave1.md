# ADR 0022: Commercial Wave 1 (trial, channel gate, reminders, broadcast)

- Status: accepted
- Date: 2026-09-05

## Context

An Iranian Telegram VPN shop needs the competitor must-haves that `neo_bot` still lacked:
one free trial per customer, forced channel join, expiry/low-traffic reminders,
customer service deliverability, and an admin broadcast. Card-to-card plus wallet stay
the only payment rails. PasarGuard stays the only panel. Live provision remains gated.

## Decision

- Commercial operator settings live in a singleton `storefront_ops_settings` row, not in
  the published catalog snapshot, so catalog publish cannot wipe trial or channel config.
- A trial is a write-once `customer_trial_claims` row plus a `sales_orders.order_kind = 'trial'`
  record with `amount_irr = 0`. The designated catalog variant supplies duration, traffic,
  device limit and PasarGuard groups. Repeats are refused idempotently. Fulfillment reuses
  the paid create path (order-scoped idempotency, numeric remote user id, no DB transaction
  across network I/O). Provisioning still honors `PROVISIONING_MODE` / `PILOT_ENABLED`.
- Forced join is an allowlisted list of channel chat IDs and optional public usernames.
  Shop, trial and checkout check Telegram membership and fail closed on API errors.
  Allowlisted administrators bypass. Join uses a public username URL when one exists.
- Expiry and low-traffic notices are durable `service_reminder_deliveries` claimed like the
  reporting outbox. Copy is Persian and never includes a subscription URL. Shop-blocked
  customers are skipped. Low-traffic requires a known `used_traffic_bytes`; unknown usage
  skips that kind instead of guessing.
- «سرویس‌های من» lists local fulfilled bindings. Access-link resend and QR happen at
  dispatch time from persisted service rows. URLs stay out of jobs, reports and logs.
- Admin broadcast is an outbox job with queued recipients, rate-limited dispatch and
  cancel. The body is persisted for sending but reports and debug logs may store only a
  hash and counts.
- `customers.shop_blocked` refuses shop, trial, checkout and renewal. Tickets and existing
  service access remain available. Reminders and broadcasts skip blocked customers.

## Consequences

- Migration `0015` is local until an authorized migrate.
- Wave 1 does not add Zarinpal, crypto, Marzban, or representative-wallet completion.
- Live Telegram, live PasarGuard mutation and production deploy stay owner-only gates.
