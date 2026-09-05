# ADR 0021: Durable customer interaction kernel

## Status

Accepted

## Context

Customer purchase naming lived in an in-process `Map` on `TelegramCommerceBot`. A process
restart dropped that state, so the next text could be treated as an unrelated message or a
later retry could create a second checkout. Later customer inputs (purchase/renewal discount,
wallet top-up, ticket draft) have the same restart and duplicate-mutation risk.

Catalog administration already persists a versioned wizard session. Customer flows need the
same durability without storing ticket bodies, subscription URLs, or other secrets in
long-lived session history.

## Decision

- Customer multi-step input is owned by a `ConversationFlowHandler` registry in
  `apps/bot-api/src/interaction/`.
- Session state is versioned, expirable, and persisted (PostgreSQL in production; an
  in-memory store is only for tests).
- Session payloads are redacted: ticket body is written only through the idempotent ticket
  use case keyed by Telegram update ID.
- Home and Cancel always release the active customer session.
- Expired or malformed sessions recover without consuming later unrelated text as input.
- Checkout, renewal, wallet credit, and ticket writes remain in application use cases.
  Wallet credits are append-only and non-negative. Duplicate Telegram updates replay the
  same ledger or ticket row.

## Consequences

- `TelegramCommerceBot` no longer keeps customer input Maps.
- Migration `0014` adds conversation sessions, optional discount codes, a prepaid wallet
  ledger, and support tickets. Those tables are local until an authorized migrate.
- Purchase and renewal now collect an optional discount code before the authoritative
  order write. Unknown codes are rejected; skip remains valid.
- This ADR does not authorize production migrate, Telegram send, or PasarGuard mutation.
