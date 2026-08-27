# ADR 0014: Role-aware commerce and paid service operations

- Status: Accepted
- Date: 2026-08-25

## Context

The deployed Telegram store has a customer purchase path and chat-native catalog administration,
but its renewal action bypasses ordering and payment, provisioning does not persist the generated
remote username candidate before the HTTP mutation, and the pilot flag does not gate Telegram
runtime mutations. Representative pricing primitives also exist without a representative customer
workspace, wallet, or tenant boundary.

The owner approved a chat-only revival focused on reliable revenue and operations rather than raw
feature count. The public AGPL MirzaBot repository was reviewed only as clean-room product evidence;
no implementation, schema, copy, callback, asset, or generated output may enter this repository.

## Decision

- One Telegram bot provides separate role-aware homes for direct customers, staff, and
  representatives. Reply keyboards are home navigation; inline keyboards are contextual actions.
- Purchase, renewal, volume top-up, and controlled upgrade are paid order kinds. No provider
  mutation may occur before an approved payment or captured representative-wallet hold.
- Order state and payment-attempt state are separate. Manual card-to-card proof is the first payment
  adapter; future signed, idempotent providers must enter through the same application boundary.
- Buyer, beneficiary, operator, sales channel, and managed-service owner are distinct concepts.
- A provisioning operation persists its stable remote identity candidate before the HTTP call and
  reconciles ambiguous outcomes before retry or refund.
- Runtime mutation uses an explicit `disabled`, `isolated`, or `live` mode. A false legacy pilot flag
  must never imply that live Telegram mutation is disabled.
- Staff authorization is permission-based with owner, finance, support, catalog, and operations
  presets. Sensitive financial actions can require a second owner approval.
- Representatives use a non-negative prepaid wallet and an append-only ledger. They manage only
  their own locally identified customers and services; final retail price remains outside NEO.
- The retained customer web prototype is removed only after proving it has no live consumer. No
  catalog or customer Mini App replaces the chat experience in this roadmap.
- Fulfilled-order customer delivery is a durable local job. It stores references and redacted retry
  state, resolves the subscription URL only at dispatch time, and uses a monotonic claim version to
  fence stale workers. A crash may duplicate a non-secret placeholder, but only the canonical
  claimed Telegram message may receive the subscription URL.
- Customer-delivery wake-up is independent from operator-report scheduling. Disabling the timed
  report dispatcher preserves webhook-only report behavior but cannot strand a fulfilled order.
- A reporting or Telegram failure after local fulfillment never rewrites the order as a provisioning
  failure and never triggers provider mutation. Replayed approval or retry publishes the same
  idempotent success occurrence and resumes only durable delivery.

Implementation is delivered in four independently reversible slices: mutation safety, customer
service lifecycle, staff control plane, and representative workspace.

## Consequences

- Existing orders and services require additive, backward-compatible migrations and explicit
  snapshots; destructive live migrations are not permitted in the initial rollout.
- Every local queue, financial claim, wallet hold, and callback requires concurrency and replay
  tests. Database transactions remain short and never cross Telegram or PasarGuard HTTP calls.
- The current manual card-to-card flow remains a recorded Telegram platform-compliance risk until a
  separately reviewed payment channel is adopted.
- Marketing features, bulk reseller creation, white-label bots, automated bank-message matching,
  and multi-provider expansion remain outside the four core slices.
