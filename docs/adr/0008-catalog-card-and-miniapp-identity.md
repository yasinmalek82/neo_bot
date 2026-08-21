# ADR 0008: Catalog card source and Telegram Mini App identity

- Status: accepted
- Date: 2026-08-21

## Context

ADR 0003 kept card-to-card details in Telegram runtime configuration. ADR 0004 made the published
storefront catalog the source of truth for sellable products. Those two sources drifted. Mini App
checkout also needed a verified Telegram identity without copying Bot API secrets into `packages/domain`.

## Decision

- Card number and holder are stored only in published `storefront_settings`. The chat bot and Mini App
  read them after customer identity is established. Public `GET /catalog` omits them.
- Mini App and catalog-admin production requests authenticate with Bot API `initData` HMAC
  (`WebAppData`) and numeric `user.id`. Development catalog-admin may keep the bearer test token.
- Customer Mini App orders share `CommerceUseCase` with the private chat. Receipt photos stay in the
  bot chat; this slice does not add file upload.

## Consequences

- Telegram env no longer requires card fields.
- Forged `initData` cannot read another customer's open order.
- Production catalog-admin must be opened from an administrator Telegram account.
