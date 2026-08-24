# ADR 0008: Catalog card source and Telegram Mini App identity

- Status: superseded by ADR 0012 on 2026-08-22
- Date: 2026-08-21

## Context

ADR 0003 kept card-to-card details in Telegram runtime configuration. ADR 0004 made the published
storefront catalog the source of truth for sellable products. Those two sources drifted. Catalog
administration also needed a verified Telegram identity without copying Bot API secrets into
`packages/domain`.

A later slice put customer checkout in a Mini App while receipts stayed Telegram files. That split
the purchase: the customer closed a plan in WebApp and had to return to chat to send the photo.
Card-to-card in this bot cannot finish inside a Mini App without object storage.

## Decision

- The customer store is the private Telegram chat: shop, card details, receipt photo, tracking, and
  renewal. The chat menu button is commands, not a customer WebApp.
- Mini App `/console/` is administrator-only catalog publishing. Production console requests
  authenticate with Bot API `initData` HMAC (`WebAppData`) and numeric administrator `user.id`.
  Development catalog-admin may keep the bearer test token.
- Card number and holder are stored only in published `storefront_settings`. The chat bot reads them
  after customer identity is established. Public `GET /catalog` omits them.
- Receipts are Telegram photo (or image document) file IDs on the order. This MVP does not upload
  receipts through HTTP.
- `bot-api` still derives a public HTTPS origin from `TELEGRAM_MINI_APP_URL`, else the origin of
  `TELEGRAM_WEBHOOK_URL`, else `https://` plus `TELEGRAM_PUBLIC_HOST`. That origin is for `/console/`
  only. It is not a customer shop.

## Consequences

- Telegram env no longer requires card fields.
- Customers never leave chat to pay or send a receipt.
- Production catalog-admin must be opened from an administrator Telegram account.
- Catalog-admin static files may be served at `/console/` on the public host. The SPA calls
  `/admin/catalog` same-origin when it is not on loopback. `/admin` stays the API.
- Customer Mini App static files may still be served at `/` by Caddy. They are not the store. HTTP
  `POST /customer/orders` and `POST /customer/renew` are gone.
- Missing-console copy is only for a process with no public HTTPS origin at all.

## Supersession

ADR 0012 removes the administrator Mini App, its private HTTP API, and the `/console/` deployment
surface. The card source-of-truth and chat-first customer decisions above remain in force; catalog
administration now runs only in authorized private Telegram chats.
