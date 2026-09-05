# ADR 0025: Representative pricing administration in Telegram

- Status: Accepted
- Date: 2026-09-05
- Deciders: neo_bot owner

## Context

Representative access and pricing are already persisted by the commerce schema and their precedence is
fixed by ADR 0011. Wave 4 needs an owner-admin surface without introducing a second panel or exposing
pricing mutation through the customer storefront.

## Decision

Add a private, owner-admin-gated Telegram screen next to representative wallet administration. Mutations
use durable conversation sessions: the admin selects grant/revoke access, set/clear base price, or
set/clear representative override, then supplies numeric representative/variant identifiers and prices.
A minimal representative list is read-only. Application use cases validate active representative identity
and positive prices before delegating to the existing commerce repository ports. Base and override clearing
are explicit deletes, preserving ADR 0011 precedence and keeping all user-facing copy in Persian.

No new tables, panel, gateway, debt, PasarGuard mutation, or customer-facing pricing control is added.

## Consequences

- Admin actions survive bot restarts and do not retain free-form message bodies in session payloads.
- Existing repository methods remain the source of truth, with a thin application boundary for validation.
- The Telegram UI is intentionally minimal; richer bulk pricing and audit screens remain future work.
- Local unit tests cover the durable flow and inactive-representative/clear-price boundaries; live Telegram
  and production database evidence remain owner-only gates.
