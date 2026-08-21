# Security

This file records the in-repository threat model for the first trustworthy single-owner MVP. It is
not a claim that production is ready.

## Assets

- Telegram bot token, webhook secret, PasarGuard API key, catalog admin token
- Card-to-card number and holder name
- Customer Telegram numeric IDs, orders, and receipt file identifiers
- PasarGuard subscription URLs after provisioning

## Trust boundaries

- Public: `GET /health`, `GET /catalog` (no card numbers, no provider codes)
- Telegram: webhook or local `getUpdates`, verified by secret or Bot API
- Mini App: `X-Telegram-Init-Data` HMAC (`WebAppData`) and numeric `user.id`
- Catalog admin: development Bearer token, or verified Mini App init data for administrators
- Operator forum: redacted text only; no subscription URLs, tokens, card numbers, or file IDs

## Controls

- No logging of tokens, subscription URLs, raw initData, receipt file IDs, or card numbers
- Published catalog is the only card source; public catalog responses omit payment details
- Mini App checkout shares `CommerceUseCase` with the chat bot; receipt photos stay in the private bot chat
- Rate limit and 1 MiB body limit on the HTTP adapter; CORS limited to `WEB_ORIGINS`.
  Health and `POST /telegram/webhook` are excluded from the IP rate limit so Telegram retries are
  not dropped.
- Invalid Telegram updates are completed without a 500 so a poison payload cannot stall intake.
- Receipt images are not stored in this API; later upload endpoints must cap size and type

## Residual risk

- Public HTTPS webhook, secret rotation, backup restore, and a repository security scan are still
  required before production
- The development admin Bearer token must never be reused in deployment
