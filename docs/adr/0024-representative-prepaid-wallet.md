# ADR 0024: Representative prepaid wallet

- Status: accepted
- Date: 2026-09-05

## Context

ADR 0011 covers representative catalog listing and checkout price snapshots. Commercial scale needs
owner-controlled prepaid wallets for representatives with no debt or overdraft. Customer wallets
(ADR 0016) stay separate.

## Decision

Each active representative may have a `representative_wallets` row with `balance_irr >= 0`.
All mutations go through `representative_wallet_ledger`:

- credits: `direction=credit`, positive `amount_irr`, kind `owner_credit` or `adjustment`
- debits: `direction=debit`, negative `amount_irr`, kind `purchase_debit` or `adjustment`
- every mutation requires a durable `idempotency_key`
- debit that would make balance negative fails with `INSUFFICIENT_REPRESENTATIVE_WALLET`
- representative-priced checkout fulfillment debits the snapshot `amount_irr` once per order
- owner allowlisted admins may credit by representative code or telegram user id from private chat
- debt, overdraft, and representative cash withdrawal remain forbidden

`packages/domain` validates amounts and non-negative balance. PostgreSQL applies balance updates in
the same transaction as the ledger insert. No database transaction stays open across Telegram or
PasarGuard calls.

## Consequences

- Representatives cannot buy on credit through NEO.
- Public customer wallets are unchanged.
- Reporting may emit `reseller.wallet_credited` / `reseller.wallet_debited` with ids only.
- Admin price UI and full representative workspace remain later slices.
