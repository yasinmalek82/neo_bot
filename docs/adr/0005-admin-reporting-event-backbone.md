# ADR 0005: Admin reporting event backbone

- Status: accepted
- Date: 2026-08-21

## Context

Operators need a private Telegram forum group as a control and reporting center. The current bot
sends receipt photos to administrator private chats. That action path is not a durable, restart-safe
reporting system, and `/start` does not persist first contact.

Report delivery can retry, restart, or race with Telegram. Duplicate business actions are already
forbidden; duplicate operator notices are acceptable only when a crash happens after Telegram has
accepted a message and before the delivery row is marked delivered.

## Decision

The owner creates the private forum group and enables Topics. Stable purpose-to-`message_thread_id`
mappings are stored in the application. Topic creation for missing purposes is defined by
`docs/adr/0006-bot-provisioned-reporting-forum-topics.md`. The bot still does not rename, close or
delete topics. Missing, deleted or unmapped topics fail delivery with an operator-visible error code
and do not retry as if the business action had failed.

Application-layer events own reporting. `packages/domain` stays free of forum, outbox and Telegram
thread concepts. Use cases record a redacted event with a deterministic occurrence key immediately
after the business write commits. Delivery is a separate outbox step: a short database claim, then
an HTTP send, then an acknowledgement. No database transaction stays open across Telegram.

Event payloads may include numeric Telegram user IDs, order IDs, product names, amounts and error
codes. They must not include subscription URLs, API keys, bot tokens, card numbers, receipt file
IDs, usernames or raw bank text. Receipt images remain on the existing administrator private-chat
review path; the receipts topic receives a text summary only.

Delivery is at-least-once for a given event and destination. The occurrence key and the unique
event-destination delivery row prevent duplicate event records and duplicate in-flight claims after
restart. Transient Telegram failures stay pending with backoff. Exhausted or permanent routing
failures are stored as failed and do not reverse checkout, approval or provisioning.

## Consequences

- `/start` and other customer mutations can distinguish a first contact from later activity.
- Mini App and chat flows can share the same event recorder later.
- An administrator can change the group chat ID without a bot code change; missing topics are
  created on the next start.
- A crash after Telegram accepts a report may produce one duplicate notice, never a duplicate order
  or PasarGuard user.
- An in-process idle dispatcher flushes pending deliveries even when webhook traffic is idle. A
  separate worker process remains a later slice.
- Daily summaries and reseller events remain later slices.
