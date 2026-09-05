# Security

This file records the in-repository threat model for the first trustworthy single-owner MVP. It is
not a claim that production is ready.

## Assets

- Telegram bot token, webhook secret and PasarGuard API key
- Card-to-card number and holder name
- Customer Telegram numeric IDs, orders, and receipt file identifiers
- PasarGuard subscription URLs after provisioning

## Trust boundaries

- Public: `GET /health`, `GET /catalog` (no card numbers, no provider codes)
- Telegram: webhook or local `getUpdates`, verified by secret or Bot API
- Administrator catalog management: private Telegram chat and allowlisted numeric administrator IDs
- Operator forum: redacted text only; no subscription URLs, tokens, card numbers, or file IDs

## Controls

- No logging of tokens, subscription URLs, raw initData, receipt file IDs, or card numbers.
  `SafeLogger` redacts those shapes from stdout. HTTP exceptions return allowlisted codes only.
- Published catalog is the only card source; public catalog responses omit payment details
- Customer checkout shares `CommerceUseCase` in the private chat; receipt photos stay Telegram files.
  `POST /customer/orders` and `POST /customer/renew` are gone.
- Rate limit and 1 MiB body limit on the HTTP adapter; CORS limited to `WEB_ORIGINS`.
  Health and `POST /telegram/webhook` are excluded from the IP rate limit so Telegram retries are
  not dropped.
- Invalid Telegram updates are completed without a 500 so a poison payload cannot stall intake.
- Receipt images are not stored in this API; later upload endpoints must cap size and type
- `GET /health` may include report-queue counts, a migration count, `telegramReady`, and an
  allowlisted Telegram error code. It must not include tokens, descriptions, file IDs, or dump
  paths. Backup dumps stay off git; restore requires an explicit confirmation environment
  variable; `pnpm db:restore-drill` uses a disposable Postgres on loopback

## Residual risk

- Public HTTPS webhook, off-host backup storage, and a live restore onto the
  production volume are still required before production. In-repo secret-rotation steps are in
  `docs/runbooks/secret-rotation.md`; they are not a completed live rotation.
- CI fails on high-severity `pnpm audit` findings. Transitive `fast-uri` is pinned in
  `pnpm-workspace.yaml` to patched 3.1.6 / 4.1.3. One moderate `uuid` advisory remains in the
  Testcontainers development tree and is not a runtime dependency of `bot-api`.
