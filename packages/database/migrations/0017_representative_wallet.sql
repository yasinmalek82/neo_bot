-- Representative prepaid wallet: non-negative balance, append-only ledger, no debt.
create table representative_wallets (
  representative_id bigint primary key references representatives(id) on delete restrict,
  balance_irr bigint not null check (balance_irr >= 0),
  updated_at timestamptz not null default now()
);

create table representative_wallet_ledger (
  id bigint generated always as identity primary key,
  representative_id bigint not null references representatives(id) on delete restrict,
  amount_irr bigint not null check (amount_irr <> 0),
  direction text not null check (direction in ('credit', 'debit')),
  kind text not null check (kind in ('owner_credit', 'purchase_debit', 'adjustment')),
  idempotency_key text not null unique,
  sales_order_id bigint references sales_orders(id) on delete set null,
  note text check (note is null or char_length(note) between 1 and 240),
  created_at timestamptz not null default now(),
  constraint representative_wallet_ledger_signed_amount check (
    (direction = 'credit' and amount_irr > 0)
    or (direction = 'debit' and amount_irr < 0)
  )
);

create index representative_wallet_ledger_rep_created_idx
  on representative_wallet_ledger (representative_id, created_at desc);

alter table reporting_events drop constraint reporting_events_event_type_check;

alter table reporting_events add constraint reporting_events_event_type_check check (
  event_type in (
    'customer.first_contact',
    'customer.activity',
    'order.created',
    'payment.proof_submitted',
    'payment.approved',
    'payment.rejected',
    'provisioning.succeeded',
    'provisioning.failed',
    'renewal.requested',
    'renewal.completed',
    'renewal.failed',
    'system.failure',
    'ops.daily_summary',
    'reseller.order_created',
    'reseller.assignment_updated',
    'reseller.pricing_updated',
    'reseller.wallet_credited',
    'reseller.wallet_debited',
    'trial.claimed',
    'broadcast.queued',
    'referral.rewarded'
  )
);
