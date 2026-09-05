create table conversation_sessions (
  id uuid primary key,
  telegram_user_id bigint not null check (telegram_user_id > 0),
  flow_id text not null check (
    flow_id in ('commerce.purchase', 'commerce.renewal', 'wallet.topup', 'support.ticket')
  ),
  step text not null check (
    step in ('naming', 'coupon', 'confirm', 'amount', 'create', 'followup')
  ),
  schema_version smallint not null check (schema_version = 1),
  payload jsonb not null check (
    jsonb_typeof(payload) = 'object'
    and not (payload ? 'body')
    and not (payload ? 'ticketBody')
    and not (payload ? 'message')
    and not (payload ? 'text')
    and not (payload ? 'subscriptionUrl')
    and not (payload ? 'token')
    and not (payload ? 'apiKey')
    and not (payload ? 'fileId')
    and not (payload ? 'receipt')
  ),
  status text not null default 'pending' check (
    status in ('pending', 'canceled', 'completed', 'expired')
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  check (expires_at <= created_at + interval '24 hours')
);

create index conversation_sessions_open_idx
  on conversation_sessions(telegram_user_id, expires_at)
  where consumed_at is null;

create unique index conversation_sessions_one_pending_per_user_idx
  on conversation_sessions(telegram_user_id)
  where status = 'pending';

create table discount_codes (
  code text primary key check (code ~ '^[A-Z0-9_-]{3,32}$'),
  active boolean not null default true
);

create table customer_wallets (
  customer_id bigint primary key references customers(id) on delete restrict,
  balance_irr bigint not null check (balance_irr >= 0),
  updated_at timestamptz not null default now()
);

create table customer_wallet_ledger (
  id bigint generated always as identity primary key,
  customer_id bigint not null references customers(id) on delete restrict,
  amount_irr bigint not null check (amount_irr > 0),
  kind text not null check (kind = 'topup'),
  idempotency_key text not null unique,
  discount_code text,
  created_at timestamptz not null default now()
);

create table support_tickets (
  id bigint generated always as identity primary key,
  customer_id bigint not null references customers(id) on delete restrict,
  status text not null default 'open' check (status in ('open', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table support_ticket_messages (
  id bigint generated always as identity primary key,
  ticket_id bigint not null references support_tickets(id) on delete restrict,
  customer_id bigint not null references customers(id) on delete restrict,
  body text not null check (char_length(body) between 1 and 4000),
  idempotency_key text not null unique,
  created_at timestamptz not null default now()
);
