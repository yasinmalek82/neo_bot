alter table services
  add column usage_synced_at timestamptz;

create index services_usage_sync_due_idx
  on services (usage_synced_at nulls first, id)
  where status = 'active';

alter table storefront_ops_settings
  add column referral_enabled boolean not null default false,
  add column referral_referrer_credit_irr bigint not null default 0
    check (referral_referrer_credit_irr >= 0 and referral_referrer_credit_irr <= 50000000),
  add column referral_invitee_discount_irr bigint not null default 0
    check (referral_invitee_discount_irr >= 0 and referral_invitee_discount_irr <= 50000000),
  add column referral_max_rewards_per_referrer integer not null default 50
    check (referral_max_rewards_per_referrer between 1 and 500);

create table referral_attributions (
  customer_id bigint primary key references customers(id) on delete restrict,
  referrer_customer_id bigint not null references customers(id) on delete restrict,
  referrer_telegram_user_id bigint not null check (referrer_telegram_user_id > 0),
  invitee_discount_order_id bigint references sales_orders(id) on delete restrict,
  created_at timestamptz not null default now(),
  check (customer_id <> referrer_customer_id)
);

create index referral_attributions_referrer_idx
  on referral_attributions (referrer_customer_id);

create table referral_rewards (
  referred_customer_id bigint primary key references customers(id) on delete restrict,
  referrer_customer_id bigint not null references customers(id) on delete restrict,
  order_id bigint not null references sales_orders(id) on delete restrict,
  referrer_credit_irr bigint not null check (referrer_credit_irr >= 0),
  created_at timestamptz not null default now(),
  unique (order_id),
  check (referred_customer_id <> referrer_customer_id)
);

alter table customer_wallet_ledger
  drop constraint customer_wallet_ledger_kind_check;

alter table customer_wallet_ledger
  add constraint customer_wallet_ledger_kind_check check (
    kind in ('topup', 'referral')
  );

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
    'trial.claimed',
    'broadcast.queued',
    'referral.rewarded'
  )
);
