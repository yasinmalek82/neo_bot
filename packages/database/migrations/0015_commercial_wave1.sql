alter table customers
  add column shop_blocked boolean not null default false;

alter table sales_orders
  drop constraint sales_orders_order_kind_check;

alter table sales_orders
  add constraint sales_orders_order_kind_check check (
    order_kind in ('purchase', 'renewal', 'trial')
  );

alter table sales_orders
  drop constraint sales_orders_amount_irr_check;

alter table sales_orders
  add constraint sales_orders_amount_irr_check check (
    amount_irr > 0 or order_kind = 'trial'
  );

alter table services
  add column used_traffic_bytes bigint check (used_traffic_bytes is null or used_traffic_bytes >= 0);

create table storefront_ops_settings (
  id smallint primary key default 1 check (id = 1),
  trial_enabled boolean not null default false,
  trial_variant_id bigint references product_variants(id) on delete restrict,
  forced_join_channels jsonb not null default '[]'::jsonb
    check (jsonb_typeof(forced_join_channels) = 'array'),
  reminders_enabled boolean not null default true,
  expiry_reminder_days smallint not null default 3
    check (expiry_reminder_days between 1 and 30),
  low_traffic_percent smallint not null default 15
    check (low_traffic_percent between 1 and 50),
  updated_at timestamptz not null default now()
);

insert into storefront_ops_settings(id) values (1) on conflict (id) do nothing;

create table customer_trial_claims (
  customer_id bigint primary key references customers(id) on delete restrict,
  order_id bigint not null references sales_orders(id) on delete restrict,
  claimed_at timestamptz not null default now()
);

create unique index customer_trial_claims_order_id_idx on customer_trial_claims (order_id);

create table service_reminder_deliveries (
  id bigint generated always as identity primary key,
  service_id bigint not null references services(id) on delete restrict,
  customer_id bigint not null references customers(id) on delete restrict,
  kind text not null check (kind in ('expiry', 'low_traffic')),
  window_key text not null check (char_length(window_key) between 1 and 40),
  status text not null default 'pending' check (status in ('pending', 'delivered', 'failed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz not null default now(),
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (service_id, kind, window_key)
);

create index service_reminder_deliveries_due_idx
  on service_reminder_deliveries (next_attempt_at, id)
  where status = 'pending';

create table broadcast_jobs (
  id bigint generated always as identity primary key,
  admin_telegram_user_id bigint not null check (admin_telegram_user_id > 0),
  body text not null check (char_length(body) between 1 and 3500),
  body_sha256 text not null check (char_length(body_sha256) = 64),
  status text not null default 'queued' check (
    status in ('queued', 'running', 'canceled', 'completed', 'failed')
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  canceled_at timestamptz,
  completed_at timestamptz
);

create table broadcast_recipients (
  id bigint generated always as identity primary key,
  job_id bigint not null references broadcast_jobs(id) on delete restrict,
  customer_id bigint not null references customers(id) on delete restrict,
  chat_id bigint not null check (chat_id > 0),
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'skipped')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz not null default now(),
  last_error_code text,
  sent_at timestamptz,
  unique (job_id, customer_id)
);

create index broadcast_recipients_due_idx
  on broadcast_recipients (job_id, next_attempt_at, id)
  where status = 'pending';

alter table conversation_sessions
  drop constraint conversation_sessions_flow_id_check;

alter table conversation_sessions
  add constraint conversation_sessions_flow_id_check check (
    flow_id in (
      'commerce.purchase',
      'commerce.renewal',
      'wallet.topup',
      'support.ticket',
      'admin.broadcast',
      'admin.ops'
    )
  );

alter table conversation_sessions
  drop constraint conversation_sessions_step_check;

alter table conversation_sessions
  add constraint conversation_sessions_step_check check (
    step in ('naming', 'coupon', 'confirm', 'amount', 'create', 'followup', 'settings')
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
    'broadcast.queued'
  )
);
