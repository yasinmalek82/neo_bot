alter table customers
  add column last_seen_at timestamptz not null default now();

create table report_destinations (
  id bigint generated always as identity primary key,
  code text not null unique check (code ~ '^[a-z0-9-]{3,80}$'),
  kind text not null check (kind = 'telegram_forum'),
  telegram_chat_id bigint not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index report_destinations_one_active_forum_idx
  on report_destinations (kind)
  where active = true and kind = 'telegram_forum';

create table report_topic_bindings (
  destination_id bigint not null references report_destinations(id) on delete cascade,
  purpose text not null check (
    purpose in (
      'new_users',
      'orders',
      'receipts',
      'sales',
      'renewals',
      'resellers',
      'errors',
      'daily_summaries'
    )
  ),
  telegram_message_thread_id bigint not null check (telegram_message_thread_id > 0),
  primary key (destination_id, purpose)
);

create table reporting_events (
  id bigint generated always as identity primary key,
  event_type text not null check (
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
      'system.failure'
    )
  ),
  occurrence_key text not null unique,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create index reporting_events_type_created_idx on reporting_events (event_type, created_at);

create table reporting_deliveries (
  id bigint generated always as identity primary key,
  event_id bigint not null references reporting_events(id) on delete restrict,
  destination_id bigint not null references report_destinations(id) on delete restrict,
  status text not null check (status in ('pending', 'delivered', 'failed')),
  attempt_count integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error_code text,
  telegram_message_id bigint,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, destination_id)
);

create index reporting_deliveries_pending_idx
  on reporting_deliveries (next_attempt_at, id)
  where status = 'pending';
