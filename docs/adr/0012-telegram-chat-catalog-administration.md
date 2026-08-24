# ADR 0012: Telegram chat catalog administration

- Status: accepted
- Date: 2026-08-22
- Supersedes: the administrator Mini App portion of ADR 0008

## Context

The browser catalog console duplicated Telegram administration, introduced a second authentication
surface, and required separate assets, routing, configuration, and deployment. The owner requires
all routine catalog management to be usable from the bot's private administrator chat while the
customer purchase journey remains unchanged.

## Decision

- Catalog administration is available only in a private chat whose numeric user ID is allowlisted by
  `TELEGRAM_ADMIN_IDS`.
- The chat uses typed category, product, variant, settings, archive, and restore commands through
  `CatalogChatAdministrationUseCase`; the bot does not execute SQL.
- Each administrator has at most one durable 24-hour wizard session. Drafts do not affect the
  customer catalog until explicit review and publish.
- Publish performs revision compare-and-swap, provider-group validation, mutation, revision advance,
  session completion, and a redacted audit entry in one database transaction. Replayed confirmation
  is idempotent.
- Category, product, and variant codes are server-generated and immutable. Prices are entered in
  Toman and persisted in Rial. Provider identifiers and group IDs are never shown in chat.
- Archive replaces hard delete. Restore never makes a variant sellable; selling requires a separate
  reviewed action.
- Card input is deleted from chat on a best-effort basis after persistence. Logs, previews, and audit
  records contain only a masked card number.
- The `apps/catalog-admin` package, administrator catalog HTTP endpoints, WebApp button, `/console/`
  route, and their environment/deployment settings are removed. Public customer catalog access and
  `apps/admin-web` remain.

## Consequences

- Administration is restart-safe and uses the same numeric Telegram authorization boundary as other
  operator actions.
- Concurrent administrators receive a revision conflict and must review the current catalog before
  publishing again.
- PasarGuard group status is checked again at publish time; an inactive or expired binding prevents
  publication without a partial catalog mutation.
- Migration `0009_catalog_chat_admin_core.sql` must be applied before the chat administration flow is
  used on a deployed environment.
- Live deployment, migration, and PasarGuard mutations remain separately controlled operational
  actions.
