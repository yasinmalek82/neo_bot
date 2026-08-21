# ADR 0003: Card-to-card order lifecycle

## Status

Accepted for the first commerce slice.

## Decision

The customer journey is represented by a durable order state machine:

`awaiting_receipt → receipt_submitted → provisioning → fulfilled`

A rejected receipt may be submitted again. A definite or ambiguous provisioning failure is stored as
`provisioning_failed` and retried with the same order-scoped idempotency key. Starting a different
checkout cancels only an earlier unpaid or rejected order; it never replaces an order under review.

Prices are snapshotted in IRR on the order. Card details remain runtime configuration and are not
copied into orders. Telegram receipt file references are stored for administrator review but must not
be logged. Raw bank SMS text is not accepted or persisted.

## Consequences

- A customer can have only one open order at a time.
- Telegram retries cannot create duplicate orders or duplicate PasarGuard users.
- No database transaction remains open while Telegram or PasarGuard is called.
- Administrator approval is auditable by numeric Telegram user ID.
- The future Mini App and Telegram chat share the same application use case and order records.
