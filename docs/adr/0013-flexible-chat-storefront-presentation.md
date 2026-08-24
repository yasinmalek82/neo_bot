# ADR 0013: Flexible chat storefront presentation

- Status: accepted
- Date: 2026-08-22
- Extends: ADR 0012

## Context

The customer catalog exposed variants directly from a category and rendered every plan through one
fixed detail template. Administrator navigation was split across flat category, product and variant
lists, while editing required walking through unrelated fields. The owner requires flexible customer
copy without allowing display text to override the exact volume, duration, device limit, effective
price or provider binding used by checkout.

## Decision

- The persistent Telegram Reply Keyboard is the only home menu. Inline customer and administrator
  screens replace their own message; returning home clears inline actions and points to the persistent
  keyboard.
- Customer navigation is category -> product -> paginated comparison -> variant detail. Comparison
  pages render at most three bounded, HTML-safe plan blocks.
- Variant `name` and `description` are free display copy. Volume, duration, device limit, effective
  price and provider groups remain typed sale facts and are never parsed from that copy.
- A variant may have at most four ordered display attributes. Migration
  `0010_storefront_variant_attributes.sql` stores them in a normalized child table and leaves existing
  variants valid with an empty attribute list.
- Evidence badges are derived per product and customer price view. A unique variant with at least
  three fulfilled orders in the trailing thirty days is `پرفروش`; otherwise independent unique
  winners may receive `کمترین قیمت` or `بیشترین حجم`. Each variant keeps only its highest-priority
  applicable badge.
- Chat administration follows category -> product -> variant hierarchy. Item edits accumulate in one
  durable working-copy session, show a bounded diff and customer preview, and publish once. Reordering
  is reviewed before sibling positions are swapped.
- Guided setup publishes a category, its first product and its first variant as one typed changeset.
  Revision comparison, all three operations, one revision increment, session completion and one
  redacted audit entry occur in the same database transaction.

## Consequences

- Existing orders, representative pricing, provider validation and provisioning behavior are
  unchanged.
- Free copy and display attributes are escaped and budgeted before Telegram rendering; hostile but
  valid input cannot exceed the message limit or break HTML entities.
- Publication failure in any guided operation rolls back the complete changeset.
- Production must apply migration `0010` before running this code. Deployment and live Telegram or
  PasarGuard verification remain separately authorized operations.
- No current Telegram source screenshot was supplied. Code-driven copy and interaction tests pass,
  but visual fidelity on real Android and iPhone clients remains an explicit owner validation gate.
