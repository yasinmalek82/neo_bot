# ADR 0011: Representative listing and pricing precedence

- Status: accepted
- Date: 2026-08-22

## Context

Public catalog prices live on `product_variants.price_irr`. Reseller work needs a second price
without changing the public shop. Migration `0007_reseller_pricing_and_ops.sql` adds
representatives, per-variant access, a shared representative base price, and a per-representative
override. Chat checkout already snapshots `amount_irr` on the order; that snapshot must use the
price the representative actually saw.

Wallet, debt, customer-to-representative assignment, and dedicated reseller report bodies are later
slices. This decision only covers listing and the checkout snapshot.

## Decision

A Telegram user is a representative only when `representatives.telegram_user_id` matches and
`active` is true. That buyer sees the granted subset in `representative_variant_access`. Everyone
else sees the public sellable catalog at the public price.

Resolved list and checkout price is:

1. `representative_variant_price_overrides.price_irr` for that representative and variant
2. else `representative_variant_base_prices.price_irr` for the variant
3. else `product_variants.price_irr`

The chosen source is stored on `sales_orders.pricing_source` as `representative_override`,
`representative_base`, or `public`. `sales_orders.representative_id` is set only for the
representative checkout path. Public checkout never reads representative price tables.

`packages/domain` owns `resolveRepresentativePrice`. The PostgreSQL repository applies it after
reading the three candidate amounts. No database transaction stays open across Telegram.

## Consequences

- Public shop amounts stay unchanged when representative prices exist.
- A representative without access cannot buy that variant at the public price through the
  representative path.
- Changing a representative price after checkout does not rewrite an existing order amount.
- Representative-only SKUs, wallets, assignment of other customers, and `reseller.*` report
  publishing remain later work. The database already accepts those event types.
